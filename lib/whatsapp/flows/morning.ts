import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import type { SessionFlow, WhatsAppSession } from '@/lib/whatsapp/session'
import { classifyYesNo, type YesNoClassification } from './parsers/lexicon'
import { parseLabourCount, isLabourAnswered, type LabourParse } from './parsers/labour'
import { parseEquipment, isEquipmentAnswered, type EquipmentParse } from './parsers/equipment'

// Morning check-in flow. Renumbered by the morning flow migration
// (supabase/migrations/030_morning_flow_attendance.sql) per
// docs/reviews/morning-flow-migration-review-package.md's step-mapping table
// (§2) -- that table is the spec this file implements, not restated here:
//   Q1 "Are you on site today?"    -> daily_logs.attendance              (step 1, parsed yes/no)
//     NO -> Q1b "Is it a site holiday?" -> daily_logs.attendance/is_holiday (step 5, parsed yes/no, completes the flow)
//   Q2 "Plan of action today"      -> daily_logs.morning_plan            (step 2, free text)
//   Q3 "Workers by trade"          -> daily_logs.morning_manpower        (step 3, parsed)
//   Q4 "Equipment on site + rate"  -> daily_logs.morning_equipment       (step 4, parsed, completes the flow)
// morning_execution_plan (the OLD step 4) is retired -- no longer written,
// column stays with its historical data (§28(p), review package row K).
//
// PASS-2 REASK BUDGET, UNCHANGED IN SHAPE, RENUMBERED IN KEY: Q1, Q3, Q4, and
// the holiday follow-up each allow ONE reask on an unparseable/unclassifiable
// answer, after which the flow accepts a default and advances -- a field
// engineer is never trapped. Q1's and the holiday follow-up's exhausted-reask
// defaults are DIRECTIONAL, not a uniform "accept and move on": Q1 defaults
// to YES, the holiday follow-up defaults to `absent` -- both DECIDED
// 2026-08-23 under the same rule (default to whichever branch preserves MORE
// downstream capture), see REASK_KEY's own note below and the review
// package's §2 for the full asymmetry-of-consequence argument. Empty/
// whitespace answers still reask unlimited (Pass 1 semantics) and do NOT
// consume the budget. The per-step reask counters live in session.context
// and are merged, not replaced.
//
// AUTHORITY NOTE: dispatchMorningFlow below is a PURE mirror of the decision
// logic in apply_morning_flow_turn -- originally 014_morning_flow_apply_turn.sql,
// then 022_evening_flow_apply_turn.sql (wrong_flow outcome + Q4 completion
// merge), now 030_morning_flow_attendance.sql (this renumbering). It is NOT
// authoritative -- production behaviour is entirely determined by that RPC
// (which owns the row lock, the BOT-07 next-day reset, and the atomic
// session + daily_logs writes). A green dispatchMorningFlow unit test is not
// on its own proof of production correctness; the branch integration tests
// against apply_morning_flow_turn are.

// ---------------------------------------------------------------------------
// Outcomes. The three spec'd ones plus three Pass-1/022 terminals:
//   reask       — empty/whitespace answer to the active question (re-ask, no write).
//   idle        — inbound with no active morning flow, not yet completed today.
//   wrong_flow  — a DIFFERENT flow (evening) is active. 022 changed the RPC's
//                 ELSE branch from 'idle' to this; see evening.ts's identical
//                 outcome for why (a mis-routed turn must be reported, not
//                 silently swallowed after the Twilio SID is consumed).
export type MorningOutcome =
  | 'start'
  | 'advance'
  | 'already_complete'
  | 'idle'
  | 'reask'
  | 'wrong_flow'

// The in-scope YES-path question steps, in order. current_step stores the
// question NUMBER currently awaited. Step 5 (the holiday follow-up) is
// DELIBERATELY not listed here -- it is reachable only from step 1's NO
// answer, never by sequential advance, so it is not part of this ordering.
export const MORNING_STEP_ORDER: readonly number[] = [1, 2, 3, 4]

// Pass-2 reask budget: one reask per parsed question on an unparseable/
// unclassifiable answer.
export const MORNING_PARSE_REASK_CAP = 1

// Context keys holding the per-step reask counters. Renamed by the morning
// flow migration to match the step each counter now actually tracks
// (q2_reask/q3_reask -> q3_reask/q4_reask; new q1_reask, q5_reask) -- matches
// this project's standing preference against a name that encodes a mapping
// no longer true (same reasoning as morning_manpower_planned -> morning_manpower).
const REASK_KEY: Readonly<Record<number, string>> = {
  1: 'q1_reask',
  3: 'q3_reask',
  4: 'q4_reask',
  5: 'q5_reask',
}

