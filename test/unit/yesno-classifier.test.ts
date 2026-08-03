import { describe, it, expect } from 'vitest'
import { classifyYesNo } from '@/lib/whatsapp/flows/parsers/lexicon'

// Pure unit tests for the evening Q2 yes/no classifier. Unlike the other
// parsers, this ONE resolves to a stored BOOLEAN (evening_schedule_met), so
// classification confidence genuinely matters — see the COVERAGE HONESTY note
// in lexicon.ts. Token-wise; a negative token anywhere wins over an
// affirmative one (the pessimistic reading routes to Q3 and captures the
// reason rather than rounding a hedge up to success).

describe('classifyYesNo', () => {
  it.each(['yes', 'y', 'yeah', 'yep', 'yup', 'ok', 'okay', 'done', 'completed', 'achieved', 'met', 'full', 'fully'])(
    'affirmative token %s -> met:true, ok:true',
    (word) => {
      expect(classifyYesNo(word)).toEqual({ met: true, ok: true })
    },
  )

  it.each(['no', 'n', 'nope', 'not', 'incomplete', 'pending', 'delayed', 'missed', 'short'])(
    'negative token %s -> met:false, ok:true',
    (word) => {
      expect(classifyYesNo(word)).toEqual({ met: false, ok: true })
    },
  )

  it.each(['partly', 'partial', 'partially', 'mostly', 'half', 'some'])(
    'partial-completion word %s classifies as NOT MET (never rounded up to success)',
    (word) => {
      expect(classifyYesNo(word)).toEqual({ met: false, ok: true })
    },
  )

  it('is case-insensitive', () => {
    expect(classifyYesNo('YES')).toEqual({ met: true, ok: true })
    expect(classifyYesNo('NO')).toEqual({ met: false, ok: true })
  })

  it('sentence-form affirmative: "Yes fully done"', () => {
    expect(classifyYesNo('Yes fully done')).toEqual({ met: true, ok: true })
  })

  it('sentence-form negative: "no, half only"', () => {
    expect(classifyYesNo('no, half only')).toEqual({ met: false, ok: true })
  })

  it('a negative token anywhere wins over an affirmative one', () => {
    // "yes but only half" carries both an affirmative and a hedge; the
    // pessimistic reading (not met) wins by design.
    expect(classifyYesNo('yes but only half')).toEqual({ met: false, ok: true })
    expect(classifyYesNo('not really')).toEqual({ met: false, ok: true })
  })

  it('shared NONE_WORDS negatives (illa) also classify as not-met', () => {
    expect(classifyYesNo('illa')).toEqual({ met: false, ok: true })
  })

  it('unclassifiable text -> ok:false (drives the Q2 reask)', () => {
    expect(classifyYesNo('maybe')).toEqual({ met: false, ok: false })
  })

  it('empty / whitespace-only -> ok:false', () => {
    expect(classifyYesNo('')).toEqual({ met: false, ok: false })
    expect(classifyYesNo('   ')).toEqual({ met: false, ok: false })
  })
})
