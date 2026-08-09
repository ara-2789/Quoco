import type {
  DprJudgment,
  ExecutionOutputFacts,
  ScheduleFacts,
  ManpowerFacts,
  EquipmentFacts,
  TomorrowsPlanFacts,
} from '../../schema'

// GOLDEN CASE (bot-flows.md minimum cases, list item 1: "complete
// 2-engineer day"). File names in this directory describe what a case
// tests, not its position in either bot-flows.md's list or creation order —
// two colliding numbering sequences drift; naming by content doesn't.
//
// Two engineers, Rajesh and Suresh, submit for the SAME project on the SAME
// day. This is the first case to exercise docs/design-decisions-beta-
// feedback.md §12's rollup rule directly — and the headline finding from
// deciding §12 is that "complete two-engineer day" can no longer mean "all
// five model-touched sections are 'complete'": manpower is suppressed
// UNCONDITIONALLY the moment more than one engineer submits, by design, not
// by defect. A case with this name that expected manpower_data_status ===
// 'complete' would be asserting against a rule that was deliberately
// rejected. This case's Rajesh/Suresh split is built to CLEAR every other
// suppression trigger, so the only non-'complete' section is manpower —
// isolating that §12's rule fires exactly where it should and nowhere else.
//
//   - Execution (§1): Rajesh and Suresh report DISTINCT activities. No
//     same-activity overlap → both items survive with their quantities
//     intact, execution_data_status 'complete'.
//   - Manpower (§3): both submitted → suppressed unconditionally per §12,
//     regardless of what the numbers happen to be. manpower_data_status
//     'not_captured', WITH a SuppressionNote — see the "what this does not
//     prove" block below for why that distinction matters here specifically.
//   - Equipment (§4): Rajesh and Suresh report DISTINCT machine types. No
//     same-type collision → both items survive fully, equipment_data_status
//     'complete'.
//   - Schedule (§2) / Tomorrow's Plan (§5) / Accountability (§6): unaffected
//     per §12 — not exercised further here.
//
// AGGREGATE ITEM INDEXING — PROVISIONAL, not a production decision. This
// case invents a numbering scheme because none exists yet; asserting
// against it here is asserting against a convention production hasn't
// adopted. `morning_item_index` in EquipmentItemFacts is documented
// (schema.ts) as a per-ROW join key, unique only WITHIN one engineer's own
// morning_equipment. For a two-engineer day, Rajesh's item and Suresh's
// item cannot both keep their own raw index unmodified — both could
// legitimately be "0" in their own row, which would collide exactly the way
// §12 flags for the equipment identity-resolution problem. Since this
// case's two items are DISTINCT types (no identity question to resolve),
// the choice made HERE ONLY is RENUMBERING: the aggregate assembler gives
// the merged list its own fresh 0..N-1 index (Rajesh's JCB = 0, Suresh's
// Mixer = 1), not either engineer's raw per-row number. This sidesteps §12
// without answering it — same-type collision (where renumbering alone
// isn't enough, because THEN you must know whether two same-numbered items
// are the same physical machine) is still open.
//
// WHAT WOULD INVALIDATE THIS CASE, specifically re: the indexing choice
// above: if the real aggregate assembler adopts a DIFFERENT scheme (e.g.
// composite `engineer_id:morning_item_index` keys instead of a fresh
// 0..N-1 renumbering), this case's `morning_item_index` assertions become
// meaningless and must be rewritten to match, not treated as a real
// regression. Equally, if the eventual same-type identity-resolution
// answer (§12, still open) turns out to require a uniform ID scheme applied
// to ALL items — not just colliding ones — this case's distinct-type
// renumbering would need revisiting too, since it would no longer be a
// special case of the general rule. Do not promote this into schema.ts as
// settled until one of those questions actually resolves.
//
// WHAT THIS CASE DOES NOT PROVE:
//
//   manpower_data_status === 'not_captured' proves the model correctly
//   read "more than one engineer submitted, therefore suppressed" from the
//   input and declared the right label. It does NOT prove the render-time
//   composition schema.ts documents (§12 SUPPRESSION COMPOSES WITH THIS
//   RULE) — that code, not the model, produces "reported by 2 engineers —
//   not aggregated" instead of a generic "not captured" string. This case
//   only exercises the model's DprJudgment response; the SuppressionNote
//   that would drive that render-time sentence lives in Facts, is
//   hand-constructed below, and is never sent to or returned by the model.
//   Proving the render composition itself is a separate test once a
//   render/merge function exists — not built yet, same category as the
//   generator-assembly gaps recorded against cases #2 and #6.
//
//   execution_data_status / equipment_data_status === 'complete' carries
//   the same label-vs-content caveat every prior case has documented: it
//   proves the model didn't flag a gap that isn't there, not that
//   execution_narrative's or the equipment items' idle_reason_notes are
//   accurate prose. No structural guarantee beyond the no-digit pattern
//   (equipment) and the containment check (execution narrative).

