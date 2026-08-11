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

  it('includes project name framing', () => {
    const corpus = buildExecutionCorpus({ quantities: [] }, meta)
    expect(corpus.has(2)).toBe(true) // "Tower 2" in project_name
  })

  it('does NOT include log_date digits — design review, 2026-08-11: month (1-12) and day (1-31) sit in the same magnitude band as real construction quantities, and the model has no legitimate reason to cite the date (render.ts prints it code-side)', () => {
    // meta.log_date is '2026-08-09' in this suite's fixture; none of its
    // components should leak into the corpus via project/date framing.
    const corpus = buildExecutionCorpus({ quantities: [] }, meta)
    expect(corpus.has(2026)).toBe(false)
    expect(corpus.has(8)).toBe(false)
    expect(corpus.has(9)).toBe(false)
  })

  it('THE REGRESSION THIS FIX PREVENTS: a fabricated quantity matching a date component would have passed containment before this fix — it must not now', () => {
    const execution: ExecutionOutputFacts = { quantities: [] }
    const corpus = buildExecutionCorpus(execution, meta)
    // meta.log_date '2026-08-09' — before the fix, "9" would have been in
    // the corpus via date framing, letting a fabricated "completed 9 units"
    // pass. It must not pass now.
    const result = checkContainment('Completed 9 units of shuttering today.', corpus)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([9])
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

describe('checkContainment — NAMED LIMITATION (docs/design-decisions-beta-feedback.md §19): identifier-digit blessing within one section', () => {
  it('a real identifier digit ("M25") can be reused as a fabricated same-magnitude quantity in the SAME section — this is a known, accepted gap, not a silent one', () => {
    const meta = { project_name: 'Site A' }
    const execution: ExecutionOutputFacts = {
      quantities: [{ activity: 'poured M25 concrete', quantity: { status: 'reported', value: 40 }, unit: 'cum' }],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    // "25" is legitimately in the corpus via the "M25" identifier — this is
    // the correct, desired behavior (see the ordinal/identifier tests
    // above). The limitation is what happens NEXT: that same "25" can be
    // cited as an unrelated, fabricated quantity and still pass, because
    // containment is set-membership, not token-in-context matching.
    const result = checkContainment('Completed 25 bays of shuttering today.', corpus)
    expect(result.ok).toBe(true) // documents the gap — this SHOULD fail in an ideal check, and does not
  })
})

describe('buildExecutionCorpus — equipmentLabel() humanization (2026-08-11, PR #45+equipment-labels) does not affect containment at all', () => {
  it('a digit-bearing equipment identifier does not enter the execution corpus, because buildExecutionCorpus never receives equipment Facts — only ExecutionOutputFacts', () => {
    // "Cat320" is what equipmentLabel('cat320') produces for an unmatched
    // raw token that happens to contain digits (a model/identifier number,
    // e.g. a CAT 320 excavator) — a concrete case where the humanized
    // label DOES carry a digit, not just the digit-free "JCB Excavator"
    // example. buildExecutionCorpus's own type signature only accepts
    // ExecutionOutputFacts (compiler-enforced, not just untested) — the
    // real call site in generate.ts always passes facts.execution, never
    // facts.equipment — so this digit has no path into the corpus
    // regardless of what equipmentLabel() ever produces.
    const meta = { project_name: 'Site A' }
    const execution: ExecutionOutputFacts = {
      quantities: [{ activity: 'shuttering', quantity: { status: 'reported', value: 40 }, unit: 'cum' }],
    }
    const corpus = buildExecutionCorpus(execution, meta)
    // 320 was never given to buildExecutionCorpus in any form (it lives
    // only in a hypothetical EquipmentItemFacts.type, a different type this
    // function doesn't accept) — confirm it is genuinely absent, not
    // coincidentally present via some other path.
    expect(corpus.has(320)).toBe(false)
    // A narrative citing 320 correctly fails containment either way, same
    // as any other invented number — equipment-label humanization changes
    // nothing about this outcome.
    const result = checkContainment('Completed 320 units of shuttering.', corpus)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([320])
  })
})
