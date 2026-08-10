import { describe, it, expect } from 'vitest'
import { mergeDprFacts, parseCorrectedBoolean, parseCorrectedInteger } from '@/lib/dpr/assemble'
import type { CorrectedDailyLogRow } from '@/lib/dpr/assemble'

// Pure unit tests for mergeDprFacts — the fact assembler's deterministic
// core. No DB, no Claude call. assembleDprFacts (the thin IO wrapper that
// fetches rows + applies daily_log_edits corrections) is not exercised
// here; these rows are already "corrected" by construction, same
// convention as CorrectedDailyLogRow's own contract.

function row(overrides: Partial<CorrectedDailyLogRow> = {}): CorrectedDailyLogRow {
  return {
    engineer_id: 'engineer-1',
    evening_output_quantities: null,
    evening_schedule_met: null,
    evening_workers_on_site: null,
    evening_productive_manpower: null,
    morning_equipment: null,
    evening_equipment_utilisation: null,
    ...overrides,
  }
}

describe('mergeDprFacts — single engineer, happy path', () => {
  it('passes execution quantities through untouched', () => {
    const facts = mergeDprFacts([
      row({ evening_output_quantities: { items: [{ activity: 'Slab pour', quantity: 40, unit: 'cum' }] } }),
    ])
    expect(facts.execution.quantities).toEqual([
      { activity: 'Slab pour', unit: 'cum', quantity: { status: 'reported', value: 40 } },
    ])
  })

  it('passes schedule_met through untouched', () => {
    const facts = mergeDprFacts([row({ evening_schedule_met: true })])
    expect(facts.schedule.schedule_met).toBe(true)
  })

  it('manpower: headcount + productivity reported, no suppression, no low_confidence', () => {
    const facts = mergeDprFacts([
      row({
        evening_workers_on_site: 5,
        evening_productive_manpower: { productive_count: 5, idle_count: 0, confidence: 'high' },
      }),
    ])
    expect(facts.manpower.headcount).toEqual({ status: 'reported', value: 5 })
    expect(facts.manpower.productive_count).toEqual({ status: 'reported', value: 5 })
    expect(facts.manpower.idle_count).toEqual({ status: 'zero', value: 0 })
    expect(facts.manpower.utilisation_pct).toEqual({ status: 'reported', value: 100 })
    expect(facts.manpower.suppressed).toBeUndefined()
  })

  it('equipment: computes idle cost via computeIdleCost, no suppression', () => {
    const facts = mergeDprFacts([
      row({
        morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 8000 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'JCB Excavator', available_hours: 8, actual_hours: 3.27 }],
          confidence: 'high',
        },
      }),
    ])
    expect(facts.equipment.items).toHaveLength(1)
    expect(facts.equipment.items[0].idle_cost).toEqual({ status: 'reported', value: 4730 })
    expect(facts.equipment.items[0].suppressed).toBeUndefined()
  })
})

describe('mergeDprFacts — low_confidence carried, not discarded (Option C)', () => {
  it('low-confidence productive_count keeps its value AND flags low_confidence', () => {
    const facts = mergeDprFacts([
      row({
        evening_workers_on_site: 45,
        evening_productive_manpower: { productive_count: 45, idle_count: 0, confidence: 'low' },
      }),
    ])
    expect(facts.manpower.productive_count).toEqual({ status: 'reported', value: 45, low_confidence: true })
    // headcount itself has no confidence concept (scalar, not JSONB) — must
    // stay clean even though productivity on the same row is low-confidence.
    expect(facts.manpower.headcount).toEqual({ status: 'reported', value: 45 })
  })

  it('low-confidence equipment hours propagate onto the computed idle_cost', () => {
    const facts = mergeDprFacts([
      row({
        morning_equipment: { items: [{ type: 'Concrete Mixer', daily_hire_cost: 800 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'Concrete Mixer', available_hours: 8, actual_hours: 8 }],
          confidence: 'low',
        },
      }),
    ])
    expect(facts.equipment.items[0].available_hours.low_confidence).toBe(true)
    expect(facts.equipment.items[0].idle_cost).toEqual({ status: 'reported', value: 0, low_confidence: true })
  })

  it('not_captured never carries low_confidence (nothing to be doubtful ABOUT)', () => {
    const facts = mergeDprFacts([row({ evening_productive_manpower: { productive_count: null, idle_count: null, confidence: 'low' } })])
    expect(facts.manpower.productive_count).toEqual({ status: 'not_captured', value: null })
  })
})

describe('mergeDprFacts — §12 rollup: manpower suppressed unconditionally', () => {
  it('suppresses manpower on ANY multi-engineer day, even when the numbers agree', () => {
    const facts = mergeDprFacts([
      row({ engineer_id: 'e1', evening_workers_on_site: 10 }),
      row({ engineer_id: 'e2', evening_workers_on_site: 10 }),
    ])
    expect(facts.manpower.headcount).toEqual({ status: 'not_captured', value: null })
    expect(facts.manpower.suppressed).toEqual({ reason: 'multi_engineer_manpower', engineer_count: 2 })
  })
})

