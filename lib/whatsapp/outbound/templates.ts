// Template selection for the outbound send primitive (Pass 1 item B). Maps
// a checkpoint + the day's daily_logs row to the exact Content SID and
// variable set to send -- the ONLY place this mapping lives, so a future
// checkpoint (nudges, Pass 2) extends this file rather than re-deriving the
// selection logic at a new call site.
//
// HX SIDs pinned from docs/reviews/whatsapp-template-submission-status.md
// (all `approved`, checked 2026-08-23) -- not re-derived, not guessed.

/** HX Content SID for quoco_morning_checkin -- {{1}} name, {{2}} project. */
export const MORNING_CHECKIN_SID = 'HXd4a896b66bfd7b237f53dc4dca77fb76'
/** HX Content SID for quoco_evening_checkin -- {{1}} name, {{2}} project, {{3}} morning plan (<=150 chars). Only ever sent when a real morning plan exists (design-decisions-beta-feedback.md §28(s)). */
export const EVENING_CHECKIN_SID = 'HX48e6eab79b422dd4351071f67827881c'
/** HX Content SID for quoco_evening_checkin_no_plan -- {{1}} name, {{2}} project, no {{3}}. Fires whenever morning_plan is null -- the never-engaged case and the attendance='absent' case, per §28(s)/§28(i)/§28(d). */
export const EVENING_CHECKIN_NO_PLAN_SID = 'HX29c10ebad1290a1787e8ef14142ef4fc'

const MORNING_PLAN_MAX_CHARS = 150

/**
 * Truncate a morning plan to the template's <=150-char limit, breaking on
 * the last word boundary before the limit and appending an ellipsis --
 * NEVER a bare mid-word slice. Decided explicitly (design-decisions-
 * beta-feedback.md §28(v), 2026-08-22): a mid-word cut is illegible, and
 * was exactly the bug found in this template's own SAMPLE value before
 * this rule was written down. Returns the string unchanged if it already
 * fits.
 */
export function truncateMorningPlan(plan: string): string {
  if (plan.length <= MORNING_PLAN_MAX_CHARS) return plan
  // Reserve 1 char for the ellipsis so the final string never exceeds the limit.
  const budget = MORNING_PLAN_MAX_CHARS - 1
  const slice = plan.slice(0, budget)
  const lastSpace = slice.lastIndexOf(' ')
  // No space at all in the budget (one very long word) -- fall back to a
  // hard cut rather than producing an empty string; still bounded by the
  // template's own limit, which is the property that actually matters.
  const boundary = lastSpace > 0 ? lastSpace : budget
  return slice.slice(0, boundary) + '…'
}

export interface EveningTemplateSelection {
  contentSid: string
  contentVariables: Record<string, string>
}

/**
 * Select the evening template variant and build its variables. Per §28(s):
 * a Meta template body is fixed at approval, so "omit the morning-plan
 * echo" (bot-flows.md:211, the free-form path's own behaviour) has no
 * template-side equivalent -- a SEPARATE template with no {{3}} slot is
 * the fix, not a filler string. `morningPlan` is `daily_logs.morning_plan`
 * for the day, exactly as read from the database -- pass null/undefined
 * for both the never-engaged case and the attendance='absent' case; this
 * function does not itself decide WHICH engineers to send to (that is
 * roster.ts's job, per §37(a) -- this function never gates on whether
 * morning was submitted, only on whether a plan STRING exists to quote).
 */
export function selectEveningTemplate(
  engineerName: string,
  projectName: string,
  morningPlan: string | null | undefined,
): EveningTemplateSelection {
  if (morningPlan == null || morningPlan.trim() === '') {
    return {
      contentSid: EVENING_CHECKIN_NO_PLAN_SID,
      contentVariables: { '1': engineerName, '2': projectName },
    }
  }
  return {
    contentSid: EVENING_CHECKIN_SID,
    contentVariables: { '1': engineerName, '2': projectName, '3': truncateMorningPlan(morningPlan) },
  }
}

export function buildMorningTemplate(engineerName: string, projectName: string): EveningTemplateSelection {
  return {
    contentSid: MORNING_CHECKIN_SID,
    contentVariables: { '1': engineerName, '2': projectName },
  }
}
