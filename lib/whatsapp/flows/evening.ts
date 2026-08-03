import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import type { SessionFlow, WhatsAppSession } from '@/lib/whatsapp/session'
import { classifyYesNo } from './parsers/lexicon'
import { parseQuantities, type QuantitiesParse } from './parsers/quantities'

// Evening check-in flow. Pass 1 ships the first three questions:
//   Q1 "Work completed + quantity"  -> daily_logs.evening_output (+ quantities)  (step 1)
//   Q2 "Plan met?"                  -> daily_logs.evening_schedule_met           (step 2, parsed)
//   Q3 "Why not?"                   -> daily_logs.evening_schedule_miss_reason   (step 3, CONDITIONAL)
// Q4 (headcount + productivity) and Q5 (equipment utilisation) are Pass 2; Q6 is
// deferred alongside morning's own unbuilt Q5/Q6 (design-decisions §9).
//
// STEP IDS ARE NOT QUESTION NUMBERS. Morning could treat current_step as the
// question number and advance with step+1. Evening cannot: Q3 only fires when
// Q2 = No, Pass 2's Q4 occupies TWO steps, and Q5 auto-skips when the morning
// equipment list is empty. Every advance below therefore assigns its next step
// explicitly. Anything that "simplifies" this into an increment breaks the
// conditional edges silently.
//
// AUTHORITY NOTE: dispatchEveningFlow below is a PURE mirror of the decision
// logic in supabase/migrations/022_evening_flow_apply_turn.sql, for unit tests
// and documentation. It is NOT authoritative — production behaviour is entirely
// determined by that RPC (which owns the row lock, the BOT-07 next-day reset,
// and the atomic session + daily_logs writes). A green dispatchEveningFlow unit
// test is not on its own proof of production correctness; the integration tests
// against apply_evening_flow_turn are.

// ---------------------------------------------------------------------------
// Outcomes. Morning's five plus 'wrong_flow' — returned when a DIFFERENT flow is
// active, so the webhook can retry against the correct RPC instead of silently
// swallowing the turn. See the migration header for why that matters.
export type EveningOutcome =
  | 'start'
  | 'advance'
  | 'already_complete'
  | 'idle'
  | 'reask'
  | 'wrong_flow'

// The in-scope step ids, in order. Pass 2 appends 4, 5, 6.
export const EVENING_STEP_ORDER: readonly number[] = [1, 2, 3]

// One reask per parsed question on an unclassifiable answer (Rule 3.5).
export const EVENING_PARSE_REASK_CAP = 1

// Context key holding Q2's reask counter. Prefixed 'e' so evening's counters can
// never collide with morning's q2_reask/q3_reask inside the SAME context object
// — both flows can run on one calendar day and the context is shared.
export const EVENING_Q2_REASK_KEY = 'e2_reask'

// Context marker set when the evening flow completes. Kept distinct from
// morning_submitted; evening MERGES this in rather than replacing the context.
export const EVENING_SUBMITTED_KEY = 'evening_submitted'

// ---------------------------------------------------------------------------
// Reply copy — the SINGLE source of question/completion text, shared by the pure
// mirror (tests) and the webhook (production, keyed off the RPC's returned
// outcome + current_step), so the two can never diverge on copy.
export const EVENING_QUESTIONS: Readonly<Record<number, string>> = {
  1: 'Evening check-in 🌇 What *work was completed* today? Add the quantity if you can — e.g. "slab concrete 120 sqm".',
  2: "Did you *meet today's plan*? Reply *yes* or *no*.",
  3: 'Got it. What *stopped the plan* being met today?',
}

export const EVENING_COMPLETE_REPLY =
  '✅ Evening check-in complete. Thanks — rest well!'

export const EVENING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's evening check-in. ✅ Nothing more needed."

// idle produces no outbound message (no active flow, nothing to say).
export const EVENING_IDLE_REPLY = ''

