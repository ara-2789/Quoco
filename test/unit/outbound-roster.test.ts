import { describe, it, expect } from 'vitest'
import {
  filterEveningRoster,
  resolveRosterEngineer,
  checkRosterCardinality,
  type OutboundRosterEngineer,
  type EveningTodayLogRow,
} from '@/lib/whatsapp/outbound/roster'

function engineer(id: string): OutboundRosterEngineer {
  return { engineer_id: id, engineer_name: `Engineer ${id}`, whatsapp_number: `+1999555${id}`, tenant_id: 'zz-tenant' }
}

describe('filterEveningRoster', () => {
  it('§37(a) REGRESSION -- includes an engineer who never submitted morning at all (no daily_logs row)', () => {
    // This is the exact hard requirement design-decisions-beta-feedback.md
    // §37(a) records: the evening trigger must reach an engineer who never
    // touched morning, not only one who submitted and was marked absent/
    // site_holiday. No entry in the map at all == no daily_logs row.
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>()
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id)).toEqual(['1'])
  })

  it('§37(a) REGRESSION -- includes an engineer whose daily_logs row exists with attendance="absent"', () => {
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>([['1', { attendance: 'absent' }]])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id)).toEqual(['1'])
  })

  it('§37(a) REGRESSION -- includes an engineer whose morning attendance is "present" (ordinary case)', () => {
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>([['1', { attendance: 'present' }]])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id)).toEqual(['1'])
  })

  it('excludes ONLY the engineer whose attendance is site_holiday -- the one real exclusion', () => {
    const roster = [engineer('1'), engineer('2'), engineer('3')]
    const logs = new Map<string, EveningTodayLogRow>([
      ['1', { attendance: 'site_holiday' }],
      // '2' has no daily_logs row at all -- must still be included (never-engaged case).
      ['3', { attendance: 'absent' }],
    ])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id).sort()).toEqual(['2', '3'])
  })

  it('includes every engineer when nobody has any daily_logs row yet', () => {
    const roster = [engineer('1'), engineer('2')]
    const due = filterEveningRoster(roster, new Map())
    expect(due).toHaveLength(2)
  })
})

describe('resolveRosterEngineer', () => {
  // PostgREST's own join shape -- an object today, historically sometimes a
  // one-element array depending on how the relationship is inferred (see
  // lib/dpr/accountability.ts's own extractEngineerRow doc, reused here).
  function rawRow(overrides: Partial<{ id: string; full_name: string | null; whatsapp_number: string | null; tenant_id: string | null }>) {
    return { id: 'eng-1', full_name: 'Arjun Nair', whatsapp_number: '+919876543210', tenant_id: 'zz-tenant', ...overrides }
  }

  it('includes an engineer with both whatsapp_number and tenant_id present', () => {
    const result = resolveRosterEngineer(rawRow({}))
    expect('engineer' in result).toBe(true)
    if ('engineer' in result) {
      expect(result.engineer).toEqual({
        engineer_id: 'eng-1',
        engineer_name: 'Arjun Nair',
        whatsapp_number: '+919876543210',
        tenant_id: 'zz-tenant',
      })
    }
  })

  it('EXCLUDES an engineer with a null whatsapp_number, reporting it as unreachable (missing_whatsapp_number)', () => {
    const result = resolveRosterEngineer(rawRow({ whatsapp_number: null }))
    expect('unreachable' in result).toBe(true)
    if ('unreachable' in result) {
      expect(result.unreachable).toEqual({ engineerId: 'eng-1', reason: 'missing_whatsapp_number' })
    }
  })

  it('EXCLUDES an engineer with an empty-string whatsapp_number the same way as null', () => {
    const result = resolveRosterEngineer(rawRow({ whatsapp_number: '' }))
    expect('unreachable' in result).toBe(true)
    if ('unreachable' in result) {
      expect(result.unreachable.reason).toBe('missing_whatsapp_number')
    }
  })

  it('EXCLUDES an engineer with a null tenant_id, reporting it as unreachable (missing_tenant_id)', () => {
    const result = resolveRosterEngineer(rawRow({ tenant_id: null }))
    expect('unreachable' in result).toBe(true)
    if ('unreachable' in result) {
      expect(result.unreachable).toEqual({ engineerId: 'eng-1', reason: 'missing_tenant_id' })
    }
  })

  it('checks whatsapp_number before tenant_id when BOTH are missing -- one report per engineer, not two', () => {
    const result = resolveRosterEngineer(rawRow({ whatsapp_number: null, tenant_id: null }))
    expect('unreachable' in result).toBe(true)
    if ('unreachable' in result) {
      expect(result.unreachable.reason).toBe('missing_whatsapp_number')
    }
  })

  it('handles the array-shaped PostgREST join the same as the object shape', () => {
    const result = resolveRosterEngineer([rawRow({})])
    expect('engineer' in result).toBe(true)
  })

  it('still throws on a genuinely malformed join (no id at all) -- a different, more severe class, unchanged by this fix', () => {
    expect(() => resolveRosterEngineer({ full_name: 'No ID Here' })).toThrow()
  })
})

describe('checkRosterCardinality', () => {
  it('does not throw when count is under the ceiling', () => {
    expect(() => checkRosterCardinality(3, 50, 'proj-1', '2026-09-01')).not.toThrow()
  })

  it('does not throw when count exactly EQUALS the ceiling -- the ceiling itself is not a violation', () => {
    expect(() => checkRosterCardinality(50, 50, 'proj-1', '2026-09-01')).not.toThrow()
  })

  it('throws the instant count exceeds the ceiling by one', () => {
    expect(() => checkRosterCardinality(51, 50, 'proj-1', '2026-09-01')).toThrow(/exceeding the 50-engineer circuit breaker/)
  })

  it('throws for a grossly oversized roster, not just a boundary case', () => {
    expect(() => checkRosterCardinality(10_000, 50, 'proj-1', '2026-09-01')).toThrow()
  })

  it('does not throw for a genuinely empty roster -- this guard is about EXPLOSION, not absence', () => {
    expect(() => checkRosterCardinality(0, 50, 'proj-1', '2026-09-01')).not.toThrow()
  })

  it('the thrown error names the project and date, so an operator does not have to guess which checkpoint aborted', () => {
    expect(() => checkRosterCardinality(99, 50, 'proj-xyz', '2026-09-05')).toThrow(/proj-xyz/)
    expect(() => checkRosterCardinality(99, 50, 'proj-xyz', '2026-09-05')).toThrow(/2026-09-05/)
  })
})
