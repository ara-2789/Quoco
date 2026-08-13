import { describe, it, expect } from 'vitest'
import { determineTargetStatus, allowedSourceStatuses, timestampColumnFor, type CheckinStatus } from '@/lib/checkin-escalations/status'

// IST instants as UTC Dates (IST = UTC + 5:30), same construction convention
// as test/unit/daily-logs-status.test.ts.
function istAsUtc(dateIso: string, hh: number, mm: number): Date {
  const totalMinutes = hh * 60 + mm - 330 // subtract 5:30 to get UTC
  const h = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60)
  const m = ((totalMinutes % 60) + 60) % 60
  return new Date(`${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
}

describe('determineTargetStatus — morning', () => {
  it('before 10:00 IST, not submitted -> awaited (09:00 nudge checkpoint writes nothing in this slice)', () => {
    const now = istAsUtc('2026-08-14', 9, 0)
    expect(determineTargetStatus({ half: 'morning', now, submittedAt: null })).toBe('awaited')
  })

  it('at 10:00 IST, not submitted -> escalated', () => {
    const now = istAsUtc('2026-08-14', 10, 0)
    expect(determineTargetStatus({ half: 'morning', now, submittedAt: null })).toBe('escalated')
  })

  it('between 10:00 and 15:00 IST, not submitted -> escalated', () => {
    const now = istAsUtc('2026-08-14', 12, 30)
    expect(determineTargetStatus({ half: 'morning', now, submittedAt: null })).toBe('escalated')
  })

  it('at/after 15:00 IST cutoff, not submitted -> not_submitted', () => {
    const now = istAsUtc('2026-08-14', 15, 0)
    expect(determineTargetStatus({ half: 'morning', now, submittedAt: null })).toBe('not_submitted')
  })

  it('never returns nudged, at any clock time (Correction 1)', () => {
    for (const [hh, mm] of [[7, 0], [9, 0], [9, 59], [10, 0], [12, 0], [14, 59], [15, 0], [23, 59]]) {
      const now = istAsUtc('2026-08-14', hh, mm)
      expect(determineTargetStatus({ half: 'morning', now, submittedAt: null })).not.toBe('nudged')
    }
  })

  it('submitted at any point in the schedule -> submitted, regardless of clock', () => {
    for (const [hh, mm] of [[7, 0], [9, 30], [10, 30], [16, 0]]) {
      const now = istAsUtc('2026-08-14', hh, mm)
      expect(determineTargetStatus({ half: 'morning', now, submittedAt: '2026-08-14T02:00:00Z' })).toBe('submitted')
    }
  })
})

describe('determineTargetStatus — evening (Decision 3: no escalation stage)', () => {
  it('before 20:00 IST, not submitted -> awaited', () => {
    const now = istAsUtc('2026-08-14', 19, 30)
    expect(determineTargetStatus({ half: 'evening', now, submittedAt: null })).toBe('awaited')
  })

  it('at/after 20:00 IST, not submitted -> not_submitted (never escalated)', () => {
    const now = istAsUtc('2026-08-14', 20, 0)
    expect(determineTargetStatus({ half: 'evening', now, submittedAt: null })).toBe('not_submitted')
  })

  it('never returns escalated, at any clock time', () => {
    for (const [hh, mm] of [[18, 30], [19, 30], [20, 0], [23, 0]]) {
      const now = istAsUtc('2026-08-14', hh, mm)
      expect(determineTargetStatus({ half: 'evening', now, submittedAt: null })).not.toBe('escalated')
    }
  })

  it('submitted -> submitted regardless of clock', () => {
    const now = istAsUtc('2026-08-14', 23, 0)
    expect(determineTargetStatus({ half: 'evening', now, submittedAt: '2026-08-14T14:00:00Z' })).toBe('submitted')
  })
})

describe('allowedSourceStatuses — the regression guard', () => {
  it('submitted is never a valid source for not_submitted (the one invariant the task names)', () => {
    expect(allowedSourceStatuses('not_submitted')).not.toContain('submitted')
  })

  it('not_submitted IS a valid source for submitted (the late-submission case)', () => {
    expect(allowedSourceStatuses('submitted')).toContain('not_submitted')
  })

  it('a status is never its own allowed source (Correction 2 — strict rank, repeat invocation is a true no-op)', () => {
    const all: CheckinStatus[] = ['awaited', 'nudged', 'escalated', 'not_submitted', 'submitted']
    for (const s of all) {
      expect(allowedSourceStatuses(s)).not.toContain(s)
    }
  })

  it('escalated is only reachable from awaited or nudged', () => {
    expect(allowedSourceStatuses('escalated').sort()).toEqual(['awaited', 'nudged'].sort())
  })

  it('submitted is reachable from every other status', () => {
    expect(allowedSourceStatuses('submitted').sort()).toEqual(['awaited', 'nudged', 'escalated', 'not_submitted'].sort())
  })
})

describe('timestampColumnFor', () => {
  it('maps escalated -> escalated_at', () => {
    expect(timestampColumnFor('escalated')).toBe('escalated_at')
  })
  it('maps both terminal states -> closed_at', () => {
    expect(timestampColumnFor('not_submitted')).toBe('closed_at')
    expect(timestampColumnFor('submitted')).toBe('closed_at')
  })
  it('maps awaited and nudged -> null (this slice sets no timestamp for either)', () => {
    expect(timestampColumnFor('awaited')).toBeNull()
    expect(timestampColumnFor('nudged')).toBeNull()
  })
})