// wrong_flow is never rendered: the webhook retries against the other RPC and
// replies with THAT result. Present so buildEveningReply is total.
export const EVENING_WRONG_FLOW_REPLY = ''

/**
 * Build the outbound reply for a resolved turn, from the outcome and the
 * post-turn current_step. Completion is signalled by outcome 'advance' with
 * current_step 0 (the RPC resets the step to 0 when the flow completes).
 */
export function buildEveningReply(outcome: EveningOutcome, currentStep: number): string {
  switch (outcome) {
    case 'start':
      return EVENING_QUESTIONS[1]
    case 'advance':
      return currentStep === 0 ? EVENING_COMPLETE_REPLY : EVENING_QUESTIONS[currentStep]
    case 'reask':
      return EVENING_QUESTIONS[currentStep] ?? ''
    case 'already_complete':
      return EVENING_ALREADY_COMPLETE_REPLY
    case 'idle':
      return EVENING_IDLE_REPLY
    case 'wrong_flow':
      return EVENING_WRONG_FLOW_REPLY
  }
}

// ---------------------------------------------------------------------------
// Pure decision mirror. ZERO Supabase calls — computes the write AS DATA and
// returns it; never executes anything. Operates on the session snapshot it is
// GIVEN: the BOT-07 next-day reset and the row lock are the RPC's job and are
// intentionally NOT re-implemented here (a second IST-date implementation would
// only risk drifting from quoco_same_ist_day).

export type EveningDailyLogWrite = Partial<{
  evening_output: string
  evening_output_quantities: QuantitiesParse
  evening_schedule_met: boolean
  evening_schedule_miss_reason: string
  evening_submitted_at: string
}>

export interface EveningDispatch {
  outcome: EveningOutcome
  reply: string
  sessionUpdate: { current_step?: number; context?: Record<string, unknown> }
  dailyLogWrite: EveningDailyLogWrite | null
}

export interface EveningDispatchOptions {
  /** Mirrors the RPC's p_start_flow (env-gated test trigger). */
  startFlow?: boolean
  /** Instant used for evening_submitted_at; injectable so tests are deterministic. */
  now?: string
}

/**
 * Pure mirror of apply_evening_flow_turn's decision logic. See AUTHORITY NOTE.
 */
