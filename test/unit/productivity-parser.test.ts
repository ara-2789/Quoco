import { describe, it, expect } from 'vitest'
import { parseProductivity, isProductivityAnswered } from '@/lib/whatsapp/flows/parsers/productivity'

// Pure unit tests for the Q4 step 2 (productivity/idle) parser. AGGREGATE-ONLY
// v1 (design-decisions-beta-feedback.md §9) — no trade breakdown is ever
// produced; these tests don't look for one.

describe('parseProductivity', () => {
  it('all productive: "yes"', () => {
    const p = parseProductivity('yes')
    expect(p.all_productive).toBe(true)
    expect(p.idle_count).toBeNull()
    expect(p.idle_reason).toBeNull()
    expect(isProductivityAnswered(p)).toBe(true)
  })

  it('all productive: "fully done"', () => {
    const p = parseProductivity('fully done')
    expect(p.all_productive).toBe(true)
  })

  it('some idle with NO no/hedge word at all — a bare number is its own signal', () => {
    // The most natural real answer: no "no", just the count + reason.
    const p = parseProductivity('2 idle, cement shortage')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('cement shortage')
  })

  it('some idle with count and reason', () => {
    const p = parseProductivity('2 idle waiting for cement')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('waiting for cement')
    expect(isProductivityAnswered(p)).toBe(true)
  })

  it('"no" prefix still resolves to some-idle with the count', () => {
    const p = parseProductivity('no, 3 idle - rain')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(3)
    expect(p.idle_reason).toBe('rain')
  })

  it('hedge word alone ("mostly") resolves to some-idle, no count given', () => {
    const p = parseProductivity('mostly')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBeNull()
    expect(p.idle_reason).toBeNull()
  })

  it('some idle with no reason: idle_reason null', () => {
    const p = parseProductivity('2 idle')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBeNull()
  })

  it('unclassifiable: neither yes nor no/hedge vocabulary', () => {
    const p = parseProductivity('site is busy today')
    expect(p.all_productive).toBeNull()
    expect(p.idle_count).toBeNull()
    expect(isProductivityAnswered(p)).toBe(false)
  })

  it('empty answer: unclassifiable, raw preserved as empty', () => {
    const p = parseProductivity('   ')
    expect(p.all_productive).toBeNull()
    expect(p.raw_text).toBe('')
    expect(isProductivityAnswered(p)).toBe(false)
  })

  it('raw_text is always preserved verbatim (trimmed)', () => {
    const p = parseProductivity('  2 idle waiting for cement  ')
    expect(p.raw_text).toBe('2 idle waiting for cement')
  })

  it('digit glued to a word: split at the boundary', () => {
    const p = parseProductivity('no 2idle cement delay')
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('cement delay')
  })
})

describe('parseProductivity — anchor-word pairing (2026-08-10 fix, real sandbox bug)', () => {
  it('THE ACTUAL INCIDENT: "15 productive, 3 idle waiting for material" — both counts correct, not inverted', () => {
    const p = parseProductivity('15 productive, 3 idle waiting for material')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBe(15)
    expect(p.idle_count).toBe(3)
    expect(p.idle_reason).toBe('waiting for material')
    expect(p.numbers_discarded).toBe(false)
  })

  it('order-independent: "3 idle, 15 productive" resolves identically to the incident phrasing', () => {
    const p = parseProductivity('3 idle, 15 productive')
    expect(p.productive_count).toBe(15)
    expect(p.idle_count).toBe(3)
  })

  it('productive-only, no idle number at all: "18 productive"', () => {
    const p = parseProductivity('18 productive')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBe(18)
    expect(p.idle_count).toBeNull()
    expect(p.numbers_discarded).toBe(false)
  })

  it('idle-only still defaults with no anchor at all — unchanged, backward compatible', () => {
    const p = parseProductivity('3 idle waiting for material')
    expect(p.idle_count).toBe(3)
    expect(p.productive_count).toBeNull()
    expect(p.numbers_discarded).toBe(false)
  })
})

describe('parseProductivity — numbers_discarded: the general guard, independent of anchor words', () => {
  it('two numbers, NEITHER anchored: genuinely ambiguous, not a positional guess', () => {
    const p = parseProductivity('15, 3 waiting for material')
    expect(p.idle_count).toBeNull()
    expect(p.productive_count).toBeNull()
    expect(p.numbers_discarded).toBe(true)
  })

  it('a number with no anchor, arriving alongside one that IS anchored, is discarded rather than guessed', () => {
    const p = parseProductivity('5 10 idle')
    expect(p.idle_count).toBe(10)
    expect(p.productive_count).toBeNull()
    expect(p.numbers_discarded).toBe(true)
  })

  it('single unanchored number (the common, unambiguous case) never trips the guard', () => {
    const p = parseProductivity('2 idle waiting for cement')
    expect(p.numbers_discarded).toBe(false)
  })

  it('a YES_WORD with a trailing number now falls through instead of short-circuiting (was wrong pre-Defect-1-fix)', () => {
    // Superseded expectation: this test originally asserted all_productive:
    // true here, treating the trailing "18" as harmless. Post-fix it is
    // exactly why hasDigit gates the early return — "yes all 18 productive"
    // anchors productive_count:18 instead of discarding it. See DEFECT 1
    // in productivity.ts's own header for the full incident this covers.
    const p = parseProductivity('yes all 18 productive')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBe(18)
    expect(p.idle_count).toBeNull()
    expect(p.numbers_discarded).toBe(false)
  })

  it('a YES_WORD with no digit and no idle word still short-circuits cleanly', () => {
    const p = parseProductivity('yes all productive')
    expect(p.all_productive).toBe(true)
    expect(p.numbers_discarded).toBe(false)
  })
})

