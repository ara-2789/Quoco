import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { readCurrentFlow } from './session'
import { dispatchInboundTurn } from './dispatch'
import { applyHindranceFlowTurn, buildHindranceReply } from './flows/hindrance'

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
// route.ts still calls THIS in place of dispatchInboundTurn for every real
// inbound. When a flow IS already active, this still delegates straight
// through to dispatchInboundTurn, completely unchanged by any of the
// history below.
//
// ROUTER REWRITE, 2026-09-06 (ad-hoc menu PR 2, step 2;
// docs/plans/adhoc-menu-spec.md's "Idle-inbound reply, decided" section).
// The four static checkpoint-window replies this file used to export
// (MORNING_AWAITING_TRIGGER_REPLY, MORNING_WINDOW_CLOSED_REPLY,
// EVENING_WINDOW_NOT_OPEN_REPLY, EVENING_AWAITING_TRIGGER_REPLY) plus
// REPORT_READY_REPLY and EVENING_SITE_HOLIDAY_REPLY are GONE, not merely
// renamed -- per the spec's own §a/§b dated correction (2026-09-06), every
// idle inbound now gets the SAME three-line structural reply (a
// correction line, naming what the engineer's message did or didn't do; an
// optional header line, computed from today's check-in state; an action
// line, pointing at the one ad-hoc item that ships). This collapses six/
// seven distinct static strings into a composition of a handful of
// building blocks -- see computeIdleHeader/CORRECTION_LINE/ACTION_LINE
// below, and the spec's own "all five combinations in full" for the exact
// approved wording.
//
// A leading "1" in Body ALWAYS wins on whether item 1 is what happens next
// -- PRECEDENCE, DECIDED (Aravind, 2026-09-06): a site-holiday engineer or
// one past the morning cutoff still has a genuine hindrance to report; the
// header explains why no check-in is coming, never that nothing can be
// reported. See classifyAdhocInput below.
//
// WIRED, 2026-09-07 -- SUPERSEDES THE TWO PARAGRAPHS BELOW. Migration 038
// (docs/reviews/038-post-apply-probe.sql, 17/17 checks) is confirmed applied
// to prod; the "1" branch now calls applyHindranceFlowTurn(startFlow: true)
// directly, unconditionally, regardless of header state -- the interim
// placeholder (buildItem1InterimReply/ITEM1_INTERIM_LINE) is deleted, not
// kept as an unreached fallback (this project's own standing lesson from
// isHireRateTrusted: dead code left "for protection" in a path nothing
// routes to just reads as protection later, when it is not). Struck
// through below, not rewritten, per this project's own correction
// discipline -- kept for why the wiring was held back as long as it was:
// ~~Until step 4's real flow ships, "what happens next" is
// buildItem1InterimReply -- a truthful placeholder that STILL carries the
// header (corrected 2026-09-06 same day: the first draft never did,
// silently repeating the exact false-promise-by-omission shape items 2/7
// were dropped/held over).
//
// STEP 4's CODE IS WRITTEN, DELIBERATELY NOT WIRED IN YET (2026-09-07).
// lib/whatsapp/flows/hindrance.ts (applyHindranceFlowTurn) and dispatch.ts's
// Flow extension both exist and are tested, but migration 038
// (docs/reviews/038_hindrance_flow_and_collision_fix.sql) that creates
// apply_hindrance_flow_turn is NOT YET APPLIED -- it needs the full
// external-review package first (CLAUDE.md §0 condition (a): it modifies
// apply_morning_flow_turn/apply_evening_flow_turn's own live logic).
// Wiring this file's "1" branch to call applyHindranceFlowTurn NOW, before
// 038 is confirmed applied, would repeat migration 035's own named
// lockstep hazard exactly: TypeScript expecting an RPC that doesn't exist
// on the target database yet, breaking every real "1" in production the
// moment this code deploys, until the SQL separately lands. Keep calling
// buildItem1InterimReply here until 038 is confirmed applied (breadcrumb +
// probe, same discipline as every other apply this project has done) --
// then the wiring is a genuinely one-line swap, not a redesign.~~
//
// SCOPE BOUNDARY (unchanged from the original build, restated): this
// covers ONLY the case readCurrentFlow returns null. The refuse-when-
// submitted RPC fix (design-decisions-beta-feedback.md §10, decided
// 2026-08-15) is NOT bundled here -- it trips CLAUDE.md §0(a) and ships
// separately, on its own timeline, through the full external-review path.
//
// §37(b), NAMED SO IT IS NOT REDISCOVERED HERE: an engineer who never
// submits morning at all gets the morning-closed header on every idle
// inbound for the rest of the day, on any timeline -- the site-holiday and
// evening-pending states below are only reachable when morningSubmitted is
// true from the start. Accepted, not fixed, by that entry; unchanged by
// this rewrite. His real evening send still arrives via the cron (a
// separate code path from this file), independent of what this file
// echoes back to him.

function cutoffMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// --- Leading-numeral classification (docs/plans/adhoc-menu-spec.md §g) ---
//
// A STANDALONE leading digit only -- "12 bags of cement missing" must never
// match "1". The digit has to be followed by a non-digit or end-of-string;
// "12"/"10"/"123 problem" all fall through to 'unrecognized'.
//
// `ListId`-based tap detection (§g's own "check ListId first" router
// design) is DELIBERATELY NOT implemented here. No interactive list-picker
// send exists anywhere in this codebase today (plain text superseded it,
// same date -- §a/§b's dated correction) -- there is no tap for a `ListId`
// branch to ever see, and this project's own standing rule is not to build
// for a hypothetical future. The design is recorded in the spec for when a
// list-picker returns; only the Body-parsing half is real code today.
export type AdhocInputKind = 'item1' | 'item2' | 'item_reserved' | 'unrecognized'

export function classifyAdhocInput(body: string): AdhocInputKind {
  const match = body.trimStart().match(/^([0-9])(?!\d)/)
  if (!match) return 'unrecognized'
  const digit = match[1]
  if (digit === '1') return 'item1'
  if (digit === '2') return 'item2'
  if (digit >= '3' && digit <= '7') return 'item_reserved'
  return 'unrecognized' // 0, 8, 9 -- never assigned to any item
}

// --- Header (docs/plans/adhoc-menu-spec.md §a, the 5-row table -- still
// live; the list-picker delivery mechanism built around it is not) --------
export type IdleHeaderState = 'awaiting_morning' | 'morning_closed' | 'site_holiday' | 'complete' | 'none'

interface IdleHeaderParams {
  morningSubmitted: boolean
  eveningSubmitted: boolean
  attendance: 'present' | 'absent' | 'site_holiday' | null
  istMinutes: number
}

/**
 * Which of the 5 approved header states applies right now. Two judgement
 * calls made in this mapping, both flagged in the spec's own §a correction
 * rather than assumed silently:
 *  - The old REPORT_READY_REPLY condition (past eveningClose, ANY
 *    submission state) folds into 'complete' -- the approved table has no
 *    dedicated row for it, and by eveningClose the DPR has already
 *    generated; there is nothing left to contribute to today's check-in
 *    either way.
 *  - EVENING_WINDOW_NOT_OPEN_REPLY's and EVENING_AWAITING_TRIGGER_REPLY's
 *    conditions (morning submitted, evening pending, before/after
 *    eveningSend) both collapse to 'none' -- the approved table has no row
 *    for "evening pending" at all. Real information loss relative to the
 *    old six/seven static replies (whether evening is still coming vs
 *    already due is no longer surfaced), inherited from the table as
 *    approved, not introduced here.
 */
export function computeIdleHeaderState(params: IdleHeaderParams): IdleHeaderState {
  const { morningSubmitted, eveningSubmitted, attendance, istMinutes } = params

  if ((morningSubmitted && eveningSubmitted) || istMinutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.eveningClose)) {
    return 'complete'
  }

  if (!morningSubmitted) {
    return istMinutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.morningCutoff) ? 'morning_closed' : 'awaiting_morning'
  }

  // Morning submitted, evening not, and not yet past eveningClose (handled above).
  if (attendance === 'site_holiday') {
    return 'site_holiday'
  }

  return 'none'
}

const HEADER_LINE: Partial<Record<IdleHeaderState, string>> = {
  awaiting_morning: 'Your check-in will arrive shortly.',
  morning_closed: 'The morning window has closed for today.',
  site_holiday: 'Today is a site holiday, so there is nothing further to check in.',
  complete: "Today's check-in is complete.",
}

const ACTION_LINE: Record<IdleHeaderState, string> = {
  awaiting_morning: 'You can report a site hindrance now — reply 1.',
  morning_closed: 'You can still report a site hindrance — reply 1.',
  site_holiday: 'You can still report a site hindrance — reply 1.',
  complete: 'You can still report a site hindrance — reply 1.',
  none: 'You can report a site hindrance — reply 1.',
}

// --- The three fallback correction lines (adhoc-menu-spec.md, "Idle-
// inbound reply, decided" -- committed there 2026-09-06, approved in chat
// before that). Each is a FIXED string regardless of header state -- the
// original per-header variation (dropping "Nothing was recorded" to avoid
// colliding with the OLD "Site holiday recorded" header) was reverted once
// the header itself was reworded to no longer contain the word "recorded"
// at all; the collision this once avoided no longer exists. -------------
//
// SINGLE SOURCE OF TRUTH, NAMED EXPLICITLY (2026-09-06, Aravind's own
// question on PR #218): HEADER_LINE/ACTION_LINE/CORRECTION_LINE below are
// the AUTHORITATIVE copy. docs/plans/adhoc-menu-spec.md's "Idle-inbound
// reply, decided" section is a REFERENCE COPY for humans reviewing the
// decision, not the source -- same relationship bot-flows.md's own TRIGGER
// TIMES section already has with lib/daily-logs/cutoffs.ts ("this doc is a
// reference copy of that constant, not the authority; if they ever
// disagree, cutoffs.ts wins and this needs updating, not the reverse").
// Nothing enforces the two staying in sync automatically -- if this file's
// copy changes, the spec's prose needs a matching edit, never the other
// way around.
const CORRECTION_LINE: Record<Exclude<AdhocInputKind, 'item1'>, string> = {
  unrecognized: "I didn't understand that. Nothing was recorded.",
  item_reserved: "That option isn't available yet. Nothing was recorded.",
  item2:
    'Safety reporting is not available here. If someone is hurt or in danger, call your site supervisor now.',
}

