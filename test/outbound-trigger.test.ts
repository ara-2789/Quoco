import { describe, it, expect, vi, beforeAll } from 'vitest'
import { testClient, readSession } from './helpers/db'
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
// FIXTURE SHAPE, REVIEWER'S DESIGN (2026-08-28), REPLACING two prior
// drafts that each had a real, discovered problem -- recorded in full
// here since this is where the next person writing a test against
// outbound_sends will actually look, not only in a decisions file:
//
//   DRAFT 1 (rejected): the SHARED ensureMorningFixtures()/TEST_PROJECT_ID
//   fixture. outbound_sends has NO DELETE grant for any role, including
//   service_role (migration 031's own header: "a durable send record, not
//   a queue to be pruned... RETENTION... presumed INDEFINITE"), and its
//   project_id/tenant_id FKs are RESTRICT. Every CI run left undeletable
//   rows referencing the shared project, which then blocked EVERY OTHER
//   test file's own removeMorningFixtures() teardown project-wide.
//
//   DRAFT 2 (rejected, the "dedicated fixture, never torn down" shape):
//   one fixed tenant + project + ENGINEER, reused across every run, with
//   per-run uniqueness carried by RANDOMISING event_key's own date (e.g.
//   "morning_send:2139-12-17"). Rejected on two grounds: (a) a randomised
//   FAR-FUTURE date embedded in event_key overloads a column meant to
//   name a real IST calendar day with no real meaning, purely to dodge a
//   collision that has a cleaner fix; (b) two considerations the design
//   never separated -- PARENT fixtures (tenant, project) that are safe to
//   reuse forever because nothing ever deletes or forks them, versus the
//   RECIPIENT (the engineer/user row), which is what the UNIQUE(tenant_id,
//   recipient_user_id, event_key) constraint actually needs fresh per run
//   to avoid a collision, not the date.
//
//   THE SHAPE USED HERE: the tenant and project are the ONLY things fixed
//   and reused -- created once, idempotent-upsert, never torn down (safe:
//   nothing about them is per-run, so there is nothing to accrete at that
//   level). The RECIPIENT is MINTED FRESH by every test (mintOutboundEngineer
//   below) -- a brand-new `users` row with a randomly generated
//   whatsapp_number, retried on collision. Per-run uniqueness now lives
//   where the UNIQUE constraint's own middle column already expects it
//   (recipient_user_id), so event_key can go back to naming an ordinary,
//   realistic date (LOG_DATE below) shared by every test in this file.
//
//   ACCRETION, NAMED AND ACCEPTED, NOT FOUGHT: every test run leaves a new
//   `users` row (and the `outbound_sends`/`whatsapp_sessions`/`daily_logs`
//   rows hanging off it) permanently in test-db -- the composite FK from
//   outbound_sends into users(id, tenant_id) is itself RESTRICT, so a
//   minted engineer can never be deleted once any row references it,
//   exactly like the tenant/project could not be under draft 1. This is
//   accepted as BOUNDED (one extra row per CI run, not an unbounded
//   cross-table cascade) and INSPECTABLE (every minted row lives under the
//   one well-known OUTBOUND_TEST_TENANT_ID, trivially queryable as a
//   group). Cleanup, if it is ever warranted, is an OPERATOR action run by
//   hand under this project's own breadcrumb discipline -- deliberately
//   NOT a code path in this file, which is exactly the shape that caused
//   draft 1's cross-suite breakage in the first place (a test file
//   reaching for DELETE against a table that was never meant to allow it).
//
//   NOT test-db-only DELETE grant either: forking outbound_sends' ACL
//   between test-db and production would corrupt the negative-capability
//   baseline the eventual grants-fix migration (docs/reviews/service-role-
//   table-grants-gap.md) diffs against -- the whole reason a rehearsal
//   environment is useful is that it carries prod's real ACL truth, not a
//   test-only relaxation of it.
const OUTBOUND_TEST_TENANT_ID = '00000000-0000-4000-a000-000000031000'
const OUTBOUND_TEST_PROJECT_ID = '00000000-0000-4000-a000-000000031001'

