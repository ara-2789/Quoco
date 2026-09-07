import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { SessionFlow } from '@/lib/whatsapp/session'
import { enqueueHindrancePmNotify } from '@/lib/hindrance/pm-notify'

// Ad-hoc menu item 1's real flow (PR 2, step 4). Same locked-turn
// architecture as morning/evening -- apply_hindrance_flow_turn (migration
// 038, docs/reviews/038_hindrance_flow_and_collision_fix.sql) does the
// decision AND the write atomically under one row lock; this module's job
// is parsing Q2's answer, calling the RPC, and building the reply text --
// same split as every other flow in this codebase.
//
// MIGRATION 038 IS NOT YET APPLIED (external-review-gate, CLAUDE.md §0
// condition (a) -- it modifies apply_morning_flow_turn/apply_evening_
// flow_turn's own live logic). This module compiles and is fully tested
// against a real Postgres 17 dry-run scaffold (docs/reviews/038's own
// header), but calling applyHindranceFlowTurn against test-db or prod will
// fail with "function does not exist" until 038 is reviewed and applied.
//
// STEP 5 (PM notify, lib/hindrance/pm-notify.ts) IS WIRED IN BELOW, BUT
// EQUALLY DORMANT -- same "necessary, not sufficient" state as that
// module's own header describes. A genuine completion turn enqueues the
// hindrance_pm_notify job, but nothing calls applyHindranceFlowTurn in
// production yet (inbound-start.ts's "1" branch still calls
// buildItem1InterimReply, not this function), so this stays inert until
// both 038 ships AND that router wiring lands.

export type HindranceOutcome = 'start' | 'advance' | 'reask' | 'idle' | 'wrong_flow'

export interface HindranceTurnResult {
  outcome: HindranceOutcome
  currentFlow: SessionFlow | null
  currentStep: number
  /**
   * Only meaningful when outcome='advance' and currentStep=0 (a
   * completion) -- disambiguates HINDRANCE_RESOLVED_REPLY from
   * HINDRANCE_UNSPECIFIED_REPLY, same role buildMorningReply's own
   * `attendance` parameter plays for morning's three completions.
   * Computed by THIS wrapper from the same classification it already
   * computed to call the RPC, not returned by the RPC itself -- the RPC
   * has no need to know why the caller wants this, only what timing/
   * timing_ok to act on.
   */
  wasExhausted: boolean
}

// --- Q2 classification -----------------------------------------------------
// Same "STANDALONE leading digit" rule as the router's own classifyAdhocInput
// (lib/whatsapp/inbound-start.ts) -- a lone "1" or "1, it's blocking now"
// both count; "12 workers" does not. Kept as its own small pure function
// rather than reused from classifyAdhocInput, since that function answers a
// different question (which ad-hoc MENU ITEM was this) than this one (which
// TIMING value did Q2's answer mean) -- different domains, same shape.
export interface HindranceTimingClassification {
  ok: boolean
  timing: 'active' | 'potential' | null
}

export function classifyHindranceTiming(message: string): HindranceTimingClassification {
  const match = message.trimStart().match(/^([0-9])(?!\d)/)
  if (!match) return { ok: false, timing: null }
  if (match[1] === '1') return { ok: true, timing: 'active' }
  if (match[1] === '2') return { ok: true, timing: 'potential' }
  return { ok: false, timing: null }
}

// --- Copy (Aravind, 2026-09-06/07 -- docs/plans/adhoc-menu-spec.md's own
// "Idle-inbound reply, decided" section carries the full design record).
// "Your Project Manager will see it" ADDED 2026-09-07, once true, not
// before: Phase A (scripts/verify-email-delivery.ts) confirmed a real,
// verified-domain delivery to a non-account-holder address the same day
// -- the PM-notify pipeline (lib/hindrance/pm-notify.ts, step 5) actually
// works end to end. Held back deliberately until this exact moment; see
// lib/hindrance/pm-notify.ts's own header for the one open reliability
// gap this line's truth still depends on (silent bounce suppression). ---
export const HINDRANCE_QUESTIONS: Readonly<Record<number, string>> = {
  1: "What's the hindrance? Describe it in your own words.",
  2: 'Is it blocking work right now, or could it block work later?\nReply 1 for blocking now\nReply 2 for may block later',
}

