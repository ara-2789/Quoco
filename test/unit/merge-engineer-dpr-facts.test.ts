import { describe, it, expect } from 'vitest'
import { mergeEngineerDprFacts } from '@/lib/dpr/assemble'
import type { CorrectedEngineerLogRow } from '@/lib/dpr/assemble'

// Stage 1 plumbing (2026-09-11, docs/plans/dpr-format-redesign.md §6) --
// pure-function coverage for the two new raw-text equipment fields
// (machines_reported/run_hours), sourced from morning_equipment.raw_text /
// evening_equipment_utilisation.raw_text. No render/prompt change yet --
// these tests only prove the Facts object carries the right value, same
// scope as the rest of this stage.

const BASE_ROW: CorrectedEngineerLogRow = {
  engineer_id: 'engineer-1',
  morning_plan: null,
  morning_manpower: null,
  morning_equipment: null,
  evening_output: null,
  evening_output_quantities: null,
  evening_tomorrow_needs: null,
  evening_manpower: null,
  evening_idle_hours: null,
  evening_equipment_utilisation: null,
}

const COMPLETE_STATUS = { morning: { status: 'complete' as const }, evening: { status: 'complete' as const } }

describe('mergeEngineerDprFacts — equipment raw-text fields (Stage 1)', () => {
  it('machines_reported is not_captured when morning_equipment is null', () => {
    const facts = mergeEngineerDprFacts(BASE_ROW, COMPLETE_STATUS)
    expect(facts.equipment.machines_reported).toEqual({ status: 'not_captured', value: null })
  })

  it('machines_reported carries morning_equipment.raw_text verbatim when reported', () => {
    const row: CorrectedEngineerLogRow = {
      ...BASE_ROW,
      morning_equipment: { items: [], none: false, raw_text: 'roller, JCB' },
    }
    const facts = mergeEngineerDprFacts(row, COMPLETE_STATUS)
    expect(facts.equipment.machines_reported).toEqual({ status: 'reported', value: 'roller, JCB' })
  })

  it('run_hours is not_captured when evening_equipment_utilisation is null', () => {
    const facts = mergeEngineerDprFacts(BASE_ROW, COMPLETE_STATUS)
    expect(facts.equipment.run_hours).toEqual({ status: 'not_captured', value: null })
  })

  it('run_hours carries evening_equipment_utilisation.raw_text verbatim when reported', () => {
    const row: CorrectedEngineerLogRow = {
      ...BASE_ROW,
      evening_equipment_utilisation: { items: [], raw_text: 'JCB ran 6 hours', confidence: 'high' },
    }
    const facts = mergeEngineerDprFacts(row, COMPLETE_STATUS)
    expect(facts.equipment.run_hours).toEqual({ status: 'reported', value: 'JCB ran 6 hours' })
  })

  it('whitespace-only raw_text reads as not_captured, matching wrapText\'s existing convention', () => {
    const row: CorrectedEngineerLogRow = {
      ...BASE_ROW,
      morning_equipment: { items: [], none: false, raw_text: '   ' },
    }
    const facts = mergeEngineerDprFacts(row, COMPLETE_STATUS)
    expect(facts.equipment.machines_reported).toEqual({ status: 'not_captured', value: null })
  })

  it('the no-row (silent engineer) branch also returns not_captured for both new fields, not undefined', () => {
    const facts = mergeEngineerDprFacts(null, { morning: { status: 'not_received' }, evening: { status: 'not_received' } })
    expect(facts.equipment.machines_reported).toEqual({ status: 'not_captured', value: null })
    expect(facts.equipment.run_hours).toEqual({ status: 'not_captured', value: null })
  })

  it('machines_reported and run_hours are independent -- one reported, the other not', () => {
    const row: CorrectedEngineerLogRow = {
      ...BASE_ROW,
      morning_equipment: { items: [], none: false, raw_text: '2 tippers' },
      evening_equipment_utilisation: null,
    }
    const facts = mergeEngineerDprFacts(row, COMPLETE_STATUS)
    expect(facts.equipment.machines_reported).toEqual({ status: 'reported', value: '2 tippers' })
    expect(facts.equipment.run_hours).toEqual({ status: 'not_captured', value: null })
  })
})
