import { describe, it, expect } from 'vitest'
import { buildPerCallSchema, eligibleEquipmentIndices } from '@/lib/dpr/generate'
import type { DprFacts } from '@/lib/dpr/schema'

// GENERALIZED STRUCTURAL FIX (2026-08-11, Aravind's decision, PR #51
// review): buildPerCallSchema now removes ANY Judgment note field whose
// section is already suppressed or not_captured in Facts — not just
// equipment_items (the original, narrower fix). tomorrows_plan_carry_
// forward_note is the always-true case of the SAME rule, not a separate
// approach. Rejected alternative: instructing the model in the prompt not
// to write the note — this project's own precedent is that the arithmetic
// boundary is enforced at the type level, not by instruction.

const notCaptured = { status: 'not_captured' as const, value: null }
const reported = (value: number) => ({ status: 'reported' as const, value })

const baseFacts: DprFacts = {
  execution: { quantities: [] },
  schedule: { schedule_met: true },
  manpower: {
    headcount: reported(10),
    productive_count: reported(10),
    idle_count: reported(0),
    utilisation_pct: reported(100),
  },
  equipment: { items: [] },
  tomorrows_plan: { dependencies: [] },
}

function hasProperty(schema: ReturnType<typeof buildPerCallSchema>, key: string): boolean {
  return key in schema.properties
}

describe('buildPerCallSchema — §5 tomorrows_plan_carry_forward_note is ALWAYS removed, unconditionally', () => {
  it('is absent from properties and required on every call, regardless of Facts', () => {
    const schema = buildPerCallSchema(baseFacts)
    expect(hasProperty(schema, 'tomorrows_plan_carry_forward_note')).toBe(false)
    expect(schema.required).not.toContain('tomorrows_plan_carry_forward_note')
  })
})

describe('buildPerCallSchema — manpower_idle_reason_note removed when suppressed or fully not_captured', () => {
  it('removed when manpower is suppressed', () => {
    const facts: DprFacts = {
      ...baseFacts,
      manpower: { ...baseFacts.manpower, suppressed: { reason: 'multi_engineer_manpower', engineer_count: 2 } },
    }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'manpower_idle_reason_note')).toBe(false)
    expect(schema.required).not.toContain('manpower_idle_reason_note')
  })

  it('removed when headcount, productive_count, AND idle_count are all not_captured (not suppressed)', () => {
    const facts: DprFacts = {
      ...baseFacts,
      manpower: { headcount: notCaptured, productive_count: notCaptured, idle_count: notCaptured, utilisation_pct: notCaptured },
    }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'manpower_idle_reason_note')).toBe(false)
  })

  it('present when manpower is normally captured (not suppressed, not fully not_captured)', () => {
    const schema = buildPerCallSchema(baseFacts)
    expect(hasProperty(schema, 'manpower_idle_reason_note')).toBe(true)
    expect(schema.required).toContain('manpower_idle_reason_note')
  })

  it('present when only PARTIALLY not_captured (headcount known, productivity not) — the model still has something to write about', () => {
    const facts: DprFacts = {
      ...baseFacts,
      manpower: { headcount: reported(4), productive_count: notCaptured, idle_count: notCaptured, utilisation_pct: notCaptured },
    }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'manpower_idle_reason_note')).toBe(true)
  })
})

describe('buildPerCallSchema — schedule_miss_reason_note removed when suppressed or not_captured, but NOT when merely met', () => {
  it('removed when schedule is suppressed', () => {
    const facts: DprFacts = {
      ...baseFacts,
      schedule: { schedule_met: null, suppressed: { reason: 'multi_engineer_schedule', engineer_count: 2 } },
    }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'schedule_miss_reason_note')).toBe(false)
  })

  it('removed when schedule_met is null (genuinely not_captured — nobody answered)', () => {
    const facts: DprFacts = { ...baseFacts, schedule: { schedule_met: null } }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'schedule_miss_reason_note')).toBe(false)
  })

  it('present when schedule_met is true — plan met is a real, known answer, not suppressed/not_captured (deliberately out of scope for this rule)', () => {
    const facts: DprFacts = { ...baseFacts, schedule: { schedule_met: true } }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'schedule_miss_reason_note')).toBe(true)
  })

  it('present when schedule_met is false — the note is exactly what is needed here', () => {
    const facts: DprFacts = { ...baseFacts, schedule: { schedule_met: false } }
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'schedule_miss_reason_note')).toBe(true)
  })
})

