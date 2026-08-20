import type { SupabaseClient } from '@supabase/supabase-js'
import { readCurrentFlow } from './session'
import { applyMorningFlowTurn, buildMorningReply } from './flows/morning'
import type { MorningOutcome } from './flows/morning'
import { applyEveningFlowTurn, buildEveningReply } from './flows/evening'
import type { EveningOutcome, EquipmentEchoItem } from './flows/evening'

// Webhook-wiring deliverable named in migration 022's review package (§10).
// Implements the retry contract from that migration's own header ("call the
// OTHER rpc exactly once. Bounded by construction: one retry, never a
// loop") for ORDINARY inbound replies only -- starting a flow is a separate,
// explicit directive and is deliberately NOT handled here. Two starters
// exist above this module, neither inside it: the env-gated test-start
// sentinel (route.ts, morning-only, deterministic smoke seeding) and, as of
// the II3 build, lib/whatsapp/inbound-start.ts's routeInboundMessage (both
// flows, real production traffic, no flag -- see that file's own header).
// design-decisions-beta-feedback.md §10 (corrected cross-reference — was
// mis-cited as §11) is the restart-semantics record this build's (b)
// submitted-check mitigates around, not fixes.
//
// THE RACE THIS EXISTS FOR: readCurrentFlow is an UNLOCKED read. Between
// that read and the chosen RPC taking its row lock, the flow can change (a
// completion, or -- once crons exist -- a scheduled trigger). The RPC
// itself is always safe regardless: it re-reads the session UNDER THE LOCK
// before writing anything, so a stale read here can mis-ROUTE a turn but
// can NEVER write wrong data (every daily_logs write is gated on the
// matching-flow branch inside the RPC). 'wrong_flow' is what a mis-routed
// call returns instead of silently doing nothing.
//
// STRUCTURALLY BOUNDED, not just by convention: this function makes AT MOST
// two RPC calls. There is no loop. A third call would require rewriting
// this function's shape, not flipping a flag or raising a counter.

// Fixed reply for the edge that was previously undefined: the SECOND call
// also returns 'wrong_flow', meaning the flow genuinely moved twice within
// one turn (vanishingly rare -- two completions/starts racing one inbound).
// Telling the engineer something and stopping is the only response that is
// safe under every failure reading: silence is the exact failure mode
// wrong_flow exists to prevent (the Twilio SID is already consumed by this
// point); a third call risks a real loop if the race is somehow sustained;
// a thrown error surfaces as a 500 the engineer never sees.
export const FLOW_RACE_REPLY =
  'Sorry, something interrupted your check-in — please resend your last message.'

type Flow = 'morning' | 'evening'

// Discriminated on `flow` so the reply builder below can narrow to the
// correct outcome type without a cast. evening carries an extra
// equipmentEcho — Q5's prompt is data-driven (024_evening_flow_q4_q5.sql),
// unlike every other step's static text; morning has no equivalent.
type Attempt =
  | { flow: 'morning'; outcome: MorningOutcome; currentStep: number }
  | {
      flow: 'evening'
      outcome: EveningOutcome
      currentStep: number
      equipmentEcho: EquipmentEchoItem[] | null
    }

interface DispatchParams {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  now?: string
  /**
   * Injected client, defaulting to createServiceClient() (today's exact
   * behaviour) when omitted — threaded through to readCurrentFlow and
   * whichever RPC wrapper attempt() calls. Same shape as
   * clearMessagingBlock's own client parameter
   * (lib/whatsapp/reactivation.ts).
   */
  supabaseClient?: SupabaseClient
  /**
   * Which flow to try FIRST. Defaults to readCurrentFlow's result (the
   * production path) when omitted. Plain data, not a hook — it only
   * selects which of the two already-hardened RPCs runs first; the RPC's
   * own locked re-read remains the sole source of truth either way, so a
   * wrong value here can waste a retry but can never write wrong data.
   * Lets a test seed a session in one flow and force dispatch to try the
   * OTHER, producing a genuine 'wrong_flow' from the real RPC with no
   * mock and no race (see test/dispatch.test.ts). Not guarded: unlike
   * onBeforeRetry below, misuse here degrades to "always retries," not to
   * arbitrary behaviour, so ordinary code review is the right level of
   * protection — same reasoning as leaving readCurrentFlow unguarded.
   * Also not purely test-scaffolding: a future caller that already knows
   * the active flow could legitimately pass this to skip the read.
   */
  firstFlow?: Flow
  /**
   * TEST-ONLY. Fired after the first RPC call returns 'wrong_flow', before
   * the retry call — lets a test deterministically move current_flow again
   * to construct the double-wrong_flow edge without a real timing race.
   *
   * route.ts MUST NEVER pass this. A test-only hook that could silently
   * reach production is exactly the kind of thing that should fail a
   * build, not rely on this comment — test/unit/dispatch.test.ts carries a
   * static source guard asserting route.ts's source contains no reference
   * to onBeforeRetry. That guard is the real protection; this comment is
   * only documentation of it.
   */
  onBeforeRetry?: () => Promise<void>
}

