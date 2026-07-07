import { createServiceClient } from '@/lib/supabase/service'
import type { SessionFlow, WhatsAppSession } from '@/lib/whatsapp/session'

// Morning check-in flow, Pass 1 (SKELETON). Only the two free-text questions:
//   Q1 "Plan of action today"      -> daily_logs.morning_plan     (step 1)
//   Q4 "Execution method/sequence" -> daily_logs.morning_execution_plan (step 4)
// Q2/Q3 (parsing) and Q5/Q6 (multi-item + BOT-24 follow-up) are Pass 2 / Pass 3
// and will slot into MORNING_STEP_ORDER and this decision later.
//
// AUTHORITY NOTE: dispatchMorningFlow below is a PURE mirror of the decision
// logic in supabase/migrations/014_morning_flow_apply_turn.sql, for unit tests
// and documentation. It is NOT authoritative — production behaviour is entirely
// determined by that RPC (which owns the row lock, the BOT-07 next-day reset,
// and the atomic session + daily_logs writes). A green dispatchMorningFlow unit
// test is not on its own proof of production correctness; the branch
// integration tests against apply_morning_flow_turn are.

// ---------------------------------------------------------------------------
// Outcomes. The three spec'd ones plus two Pass-1 terminals:
//   reask — empty/whitespace answer to the active question (re-ask, no write).
//   idle  — inbound with no active morning flow, not yet completed today.
export type MorningOutcome =
  | 'start'
  | 'advance'
  | 'already_complete'
  | 'idle'
  | 'reask'

// The in-scope question steps for Pass 1, in order. current_step stores the
// question NUMBER currently awaited. Pass 2 inserts 2,3; Pass 3 appends 5,6.
export const MORNING_STEP_ORDER: readonly number[] = [1, 4]

// ---------------------------------------------------------------------------
// Reply copy — the SINGLE source of question/completion text, shared by the
// pure mirror (tests) and the webhook (production, keyed off the RPC's returned
// outcome + current_step). Keeping it here means the two never diverge on copy.
export const MORNING_QUESTIONS: Readonly<Record<number, string>> = {
  1: "Good morning! 🌞 What's your *plan of action* for today?",
  4: 'Got it. How will the work be carried out — your *execution method / sequence* for today?',
}

export const MORNING_COMPLETE_REPLY =
  '✅ Morning check-in complete. Have a productive day on site!'

export const MORNING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's morning check-in. ✅ Nothing more needed."

// idle produces no outbound message (no active flow, nothing to say).
export const MORNING_IDLE_REPLY = ''

/**
 * Build the outbound reply for a resolved turn, from the outcome and the
 * post-turn current_step. Used by BOTH the pure mirror and the webhook so reply
 * copy is single-sourced. Completion is signalled by outcome 'advance' with
 * current_step 0 (the RPC resets the step to 0 when Q4 completes the flow).
 */
export function buildMorningReply(outcome: MorningOutcome, currentStep: number): string {
  switch (outcome) {
    case 'start':
      return MORNING_QUESTIONS[1]
    case 'advance':
      return currentStep === 0 ? MORNING_COMPLETE_REPLY : MORNING_QUESTIONS[currentStep]
    case 'reask':
      return MORNING_QUESTIONS[currentStep] ?? ''
    case 'already_complete':
      return MORNING_ALREADY_COMPLETE_REPLY
    case 'idle':
      return MORNING_IDLE_REPLY
  }
}

// ---------------------------------------------------------------------------
// Pure decision mirror. ZERO Supabase calls — computes the write AS DATA and
// returns it; never executes anything. Operates on the session snapshot it is
// GIVEN: the BOT-07 next-day reset and the row lock are the RPC's job and are
// intentionally NOT re-implemented here (a second IST-date implementation would
// only risk drifting from quoco_same_ist_day). Tests construct sessions that
// represent the already-normalised state.

export type MorningDailyLogWrite = Partial<{
  morning_plan: string
  morning_execution_plan: string
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
      sessionUpdate = { current_step: 1, context: {} }
    } else {
      outcome = 'reask'
    }
  } else if (session.current_flow === null) {
    outcome = submitted ? 'already_complete' : 'idle'
  } else if (session.current_flow === 'morning') {
    if (text === '') {
      outcome = 'reask'
    } else if (session.current_step === 1) {
      // Q1 -> store morning_plan, advance to Q4.
      outcome = 'advance'
      sessionUpdate = { current_step: 4 }
      dailyLogWrite = { morning_plan: text }
    } else if (session.current_step === 4) {
      // Q4 -> store execution plan + submit, complete (step 0, marker set).
      outcome = 'advance'
      sessionUpdate = { current_step: 0, context: { morning_submitted: true } }
      dailyLogWrite = { morning_execution_plan: text, morning_submitted_at: now }
    } else {
      outcome = 'reask'
    }
  } else {
    // Non-morning flow active — not this function's concern in Pass 1.
    outcome = 'idle'
  }

  const stepForReply = sessionUpdate.current_step ?? session.current_step
  return {
    outcome,
    reply: buildMorningReply(outcome, stepForReply),
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
}): Promise<MorningTurnResult> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('apply_morning_flow_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_start_flow: params.startFlow,
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
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    logDate: result.log_date,
  }
}
