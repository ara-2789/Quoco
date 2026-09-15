import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/types/database'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { istParts } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS } from '@/lib/daily-logs/cutoffs'
import { readCurrentFlow, claimMediaNudge } from './session'
import { dispatchInboundTurn } from './dispatch'
import { applyHindranceFlowTurn, buildHindranceReply } from './flows/hindrance'
import { MEDIA_NUDGE_REPLY, MEDIA_NUDGE_PROGRESS_LINE, MEDIA_NUDGE_WINDOW_SECONDS, type MediaItem } from './media-reply'
import { buildMorningReply, buildMorningCompleteReply } from './flows/morning'
import { buildEveningReply, buildEveningCompleteReply, fetchMorningEquipmentEcho } from './flows/evening'
import { enqueueJob } from '@/lib/queue/jobs'
import {
  resolveDailyLogId,
  resolveOrCreateDailyLogId,
  countReceivedPhotos,
  type MediaIngestJobPayload,
} from '@/lib/media/ingest'
import { countReceivedHindrancePhotos, type HindranceMediaIngestJobPayload } from '@/lib/media/hindrance-ingest'

// APPROVED COPY (Aravind, 2026-09-13, stage 1 post-build review) -- used
// ONLY when a photo could not be accepted at all (resolveOrCreateDailyLogId
// itself failed to create/find a daily_logs row for it to attach to). This
// is a DIFFERENT failure from a background media_ingest job failing AFTER
// acceptance (lib/media/ingest.ts's markMediaIngestFailed): that one is
// silent to the engineer (he has moved on by the time it resolves) and
// surfaces to the PM at stage 5 instead. This one fires immediately, in the
// same turn, because the photo never made it into the queue at all. The two
// must never be merged into one handler. Tamil pair is owed and NOT
// approved -- do not invent one.
export const PHOTO_SAVE_FAILED_REPLY = "Sorry, I couldn't save that photo. Please send it again."

// APPROVED COPY (Aravind, 2026-09-14, item 12 reversal) -- prepended to the
// re-asked question ONLY when the photo carried a caption. A captioned
// photo now takes the exact same "reask, don't call the RPC" path an
// uncaptioned one already did (item 23) -- but the two are NOT given
// identical reply text: an engineer who typed something needs to be told
// his text was saved as a caption, not recorded as an answer, or he may
// reasonably assume it already counted. An uncaptioned photo has no text
// to explain away, so it keeps item 23's own unchanged bare reask (locked
// in by test/webhook.test.ts's T-WH-13) -- this prefix is additive to the
// captioned case specifically, not a rewrite of the existing one. Tamil
// pair is owed and NOT approved -- do not invent one.
//
// SCOPED EXCEPTION, 2026-09-15 (live prod finding): this prefix does NOT
// fire at the hindrance flow's Q3 photo question. That question's own
// answer IS photos -- "type your reply" reads as "your photos didn't
// count," which is backwards for the one question where sending photos IS
// the expected action. handleHindrancePhoto below replies with a running
// photo-count acknowledgement instead (buildHindrancePhotoAck) -- items 12
// and 23 ("a caption/photo is never an answer") are UNCHANGED even here: a
// caption at Q3 is still stored on the photo row, still never parsed as an
// answer. Only the REPLY TEXT for this one question is different; morning,
// evening, and every other hindrance step keep this prefix exactly as
// before (locked in by test/media-ingest.test.ts).
export const PHOTO_SAVED_REASK_PREFIX = 'Photo saved. Type your reply for this question.'

// APPROVED COPY (Aravind, 2026-09-14, stage 2). Used ONLY for a photo
// arriving during the hindrance flow's Q1 or Q2 -- before the hindrances
// row exists (migration 044's own row-creation timing, unchanged from
// 038: the row is inserted atomically at Q2's resolution, not before).
// DECIDED: no session buffering (docs/plans/stage2-hindrance-photos-
// plan.md "DECISIONS" item 1) -- such a photo is NOT stored at all, the
// engineer is told, and the question re-asks. This narrows item 11
// ("photos at any question") for the hindrance flow specifically -- a
// scoped exception, not a general reversal; Q3 and later still store
// normally (PHOTO_SAVED_REASK_PREFIX above). Tamil pair is owed and NOT
// approved -- do not invent one.
export const HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY =
  "Photo not saved yet. Answer the question, and I'll ask for photos at the end."