export const executionFacts: ExecutionOutputFacts = {
  quantities: [
    { activity: 'shuttering, Tower 2 grid C1', quantity: { status: 'reported', value: 8 }, unit: 'nos' },
    { activity: 'RCC column casting, Tower 2 grid C2', quantity: { status: 'reported', value: 4 }, unit: 'nos' },
  ],
}

export const scheduleFacts: ScheduleFacts = {
  schedule_met: true,
}

export const manpowerFacts: ManpowerFacts = {
  headcount: { status: 'not_captured', value: null },
  productive_count: { status: 'not_captured', value: null },
  idle_count: { status: 'not_captured', value: null },
  utilisation_pct: { status: 'not_captured', value: null },
  suppressed: { reason: 'multi_engineer_manpower', engineer_count: 2 },
}

export const equipmentFacts: EquipmentFacts = {
  items: [
    {
      // aggregate-assembly index 0 (Rajesh's row) — see the AGGREGATE ITEM
      // INDEXING note above, not Rajesh's own raw morning_item_index.
      morning_item_index: 0,
      type: 'jcb_excavator',
      available_hours: { status: 'reported', value: 8 },
      actual_hours: { status: 'reported', value: 6 },
      daily_hire_cost: { status: 'reported', value: 1500 },
      idle_cost: { status: 'reported', value: 375 }, // 1500 * (1 - 6/8)
    },
    {
      // aggregate-assembly index 1 (Suresh's row).
      morning_item_index: 1,
      type: 'concrete_mixer',
      available_hours: { status: 'reported', value: 8 },
      actual_hours: { status: 'reported', value: 8 },
      daily_hire_cost: { status: 'reported', value: 800 },
      idle_cost: { status: 'reported', value: 0 },
    },
  ],
}

export const tomorrowsPlanFacts: TomorrowsPlanFacts = {
  dependencies: [],
}

export const rawInputText = `
Project: Site A - Tower 2, 2026-08-09. TWO engineers submitted today:
Rajesh and Suresh.

Execution:
- Rajesh: shuttering, Tower 2 grid C1, 8 nos.
- Suresh: RCC column casting, Tower 2 grid C2, 4 nos.
These are DISTINCT activities on different parts of the site — report both
in full, do not combine them into one figure.

Schedule: both engineers say the plan was met.

Workers on site: Rajesh reports one figure, Suresh reports another, for the
SAME project on the SAME day. Per policy, when more than one engineer
reports manpower for one project-day, the aggregate is NOT captured — we do
not know if these are different crews (sum) or the same site estimated
twice (do not sum). Do NOT state a combined headcount or productivity
figure. Declare this section not captured.

Equipment:
- Rajesh: JCB Excavator (item 0) — available 8h, actual 6h, hire rate Rs 1500/day.
- Suresh: Concrete Mixer (item 1) — available 8h, actual 8h, hire rate Rs 800/day.
These are DIFFERENT machine types — report both in full with their own hours.

Tomorrow's dependencies: none reported.
`.trim()

export function assertCase(response: DprJudgment): string[] {
  const failures: string[] = []

  if (response.execution_data_status !== 'complete') {
    failures.push(`execution_data_status: expected 'complete' (distinct activities, no overlap), got '${response.execution_data_status}'`)
  }

  if (response.schedule_data_status !== 'complete') {
    failures.push(`schedule_data_status: expected 'complete', got '${response.schedule_data_status}'`)
  }

  if (response.manpower_data_status !== 'not_captured') {
    failures.push(
      `manpower_data_status: expected 'not_captured' (§12 — unconditional on any multi-engineer day), got '${response.manpower_data_status}'`,
    )
  }

  if (response.equipment_data_status !== 'complete') {
    failures.push(`equipment_data_status: expected 'complete' (distinct types, no collision), got '${response.equipment_data_status}'`)
  }

  if (response.equipment_items.length !== 2) {
    failures.push(`equipment_items: expected 2 items (both machines reported in full), got ${response.equipment_items.length}`)
  }

  return failures
}
