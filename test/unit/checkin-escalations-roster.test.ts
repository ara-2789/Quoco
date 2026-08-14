import { describe, it, expect } from 'vitest'
import { filterDueRoster, type DueRosterEngineer } from '@/lib/checkin-escalations/roster'

function engineer(id: string): DueRosterEngineer {
  return { engineer_id: id, engineer_name: `Engineer ${id}`, whatsapp_number: `+1999555${id}` }
}

describe('filterDueRoster', () => {
  it('excludes an engineer with is_holiday=true for this date', () => {
    const roster = [engineer('1'), engineer('2')]
    const holidayIds = new Set(['1'])
    const due = filterDueRoster(roster, holidayIds)
    expect(due.map((e) => e.engineer_id)).toEqual(['2'])
  })

  it('includes every engineer when no holidays are reported', () => {
    const roster = [engineer('1'), engineer('2')]
    const due = filterDueRoster(roster, new Set())
    expect(due).toHaveLength(2)
  })

  it('does NOT exclude a messaging_blocked engineer — Decision 1, deliberate divergence from the first draft', () => {
    // filterDueRoster has no messaging_blocked concept at all: the roster
    // fetch itself never filters on the column (see roster.ts's header). A
    // blocked engineer reaches this function exactly like any other and is
    // never removed here.
    const roster = [engineer('1')]
    const due = filterDueRoster(roster, new Set())
    expect(due).toHaveLength(1)
  })

  it('an engineer absent from the holiday set entirely (no daily_logs row at all) is included', () => {
    // The common case: nobody has started any check-in yet today, so the
    // holidayEngineerIds set is built from zero daily_logs rows. Absence
    // from the set must read as "not holiday", not "excluded".
    const roster = [engineer('1'), engineer('2'), engineer('3')]
    const due = filterDueRoster(roster, new Set())
    expect(due).toHaveLength(3)
  })
})
