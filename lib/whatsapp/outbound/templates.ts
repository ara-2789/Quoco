// Template selection for the outbound send primitive (Pass 1 item B). Maps
// a checkpoint + the day's daily_logs row to the exact Content SID and
// variable set to send -- the ONLY place this mapping lives, so a future
// checkpoint (nudges, Pass 2) extends this file rather than re-deriving the
// selection logic at a new call site.
//
// HX SIDs pinned from docs/reviews/whatsapp-template-submission-status.md
// -- not re-derived, not guessed.
//
// MORNING STAYS ON TEMPLATE 1, DELIBERATELY (Aravind, 2026-09-02). 1v3
// (quoco_morning_checkin_v3, HXbb534f41c814a2c3a32b5682713579df) came back
// Meta-approved as MARKETING instead of the submitted UTILITY --
// allow_category_change was exercised, and MARKETING carries a per-user
// frequency cap (2 marketing template messages / rolling 24h, enforced
// ACROSS ALL SENDERS, not just Quoco's own traffic) that UTILITY is exempt
// from. The 08:30 morning trigger is the single message the whole product
// depends on; a failure mode Quoco can neither observe in advance nor
// control is not worth trading for the improved framing line. A
// recategorisation request is filed separately (WhatsApp Manager, 60-day
// window from 2026-08-31) -- if it succeeds, repointing MORNING_CHECKIN_SID
// is its own small change at that point. Full research:
// docs/reviews/whatsapp-marketing-category-investigation.md.

/** HX Content SID for quoco_morning_checkin -- {{1}} name, {{2}} project. */
export const MORNING_CHECKIN_SID = 'HXd4a896b66bfd7b237f53dc4dca77fb76'
/** HX Content SID for quoco_evening_checkin_v3 -- {{1}} name, {{2}} project, no {{3}}. Approved UTILITY, 2026-09-02. Repoints from template 2 (which carried a {{3}} morning-plan echo) per design-decisions-beta-feedback.md §40 -- one evening template, no plan echo, no branching. */
export const EVENING_CHECKIN_SID = 'HX8fb39a251eee9bfb2ec075086cd7800a'

export interface EveningTemplateSelection {
  contentSid: string
  contentVariables: Record<string, string>
}

/**
 * Build the evening check-in template's variables. Historically this
 * function selected between two template variants depending on whether a
 * morning plan existed to quote in {{3}} (§28(s)) -- retired 2026-09-02
 * when §40 replaced both with quoco_evening_checkin_v3, which has no {{3}}
 * slot at all. Collapses to the same two-variable shape as
 * buildMorningTemplate below; kept as its own function (not merged with
 * buildMorningTemplate) because the two checkpoints remain conceptually
 * distinct call sites in trigger.ts, not because the bodies still differ.
 */
export function selectEveningTemplate(engineerName: string, projectName: string): EveningTemplateSelection {
  return {
    contentSid: EVENING_CHECKIN_SID,
    contentVariables: { '1': engineerName, '2': projectName },
  }
}

export function buildMorningTemplate(engineerName: string, projectName: string): EveningTemplateSelection {
  return {
    contentSid: MORNING_CHECKIN_SID,
    contentVariables: { '1': engineerName, '2': projectName },
  }
}