// STAGE 1 OF THE MEDIA CAPABILITY (2026-09-13, docs/plans/media-capture-
// design.md item 20; full build: docs/plans/stage1-photo-intake-plan.md).
// THIS FILE IS WHERE THE MEDIA INTERCEPTOR MOVES TO (item 18) -- previously
// media-reply.ts intercepted a photo unconditionally, upstream, before this
// module ever ran (see that file's own header for the full reversal). Photo
// handling now lives here specifically because it needs flow state
// (current_flow, and for a no-caption photo, current_step too) that the old
// upstream placement deliberately did not have. Voice is UNCHANGED --
// route.ts still intercepts it unconditionally, upstream, exactly as
// before; a MediaItem[] never reaches this file for a voice note.
//
// THE MECHANISM, both branches below:
//   - Idle (no active flow): STALE ABOVE, CORRECTED HERE (stage 3 shipped) --
//     see handleIdlePhoto's own doc, below, for the real mechanism: a photo
//     at idle no longer gets a reply on every arrival. claim_media_nudge
//     (migration 045, HELD -- not applied to any database yet; see
//     docs/reviews/045-review-brief.md) throttles it to one nudge+menu reply
//     per MEDIA_NUDGE_WINDOW_SECONDS-second window per phone number; any
//     further idle photo inside that window gets NO reply at all (empty
//     TwiML, via route.ts's own `reply === '' ? twimlEmpty() : ...`).
//     Checked BEFORE classifyAdhocInput, so the ad-hoc router never sees raw
//     media params -- unchanged from before stage 3, only what happens once
//     isPhoto is true has changed.
//   - Active flow, morning/evening: the photo is enqueued as a
//     `media_ingest` job (storage happens in the background, never inline
//     -- item 4, caption included on the payload either way), then the
//     current question stays open and is re-asked, WITHOUT calling the RPC
//     at all -- REGARDLESS of whether a caption was present. This is not a
//     stylistic choice -- apply_morning_flow_turn's step 2 and
//     apply_evening_flow_turn's step 1 have ZERO gating on an empty answer
//     and would otherwise silently record an empty string and ADVANCE
//     (confirmed against the live SQL, docs/plans/stage0-storage-setup-
//     plan.md §8.2) -- exactly the gap item 23 exists to close. Calling the
//     RPC here would reopen it.
//
//     ITEM 12 REVERSED (Aravind, 2026-09-14, first real-use finding, not a
//     design refinement -- see docs/plans/media-capture-design.md's own
//     struck-through item 12 for the full incident). Item 12 ORIGINALLY let
//     a non-empty caption reach the answer parser as if typed text -- a
//     real prod incident showed this was wrong: an engineer captioned a
//     photo "Today work" while evening Q5 ("anything extra needed
//     tomorrow?") was open, and that caption was recorded as the Q5
//     answer, silently discarding the engineer's real answer ("No"), sent
//     moments later after the flow had already closed. A CAPTION IS NEVER
//     AN ANSWER: it describes the photo, not whatever question happens to
//     be open -- "Today work", "east wall", "crack near column B" are
//     captions, not answers, and no timing or fallback rule can tell a
//     caption-that-answers apart from a caption-that-describes (a fallback
//     keyed on "no answer recorded yet" would have produced this exact bad
//     data, since the field WAS empty). CONSEQUENCE, stated plainly: with
//     items 12 and 23 both now in force the SAME way, ANY message carrying
//     a photo never answers a question, captioned or not -- only a
//     text-only message can. Nothing carried on a photo can reach a DPR
//     field. The standalone evening photo Q2 does NOT remove this risk:
//     item 11 accepts photos at ALL questions by deliberate decision, so a
//     captioned photo at any step remains possible by design.
//   - Active flow, hindrance: STALE ABOVE, CORRECTED HERE (stage 2 shipped,
//     migration 044) -- see handleHindrancePhoto's own doc, below, for the
//     real mechanism: a photo at Q1/Q2 (no hindrance_id yet) is rejected
//     with HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY, not the generic idle nudge
//     above (unchanged by stage 3 -- this reply is unaffected); a photo at
//     Q3 (hindrance_id already known) is stored, same as
//     morning/evening -- but STALE AGAIN, CORRECTED 2026-09-15: the REPLY
//     text at Q3 is NOT "same as morning/evening" any more. A live prod
//     finding showed Q3 is the one question whose answer IS photos, so
//     re-asking the question (or morning/evening's own PHOTO_SAVED_REASK_
//     PREFIX, which reads as "type an answer") both read as "that didn't
//     work" to an engineer who just sent exactly what was asked for. Q3
//     now replies with a running photo-count acknowledgement instead
//     (buildHindrancePhotoAck) and is closed by the engineer himself
//     ("done", or "none" if he sent nothing) -- see handleHindrancePhoto's
//     own doc for the full mechanism. This is a SCOPED EXCEPTION at this
//     one question: items 12/23 ("a caption/photo is never an answer")
//     are UNCHANGED, everywhere, including here.

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

