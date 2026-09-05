import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { testClient, readSession } from './helpers/db'
import {
  OUTBOUND_TEST_TENANT_ID,
  OUTBOUND_TEST_PROJECT_ID,
  ensureOutboundParentFixtures,
  mintOutboundEngineer,
  cleanupOutboundSends,
  type MintedEngineer,
} from './helpers/outbound-fixtures'
import { triggerCheckIn } from '@/lib/whatsapp/outbound/trigger'
import { MORNING_CHECKIN_SID, EVENING_CHECKIN_SID } from '@/lib/whatsapp/outbound/templates'

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
//   DRAFT 3 (this file as merged in #120, 2026-08-28 -- ALSO had a real,
//   discovered problem, caught the same day by a coordination-checkpoint
//   review, not by anything in CI): the tenant and project were fixed and
//   reused, correctly, but the RECIPIENT-per-test idea above was read too
//   literally -- `mintOutboundEngineer()` was called once per `it()`
//   block, not once per suite. This file has 10 `it()` blocks (one mints
//   twice, for its two sub-scenarios), so ONE full run minted 11 `users`
//   rows, not the 1-per-run this section's own ACCRETION paragraph
//   claimed. Confirmed live: 3 real CI runs left 33 minted rows (11 x 3)
//   plus the 2 permanently-anchored legacy rows from draft 2's own
//   fallout, 35 total, 78 outbound_sends rows anchoring them, all
//   undeletable -- see test/helpers/db.ts's reserved-blocks comment for
//   the running total. The bug was never in the REASONING (recipient-per-
//   run uniqueness is still correct) -- it was in where "per-run" landed:
//   the SUITE runs once per CI invocation; each `it()` does not.
//
//   THE SHAPE USED HERE (current, fixing draft 3's rate): the tenant,
//   project, AND the recipient engineer are now ALL fixed and reused --
//   the engineer is minted ONCE, in this describe block's own `beforeAll`,
//   not inside any individual test. Per-test uniqueness against
//   outbound_sends' own UNIQUE(tenant_id, recipient_user_id, event_key)
//   now has to come from somewhere else, since recipient_user_id is no
//   longer distinct per test -- it comes from event_key's own DATE half
//   instead: every `it()` block below uses its own reserved LOG_DATE_*
//   constant (test/helpers/db.ts's reserved-blocks comment documents this
//   file's whole reserved date range so nothing else collides with it).
//   This is the uniqueness-axis rule recorded in test/helpers/db.ts,
//   alongside the reserved phone/prefix blocks: carry per-test uniqueness
//   on the DATE, never on a minted `users` row, because a minted row is
//   permanent the moment anything references it and a date string costs
//   nothing.
//
//   SESSION SHARING, THE HAZARD THIS SHAPE INTRODUCES THAT DRAFT 3 DID NOT
//   HAVE: whatsapp_sessions is keyed by phone_number ALONE (test/helpers/
//   db.ts's readSession does a bare `.eq('phone_number', phone)`, no
//   event_key or date dimension at all). Draft 3's fresh-engineer-per-test
//   design got a clean session row for free, because a brand-new
//   whatsapp_number had never had a session row created against it. With
//   ONE shared engineer, every test now shares ONE session row -- and
//   apply_{morning,evening}_flow_turn's own `startFlow` branch (mirrored in
//   dispatchMorningFlow for morning; evening has no mirror, migration 035's
//   evening.ts rewrite — see that file's own header for why) only produces
//   outcome 'start' when session.current_flow IS NULL; otherwise it falls into
//   'reask' and leaves the row's current_flow/current_step untouched. Left
//   unhandled, the FIRST test in this file to reach a 2xx delivery would
//   permanently set current_flow to non-null, and every later test
//   asserting either a genuine 'start' activation or `session === null`
//   (no activation) would silently stop testing what its name claims --
//   passing or failing for a reason unrelated to that test's own
//   triggerCheckIn call. FIX: a `beforeEach` below deletes the shared
//   engineer's whatsapp_sessions row before every test, reproducing the
//   same "no row exists yet" starting state draft 3 got for free.
//   whatsapp_sessions (unlike outbound_sends) DOES carry a DELETE grant --
//   test/unit/morning-cutoff-sweep.test.ts already deletes rows from this
//   same table by phone_number, so this is an established pattern in this
//   suite, not a new capability being introduced here.
//
//   ACCRETION, NAMED AND ACCEPTED, NOT FOUGHT -- NOW ACTUALLY 1/RUN: every
//   CI run leaves exactly ONE new `users` row (and the `outbound_sends`/
//   `daily_logs` rows hanging off it -- NOT whatsapp_sessions, which the
//   beforeEach above deletes and recreates every test but never
//   accumulates) permanently in test-db -- the composite FK from
//   outbound_sends into users(id, tenant_id) is itself RESTRICT, so a
//   minted engineer can never be deleted once any row references it,
//   exactly like the tenant/project could not be under draft 1. This is
//   accepted as BOUNDED (one row per CI run, matching what draft 3's own
//   text claimed but did not actually deliver) and INSPECTABLE (every
//   minted row lives under the one well-known OUTBOUND_TEST_TENANT_ID,
//   trivially queryable as a group). Cleanup, if it is ever warranted, is
//   an OPERATOR action run by hand under this project's own breadcrumb
//   discipline -- deliberately NOT a code path in this file, which is
//   exactly the shape that caused draft 1's cross-suite breakage in the
//   first place (a test file reaching for DELETE against a table that was
//   never meant to allow it).
//
//   NOT test-db-only DELETE grant either: forking outbound_sends' ACL
//   between test-db and production would corrupt the negative-capability
//   baseline the eventual grants-fix migration (docs/reviews/service-role-
//   table-grants-gap.md) diffs against -- the whole reason a rehearsal
//   environment is useful is that it carries prod's real ACL truth, not a
//   test-only relaxation of it.
// OUTBOUND_TEST_TENANT_ID, OUTBOUND_TEST_PROJECT_ID, ensureOutboundParent-
// Fixtures, and mintOutboundEngineer now live in test/helpers/outbound-
// fixtures.ts (2026-08-28, item D/F build) -- extracted so
// test/status-callback.test.ts can reuse the exact same parent fixtures
// and minting logic instead of re-typing it. Imported above; the doc
// comments on THE SHAPE USED HERE / SESSION SHARING / ACCRETION in this
// file's own header above still describe the design in full.

