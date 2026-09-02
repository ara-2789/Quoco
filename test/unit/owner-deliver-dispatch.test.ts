import { describe, it, expect } from 'vitest'
import {
  classifyDprRowForStage2,
  partitionEligibleRows,
  type DprRow,
} from '@/lib/dpr/owner-deliver-dispatch'

function row(id: string, engineerId: string, deliveryStatus: string): DprRow {
  return { id, engineer_id: engineerId, delivery_status: deliveryStatus, structured: null }
}

describe('classifyDprRowForStage2', () => {
  it('classifies every stage-1-or-starting value as eligible -- stage 2 is the unconditional writer', () => {
    expect(classifyDprRowForStage2('pending')).toBe('eligible')
    expect(classifyDprRowForStage2('pm_notified')).toBe('eligible')
    expect(classifyDprRowForStage2('skipped_no_template')).toBe('eligible')
    expect(classifyDprRowForStage2('failed')).toBe('eligible')
  })

  it('classifies every stage-2 terminal value as already_terminal -- the idempotency skip', () => {
    expect(classifyDprRowForStage2('delivered')).toBe('already_terminal')
    expect(classifyDprRowForStage2('owner_send_failed')).toBe('already_terminal')
    expect(classifyDprRowForStage2('no_report_sent')).toBe('already_terminal')
    expect(classifyDprRowForStage2('no_report_failed')).toBe('already_terminal')
    expect(classifyDprRowForStage2('skipped_unverified')).toBe('already_terminal')
  })

  it('classifies paused and skipped_no_data as out_of_scope -- neither this handler\'s concern', () => {
    expect(classifyDprRowForStage2('paused')).toBe('out_of_scope')
    expect(classifyDprRowForStage2('skipped_no_data')).toBe('out_of_scope')
  })

  it('a future, unrecognised CHECK value defaults to out_of_scope, never eligible -- fails toward "not processed," not "silently re-sent to"', () => {
    expect(classifyDprRowForStage2('some_future_value_nobody_has_seen_yet')).toBe('out_of_scope')
  })
})

describe('partitionEligibleRows', () => {
  it('routes an engineer with evening_submitted_at set to reportRows', () => {
    const rows = [row('d1', 'e1', 'pending')]
    const evening = new Map([['e1', '2026-08-27T18:45:00Z']])
    const { reportRows, noticeRows } = partitionEligibleRows(rows, evening)
    expect(reportRows.map((r) => r.id)).toEqual(['d1'])
    expect(noticeRows).toEqual([])
  })

  it('routes an engineer with no evening_submitted_at (null) to noticeRows', () => {
    const rows = [row('d1', 'e1', 'pending')]
    const evening = new Map([['e1', null as string | null]])
    const { reportRows, noticeRows } = partitionEligibleRows(rows, evening)
    expect(reportRows).toEqual([])
    expect(noticeRows.map((r) => r.id)).toEqual(['d1'])
  })

  it('routes an engineer with NO daily_logs row at all (missing from the map) to noticeRows -- same as an explicit null, per decideOwnerDeliveryRoute\'s own contract', () => {
    const rows = [row('d1', 'e1', 'pending')]
    const evening = new Map<string, string | null>() // e1 absent entirely
    const { reportRows, noticeRows } = partitionEligibleRows(rows, evening)
    expect(reportRows).toEqual([])
    expect(noticeRows.map((r) => r.id)).toEqual(['d1'])
  })

  it('splits a mixed project-day correctly -- the exact shape the fan-out design exists for', () => {
    const rows = [row('d1', 'e1', 'pending'), row('d2', 'e2', 'pm_notified'), row('d3', 'e3', 'failed')]
    const evening = new Map([
      ['e1', '2026-08-27T18:00:00Z'], // reported
      ['e2', null as string | null], // no report
      // e3 absent entirely -- also no report
    ])
    const { reportRows, noticeRows } = partitionEligibleRows(rows, evening)
    expect(reportRows.map((r) => r.id)).toEqual(['d1'])
    expect(noticeRows.map((r) => r.id).sort()).toEqual(['d2', 'd3'])
  })
})
