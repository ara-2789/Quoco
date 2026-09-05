import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient } from './helpers/db'
import {
  OUTBOUND_TEST_TENANT_ID,
  OUTBOUND_TEST_PROJECT_ID,
  ensureOutboundParentFixtures,
  mintOutboundEngineer,
  cleanupOutboundSends,
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
// unrelated suites, not a real test of this file's own logic. `gap` is
// asserted only via cross-checking `gap === Math.max(0, expected - sent)`
// from whatever value actually came back, never a hardcoded number.
//
// sentCount IS NOT SAFELY ASSERTABLE AS AN ABSOLUTE VALUE EITHER --
// CORRECTED 2026-08-28, CI's own second run on this PR caught it (first
// run: sentCount==1, passed; second run: sentCount==2, failed -- see
// git blame on this comment for the original, wrong claim). A reserved
// DATE prevents INSERT collisions (event_key's uniqueness is per-
// recipient, so a fresh engineer each CI run never collides on the
// UNIQUE constraint) -- but sentCountForEventKey's own query correctly
// aggregates status='sent' rows ACROSS EVERY RECIPIENT sharing that
// event_key STRING (required production behaviour: many engineers, one
// event_key per checkpoint per day). Since outbound_sends never gets
// cleaned up, EVERY prior CI run that ever exercised this exact reserved
// date left its own 'sent' row under the same event_key, permanently --
// the count is NOT a property of this test run alone, it is the running
// total across this reserved date's entire CI history. An absolute
// assertion (`.toBe(1)`) could only ever pass on that date's very FIRST
// CI run. Fixed below: assert the DELTA this test's own two inserts
// produce (before -> after), never an absolute count -- robust to
// however many prior runs have already touched this event_key.
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

  afterAll(cleanupOutboundSends)

  it('F2: sentCount counts only status=\'sent\' rows for the exact event_key, never a bare row count', async () => {
    const eventKey = `morning_send:${LOG_DATE_COVERAGE}`
    // now: well past morningCutoff (15:00 IST) on LOG_DATE_COVERAGE, so this
    // checkpoint's windowClosed is true.
    const now = new Date(`${LOG_DATE_COVERAGE}T11:00:00Z`) // 16:30 IST

    // BASELINE, before this test's own inserts -- see this file's own
    // header for why an absolute count is not safely assertable against a
    // reserved date that accumulates rows across every CI run that has
    // ever touched it. Delta, not absolute value, is what this test
    // actually owns.
    const before = await runOutboundCoverageSweep(testClient(), now)
    const sentCountBefore =
      before.checkpoints.find((c) => c.checkpoint === 'morning_send' && c.logDate === LOG_DATE_COVERAGE)
        ?.sentCount ?? 0

    // Same event_key, two DIFFERENT engineers (event_key alone does not
    // embed the recipient -- 031's own header) -- one delivered, one not.
    await insertLedgerRow({ engineerId: engineerA.id, toPhoneNumber: engineerA.whatsappNumber, eventKey, status: 'sent' })
    await insertLedgerRow({ engineerId: engineerB.id, toPhoneNumber: engineerB.whatsappNumber, eventKey, status: 'failed', error: 'simulated non-retryable failure' })

    const result = await runOutboundCoverageSweep(testClient(), now)

    const morning = result.checkpoints.find((c) => c.checkpoint === 'morning_send' && c.logDate === LOG_DATE_COVERAGE)
    expect(morning).toBeDefined()
    expect(morning!.windowClosed).toBe(true)
    // DELTA, not absolute value -- exactly +1, proving the 'failed' row
    // (the second insert) was NOT counted, regardless of how many 'sent'
    // rows this event_key already carries from prior CI runs.
    expect(morning!.sentCount - sentCountBefore).toBe(1)
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