// RESERVED DATE RANGE: one date per it() block, plus one extra for the
// one block with two sub-scenarios against the same shared engineer.
// 2026-09-01 through 2026-09-11 are reserved wholesale to this file,
// documented in test/helpers/db.ts alongside the reserved phone/prefix
// blocks so nothing else in this suite picks a colliding date against
// this file's own shared tenant/project/engineer. Ordinary, realistic IST
// dates -- no reason to look synthetic, since uniqueness is their entire
// job now (see the header's THE SHAPE USED HERE section).
const LOG_DATE_FRESH_CLAIM = '2026-09-01'
const LOG_DATE_4XX = '2026-09-02'
const LOG_DATE_5XX_AMBIGUOUS = '2026-09-03'
const LOG_DATE_429_RETRY = '2026-09-04'
const LOG_DATE_5XX_NOT_RECLAIMABLE = '2026-09-05'
const LOG_DATE_NETWORK_EXCEPTION = '2026-09-06'
const LOG_DATE_429_429_2XX = '2026-09-07'
const LOG_DATE_429_THEN_5XX = '2026-09-08'
const LOG_DATE_CAS_RACE_LOSER = '2026-09-09'
const LOG_DATE_EVENING_TEMPLATE = '2026-09-10'

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
  let engineer: MintedEngineer

  beforeAll(async () => {
    await ensureOutboundParentFixtures()
    engineer = await mintOutboundEngineer()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  })

  // Reset the shared engineer's session before every test -- see the file
  // header's SESSION SHARING section for why this is required now that
  // the engineer is shared rather than minted fresh per test.
  beforeEach(async () => {
    const db = testClient()
    const { error } = await db.from('whatsapp_sessions').delete().eq('phone_number', engineer.whatsappNumber)
    if (error) throw new Error(`session reset failed: ${error.message}`)
  })

  // UPDATED 2026-09-05 (Fix 2, admin-merge retrospective): outbound_sends IS
  // now cleaned, in afterAll below, via a test-db-only DELETE grant (see
  // scripts/test-db-only-grants.sql) -- the "no DELETE grant" reasoning this
  // comment used to give is no longer true for THIS table. users/daily_logs
  // cleanup remains out of scope here (see the retrospective's Fix 3 --
  // users rides on Fix 1's own plumbing, a separate PR). Each test's own
  // reserved LOG_DATE_* constant still keeps its event_key disjoint from
  // every other test's regardless, so cross-test state bleed on
  // outbound_sends (the actual bug in this file's first two drafts) stays
  // structurally impossible either way -- this afterAll is about not
  // accumulating rows forever, not about test isolation.
  afterAll(cleanupOutboundSends)

  it('claims, sends, and activates the session on a fresh morning checkpoint; a second call for the same day is a silent no-op', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMfirst001' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_FRESH_CLAIM,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'sent', twilioSid: 'SMfirst001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rowsAfterFirst = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_FRESH_CLAIM}`)
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

    const rowsAfterSecond = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_FRESH_CLAIM}`)
    expect(rowsAfterSecond).toHaveLength(1) // no duplicate row
  })

  it('a Twilio 4xx marks the ledger row failed and does NOT activate the session', async () => {
    fetchMock.mockReset()
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
      logDate: LOG_DATE_4XX,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('failed')
    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_4XX}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.error).toBeTruthy()

    // No RPC was ever called on this path -- session stays idle.
    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 5xx leaves the ledger row at "sending" (ambiguous, retryable) and does NOT activate the session', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const result = await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_5XX_AMBIGUOUS,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(result.outcome).toBe('ambiguous')
    const rows = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE_5XX_AMBIGUOUS}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // untouched -- item F's reconciliation job is out of scope here

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow ?? null).toBeNull()
  })

  it('a Twilio 429 is genuinely retryable -- a second attempt for the same day re-claims and sends', async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 20429, message: 'Too Many Requests' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_429_RETRY,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'rate_limited' })
    const rowsAfterFirst = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_429_RETRY}`)
    expect(rowsAfterFirst).toHaveLength(1)
    expect(rowsAfterFirst[0]!.status).toBe('sending') // still 'sending', not 'failed'
    expect(rowsAfterFirst[0]!.error).toBe('rate_limited_429_retryable')

    // Second attempt, same event_key -- must RE-CLAIM the existing row
    // (not treat it as already_claimed) and actually send.
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMretried001' }))
    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'sent', twilioSid: 'SMretried001' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // both attempts really called Twilio

    const rowsAfterSecond = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_429_RETRY}`)
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
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))

    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_5XX_NOT_RECLAIMABLE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // second attempt never reached Twilio

    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_5XX_NOT_RECLAIMABLE}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('sending') // still stuck -- item F's job, not this file's
    expect(rows[0]!.error).toBeNull() // no 429 marker was ever written
  })

  it('a thrown network exception is NOT re-claimable -- a second attempt is still already_claimed', async () => {
    fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))

    const params = {
      checkpoint: 'evening_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_NETWORK_EXCEPTION,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    }

    const first = await triggerCheckIn(params)
    expect(first).toEqual({ outcome: 'ambiguous' })

    const second = await triggerCheckIn(params)
    expect(second).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const rows = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE_NETWORK_EXCEPTION}`)
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
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_429_429_2XX,
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
    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_429_429_2XX}`)
    expect(rows).toHaveLength(1) // ...but exactly one ledger row throughout
    expect(rows[0]!.status).toBe('sent') // ...and exactly one message ultimately delivered
    expect(rows[0]!.twilio_sid).toBe('SMthird001')
    expect(rows[0]!.error).toBeNull()

    const session = await readSession(engineer.whatsappNumber)
    expect(session?.current_flow).toBe('morning') // activated exactly once, on the delivering attempt
  })

  it('429 then 5xx: the row stops being re-claimable and stays at "sending" for item F', async () => {
    fetchMock.mockReset()
    const params = {
      checkpoint: 'evening_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_429_THEN_5XX,
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

    const rowsAfter5xx = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE_429_THEN_5XX}`)
    expect(rowsAfter5xx).toHaveLength(1)
    expect(rowsAfter5xx[0]!.status).toBe('sending')
    expect(rowsAfter5xx[0]!.error).toBeNull() // NOT the marker -- no longer re-claimable

    // A third attempt must NOT re-claim -- error is null, not the marker,
    // so the CAS matches zero rows and this falls through to
    // already_claimed, exactly like an ordinary stuck 5xx row.
    const attempt3 = await triggerCheckIn(params)
    expect(attempt3).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(2) // the third attempt never called Twilio

    const rowsFinal = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE_429_THEN_5XX}`)
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
    const params = {
      checkpoint: 'morning_send' as const,
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_CAS_RACE_LOSER,
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
        .eq('event_key', `morning_send:${LOG_DATE_CAS_RACE_LOSER}`)
      if (error) throw new Error(`simulate-winner update failed: ${error.message}`)
    }

    const loser = await triggerCheckIn(params)
    expect(loser).toEqual({ outcome: 'already_claimed' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // only attempt1's call -- the loser never reached Twilio

    const rows = await readOutboundSends(engineer.id, `morning_send:${LOG_DATE_CAS_RACE_LOSER}`)
    expect(rows).toHaveLength(1) // still one row -- the loser never inserted a second one either
  })

  it('evening checkpoint always sends the evening check-in template, regardless of morning-plan state', async () => {
    // Pre-2v3, this test exercised a branch (plan vs no-plan -> two
    // different SIDs) that no longer exists: §40 retired the {{3}}
    // morning-plan echo, so selectEveningTemplate no longer branches at
    // all (templates.ts's own header, 2026-09-02). One case is now the
    // whole test -- confirming the checkpoint uses the current
    // EVENING_CHECKIN_SID (2v3) is what's left worth asserting here; the
    // pure two-variable shape itself is covered by
    // test/unit/outbound-templates.test.ts.
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMevening001' }))
    await triggerCheckIn({
      checkpoint: 'evening_send',
      tenantId: OUTBOUND_TEST_TENANT_ID,
      projectId: OUTBOUND_TEST_PROJECT_ID,
      engineerId: engineer.id,
      engineerName: 'ZZ Test Engineer',
      projectName: 'ZZ Test Project',
      whatsappNumber: engineer.whatsappNumber,
      logDate: LOG_DATE_EVENING_TEMPLATE,
      supabaseClient: testClient(),
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    const rows = await readOutboundSends(engineer.id, `evening_send:${LOG_DATE_EVENING_TEMPLATE}`)
    expect(rows[0]!.content_sid).toBe(EVENING_CHECKIN_SID)
  })
})
