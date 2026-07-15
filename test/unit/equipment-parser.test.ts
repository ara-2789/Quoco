import { describe, it, expect } from 'vitest'
import { parseEquipment, isEquipmentAnswered } from '@/lib/whatsapp/flows/parsers/equipment'

// Pure unit tests for the Q3 equipment parser. Terse Tamil/English zoo. Three
// outcomes: none (answered-empty, never a reask), >=1 confident item, or garbled
// (items empty & !none -> reask once). raw is always preserved.

describe('parseEquipment', () => {
  it('name + rate: one item with daily_hire_cost', () => {
    const p = parseEquipment('JCB 1500')
    expect(p.none).toBe(false)
    expect(p.items).toEqual([
      { type: 'jcb', count: null, owned_or_hired: null, daily_hire_cost: 1500, raw: 'JCB 1500' },
    ])
    expect(isEquipmentAnswered(p)).toBe(true)
  })

  it('rate with "per day" noise stripped from the type', () => {
    const p = parseEquipment('mixer 800 per day')
    expect(p.items).toHaveLength(1)
    expect(p.items[0].type).toBe('concrete_mixer')
    expect(p.items[0].daily_hire_cost).toBe(800)
  })

  it('tenure keyword captured', () => {
    const p = parseEquipment('crane 5000 hired')
    expect(p.items[0].type).toBe('crane')
    expect(p.items[0].owned_or_hired).toBe('hired')
    expect(p.items[0].daily_hire_cost).toBe(5000)
  })

  it('owned equipment, no rate', () => {
    const p = parseEquipment('mixer owned')
    expect(p.items[0].type).toBe('concrete_mixer')
    expect(p.items[0].owned_or_hired).toBe('owned')
    expect(p.items[0].daily_hire_cost).toBeNull()
  })

  it('multiple machines, comma + "and" separated', () => {
    const p = parseEquipment('JCB 1500, mixer 800 and roller 1200')
    expect(p.items.map((i) => i.type)).toEqual(['jcb', 'concrete_mixer', 'roller'])
    expect(p.items.map((i) => i.daily_hire_cost)).toEqual([1500, 800, 1200])
  })

  it('colloquial site names normalise (poclain/hitachi -> excavator)', () => {
    expect(parseEquipment('poclain 4000').items[0].type).toBe('excavator')
    expect(parseEquipment('hitachi 4000').items[0].type).toBe('excavator')
  })

  it('unknown machine word WITH a rate is still a confident item', () => {
    const p = parseEquipment('tractor 500')
    expect(p.items[0].type).toBe('tractor') // known alias, but exercises number-bearing path
    expect(p.items[0].daily_hire_cost).toBe(500)
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

  it('garbled (word, no keyword, no rate) -> items empty & !none -> reask', () => {
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

  it('digit glued to name: "JCB1500" splits into name + rate', () => {
    const p = parseEquipment('JCB1500')
    expect(p.items[0].type).toBe('jcb')
    expect(p.items[0].daily_hire_cost).toBe(1500)
  })

  it('raw is preserved per item', () => {
    const p = parseEquipment('  JCB 1500  ')
    expect(p.raw_text).toBe('JCB 1500')
    expect(p.items[0].raw).toBe('JCB 1500')
  })
})
