import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
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
// LIVE, 2026-09-07 -- SUPERSEDES THE PARAGRAPH BELOW. Migration 038 is
// confirmed applied to prod (docs/reviews/038-post-apply-probe.sql, 17/17
// checks) and inbound-start.ts's "1" branch now calls
// applyHindranceFlowTurn(startFlow: true) directly -- a real leading "1"
// reaches this module today. Struck through, not rewritten:
// ~~MIGRATION 038 IS NOT YET APPLIED (external-review-gate, CLAUDE.md §0
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
// both 038 ships AND that router wiring lands.~~

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
   *
   * CHANGED, migration 044 (stage 2). Under 038, completion and Q2's own
   * resolution were the SAME turn, so this was computed here from the
   * classification THIS call already computed. They are no longer the
   * same turn -- completion now happens on Q3's turn (a separate call,
   * whose message is "none" or free text, not a timing answer at all).
   * Re-classifying Q3's message via classifyHindranceTiming would have
   * silently misreported every real completion as exhausted (caught while
   * writing this wrapper, before it ever ran -- see 044's own migration
   * comment for the fix). Now read directly from the RPC's own
   * `was_unspecified` field, which the RPC itself carries across the
   * Q2->Q3 gap in session context.
   */
  wasExhausted: boolean
  /**
   * NEW, migration 044. The hindrances row's id. Non-null at the two
   * turns the RPC has confirmed knowledge of it: the turn that inserts
   * the row (Q2's own resolution, advancing to step 3) and the turn that
   * completes the flow (Q3's own completion, read back from session
   * context by the RPC itself) -- null on every other outcome.
   *
   * CHANGED, external review round 2 (S1, fold-and-return, 2026-09-14).
   * Previously only non-null at the insert turn; this file's own
   * completion branch below used to re-derive the id for
   * enqueueHindrancePmNotify via a separate "most recent hindrance for
   * this reporter" lookup (resolveMostRecentHindranceId,
   * lib/hindrance/pm-notify.ts) instead of using this field directly. That
   * lookup's own safety argument fenced only the writer that exists
   * TODAY (this flow) -- it said nothing about a future one, and one is
   * already named in this project's own artifacts (DASH-10, the unbuilt
   * hindrance-editing dashboard surface, cited in 039's own grant
   * commentary). The SAME shape as the `wasExhausted` bug this migration
   * already found and fixed internally, one layer up: re-deriving from
   * adjacent state a fact the RPC already established, on an earlier
   * turn, instead of carrying it forward. Fixed by having the RPC ALSO
   * populate this field at completion (read back from context, exactly
   * like `was_unspecified`) -- resolveMostRecentHindranceId is deleted
   * entirely, not fenced.
   */
  hindranceId: string | null
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
  // Stage 2 (docs/plans/media-capture-design.md item 20; docs/plans/
  // stage2-hindrance-photos-plan.md). New, 2026-09-14 (migration 044,
  // docs/reviews/044_hindrance_photos.sql). Asked AFTER the hindrances row
  // is already written (Q2's resolution) -- a hindrance_id exists by the
  // time this question is ever shown, so a photo sent here can be stored
  // immediately (see lib/whatsapp/inbound-start.ts's own hindrance photo
  // branch).
  //
  // COPY CHANGED, 2026-09-15 -- LIVE PROD FINDING, not a refinement. The
  // original copy ("...Reply none to skip.") gave the engineer no way to
  // signal he was DONE sending photos -- items 12/23 ("a photo never
  // answers a question") meant every photo he sent just re-asked the same
  // question, with no acknowledgement at all for an uncaptioned photo, and
  // a captioned one produced "Photo saved. Type your reply for this
  // question" -- copy that reads as "type an answer," when the only text
  // that closes this question ("none") reads as DISCARDING the photos he
  // just sent. See lib/whatsapp/inbound-start.ts's handleHindrancePhoto
  // for the full mechanism this copy change pairs with (a running
  // photo-count acknowledgement, "done" to finish). Approved copy, exact
  // (Aravind, 2026-09-15) -- Tamil pair owed, not invented.
  3: 'Send photos of the issue. Reply none to skip, or done when finished.',
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
    hindrance_id: string | null
    was_unspecified: boolean
  }

  // A genuine completion (now Q3's own completion, per migration 044 --
  // was Q2's, under 038) -- both wasExhausted:true and wasExhausted:false
  // cases -- enqueues the PM-notify job (lib/hindrance/pm-notify.ts, step
  // 5). Fired here, not by the caller, so no future call site of this
  // function can forget it. NEVER blocks or fails the engineer-facing
  // reply: enqueueHindrancePmNotify itself never throws (see its own
  // header) -- the hindrance row is already safely written by the RPC (at
  // Q2's own earlier turn) regardless of whether the notify job
  // successfully enqueues.
  //
  // CHANGED, external review round 2 (S1, 2026-09-14): passes
  // result.hindrance_id DIRECTLY -- the RPC now populates it at this
  // exact completion turn too (read back from session context, see
  // 044's own migration comment), so there is no lookup left to perform
  // here. A defensive Sentry alert covers the case this should never
  // reach (a genuine completion with no hindrance_id at all), rather than
  // silently skipping the notify.
  if (result.outcome === 'advance' && result.current_step === 0) {
    if (result.hindrance_id) {
      await enqueueHindrancePmNotify({ hindranceId: result.hindrance_id }, supabase)
    } else {
      Sentry.captureException(
        new Error('applyHindranceFlowTurn: genuine completion with no hindrance_id -- cannot enqueue PM notify'),
        {
          fingerprint: ['hindrance-flow', 'completion_missing_hindrance_id'],
          tags: { feature: 'hindrance-flow' },
          extra: { phoneNumber: params.phoneNumber, projectId: params.projectId, userId: params.userId },
        },
      )
    }
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    // Read directly from the RPC, not re-derived from `classification`
    // (this turn's message, at completion time, is Q3's answer -- "none"
    // or free text -- not a timing digit). See this file's own
    // HindranceTurnResult.wasExhausted doc for the bug this replaces.
    wasExhausted: result.outcome === 'advance' && result.current_step === 0 && result.was_unspecified,
    hindranceId: result.hindrance_id,
  }
}
