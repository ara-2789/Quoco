import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import type { SessionFlow } from '@/lib/whatsapp/session'
import { equipmentLabel } from './parsers/lexicon'
import { parseQuantities } from './parsers/quantities'
import { parseLabourCount, isLabourAnswered } from './parsers/labour'
import { parseIdleHoursByTrade, isIdleHoursAnswered } from './parsers/idle-hours'
import { parseEquipmentHours, isEquipmentHoursAnswered } from './parsers/equipment-hours'

// Evening check-in flow — RESTRUCTURED (migration 035, 2026-09-02). FIVE
// linear questions, one remaining conditional edge (the pre-existing
// equipment auto-skip, BOT-22):
//   Q1 "Work completed + quantity"  -> evening_output (+ quantities)          (step 1, ungated)
//   Q2 "Workers by trade"           -> evening_manpower                       (step 2, parsed, shares parseLabourCount with morning Q3)
//   Q3 "Idle hours by trade"        -> evening_idle_hours                     (step 3, parsed, UNCONDITIONAL — "all working" is a real answer)
//   Q4 "Equipment hours used"       -> evening_equipment_utilisation          (step 4, parsed, AUTO-SKIPPABLE on empty morning equipment)
//   Q5 "Hindrance"                  -> evening_schedule_miss_reason (REUSED)  (step 5, ungated, terminal)
// DELETED, not carried forward in any form: "did you meet today's plan"
// (the old Q2), the miss-reason follow-up (the old conditional Q3),
// aggregate workers-on-site (the old Q4a headcount), aggregate
// productive/idle (the old Q4b). Each of those questions computed an
// AGGREGATE or a plan-vs-actual comparison — this restructuring replaces
// all of it with by-trade/by-type capture, per §42's own motivating
// evidence (docs/reviews/field-samples.md) that aggregates were already
// losing real information the engineer was volunteering.
//
// STEP IDS ARE NOT QUESTION NUMBERS is no longer true the way it was for
// the old 6-step flow (Q4 no longer occupies two steps) — but Q4 still
// auto-skips to Q5 when morning listed no equipment, so "advance" doesn't
// always mean "current_step + 1" and nothing here should assume it does.
//
// NO PURE MIRROR (deliberate asymmetry from morning's dispatchMorningFlow).
// The old dispatchEveningFlow existed but was never given the dedicated
// unit-test coverage that gives morning's mirror its actual reason to
// exist (tracked here for years, never fixed) — rather than carry that gap
// forward into a rewritten mirror, this restructuring drops the mirror
// entirely. Production behaviour is proven by test/evening-flow.test.ts
// exercising apply_evening_flow_turn directly, the same authority
// morning's own integration suite already carries independent of its
// mirror.

// ---------------------------------------------------------------------------
export type EveningOutcome =
  | 'start'
  | 'advance'
  | 'already_complete'
  | 'idle'
  | 'reask'
  | 'wrong_flow'

// The in-scope step ids, in order.
export const EVENING_STEP_ORDER: readonly number[] = [1, 2, 3, 4, 5]

// One reask per parsed question on an unanswered/unparseable reply (Rule
// 3.5). Q1 and Q5 are ungated — no reask exists for either.
export const EVENING_PARSE_REASK_CAP = 1

// Context keys holding the per-step reask counters. Prefixed 'e' + step
// number so evening's counters can never collide with morning's own
// q1_reask/q3_reask/q4_reask inside the SAME context object.
export const EVENING_Q2_REASK_KEY = 'e2_reask'
export const EVENING_Q3_REASK_KEY = 'e3_reask'
export const EVENING_Q4_REASK_KEY = 'e4_reask'

// Context marker set when the evening flow completes.
export const EVENING_SUBMITTED_KEY = 'evening_submitted'

// NOTE: there is no TS-side EVENING_IN_FLIGHT_KEYS list here, unlike the OLD
// dispatchEveningFlow this restructuring deletes. All context stripping
// (start, completion, and the migration's own one-time session sweep for
// sessions still carrying the OLD e4_headcount/e5_reask/e6_reask keys) is
// SQL-side, inside apply_evening_flow_turn itself — this file has no pure
// mirror to keep such a list in sync with (see the file header's NO PURE
// MIRROR note).

