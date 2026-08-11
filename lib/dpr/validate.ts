import type { DprJudgment, ExecutionOutputFacts } from './schema'
import { NO_DIGIT_JUDGMENT_FIELDS } from './schema'
import { buildExecutionCorpus, checkContainment, type ContainmentMeta } from './containment'

// Composes the two independent checks a DprJudgment response must pass into
// ONE validator with ONE failure path, run AFTER the response — both checks
// report every violation together, not first-failure-only. A SIBLING file to
// containment.ts, not an extension of it: containment.ts's own header frames
// its job narrowly (enforcing the Facts/Judgment boundary specifically, via
// corpus membership); no-digit is a different, simpler kind of check
// (presence/absence of any digit) with nothing to do with that boundary.
// Keeping them separate keeps each file provable on its own; this file is
// only the composition generate.ts actually calls.
//
// No-digit moved here from a JSON Schema `pattern` constraint (schema.ts's
// own NO_DIGIT_JUDGMENT_FIELDS comment has the full story: four compiled
// `^[^0-9]*$` patterns made the API reject the schema outright with "Schema
// is too complex for compilation," confirmed by a direct test, not assumed).
// The RULE is unchanged — these four fields still may not contain a digit —
// only where it's checked.

const DIGIT_ANYWHERE = /\d/

export type ValidationViolationKind = 'containment' | 'no_digit'

export interface ValidationViolation {
  field: string
  kind: ValidationViolationKind
  detail: string
}

export interface ValidationResult {
  ok: boolean
  violations: ValidationViolation[]
}

function checkNoDigit(field: string, text: string): ValidationViolation | null {
  return DIGIT_ANYWHERE.test(text) ? { field, kind: 'no_digit', detail: `contains a digit: "${text}"` } : null
}

export function validateJudgment(
  judgment: DprJudgment,
  execution: ExecutionOutputFacts,
  meta: ContainmentMeta,
): ValidationResult {
  const violations: ValidationViolation[] = []

  // THE CONTAINMENT CHECK — section-scoped, execution_narrative only (see
  // containment.ts for the full reasoning).
  const corpus = buildExecutionCorpus(execution, meta)
  const containmentResult = checkContainment(judgment.execution_narrative, corpus)
  if (!containmentResult.ok) {
    violations.push({
      field: 'execution_narrative',
      kind: 'containment',
      detail: `uncontained digit(s), not traceable to execution Facts: ${containmentResult.violations.join(', ')}`,
    })
  }

  // NO-DIGIT FIELDS — schema.ts's NO_DIGIT_JUDGMENT_FIELDS names these same
  // four field paths; kept as separate explicit checks here (rather than a
  // generic loop over that list) because two of them need field-specific
  // access (the array, and the scalar fields), and the explicitness makes
  // it obvious at a glance which four fields this function actually checks.
  const scheduleViolation = checkNoDigit('schedule_miss_reason_note', judgment.schedule_miss_reason_note)
  if (scheduleViolation) violations.push(scheduleViolation)

  const manpowerViolation = checkNoDigit('manpower_idle_reason_note', judgment.manpower_idle_reason_note)
  if (manpowerViolation) violations.push(manpowerViolation)

  const tomorrowsPlanViolation = checkNoDigit('tomorrows_plan_carry_forward_note', judgment.tomorrows_plan_carry_forward_note)
  if (tomorrowsPlanViolation) violations.push(tomorrowsPlanViolation)

  for (const item of judgment.equipment_items) {
    const equipmentViolation = checkNoDigit(
      `equipment_items[morning_item_index=${item.morning_item_index}].idle_reason_note`,
      item.idle_reason_note,
    )
    if (equipmentViolation) violations.push(equipmentViolation)
  }

  return { ok: violations.length === 0, violations }
}

// Re-exported so callers that only need the field list (not the check
// itself) don't have to import from schema.ts directly for it.
export { NO_DIGIT_JUDGMENT_FIELDS }
