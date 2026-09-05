import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { readCurrentFlow } from './session'
import { dispatchInboundTurn } from './dispatch'
import { EVENING_ALREADY_COMPLETE_REPLY } from './flows/evening'

// RETIRED, 2026-08-28 (docs/plans/pass1-outbound-send-plan.md §2 item 1,
// design-decisions-beta-feedback.md §38). This module used to treat an
// idle inbound as a flow-start trigger (II3 build, calling
// apply_morning_flow_turn/apply_evening_flow_turn with startFlow:true).
// It no longer does. Pass 1's outbound send primitive (items B-F, PR #120,
// #126) makes the CRON the sole flow-starter, per §28(w)'s own decided
// shape: "starting is the cron's job exclusively." Leaving this module's
// old start-on-inbound behaviour live alongside a working cron would have
// created two independent flow-starters for the same session -- the
// two-writers-for-one-fact risk this codebase's own "HAND-MIRRORED
// RECONCILIATION" history warns against.
//
// WHAT idle inbound reaches now, four cases, none of which call an RPC:
//   1. Before morningCutoff, morning not submitted -- MORNING_AWAITING_
//      TRIGGER_REPLY.
//   2. At/after morningCutoff, morning not submitted -- MORNING_WINDOW_
//      CLOSED_REPLY (this was already a static refusal; it is now
//      unconditional, since there is no RPC call left behind it to guard).
//   3. Morning submitted, evening not, before eveningSend -- EVENING_
//      WINDOW_NOT_OPEN_REPLY (same as above: already static, now
//      unconditional).
//   4. Morning submitted, evening not, at/after eveningSend -- EVENING_
//      AWAITING_TRIGGER_REPLY.
// route.ts still calls THIS in place of dispatchInboundTurn for every real
// inbound. When a flow IS already active, this still delegates straight
// through to dispatchInboundTurn, completely unchanged by retirement.
//
// ALL FOUR REPLIES ARE TEMPORARY (§38's own framing, extended to all
// four by the same reasoning as §35b already used for the two older
// ones). §28(x)'s ad-hoc menu, once built, replaces every one of them
// with a single interactive front door. None of the four is designed for
// a long lifespan.
//
// RECORD, 2026-08-28 (Aravind) -- THE POST-RETIREMENT DEAD WINDOW IS A
// LAUNCH PREREQUISITE, NOT A LIVE GAP. Between retirement shipping and
// §28(x)'s menu shipping, an idle inbound reaches ONLY the four static
// replies above -- hindrance, invoice, delivery note, and site cash
// (all Fast-Follow, CLAUDE.md §2) are unreachable via inbound at idle in
// this window, same as they already were before retirement (this module
// never routed to them; retirement does not newly close a door that was
// open). This costs nothing TODAY because NO REAL SITE ENGINEER IS ON
// THE SYSTEM until the menu exists -- the only inbound traffic this
// account receives is Aravind's own sandbox testing. The consequence is
// therefore a LAUNCH PREREQUISITE, not a live production degradation:
// §28(x)'s menu must ship before the FIRST real engineer is onboarded,
// because at that point inbound becomes his only surface for anything
// beyond answering check-in questions. Read this as gating onboarding,
// not as an outage to remediate on any particular timeline.
//
// SCOPE BOUNDARY (unchanged from the original build, restated): this
// covers ONLY the case readCurrentFlow returns null. The refuse-when-
// submitted RPC fix (design-decisions-beta-feedback.md §10, decided
// 2026-08-15) is NOT bundled here -- it trips CLAUDE.md §0(a) and ships
// separately, on its own timeline, through the full external-review path.
//
// §37(b), NAMED SO IT IS NOT REDISCOVERED HERE: an engineer who never
// submits morning at all gets MORNING_WINDOW_CLOSED_REPLY on every
// inbound for the rest of the day, on any timeline -- the evening branch
// below is only reachable when morningSubmitted is true from the start.
// Accepted, not fixed, by that entry; unchanged by this retirement pass.
// His real evening send still arrives via the cron (a separate code path
// from this file), independent of what this file echoes back to him.

function cutoffMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// (a) After-hours refusal. Checked against Rule 3.12 in the plan: two short
// sentences, no idiom, concrete ("tomorrow morning" not "later"), no
// politeness scaffolding.
export const REPORT_READY_REPLY = "Today's report is ready. Send your update tomorrow morning."

// CHECK-IN WINDOW GUARDS (2026-08-26, design-decisions-beta-feedback.md §35).
// Originally guarded an RPC call; retirement removed the call, so these are
// now unconditional for their windows -- the CHECK survives unchanged (the
// window boundary is still real), only what happens after it changed.
export const MORNING_WINDOW_CLOSED_REPLY =
  'The morning check-in window has closed for today. Your evening check-in will be sent automatically.'
export const EVENING_WINDOW_NOT_OPEN_REPLY =
  "It's not yet time for your evening check-in — it will be sent automatically."

