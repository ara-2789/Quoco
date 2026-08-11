import { describe, it, expect } from 'vitest'
import { extractDigitTokens, buildExecutionCorpus, checkContainment } from '@/lib/dpr/containment'
import type { ExecutionOutputFacts } from '@/lib/dpr/schema'

describe('extractDigitTokens', () => {
  it('extracts a bare integer', () => {
    expect(extractDigitTokens('poured 40 cum')).toEqual(new Set([40]))
  })

  it('normalizes a thousands separator to the same value as no separator', () => {
    expect(extractDigitTokens('cost Rs 4,730')).toEqual(new Set([4730]))
    expect(extractDigitTokens('cost Rs 4730')).toEqual(new Set([4730]))
  })

  it('normalizes a trailing-zero decimal to the same value as the shorter form', () => {
    expect(extractDigitTokens('37.50')).toEqual(new Set([37.5]))
    expect(extractDigitTokens('37.5')).toEqual(new Set([37.5]))
  })

  it('splits a date into its separate digit components', () => {
    expect(extractDigitTokens('2026-08-09')).toEqual(new Set([2026, 8, 9]))
  })

  it('extracts the digit portion of an ordinal, ignoring the suffix', () => {
    expect(extractDigitTokens('2nd floor')).toEqual(new Set([2]))
  })

  it('extracts the digit portion of a grade identifier', () => {
    expect(extractDigitTokens('M25 concrete')).toEqual(new Set([25]))
  })

  it('empty string yields an empty set', () => {
    expect(extractDigitTokens('')).toEqual(new Set())
  })

  it('multiple distinct numbers in one string are all captured', () => {
    expect(extractDigitTokens('8 hours, 6 actual')).toEqual(new Set([8, 6]))
  })
})

describe('buildExecutionCorpus', () => {
  const meta = { project_name: 'Site A - Tower 2', log_date: '2026-08-09' }

  it('includes reported quantity values', () => {
    const execution: ExecutionOutputFacts = {
      quantities: [{ activity: 'shuttering', quantity: { status: 'reported', value: 40 }, unit: 'cum' }],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    expect(corpus.has(40)).toBe(true)
  })

  it('does NOT include a not_captured quantity value (there is none to add)', () => {
    const execution: ExecutionOutputFacts = {
      quantities: [{ activity: 'finished the column shuttering', quantity: { status: 'not_captured', value: null }, unit: '' }],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    expect(corpus.size).toBeGreaterThan(0) // project/date framing still present
    // no numeric quantity token exists anywhere in this fixture's activity text
    expect(Array.from(corpus)).not.toContain(NaN)
  })

  it('includes digits embedded in an activity name (ordinals, grade identifiers)', () => {
    const execution: ExecutionOutputFacts = {
      quantities: [
        { activity: 'poured M25 concrete, Tower 2 slab, 2nd floor', quantity: { status: 'reported', value: 40 }, unit: 'cum' },
      ],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    expect(corpus.has(25)).toBe(true) // from "M25"
    expect(corpus.has(2)).toBe(true) // from "Tower 2" / "2nd"
    expect(corpus.has(40)).toBe(true) // the quantity itself
  })

  it('includes a suppressed item\'s activity-name digits even though its quantity is withheld', () => {
    const execution: ExecutionOutputFacts = {
      quantities: [
        {
          activity: 'slab pour Tower 2',
          quantity: { status: 'not_captured', value: null },
          unit: 'cum',
          suppressed: { reason: 'same_activity_overlap', engineer_count: 2 },
        },
      ],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    expect(corpus.has(2)).toBe(true) // from "Tower 2" in the activity string
  })

  it('includes project name and log date framing', () => {
    const corpus = buildExecutionCorpus({ quantities: [] }, meta)
    expect(corpus.has(2)).toBe(true) // "Tower 2" in project_name
    expect(corpus.has(2026)).toBe(true)
    expect(corpus.has(8)).toBe(true)
    expect(corpus.has(9)).toBe(true)
  })
})

describe('checkContainment — section-scoped, not whole-prompt', () => {
  const meta = { project_name: 'Site A', log_date: '2026-08-09' }
  const execution: ExecutionOutputFacts = {
    quantities: [{ activity: 'shuttering, Tower 2', quantity: { status: 'reported', value: 40 }, unit: 'cum' }],
  }
  const corpus = buildExecutionCorpus(execution, meta)

  it('a real execution Fact value passes', () => {
    const result = checkContainment('Completed 40 cum of shuttering on Tower 2.', corpus)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('a genuinely invented number fails', () => {
    const result = checkContainment('Completed 55 cum of shuttering.', corpus)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([55])
  })

  it('THE CASE READING A EXISTS TO CATCH: a real number from a DIFFERENT section is still a violation — it is a fabrication wearing a real number, not a legitimate cross-reference', () => {
    // 1500 is a real equipment daily_hire_cost elsewhere in the same report,
    // but it is not an execution Fact — a whole-Facts (union) corpus would
    // wrongly pass this; a section-scoped one correctly rejects it.
    const result = checkContainment('Productivity was strong, output valued at 1500.', corpus)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([1500])
  })

  it('no digits at all trivially passes', () => {
    const result = checkContainment('Shuttering work progressed well today.', corpus)
    expect(result.ok).toBe(true)
  })
})