// Every reask key morning ever uses -- stripped (never left behind) on a
// same-day restart, regardless of which ones happen to have a nonzero value.
const ALL_REASK_KEYS = [REASK_KEY[1], REASK_KEY[3], REASK_KEY[4], REASK_KEY[5]]

// ---------------------------------------------------------------------------
// Reply copy — the SINGLE source of question/completion text, shared by the
// pure mirror (tests) and the webhook (production, keyed off the RPC's returned
// outcome + current_step [+ attendance, see buildMorningReply]). Keeping it
// here means the two never diverge on copy.
export const MORNING_QUESTIONS: Readonly<Record<number, string>> = {
  1: 'Are you on site today? Reply yes or no.',
  2: "Good morning! 🌞 What's your *plan of action* for today?",
  3: 'How many *workers* today? You can just send a number, or a breakdown like "12 mason 8 helper".',
  4: 'Any *equipment / machinery* on site? Send name + hire rate (e.g. "JCB 1500"), or reply "no" if none.',
  5: 'Is it a site holiday? Reply yes or no.',
}

export const MORNING_COMPLETE_REPLY =
  '✅ Morning check-in complete. Have a productive day on site!'

export const MORNING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's morning check-in. ✅ Nothing more needed."

// The two NO-path completion replies (design-decisions-beta-feedback.md §30(b),
// copy DECIDED 2026-08-23 -- docs/reviews/morning-flow-migration-review-package.md
// §2.1). Deliberately does NOT promise PM notification on the absent path --
// nothing can notify a PM until Pass 2's escalation send exists (§30(e)); that
// promise would be the same defect as template 8's "Reply STOP".
export const MORNING_SITE_HOLIDAY_REPLY =
  '✅ Got it — site holiday recorded. No further check-ins needed today.'

export const MORNING_ABSENT_REPLY =
  "✅ Got it, thanks for letting us know. We'll still check in this evening."

// idle produces no outbound message (no active flow, nothing to say).
export const MORNING_IDLE_REPLY = ''

// wrong_flow is never rendered: the webhook retries against the evening RPC
// and replies with THAT result. Present so buildMorningReply is total —
// mirrors EVENING_WRONG_FLOW_REPLY in evening.ts exactly.
export const MORNING_WRONG_FLOW_REPLY = ''

/**
 * Build the outbound reply for a resolved turn, from the outcome, the
 * post-turn current_step, and (only load-bearing at completion) the
 * attendance value this turn resolved, if any. Used by BOTH the pure mirror
 * and the webhook so reply copy is single-sourced.
 *
 * `attendance` disambiguates completion: outcome 'advance' with current_step
 * 0 now happens on THREE different branches -- the YES path's Q4 completion,
 * and the NO path's two holiday-follow-up completions -- and each needs a
 * different reply. Not spec'd explicitly by the review package's step-mapping
 * table; resolved here the same way apply_evening_flow_turn already resolves
 * the analogous problem for its own step 6 (an extra `equipment_echo` return
 * field) -- see 030_morning_flow_attendance.sql's own header for the full
 * reasoning. Omitting `attendance` on a genuine completion falls back to
 * MORNING_COMPLETE_REPLY, so existing callers that haven't been updated fail
 * toward the ORIGINAL reply, not a broken one -- but every real call site in
 * this codebase passes it (see applyMorningFlowTurn's callers).
 */
export function buildMorningReply(
  outcome: MorningOutcome,
  currentStep: number,
  attendance?: 'present' | 'absent' | 'site_holiday' | null,
): string {
  switch (outcome) {
    case 'start':
      return MORNING_QUESTIONS[1]
    case 'advance':
      if (currentStep === 0) {
        if (attendance === 'site_holiday') return MORNING_SITE_HOLIDAY_REPLY
        if (attendance === 'absent') return MORNING_ABSENT_REPLY
        return MORNING_COMPLETE_REPLY
      }
      return MORNING_QUESTIONS[currentStep]
    case 'reask':
      return MORNING_QUESTIONS[currentStep] ?? ''
    case 'already_complete':
      return MORNING_ALREADY_COMPLETE_REPLY
    case 'idle':
      return MORNING_IDLE_REPLY
    case 'wrong_flow':
      return MORNING_WRONG_FLOW_REPLY
  }
}

// ---------------------------------------------------------------------------
// Pure decision mirror. ZERO Supabase calls — computes the write AS DATA and
// returns it; never executes anything. Operates on the session snapshot it is
// GIVEN: the BOT-07 next-day reset and the row lock are the RPC's job and are
// intentionally NOT re-implemented here (a second IST-date implementation would
// only risk drifting from quoco_same_ist_day). Tests construct sessions that
// represent the already-normalised state.

