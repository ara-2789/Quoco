import type {
  DprJudgment,
  ExecutionOutputFacts,
  ScheduleFacts,
  ManpowerFacts,
  EquipmentFacts,
  TomorrowsPlanFacts,
} from '../../schema'

// GOLDEN CASE #7 (bot-flows.md minimum cases: "morning-missing /
// evening-present") — an engineer submits the evening check-in with no
// morning submission that day at all. schema.md already documents the
// concrete consequence: evening_equipment_utilisation AUTO-SKIPS to an empty
// items array when morning_equipment is NULL, because Q5 echoes the morning
// equipment list by name — there is nothing to echo. This case checks
// whether the model respects that skip (reports the equipment section as
// not_captured, invents no items) while correctly treating the OTHER
// sections as unaffected — manpower (evening_workers_on_site,
// evening_productive_manpower) is written by evening-only fields and does
// not depend on morning having happened at all.
//
// Sections 1 and 2 are boring-and-complete, same isolation principle as
// case #1: the only thing under test is whether "no morning" correctly
// narrows to JUST the equipment section, not the whole DPR.
//
// WHAT THIS CASE DOES NOT PROVE:
//
//   It tests whether the MODEL correctly follows an already-assembled Facts
//   object that says "equipment: not_captured, nothing to echo." It does
//   NOT test whether the real generator correctly DETECTS a missing morning
//   submission and produces this Facts shape in the first place — that
//   detection (reading morning_equipment IS NULL and setting
//   equipment_data_status accordingly) is generator-assembly logic that
//   doesn't exist yet. A pass here says "the model behaves correctly given
//   the right input," not "the pipeline correctly produces that input."
//
//   Same 'complete' vs 'not_captured' asymmetry as case #1: manpower_data_
//   status === 'complete' proves the model didn't treat a morning-optional
//   section as a gap. It does not verify manpower_idle_reason_note's actual
//   content is accurate — no structural guarantee there, same reasoning as
//   case #1's 'partial' caveat.

export const executionFacts: ExecutionOutputFacts = {
  quantities: [{ activity: 'shuttering, Tower 1 column grid C3-C5', quantity: 12, unit: 'nos' }],
}

export const scheduleFacts: ScheduleFacts = {
  schedule_met: true,
}

export const manpowerFacts: ManpowerFacts = {
  headcount: { status: 'reported', value: 6 },
  productive_count: { status: 'reported', value: 6 },
  idle_count: { status: 'zero', value: 0 },
  utilisation_pct: { status: 'reported', value: 100 },
}

export const equipmentFacts: EquipmentFacts = {
  items: [],
}

export const tomorrowsPlanFacts: TomorrowsPlanFacts = {
  dependencies: [],
}

// Raw text the model sees. Explicit about WHY equipment is empty — not
// "no equipment on site" (a different, legitimate all-zero case) but "no
// morning submission exists to echo against."
export const rawInputText = `
Project: Site A - Tower 1, 2026-08-09

No morning check-in was submitted today for this engineer — morning_plan and
morning_equipment are both NULL for this row. This is NOT the same as "no
equipment on site": we genuinely do not know what equipment exists, so there
is nothing to ask hours for. Do not invent an equipment list or hours.

Execution today (evening-only fields, unaffected by the missing morning
submission): completed shuttering for 12 columns, Tower 1 grid C3-C5.
Schedule: plan was met.

Workers on site today: 6. All 6 productive, no idle time. This question is
asked in the evening regardless of whether morning happened — treat it as
fully reported.

Tomorrow's dependencies: none reported.
`.trim()

export function assertCase07(response: DprJudgment): string[] {
  const failures: string[] = []

  if (response.execution_data_status !== 'complete') {
    failures.push(`execution_data_status: expected 'complete', got '${response.execution_data_status}'`)
  }

  if (response.schedule_data_status !== 'complete') {
    failures.push(`schedule_data_status: expected 'complete', got '${response.schedule_data_status}'`)
  }

  if (response.manpower_data_status !== 'complete') {
    failures.push(
      `manpower_data_status: expected 'complete' (evening-only fields, morning-independent), got '${response.manpower_data_status}'`,
    )
  }

  if (response.equipment_data_status !== 'not_captured') {
    failures.push(
      `equipment_data_status: expected 'not_captured' (no morning submission to echo), got '${response.equipment_data_status}'`,
    )
  }

  if (response.equipment_items.length !== 0) {
    failures.push(`equipment_items: expected 0 items (nothing to echo), got ${response.equipment_items.length}`)
  }

  return failures
}
