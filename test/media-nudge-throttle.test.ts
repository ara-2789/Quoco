import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  testClient,
  ensureTestTenant,
  removeTestTenant,
  cleanupTestSessions,
  seedSession,
  testPhone,
  readSession,
  TEST_TENANT_ID,
} from './helpers/db'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Integration tests for claim_media_nudge (migration 045, stage 3 of the
// media capability). HELD -- NOT applied to any database yet; see
// docs/reviews/045-review-brief.md for the full review package and
// docs/reviews/045_media_nudge_throttle.sql for the function itself. This
// file is written for the review package and for CI once the migration
// actually lands on test-db -- it CANNOT run in the session that authored
// it, for two independent reasons, both worth stating plainly rather than
// claiming a pass that never happened:
//   1. This project's own vitest globalSetup guard (test/setup/guard.ts)
//      hard-aborts the ENTIRE run -- every file, unit tests included -- the
//      moment SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_ROLE_KEY/
//      SUPABASE_TEST_ANON_KEY/SUPABASE_TEST_PROJECT_REF are missing or
//      malformed, and this environment has no .env.test at all.
//   2. Even with real test-db credentials, claim_media_nudge does not exist
//      there until migration 045 is actually applied -- CLAUDE.md's own
//      standing rule ("a migration file enters supabase/migrations/ when it
//      is being applied, not when it is written") is why this file's SQL
//      still lives in docs/reviews/, not supabase/migrations/.
//
// What WAS verified this round, against a real (local, disposable) Postgres
// 17 instance with the actual 001-044 migration history replayed onto it:
// the same context-survival / updated_at-immutability / malformed-timestamp
// behaviour this file asserts, via raw psql, plus the 5-concurrent-calls
// claim in a genuinely separate-OS-process shape (not this file's own
// Promise.all-over-one-JS-client shape) -- see docs/reviews/045-review-
// brief.md for the full transcript. That is real evidence the SQL is
// correct; it is not a substitute for this file actually running against
// test-db, which is what CI does once 045 is applied there.

const NUDGE_WINDOW_SECONDS = 300

beforeAll(async () => {
  await ensureTestTenant()
  await cleanupTestSessions()
})

afterEach(async () => {
  await cleanupTestSessions()
})

afterAll(async () => {
  await cleanupTestSessions()
  await removeTestTenant()
})

async function claim(
  phone: string,
  now: string,
  windowSeconds = NUDGE_WINDOW_SECONDS,
  testSleepMs?: number,
): Promise<boolean> {
  const { data, error } = await testClient().rpc('claim_media_nudge', {
    p_phone_number: phone,
    p_tenant_id: TEST_TENANT_ID,
    p_user_id: null,
    p_now: now,
    p_window_seconds: windowSeconds,
    ...(testSleepMs !== undefined ? { p_test_sleep_ms: testSleepMs } : {}),
  })
  if (error) throw new Error(`claim_media_nudge failed: ${error.message}`)
  return data as unknown as boolean
}

describe('claim_media_nudge (migration 045)', () => {
  it('first call for a phone number claims (true), and materialises an idle session row', async () => {
    const phone = testPhone('901')
    const claimed = await claim(phone, '2026-09-15T10:00:00Z')
    expect(claimed).toBe(true)
    const session = await readSession(phone)
    expect(session).not.toBeNull()
    expect(session?.current_flow).toBeNull()
    expect((session?.context as Record<string, unknown> | null)?.['last_media_nudge_at']).toBeTruthy()
  })

  it('a second call 60s later (within the 300s window) does not claim (false)', async () => {
    const phone = testPhone('902')
    expect(await claim(phone, '2026-09-15T10:00:00Z')).toBe(true)
    expect(await claim(phone, '2026-09-15T10:01:00Z')).toBe(false)
  })

  it('a third call after the window (301s later) claims again (true)', async () => {
    const phone = testPhone('903')
    expect(await claim(phone, '2026-09-15T10:00:00Z')).toBe(true)
    expect(await claim(phone, '2026-09-15T10:01:00Z')).toBe(false)
    expect(await claim(phone, '2026-09-15T10:05:01Z')).toBe(true)
  })

  it('other context keys survive across a claim', async () => {
    const phone = testPhone('904')
    // Seed a session with an unrelated context key directly, the same way
    // 038/044's own tests seed pre-existing state.
    await testClient().from('whatsapp_sessions').insert({
      phone_number: phone,
      tenant_id: TEST_TENANT_ID,
      current_flow: null,
      current_step: 0,
      context: { other_key: 'should_survive' },
    })
    await claim(phone, '2026-09-15T10:00:00Z')
    const session = await readSession(phone)
    const context = session?.context as Record<string, unknown> | null
    expect(context?.['other_key']).toBe('should_survive')
    expect(context?.['last_media_nudge_at']).toBeTruthy()
  })

  it('updated_at is never changed by claim_media_nudge, on a pre-existing row', async () => {
    const phone = testPhone('905')
    const seededUpdatedAt = '2026-09-01T00:00:00Z'
    await testClient().from('whatsapp_sessions').insert({
      phone_number: phone,
      tenant_id: TEST_TENANT_ID,
      current_flow: null,
      current_step: 0,
      context: {},
      updated_at: seededUpdatedAt,
    })
    await claim(phone, '2026-09-15T10:00:00Z')
    const afterFirst = await readSession(phone)
    expect(new Date(afterFirst!.updated_at).getTime()).toBe(new Date(seededUpdatedAt).getTime())

    // And again after a throttled (false) call, and again after a
    // window-elapsed (true) call -- updated_at must never move, in either case.
    await claim(phone, '2026-09-15T10:01:00Z')
    const afterThrottled = await readSession(phone)
    expect(new Date(afterThrottled!.updated_at).getTime()).toBe(new Date(seededUpdatedAt).getTime())

    await claim(phone, '2026-09-15T10:05:01Z')
    const afterSecondClaim = await readSession(phone)
    expect(new Date(afterSecondClaim!.updated_at).getTime()).toBe(new Date(seededUpdatedAt).getTime())
  })

  it('a malformed last_media_nudge_at value is treated as absent (claims true)', async () => {
    const phone = testPhone('906')
    await testClient().from('whatsapp_sessions').insert({
      phone_number: phone,
      tenant_id: TEST_TENANT_ID,
      current_flow: null,
      current_step: 0,
      context: { last_media_nudge_at: 'not-a-real-timestamp' },
    })
    expect(await claim(phone, '2026-09-15T10:00:00Z')).toBe(true)
  })

  // CONCURRENCY -- external review fold, item 4 (2026-09-15): rewritten to
  // use the SAME forced-interleaving sleep hook test/session-transition.
  // test.ts's own Test B uses for acquire_and_transition_session (012), and
  // apply_hindrance_flow_turn's own rehearsal (044) mirrors -- p_test_sleep_ms
  // holds caller 1's row lock open for a fixed window, and
  // quoco_test_row_is_locked (032_session_transition_lock_probe_nowait.sql,
  // a generic `SELECT ... FOR UPDATE NOWAIT` probe on whatsapp_sessions by
  // phone_number, already applied and reusable as-is -- it does not care
  // WHICH function holds the lock) is polled until caller 1's lock is
  // DIRECTLY OBSERVED held, before callers 2-5 are ever dispatched. This
  // removes the earlier version's own client-side-sleep-guess shape (fire 5
  // calls via one bare Promise.all with no ordering guarantee at all) --
  // the exact anti-pattern this project's own history
  // (docs/reviews/session-transition-lock-wait-flake.md) already found and
  // fixed once for 012/013's own Test B.
  //
  // The NOWAIT probe requires the target row to already exist, COMMITTED --
  // a row lock inside an uncommitted INSERT is invisible cross-connection by
  // MVCC design (session-transition.test.ts's own Test B comment explains
  // this in full) -- so the row is seeded idle beforehand, identical to
  // Test B's own setup.
  //
  // Even with genuine forced interleaving, this is STILL reported as
  // NOT-VERIFIED-LOCALLY, CI-only, per CLAUDE.md's own standing rule
  // (docs/reviews/sandbox-cannot-test-concurrency.md): that rule's own root
  // cause is this sandbox failing to dispatch a SECOND concurrent Supabase
  // JS-client call until the FIRST call's entire round-trip has already
  // returned -- a forced-interleave ordering guarantee on the SQL side
  // changes nothing about whether the JS-client layer in THIS sandbox can
  // even get callers 2-5 in flight while caller 1 is still running. Real
  // evidence the SQL itself is correct: 5 genuinely concurrent OS processes
  // (raw psql, not this JS-client shape) against a real local Postgres with
  // 045 applied returned exactly one `true` on 4 separate runs; full
  // transcript in docs/reviews/045-review-brief.md.
  it('exactly one of 5 forced-interleaved concurrent claims for the same phone number succeeds — NOT verified locally, CI-only (see comment above)', async () => {
    const phone = testPhone('907')
    const now = '2026-09-15T10:00:00Z'

    // Seeded idle -- identical shape to what claim_media_nudge's own
    // first-ever INSERT would produce, so caller 1's own decision branch
    // (no last_media_nudge_at yet -> claim) is unaffected. Required for the
    // NOWAIT probe below (see this test's own header comment).
    await seedSession({ phone, currentFlow: null, currentStep: 0, context: {}, updatedAt: new Date().toISOString() })

    // Fire caller 1 (holds the lock 800ms) -- NOT awaited yet.
    const p1 = claim(phone, now, NUDGE_WINDOW_SECONDS, 800)

    // THE ORDERING GUARANTEE: poll a separate call until quoco_test_row_is_
    // locked directly observes caller 1 holding the row lock, before any of
    // callers 2-5 are ever dispatched. Bounded at 3000ms, same generous
    // slack as Test B's own identical poll (caller 1 holds the lock for
    // 800ms once acquired).
    const db = testClient()
    const pollDeadline = Date.now() + 3000
    let observedLocked = false
    while (Date.now() < pollDeadline) {
      const { data, error } = await db.rpc('quoco_test_row_is_locked', { p_phone_number: phone })
      if (error) throw new Error(`quoco_test_row_is_locked failed: ${error.message}`)
      if (data === true) {
        observedLocked = true
        break
      }
      await sleep(5)
    }
    if (!observedLocked) {
      throw new Error(
        `Test (concurrency): caller 1's row lock was never observed within 3000ms via ` +
          `quoco_test_row_is_locked -- caller 1 never appeared to reach Postgres at all in that ` +
          `window. Investigate caller 1's own dispatch/connection, not the lock mechanism.`,
      )
    }

    // Caller 1's lock is now directly observed held. Fire callers 2-5 --
    // none of their own acquires can succeed until caller 1 releases, by
    // construction, regardless of any latency from here on. testSleepMs=0
    // (not omitted), same reasoning as Test B's own caller 2: 0 is non-NULL,
    // so the guard branch still runs (a genuine no-op sleep), matching the
    // spec's own intent exactly rather than relying on omission defaulting
    // the same way.
    const rest = await Promise.all([
      claim(phone, now, NUDGE_WINDOW_SECONDS, 0),
      claim(phone, now, NUDGE_WINDOW_SECONDS, 0),
      claim(phone, now, NUDGE_WINDOW_SECONDS, 0),
      claim(phone, now, NUDGE_WINDOW_SECONDS, 0),
    ])
    const first = await p1

    const trueCount = [first, ...rest].filter((r) => r === true).length
    expect(trueCount).toBe(1)
  })
})
