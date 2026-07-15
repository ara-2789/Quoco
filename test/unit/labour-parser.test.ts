import { describe, it, expect } from 'vitest'
import { parseLabourCount, isLabourAnswered } from '@/lib/whatsapp/flows/parsers/labour'

// Pure unit tests for the Q2 labour parser. The "zoo" deliberately includes the
// terse Tamil/English mixed inputs the Chennai beta actually sends. The parser
// never blocks: planned_total is null ONLY when no digit appears at all (the one
// reask trigger); everything else yields a count with best-effort trade
// enrichment.

describe('parseLabourCount', () => {
  it('bare number: total set, no trade breakdown', () => {
    const p = parseLabourCount('12')
    expect(p.planned_total).toBe(12)
    expect(p.by_trade).toEqual([])
    expect(p.raw_text).toBe('12')
    expect(isLabourAnswered(p)).toBe(true)
  })

  it('English breakdown: sums total and attributes trades', () => {
    const p = parseLabourCount('12 mason 8 helper')
    expect(p.planned_total).toBe(20)
    expect(p.by_trade).toEqual([
      { trade: 'mason', planned_count: 12 },
      { trade: 'helper', planned_count: 8 },
    ])
  })

  it('trade-before-number order also attributes', () => {
    const p = parseLabourCount('mason 10')
    expect(p.planned_total).toBe(10)
    expect(p.by_trade).toEqual([{ trade: 'mason', planned_count: 10 }])
  })

  it('transliterated Tamil trades: mesthiri + coolie map to canonical', () => {
    const p = parseLabourCount('6 mesthiri 10 coolie')
    expect(p.planned_total).toBe(16)
    expect(p.by_trade).toEqual([
      { trade: 'mason', planned_count: 6 },
      { trade: 'helper', planned_count: 10 },
    ])
  })

  it('mixed Tamil/English with a non-trade word: number counts, no false trade', () => {
    // "aalu" (people) is not a trade term -> counted toward total, not attributed.
    const p = parseLabourCount('12 per aalu')
    expect(p.planned_total).toBe(12)
    expect(p.by_trade).toEqual([])
  })

  it('digit glued to a trade word: split at the boundary', () => {
    const p = parseLabourCount('8mason')
    expect(p.planned_total).toBe(8)
    expect(p.by_trade).toEqual([{ trade: 'mason', planned_count: 8 }])
  })

  it('comma-separated breakdown', () => {
    const p = parseLabourCount('12 mason, 8 helper, 2 carpenter')
    expect(p.planned_total).toBe(22)
    expect(p.by_trade).toEqual([
      { trade: 'mason', planned_count: 12 },
      { trade: 'helper', planned_count: 8 },
      { trade: 'carpenter', planned_count: 2 },
    ])
  })

  it('unknown trade next to a number: counted, not attributed', () => {
    const p = parseLabourCount('5 fabricator')
    expect(p.planned_total).toBe(5)
    expect(p.by_trade).toEqual([])
  })

  it('no digit anywhere: planned_total null -> reask trigger', () => {
    const p = parseLabourCount('some workers')
    expect(p.planned_total).toBeNull()
    expect(isLabourAnswered(p)).toBe(false)
  })

  it('empty answer: null total, raw preserved as empty', () => {
    const p = parseLabourCount('   ')
    expect(p.planned_total).toBeNull()
    expect(p.raw_text).toBe('')
    expect(isLabourAnswered(p)).toBe(false)
  })

  it('raw_text is always preserved verbatim (trimmed)', () => {
    const p = parseLabourCount('  15 mason  ')
    expect(p.raw_text).toBe('15 mason')
    expect(p.planned_total).toBe(15)
  })

  it('Tamil-script trade token is tolerated (counted, unattributed)', () => {
    // Not in the transliteration lexicon -> number still counts; never blocks.
    const p = parseLabourCount('10 கூலி')
    expect(p.planned_total).toBe(10)
    expect(isLabourAnswered(p)).toBe(true)
  })
})
