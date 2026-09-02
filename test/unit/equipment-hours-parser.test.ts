import { describe, it, expect } from 'vitest'
import {
  parseEquipmentHours,
  isEquipmentHoursAnswered,
} from '@/lib/whatsapp/flows/parsers/equipment-hours'

// Pure unit tests for the REDESIGNED evening step 4 parser (migration 035
// restructuring) — ONE number per equipment TYPE, not the old per-machine
// two-number MATCH-TIERS design. This file reclaims the clean
// `equipment-hours-parser.test.ts` name and `parseEquipmentHours` names
// now that evening.ts's own rewrite lands in the same commit as this
// parser's redesign — the old design (and this file's own prior contents,
// testing it) is deleted, not coexisting, per equipment-hours.ts's own
// header.

describe('parseEquipmentHours', () => {
  it('one recognised type, one number: matched, canonical type', () => {
    const p = parseEquipmentHours('JCB 6 hours')
    expect(p.items).toEqual([{ type: 'jcb', hours_used: 6, matched: true, raw: 'JCB 6 hours' }])
    expect(isEquipmentHoursAnswered(p)).toBe(true)
  })

  it('multiple types, comma-separated', () => {
    const p = parseEquipmentHours('JCB 6 hours, mixer 4 hours')
    expect(p.items).toEqual([
      { type: 'jcb', hours_used: 6, matched: true, raw: 'JCB 6 hours' },
      { type: 'concrete_mixer', hours_used: 4, matched: true, raw: 'mixer 4 hours' },
    ])
  })

  it('§42: an unrecognised equipment keyword is captured, not dropped, original case intact', () => {
    const p = parseEquipmentHours('hydra 4 hours')
    expect(p.items).toEqual([{ type: 'hydra', hours_used: 4, matched: false, raw: 'hydra 4 hours' }])
  })

  it('§42 + real data together: matched and unmatched coexist in one answer', () => {
    const p = parseEquipmentHours('JCB 6 hours, hydra 4 hours')
    expect(p.items).toEqual([
      { type: 'jcb', hours_used: 6, matched: true, raw: 'JCB 6 hours' },
      { type: 'hydra', hours_used: 4, matched: false, raw: 'hydra 4 hours' },
    ])
  })

  it('NO ARITHMETIC GUARD, on purpose: a large hours figure is stored as-is, never rejected', () => {
    // This is the direct fix for the 2026-08-31 production incident: the
    // OLD parser's guard rejected "50 hours" outright with no explanation.
    // Implausibility is now a SQL-side flag (review package §5), never a
    // TS-side rejection -- this parser has no concept of a bound at all.
    const p = parseEquipmentHours('JCB used 50 hours')
    expect(p.items).toEqual([{ type: 'jcb', hours_used: 50, matched: true, raw: 'JCB used 50 hours' }])
  })

  it('the original 2026-08-31 incident input parses cleanly: "2 JCB 8"', () => {
    // The forensic incident: "2 JCB 8" was rejected by the OLD two-number
    // arithmetic guard (available_hours=2, actual_hours=8, 8>2 impossible).
    // The redesign asks for ONE number per type -- there is no second
    // number to be impossible relative to. The first number found (2) is
    // hours_used; this is a deliberately different QUESTION shape, not a
    // guard removed from the same one.
    const p = parseEquipmentHours('2 JCB 8')
    expect(p.items.length).toBe(1)
    expect(p.items[0].type).toBe('jcb')
    expect(p.items[0].hours_used).toBe(2) // first number wins; no crash, no rejection
  })

  it('rate/tenure filler words are not captured as a fake type', () => {
    const p = parseEquipmentHours('4 hours per day')
    // No equipment keyword and no non-filler word survives -- generic
    // fallback, never "per" or "day".
    expect(p.items).toEqual([{ type: 'equipment', hours_used: 4, matched: false, raw: '4 hours per day' }])
  })

  it('no number anywhere: not answered, empty items', () => {
    const p = parseEquipmentHours('JCB running fine')
    expect(p.items).toEqual([])
    expect(isEquipmentHoursAnswered(p)).toBe(false)
  })

  it('empty answer: neutral non-answer', () => {
    const p = parseEquipmentHours('   ')
    expect(p.items).toEqual([])
    expect(p.raw_text).toBe('')
    expect(isEquipmentHoursAnswered(p)).toBe(false)
  })

  it('raw_text always preserved verbatim (trimmed)', () => {
    const p = parseEquipmentHours('  JCB 6 hours  ')
    expect(p.raw_text).toBe('JCB 6 hours')
  })
})
