import { describe, it, expect } from 'vitest'
import { classifyYesNo } from '@/lib/whatsapp/flows/parsers/lexicon'

// Pure unit tests for classifyYesNo. Originally the evening Q2 classifier
// only (resolves to a stored BOOLEAN, evening_schedule_met, so classification
// confidence genuinely matters — see the COVERAGE HONESTY note in
// lexicon.ts); morning Q1/holiday-follow-up became consumers via migration
// 030's SQL port. Token-wise; a negative token anywhere wins over an
// affirmative one (the pessimistic reading routes to Q3 and captures the
// reason rather than rounding a hedge up to success).
//
// RE-TUNED FOR ATTENDANCE, 2026-08-24 (external review round 2, review
// package §11.5): 'half' moved from a NOT-MET partial word to an affirmative
// ('half day' describes a present engineer, not an unmet plan) — see
// lexicon.ts's own RE-TUNED note. ACCEPTED COST, recorded here explicitly
// rather than silently changed: on THIS file's own subject, evening Q2,
// "yes but only half" — a genuine schedule hedge — now classifies MET
// instead of NOT MET, for the one-migration window before evening Q2 is
// deleted (§30(a)).

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

  it.each(['partly', 'partial', 'partially', 'mostly', 'some'])(
    'partial-completion word %s classifies as NOT MET (never rounded up to success)',
    (word) => {
      expect(classifyYesNo(word)).toEqual({ met: false, ok: true })
    },
  )

  it.each(['half', 'half-day', 'late', 'coming', 'come', 'reaching', 'reached', 'way'])(
    'attendance present-side form %s classifies as MET (added 2026-08-24, see RE-TUNED note above)',
    (word) => {
      expect(classifyYesNo(word)).toEqual({ met: true, ok: true })
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
    // Still met:false -- 'no' itself is the negative that wins here,
    // regardless of 'half' now being affirmative (see RE-TUNED note above).
    expect(classifyYesNo('no, half only')).toEqual({ met: false, ok: true })
  })

  it('a negative token anywhere wins over an affirmative one', () => {
    // "yes but pending" carries both an affirmative and a hedge; the
    // pessimistic reading (not met) wins by design. (Replaces the former
    // "yes but only half" example here -- 'half' is affirmative since the
    // 2026-08-24 retune, so it no longer demonstrates this rule; that
    // specific input now has its own test below instead.)
    expect(classifyYesNo('yes but pending')).toEqual({ met: false, ok: true })
    expect(classifyYesNo('not really')).toEqual({ met: false, ok: true })
  })

  it('"yes but only half" classifies MET since the 2026-08-24 retune (ACCEPTED COST, see header note)', () => {
    expect(classifyYesNo('yes but only half')).toEqual({ met: true, ok: true })
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