// The RESHAPED storage form of a labour parse -- what actually lands in
// daily_logs.morning_manpower (total/count), NOT LabourParse's own
// planned_total/planned_count field names. The parser itself (and its OTHER
// caller, evening's Q4a headcount, which reads .planned_total directly) is
// UNCHANGED -- the rename lives only at this write boundary. See
// 030_morning_flow_attendance.sql's header for why it stops here.
export interface MorningManpowerWrite {
  total: number | null
  by_trade: Array<{ trade: string; count: number }>
  raw_text: string
}

function reshapeLabourForStorage(parse: LabourParse): MorningManpowerWrite {
  return {
    total: parse.planned_total,
    by_trade: parse.by_trade.map((t) => ({ trade: t.trade, count: t.planned_count })),
    raw_text: parse.raw_text,
  }
}

export type MorningDailyLogWrite = Partial<{
  attendance: 'present' | 'absent' | 'site_holiday'
  is_holiday: boolean
  morning_plan: string
  morning_manpower: MorningManpowerWrite
  morning_equipment: EquipmentParse
  morning_submitted_at: string
}>

export interface MorningDispatch {
  outcome: MorningOutcome
  reply: string
  // Spec shape: only step + context. Clearing current_flow on completion is the
  // RPC's authoritative job; the mirror signals completion via current_step 0 +
  // the context.morning_submitted marker.
  sessionUpdate: { current_step?: number; context?: Record<string, unknown> }
  dailyLogWrite: MorningDailyLogWrite | null
}

export interface MorningDispatchOptions {
  /** Mirrors the RPC's p_start_flow (env-gated test trigger). */
  startFlow?: boolean
  /** Instant used for morning_submitted_at; injectable so tests are deterministic. */
  now?: string
}

/**
 * Shared advance-vs-reask decision for the two step-then-advance PARSED
 * questions (Q3/Q4 labour/equipment) -- kept in one place so those two
 * cannot drift, and so the SQL RPC has a single behaviour to mirror. Context
 * is MERGED (never replaced): the per-step reask counter is updated and
 * every other key preserved. NOT used for Q1/the holiday follow-up (see
 * decideYesNoStep) -- those branch to a DIFFERENT next step depending on the
 * answer, which this function's fixed step+1 advance cannot express, and NOT
 * used for Q4 directly either, since Q4's "advance" is a flow COMPLETION
 * (step 0), not step+1 -- Q4's branch is written out directly below instead.
 *   - answered            -> advance, clear this step's counter.
 *   - unanswered, budget  -> reask, increment this step's counter.
 *   - unanswered, over    -> accept the raw answer, advance, clear the counter.
 */
function decideParsedStep(
  step: number,
  ctx: Record<string, unknown>,
  answered: boolean,
): { outcome: MorningOutcome; nextStep: number; context: Record<string, unknown> } {
  const key = REASK_KEY[step]
  const prior = typeof ctx[key] === 'number' ? (ctx[key] as number) : 0

  if (answered || prior >= MORNING_PARSE_REASK_CAP) {
    return { outcome: 'advance', nextStep: step + 1, context: { ...ctx, [key]: 0 } }
  }
  return { outcome: 'reask', nextStep: step, context: { ...ctx, [key]: prior + 1 } }
}

/**
 * Shared advance-vs-reask decision for Q1 (attendance) and the holiday
 * follow-up -- both plain yes/no questions classified by classifyYesNo. The
 * exhausted-reask default is DIRECTIONAL per question (`defaultMetOnExhausted`)
 * -- see REASK_KEY's own file-header note and the review package's §2 for why
 * the two questions default in OPPOSITE directions under the same underlying
 * rule (default to whichever branch preserves more downstream capture).
 *   - classified confidently        -> resolved, met = the classification.
 *   - unclassifiable, budget        -> NOT resolved, reask, increment counter.
 *   - unclassifiable, budget spent  -> resolved, met = defaultMetOnExhausted.
 */
function decideYesNoStep(
  step: number,
  ctx: Record<string, unknown>,
  classification: YesNoClassification,
  defaultMetOnExhausted: boolean,
): { resolved: boolean; met: boolean; context: Record<string, unknown> } {
  const key = REASK_KEY[step]
  const prior = typeof ctx[key] === 'number' ? (ctx[key] as number) : 0

  if (!classification.ok && prior < MORNING_PARSE_REASK_CAP) {
    return { resolved: false, met: false, context: { ...ctx, [key]: prior + 1 } }
  }
  const met = classification.ok ? classification.met : defaultMetOnExhausted
  return { resolved: true, met, context: { ...ctx, [key]: 0 } }
}