// Extracted, stage 3 -- the "live idle menu" (header line + action line,
// with no correction line) that both the ordinary idle reply below AND the
// new idle-photo nudge (handleIdlePhoto) compose their reply from. A photo
// has no AdhocInputKind (its caption is never classified -- item 12), so it
// cannot use buildIdleReply's own CORRECTION_LINE lookup; this is exactly
// the subset it needs. buildIdleReply itself is rewritten below, in terms of
// this function, to guarantee the two never drift -- same HEADER_LINE/
// ACTION_LINE values compose identically in both places.
export function buildIdleMenu(headerState: IdleHeaderState): string {
  const lines = [HEADER_LINE[headerState], ACTION_LINE[headerState]]
  return lines.filter((line): line is string => line !== undefined).join('\n')
}

export function buildIdleReply(kind: Exclude<AdhocInputKind, 'item1'>, headerState: IdleHeaderState): string {
  return [CORRECTION_LINE[kind], buildIdleMenu(headerState)].join('\n')
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
  /**
   * Whether route.ts's classifyMediaReply resolved this message as a
   * PHOTO (never voice -- that's intercepted upstream, unconditionally,
   * unchanged). This is the ONLY signal the idle/hindrance canned-reply
   * branches use -- see media's own doc below for why `media.length > 0`
   * is NOT an equivalent check and using it there was a real regression
   * (T-WH-14, fixed 2026-09-13).
   */
  isPhoto?: boolean
  /** Photo items EXTRACTED from this inbound message (stage 1, item 18) --
   * populated by route.ts's extractMediaItems ONLY when isPhoto is true.
   * Can be EMPTY even when isPhoto is true (extractMediaItems drops any
   * MediaUrl{i} entry that's missing; real Twilio always supplies one for
   * a real photo, but nothing here assumes that). Used ONLY by the
   * morning/evening active-flow storage path below, which genuinely needs
   * real extractable items -- never for the idle/hindrance classification
   * decision, which uses isPhoto instead. */
  media?: MediaItem[]
  /** Injected client, defaulting to createServiceClient() when omitted -- same shape as every other flow entry point. */
  supabaseClient?: SupabaseClient
}

// APPROVED COPY (Aravind, 2026-09-15, live prod finding -- see this
// module's own header, the "Active flow, hindrance" section, and
// handleHindrancePhoto's own doc below for the full incident). The reply
// to EVERY photo received at the hindrance flow's Q3, captioned or not --
// replaces both the bare re-ask and PHOTO_SAVED_REASK_PREFIX at this one
// question, which is a SCOPED EXCEPTION, not a general reversal (see
// PHOTO_SAVED_REASK_PREFIX's own header). `count` is cumulative for this
// hindrance, THIS photo included. Singular/plural must stay correct --
// "1 photo saved", never "1 photos saved". Tamil pair is owed and NOT
// approved -- do not invent one.
export function buildHindrancePhotoAck(count: number): string {
  return `${count} photo${count === 1 ? '' : 's'} saved. Send more, or reply done.`
}

/**
 * Handle a photo arriving during an active hindrance flow (stage 2,
 * migration 044) -- called only when `media.length > 0`, from
 * routeInboundMessage's own active-flow branch below.
 *
 * Reads the session's `current_step` directly, WITHOUT calling
 * apply_hindrance_flow_turn -- same "a photo never reaches the RPC"
 * mechanism already live for morning/evening (item 23): the RPC has zero
 * gating on several of its own steps, and a photo's caption must never be
 * treated as a typed answer regardless.
 *
 * - Step 1 or 2 (the hindrances row does not exist yet): DECIDED,
 *   2026-09-14 (docs/plans/stage2-hindrance-photos-plan.md "DECISIONS"
 *   item 1) -- no buffering. The photo is NOT stored. The engineer is
 *   told (HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY) and the question re-asks.
 * - Step 3 (the row exists): the photo is enqueued as a
 *   `hindrance_media_ingest` job -- a photo is still never an answer here
 *   (items 12/23 unchanged): the caption, if any, is stored on the photo
 *   row only, never parsed. What CHANGED, 2026-09-15 (live prod finding,
 *   docs/reviews/hindrance-q3-photo-ack-fix.md): the REPLY is no longer
 *   the re-asked question (with or without PHOTO_SAVED_REASK_PREFIX for a
 *   caption) -- both read as "that didn't work" for the one question
 *   whose actual answer IS photos. It is now a running photo-count
 *   acknowledgement (buildHindrancePhotoAck), cumulative for this
 *   hindrance across however many photo turns arrive. The engineer closes
 *   the question himself: "done" completes it; "none" completes it too,
 *   identically, whether zero photos or several have already been sent --
 *   this handler never deletes a `hindrance_photos` row or its ingest
 *   job, so there is no discard path to accidentally reintroduce by
 *   changing which word ends up meaning what.
 */