// THE TWO STRINGS RETIREMENT ITSELF NEEDED (design-decisions-beta-
// feedback.md §38, Aravind, 2026-08-28) -- these two branches used to
// start a real flow via the RPC; retirement removes that, and these are
// what fills the resulting gap. Same register as the two guards above
// ("...will be sent automatically" / "...it comes to you automatically"),
// deliberately -- all four now read as one voice. States the fact rather
// than instructing the engineer to act: he is messaging because he
// believes he must start it himself; the copy's job is to make that
// belief unnecessary, not to correct him for holding it.
//
// ACCEPTED IMPRECISION, named honestly (§38's own text): "shortly" is
// true before that half's own trigger has fired and merely optimistic
// after it -- if he ignored the 08:30/18:30 trigger itself, nothing
// further arrives until the nudge (Pass 2, not built). Naming the actual
// clock time was considered and rejected: it hardcodes a checkpoint value
// into copy that drifts the moment CHECKIN_CHECKPOINTS changes.
export const MORNING_AWAITING_TRIGGER_REPLY =
  'Good morning. Your check-in will arrive shortly — it comes to you automatically.'
export const EVENING_AWAITING_TRIGGER_REPLY =
  'Your evening check-in will arrive shortly — it comes to you automatically.'

// §39 fix (design-decisions-beta-feedback.md §39, audit finding J,
// 2026-09-05). EVENING_AWAITING_TRIGGER_REPLY is false on a site-holiday
// day -- filterEveningRoster (lib/whatsapp/outbound/roster.ts) excludes
// attendance='site_holiday' from the evening send, so nothing is coming.
// Stated as a fact about the site, not the record ("marked as" would read
// as a database claim to a man standing on it) -- Aravind's correction,
// 2026-09-05. Does NOT extend to attendance='absent': the evening cron
// still sends for 'absent' (§37(a), a morning absence doesn't imply an
// evening one), so EVENING_AWAITING_TRIGGER_REPLY stays accurate there.
export const EVENING_SITE_HOLIDAY_REPLY = 'No evening check-in today — the site is on holiday.'

export interface InboundRouteResult {
  reply: string
  /** Always null for every branch in this file's own idle handling now -- nothing here starts a flow any more. Non-null only via dispatchInboundTurn's own delegation when a flow is already active. */
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
}

/**
 * Route an inbound message: delegate to dispatchInboundTurn if a flow is
 * already active, otherwise return one of the four static idle replies.
 * See this file's own header for the full retirement history and design-
 * decisions-beta-feedback.md §§35, 38 for the copy's own reasoning.
 */
export async function routeInboundMessage(params: RouteParams): Promise<InboundRouteResult> {
  const supabase = params.supabaseClient ?? createServiceClient()
  const currentFlow = await readCurrentFlow(params.phoneNumber, supabase)

  if (currentFlow !== null) {
    // A flow is already active -- retirement does not touch this path at
    // all. The collapse below mirrors dispatchInboundTurn's own internal
    // readCurrentFlow branch (dispatch.ts) exactly, so passing it through
    // as firstFlow doesn't cost this call a second unlocked read.
    const firstFlow = currentFlow === 'evening' ? 'evening' : 'morning'
    return dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow })
  }

  // --- No active session: one of four static replies, never an RPC call --
  const now = params.now !== undefined ? new Date(params.now) : new Date()
  const ist = istParts(now)

  // After eveningClose the report has already generated (and, past
  // ownerSend, been delivered) -- nothing captured now has anywhere to
  // land today.
  if (ist.minutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.eveningClose)) {
    return { reply: REPORT_READY_REPLY, resolvedFlow: null }
  }

  const { data: log, error } = await supabase
    .from('daily_logs')
    .select('morning_submitted_at, evening_submitted_at, attendance')
    .eq('project_id', params.projectId)
    .eq('engineer_id', params.userId)
    .eq('log_date', ist.date)
    .maybeSingle<{
      morning_submitted_at: string | null
      evening_submitted_at: string | null
      attendance: 'present' | 'absent' | 'site_holiday' | null
    }>()

  if (error) {
    throw new Error(
      `routeInboundMessage daily_logs lookup failed for ${params.phoneNumber}: ${error.message}`,
    )
  }

  const morningSubmitted = log?.morning_submitted_at != null
  const eveningSubmitted = log?.evening_submitted_at != null

  if (morningSubmitted && eveningSubmitted) {
    // Both done. EVENING_ALREADY_COMPLETE_REPLY chosen over the morning
    // equivalent: evening is the temporally later, more complete signal --
    // it confirms the whole day is done, where the morning text alone
    // would leave the engineer unsure whether evening still needs doing.
    return { reply: EVENING_ALREADY_COMPLETE_REPLY, resolvedFlow: null }
  }

  if (!morningSubmitted) {
    // §37(b): this branch is reached for the rest of the day, every time,
    // for an engineer who never submits morning -- the evening branch
    // below is unreachable for him regardless of clock time. Accepted,
    // not fixed here (see this file's own header).
    if (ist.minutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.morningCutoff)) {
      return { reply: MORNING_WINDOW_CLOSED_REPLY, resolvedFlow: null }
    }
    return { reply: MORNING_AWAITING_TRIGGER_REPLY, resolvedFlow: null }
  }

  // Morning submitted, evening not. site_holiday is checked ahead of the
  // window logic below: filterEveningRoster excludes it from the evening
  // send regardless of clock time, so EVENING_AWAITING_TRIGGER_REPLY would
  // otherwise promise a message that is never coming (§39).
  if (log?.attendance === 'site_holiday') {
    return { reply: EVENING_SITE_HOLIDAY_REPLY, resolvedFlow: null }
  }

  if (ist.minutes < cutoffMinutes(CHECKIN_CHECKPOINTS.eveningSend)) {
    return { reply: EVENING_WINDOW_NOT_OPEN_REPLY, resolvedFlow: null }
  }
  return { reply: EVENING_AWAITING_TRIGGER_REPLY, resolvedFlow: null }
}