// ---------------------------------------------------------------------------
// Reply copy — the SINGLE source of question/reask/completion text, read by
// the webhook (production, keyed off the RPC's returned outcome +
// current_step) and by test/evening-flow.test.ts's own expectations, so the
// two can never diverge on copy.
//
// Q1's wording MUST match `quoco_evening_checkin_v3`'s approved template
// body exactly (docs/whatsapp-templates.md) — the template embeds this
// same question directly in the trigger message, and evening.ts's own copy
// here is what a re-ask (or an inbound-start turn) sends. Checked directly
// against the approved copy at authoring time, not assumed unchanged from
// an earlier draft — a prior round of this same file's copy had drifted
// from the template's own re-cut without anyone propagating the change,
// caught only by an explicit side-by-side re-read.
export const EVENING_QUESTIONS: Readonly<Record<number, string>> = {
  1: 'Evening check-in 🌇 What *work was completed* today? Enter quantity wherever applicable — e.g. "slab concrete 120 sqm" or "brickwork 8 m3".',
  2: 'How many *workers* were on site today? You can just send a number, or a breakdown like "12 mason 8 helper".',
  3: 'Was anyone *idle* today? Tell us which trade and for how long — e.g. "mason idle 2 hours". Reply *all working* if nobody was idle.',
  4: '', // DATA-DRIVEN — see buildEquipmentHoursPrompt / buildEveningReply. Never read directly.
  5: 'Anything that *slowed execution* today? Reply in a few words, or "none".',
}

// Reask copy — states WHY the reply was rejected, per the standing ruling
// this restructuring's own scoping plan recorded (§0(a), the 2026-08-31
// "2 JCB 8" incident: a rejection with no explanation is indistinguishable
// from "you said nothing"). Checked, not assumed, what each parser can
// actually report at rejection time: the two-number arithmetic-guard
// scenario §0(a) originally analysed is now MOOT (Q4 asks for one number,
// nothing left to compare) — every rejection at steps 2/3/4 collapses to
// ONE reason today ("no number recognised"; step 3 adds "or an all-clear
// phrase"), so a static per-step message already reflects the full
// available diagnostic. No dynamic reason-passing is built because there
// is currently nothing dynamic to pass — a second rejection reason would
// need this to become a real parameter, not before.
export const EVENING_REASK_MESSAGES: Readonly<Record<number, string>> = {
  2: 'Sorry, I didn\'t catch a number there. How many *workers* were on site today? Just send a number, or a breakdown like "12 mason 8 helper".',
  3: 'Sorry, I didn\'t catch that. Tell us the *idle hours* by trade — e.g. "mason idle 2 hours" — or reply *all working* if nobody was idle.',
  4: 'Sorry, I didn\'t catch an hours number there. For each machine, send the *hours used* — e.g. "JCB 6 hours".',
}

export const EVENING_COMPLETE_REPLY =
  '✅ Evening check-in complete. Thanks — rest well!'

export const EVENING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's evening check-in. ✅ Nothing more needed."

// idle produces no outbound message (no active flow, nothing to say).
export const EVENING_IDLE_REPLY = ''

// wrong_flow is never rendered: the webhook retries against the other RPC
// and replies with THAT result. Present so buildEveningReply is total.
export const EVENING_WRONG_FLOW_REPLY = ''

// A minimal shape for the echoed morning equipment list — only what Q4's
// prompt needs to render. Mirrors the RPC's `equipment_echo` return value
// (morning_equipment->'items').
export interface EquipmentEchoItem {
  type: string
}

function formatEquipmentEcho(items: readonly EquipmentEchoItem[]): string {
  return items.map((item) => equipmentLabel(item.type)).join(', ')
}

// Q4's prompt. NO POSITIONAL NUMBERING, deliberately — unlike the old Q5
// prompt this replaces, matching is by TYPE STRING only now (the migration
// retires the entire MATCH TIERS apparatus), so a numbered "1) JCB" list
// would misleadingly imply an ordering that no longer has any effect.
export function buildEquipmentHoursPrompt(items: readonly EquipmentEchoItem[]): string {
  return (
    `Equipment you listed this morning: ${formatEquipmentEcho(items)}. ` +
    'How many *hours* was each used today? e.g. "JCB 6 hours, mixer 4 hours".'
  )
}

/**
 * Build the outbound reply for a resolved turn, from the outcome and the
 * post-turn current_step. Completion is signalled by outcome 'advance' with
 * current_step 0 (the RPC resets the step to 0 when the flow completes).
 * `equipmentEcho` is REQUIRED to render step 4's prompt (advancing INTO
 * step 4, or reasking while step 4 is active — the RPC returns it on both
 * paths) and ignored for every other step.
 */