describe('eligibleEquipmentIndices / buildPerCallSchema — equipment items excluded when suppressed or fully not_captured', () => {
  it('zero eligible items (empty items array) deletes equipment_items entirely', () => {
    const facts: DprFacts = { ...baseFacts, equipment: { items: [] } }
    expect(eligibleEquipmentIndices(facts)).toEqual([])
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'equipment_items')).toBe(false)
    expect(schema.required).not.toContain('equipment_items')
  })

  it('a suppressed equipment item is excluded from eligible indices', () => {
    const facts: DprFacts = {
      ...baseFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: notCaptured,
            actual_hours: notCaptured,
            daily_hire_cost: notCaptured,
            idle_cost: notCaptured,
            suppressed: { reason: 'same_type_equipment', engineer_count: 2 },
          },
        ],
      },
    }
    expect(eligibleEquipmentIndices(facts)).toEqual([])
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'equipment_items')).toBe(false) // the only item was excluded -> zero eligible
  })

  it('a fully not_captured (but not suppressed) equipment item is excluded', () => {
    const facts: DprFacts = {
      ...baseFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'Concrete Mixer',
            available_hours: notCaptured,
            actual_hours: notCaptured,
            daily_hire_cost: notCaptured,
            idle_cost: notCaptured,
          },
        ],
      },
    }
    expect(eligibleEquipmentIndices(facts)).toEqual([])
  })

  it('a partially captured equipment item (available known, actual not) stays eligible', () => {
    const facts: DprFacts = {
      ...baseFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: reported(8),
            actual_hours: notCaptured,
            daily_hire_cost: reported(1500),
            idle_cost: notCaptured,
          },
        ],
      },
    }
    expect(eligibleEquipmentIndices(facts)).toEqual([0])
    const schema = buildPerCallSchema(facts)
    expect(hasProperty(schema, 'equipment_items')).toBe(true)
    const morningItemIndexSchema = schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }
    expect(morningItemIndexSchema.enum).toEqual([0])
  })

  it('mixed: one suppressed item excluded, one normal item stays eligible — only the eligible one appears in the enum', () => {
    const facts: DprFacts = {
      ...baseFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: notCaptured,
            actual_hours: notCaptured,
            daily_hire_cost: notCaptured,
            idle_cost: notCaptured,
            suppressed: { reason: 'same_type_equipment', engineer_count: 2 },
          },
          {
            morning_item_index: 1,
            type: 'Concrete Mixer',
            available_hours: reported(8),
            actual_hours: reported(6),
            daily_hire_cost: reported(1500),
            idle_cost: reported(375),
          },
        ],
      },
    }
    expect(eligibleEquipmentIndices(facts)).toEqual([1])
    const schema = buildPerCallSchema(facts)
    const morningItemIndexSchema = schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }
    expect(morningItemIndexSchema.enum).toEqual([1])
  })
})

describe('buildPerCallSchema — deep clone, no shared-reference corruption across calls', () => {
  it("mutating one call's schema (deletions included) does not affect a later call or the static export", () => {
    const suppressedManpower: DprFacts = {
      ...baseFacts,
      manpower: { ...baseFacts.manpower, suppressed: { reason: 'multi_engineer_manpower', engineer_count: 2 } },
    }
    buildPerCallSchema(suppressedManpower)
    const afterward = buildPerCallSchema(baseFacts)
    expect(hasProperty(afterward, 'manpower_idle_reason_note')).toBe(true)
    expect(afterward.required).toContain('manpower_idle_reason_note')
  })
})