export const HINDRANCE_RESOLVED_REPLY = '✅ Hindrance recorded. Your Project Manager will see it.'

export const HINDRANCE_UNSPECIFIED_REPLY =
  "✅ Hindrance recorded. I couldn't tell if it's blocking now or later, but your report is saved. Your Project Manager will see it."

/**
 * Build the outbound reply for a resolved hindrance turn. `wasExhausted`
 * disambiguates the two possible 'advance'-to-idle completions, the same
 * way buildMorningReply's own `attendance` parameter disambiguates ITS
 * three completions -- see that function's own doc for the precedent.
 */
export function buildHindranceReply(
  outcome: HindranceOutcome,
  currentStep: number,
  wasExhausted?: boolean,
): string {
  switch (outcome) {
    case 'start':
      return HINDRANCE_QUESTIONS[1]
    case 'advance':
      if (currentStep === 0) {
        return wasExhausted ? HINDRANCE_UNSPECIFIED_REPLY : HINDRANCE_RESOLVED_REPLY
      }
      return HINDRANCE_QUESTIONS[currentStep] ?? ''
    case 'reask':
      return HINDRANCE_QUESTIONS[currentStep] ?? ''
    case 'idle':
      // Never actually reached by the router -- classifyAdhocInput only
      // calls this flow's start with p_start_flow:true. Present so this
      // function is total over HindranceOutcome, matching morning/evening's
      // own completeness discipline for outcomes their own callers never
      // trigger in practice.
      return ''
    case 'wrong_flow':
      return ''
  }
}

export async function applyHindranceFlowTurn(params: {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  startFlow: boolean
  now?: string
  testSleepMs?: number
  supabaseClient?: SupabaseClient
}): Promise<HindranceTurnResult> {
  const supabase = params.supabaseClient ?? createServiceClient()

  // Classified unconditionally and cheaply, same pattern as morning's own
  // manpower/equipment parses -- the RPC itself only reads p_timing/
  // p_timing_ok when current_step actually is 2 under its own lock; a
  // classification computed here for a step-1 turn is simply ignored.
  const classification = classifyHindranceTiming(params.message)

  const { data, error } = await supabase.rpc('apply_hindrance_flow_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_start_flow: params.startFlow,
    p_timing: classification.timing ?? undefined,
    p_timing_ok: classification.ok,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })

  if (error) {
    throw new Error(`apply_hindrance_flow_turn failed for ${params.phoneNumber}: ${error.message}`)
  }

  const result = data as {
    outcome: HindranceOutcome
    current_flow: SessionFlow | null
    current_step: number
  }

  // A genuine completion -- both wasExhausted:true (unresolved Q2) and
  // wasExhausted:false (resolved Q2) cases -- enqueues the PM-notify job
  // (lib/hindrance/pm-notify.ts, step 5). Fired here, not by the caller,
  // so no future call site of this function can forget it. NEVER blocks
  // or fails the engineer-facing reply: enqueueHindrancePmNotify itself
  // never throws (see its own header) -- the hindrance row is already
  // safely written by the RPC by this point regardless of whether the
  // notify job successfully enqueues.
  if (result.outcome === 'advance' && result.current_step === 0) {
    await enqueueHindrancePmNotify({ projectId: params.projectId, userId: params.userId }, supabase)
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    // Only actually exhausted on the turn that COMPLETES unresolved --
    // an unparseable answer that merely triggers a reask (outcome='reask')
    // must not be reported as exhausted, or the caller could show the
    // wrong confirmation on a later, genuinely resolved turn that happens
    // to reuse a stale flag.
    wasExhausted: result.outcome === 'advance' && result.current_step === 0 && !classification.ok,
  }
}