export function buildEveningReply(
  outcome: EveningOutcome,
  currentStep: number,
  equipmentEcho?: readonly EquipmentEchoItem[],
): string {
  switch (outcome) {
    case 'start':
      return EVENING_QUESTIONS[1]
    case 'advance':
      if (currentStep === 0) return EVENING_COMPLETE_REPLY
      if (currentStep === 4) return buildEquipmentHoursPrompt(equipmentEcho ?? [])
      return EVENING_QUESTIONS[currentStep] ?? ''
    case 'reask':
      if (currentStep === 4) {
        return `${EVENING_REASK_MESSAGES[4]}\n${formatEquipmentEcho(equipmentEcho ?? [])}`
      }
      return EVENING_REASK_MESSAGES[currentStep] ?? EVENING_QUESTIONS[currentStep] ?? ''
    case 'already_complete':
      return EVENING_ALREADY_COMPLETE_REPLY
    case 'idle':
      return EVENING_IDLE_REPLY
    case 'wrong_flow':
      return EVENING_WRONG_FLOW_REPLY
  }
}

// ---------------------------------------------------------------------------
// Production write path: the thin wrapper over the single transactional RPC.
// This is the ONLY thing that writes the session/daily_logs for the evening
// flow — there is no pure mirror to cross-check against (see the file
// header's NO PURE MIRROR note).

export interface EveningTurnResult {
  outcome: EveningOutcome
  currentFlow: SessionFlow | null
  currentStep: number
  logDate: string
  /** Populated by the RPC when current_step becomes 4 (advance or reask). */
  equipmentEcho: EquipmentEchoItem[] | null
}

export async function applyEveningFlowTurn(params: {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  startFlow: boolean
  now?: string
  /** TEST-ONLY: forces a mid-transaction pause to prove the row lock serialises. */
  testSleepMs?: number
  /**
   * Injected client, defaulting to createServiceClient() (today's exact
   * behaviour) when omitted. Same shape as clearMessagingBlock's own
   * client parameter (lib/whatsapp/reactivation.ts) — lets a test pass
   * testClient() instead of the prod-resolving default, without changing
   * any existing call site.
   */
  supabaseClient?: SupabaseClient
}): Promise<EveningTurnResult> {
  const supabase = params.supabaseClient ?? createServiceClient()

  // Parse EVERY parsed step's shape unconditionally (pure + cheap) and hand
  // them to the RPC KEYED BY STEP ID — same reasoning as morning's own two
  // typed pairs: the webhook cannot know which step is active without an
  // unlocked, racy read, so every shape is computed every turn and the
  // locked RPC selects the one that matches. None of these parsers see
  // morning_equipment or morning_manpower — the RPC resolves any join
  // under its own lock. Each parser's own output shape is exactly what the
  // RPC's jsonb_build_object reads (035_evening_flow_restructuring.sql) —
  // passed straight through, no TS-side reshaping.
  const quantities = parseQuantities(params.message)
  const manpower = parseLabourCount(params.message)
  const idleHours = parseIdleHoursByTrade(params.message)
  const equipmentHours = parseEquipmentHours(params.message)

  const parse = {
    '1': quantities,
    '2': manpower,
    '3': idleHours,
    '4': equipmentHours,
    // No '5' — the hindrance step (terminal, ungated) writes p_message
    // directly, no parser involved.
  }
  const parseOk = {
    '1': true, // Q1 is never parse-gated.
    '2': isLabourAnswered(manpower),
    '3': isIdleHoursAnswered(idleHours),
    '4': isEquipmentHoursAnswered(equipmentHours),
  }

  const { data, error } = await supabase.rpc('apply_evening_flow_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_start_flow: params.startFlow,
    // Cast to Json because a concrete interface is not structurally assignable
    // to the recursive Json index type — a permanent TS limitation, not a stale
    // -types workaround (same note as morning.ts).
    p_parse: parse as unknown as Json,
    p_parse_ok: parseOk as unknown as Json,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })

  if (error) {
    throw new Error(`apply_evening_flow_turn failed for ${params.phoneNumber}: ${error.message}`)
  }

  const result = data as {
    outcome: EveningOutcome
    current_flow: SessionFlow | null
    current_step: number
    log_date: string
    equipment_echo: EquipmentEchoItem[] | null
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    logDate: result.log_date,
    equipmentEcho: result.equipment_echo,
  }
}