export function buildIdleReply(kind: Exclude<AdhocInputKind, 'item1'>, headerState: IdleHeaderState): string {
  const lines = [CORRECTION_LINE[kind], HEADER_LINE[headerState], ACTION_LINE[headerState]]
  return lines.filter((line): line is string => line !== undefined).join('\n')
}

export interface InboundRouteResult {
  reply: string
  /** Null for every fallback branch (nothing here starts morning/evening any more -- the cron is the sole starter for those). 'hindrance' as of 2026-09-07: the item1 branch below is the one real exception, since a leading "1" genuinely does start a flow directly from idle -- see that branch's own comment for why item 1 is different from morning/evening here. Non-null otherwise only via dispatchInboundTurn's own delegation when a flow is already active. */
  resolvedFlow: 'morning' | 'evening' | 'hindrance' | null
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
 * already active, otherwise dispatch a leading "1" into item 1's flow, or
 * return the composed idle reply for everything else. See this file's own
 * header for the full history and docs/plans/adhoc-menu-spec.md's
 * "Idle-inbound reply, decided" section for the copy's own reasoning.
 */
export async function routeInboundMessage(params: RouteParams): Promise<InboundRouteResult> {
  const supabase = params.supabaseClient ?? createServiceClient()
  const currentFlow = await readCurrentFlow(params.phoneNumber, supabase)

  if (currentFlow !== null) {
    // A flow is already active -- the ad-hoc router below never runs. The
    // collapse mirrors dispatchInboundTurn's own internal readCurrentFlow
    // branch (dispatch.ts) exactly, so passing it through as firstFlow
    // doesn't cost this call a second unlocked read.
    //
    // FIXED, 2026-09-07 (migration 038's own header names this exact bug):
    // this used to collapse ANY non-'evening' currentFlow to 'morning' --
    // silently correct only because nothing has ever written current_flow=
    // 'hindrance' (or 'safety'/'invoice', SessionFlow's other pre-
    // provisioned-never-built values) until now. A real 'hindrance' session
    // would have been dispatched into applyMorningFlowTurn, which does not
    // know that flow at all.
    const firstFlow =
      currentFlow === 'evening' ? 'evening' : currentFlow === 'hindrance' ? 'hindrance' : 'morning'
    return dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow })
  }

  // --- No active session ---------------------------------------------
  // PRECEDENCE, decided: a leading "1" always wins on WHETHER item 1's
  // flow starts, regardless of check-in state -- classified here, acted on
  // immediately below via an early return. Item 1's real flow (2026-09-07)
  // needs none of this file's own daily_logs/header machinery -- it does
  // its own reads under apply_hindrance_flow_turn's own row lock, and its
  // reply never varies by header state (unlike the INTERIM placeholder
  // this superseded, which needed the header and so could not skip this
  // read -- exactly the early return that placeholder's own removed
  // comment said a future author could reintroduce here once it no longer
  // applied).
  const adhocKind = classifyAdhocInput(params.message)

  if (adhocKind === 'item1') {
    const result = await applyHindranceFlowTurn({
      phoneNumber: params.phoneNumber,
      tenantId: params.tenantId,
      userId: params.userId,
      projectId: params.projectId,
      message: params.message,
      startFlow: true,
      ...(params.now !== undefined ? { now: params.now } : {}),
      supabaseClient: supabase,
    })
    return {
      reply: buildHindranceReply(result.outcome, result.currentStep, result.wasExhausted),
      resolvedFlow: 'hindrance',
    }
  }

  const now = params.now !== undefined ? new Date(params.now) : new Date()
  const ist = istParts(now)

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

  // "Both submitted" is NOT special-cased to a bare static string here --
  // computeIdleHeaderState already maps it to 'complete', and it goes
  // through the SAME three-line composition as every other state (the
  // approved design's whole point: one structural reply, never a splinter
  // case). dispatchInboundTurn/evening.ts's own EVENING_ALREADY_COMPLETE_
  // REPLY constant is a DIFFERENT call site (a real completed-evening-turn
  // RPC outcome) and is deliberately not reused here.
  const headerState = computeIdleHeaderState({
    morningSubmitted,
    eveningSubmitted,
    attendance: log?.attendance ?? null,
    istMinutes: ist.minutes,
  })

  // adhocKind is never 'item1' here -- that case already returned above --
  // so this is exactly buildIdleReply's own declared domain, no cast
  // needed.
  return { reply: buildIdleReply(adhocKind, headerState), resolvedFlow: null }
}