async function handleHindrancePhoto(
  params: RouteParams & { media: MediaItem[] },
  supabase: SupabaseClient,
): Promise<InboundRouteResult> {
  // CHANGED, external review round 2 (S1, fold-and-return, 2026-09-14):
  // selects `context` alongside `current_step` now, in the SAME query --
  // this is what lets hindrance_id be read directly off the session row
  // instead of resolved via a separate lookup. Net queries this function
  // issues for a step-3 photo: ONE session read, same as before this
  // fix -- resolveMostRecentHindranceId's own query is gone entirely, not
  // replaced by a different one.
  const { data: sessionRow, error: sessionError } = await supabase
    .from('whatsapp_sessions')
    .select('current_step, context')
    .eq('phone_number', params.phoneNumber)
    .maybeSingle<{ current_step: number; context: Record<string, unknown> | null }>()
  if (sessionError) {
    throw new Error(`handleHindrancePhoto: session read failed for ${params.phoneNumber}: ${sessionError.message}`)
  }

  if (!sessionRow) {
    // Session vanished between the currentFlow read above and here (a
    // genuine race -- completion/expiry mid-request), same fallback
    // morning/evening's own identical branch already uses.
    return dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow: 'hindrance' })
  }

  if (sessionRow.current_step === 1 || sessionRow.current_step === 2) {
    return { reply: HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY, resolvedFlow: 'hindrance' }
  }

  if (sessionRow.current_step !== 3) {
    // Genuinely unreachable in production for an active hindrance session
    // -- falls through to ordinary dispatch rather than asserting, same
    // defensive posture as the rest of this file.
    return dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow: 'hindrance' })
  }

  // Step 3: the hindrances row exists, and its id was stamped into this
  // SAME session's context at the exact turn it was created (migration
  // 044's own apply_hindrance_flow_turn, Q2's resolution). Read directly,
  // no lookup.
  //
  // DELETED, external review round 2 (S1, 2026-09-14): this used to
  // resolve hindranceId via a "most recent hindrance for this reporter"
  // lookup (resolveMostRecentHindranceId, lib/hindrance/pm-notify.ts).
  // The reviewer's finding: that lookup's own safety argument fenced only
  // the writer that exists TODAY (this flow) -- it said nothing about a
  // future one, and one is already named in this project's own artifacts
  // (DASH-10, the unbuilt hindrance-editing dashboard surface, cited in
  // 039's own grant commentary). The moment any PM/dashboard path ever
  // inserts a hindrance for the same reporter mid-session, "most recent"
  // would silently attach this session's photos to the WRONG row -- no
  // constraint fires, evidence photos cross-attributed on an owner-visible
  // record. The SAME shape as the `wasExhausted` bug this migration
  // already found and fixed internally, one layer up: re-deriving from
  // adjacent state a fact the system already established, on an earlier
  // turn, instead of carrying it forward. The heuristic is deleted, not
  // fenced -- carrying the id forward removes the whole class of risk
  // rather than narrowing when it can fire.
  const hindranceId =
    typeof sessionRow.context?.hindrance_id === 'string' ? sessionRow.context.hindrance_id : null
  if (!hindranceId) {
    // Genuinely unreachable if current_step===3 (the row is inserted, and
    // its id stamped into context, in the same RPC call that advances to
    // step 3) -- treated the same as PHOTO_SAVE_FAILED_REPLY's own "never
    // accepted" case rather than asserting.
    return { reply: PHOTO_SAVE_FAILED_REPLY, resolvedFlow: 'hindrance' }
  }

  const hasCaption = params.message.trim().length > 0

  const jobPayload: HindranceMediaIngestJobPayload = {
    tenant_id: params.tenantId,
    hindrance_id: hindranceId,
    caption: hasCaption ? params.message : null,
    media: params.media,
  }
  await enqueueJob('hindrance_media_ingest', jobPayload as unknown as Json, supabase)

  const { error: statusError } = await supabase
    .from('hindrances')
    .update({ photos_status: 'pending' })
    .eq('id', hindranceId)
  if (statusError) {
    throw new Error(
      `handleHindrancePhoto: failed to set photos_status='pending' for hindrance ${hindranceId}: ${statusError.message}`,
    )
  }

  // 2026-09-15 fix: no longer buildHindranceReply('reask', 3) (with or
  // without PHOTO_SAVED_REASK_PREFIX) -- see this function's own header
  // and PHOTO_SAVED_REASK_PREFIX's own header for why that read as failure
  // to an engineer sending exactly what Q3 asked for. The count is
  // cumulative across every hindrance_media_ingest job enqueued for this
  // hindrance so far, THIS one included (it was just enqueued above).
  const photoCount = await countReceivedHindrancePhotos(hindranceId, supabase)
  return {
    reply: buildHindrancePhotoAck(photoCount),
    resolvedFlow: 'hindrance',
  }
}

