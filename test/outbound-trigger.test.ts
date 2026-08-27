import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestDailyLogs,
  cleanupTestSessions,
  seedDailyLogSubmission,
  readSession,
  testEngineerId,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  TEST_ENGINEER_PHONE,
} from './helpers/db'
import { triggerCheckIn } from '@/lib/whatsapp/outbound/trigger'
import { MORNING_CHECKIN_SID, EVENING_CHECKIN_SID, EVENING_CHECKIN_NO_PLAN_SID } from '@/lib/whatsapp/outbound/templates'

// Integration test against REAL test-db (this project's own standing
// practice -- integration tests hit a real database, not mocks). Only the
// Twilio HTTP call is mocked, and it is INJECTED via triggerCheckIn's own
// fetchFn parameter, never via vi.stubGlobal('fetch', ...) -- stubbing
// GLOBAL fetch also intercepts the Supabase JS client's own internal HTTP
// calls (it uses fetch too), which silently fed a mocked Twilio response
// into the real claim INSERT the first time this file was written. See
// send.ts's own doc on the fetchFn parameter for the full account.
//
// outbound_sends HAS NO DELETE GRANT FOR ANY ROLE, INCLUDING service_role --
// deliberate, per migration 031's own header ("this table is a durable send
// record, not a queue to be pruned... RETENTION... presumed INDEFINITE").
// Never attempt to delete outbound_sends rows here. Instead, each run picks
// a random future date range so its event_keys can never collide with a
// PRIOR run's permanently-retained rows -- no cleanup needed for this table
// at all, which is the correct shape given the table's own design.
const RUN_DAY_OFFSET = Math.floor(Math.random() * 50000)
function runDate(daysFromBase: number): string {
  const d = new Date(Date.UTC(2031, 0, 1))
  d.setUTCDate(d.getUTCDate() + RUN_DAY_OFFSET + daysFromBase)
  return d.toISOString().slice(0, 10)
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function readOutboundSends(eventKey: string) {
  const db = testClient()
  const { data, error } = await db
    .from('outbound_sends')
    .select('*')
    .eq('recipient_user_id', testEngineerId())
    .eq('event_key', eventKey)
  if (error) throw new Error(`readOutboundSends failed: ${error.message}`)
  return data ?? []
}

describe('triggerCheckIn (claim -> send -> activate)', () => {
  const fetchMock = vi.fn()

  beforeAll(async () => {
    await ensureMorningFixtures()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  })

  // Each cleanup step runs independently -- one table's cleanup failing must
  // never prevent another table's cleanup from running.
  afterEach(async () => {
    fetchMock.mockReset()
    await cleanupTestSessions()
    await cleanupTestDailyLogs()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await removeMorningFixtures()
  })

  it('claims, sends, and activates the session on a fresh morning checkpoint; a second call for the same day is a silent no-op', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMfirst001' }))

    const logDate = runDate(0)
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      engineerId: testEngineerId(),
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'sent', twilioSid: 'SMfirst001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rowsAfterFirst = await readOutboundSends(`morning_send:${logDate}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sent')
    expect(rowsAfterFirst[0]!.twilio_sid).toBe('SMfirst001')
    expect(rowsAfterFirst[0]!.content_sid).toBe(MORNING_CHECKIN_SID)

    const session = await readSession(TEST_ENGINEER_PHONE)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(1)

    // Second call, same checkpoint+engineer+day -- must no-op BEFORE any
    // Twilio call, per the UNIQUE(tenant_id, recipient_user_id, event_key)
    // constraint being the entire idempotency mechanism.
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // still 1 -- no second Twilio call

    const rowsAfterSecond = await readOutboundSends(`morning_send:${logDate}`)
    expect(rowsAfterSecond).toHaveLength(1) // no duplicate row
  })

  it('a Twilio 4xx marks the ledger row failed and does NOT activate the session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: 21211, message: "The 'To' number is not a valid phone number." }),
    )

    const logDate = runDate(1)
    const result = await triggerCheckIn({
      checkpoint: 'morning_send',
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      engineerId: testEngineerId(),
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('failed')
    const rows = await readOutboundSends(`morning_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.error).toBeTruthy()

    // No RPC was ever called on this path -- session stays idle.
    const session = await readSession(TEST_ENGINEER_PHONE)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 5xx leaves the ledger row at "sending" (ambiguous, retryable) and does NOT activate the session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const logDate = runDate(2)
    const result = await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      engineerId: testEngineerId(),
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('ambiguous')
    const rows = await readOutboundSends(`evening_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // untouched -- item F's reconciliation job is out of scope here

    const session = await readSession(TEST_ENGINEER_PHONE)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('evening checkpoint selects the primary template ({{3}}=morning plan) when one exists, and the no-plan template when it does not', async () => {
    const logDateWithPlan = runDate(3)
    await seedDailyLogSubmission({
      logDate: logDateWithPlan,
      morningSubmittedAt: new Date().toISOString(),
    })
    // seedDailyLogSubmission doesn't set morning_plan directly -- write it via
    // a direct update on the row it just created, matching this table's own
    // real column (getDailyLog's DailyLogRow shape confirms morning_plan
    // exists and is nullable).
    {
      const db = testClient()
      const { error } = await db
        .from('daily_logs')
        .update({ morning_plan: 'Pour slab on level 3' })
        .eq('project_id', TEST_PROJECT_ID)
        .eq('engineer_id', testEngineerId())
        .eq('log_date', logDateWithPlan)
      if (error) throw new Error(`seed morning_plan failed: ${error.message}`)
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMplan001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      engineerId: testEngineerId(),
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: TEST_ENGINEER_PHONE,
      logDate: logDateWithPlan,
      morningPlan: 'Pour slab on level 3',
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsWithPlan = await readOutboundSends(`evening_send:${logDateWithPlan}`)
    expect(rowsWithPlan[0]!.content_sid).toBe(EVENING_CHECKIN_SID)

    await cleanupTestSessions()

    const logDateNoPlan = runDate(4)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMnoplan001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: TEST_TENANT_ID,
      projectId: TEST_PROJECT_ID,
      engineerId: testEngineerId(),
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: TEST_ENGINEER_PHONE,
      logDate: logDateNoPlan,
      morningPlan: null, // never engaged that day -- no daily_logs row at all
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsNoPlan = await readOutboundSends(`evening_send:${logDateNoPlan}`)
    expect(rowsNoPlan[0]!.content_sid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
  })
})
