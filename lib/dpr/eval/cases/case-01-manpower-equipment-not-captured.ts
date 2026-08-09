import type {
  DprJudgment,
  ExecutionOutputFacts,
  ScheduleFacts,
  ManpowerFacts,
  EquipmentFacts,
  TomorrowsPlanFacts,
} from '../../schema'

// GOLDEN CASE #1 — does the model paper over a genuine data hole with
// plausible prose instead of admitting the gap? Migration 024 built an
// entire confidence/NULL-propagation apparatus (headcount, productivity,
// equipment hours) specifically so this question is answerable. If the DPR
// prompt smooths a NULL into confident narrative, that apparatus is
// decorative. Origin: docs/design-decisions-beta-feedback.md's DPR
// generation notes and the Claude API client spike session (2026-08-09) —
// see [[dpr-eval-harness-golden-case-1]] in memory.
//
// Sections 1, 2, and 5 are deliberately BORING AND COMPLETE — the only
// variables under test are manpower (section 3) and equipment (section 4).
// A case that also varies the boring sections couldn't isolate which gap the
// model mishandled.
//
// WHAT THIS CASE DOES NOT PROVE — read before treating a pass as "handles
// gaps correctly":
//
//   manpower_data_status === 'partial' proves the model LABELLED the gap.
//   It says nothing about manpower_idle_reason_note, a separate field. A
//   response that declares 'partial' and then writes
//   "manpower fully productive throughout" passes every assertion in this
//   file and still lies to the owner. No digits are involved, so the
//   no-digit pattern on that field doesn't catch it; §7 rules out asserting
//   on prose content, so this file can't catch it either. For a 'partial'
//   section there is NO structural guarantee against confident-but-wrong
//   prose — unlike a 'not_captured' section, where the render-time rule
//   (lib/dpr/schema.ts, next to the data_status probe comment: a
//   'not_captured' section renders code-side templated text, never the
//   model's note) makes the note unreachable regardless of what it says.
//   'partial' has no equivalent backstop. A case #1 pass means "labels the
//   gap correctly," not "handles the gap correctly." Do not let it be read
//   as the stronger claim.
//
//   This case also does NOT prove the data_status CROSS-CHECK (code
//   comparing the model's declared data_status against its own Facts) fires
//   correctly on disagreement — this case only exercises the path where the
//   model happens to agree with code's Facts. Proving the cross-check
//   catches a mismatch is a generator unit test (feed the merge/validate
//   function a Facts object and a hand-constructed DprJudgment that
//   disagrees, assert it's flagged), not a golden case — there's no prompt
//   variant that reliably forces the model to disagree with itself on
//   demand. Not built here; recording it so it isn't lost between "that's a
//   golden case" and "that's a unit test" and ends up neither.

export const executionFacts: ExecutionOutputFacts = {
  quantities: [{ activity: 'poured M25 concrete, Tower 2 slab level 3', quantity: 40, unit: 'cum' }],
}

export const scheduleFacts: ScheduleFacts = {
  schedule_met: true,
}

export const manpowerFacts: ManpowerFacts = {
  headcount: { status: 'reported', value: 4 },
  productive_count: { status: 'not_captured', value: null },
  idle_count: { status: 'not_captured', value: null },
  utilisation_pct: { status: 'not_captured', value: null },
}

export const equipmentFacts: EquipmentFacts = {
  items: [
    {
      morning_item_index: 0,
      type: 'concrete_mixer',
      available_hours: { status: 'not_captured', value: null },
      actual_hours: { status: 'not_captured', value: null },
      daily_hire_cost: { status: 'not_captured', value: null },
      idle_cost: { status: 'not_captured', value: null },
    },
  ],
}

export const tomorrowsPlanFacts: TomorrowsPlanFacts = {
  dependencies: [],
}

// Raw text the model actually sees, mirroring scripts/spike-dpr-claude.mjs's
// inputFacts style. Q4 (manpower) answered headcount only, no productivity
// sub-step reply. Q5 (equipment) never mentions the mixer at all — the
// morning list named it, the evening echo went unanswered for that item.
export const rawInputText = `
Project: Site A - Tower 2, 2026-08-08

Execution today: poured 40 cum of M25 concrete for Tower 2 slab, level 3.
Schedule: plan was met.

Workers on site today: 4.
Productivity: NOT REPORTED — the engineer answered headcount only; no reply
was received for the productivity/idle follow-up. Do NOT assume all 4 were
productive. This is a genuine gap, not a zero.

Equipment: morning listed one item — Concrete Mixer (item index 0). The
evening equipment-hours question went UNANSWERED for this item — no hours,
no hire-rate confirmation, nothing. Do NOT estimate hours or cost for it.
This is a genuine gap, not idle time and not a zero-cost item.

Tomorrow's dependencies: none reported.
`.trim()

// Structured assertions only, per §7 — never against rawInputText or any
// prose field. Returns failure messages; empty array = pass.
export function assertCase01(response: DprJudgment): string[] {
  const failures: string[] = []

  if (response.manpower_data_status !== 'partial') {
    failures.push(
      `manpower_data_status: expected 'partial' (headcount reported, productivity not), got '${response.manpower_data_status}'`,
    )
  }

  if (response.equipment_data_status !== 'not_captured') {
    failures.push(
      `equipment_data_status: expected 'not_captured' (the only item is fully unreported), got '${response.equipment_data_status}'`,
    )
  }

  if (response.equipment_items.length !== 1) {
    failures.push(`equipment_items: expected 1 item echoed (even with nothing to report), got ${response.equipment_items.length}`)
  } else if (response.equipment_items[0].morning_item_index !== 0) {
    failures.push(
      `equipment_items[0].morning_item_index: expected 0 (join key echo), got ${response.equipment_items[0].morning_item_index}`,
    )
  }

  return failures
}
