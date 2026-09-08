import { describe, it, expect } from 'vitest'
import {
  withinHindranceWindow,
  orderHindranceQueue,
  HINDRANCE_WINDOW_DAYS,
  type HindranceTiming,
} from '@/lib/hindrance/queue'

// Pure unit tests for the DASH-07 window predicate and ordering
// (docs/plans/dash-07-hindrance-queue.md §The window, §Ordering). No
// Supabase client involved -- getHindranceQueue's DB-touching half is not
// covered here (this track does not write to test-db, per the task's hard
// constraint).

describe('withinHindranceWindow', () => {
  // Fixed "now" in IST: 2026-09-20 12:00 IST == 2026-09-20T06:30:00Z.
  const now = new Date('2026-09-20T06:30:00Z')

  it('active is exempt at any age -- the explicit exemption clause', () => {
    const veryOld = new Date('2020-01-01T00:00:00Z').toISOString()
    expect(withinHindranceWindow('active', veryOld, now)).toBe(true)
  })

  it('potential inside the 14-day window is shown', () => {
    // 5 IST calendar days before "now".
    const recent = new Date('2026-09-15T06:30:00Z').toISOString()
    expect(withinHindranceWindow('potential', recent, now)).toBe(true)
  })

  it('potential exactly at the 14-day boundary is shown (inclusive)', () => {
    const boundary = new Date('2026-09-06T06:30:00Z').toISOString() // 14 IST calendar days back
    expect(withinHindranceWindow('potential', boundary, now)).toBe(true)
  })

  it('potential past the 14-day window is hidden', () => {
    const old = new Date('2026-09-05T06:30:00Z').toISOString() // 15 IST calendar days back
    expect(withinHindranceWindow('potential', old, now)).toBe(false)
  })

  it('unspecified gets the same 14-day window as potential -- the spec names only active as exempt', () => {
    const old = new Date('2026-09-05T06:30:00Z').toISOString()
    expect(withinHindranceWindow('unspecified', old, now)).toBe(false)
  })

  it('a UTC-instant subtraction would get the boundary wrong across the IST offset -- this predicate must not', () => {
    // 22:00 UTC on 2026-09-05 is already 2026-09-06 03:30 IST -- a naive UTC
    // calendar-day diff would call this 15 days back (hidden); the real IST
    // calendar-day diff is 14 days back (still shown).
    const lateUtc = new Date('2026-09-05T22:00:00Z').toISOString()
    expect(withinHindranceWindow('potential', lateUtc, now)).toBe(true)
  })

  it(`HINDRANCE_WINDOW_DAYS is ${14}`, () => {
    expect(HINDRANCE_WINDOW_DAYS).toBe(14)
  })
})

describe('orderHindranceQueue', () => {
  type Item = { id: string; timing: HindranceTiming; createdAt: string }

  it('groups active -> unspecified -> potential, regardless of input order', () => {
    const items: Item[] = [
      { id: 'p1', timing: 'potential', createdAt: '2026-09-10T00:00:00Z' },
      { id: 'a1', timing: 'active', createdAt: '2026-09-11T00:00:00Z' },
      { id: 'u1', timing: 'unspecified', createdAt: '2026-09-12T00:00:00Z' },
    ]
    const ordered = orderHindranceQueue(items)
    expect(ordered.map((i) => i.id)).toEqual(['a1', 'u1', 'p1'])
  })

  it('orders oldest-first within a group', () => {
    const items: Item[] = [
      { id: 'a-new', timing: 'active', createdAt: '2026-09-15T00:00:00Z' },
      { id: 'a-old', timing: 'active', createdAt: '2026-09-01T00:00:00Z' },
    ]
    const ordered = orderHindranceQueue(items)
    expect(ordered.map((i) => i.id)).toEqual(['a-old', 'a-new'])
  })

  it('does not mutate the input array', () => {
    const items: Item[] = [
      { id: 'p1', timing: 'potential', createdAt: '2026-09-10T00:00:00Z' },
      { id: 'a1', timing: 'active', createdAt: '2026-09-11T00:00:00Z' },
    ]
    const originalOrder = items.map((i) => i.id)
    orderHindranceQueue(items)
    expect(items.map((i) => i.id)).toEqual(originalOrder)
  })
})
