import { describe, it, expect } from 'vitest'
import { validateJudgment } from '@/lib/dpr/validate'
import type { DprJudgment, ExecutionOutputFacts } from '@/lib/dpr/schema'

// No-digit enforcement moved here from a JSON Schema `pattern` constraint
// (schema.ts's NO_DIGIT_JUDGMENT_FIELDS comment has the full incident: four
// compiled `^[^0-9]*$` patterns made the API reject the schema outright with
// "Schema is too complex for compilation," confirmed by a direct test).
// These tests cover the RULE — unchanged — now enforced in code.

const meta = { project_name: 'Site A' }
const execution: ExecutionOutputFacts = {
  quantities: [{ activity: 'shuttering', quantity: { status: 'reported', value: 40 }, unit: 'cum' }],
}

const cleanJudgment: DprJudgment = {
  execution_narrative: 'Completed 40 cum of shuttering.',
  execution_data_status: 'complete',
  schedule_miss_reason_note: 'Delayed due to material shortage.',
  schedule_data_status: 'complete',
  manpower_idle_reason_note: 'Workers were fully productive.',
  manpower_data_status: 'complete',
  equipment_items: [{ morning_item_index: 0, idle_reason_note: 'Idle waiting for fuel.' }],
  equipment_data_status: 'complete',
  tomorrows_plan_carry_forward_note: 'Resume shuttering tomorrow.',
}

describe('validateJudgment — clean response passes both checks', () => {
  it('no violations on a fully clean judgment', () => {
    const result = validateJudgment(cleanJudgment, execution, meta)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })
})

describe('validateJudgment — no-digit fields', () => {
  it('flags a digit in schedule_miss_reason_note', () => {
    const judgment: DprJudgment = { ...cleanJudgment, schedule_miss_reason_note: 'Delayed by 3 hours.' }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations).toContainEqual({
      field: 'schedule_miss_reason_note',
      kind: 'no_digit',
      detail: 'contains a digit: "Delayed by 3 hours."',
    })
  })

  it('flags a digit in manpower_idle_reason_note', () => {
    const judgment: DprJudgment = { ...cleanJudgment, manpower_idle_reason_note: '2 workers were idle.' }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.field === 'manpower_idle_reason_note' && v.kind === 'no_digit')).toBe(true)
  })

  it('flags a digit in tomorrows_plan_carry_forward_note', () => {
    const judgment: DprJudgment = { ...cleanJudgment, tomorrows_plan_carry_forward_note: 'Resume in 2 days.' }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.field === 'tomorrows_plan_carry_forward_note' && v.kind === 'no_digit')).toBe(true)
  })

  it('flags a digit in an equipment item idle_reason_note, naming the item by morning_item_index', () => {
    const judgment: DprJudgment = {
      ...cleanJudgment,
      equipment_items: [{ morning_item_index: 0, idle_reason_note: 'Idle for 2 hours.' }],
    }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations).toContainEqual({
      field: 'equipment_items[morning_item_index=0].idle_reason_note',
      kind: 'no_digit',
      detail: 'contains a digit: "Idle for 2 hours."',
    })
  })
})

describe('validateJudgment — reports ALL violations together, not first-failure-only', () => {
  it('a response with THREE separate violations (one containment, two no-digit) reports all three', () => {
    const judgment: DprJudgment = {
      ...cleanJudgment,
      execution_narrative: 'Completed 999 cum of shuttering.', // containment violation
      schedule_miss_reason_note: 'Delayed by 5 hours.', // no-digit violation
      manpower_idle_reason_note: 'Everyone idle for 3 hours.', // no-digit violation
    }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(3)
    const kinds = result.violations.map((v) => `${v.field}:${v.kind}`).sort()
    expect(kinds).toEqual([
      'execution_narrative:containment',
      'manpower_idle_reason_note:no_digit',
      'schedule_miss_reason_note:no_digit',
    ])
  })
})

describe('validateJudgment — containment still section-scoped (unchanged by this refactor)', () => {
  it('a genuinely invented execution_narrative digit is flagged as containment', () => {
    const judgment: DprJudgment = { ...cleanJudgment, execution_narrative: 'Completed 999 cum of shuttering.' }
    const result = validateJudgment(judgment, execution, meta)
    expect(result.ok).toBe(false)
    expect(result.violations).toContainEqual({
      field: 'execution_narrative',
      kind: 'containment',
      detail: 'uncontained digit(s), not traceable to execution Facts: 999',
    })
  })
})
