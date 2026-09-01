import { describe, it, expect } from 'vitest'
import { parseIdleHoursByTrade, isIdleHoursAnswered } from '@/lib/whatsapp/flows/parsers/idle-hours'

// Pure unit tests for the NEW evening step 3 parser (migration 035
// restructuring). Two design rulings this file exists specifically to guard,
// both from Aravind's round-3 review:
//
// 1. REJECTED: reusing classifyYesNo for "all working" detection. Its
//    present-side attendance forms ("half day", "late") mean the OPPOSITE
//    thing on an idle-hours question. "half day on the idle question must
//    NOT read as zero idle" is a named regression guard below, not a
//    hypothetical.
// 2. NEW: an unparseable answer must record UNKNOWN, never a fabricated
//    zero. "an unparseable idle answer must record unknown rather than
//    zero" is a named regression guard below.

describe('parseIdleHoursByTrade — tri-state (by_trade / all_working / unknown)', () => {
  it('real by-trade data: not all_working, not unknown', () => {
    const p = parseIdleHoursByTrade('mason idle 2 hours, helper idle 1 hour')
    expect(p.by_trade).toEqual([
      { trade: 'mason', idle_hours: 2, matched: true },
      { trade: 'helper', idle_hours: 1, matched: true },
    ])
    expect(p.all_working).toBe(false)
    expect(p.unknown).toBe(false)
    expect(isIdleHoursAnswered(p)).toBe(true)
  })

  describe('CONFIDENT ZERO — purpose-built "all working" sentinel (not classifyYesNo)', () => {
    for (const phrase of ['all working', 'everyone working', 'fully productive', 'no idle', 'none', 'nobody idle']) {
      it(`"${phrase}" -> all_working:true, unknown:false, empty by_trade`, () => {
        const p = parseIdleHoursByTrade(phrase)
        expect(p.by_trade).toEqual([])
        expect(p.all_working).toBe(true)
        expect(p.unknown).toBe(false)
        expect(isIdleHoursAnswered(p)).toBe(true)
      })
    }

    it('a trailing sentence after the sentinel still resolves', () => {
      const p = parseIdleHoursByTrade('all working today, no issues')
      expect(p.all_working).toBe(true)
      expect(p.unknown).toBe(false)
    })
  })

  describe('REGRESSION GUARD (2): "half day" must NOT read as zero idle', () => {
    it('"half day" is UNKNOWN, never all_working — the exact classifyYesNo inversion this design avoids', () => {
      // On an ATTENDANCE question, classifyYesNo reads "half day" as
      // met:true (present). On THIS question, "half day" plausibly means
      // half the day WAS idle -- the opposite claim. This parser must never
      // reuse that classification, so "half day" here resolves to UNKNOWN
      // (no number, no purpose-built sentinel match), not a confident zero.
      const p = parseIdleHoursByTrade('half day')
      expect(p.all_working).toBe(false)
      expect(p.unknown).toBe(true)
      expect(p.by_trade).toEqual([])
      expect(isIdleHoursAnswered(p)).toBe(false)
    })

    it('other attendance-lexicon present-side forms are equally not treated as zero idle', () => {
      for (const phrase of ['late', 'coming late', 'reached site']) {
        const p = parseIdleHoursByTrade(phrase)
        expect(p.all_working).toBe(false)
      }
    })
  })

  describe('REGRESSION GUARD (3): unparseable records UNKNOWN, never a fabricated zero', () => {
    it('genuinely garbled text: unknown:true, all_working:false, empty by_trade', () => {
      const p = parseIdleHoursByTrade('asdkjh qwerty')
      expect(p.by_trade).toEqual([])
      expect(p.all_working).toBe(false)
      expect(p.unknown).toBe(true)
      expect(isIdleHoursAnswered(p)).toBe(false)
    })

    it('empty answer: unknown:true (handled upstream as the ordinary empty-answer reask, but never a fabricated zero if it reaches storage)', () => {
      const p = parseIdleHoursByTrade('   ')
      expect(p.by_trade).toEqual([])
      expect(p.all_working).toBe(false)
      expect(p.unknown).toBe(true)
      expect(p.raw_text).toBe('')
    })

    it('unknown is NEVER true at the same time as all_working or real data', () => {
      const cases = ['mason idle 2 hours', 'all working', 'half day', '']
      for (const c of cases) {
        const p = parseIdleHoursByTrade(c)
        const states = [p.by_trade.length > 0, p.all_working, p.unknown].filter(Boolean)
        expect(states.length).toBe(1) // exactly one of the three states is true
      }
    })
  })

  describe('§42 unmatched-token capture', () => {
    it('an unmatched trade is captured with matched:false and original case', () => {
      const p = parseIdleHoursByTrade('mason idle 2 hours, PEB idle 3 hours')
      expect(p.by_trade).toEqual([
        { trade: 'mason', idle_hours: 2, matched: true },
        { trade: 'PEB', idle_hours: 3, matched: false },
      ])
    })

    it('pure filler words next to a number are not captured as a fake trade', () => {
      const p = parseIdleHoursByTrade('2 hours idle for the team')
      // "for"/"the" are filler; nothing word-like enough survives as a trade
      // candidate other than filler -- so this stays a single anchorless
      // reading rather than manufacturing a trade out of a stopword. Either
      // an empty match (unknown, if no digit reachable this way) or a
      // filler-free capture is acceptable; what matters is no filler word
      // ever becomes a `trade` value.
      const tradesFound = p.by_trade.map((t) => t.trade.toLowerCase())
      expect(tradesFound).not.toContain('for')
      expect(tradesFound).not.toContain('the')
    })
  })
})
