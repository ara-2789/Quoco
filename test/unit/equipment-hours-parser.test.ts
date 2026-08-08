import { describe, it, expect } from 'vitest'
import { parseEquipmentHours, isEquipmentHoursAnswered } from '@/lib/whatsapp/flows/parsers/equipment-hours'

// Pure unit tests for the Q5 (equipment hours) parser. Deliberately does NOT
// test any morning_equipment join — this parser never sees that data (see its
// own header for why); the join/match-tiers are the RPC's job, covered by
// T-SM in test/migration-024.test.ts, not here. What IS tested here: label
// recognition, canonical-type recognition (both pure text structure + the
// shared lexicon, no morning_equipment needed), and the arithmetic guards.

describe('parseEquipmentHours', () => {
  it('single machine: available + actual hours, no idle reason', () => {
    const p = parseEquipmentHours('8 6')
    expect(p.items).toEqual([
      { label: null, canonical_type: null, available_hours: 8, actual_hours: 6, idle_reason: null, raw: '8 6' },
    ])
    expect(isEquipmentHoursAnswered(p)).toBe(true)
  })

  it('single machine with idle reason', () => {
    const p = parseEquipmentHours('8 6 waiting for fuel')
    expect(p.items).toEqual([
      {
        label: null,
        canonical_type: null,
        available_hours: 8,
        actual_hours: 6,
        idle_reason: 'waiting for fuel',
        raw: '8 6 waiting for fuel',
      },
    ])
  })

  it('only one number given: available set, actual null', () => {
    const p = parseEquipmentHours('8 hours available')
    expect(p.items[0].available_hours).toBe(8)
    expect(p.items[0].actual_hours).toBeNull()
  })

  it('multiple machines, comma-separated, in reply order', () => {
    const p = parseEquipmentHours('8 6 waiting for fuel, 10 10')
    expect(p.items).toHaveLength(2)
    expect(p.items[0].available_hours).toBe(8)
    expect(p.items[0].idle_reason).toBe('waiting for fuel')
    expect(p.items[1]).toEqual({
      label: null,
      canonical_type: null,
      available_hours: 10,
      actual_hours: 10,
      idle_reason: null,
      raw: '10 10',
    })
  })

  it('newline-separated machines also split into items, in order', () => {
    const p = parseEquipmentHours('8 6\n10 10 broken pump')
    expect(p.items).toHaveLength(2)
    expect(p.items[0].available_hours).toBe(8)
    // "pump" is itself a recognised equipment keyword (canonicalEquipment) —
    // consumed into canonical_type, not left in idle_reason. Real behaviour,
    // not a test artefact: see the CANONICAL_TYPE tests below for the
    // dedicated case.
    expect(p.items[1].canonical_type).toBe('concrete_pump')
    expect(p.items[1].idle_reason).toBe('broken')
  })

  it('digit glued to a word: split at the boundary', () => {
    const p = parseEquipmentHours('8hrs 6hrs fuel issue')
    expect(p.items[0].available_hours).toBe(8)
    expect(p.items[0].actual_hours).toBe(6)
  })

  it('a chunk with no number is dropped (garbled), not fabricated', () => {
    const p = parseEquipmentHours('running fine, 10 10')
    expect(p.items).toHaveLength(1)
    expect(p.items[0].available_hours).toBe(10)
  })

  it('fully garbled (no chunk has a number): empty items, reask trigger', () => {
    const p = parseEquipmentHours('all running fine today')
    expect(p.items).toEqual([])
    expect(isEquipmentHoursAnswered(p)).toBe(false)
  })

  it('empty answer: empty items, raw preserved as empty', () => {
    const p = parseEquipmentHours('   ')
    expect(p.items).toEqual([])
    expect(p.raw_text).toBe('')
    expect(isEquipmentHoursAnswered(p)).toBe(false)
  })

  it('raw_text is always preserved verbatim (trimmed)', () => {
    const p = parseEquipmentHours('  8 6  ')
    expect(p.raw_text).toBe('8 6')
  })

  // -------------------------------------------------------------------------
  // LABEL — the numbered-format bug fix.
  it('a leading "1)" label is recognised and NOT read as an hours value', () => {
    const p = parseEquipmentHours('1) 8 6')
    expect(p.items[0].label).toBe(1)
    expect(p.items[0].available_hours).toBe(8) // NOT 1 — the bug this fixes
    expect(p.items[0].actual_hours).toBe(6) // NOT 8
  })

  it('labels "1.", "1:" are recognised the same way as "1)"', () => {
    expect(parseEquipmentHours('1. 8 6').items[0]).toMatchObject({ label: 1, available_hours: 8 })
    expect(parseEquipmentHours('1: 8 6').items[0]).toMatchObject({ label: 1, available_hours: 8 })
  })

  it('multiple labelled machines, each in its own chunk', () => {
    const p = parseEquipmentHours('1) 8 6, 2) 10 10')
    expect(p.items).toHaveLength(2)
    expect(p.items[0]).toMatchObject({ label: 1, available_hours: 8, actual_hours: 6 })
    expect(p.items[1]).toMatchObject({ label: 2, available_hours: 10, actual_hours: 10 })
  })

  it('no label present: label is null, not 0 or undefined', () => {
    const p = parseEquipmentHours('8 6')
    expect(p.items[0].label).toBeNull()
  })

  it('a bare number followed by another number is NOT a label', () => {
    // "6 2" must not be misread as "label 6, no hours" — there's no
    // separator token, so this is an ordinary unlabelled hours answer.
    const p = parseEquipmentHours('6 2')
    expect(p.items[0].label).toBeNull()
    expect(p.items[0].available_hours).toBe(6)
    expect(p.items[0].actual_hours).toBe(2)
  })

  // -------------------------------------------------------------------------
  // CANONICAL_TYPE — reuses the same lexicon table morning's equipment.ts
  // parser uses, so "mixer" resolves to "concrete_mixer" (matching what
  // morning_equipment.items[].type actually stores), not the literal word
  // the engineer typed.
  it('a named machine resolves to the SAME canonical type morning storage uses', () => {
    const p = parseEquipmentHours('JCB 8 6')
    expect(p.items[0].canonical_type).toBe('jcb')
  })

  it('"mixer" canonicalises to "concrete_mixer", not the literal word', () => {
    const p = parseEquipmentHours('mixer 8 6')
    expect(p.items[0].canonical_type).toBe('concrete_mixer')
  })

  it('the recognised type word is excluded from idle_reason', () => {
    const p = parseEquipmentHours('JCB 8 6 waiting for fuel')
    expect(p.items[0].canonical_type).toBe('jcb')
    expect(p.items[0].idle_reason).toBe('waiting for fuel')
  })

  it('no recognisable machine word: canonical_type null', () => {
    const p = parseEquipmentHours('8 6 waiting for fuel')
    expect(p.items[0].canonical_type).toBeNull()
  })

  it('label AND canonical type can both be present on the same chunk', () => {
    const p = parseEquipmentHours('1) JCB 8 6')
    expect(p.items[0]).toMatchObject({ label: 1, canonical_type: 'jcb', available_hours: 8, actual_hours: 6 })
  })

  // -------------------------------------------------------------------------
  // ARITHMETIC GUARDS — a number that becomes currency in DPR section 4.
  it('GUARD: actual_hours > available_hours is rejected (the "1) 8 6" misparse case)', () => {
    // Without the label fix, "1) 8 6" would misparse to available=1,
    // actual=8 — this guard alone would ALSO have caught that: 8 > 1.
    const p = parseEquipmentHours('1 8') // available=1, actual=8, no label recognised here
    expect(p.items).toEqual([]) // rejected, not stored
    expect(isEquipmentHoursAnswered(p)).toBe(false)
  })

  it('GUARD: available_hours > 24 is rejected (impossible for one day)', () => {
    const p = parseEquipmentHours('30 10')
    expect(p.items).toEqual([])
  })

  it('GUARD: exactly 24 available hours is allowed (boundary, not impossible)', () => {
    const p = parseEquipmentHours('24 20')
    expect(p.items[0]).toMatchObject({ available_hours: 24, actual_hours: 20 })
  })

  it('GUARD: actual_hours equal to available_hours is allowed (ran the full day)', () => {
    const p = parseEquipmentHours('8 8')
    expect(p.items[0]).toMatchObject({ available_hours: 8, actual_hours: 8 })
  })

  it('GUARD: a valid chunk survives alongside a rejected one in the same reply', () => {
    const p = parseEquipmentHours('30 10, 8 6')
    expect(p.items).toHaveLength(1)
    expect(p.items[0]).toMatchObject({ available_hours: 8, actual_hours: 6 })
  })
})
