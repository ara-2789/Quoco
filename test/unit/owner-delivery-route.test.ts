import { describe, it, expect } from 'vitest'
import { decideOwnerDeliveryRoute } from '@/lib/dpr/owner-delivery-route'

// §37(c) of design-decisions-beta-feedback.md — "the gate is
// evening_submitted_at IS NULL — not 'no daily_logs row exists', and not
// 'partial data'." Fixtures below check exactly that precision: a real
// timestamp routes to 'report', anything meaning "no evening submission"
// routes to 'notice', and nothing else influences the decision.

describe('decideOwnerDeliveryRoute', () => {
  it('routes to notice when evening_submitted_at is null (the documented gate)', () => {
    expect(decideOwnerDeliveryRoute(null)).toBe('notice')
  })

  it('routes to notice when evening_submitted_at is undefined (a missing row reads the same as a present-but-null column, per §37(c))', () => {
    expect(decideOwnerDeliveryRoute(undefined)).toBe('notice')
  })

  it('routes to report when evening_submitted_at is a real ISO timestamp string', () => {
    expect(decideOwnerDeliveryRoute('2026-08-31T14:15:00.000Z')).toBe('report')
  })

  it('routes to report when evening_submitted_at is a Date instance', () => {
    expect(decideOwnerDeliveryRoute(new Date('2026-08-31T14:15:00.000Z'))).toBe('report')
  })

  it('is a pure function — repeated calls with the same input return the same result', () => {
    expect(decideOwnerDeliveryRoute(null)).toBe(decideOwnerDeliveryRoute(null))
    const ts = '2026-08-31T14:15:00.000Z'
    expect(decideOwnerDeliveryRoute(ts)).toBe(decideOwnerDeliveryRoute(ts))
  })

  it('a morning-only day (real morning data, no evening submission) still routes to notice — the gate is evening-only, per §37(c)\'s own correction of the narrower "no row" framing', () => {
    // Simulates the exact scenario §37(c) exists to address: a daily_logs
    // row DOES exist (attendance recorded, plan captured — a morning-only
    // day), but evening_submitted_at is still null. This function only
    // ever sees evening_submitted_at, so a morning-only day is
    // indistinguishable from no row at all — which is the documented
    // intent, not an oversight (§37(c): "not 'no daily_logs row exists'
    // ... a row can exist from a morning-only day and still gate").
    const morningOnlyDayEveningSubmittedAt = null
    expect(decideOwnerDeliveryRoute(morningOnlyDayEveningSubmittedAt)).toBe('notice')
  })
})