describe('parseProductivity — DEFECT 1: a YES_WORD must not mask a stated idle count', () => {
  it('THE DEFECT: "ok, 2 idle waiting for cement" — ok is a YES_WORD, idle is not a NO_WORD, used to discard the count entirely', () => {
    const p = parseProductivity('ok, 2 idle waiting for cement')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('waiting for cement')
    expect(p.numbers_discarded).toBe(false)
  })

  it('"yes all productive" — unchanged: no digit, no idle word, still short-circuits', () => {
    const p = parseProductivity('yes all productive')
    expect(p.all_productive).toBe(true)
    expect(p.idle_count).toBeNull()
    expect(p.productive_count).toBeNull()
  })

  it('"ok" alone — unchanged: no digit, no idle word, still short-circuits', () => {
    const p = parseProductivity('ok')
    expect(p.all_productive).toBe(true)
  })

  it('"yes all 18 productive" — falls through, anchors productive_count:18, idle stays null', () => {
    const p = parseProductivity('yes all 18 productive')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBe(18)
    expect(p.idle_count).toBeNull()
  })

  it('"ok 2 idle waiting for cement" — the fix: falls through, idle_count:2, reason preserved', () => {
    const p = parseProductivity('ok 2 idle waiting for cement')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('waiting for cement')
  })

  // ANCHOR-MATCH STRENGTH (2026-08-12, external review of the 024+025
  // catch-up package) — see this file's own header note for the full
  // incident. 'all' is not a YES_WORD, so neither of the next two messages
  // short-circuits at classifyYesNo; both fall through to Pass 1, where the
  // pre-fix AFTER fallback claimed the number for 'productive' with no
  // signal that it was a guess.

  it('"all productive, 2 left early" — no confident BEFORE match for \'productive\' within bound; AFTER claims "2" but WEAK MATCHES ARE CLAIMED, NEVER STORED — both counts null, not a guess', () => {
    const p = parseProductivity('all productive, 2 left early')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBeNull()
    expect(p.idle_count).toBeNull()
    expect(p.numbers_discarded).toBe(true) // the weak-match signal, not a literally-discarded token
  })

  it('"yes all productive, 2 machines idle" — same shape, \'idle\' also finds nothing within reach (its only candidate digit was already claimed by the weak match above)', () => {
    const p = parseProductivity('yes all productive, 2 machines idle')
    expect(p.all_productive).toBe(false)
    expect(p.productive_count).toBeNull()
    expect(p.idle_count).toBeNull()
    expect(p.numbers_discarded).toBe(true)
  })

  it('"productive 15" — THE TRAP CASE: if the weak match left "15" unclaimed instead of claimed, Pass 2\'s single-unclaimed-defaults-to-idle rule would resolve this to idle_count:15, numbers_discarded:false, confidence HIGH — a brand-new confidently-inverted bug created by this very fix. Must not happen.', () => {
    const p = parseProductivity('productive 15')
    expect(p.productive_count).toBeNull()
    expect(p.idle_count).toBeNull()
    expect(p.numbers_discarded).toBe(true)
  })

  it('"3 men idle, 15 men productive" — BOUNDED BACKWARD SCAN: one intervening token ("men") is within bound, both anchors resolve via a STRONG BEFORE match', () => {
    const p = parseProductivity('3 men idle, 15 men productive')
    expect(p.idle_count).toBe(3)
    expect(p.productive_count).toBe(15)
    expect(p.numbers_discarded).toBe(false) // both STRONG — no weak match, nothing discarded
  })

  it('NEGATIVE — "ok 2 idle waiting for cement" stays a STRONG (immediate) BEFORE match, not weak', () => {
    const p = parseProductivity('ok 2 idle waiting for cement')
    expect(p.idle_count).toBe(2)
    expect(p.numbers_discarded).toBe(false)
  })

  it('NEGATIVE — "yes all 18 productive" stays a STRONG (immediate) BEFORE match, not weak', () => {
    const p = parseProductivity('yes all 18 productive')
    expect(p.productive_count).toBe(18)
    expect(p.numbers_discarded).toBe(false)
  })

  it('backward scan does not reach past the bound — two intervening non-digit tokens between a number and its anchor stay unpaired, falling to Pass 2 or discard', () => {
    // "15" is TWO tokens back from 'productive' ("site", "men") — outside
    // BEFORE_SCAN_MAX_BACK (bounded to one intervening token). No AFTER
    // number exists either, so 'productive' claims nothing at all here;
    // "15" is left for Pass 2, which — being the only unclaimed digit and
    // idle_count still null — defaults it to idle_count instead (Pass 2's
    // own long-standing behaviour, unchanged by this fix).
    const p = parseProductivity('15 site men productive')
    expect(p.productive_count).toBeNull()
    expect(p.idle_count).toBe(15)
  })
})
