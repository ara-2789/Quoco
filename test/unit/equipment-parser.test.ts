import { describe, it, expect } from 'vitest'
import { parseEquipment, isEquipmentAnswered } from '@/lib/whatsapp/flows/parsers/equipment'

// Pure unit tests for the Q3 equipment parser. Terse Tamil/English zoo. Three
// outcomes: none (answered-empty, never a reask), >=1 confident item, or garbled
// (items empty & !none -> reask once). raw is always preserved.
//
// REWRITTEN 2026-09-04 (§33(a), design-decisions-beta-feedback.md,
// 2026-08-25 — built as part of the production hire-rate-removal fix): Q4
// now asks for unit count, not a hire rate ("JCB 2" = two JCBs). The
// engineer's number maps to `count`; `daily_hire_cost` is always null on
// every parse. Every case below that used to assert a captured rate now
// asserts a captured count instead — same number, same position in the
// input, different field.

describe('parseEquipment', () => {
  it('name + count: one item with count', () => {
    const p = parseEquipment('JCB 2')
    expect(p.none).toBe(false)
    expect(p.items).toEqual([
      { type: 'jcb', count: 2, owned_or_hired: null, daily_hire_cost: null, raw: 'JCB 2' },
    ])
    expect(isEquipmentAnswered(p)).toBe(true)
  })

  it('count with trailing noise stripped from the type', () => {
    const p = parseEquipment('mixer 3 units')
    expect(p.items).toHaveLength(1)
    expect(p.items[0].type).toBe('concrete_mixer')
    expect(p.items[0].count).toBe(3)
    expect(p.items[0].daily_hire_cost).toBeNull()
  })

  it('tenure keyword captured', () => {
    const p = parseEquipment('crane 1 hired')
    expect(p.items[0].type).toBe('crane')
    expect(p.items[0].owned_or_hired).toBe('hired')
    expect(p.items[0].count).toBe(1)
    expect(p.items[0].daily_hire_cost).toBeNull()
  })

  it('owned equipment, no count', () => {
    const p = parseEquipment('mixer owned')
    expect(p.items[0].type).toBe('concrete_mixer')
    expect(p.items[0].owned_or_hired).toBe('owned')
    expect(p.items[0].count).toBeNull()
    expect(p.items[0].daily_hire_cost).toBeNull()
  })

  it('multiple machines, comma + "and" separated', () => {
    const p = parseEquipment('JCB 1, mixer 2 and roller 1')
    expect(p.items.map((i) => i.type)).toEqual(['jcb', 'concrete_mixer', 'roller'])
    expect(p.items.map((i) => i.count)).toEqual([1, 2, 1])
    expect(p.items.map((i) => i.daily_hire_cost)).toEqual([null, null, null])
  })

  it('colloquial site names normalise (poclain/hitachi -> excavator)', () => {
    expect(parseEquipment('poclain 1').items[0].type).toBe('excavator')
    expect(parseEquipment('hitachi 1').items[0].type).toBe('excavator')
  })

  it('unknown machine word WITH a count is still a confident item', () => {
    const p = parseEquipment('tractor 1')
    expect(p.items[0].type).toBe('tractor') // known alias, but exercises number-bearing path
    expect(p.items[0].count).toBe(1)
    expect(isEquipmentAnswered(p)).toBe(true)
  })

  it('none sentinel "illa" -> answered-empty, not a reask', () => {
    const p = parseEquipment('illa')
    expect(p.none).toBe(true)
    expect(p.items).toEqual([])
    expect(p.raw_text).toBe('illa')
    expect(isEquipmentAnswered(p)).toBe(true)
  })

  it.each(['no', 'nothing', 'nil', '-', '0', 'onnum illa'])(
    'none sentinel %s -> none:true',
    (word) => {
      const p = parseEquipment(word)
      expect(p.none).toBe(true)
      expect(isEquipmentAnswered(p)).toBe(true)
    },
  )

  it('garbled (word, no keyword, no number) -> items empty & !none -> reask', () => {
    const p = parseEquipment('asdf')
    expect(p.none).toBe(false)
    expect(p.items).toEqual([])
    expect(isEquipmentAnswered(p)).toBe(false)
    expect(p.raw_text).toBe('asdf')
  })

  it('empty answer -> neutral non-answer (handled upstream as empty reask)', () => {
    const p = parseEquipment('   ')
    expect(p.none).toBe(false)
    expect(p.items).toEqual([])
    expect(isEquipmentAnswered(p)).toBe(false)
  })

  it('digit glued to name: "JCB2" splits into name + count', () => {
    const p = parseEquipment('JCB2')
    expect(p.items[0].type).toBe('jcb')
    expect(p.items[0].count).toBe(2)
    expect(p.items[0].daily_hire_cost).toBeNull()
  })

  it('raw is preserved per item', () => {
    const p = parseEquipment('  JCB 2  ')
    expect(p.raw_text).toBe('JCB 2')
    expect(p.items[0].raw).toBe('JCB 2')
  })

  // KNOWN DEFECT (2026-09-12 review round,
  // docs/reviews/parser-digit-misattribution-inventory.md), PRIORITY 4 of
  // the port -- narrower current exposure (assemble.ts's DPR pipeline
  // doesn't read `.count` today; this doc's own equipment-parser-count-gap
  // review already dissolved the SPECIFIC rate/count ambiguity this file
  // used to have), but the same "first digit wins, ignore the governing
  // word" mechanism as equipment-hours.ts/idle-hours.ts still lives here
  // unguarded. FAILING ON PURPOSE, NOT YET FIXED: this documents the
  // desired post-fix behaviour (Option C, porting productivity.ts's
  // anchor-word pairing, Aravind's decision) so the eventual fix is
  // demonstrably a fix, not an assertion. Do not "fix" this test to match
  // current behaviour -- fix the parser.
  describe('KNOWN DEFECT, FAILING UNTIL THE ANCHOR-WORD PORT LANDS -- a status/fault word must not let its adjacent number be claimed as a machine count', () => {
    it('"JCB down for 2 days" -- "down" reports a fault duration, not a unit count; the current parser confidently (and wrongly) reads this as two JCBs on site', () => {
      const p = parseEquipment('JCB down for 2 days')
      // CURRENT (buggy) behaviour: { type: 'jcb', count: 2, ... }
      // DESIRED (post anchor-word-port) behaviour: the equipment keyword
      // ("jcb") is still recognised, but "2" must not be confidently
      // claimed as its count -- "down"/"for ... days" disqualifies it.
      expect(p.items).toHaveLength(1)
      expect(p.items[0].type).toBe('jcb')
      expect(p.items[0].count).toBeNull()
    })
  })
})