describe('mergeDprFacts — §12 rollup: execution suppresses only same-activity overlap', () => {
  it('distinct activities from different engineers both survive with quantities intact', () => {
    const facts = mergeDprFacts([
      row({ engineer_id: 'e1', evening_output_quantities: { items: [{ activity: 'Shuttering', quantity: 8, unit: 'nos' }] } }),
      row({ engineer_id: 'e2', evening_output_quantities: { items: [{ activity: 'Column casting', quantity: 4, unit: 'nos' }] } }),
    ])
    expect(facts.execution.quantities).toHaveLength(2)
    expect(facts.execution.quantities.every((q) => q.suppressed === undefined)).toBe(true)
  })

  it('same activity name (case/whitespace-insensitive) from two engineers merges into ONE suppressed item', () => {
    const facts = mergeDprFacts([
      row({ engineer_id: 'e1', evening_output_quantities: { items: [{ activity: 'Slab pour', quantity: 40, unit: 'cum' }] } }),
      row({ engineer_id: 'e2', evening_output_quantities: { items: [{ activity: '  slab POUR  ', quantity: 15, unit: 'cum' }] } }),
    ])
    expect(facts.execution.quantities).toHaveLength(1)
    expect(facts.execution.quantities[0].quantity).toEqual({ status: 'not_captured', value: null })
    expect(facts.execution.quantities[0].suppressed).toEqual({ reason: 'same_activity_overlap', engineer_count: 2 })
  })
})

describe('mergeDprFacts — §12 rollup: equipment suppresses only same-type collisions', () => {
  it('distinct types from different engineers both survive fully', () => {
    const facts = mergeDprFacts([
      row({
        engineer_id: 'e1',
        morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 1500 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'JCB Excavator', available_hours: 8, actual_hours: 6 }],
          confidence: 'high',
        },
      }),
      row({
        engineer_id: 'e2',
        morning_equipment: { items: [{ type: 'Concrete Mixer', daily_hire_cost: 800 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'Concrete Mixer', available_hours: 8, actual_hours: 8 }],
          confidence: 'high',
        },
      }),
    ])
    expect(facts.equipment.items).toHaveLength(2)
    expect(facts.equipment.items.every((i) => i.suppressed === undefined)).toBe(true)
    // aggregate renumbering — fresh 0..N-1 across the merged list, not
    // either engineer's raw per-row index.
    expect(facts.equipment.items.map((i) => i.morning_item_index).sort()).toEqual([0, 1])
  })

  it('same type from two engineers is suppressed wholesale — never merged, never identity-resolved', () => {
    const facts = mergeDprFacts([
      row({
        engineer_id: 'e1',
        morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 1500 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'JCB Excavator', available_hours: 8, actual_hours: 6 }],
          confidence: 'high',
        },
      }),
      row({
        engineer_id: 'e2',
        morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 1600 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'jcb excavator', available_hours: 8, actual_hours: 4 }],
          confidence: 'high',
        },
      }),
    ])
    expect(facts.equipment.items).toHaveLength(1)
    expect(facts.equipment.items[0].idle_cost).toEqual({ status: 'not_captured', value: null })
    expect(facts.equipment.items[0].suppressed).toEqual({ reason: 'same_type_equipment', engineer_count: 2 })
  })
})

describe('mergeDprFacts — §12 rollup (corrected 2026-08-10): schedule suppressed unconditionally', () => {
  it('suppresses schedule on ANY multi-engineer day, even when both engineers agree', () => {
    const facts = mergeDprFacts([
      row({ engineer_id: 'e1', evening_schedule_met: true }),
      row({ engineer_id: 'e2', evening_schedule_met: true }),
    ])
    expect(facts.schedule.schedule_met).toBeNull()
    expect(facts.schedule.suppressed).toEqual({ reason: 'multi_engineer_schedule', engineer_count: 2 })
  })

  it('suppresses schedule the same way when engineers answer differently — not a disagreement, two separate facts', () => {
    const facts = mergeDprFacts([
      row({ engineer_id: 'e1', evening_schedule_met: true }),
      row({ engineer_id: 'e2', evening_schedule_met: false }),
    ])
    expect(facts.schedule.schedule_met).toBeNull()
    expect(facts.schedule.suppressed).toEqual({ reason: 'multi_engineer_schedule', engineer_count: 2 })
  })
})

