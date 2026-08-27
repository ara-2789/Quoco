import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { testClient, testPhone, readSession, cleanupTestSessions } from './helpers/db'
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
// DEDICATED FIXTURE, NEVER TORN DOWN -- deliberately NOT the shared
// ensureMorningFixtures()/TEST_TENANT_ID/TEST_PROJECT_ID used by most of
// this suite. outbound_sends has NO DELETE grant for any role, including
// service_role (migration 031's own header: "a durable send record, not a
// queue to be pruned... RETENTION... presumed INDEFINITE"), and its
// project_id/tenant_id FKs are RESTRICT. The first two drafts of this file
// used the SHARED morning-flow fixture and, on every CI run, left
// undeletable outbound_sends rows referencing it -- which then blocked
// EVERY OTHER test file's own removeMorningFixtures() teardown with
// "update or delete on table projects violates foreign key constraint
// outbound_sends_project_id_tenant_id_fkey", failing the whole suite, not
// just this file. The five poisoned rows from those runs were deleted by
// hand (supabase db query --linked, a privileged connection --
// service_role itself cannot delete them either) before this fix landed.
// The fix: this file gets its OWN tenant/project/engineer, created once
// and left in place forever -- matching outbound_sends' own permanence
// instead of fighting it. Only daily_logs and whatsapp_sessions rows
// (both fully deletable) are cleaned per-test; the fixture identity itself
// is idempotent-upsert and never removed.
const OUTBOUND_TEST_TENANT_ID = '00000000-0000-4000-a000-000000031000'
const OUTBOUND_TEST_PROJECT_ID = '00000000-0000-4000-a000-000000031001'
// '550' checked against every testPhone('NNN')/+19995550NNN slot already
// claimed elsewhere in test/ before picking it (grep -rohE
// "testPhone\('[0-9]+'\)|\+19995550[0-9]{3}") -- the ORIGINAL choice here
// was '301', which silently collided with test/unit/checkin-escalations-
// sweep.test.ts's own dedicated fixture (also unaware of the other's
// choice, since neither file imports the other's constants) and broke
// that file's roster assertions in CI. Same root cause as the shared-
// project-fixture bug above, one level down: an ID space that LOOKS free
// because grepping only your own file finds nothing.
const OUTBOUND_TEST_ENGINEER_PHONE = testPhone('550')