/**
 * Extracted, stage 3 -- the SAME daily_logs lookup + computeIdleHeaderState
 * call that routeInboundMessage's own bottom section (the ordinary idle
 * reply) already did inline, pulled out so handleIdlePhoto (below) can reuse
 * it without duplicating the query. Behaviour is byte-identical to what
 * routeInboundMessage did inline before this extraction -- same fields
 * selected, same computeIdleHeaderState call, same error message shape.
 */
async function resolveIdleHeaderState(
  params: Pick<RouteParams, 'projectId' | 'userId' | 'phoneNumber' | 'now'>,
  supabase: SupabaseClient,
): Promise<IdleHeaderState> {
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

  return computeIdleHeaderState({
    morningSubmitted,
    eveningSubmitted,
    attendance: log?.attendance ?? null,
    istMinutes: ist.minutes,
  })
}

/**
 * Handle a photo arriving at idle (no active flow) -- stage 3
 * (docs/plans/media-capture-design.md's stage 3 entry; migration 045, HELD,
 * not applied to any database yet -- see docs/reviews/045-review-brief.md).
 * Called only when params.isPhoto is true and readCurrentFlow returned null;
 * the caption, if any, is IGNORED ENTIRELY here (item 12's own "a photo is
 * never an answer" extends to "a photo's caption never drives idle routing
 * either" -- classifyAdhocInput is never called for a photo, so a photo
 * captioned "1" never starts the hindrance flow the way a bare text "1"
 * would).
 *
 * The photo itself is NEVER STORED and NEVER PARKED for later (item 6,
 * unchanged) -- there is no active flow's daily_log_id or hindrance_id for
 * it to attach to, and stage 3 does not introduce one. This function's only
 * job is deciding whether to SPEAK.
 *
 * ORDER, REVIEWED AND FIXED (external review, migration 045, folded
 * 2026-09-15): resolveIdleHeaderState runs FIRST, claimMediaNudge SECOND --
 * not the reverse. If resolveIdleHeaderState throws, the error propagates
 * exactly as it already does for the ordinary (non-photo) idle reply
 * (routeInboundMessage's own bottom section calls the same helper with no
 * try/catch of its own) -- claimMediaNudge is NEVER CALLED in that case, so
 * NO NUDGE SLOT IS CONSUMED. Doing it the other way around -- claim first,
 * look up the header second -- would mean a header-lookup failure silences
 * the engineer for a full MEDIA_NUDGE_WINDOW_SECONDS: the throttle would
 * already have recorded a successful nudge (the RPC call itself did not
 * fail) even though no reply ever went out, and every FURTHER idle photo in
 * that window would be throttled into silence on top of the first one that
 * already got nothing. That is FAIL-CLOSED SILENCE -- the reviewer's own
 * finding was that this is the wrong direction, for the identical reason
 * the RPC-error case below fails OPEN rather than silent: an engineer
 * getting no reply at all is indistinguishable, from his side, from a
 * broken bot, and is strictly worse than one extra message or one
 * legitimately-thrown error surfacing.
 *
 * claim_media_nudge (migration 045) throttles the reply to once per
 * MEDIA_NUDGE_WINDOW_SECONDS-second window per phone number, called only
 * once the header is already known to be resolvable:
 *   - true  (first photo in the window): reply is MEDIA_NUDGE_REPLY, then
 *     MEDIA_NUDGE_PROGRESS_LINE, then the live idle menu (buildIdleMenu) --
 *     three lines, always in that order.
 *   - false (any further photo inside the window): NO reply at all -- an
 *     empty string, which route.ts's own `reply === '' ? twimlEmpty() : ...`
 *     turns into `<Response></Response>`, so Twilio delivers nothing.
 *
 * FAIL OPEN on the RPC call itself, deliberately (Aravind's own
 * instruction, this stage, unchanged by the reorder above): if
 * claimMediaNudge throws (a Postgres/network error), this is logged to
 * Sentry and the function falls back to the SAME three-line nudge+menu
 * reply the `true` case sends -- never to silence. Same reasoning as the
 * ordering fix above, applied to a different failure point: an engineer who
 * gets one extra nudge message he didn't strictly need is a minor
 * annoyance; an engineer who gets no reply at all because the throttle
 * check happened to fail looks, from his side, identical to a broken bot.
 */