describe('mergeDprFacts — hire-rate trust seam', () => {
  it('default (no option passed) trusts every rate', () => {
    const facts = mergeDprFacts([
      row({
        morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 8000 }] },
        evening_equipment_utilisation: {
          items: [{ morning_item_index: 0, type: 'JCB Excavator', available_hours: 8, actual_hours: 8 }],
          confidence: 'high',
        },
      }),
    ])
    expect(facts.equipment.items[0].daily_hire_cost).toEqual({ status: 'reported', value: 8000 })
  })

  it('isHireRateTrusted returning false suppresses the rate AND the idle_cost, never the hours', () => {
    const facts = mergeDprFacts(
      [
        row({
          morning_equipment: { items: [{ type: 'JCB Excavator', daily_hire_cost: 2 }] }, // looks like a miscaptured count
          evening_equipment_utilisation: {
            items: [{ morning_item_index: 0, type: 'JCB Excavator', available_hours: 8, actual_hours: 6 }],
            confidence: 'high',
          },
        }),
      ],
      { isHireRateTrusted: (cost) => cost > 100 },
    )
    expect(facts.equipment.items[0].daily_hire_cost).toEqual({ status: 'not_captured', value: null })
    expect(facts.equipment.items[0].idle_cost).toEqual({ status: 'not_captured', value: null })
    expect(facts.equipment.items[0].available_hours).toEqual({ status: 'reported', value: 8 })
  })
})

describe('mergeDprFacts — zero rows', () => {
  it('returns an all-empty/not_captured DprFacts rather than throwing', () => {
    const facts = mergeDprFacts([])
    expect(facts.execution.quantities).toEqual([])
    expect(facts.schedule.schedule_met).toBeNull()
    expect(facts.manpower.headcount).toEqual({ status: 'not_captured', value: null })
    expect(facts.equipment.items).toEqual([])
  })
})

describe('mergeDprFacts — utilisation guard: a PM correction cannot manufacture >100%', () => {
  it('productive_count > headcount (post-correction) yields not_captured, never a clamp or an impossible %', () => {
    // Simulates the exact scenario: 024 wrote productive_count=20 when
    // headcount was 20; a PM later corrects evening_workers_on_site down to
    // 10 (evening_productive_manpower is JSONB, not correctable — it still
    // says 20). Without the guard this would compute (20/10)*100 = 200%.
    const facts = mergeDprFacts([
      row({
        evening_workers_on_site: 10,
        evening_productive_manpower: { productive_count: 20, idle_count: 0, confidence: 'high' },
      }),
    ])
    expect(facts.manpower.utilisation_pct).toEqual({ status: 'not_captured', value: null })
    // Not clamped — the raw (now-inconsistent) figures are preserved as
    // originally captured, not silently altered.
    expect(facts.manpower.headcount).toEqual({ status: 'reported', value: 10 })
    expect(facts.manpower.productive_count).toEqual({ status: 'reported', value: 20 })
  })

  it('productive_count === headcount (fully productive) still computes normally — the guard is > only, not >=', () => {
    const facts = mergeDprFacts([
      row({
        evening_workers_on_site: 10,
        evening_productive_manpower: { productive_count: 10, idle_count: 0, confidence: 'high' },
      }),
    ])
    expect(facts.manpower.utilisation_pct).toEqual({ status: 'reported', value: 100 })
  })
})

describe('mergeDprFacts — execution quantity null (fix #3): wrapNumber, not a hand-built "reported"', () => {
  it('a null quantity in the JSONB yields not_captured, never a bare "reported" with no value', () => {
    const facts = mergeDprFacts([
      row({ evening_output_quantities: { items: [{ activity: 'Shuttering', quantity: null, unit: 'nos' }] } }),
    ])
    expect(facts.execution.quantities).toEqual([{ activity: 'Shuttering', unit: 'nos', quantity: { status: 'not_captured', value: null } }])
  })
})

describe('parseCorrectedBoolean / parseCorrectedInteger — explicit conversion, not a cast (fix #2)', () => {
  it('boolean: no edit (undefined) falls back to the raw column value', () => {
    expect(parseCorrectedBoolean('evening_schedule_met', true, undefined)).toBe(true)
  })

  it('boolean: SQL NULL correction (edit present, value null) clears the field', () => {
    expect(parseCorrectedBoolean('evening_schedule_met', true, null)).toBeNull()
  })

  it('boolean: a genuine JSON boolean correction is accepted', () => {
    expect(parseCorrectedBoolean('evening_schedule_met', true, false)).toBe(false)
  })

  it('boolean: a malformed correction (wrong runtime type) throws rather than silently propagating', () => {
    expect(() => parseCorrectedBoolean('evening_schedule_met', true, 'false')).toThrow(/was not a boolean/)
  })

  it('integer: no edit (undefined) falls back to the raw column value', () => {
    expect(parseCorrectedInteger('evening_workers_on_site', 20, undefined)).toBe(20)
  })

  it('integer: SQL NULL correction clears the field', () => {
    expect(parseCorrectedInteger('evening_workers_on_site', 20, null)).toBeNull()
  })

  it('integer: a genuine JSON number correction is accepted', () => {
    expect(parseCorrectedInteger('evening_workers_on_site', 20, 10)).toBe(10)
  })

  it('integer: a stringified number ("10" instead of 10) throws rather than silently coercing', () => {
    expect(() => parseCorrectedInteger('evening_workers_on_site', 20, '10')).toThrow(/was not a finite number/)
  })

  it('integer: NaN/non-finite throws', () => {
    expect(() => parseCorrectedInteger('evening_workers_on_site', 20, Number.NaN)).toThrow(/was not a finite number/)
  })
})