async function ensureOutboundFixtures(): Promise<string> {
  const db = testClient()

  const { error: tenantErr } = await db
    .from('tenants')
    .upsert(
      { id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Tenant (outbound-send suite)', slug: 'zz-outbound-send' },
      { onConflict: 'id' },
    )
  if (tenantErr) throw new Error(`ensureOutboundFixtures tenant failed: ${tenantErr.message}`)

  const { data: existing, error: selErr } = await db
    .from('users')
    .select('id')
    .eq('whatsapp_number', OUTBOUND_TEST_ENGINEER_PHONE)
    .maybeSingle<{ id: string }>()
  if (selErr) throw new Error(`ensureOutboundFixtures select engineer failed: ${selErr.message}`)

  let engineerId: string
  if (existing) {
    engineerId = existing.id
  } else {
    const { data: ins, error } = await db
      .from('users')
      .insert({
        tenant_id: OUTBOUND_TEST_TENANT_ID,
        full_name: 'ZZ Test Engineer (outbound-send suite)',
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        whatsapp_number: OUTBOUND_TEST_ENGINEER_PHONE,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (error || !ins) throw new Error(`ensureOutboundFixtures insert engineer failed: ${error?.message ?? 'no row returned'}`)
    engineerId = ins.id
  }

  const { error: projErr } = await db
    .from('projects')
    .upsert(
      { id: OUTBOUND_TEST_PROJECT_ID, tenant_id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Project (outbound-send suite)' },
      { onConflict: 'id' },
    )
  if (projErr) throw new Error(`ensureOutboundFixtures project failed: ${projErr.message}`)

  const { error: memberErr } = await db
    .from('project_members')
    .upsert(
      { tenant_id: OUTBOUND_TEST_TENANT_ID, project_id: OUTBOUND_TEST_PROJECT_ID, user_id: engineerId, role: 'engineer' },
      { onConflict: 'project_id,user_id' },
    )
  if (memberErr) throw new Error(`ensureOutboundFixtures member failed: ${memberErr.message}`)

  return engineerId
}

// daily_logs DOES support DELETE for service_role (only outbound_sends is
// restricted) -- safe to fully clean between tests, scoped to this file's
// own dedicated project so it never touches the shared morning-flow suite.
async function cleanupOutboundDailyLogs(): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').delete().eq('project_id', OUTBOUND_TEST_PROJECT_ID)
  if (error) throw new Error(`cleanupOutboundDailyLogs failed: ${error.message}`)
}

// event_key dates are still randomised per run (rather than reusing a fixed
// day across every CI run forever) purely to keep outbound_sends' own
// permanent rows from growing unboundedly recognisable/collidable -- not
// needed for correctness now that this fixture is dedicated, but cheap
// hygiene given the table can never be pruned.
const RUN_DAY_OFFSET = Math.floor(Math.random() * 50000)
function runDate(daysFromBase: number): string {
  const d = new Date(Date.UTC(2031, 0, 1))
  d.setUTCDate(d.getUTCDate() + RUN_DAY_OFFSET + daysFromBase)
  return d.toISOString().slice(0, 10)
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function readOutboundSends(engineerId: string, eventKey: string) {
  const db = testClient()
  const { data, error } = await db
    .from('outbound_sends')
    .select('*')
    .eq('recipient_user_id', engineerId)
    .eq('event_key', eventKey)
  if (error) throw new Error(`readOutboundSends failed: ${error.message}`)
  return data ?? []
}

describe('triggerCheckIn (claim -> send -> activate)', () => {
  const fetchMock = vi.fn()
  let engineerId: string

  beforeAll(async () => {
    engineerId = await ensureOutboundFixtures()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  })

  // No afterAll teardown of the fixture itself -- see file header. Each
  // cleanup step below runs independently so one failing never blocks
  // another (the actual bug that made the first two drafts of this file
  // leak state between tests).
  afterEach(async () => {
    fetchMock.mockReset()
    await cleanupTestSessions()
    await cleanupOutboundDailyLogs()
  })

  it('claims, sends, and activates the session on a fresh morning checkpoint; a second call for the same day is a silent no-op', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMfirst001' }))

    const logDate = runDate(0)
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'sent', twilioSid: 'SMfirst001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rowsAfterFirst = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sent')
    expect(rowsAfterFirst[0]!.twilio_sid).toBe('SMfirst001')
    expect(rowsAfterFirst[0]!.content_sid).toBe(MORNING_CHECKIN_SID)

    const session = await readSession(OUTBOUND_TEST_ENGINEER_PHONE)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(1)

    // Second call, same checkpoint+engineer+day -- must no-op BEFORE any
    // Twilio call, per the UNIQUE(tenant_id, recipient_user_id, event_key)
    // constraint being the entire idempotency mechanism.
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // still 1 -- no second Twilio call

    const rowsAfterSecond = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rowsAfterSecond).toHaveLength(1) // no duplicate row
  })

  it('a Twilio 4xx marks the ledger row failed and does NOT activate the session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: 21211, message: "The 'To' number is not a valid phone number." }),
    )

    const logDate = runDate(1)
    const result = await triggerCheckIn({
      checkpoint: 'morning_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('failed')
    const rows = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.error).toBeTruthy()

    // No RPC was ever called on this path -- session stays idle.
    const session = await readSession(OUTBOUND_TEST_ENGINEER_PHONE)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 5xx leaves the ledger row at "sending" (ambiguous, retryable) and does NOT activate the session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const logDate = runDate(2)
    const result = await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('ambiguous')
    const rows = await readOutboundSends(engineerId, `evening_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // untouched -- item F's reconciliation job is out of scope here

    const session = await readSession(OUTBOUND_TEST_ENGINEER_PHONE)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 429 is genuinely retryable -- a second attempt for the same day re-claims and sends', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))

    const logDate = runDate(5)
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'rate_limited' })
    const rowsAfterFirst = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sending') // still 'sending', not 'failed'
    expect(rowsAfterFirst[0]!.error).toBe('rate_limited_429_retryable')

    // Second attempt, same event_key -- must RE-CLAIM the existing row
    // (not treat it as already_claimed) and actually send.
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMretried001' }))
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'sent', twilioSid: 'SMretried001' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // both attempts really called Twilio

    const rowsAfterSecond = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rowsAfterSecond).toHaveLength(1) // same row, re-used -- not a duplicate
    expect(rowsAfterSecond[0]!.id).toBe(rowsAfterFirst[0]!.id)
    expect(rowsAfterSecond[0]!.status).toBe('sent')
    expect(rowsAfterSecond[0]!.twilio_sid).toBe('SMretried001')
    expect(rowsAfterSecond[0]!.error).toBeNull() // cleared by the re-claim UPDATE

    const session = await readSession(OUTBOUND_TEST_ENGINEER_PHONE)
    expect(session?.current_flow).toBe('morning')
  })

  it('a Twilio 5xx is NOT re-claimable -- a second attempt is still already_claimed, no second Twilio call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const logDate = runDate(6)
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // second attempt never reached Twilio

    const rows = await readOutboundSends(engineerId, `morning_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // still stuck -- item F's job, not this file's
    expect(rows[0]!.error).toBeNull() // no 429 marker was ever written
  })

  it('a thrown network exception is NOT re-claimable -- a second attempt is still already_claimed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))

    const logDate = runDate(7)
    const params = {
      checkpoint: 'evening_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rows = await readOutboundSends(engineerId, `evening_send:${logDate}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending')
    expect(rows[0]!.error).toBeNull()
  })

  it('evening checkpoint selects the primary template ({{3}}=morning plan) when one exists, and the no-plan template when it does not', async () => {
    const logDateWithPlan = runDate(3)
    {
      const db = testClient()
      const { error } = await db.from('daily_logs').upsert(
        {
          tenant_id: OUTBOUND_TEST_TENANT_ID,
          project_id: OUTBOUND_TEST_PROJECT_ID,
          engineer_id: engineerId,
          log_date: logDateWithPlan,
          morning_submitted_at: new Date().toISOString(),
          morning_plan: 'Pour slab on level 3',
        },
        { onConflict: 'project_id,engineer_id,log_date' },
      )
      if (error) throw new Error(`seed morning_plan failed: ${error.message}`)
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMplan001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate: logDateWithPlan,
      morningPlan: 'Pour slab on level 3',
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsWithPlan = await readOutboundSends(engineerId, `evening_send:${logDateWithPlan}`)
    expect(rowsWithPlan[0]!.content_sid).toBe(EVENING_CHECKIN_SID)

    await cleanupTestSessions()

    const logDateNoPlan = runDate(4)
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMnoplan001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: OUTBOUND_TEST_ENGINEER_PHONE,
      logDate: logDateNoPlan,
      morningPlan: null, // never engaged that day -- no daily_logs row at all
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsNoPlan = await readOutboundSends(engineerId, `evening_send:${logDateNoPlan}`)
    expect(rowsNoPlan[0]!.content_sid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
  })
})
