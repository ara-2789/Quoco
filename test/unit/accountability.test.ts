import { describe, it, expect } from 'vitest'
import { computeAccountability, extractEngineerRow } from '@/lib/dpr/accountability'
import type { RosterEngineer, TodayLogRow } from '@/lib/dpr/accountability'

// Pure unit tests for computeAccountability — §6's deterministic core. No
// DB. assembleAccountability (roster + today's-rows IO) is not exercised
// here. Golden case #2 asserts against this per-day output only — the
// 7-day pattern is suppressed (schema.ts's ACCOUNTABILITY_PATTERN_
// SUPPRESSED), so every entry below carries morning_pattern/evening_
// pattern: null by construction.

function engineer(overrides: Partial<RosterEngineer> = {}): RosterEngineer {
  return { engineer_id: 'e1', engineer_name: 'Rajesh', ...overrides }
}

describe('computeAccountability — MISSING SUBMISSIONS ONLY', () => {
  it('an engineer who submitted both halves does not appear at all', () => {
    const roster = [engineer()]
    const logs = new Map<string, TodayLogRow>([
      ['e1', { morning_submitted_at: '2026-08-10T02:00:00Z', evening_submitted_at: '2026-08-10T13:00:00Z', is_holiday: null }],
    ])
    expect(computeAccountability(roster, logs)).toEqual([])
  })

  it('LOAD-BEARING: morning submitted + is_holiday=true, evening null (BOT-20 suppresses the evening trigger on a site-closed day) — does NOT appear', () => {
    // The engineer who told us the site was closed must not be the one
    // flagged with "no evening check-in recorded" — without the
    // ownRowExists && ownIsHoliday branch in statusFor, evening_status
    // would fall through to 'missing' here, exactly backwards.
    const roster = [engineer()]
    const logs = new Map<string, TodayLogRow>([
      ['e1', { morning_submitted_at: '2026-08-10T02:00:00Z', evening_submitted_at: null, is_holiday: true }],
    ])
    expect(computeAccountability(roster, logs)).toEqual([])
  })
})

describe('computeAccountability — missing (no record, no counter-evidence)', () => {
  it('no row at all, no peer holiday signal — both halves "missing"', () => {
    const roster = [engineer()]
    const entries = computeAccountability(roster, new Map())
    expect(entries).toHaveLength(1)
    expect(entries[0].morning_status).toBe('missing')
    expect(entries[0].evening_status).toBe('missing')
  })

  it('partial: morning submitted, evening not — only evening flagged', () => {
    const roster = [engineer()]
    const logs = new Map<string, TodayLogRow>([
      ['e1', { morning_submitted_at: '2026-08-10T02:00:00Z', evening_submitted_at: null, is_holiday: null }],
    ])
    const entries = computeAccountability(roster, logs)
    expect(entries).toHaveLength(1)
    expect(entries[0].morning_status).toBe('submitted')
    expect(entries[0].evening_status).toBe('missing')
  })

  it('status_note is worded as a fact about records, never a claim about the person', () => {
    const roster = [engineer({ engineer_name: 'Suresh' })]
    const entries = computeAccountability(roster, new Map())
    expect(entries[0].status_note).toContain('no morning check-in recorded')
    expect(entries[0].status_note).toContain('no evening check-in recorded')
    expect(entries[0].status_note).not.toMatch(/missed|ignored|failed to/i)
  })
})

describe('computeAccountability — unconfirmed (peer holiday corroboration)', () => {
  it('an engineer with no row, on a day another roster engineer reported is_holiday, is "unconfirmed" not "missing"', () => {
    const roster = [engineer({ engineer_id: 'e1', engineer_name: 'Rajesh' }), engineer({ engineer_id: 'e2', engineer_name: 'Suresh' })]
    const logs = new Map<string, TodayLogRow>([
      ['e2', { morning_submitted_at: '2026-08-10T02:00:00Z', evening_submitted_at: null, is_holiday: true }],
    ])
    const entries = computeAccountability(roster, logs)
    // Suresh: own row confirms holiday -> excluded entirely.
    expect(entries.map((e) => e.engineer_name)).toEqual(['Rajesh'])
    expect(entries[0].morning_status).toBe('unconfirmed')
    expect(entries[0].evening_status).toBe('unconfirmed')
    expect(entries[0].status_note).toContain('another engineer on this project reported the site closed')
  })

  it('no peer evidence at all (total silence) stays "missing", never "unconfirmed" without a reason', () => {
    const roster = [engineer({ engineer_id: 'e1' }), engineer({ engineer_id: 'e2', engineer_name: 'Suresh' })]
    // Neither engineer has a row — no evidence either way.
    const entries = computeAccountability(roster, new Map())
    expect(entries.every((e) => e.morning_status === 'missing' && e.evening_status === 'missing')).toBe(true)
  })
})

describe('computeAccountability — pattern fields always null (suppressed)', () => {
  it('never populates morning_pattern/evening_pattern regardless of status', () => {
    const roster = [engineer({ engineer_id: 'e1' }), engineer({ engineer_id: 'e2', engineer_name: 'Suresh' })]
    const logs = new Map<string, TodayLogRow>([
      ['e2', { morning_submitted_at: '2026-08-10T02:00:00Z', evening_submitted_at: null, is_holiday: true }],
    ])
    const entries = computeAccountability(roster, logs)
    expect(entries.every((e) => e.morning_pattern === null && e.evening_pattern === null)).toBe(true)
  })
})

describe('extractEngineerRow — the project_members->users join must fail loudly, never guess', () => {
  it('accepts the normal object-resolved shape', () => {
    expect(extractEngineerRow({ id: 'u1', full_name: 'Rajesh' })).toEqual({ id: 'u1', full_name: 'Rajesh' })
  })

  it('accepts the array-resolved shape (a real PostgREST/supabase-js ambiguity, not hypothetical) and takes the first element', () => {
    expect(extractEngineerRow([{ id: 'u1', full_name: 'Rajesh' }])).toEqual({ id: 'u1', full_name: 'Rajesh' })
  })

  it('accepts a null full_name', () => {
    expect(extractEngineerRow({ id: 'u1', full_name: null })).toEqual({ id: 'u1', full_name: null })
  })

  it('throws on null (join found no matching user)', () => {
    expect(() => extractEngineerRow(null)).toThrow(/did not resolve to a valid user row/)
  })

  it('throws on an empty array (join resolved as an array shape but with nothing in it)', () => {
    expect(() => extractEngineerRow([])).toThrow(/did not resolve to a valid user row/)
  })

  it('throws when id is missing — this is the exact failure mode that would otherwise produce a roster of ghosts', () => {
    expect(() => extractEngineerRow({ full_name: 'Rajesh' })).toThrow(/did not resolve to a valid user row/)
  })

  it('throws when id is present but not a string', () => {
    expect(() => extractEngineerRow({ id: 12345, full_name: 'Rajesh' })).toThrow(/did not resolve to a valid user row/)
  })

  it('throws when id is an empty string', () => {
    expect(() => extractEngineerRow({ id: '', full_name: 'Rajesh' })).toThrow(/did not resolve to a valid user row/)
  })
})