/** Strips every reask key morning uses, preserving everything else (evening's
 * own keys, morning_submitted) — shared by the start-flow strip and both
 * flow-completing branches, so the three sites can't drift on which keys get
 * cleared. */
function stripReaskKeys(ctx: Record<string, unknown>): Record<string, unknown> {
  const next = { ...ctx }
  for (const key of ALL_REASK_KEYS) delete next[key]
  return next
}

/**
 * Pure mirror of apply_morning_flow_turn's decision logic. See AUTHORITY NOTE.
 */
export function dispatchMorningFlow(
  session: WhatsAppSession,
  inboundMessage: string,
  options: MorningDispatchOptions = {},
): MorningDispatch {
  const startFlow = options.startFlow ?? false
  const now = options.now ?? new Date().toISOString()
  const text = inboundMessage.trim()
  const submitted =
    session.context !== null && session.context['morning_submitted'] === true

  let outcome: MorningOutcome
  let sessionUpdate: MorningDispatch['sessionUpdate'] = {}
  let dailyLogWrite: MorningDailyLogWrite | null = null

  if (startFlow) {
    if (session.current_flow === null) {
      outcome = 'start'
      // CONTEXT DISCIPLINE (022's site 1, extended by the morning flow
      // migration): strip morning's OWN reask keys only -- was previously a
      // bare `{}` replace here, silently diverging from the SQL's own strip
      // behaviour since 022 (CLAUDE.md's "morning.ts:188 TS/SQL MIRROR
      // DIVERGENCE" entry, opened 2026-08-19) -- closed in this same pass,
      // not left as a third inconsistent pattern.
      sessionUpdate = { current_step: 1, context: stripReaskKeys(session.context ?? {}) }
    } else {
      outcome = 'reask'
    }
  } else if (session.current_flow === null) {
    outcome = submitted ? 'already_complete' : 'idle'
  } else if (session.current_flow === 'morning') {
    const ctx = session.context ?? {}
    if (text === '') {
      // Empty/whitespace: reask unlimited, no write, no budget consumed.
      outcome = 'reask'
    } else if (session.current_step === 1) {
      // Q1 Attendance. Exhausted-reask default is YES (DECIDED 2026-08-23 —
      // see decideYesNoStep's own doc and the review package's §2).
      const classification = classifyYesNo(text)
      const decided = decideYesNoStep(1, ctx, classification, true)
      if (!decided.resolved) {
        outcome = 'reask'
        sessionUpdate = { context: decided.context }
      } else if (decided.met) {
        // YES, or the exhausted-reask default.
        outcome = 'advance'
        sessionUpdate = { current_step: 2, context: decided.context }
        dailyLogWrite = { attendance: 'present' }
      } else {
        // Genuinely parsed NO -> holiday follow-up. No write yet — attendance
        // isn't known until the follow-up resolves.
        outcome = 'advance'
        sessionUpdate = { current_step: 5, context: decided.context }
      }
    } else if (session.current_step === 2) {
      // Q2 (free text) -> morning_plan, advance to Q3. Old step 1's logic,
      // moved here verbatim.
      outcome = 'advance'
      sessionUpdate = { current_step: 3 }
      dailyLogWrite = { morning_plan: text }
    } else if (session.current_step === 3) {
      // Q3 (parsed labour, workers by trade). Advance on a number, else
      // reask once then accept. Reask key renamed q2_reask -> q3_reask.
      const parse = parseLabourCount(text)
      const decided = decideParsedStep(3, ctx, isLabourAnswered(parse))
      outcome = decided.outcome
      sessionUpdate = { current_step: decided.nextStep, context: decided.context }
      if (decided.outcome === 'advance') {
        dailyLogWrite = { morning_manpower: reshapeLabourForStorage(parse) }
      }
    } else if (session.current_step === 4) {
      // Q4 (parsed equipment). Advance on none/known item, else reask once.
      // Equipment is now the LAST question -- completes the flow directly
      // (old step 4's execution-plan role is retired). Reask key renamed
      // q3_reask -> q4_reask.
      const parse = parseEquipment(text)
      const key = REASK_KEY[4]
      const prior = typeof ctx[key] === 'number' ? (ctx[key] as number) : 0
      if (!isEquipmentAnswered(parse) && prior < MORNING_PARSE_REASK_CAP) {
        outcome = 'reask'
        sessionUpdate = { context: { ...ctx, [key]: prior + 1 } }
      } else {
        const nextContext = { ...stripReaskKeys(ctx), morning_submitted: true }
        outcome = 'advance'
        sessionUpdate = { current_step: 0, context: nextContext }
        dailyLogWrite = { morning_equipment: parse, morning_submitted_at: now }
      }
    } else if (session.current_step === 5) {
      // Holiday follow-up. Exhausted-reask default stays `absent` (met=false)
      // -- unchanged direction, already correct under the same rule the
      // first time: `absent` keeps the evening trigger and PM handoff alive.
      const classification = classifyYesNo(text)
      const decided = decideYesNoStep(5, ctx, classification, false)
      if (!decided.resolved) {
        outcome = 'reask'
        sessionUpdate = { context: decided.context }
      } else {
        const attendance: 'site_holiday' | 'absent' = decided.met ? 'site_holiday' : 'absent'
        const nextContext = { ...stripReaskKeys(decided.context), morning_submitted: true }
        outcome = 'advance'
        sessionUpdate = { current_step: 0, context: nextContext }
        dailyLogWrite = {
          attendance,
          is_holiday: attendance === 'site_holiday',
          morning_submitted_at: now,
        }
      }
    } else {
      outcome = 'reask'
    }
  } else {
    // A DIFFERENT flow (evening) is active — 022 changed the RPC's ELSE branch
    // from 'idle' to 'wrong_flow' so a mis-routed turn is reported, not
    // silently swallowed. This mirror tracks that.
    outcome = 'wrong_flow'
  }

  const stepForReply = sessionUpdate.current_step ?? session.current_step
  const attendanceForReply =
    dailyLogWrite && 'attendance' in dailyLogWrite ? dailyLogWrite.attendance : null
  return {
    outcome,
    reply: buildMorningReply(outcome, stepForReply, attendanceForReply),
    sessionUpdate,
    dailyLogWrite,
  }
}