// One ordinary, realistic IST date, shared by every test in this file --
// uniqueness no longer depends on the date (see the header above), so
// there is no reason for it to vary, and every reason (readability,
// staying within a plausible calendar range) for it not to.
const LOG_DATE = '2026-09-01'

async function ensureOutboundParentFixtures(): Promise<void> {
  const db = testClient()
  const { error: tenantErr } = await db
    .from('tenants')
    .upsert(
      { id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Tenant (outbound-send suite)', slug: 'zz-outbound-send' },
      { onConflict: 'id' },
    )
  if (tenantErr) throw new Error(`ensureOutboundParentFixtures tenant failed: ${tenantErr.message}`)

  const { error: projErr } = await db
    .from('projects')
    .upsert(
      { id: OUTBOUND_TEST_PROJECT_ID, tenant_id: OUTBOUND_TEST_TENANT_ID, name: 'ZZ Test Project (outbound-send suite)' },
      { onConflict: 'id' },
    )
  if (projErr) throw new Error(`ensureOutboundParentFixtures project failed: ${projErr.message}`)
}

interface MintedEngineer {
  id: string
  whatsappNumber: string
}

/**
 * Insert a brand-new `users` row under the shared outbound-send tenant,
 * with a randomly generated whatsapp_number -- retried on a unique-
 * constraint collision (users.whatsapp_number), so a genuine collision
 * (unlikely, not impossible) never flakes the test. The "+19995551"
 * prefix is deliberately the fake NANP test space (test/helpers/db.ts's
 * own TEST_PHONE_PREFIX, "+19995550") with its LAST prefix digit changed
 * from 0 to 1 -- a disjoint range from every existing fixed testPhone('NNN')
 * slot in this repo, by construction, not by checking a list that could
 * go stale.
 */
async function mintOutboundEngineer(): Promise<MintedEngineer> {
  const db = testClient()
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0')
    const whatsappNumber = `+19995551${suffix}`
    const { data, error } = await db
      .from('users')
      .insert({
        tenant_id: OUTBOUND_TEST_TENANT_ID,
        full_name: 'ZZ Test Engineer (outbound-send suite, minted)',
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        whatsapp_number: whatsappNumber,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (!error) return { id: data.id, whatsappNumber }
    if (error.code !== '23505') throw new Error(`mintOutboundEngineer insert failed: ${error.message}`)
    // whatsapp_number collision -- retry with a fresh random suffix.
  }
  throw new Error('mintOutboundEngineer: exhausted retries minting a unique whatsapp_number')
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

  beforeAll(async () => {
    await ensureOutboundParentFixtures()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  })

  // No per-test DB cleanup and no afterAll teardown -- see the file header's
  // ACCRETION section. Every test mints its OWN engineer, so cross-test
  // state bleed (the actual bug in this file's first two drafts) is
  // structurally impossible: no two tests ever share a recipient_user_id,
  // a whatsapp_sessions row, or a daily_logs row.
  it('claims, sends, and activates the session on a fresh morning checkpoint; a second call for the same day is a silent no-op', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMfirst001' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'sent', twilioSid: 'SMfirst001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rowsAfterFirst = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sent')
    expect(rowsAfterFirst[0]!.twilio_sid).toBe('SMfirst001')
    expect(rowsAfterFirst[0]!.content_sid).toBe(MORNING_CHECKIN_SID)

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(1)

    // Second call, same checkpoint+engineer+day -- must no-op BEFORE any
    // Twilio call, per the UNIQUE(tenant_id, recipient_user_id, event_key)
    // constraint being the entire idempotency mechanism.
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // still 1 -- no second Twilio call

    const rowsAfterSecond = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rowsAfterSecond).toHaveLength(1) // no duplicate row
  })

  it('a Twilio 4xx marks the ledger row failed and does NOT activate the session', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: 21211, message: "The 'To' number is not a valid phone number." }),
    )

    const result = await triggerCheckIn({
      checkpoint: 'morning_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('failed')
    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.error).toBeTruthy()

    // No RPC was ever called on this path -- session stays idle.
    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 5xx leaves the ledger row at "sending" (ambiguous, retryable) and does NOT activate the session', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const result = await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('ambiguous')
    const rows = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // untouched -- item F's reconciliation job is out of scope here

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 429 is genuinely retryable -- a second attempt for the same day re-claims and sends', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'rate_limited' })
    const rowsAfterFirst = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sending') // still 'sending', not 'failed'
    expect(rowsAfterFirst[0]!.error).toBe('rate_limited_429_retryable')

    // Second attempt, same event_key -- must RE-CLAIM the existing row
    // (not treat it as already_claimed) and actually send.
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMretried001' }))
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'sent', twilioSid: 'SMretried001' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // both attempts really called Twilio

    const rowsAfterSecond = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rowsAfterSecond).toHaveLength(1) // same row, re-used -- not a duplicate
    expect(rowsAfterSecond[0]!.id).toBe(rowsAfterFirst[0]!.id)
    expect(rowsAfterSecond[0]!.status).toBe('sent')
    expect(rowsAfterSecond[0]!.twilio_sid).toBe('SMretried001')
    expect(rowsAfterSecond[0]!.error).toBeNull() // cleared by the re-claim UPDATE

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow).toBe('morning')
  })

  it('a Twilio 5xx is NOT re-claimable -- a second attempt is still already_claimed, no second Twilio call', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // second attempt never reached Twilio

    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // still stuck -- item F's job, not this file's
    expect(rows[0]!.error).toBeNull() // no 429 marker was ever written
  })

  it('a thrown network exception is NOT re-claimable -- a second attempt is still already_claimed', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))

    const params = {
      checkpoint: 'evening_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rows = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending')
    expect(rows[0]!.error).toBeNull()
  })

  // THE ONE PERMITTED DOUBLE-SEND PATH, EXERCISED, NOT ARGUED. 429 is the
  // only branch where the same event_key can produce more than one Twilio
  // call for the same engineer -- deliberate, because Twilio rejected the
  // request each time nothing was delivered, so a second attempt cannot
  // double-send. These three tests prove the mechanism stays exactly that
  // narrow: it survives repeated 429s, it stops being re-claimable the
  // instant a DIFFERENT failure mode (5xx) is hit, and a caller who loses
  // the compare-and-swap race makes no Twilio call at all.
  it('429, 429, then 2xx: exactly one message ultimately delivered, one ledger row throughout, no duplicate row', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))
    const attempt1 = await triggerCheckIn(params)
    expect(attempt1).toEqual({ outcome: 'rate_limited' })

    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))
    const attempt2 = await triggerCheckIn(params)
    expect(attempt2).toEqual({ outcome: 'rate_limited' }) // re-claimed the SAME row, rejected again

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMthird001' }))
    const attempt3 = await triggerCheckIn(params)
    expect(attempt3).toEqual({ outcome: 'sent', twilioSid: 'SMthird001' }) // re-claimed again, this time delivered

    expect(fetchMock).toHaveBeenCalledTimes(3) // three Twilio calls made...
    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1) // ...but exactly one ledger row throughout
    expect(rows[0]!.status).toBe('sent') // ...and exactly one message ultimately delivered
    expect(rows[0]!.twilio_sid).toBe('SMthird001')
    expect(rows[0]!.error).toBeNull()

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow).toBe('morning') // activated exactly once, on the delivering attempt
  })

  it('429 then 5xx: the row stops being re-claimable and stays at "sending" for item F', async () => {
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    const params = {
      checkpoint: 'evening_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))
    const attempt1 = await triggerCheckIn(params)
    expect(attempt1).toEqual({ outcome: 'rate_limited' })

    // Re-claimed (CAS matches: status='sending', error=marker) -- the
    // re-claim UPDATE clears `error` to null BEFORE this second Twilio
    // call is even made, so when THIS attempt then hits a 5xx, the row is
    // left exactly where the ordinary 5xx path always leaves it:
    // status='sending', error=null -- no marker survives.
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))
    const attempt2 = await triggerCheckIn(params)
    expect(attempt2).toEqual({ outcome: 'ambiguous' })

    const rowsAfter5xx = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE}`)
    expect(rowsAfter5xx).toHaveLength(1)
    expect(rowsAfter5xx[0]!.status).toBe('sending')
    expect(rowsAfter5xx[0]!.error).toBeNull() // NOT the marker -- no longer re-claimable

    // A third attempt must NOT re-claim -- error is null, not the marker,
    // so the CAS matches zero rows and this falls through to
    // already_claimed, exactly like an ordinary stuck 5xx row.
    const attempt3 = await triggerCheckIn(params)
    expect(attempt3).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // the third attempt never called Twilio

    const rowsFinal = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE}`)
    expect(rowsFinal).toHaveLength(1)
    expect(rowsFinal[0]!.status).toBe('sending') // stuck for item F, exactly like a plain 5xx row

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow ?? null).toBeNull() // never activated
  })

  it('a 429 re-claim that loses the compare-and-swap race makes no Twilio call', async () => {
    // True concurrency cannot be exercised in this sandbox (this project's
    // own standing rule: concurrent RPC/function calls serialise in this
    // environment, confirmed elsewhere in this suite's own history) -- so
    // this simulates the LOSING side of the race sequentially instead: a
    // "winner" changes the row out of the re-claimable state (clearing
    // `error`, exactly what the winner's own re-claim UPDATE would do)
    // between this caller's failed claim INSERT and its own re-claim
    // attempt. The CAS is what's under test, not true parallelism -- if
    // the CAS were a plain read-then-write instead of one atomic
    // conditional UPDATE, this exact sequence would still (wrongly) let
    // the loser through.
    fetchMock.mockReset()
    const engineer = await mintOutboundEngineer()
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))
    const attempt1 = await triggerCheckIn(params)
    expect(attempt1).toEqual({ outcome: 'rate_limited' })

    // Simulate a concurrent caller's re-claim UPDATE having already won,
    // an instant before this test's own "loser" call runs its own
    // re-claim attempt -- the exact state the real CAS UPDATE itself
    // would leave behind, produced here directly instead of via a second
    // real triggerCheckIn call, so this test controls the race outcome
    // deterministically.
    {
      const db = testClient()
      const { error } = await db
        .from('outbound_sends')
        .update({ error: null })
        .eq('recipient_user_id', engineer.id)
        .eq('event_key', `morning_send:${LOG_DATE}`)
      if (error) throw new Error(`simulate-winner update failed: ${error.message}`)
    }

    const loser = await triggerCheckIn(params)
    expect(loser).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // only attempt1's call -- the loser never reached Twilio

    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE}`)
    expect(rows).toHaveLength(1) // still one row -- the loser never inserted a second one either
  })

  it('evening checkpoint selects the primary template ({{3}}=morning plan) when one exists, and the no-plan template when it does not', async () => {
    fetchMock.mockReset()
    const engineerWithPlan = await mintOutboundEngineer()
    {
      const db = testClient()
      const { error } = await db.from('daily_logs').upsert(
        {
          tenant_id: OUTBOUND_TEST_TENANT_ID,
          project_id: OUTBOUND_TEST_PROJECT_ID,
          engineer_id: engineerWithPlan.id,
          log_date: LOG_DATE,
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
      engineerId: engineerWithPlan.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineerWithPlan.whatsappNumber,
      logDate: LOG_DATE,
      morningPlan: 'Pour slab on level 3',
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsWithPlan = await readOutboundSends(engineerWithPlan.id, `evening_send:${LOG_DATE}`)
    expect(rowsWithPlan[0]!.content_sid).toBe(EVENING_CHECKIN_SID)

    // A SECOND, freshly minted engineer for the no-plan case -- no daily_logs
    // row exists for this one at all, so no cross-scenario cleanup is needed
    // between the two halves of this test either.
    const engineerNoPlan = await mintOutboundEngineer()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMnoplan001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineerNoPlan.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineerNoPlan.whatsappNumber,
      logDate: LOG_DATE,
      morningPlan: null, // never engaged that day -- no daily_logs row at all
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rowsNoPlan = await readOutboundSends(engineerNoPlan.id, `evening_send:${LOG_DATE}`)
    expect(rowsNoPlan[0]!.content_sid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
  })
})
