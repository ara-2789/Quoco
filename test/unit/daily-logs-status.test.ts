import { describe, it, expect } from 'vitest'
import { deriveHalfStatus, type LogHalfInput } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'

// Pure unit tests for the DASH-03 per-half status logic. Covers all five rows of
// the plan table plus the Asia/Kolkata conversion regression guard.

const cutoffs = DEFAULT_CUTOFFS // morning 10:30, evening 19:30 IST
const blank: LogHalfInput = {
  morning_submitted_at: null,
  evening_submitted_at: null,
  is_holiday: false,
  holiday_reason: null,
}
// A UTC instant that is well past both cutoffs in IST (23:59 IST on 2026-07-18).
const LATE_TODAY = new Date('2026-07-18T18:29:00Z')

describe('deriveHalfStatus', () => {
  it('row 1 — submitted half is green/ok and counts', () => {
    const log = { ...blank, morning_submitted_at: '2026-07-18T04:00:00Z' }
    const s = deriveHalfStatus(log, false, 'morning', '2026-07-18', LATE_TODAY, cutoffs)
    expect(s.state).toBe('submitted')
    expect(s.variant).toBe('ok')
    expect(s.countsForAccountability).toBe(true)
  })

  it('row 2 — holiday is blue/info, excluded, and names the reason', () => {
    const log = { ...blank, is_holiday: true, holiday_reason: 'Bakrid' }
    const s = deriveHalfStatus(log, false, 'morning', '2026-07-18', LATE_TODAY, cutoffs)
    expect(s.state).toBe('holiday')
    expect(s.variant).toBe('info')
    expect(s.label).toBe('Site closed — Bakrid')
    expect(s.countsForAccountability).toBe(false)
  })

  it('row 3 — messaging_blocked is blue/info and excluded', () => {
    const s = deriveHalfStatus(blank, true, 'evening', '2026-07-18', LATE_TODAY, cutoffs)
    expect(s.state).toBe('messaging_blocked')
    expect(s.variant).toBe('info')
    expect(s.countsForAccountability).toBe(false)
  })

  it('holiday takes precedence over the missing-cutoff branch', () => {
    const log = { ...blank, is_holiday: true }
    const s = deriveHalfStatus(log, false, 'evening', '2026-07-18', LATE_TODAY, cutoffs)
    expect(s.state).toBe('holiday')
  })

  it('row 4 — today, before cutoff, missing → muted "awaiting", not a gap', () => {
    // 09:00 IST 2026-07-18 = 03:30 UTC — before the 10:30 morning cutoff.
    const now = new Date('2026-07-18T03:30:00Z')
    const s = deriveHalfStatus(blank, false, 'morning', '2026-07-18', now, cutoffs)
    expect(s.state).toBe('awaiting')
    expect(s.variant).toBe('muted')
    expect(s.countsForAccountability).toBe(false)
  })

  it('row 5 — today, after cutoff, missing → amber/risk gap', () => {
    // 12:00 IST 2026-07-18 = 06:30 UTC — after the 10:30 morning cutoff.
    const now = new Date('2026-07-18T06:30:00Z')
    const s = deriveHalfStatus(blank, false, 'morning', '2026-07-18', now, cutoffs)
    expect(s.state).toBe('missing')
    expect(s.variant).toBe('risk')
    expect(s.countsForAccountability).toBe(true)
  })

  it('row 5 — past date, missing → gap without consulting the clock', () => {
    // now is early-morning IST today; a blank half on YESTERDAY is still a gap.
    const now = new Date('2026-07-18T01:00:00Z')
    const s = deriveHalfStatus(blank, false, 'evening', '2026-07-17', now, cutoffs)
    expect(s.state).toBe('missing')
    expect(s.variant).toBe('risk')
  })

  it('future date, missing → awaiting (not a gap)', () => {
    const s = deriveHalfStatus(blank, false, 'morning', '2026-07-19', LATE_TODAY, cutoffs)
    expect(s.state).toBe('awaiting')
  })

  // --- Timezone regression guard (Asia/Kolkata conversion) ---
  // 05:30 UTC on 2026-07-18 = 11:00 IST — AFTER the 10:30 morning cutoff.
  // A bare-UTC comparison would read 05:30 < 10:30 and wrongly classify this as
  // "awaiting". Correct IST conversion yields 11:00 > 10:30 → gap. If someone
  // drops the timezone conversion, this test fails loudly.
  it('regression — UTC instant is converted to IST before the cutoff compare', () => {
    const now = new Date('2026-07-18T05:30:00Z') // 11:00 IST
    const s = deriveHalfStatus(blank, false, 'morning', '2026-07-18', now, cutoffs)
    expect(s.state).toBe('missing')
    expect(s.variant).toBe('risk')
  })

  // The IST calendar-DAY must also come from the conversion: 18:45 UTC on
  // 2026-07-18 is already 00:15 IST on 2026-07-19. A card dated 2026-07-19
  // viewed at that instant is "today" in IST, before the morning cutoff.
  it('regression — IST calendar day rolls over correctly near UTC midnight', () => {
    const now = new Date('2026-07-18T18:45:00Z') // 00:15 IST on the 19th
    const s = deriveHalfStatus(blank, false, 'morning', '2026-07-19', now, cutoffs)
    expect(s.state).toBe('awaiting')
  })
})
