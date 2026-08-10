import { describe, it, expect } from 'vitest'
import { parseQuantities } from '@/lib/whatsapp/flows/parsers/quantities'

// Pure unit tests for the Q1 quantities parser (evening flow, ENRICHMENT only
// — never a gate; see the NOT A GATE note in quantities.ts). Includes coverage
// for two real defects caught during test authoring and fixed pre-commit:
// decimal truncation (splitDigitBoundaries was splitting "12.5" into "12"/"5")
// and ordinal collision ("2nd" stealing the quantity slot from the real
// measurement later in the chunk).

describe('parseQuantities', () => {
  it('single item: activity + quantity + unit', () => {
    const p = parseQuantities('slab concrete 120 sqm')
    expect(p.items).toEqual([
      { activity: 'slab concrete', quantity: 120, unit: 'sqm', raw: 'slab concrete 120 sqm', numbers_discarded: false },
    ])
    expect(p.raw_text).toBe('slab concrete 120 sqm')
  })

  it('comma-separated multi-item', () => {
    const p = parseQuantities('slab concrete 120 sqm, plastering 300 sft')
    expect(p.items).toHaveLength(2)
    expect(p.items[0]).toMatchObject({ activity: 'slab concrete', quantity: 120, unit: 'sqm' })
    expect(p.items[1]).toMatchObject({ activity: 'plastering', quantity: 300, unit: 'sqft' })
  })

  it('"and" / "plus" separated multi-item', () => {
    const p = parseQuantities('excavation 10 cum and backfilling 5 cum')
    expect(p.items.map((i) => i.activity)).toEqual(['excavation', 'backfilling'])
    expect(p.items.map((i) => i.quantity)).toEqual([10, 5])
  })

  it('digit glued to unit: "120sqm" splits into quantity + unit', () => {
    const p = parseQuantities('slab 120sqm')
    expect(p.items[0]).toMatchObject({ activity: 'slab', quantity: 120, unit: 'sqm' })
  })

  it('no quantity at all: activity only, still a valid item', () => {
    const p = parseQuantities('finished the column shuttering')
    expect(p.items).toEqual([
      { activity: 'column shuttering', quantity: null, unit: null, raw: 'finished the column shuttering', numbers_discarded: false },
    ])
  })

  it('decimal quantity survives intact — FIX: was truncating to 12 with a stray "." leaking into activity', () => {
    const p = parseQuantities('12.5 cum concrete')
    expect(p.items[0]).toMatchObject({ activity: 'concrete', quantity: 12.5, unit: 'cum' })
    expect(p.items[0].activity).not.toContain('.')
  })

  it('ordinal floor/level reference does not steal the quantity slot — FIX: "2nd" was captured as quantity=2', () => {
    const p = parseQuantities('block work 2nd floor 45 sqm')
    expect(p.items[0]).toMatchObject({ activity: 'block 2nd floor', quantity: 45, unit: 'sqm' })
  })

  it('ordinal awareness generalises beyond "2nd" — 21st, 3rd, 4th', () => {
    expect(parseQuantities('grid 21st column 8 nos').items[0]).toMatchObject({
      activity: 'grid 21st column',
      quantity: 8,
    })
    expect(parseQuantities('level 3rd slab 60 sqm').items[0]).toMatchObject({
      activity: 'level 3rd slab',
      quantity: 60,
    })
    expect(parseQuantities('4th floor plastering 200 sft').items[0]).toMatchObject({
      activity: '4th floor plastering',
      quantity: 200,
    })
  })

  it('a lone ordinal with no other quantity: contributes to activity, quantity stays null', () => {
    const p = parseQuantities('checked 2nd floor')
    expect(p.items[0]).toMatchObject({ activity: 'checked 2nd floor', quantity: null })
  })

  it('quantity stopwords excluded from the activity name', () => {
    const p = parseQuantities('plastering done approx 300 sft today')
    expect(p.items[0]).toMatchObject({ activity: 'plastering', quantity: 300, unit: 'sqft' })
  })

  it('first number in a chunk wins when no ordinal is involved', () => {
    const p = parseQuantities('100 rmt piping plus 50 rft cable tray')
    expect(p.items[0]).toMatchObject({ activity: 'piping', quantity: 100, unit: 'rmt', numbers_discarded: false })
    expect(p.items[1]).toMatchObject({ activity: 'cable tray', quantity: 50, unit: 'rft', numbers_discarded: false })
  })

  it('empty answer: neutral non-answer, never a reask trigger (Q1 is not gated)', () => {
    const p = parseQuantities('   ')
    expect(p.items).toEqual([])
    expect(p.raw_text).toBe('')
  })

  it('raw_text always preserved verbatim (trimmed), even with rich items', () => {
    const p = parseQuantities('  slab concrete 120 sqm  ')
    expect(p.raw_text).toBe('slab concrete 120 sqm')
  })

  it('raw is preserved per item, exactly as the engineer wrote that chunk', () => {
    const p = parseQuantities('Slab Concrete 120 SQM')
    expect(p.items[0].raw).toBe('Slab Concrete 120 SQM')
  })
})

describe('parseQuantities — numbers_discarded (2026-08-10, found alongside the productivity bug)', () => {
  it('THE RECORDED FINDING: "Poured 40 cum M25 slab level3" drops the grade and level numerals', () => {
    const p = parseQuantities('Poured 40 cum M25 slab level3')
    expect(p.items[0]).toMatchObject({
      activity: 'poured slab level',
      quantity: 40,
      unit: 'cum',
      numbers_discarded: true,
    })
  })

  it('a bare second number in one chunk (no ordinal, no unit) trips the guard', () => {
    const p = parseQuantities('slab 40 cum 12')
    expect(p.items[0]).toMatchObject({ activity: 'slab', quantity: 40, unit: 'cum', numbers_discarded: true })
  })

  it('an ordinal-suffixed number ("2nd") is consumed meaningfully, NOT a discard', () => {
    const p = parseQuantities('block work 2nd floor 45 sqm')
    expect(p.items[0]).toMatchObject({ numbers_discarded: false })
  })

  it('a single, clean number never trips the guard', () => {
    const p = parseQuantities('slab concrete 120 sqm')
    expect(p.items[0]).toMatchObject({ numbers_discarded: false })
  })
})