async function handleIdlePhoto(params: RouteParams, supabase: SupabaseClient): Promise<InboundRouteResult> {
  // FIRST: resolve the header. Uncaught on purpose -- a failure here
  // propagates exactly like the ordinary idle reply's own unguarded call to
  // the same helper, and claimMediaNudge below is never reached, so no
  // throttle slot is consumed by a turn that never spoke.
  const headerState = await resolveIdleHeaderState(params, supabase)

  // SECOND: the throttle check. Only reached once the header is already
  // known to be resolvable.
  let claimed: boolean
  try {
    claimed = await claimMediaNudge({
      phoneNumber: params.phoneNumber,
      tenantId: params.tenantId,
      userId: params.userId,
      windowSeconds: MEDIA_NUDGE_WINDOW_SECONDS,
      ...(params.now !== undefined ? { now: params.now } : {}),
      supabaseClient: supabase,
    })
  } catch (err) {
    Sentry.captureException(err, {
      fingerprint: ['media-nudge-throttle', 'claim_media_nudge_failed'],
      tags: { feature: 'media-nudge-throttle' },
      extra: { phoneNumber: params.phoneNumber, tenantId: params.tenantId, projectId: params.projectId },
    })
    // Fail open -- see this function's own header for why silence is the
    // worse failure mode here. Falls straight through to the same
    // nudge+progress+menu composition the `true` branch below returns.
    claimed = true
  }

  if (!claimed) {
    return { reply: '', resolvedFlow: null }
  }

  return {
    reply: [MEDIA_NUDGE_REPLY, MEDIA_NUDGE_PROGRESS_LINE, buildIdleMenu(headerState)].join('\n'),
    resolvedFlow: null,
  }
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

    const media = params.media ?? []

    // Hindrance photo capture, stage 2 (migration 044). Needs session
    // state (current_step) to decide accept vs. reject, so it is its own
    // branch -- see handleHindrancePhoto's own doc. Only when there is
    // real media to store; the isPhoto-but-extraction-came-back-empty
    // edge case falls through to the `media.length === 0` branch below,
    // exactly like morning/evening's own identical edge case (not
    // expected to fire against real Twilio traffic).
    if (params.isPhoto && firstFlow === 'hindrance' && media.length > 0) {
      return handleHindrancePhoto({ ...params, media }, supabase)
    }

    // Deliberately keyed on the EXTRACTED media array here, not isPhoto --
    // this gate decides whether there is anything real to STORE for the
    // active morning/evening flow below, a different question from "was
    // this classified as a photo." A photo with zero extractable items
    // (isPhoto true, media empty -- the same edge case FIX above closes for
    // idle/hindrance) falls through to an ordinary dispatchInboundTurn call
    // here: there is genuinely nothing to enqueue, so it degrades to
    // whatever Body contains, same as any other message. Real Twilio always
    // supplies a MediaUrl{i} for a real photo, so this path is not expected
    // to fire in production -- named, not assumed impossible.
    if (firstFlow === 'hindrance' || media.length === 0) {
      const dispatchResult = await dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow })

      // Completion-message photo count (approved copy, TASK 3 of stage 1's
      // own build) -- MOVED HERE, 2026-09-14, item 12's reversal. Before
      // this, the count was only ever attached when THIS turn itself was a
      // captioned photo that completed the flow on dispatch -- the ONLY
      // path that ever reached dispatchInboundTurn carrying a photo. Item
      // 12's reversal removes that path entirely: a photo (captioned or
      // not) now ALWAYS reasks, never dispatches, so it can never again be
      // the turn that completes a flow. This plain-text/no-media branch is
      // therefore now the ONLY turn that can ever complete morning/evening
      // -- the accumulated photo count from earlier in the check-in has to
      // be attached here instead, or the completion message never shows a
      // count again, silently. `firstFlow !== 'hindrance'` narrows the
      // ternary below to 'morning' | 'evening', matching the type both
      // builders require.
      if (firstFlow !== 'hindrance' && dispatchResult.completed) {
        const now = params.now !== undefined ? new Date(params.now) : new Date()
        const ist = istParts(now)
        const dailyLogId = await resolveDailyLogId(
          { projectId: params.projectId, engineerId: params.userId, logDate: ist.date },
          supabase,
        )
        if (dailyLogId) {
          const photoCount = await countReceivedPhotos(dailyLogId, firstFlow, supabase)
          if (photoCount > 0) {
            const reply =
              firstFlow === 'morning' ? buildMorningCompleteReply(photoCount) : buildEveningCompleteReply(photoCount)
            return { reply, resolvedFlow: dispatchResult.resolvedFlow }
          }
        }
      }

      return dispatchResult
    }

    // --- media present, flow is morning or evening: stage 1's real work ---
    const now = params.now !== undefined ? new Date(params.now) : new Date()
    const ist = istParts(now)

    let dailyLogId = await resolveDailyLogId(
      { projectId: params.projectId, engineerId: params.userId, logDate: ist.date },
      supabase,
    )

    if (!dailyLogId) {
      // FIX (Aravind, 2026-09-13, stage 1 post-build review): a photo on
      // the very first turn of a flow arrives BEFORE any answer's own RPC
      // write has materialised the daily_logs row (the row is normally
      // created by the first ANSWER, not by the session starting) --
      // resolveDailyLogId legitimately returns null here, not an error.
      // Create the row so the photo has a parent to attach to; the
      // engineer notices nothing different. See resolveOrCreateDailyLogId's
      // own doc for why this is safe against a race with the RPC's own
      // concurrent write.
      dailyLogId = await resolveOrCreateDailyLogId(
        { tenantId: params.tenantId, projectId: params.projectId, engineerId: params.userId, logDate: ist.date },
        supabase,
      )
    }

    if (!dailyLogId) {
      // The row genuinely could not be created -- a real write failure, not
      // the ordinary "no row yet" case just handled above. THIS PATH = the
      // photo was NEVER ACCEPTED; the engineer is told immediately, with
      // the approved copy. Deliberately NOT the same failure surface as a
      // background media_ingest job failing AFTER acceptance (see
      // PHOTO_SAVE_FAILED_REPLY's own doc) -- the turn stops here rather
      // than proceeding into a dispatchInboundTurn call whose own
      // daily_logs write would very likely hit the identical failure.
      return { reply: PHOTO_SAVE_FAILED_REPLY, resolvedFlow: firstFlow }
    }

    const hasCaption = params.message.trim().length > 0

    const jobPayload: MediaIngestJobPayload = {
      tenant_id: params.tenantId,
      daily_log_id: dailyLogId,
      phase: firstFlow,
      caption: hasCaption ? params.message : null,
      media,
    }
    // Fast DB insert, well inside the webhook's 15s budget -- storage
    // itself happens later, off this request entirely (item 4). The
    // caption (if any) is stored HERE, on the photo's own job payload --
    // this is the ONLY place it is ever written down. It is never passed
    // to dispatchInboundTurn/the answer parser, below or anywhere else.
    await enqueueJob('media_ingest', jobPayload as unknown as Json, supabase)

    const statusColumn = firstFlow === 'morning' ? 'morning_photos_status' : 'evening_photos_status'
    const { error: statusError } = await supabase
      .from('daily_logs')
      .update({ [statusColumn]: 'pending' })
      .eq('id', dailyLogId)
    if (statusError) {
      throw new Error(
        `routeInboundMessage: failed to set ${statusColumn}='pending' for daily_log ${dailyLogId}: ${statusError.message}`,
      )
    }

    // Item 12 REVERSED, item 23 unchanged and now the ONLY rule: a photo is
    // never an answer, captioned or not (see this file's own header for the
    // full incident and rationale). Reask WITHOUT calling the RPC, in every
    // case -- the RPC's own lack of gating on several steps makes this the
    // only correct option, not a style preference (unchanged reasoning from
    // item 23's original build).
    const { data: sessionRow, error: sessionError } = await supabase
      .from('whatsapp_sessions')
      .select('current_step')
      .eq('phone_number', params.phoneNumber)
      .maybeSingle<{ current_step: number }>()
    if (sessionError) {
      throw new Error(
        `routeInboundMessage: session read failed for ${params.phoneNumber}: ${sessionError.message}`,
      )
    }

    if (!sessionRow) {
      // Session vanished between the currentFlow read above and here (a
      // genuine race -- completion/expiry mid-request). Fall through to
      // the normal dispatch path; its own re-read under the RPC's lock
      // is authoritative regardless of what this file assumed a moment
      // ago.
      return dispatchInboundTurn({ ...params, supabaseClient: supabase, firstFlow })
    }

    if (firstFlow === 'morning') {
      const reaskText = buildMorningReply('reask', sessionRow.current_step)
      return {
        // PHOTO_SAVED_REASK_PREFIX only when a caption was actually sent --
        // an uncaptioned photo (hasCaption false) keeps item 23's own
        // unchanged bare reask exactly as it already was (T-WH-13 locks
        // this in: no prefix when there was never any text to clarify).
        // The prefix exists specifically to tell an engineer who DID type
        // something that his text was saved as a caption, not an answer --
        // there is nothing to clarify when he typed nothing at all.
        reply: hasCaption ? `${PHOTO_SAVED_REASK_PREFIX}\n${reaskText}` : reaskText,
        resolvedFlow: 'morning',
      }
    }

    const equipmentEcho =
      sessionRow.current_step === 4
        ? await fetchMorningEquipmentEcho(supabase, {
            projectId: params.projectId,
            userId: params.userId,
            logDate: ist.date,
          })
        : null
    // Same hasCaption gate as the morning branch above -- PHOTO_SAVED_
    // REASK_PREFIX only when a caption was actually sent.
    const eveningReaskText = buildEveningReply('reask', sessionRow.current_step, equipmentEcho ?? undefined)
    return {
      reply: hasCaption ? `${PHOTO_SAVED_REASK_PREFIX}\n${eveningReaskText}` : eveningReaskText,
      resolvedFlow: 'evening',
    }
  }

  // --- No active session ---------------------------------------------
  // A bare photo at idle: STALE COMMENT REMOVED, stage 3 -- see
  // handleIdlePhoto's own doc, above, for the real mechanism (throttled
  // nudge+menu, not an unconditional PHOTO_REPLY on every arrival). Checked
  // before classifyAdhocInput, so the ad-hoc router never sees raw media
  // params, and a photo's caption never drives idle routing (item 12) --
  // unchanged from before stage 3.
  //
  // FIX (2026-09-13, T-WH-14 regression): keyed on params.isPhoto, NOT
  // media.length -- see RouteParams.isPhoto's own doc. Before this fix, a
  // photo whose extraction happened to come back empty (missing MediaUrl0
  // -- a malformed webhook, or a test fixture that only sets NumMedia/
  // MediaContentType0) silently fell through to the ad-hoc router instead
  // of getting a photo-specific reply, even though classifyMediaReply
  // correctly called it a photo. Still true under stage 3: handleIdlePhoto
  // is reached (and the ad-hoc router is skipped) purely on isPhoto, not on
  // whether any media items were actually extractable.
  if (params.isPhoto) {
    return handleIdlePhoto(params, supabase)
  }

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

  // "Both submitted" is NOT special-cased to a bare static string here --
  // computeIdleHeaderState already maps it to 'complete', and it goes
  // through the SAME three-line composition as every other state (the
  // approved design's whole point: one structural reply, never a splinter
  // case). dispatchInboundTurn/evening.ts's own EVENING_ALREADY_COMPLETE_
  // REPLY constant is a DIFFERENT call site (a real completed-evening-turn
  // RPC outcome) and is deliberately not reused here.
  //
  // EXTRACTED, stage 3: this used to be an inline daily_logs lookup +
  // computeIdleHeaderState call here -- pulled into resolveIdleHeaderState
  // (above) so handleIdlePhoto's own idle-photo nudge could reuse the exact
  // same computation without duplicating the query. No behaviour change.
  const headerState = await resolveIdleHeaderState(params, supabase)

  // adhocKind is never 'item1' here -- that case already returned above --
  // so this is exactly buildIdleReply's own declared domain, no cast
  // needed.
  return { reply: buildIdleReply(adhocKind, headerState), resolvedFlow: null }
}