export interface DispatchResult {
  reply: string
  /** null only on the double-wrong_flow fallback — no flow resolved the turn. */
  resolvedFlow: Flow | null
}

async function attempt(
  flow: Flow,
  common: Omit<DispatchParams, 'onBeforeRetry'>,
): Promise<Attempt> {
  if (flow === 'morning') {
    const result = await applyMorningFlowTurn({
      phoneNumber: common.phoneNumber,
      tenantId: common.tenantId,
      userId: common.userId,
      projectId: common.projectId,
      message: common.message,
      startFlow: false,
      ...(common.now !== undefined ? { now: common.now } : {}),
      ...(common.supabaseClient !== undefined ? { supabaseClient: common.supabaseClient } : {}),
    })
    return { flow: 'morning', outcome: result.outcome, currentStep: result.currentStep }
  }

  const result = await applyEveningFlowTurn({
    phoneNumber: common.phoneNumber,
    tenantId: common.tenantId,
    userId: common.userId,
    projectId: common.projectId,
    message: common.message,
    startFlow: false,
    ...(common.now !== undefined ? { now: common.now } : {}),
    ...(common.supabaseClient !== undefined ? { supabaseClient: common.supabaseClient } : {}),
  })
  return {
    flow: 'evening',
    outcome: result.outcome,
    currentStep: result.currentStep,
    equipmentEcho: result.equipmentEcho,
  }
}

function replyFor(a: Attempt): string {
  return a.flow === 'morning'
    ? buildMorningReply(a.outcome, a.currentStep)
    : buildEveningReply(a.outcome, a.currentStep, a.equipmentEcho ?? undefined)
}

/**
 * Dispatch an ordinary (non-start) inbound turn to whichever flow is
 * currently active, retrying against the other flow exactly once if the
 * first guess turns out stale. See the module header for the full contract.
 */
export async function dispatchInboundTurn(params: DispatchParams): Promise<DispatchResult> {
  const { onBeforeRetry, firstFlow: firstFlowOverride, ...common } = params

  // Explicit if/else, deliberately not a `??`-plus-ternary one-liner: `??`
  // binds tighter than `? :`, so `firstFlowOverride ?? (await
  // readCurrentFlow(...)) === 'evening' ? 'evening' : 'morning'` would
  // silently mis-parse as `(firstFlowOverride ?? (...) === 'evening') ?
  // 'evening' : 'morning'` — a real bug caught before it shipped, not a
  // style choice.
  let firstFlow: Flow
  if (firstFlowOverride !== undefined) {
    firstFlow = firstFlowOverride
  } else {
    const current = await readCurrentFlow(common.phoneNumber, common.supabaseClient)
    // "or morning, if idle/unknown" — review package §10, item 1.
    firstFlow = current === 'evening' ? 'evening' : 'morning'
  }

  const first = await attempt(firstFlow, common)
  if (first.outcome !== 'wrong_flow') {
    return { reply: replyFor(first), resolvedFlow: first.flow }
  }

  await onBeforeRetry?.()

  const secondFlow: Flow = firstFlow === 'morning' ? 'evening' : 'morning'
  const second = await attempt(secondFlow, common)
  if (second.outcome !== 'wrong_flow') {
    return { reply: replyFor(second), resolvedFlow: second.flow }
  }

  return { reply: FLOW_RACE_REPLY, resolvedFlow: null }
}