export function dispatchEveningFlow(
  session: WhatsAppSession,
  inboundMessage: string,
  options: EveningDispatchOptions = {},
): EveningDispatch {
  const startFlow = options.startFlow ?? false
  const now = options.now ?? new Date().toISOString()
  const text = inboundMessage.trim()
  const ctx: Record<string, unknown> = session.context ?? {}
  const submitted = ctx[EVENING_SUBMITTED_KEY] === true

  let outcome: EveningOutcome
  let sessionUpdate: EveningDispatch['sessionUpdate'] = {}
  let dailyLogWrite: EveningDailyLogWrite | null = null

  // Completion context: MERGE the marker and drop only evening's own counter.
  // Morning's completion REPLACES the whole context — evening must not copy
  // that, or morning_submitted would be wiped and a later inbound would read
  // 'idle' instead of 'already_complete' (scoped decision, 2026-07-28).
  const completedContext = (): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...ctx, [EVENING_SUBMITTED_KEY]: true }
    delete next[EVENING_Q2_REASK_KEY]
    return next
  }

  if (startFlow) {
    if (session.current_flow === null) {
      // Start clears only EVENING's counter; morning_submitted survives.
      const next = { ...ctx }
      delete next[EVENING_Q2_REASK_KEY]
      outcome = 'start'
      sessionUpdate = { current_step: 1, context: next }
    } else {
      outcome = 'reask'
    }
  } else if (session.current_flow === null) {
    outcome = submitted ? 'already_complete' : 'idle'
  } else if (session.current_flow === 'evening') {
    if (text === '') {
      // Empty/whitespace: reask unlimited, no write, no budget consumed.
      outcome = 'reask'
    } else if (session.current_step === 1) {
      // Q1 (free text + enrichment parse) -> output + quantities, advance to Q2.
      outcome = 'advance'
      sessionUpdate = { current_step: 2 }
      dailyLogWrite = {
        evening_output: text,
        evening_output_quantities: parseQuantities(text),
      }
    } else if (session.current_step === 2) {
      // Q2 (parsed yes/no). One reask on an unclassifiable answer, then resolve.
      const prior =
        typeof ctx[EVENING_Q2_REASK_KEY] === 'number' ? (ctx[EVENING_Q2_REASK_KEY] as number) : 0
      const classified = classifyYesNo(text)

      if (!classified.ok && prior < EVENING_PARSE_REASK_CAP) {
        outcome = 'reask' // step unchanged (2)
        sessionUpdate = { context: { ...ctx, [EVENING_Q2_REASK_KEY]: prior + 1 } }
      } else {
        // Budget spent and still unclassifiable -> NOT MET, and Q3 captures the
        // engineer's own words. See the Q2 note in migration 022 for why false
        // rather than null (evening_schedule_met is BOOLEAN; there is nowhere on
        // this step to preserve the raw text, and no confidence field exists —
        // CLAUDE.md §10 PARSER DEBT).
        const met = classified.ok ? classified.met : false
        outcome = 'advance'
        dailyLogWrite = { evening_schedule_met: met }

        if (met) {
          // Plan met -> Q3 skipped. Pass 1 ends here; Pass 2 sends this edge to
          // step 4 (Q4a) instead of completing.
          sessionUpdate = { current_step: 0, context: completedContext() }
          dailyLogWrite.evening_submitted_at = now
        } else {
          sessionUpdate = { current_step: 3, context: { ...ctx, [EVENING_Q2_REASK_KEY]: 0 } }
        }
      }
    } else if (session.current_step === 3) {
      // Q3 (free text) -> miss reason + submit, complete (step 0, marker merged).
      outcome = 'advance'
      sessionUpdate = { current_step: 0, context: completedContext() }
      dailyLogWrite = { evening_schedule_miss_reason: text, evening_submitted_at: now }
    } else {
      outcome = 'reask'
    }
  } else {
    // A DIFFERENT flow is active (morning). Report it so the caller can retry
    // against the right RPC rather than dropping the engineer's answer.
    outcome = 'wrong_flow'
  }

  const stepForReply = sessionUpdate.current_step ?? session.current_step
  return {
    outcome,
    reply: buildEveningReply(outcome, stepForReply),
    sessionUpdate,
    dailyLogWrite,
  }
}

// ---------------------------------------------------------------------------
// Production write path: the thin wrapper over the single transactional RPC.
// This is the ONLY thing that writes the session/daily_logs for the evening flow.

export interface EveningTurnResult {
  outcome: EveningOutcome
  currentFlow: SessionFlow | null
  currentStep: number
  logDate: string
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
}): Promise<EveningTurnResult> {
  const supabase = createServiceClient()

  // Parse EVERY parsed step's shape unconditionally (pure + cheap) and hand them
  // to the RPC KEYED BY STEP ID. The RPC selects the entry matching the step it
  // resolves under its lock. Sending only "the active step's parse" is not
  // possible without reading the session unlocked first, and that read can race
  // — which would feed the WRONG question's parse into a write. Morning does the
  // same thing with its two typed pairs; evening just keys them instead of
  // widening the signature toward ~18 arguments.
  const quantities = parseQuantities(params.message)
  const yesno = classifyYesNo(params.message)

  const parse = {
    '1': quantities,
    '2': { met: yesno.met },
  }
  const parseOk = {
    // Q1 is never parse-gated: the free text IS the answer, quantities are
    // enrichment. Always conclusive by construction.
    '1': true,
    '2': yesno.ok,
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
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    logDate: result.log_date,
  }
}
