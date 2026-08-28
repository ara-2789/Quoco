import { describe, it, expect, beforeAll } from 'vitest'
import { testClient } from './helpers/db'
import {
  OUTBOUND_TEST_TENANT_ID,
  OUTBOUND_TEST_PROJECT_ID,
  ensureOutboundParentFixtures,
  mintOutboundEngineer,
  type MintedEngineer,
} from './helpers/outbound-fixtures'
import { runOutboundCoverageSweep } from '@/lib/whatsapp/outbound/coverage-sweep'
import { RATE_LIMITED_MARKER } from '@/lib/whatsapp/outbound/trigger'
import { MORNING_CHECKIN_SID } from '@/lib/whatsapp/outbound/templates'

// Integration test against REAL test-db -- Pass 1 item F
// (docs/plans/pass1-outbound-send-plan.md, Amendment (b)/F1-F4). Same
// fixture shape as test/outbound-trigger.test.ts (one shared tenant/project,
// engineers minted once in beforeAll, per-test uniqueness on the DATE half
// of event_key -- see that file's own header and test/helpers/db.ts's own
// UNIQUENESS AXIS RULE).
//
// SCOPE NOTE, WHY expectedRosterSize IS NEVER ASSERTED ON DIRECTLY HERE.
// runOutboundCoverageSweep's own coverage check iterates EVERY active
// project in test-db (fetchActiveProjectIds, same SELECT ... WHERE
// status='active' shape app/api/cron/dpr-generate/route.ts's own trigger
// uses) -- not scoped to this suite's own OUTBOUND_TEST_PROJECT_ID. Other
// test files create their own active projects/engineers, so
// expectedRosterSize is genuinely shared, uncontrolled state from this
// file's point of view; asserting an exact value would be fragile against
// unrelated suites, not a real test of this file's own logic. What IS
// safely, exactly assertable: `sentCount` for THIS file's own reserved
// event_keys (outbound_sends is exclusively written by this suite --
// confirmed via docs/reviews/outbound-sends-test-accretion.md's own
// count-to-date, no other test file has ever inserted into this table),
// and `windowClosed`'s boundary against a directly-injected `now`. Both
// verified below, precisely; `expectedRosterSize`/`gap` are asserted only
// via cross-checking `gap === Math.max(0, expected - sent)` from whatever
// value actually came back, never a hardcoded number.
//
// RESERVED DATES, CONTINUING test/outbound-trigger.test.ts's OWN RANGE
// (2026-09-01 through 2026-09-11): this file reserves 2026-09-12 through
// 2026-09-16, same tenant/project, documented in test/helpers/db.ts
// alongside that file's own reservation.
const LOG_DATE_COVERAGE = '2026-09-12'
const LOG_DATE_STUCK_TRUE = '2026-09-14'
const LOG_DATE_STUCK_FALSE_RECENT = '2026-09-15'
const LOG_DATE_RATE_LIMITED = '2026-09-16'

