import type { DprFacts, EquipmentItemFacts } from './schema'

// SINGLE SOURCE OF TRUTH for "will this Judgment note field's content be
// discarded at render time regardless of what the model writes" — shared
// between render.ts (enforces the not_captured guarantee AFTER a response,
// by never surfacing the model's note) and generate.ts (enforces the SAME
// boundary BEFORE the call, by removing the field from the per-call schema
// entirely, so the model cannot write a note that would only be thrown
// away). This project has hit the "hand-mirrored logic silently diverges"
// defect shape FOUR times already (CLAUDE.md §10, HAND-MIRRORED
// RECONCILIATION entry) — this file exists so there is exactly ONE place
// that decides each of these, not two copies that have to agree by
// construction and nothing else.
//
// STRUCTURAL, NOT INSTRUCTIONAL (2026-08-11, Aravind's decision, PR #51
// review): the alternative — telling the model in the prompt "this section
// is suppressed, don't write a note for it" — was explicitly rejected. This
// project already decided the arithmetic boundary is enforced at the TYPE
// level ("no field exists that can hold a number" beats "instruct the model
// not to write numbers" — schema.ts's whole Facts/Judgment design). An
// instructional fix here would be the same mistake in a new place, and it
// adds a failure mode the structural fix doesn't have: the per-call prompt
// wording and the actual Facts silently disagreeing. Removing the field
// from the schema makes the unwanted output impossible, not discouraged.

export function isManpowerNoteDiscarded(manpower: DprFacts['manpower']): boolean {
  if (manpower.suppressed) return true
  return (
    manpower.headcount.status === 'not_captured' &&
    manpower.productive_count.status === 'not_captured' &&
    manpower.idle_count.status === 'not_captured'
  )
}

export function isScheduleNoteDiscarded(schedule: DprFacts['schedule']): boolean {
  if (schedule.suppressed) return true
  // schedule_miss_reason_note is only ever rendered when schedule_met ===
  // false (render.ts's own line: `schedule_met === false ? note : ''`).
  // schedule_met === null is genuinely not_captured — nobody answered — so
  // the note has nothing to explain, same shape as the other not_captured
  // cases here.
  //
  // schedule_met === true is DELIBERATELY NOT covered by this function: the
  // plan was met, so a miss-reason note is contextually irrelevant and
  // render.ts discards it too — but that is a different condition from
  // suppressed-or-not_captured (Facts has a real, known answer; there's
  // just nothing to say). Out of scope for the rule this file implements —
  // flagged as a related, separate, unimplemented finding in the PR that
  // added this file, not folded in here without a decision on it.
  return schedule.schedule_met === null
}

export function isEquipmentItemNoteDiscarded(item: EquipmentItemFacts): boolean {
  if (item.suppressed) return true
  return item.available_hours.status === 'not_captured' && item.actual_hours.status === 'not_captured'
}
