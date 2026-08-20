import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { readCurrentFlow } from './session'
import { dispatchInboundTurn, FLOW_RACE_REPLY } from './dispatch'
import { applyMorningFlowTurn, buildMorningReply } from './flows/morning'
import { applyEveningFlowTurn, buildEveningReply, EVENING_ALREADY_COMPLETE_REPLY } from './flows/evening'

// II3 build, to docs/inbound-start-trigger-plan.md. Treats an inbound message
// as a flow-start trigger when no session is active -- TS-only, no
// migration, no RPC change: calls apply_morning_flow_turn /
// apply_evening_flow_turn with the already-supported p_start_flow=true from
// a new call site, exactly the shape the env-gated test sentinel
// (lib/whatsapp/flows/test-trigger.ts, route.ts:269-293) already makes in
// production code today.
//
// route.ts calls THIS in place of dispatchInboundTurn for every real
// (non-test-sentinel) inbound. dispatch.ts's own header still correctly says
// starting a flow doesn't happen there -- this module is the "separate,
// explicit directive" that comment points at, now built. When a flow IS
// already active, this delegates straight through to dispatchInboundTurn:
// that ordinary-reply routing is completely unchanged by this build.
//
// SCOPE BOUNDARY (plan's own, restated): this covers ONLY the case
// readCurrentFlow returns null. The refuse-when-submitted RPC fix
// (design-decisions-beta-feedback.md §10, decided 2026-08-15) is NOT
// bundled here -- it trips CLAUDE.md §0(a) and ships separately, on its own
// timeline, through the full external-review path.
//
// NO ENV FLAG (JJ1(d), decided here). ENABLE_TEST_FLOW_TRIGGER is the
// precedent for gating a start-capable path behind a flag, but its own
// absence from production was itself a finding (CLAUDE.md's "NO PRODUCTION
// MECHANISM STARTS A MORNING CHECK-IN" entry) -- a flag is a config surface
// that can be silently wrong, exactly as that entry demonstrates. Weighed
// against that: this change moves an idle inbound from silence to starting
// a flow, and nobody is onboarded to production yet, so the blast radius is
// as small as it will ever be. A flag here would trade a real, present risk
// (silent misconfiguration, proven to already have happened once with this
// exact env var) for protection against a risk that is smallest right now
// and only grows once real engineers depend on this working. Ships
// unconditionally.

function cutoffMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// (a) After-hours refusal. Checked against Rule 3.12 in the plan: two short
// sentences, no idiom, concrete ("tomorrow morning" not "later"), no
// politeness scaffolding -- register matches FLOW_RACE_REPLY's plain tone
// (dispatch.ts), not the warmer *_ALREADY_COMPLETE_REPLY texts, since this is
// turning away an attempt rather than closing a flow the engineer just
// finished.
export const REPORT_READY_REPLY = "Today's report is ready. Send your update tomorrow morning."

export interface InboundRouteResult {
  reply: string
  /** null on refuse / both-done (no RPC called) as well as dispatchInboundTurn's own double-wrong_flow fallback. */
  resolvedFlow: 'morning' | 'evening' | null
}

interface RouteParams {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  now?: string
  /** Injected client, defaulting to createServiceClient() when omitted -- same shape as every other flow entry point. */
  supabaseClient?: SupabaseClient
  /**
   * TEST-ONLY. Fired after readCurrentFlow has already confirmed no flow is
   * active, immediately before the startFlow:true RPC call -- lets a test
   * move the session to a DIFFERENT flow in that exact window, constructing
   * the KK2 race (readCurrentFlow null, then a real flow becomes active
   * before the RPC's own lock) deterministically instead of waiting for a
   * genuine timing accident. Same shape and same guarantee as dispatch.ts's
   * onBeforeRetry: route.ts MUST NEVER pass this -- test/unit/inbound-
   * start.test.ts carries a static source guard asserting route.ts's source
   * contains no reference to onBeforeStart, mirroring dispatch.test.ts's own
   * guard for onBeforeRetry exactly.
   */
  onBeforeStart?: () => Promise<void>
}

/**
 * Route an inbound message: delegate to dispatchInboundTurn if a flow is
 * already active, otherwise decide whether/what to start. See
 * docs/inbound-start-trigger-plan.md (a)-(e) for the full design.
 */
