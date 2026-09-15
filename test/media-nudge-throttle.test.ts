import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { testClient, ensureTestTenant, removeTestTenant, cleanupTestSessions, testPhone, readSession, TEST_TENANT_ID } from './helpers/db'

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

async function claim(phone: string, now: string, windowSeconds = NUDGE_WINDOW_SECONDS): Promise<boolean> {
  const { data, error } = await testClient().rpc('claim_media_nudge', {
    p_phone_number: phone,
    p_tenant_id: TEST_TENANT_ID,
    p_user_id: null,
    p_now: now,
    p_window_seconds: windowSeconds,
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

  // CONCURRENCY -- 5 concurrent calls for one phone number, asserting
  // exactly one true. Written in this file's own established shape
  // (Promise.all over testClient().rpc(...), same as test/session-
  // transition.test.ts's own Test B) for consistency with the rest of this
  // suite -- but per CLAUDE.md's own standing rule
  // (docs/reviews/sandbox-cannot-test-concurrency.md), a LOCAL green run of
  // this exact shape is NOT evidence: this sandbox has been shown, directly,
  // to dispatch "concurrent" Supabase JS-client RPC calls serially rather
  // than genuinely interleaved (each call's full round-trip completes before
  // the next is even dispatched), so this test would pass trivially in this
  // sandbox regardless of whether the underlying row lock works. CI is the
  // one environment proven to exercise real concurrent RPC dispatch against
  // test-db. Separately -- NOT a substitute for running this file in CI, but
  // real evidence the SQL itself is correct -- 5 genuinely concurrent OS
  // processes (raw psql, not this JS-client shape) against a real local
  // Postgres with 045 applied returned exactly one `true` on 4 separate runs;
  // full transcript in docs/reviews/045-review-brief.md.
  it('exactly one of 5 concurrent claims for the same phone number succeeds — NOT verified locally, CI-only (see comment above)', async () => {
    const phone = testPhone('907')
    const now = '2026-09-15T10:00:00Z'
    const results = await Promise.all([
      claim(phone, now),
      claim(phone, now),
      claim(phone, now),
      claim(phone, now),
      claim(phone, now),
    ])
    const trueCount = results.filter((r) => r === true).length
    expect(trueCount).toBe(1)
  })
})