// ---------------------------------------------------------------------------
// Production write path: the thin wrapper over the single transactional RPC.
// This is the ONLY thing that writes the session/daily_logs for the morning
// flow. It performs the decision AND the writes atomically under one lock.

export interface MorningTurnResult {
  outcome: MorningOutcome
  currentFlow: SessionFlow | null
  currentStep: number
  logDate: string
  /** Echoed by the RPC only on the turns that resolve it (Q1's write, the
   * holiday follow-up's completion) — see buildMorningReply's own doc for
   * why this exists (disambiguating which of three completions occurred). */
  attendance: 'present' | 'absent' | 'site_holiday' | null
}

export async function applyMorningFlowTurn(params: {
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
}): Promise<MorningTurnResult> {
  const supabase = params.supabaseClient ?? createServiceClient()

  // Parse every possible answer shape unconditionally (pure + cheap) and hand
  // the results to the RPC, which selects the one that matches the active
  // step under its lock. This keeps parsing in TypeScript while the RPC
  // stays the single authoritative decision+write. Q1 (attendance) and the
  // holiday follow-up are the two exceptions: their yes/no classification
  // happens INSIDE apply_morning_flow_turn now (quoco_classify_yes_no,
  // 030_morning_flow_attendance.sql), not precomputed here and passed in --
  // REWORKED 2026-08-23 (review package §10). The precomputed-parse pattern
  // still applies to Q3/Q4 (a stale-read race it exists to avoid); it never
  // applied to yes/no, which has no prior read to race against, so nothing
  // is lost by classifying it on the RPC side instead.
  const manpower = parseLabourCount(params.message)
  const equipment = parseEquipment(params.message)

  const { data, error } = await supabase.rpc('apply_morning_flow_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_start_flow: params.startFlow,
    // Q3/Q4 parses: the RPC selects the one matching the active step under
    // its lock; the *_ok flags drive advance-vs-reask. The parse objects are
    // cast to Json because a concrete interface is not structurally
    // assignable to the recursive Json index type — a permanent TS
    // limitation, not a stale-types workaround.
    p_manpower: manpower as unknown as Json,
    p_manpower_ok: isLabourAnswered(manpower),
    p_equipment: equipment as unknown as Json,
    p_equipment_ok: isEquipmentAnswered(equipment),
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })

  if (error) {
    throw new Error(`apply_morning_flow_turn failed for ${params.phoneNumber}: ${error.message}`)
  }

  const result = data as {
    outcome: MorningOutcome
    current_flow: SessionFlow | null
    current_step: number
    log_date: string
    attendance: 'present' | 'absent' | 'site_holiday' | null
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    logDate: result.log_date,
    attendance: result.attendance,
  }
}