export async function routeInboundMessage(params: RouteParams): Promise<InboundRouteResult> {
  const { onBeforeStart, ...rest } = params
  const supabase = rest.supabaseClient ?? createServiceClient()
  const currentFlow = await readCurrentFlow(rest.phoneNumber, supabase)

  if (currentFlow !== null) {
    // A flow is already active -- this plan does not touch this path at
    // all (see (c): inherits dispatchInboundTurn's own ELSE-reask collision
    // behaviour, NOT BOT-21's unwired pending_flows queue). The collapse
    // below mirrors dispatchInboundTurn's own internal readCurrentFlow
    // branch (dispatch.ts) exactly, so passing it through as firstFlow
    // doesn't cost this call a second unlocked read.
    const firstFlow = currentFlow === 'evening' ? 'evening' : 'morning'
    return dispatchInboundTurn({ ...rest, supabaseClient: supabase, firstFlow })
  }

  // --- No active session: decide whether/what to start -------------------
  const now = rest.now !== undefined ? new Date(rest.now) : new Date()
  const ist = istParts(now)

  // (a) After eveningClose the report has already generated (and, past
  // ownerSend, been delivered) -- nothing captured now has anywhere to land
  // today. Refuse before ever touching daily_logs or an RPC. Collapses every
  // pre-close window into one state machine keyed only on submission state
  // (below), since none of this plan's reasoning depends on which
  // pre-close window the message arrives in -- only the close boundary
  // itself changes behaviour.
  if (ist.minutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.eveningClose)) {
    return { reply: REPORT_READY_REPLY, resolvedFlow: null }
  }

  // (b) Submitted-check mitigation. Read BEFORE ever passing startFlow:
  // true. Both apply_morning_flow_turn's and apply_evening_flow_turn's own
  // start branches (022_evening_flow_apply_turn.sql:157-173,
  // 025_evening_productivity_reconciliation.sql:229-243) fire
  // unconditionally on current_flow IS NULL, with no check against the
  // submitted marker -- calling either with startFlow:true for an
  // already-submitted flow would restart it from Q1. This is TS-side
  // mitigation for that known, already-decided (design-decisions-beta-
  // feedback.md §10, 2026-08-15), NOT-YET-BUILT RPC gap -- not the fix.
  // The real closer is the refuse-when-submitted migration named there;
  // this check exists only so THIS call site never triggers the gap.
  const { data: log, error } = await supabase
    .from('daily_logs')
    .select('morning_submitted_at, evening_submitted_at')
    .eq('project_id', rest.projectId)
    .eq('engineer_id', rest.userId)
    .eq('log_date', ist.date)
    .maybeSingle<{ morning_submitted_at: string | null; evening_submitted_at: string | null }>()

  if (error) {
    throw new Error(
      `routeInboundMessage daily_logs lookup failed for ${rest.phoneNumber}: ${error.message}`,
    )
  }

  const morningSubmitted = log?.morning_submitted_at != null
  const eveningSubmitted = log?.evening_submitted_at != null

  if (morningSubmitted && eveningSubmitted) {
    // Both done. Static reply, no RPC call at all. EVENING_ALREADY_COMPLETE_
    // REPLY chosen over the morning equivalent: evening is the temporally
    // later, more complete signal -- it confirms the whole day is done,
    // where the morning text alone would leave the engineer unsure whether
    // evening still needs doing.
    return { reply: EVENING_ALREADY_COMPLETE_REPLY, resolvedFlow: null }
  }

  const commonRpcParams = {
    phoneNumber: rest.phoneNumber,
    tenantId: rest.tenantId,
    userId: rest.userId,
    projectId: rest.projectId,
    message: rest.message,
    startFlow: true,
    ...(rest.now !== undefined ? { now: rest.now } : {}),
    supabaseClient: supabase,
  }

  // KK2: readCurrentFlow already confirmed current_flow was null, above --
  // so at THIS call site (and only this one; ordinary replies never reach
  // here), outcome 'reask' is unambiguous evidence the session moved between
  // that read and the RPC's own lock (a genuine flow started in the gap).
  // Detectable with data the RPC ALREADY returns, no RPC change: 'reask'
  // from a startFlow:true call made only when current_flow was confirmed
  // null cannot mean anything else. Rendering buildMorningReply/
  // buildEveningReply against the reask outcome here would show the WRONG
  // flow's question text under that flow's current_step number (see the
  // module's git history for the traced mechanism) -- wrong-but-plausible,
  // the worst category: the engineer answers a question about the flow they
  // did not start and the data lands somewhere they did not intend, with
  // nothing that looks broken. FLOW_RACE_REPLY (dispatch.ts) already exists
  // as this codebase's answer to exactly this shape of failure -- reused
  // here, not reinvented.
  await onBeforeStart?.()

  if (!morningSubmitted) {
    const result = await applyMorningFlowTurn(commonRpcParams)
    if (result.outcome === 'reask') {
      return { reply: FLOW_RACE_REPLY, resolvedFlow: null }
    }
    return { reply: buildMorningReply(result.outcome, result.currentStep), resolvedFlow: 'morning' }
  }

  // Morning submitted, evening not -- start evening (accepted early-
  // volunteer case, plan (a) row 3: Rule 3.5's "never dead-end" outweighs
  // the risk of a slightly-early "workers on site right now" answer).
  const result = await applyEveningFlowTurn(commonRpcParams)
  if (result.outcome === 'reask') {
    return { reply: FLOW_RACE_REPLY, resolvedFlow: null }
  }
  return {
    reply: buildEveningReply(result.outcome, result.currentStep, result.equipmentEcho ?? undefined),
    resolvedFlow: 'evening',
  }
}
