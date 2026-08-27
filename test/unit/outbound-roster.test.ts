import { describe, it, expect } from 'vitest'
import { filterEveningRoster, type OutboundRosterEngineer, type EveningTodayLogRow } from '@/lib/whatsapp/outbound/roster'

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
    expect(due[0]!.morningPlan).toBeNull()
  })

  it('§37(a) REGRESSION -- includes an engineer whose daily_logs row exists but has no morning_plan (attendance="absent")', () => {
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>([['1', { attendance: 'absent', morning_plan: null }]])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id)).toEqual(['1'])
    expect(due[0]!.morningPlan).toBeNull()
  })

  it('§37(a) REGRESSION -- includes an engineer whose morning attendance is "present" (ordinary case)', () => {
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>([['1', { attendance: 'present', morning_plan: 'Pour slab on level 3' }]])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id)).toEqual(['1'])
    expect(due[0]!.morningPlan).toBe('Pour slab on level 3')
  })

  it('excludes ONLY the engineer whose attendance is site_holiday -- the one real exclusion', () => {
    const roster = [engineer('1'), engineer('2'), engineer('3')]
    const logs = new Map<string, EveningTodayLogRow>([
      ['1', { attendance: 'site_holiday', morning_plan: null }],
      // '2' has no daily_logs row at all -- must still be included (never-engaged case).
      ['3', { attendance: 'absent', morning_plan: null }],
    ])
    const due = filterEveningRoster(roster, logs)
    expect(due.map((e) => e.engineer_id).sort()).toEqual(['2', '3'])
  })

  it('includes every engineer when nobody has any daily_logs row yet', () => {
    const roster = [engineer('1'), engineer('2')]
    const due = filterEveningRoster(roster, new Map())
    expect(due).toHaveLength(2)
  })

  it('carries morningPlan through for the template-selection step, distinct from the gate itself', () => {
    const roster = [engineer('1')]
    const logs = new Map<string, EveningTodayLogRow>([['1', { attendance: 'present', morning_plan: 'Cast column C4' }]])
    const due = filterEveningRoster(roster, logs)
    expect(due[0]!.morningPlan).toBe('Cast column C4')
  })
})
