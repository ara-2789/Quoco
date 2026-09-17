import { describe, it, expect } from 'vitest'
import { formatKeptUntilLine } from '@/lib/photos/copy'

// Stage 5a, build slice B3. Pure logic, no DB/network -- D4's test plan
// entry (future/past/IST-boundary) lives entirely here.

describe('formatKeptUntilLine', () => {
  it('future expires_at -> "Kept until {IST long-form date}"', () => {
    // Well clear of any boundary: 2026-01-15T06:00:00Z is 2026-01-15
    // 11:30 IST.
    const line = formatKeptUntilLine('2026-01-15T06:00:00.000Z', new Date('2026-01-01T00:00:00.000Z'))
    expect(line).toBe('Kept until 15 January 2026')
  })

  it('past expires_at -> null (hidden, D4)', () => {
    const line = formatKeptUntilLine('2026-01-01T00:00:00.000Z', new Date('2026-01-15T00:00:00.000Z'))
    expect(line).toBeNull()
  })

  it('expires_at exactly equal to now -> null (already passed, not still-future)', () => {
    const instant = '2026-01-15T00:00:00.000Z'
    const line = formatKeptUntilLine(instant, new Date(instant))
    expect(line).toBeNull()
  })

  it('IST date-boundary: a UTC instant that is still 17th UTC but already 18th IST displays the IST date', () => {
    // 2026-09-17T19:00:00Z = 2026-09-18T00:30 IST (UTC+5:30) -- a naive
    // UTC-based formatter would show "17 September 2026"; the IST-correct
    // answer is "18 September 2026".
    const line = formatKeptUntilLine('2026-09-17T19:00:00.000Z', new Date('2026-09-01T00:00:00.000Z'))
    expect(line).toBe('Kept until 18 September 2026')
  })

  it('IST date-boundary: a UTC instant just before the IST midnight rollover stays on the earlier IST date', () => {
    // 2026-09-17T18:00:00Z = 2026-09-17T23:30 IST -- still the 17th in IST.
    const line = formatKeptUntilLine('2026-09-17T18:00:00.000Z', new Date('2026-09-01T00:00:00.000Z'))
    expect(line).toBe('Kept until 17 September 2026')
  })
})