async function insertLedgerRow(params: {
  engineerId: string
  toPhoneNumber: string
  eventKey: string
  status: 'sending' | 'sent' | 'failed'
  error?: string | null
}): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('outbound_sends')
    .insert({
      tenant_id: OUTBOUND_TEST_TENANT_ID,
      project_id: OUTBOUND_TEST_PROJECT_ID,
      recipient_user_id: params.engineerId,
      event_key: params.eventKey,
      status: params.status,
      content_sid: MORNING_CHECKIN_SID,
      to_phone_number: params.toPhoneNumber,
      error: params.error ?? null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw new Error(`insertLedgerRow failed: ${error.message}`)
  return data.id
}

async function backdateUpdatedAt(id: string, isoTimestamp: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('outbound_sends').update({ updated_at: isoTimestamp }).eq('id', id)
  if (error) throw new Error(`backdateUpdatedAt failed: ${error.message}`)
}

describe('runOutboundCoverageSweep', () => {
  let engineerA: MintedEngineer
  let engineerB: MintedEngineer

  beforeAll(async () => {
    await ensureOutboundParentFixtures()
    engineerA = await mintOutboundEngineer()
    engineerB = await mintOutboundEngineer()
  })

  it('F2: sentCount counts only status=\'sent\' rows for the exact event_key, never a bare row count', async () => {
    const eventKey = `morning_send:${LOG_DATE_COVERAGE}`
    // Same event_key, two DIFFERENT engineers (event_key alone does not
    // embed the recipient -- 031's own header) -- one delivered, one not.
    await insertLedgerRow({ engineerId: engineerA.id, toPhoneNumber: engineerA.whatsappNumber, eventKey, status: 'sent' })
    await insertLedgerRow({ engineerId: engineerB.id, toPhoneNumber: engineerB.whatsappNumber, eventKey, status: 'failed', error: 'simulated non-retryable failure' })

    // now: well past morningCutoff (15:00 IST) on LOG_DATE_COVERAGE, so this
    // checkpoint's windowClosed is true.
    const now = new Date(`${LOG_DATE_COVERAGE}T11:00:00Z`) // 16:30 IST
    const result = await runOutboundCoverageSweep(testClient(), now)

    const morning = result.checkpoints.find((c) => c.checkpoint === 'morning_send' && c.logDate === LOG_DATE_COVERAGE)
    expect(morning).toBeDefined()
    expect(morning!.windowClosed).toBe(true)
    expect(morning!.sentCount).toBe(1) // the 'failed' row must NOT be counted
    // gap arithmetic holds regardless of expectedRosterSize's own value
    // (shared, uncontrolled state -- see this file's own header).
    expect(morning!.gap).toBe(Math.max(0, morning!.expectedRosterSize - morning!.sentCount))
  })

  it('windowClosed is false before the checkpoint\'s own cutoff, true at/after it', async () => {
    const beforeCutoff = new Date(`${LOG_DATE_COVERAGE}T05:00:00Z`) // 10:30 IST -- before morningCutoff (15:00)
    const resultBefore = await runOutboundCoverageSweep(testClient(), beforeCutoff)
    const morningBefore = resultBefore.checkpoints.find((c) => c.checkpoint === 'morning_send')
    expect(morningBefore!.windowClosed).toBe(false)

    const atCutoff = new Date(`${LOG_DATE_COVERAGE}T09:30:00Z`) // exactly 15:00 IST
    const resultAt = await runOutboundCoverageSweep(testClient(), atCutoff)
    const morningAt = resultAt.checkpoints.find((c) => c.checkpoint === 'morning_send')
    expect(morningAt!.windowClosed).toBe(true) // >= cutoff, not only strictly after
  })

  it('F4: a row stuck at \'sending\' with error IS NULL past the 10-minute threshold is reported', async () => {
    const eventKey = `morning_send:${LOG_DATE_STUCK_TRUE}`
    const id = await insertLedgerRow({ engineerId: engineerA.id, toPhoneNumber: engineerA.whatsappNumber, eventKey, status: 'sending' })
    const now = new Date(`${LOG_DATE_STUCK_TRUE}T05:00:00Z`)
    await backdateUpdatedAt(id, new Date(now.getTime() - 20 * 60 * 1000).toISOString()) // 20 min before `now`

    const result = await runOutboundCoverageSweep(testClient(), now)
    expect(result.stuckClaims.some((r) => r.id === id)).toBe(true)
    const row = result.stuckClaims.find((r) => r.id === id)!
    expect(row.toPhoneNumber).toBe(engineerA.whatsappNumber)
    expect(row.contentSid).toBe(MORNING_CHECKIN_SID)
  })

  it('a row still \'sending\' within the 10-minute threshold is NOT reported as stuck', async () => {
    const eventKey = `evening_send:${LOG_DATE_STUCK_FALSE_RECENT}`
    const id = await insertLedgerRow({ engineerId: engineerA.id, toPhoneNumber: engineerA.whatsappNumber, eventKey, status: 'sending' })
    const now = new Date(`${LOG_DATE_STUCK_FALSE_RECENT}T05:00:00Z`)
    await backdateUpdatedAt(id, new Date(now.getTime() - 2 * 60 * 1000).toISOString()) // only 2 min before `now`

    const result = await runOutboundCoverageSweep(testClient(), now)
    expect(result.stuckClaims.some((r) => r.id === id)).toBe(false)
  })

  it('F3: a row marked rate-limited (error=RATE_LIMITED_MARKER) past 10 minutes is EXCLUDED from stuckClaims but counted in rateLimitedBacklogCount', async () => {
    const eventKey = `morning_send:${LOG_DATE_RATE_LIMITED}`
    const id = await insertLedgerRow({
      engineerId: engineerA.id,
      toPhoneNumber: engineerA.whatsappNumber,
      eventKey,
      status: 'sending',
      error: RATE_LIMITED_MARKER,
    })
    const now = new Date(`${LOG_DATE_RATE_LIMITED}T05:00:00Z`)
    await backdateUpdatedAt(id, new Date(now.getTime() - 20 * 60 * 1000).toISOString())

    const result = await runOutboundCoverageSweep(testClient(), now)
    // THE PARTITION -- this is the entire F3 decision, exercised: a row
    // this old, sharing the exact same status='sending' signature as the
    // true-stuck test above, must NOT appear in stuckClaims.
    expect(result.stuckClaims.some((r) => r.id === id)).toBe(false)
    expect(result.rateLimitedBacklogCount).toBeGreaterThanOrEqual(1)
  })
})
