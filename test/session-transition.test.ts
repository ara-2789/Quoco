import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  acquireAndTransition,
  drainNextPendingFlow,
  seedSession,
  ensureTestTenant,
  cleanupTestSessions,
  removeTestTenant,
  testPhone,
  lockAcquiredAt,
  testClient,
} from './helpers/db'

// Integration tests for the WhatsApp session state machine (migrations 012 +
// 013). Run ONLY against the test-db branch — the globalSetup allowlist guard
// (test/setup/guard.ts) hard-aborts the suite otherwise.
//
// Every row uses a fake +1 999 555-0XXX number; afterEach sweeps them so the
// branch never accumulates test garbage across re-runs.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  await ensureTestTenant()
  await cleanupTestSessions() // start from a clean slate even after a crashed run
})

afterEach(async () => {
  await cleanupTestSessions()
})

afterAll(async () => {
  await cleanupTestSessions()
  await removeTestTenant()
})

describe('acquire_and_transition_session / drain_next_pending_flow', () => {
  // ---------------------------------------------------------------------------
  // Test A — BOT-21 queue correctness (deterministic, no concurrency).
  // A second, different flow requested mid-flow must be QUEUED, never clobber
  // the active flow.
  // ---------------------------------------------------------------------------
  it('A: queues a different flow behind the active one, keeps current_flow', async () => {
    const phone = testPhone('101')

    const first = await acquireAndTransition({ phone, requestedFlow: 'evening' })
    expect(first.current_flow).toBe('evening')
    expect(first.pending_flows).toHaveLength(0)

    const second = await acquireAndTransition({ phone, requestedFlow: 'safety' })
    // Active flow untouched...
    expect(second.current_flow).toBe('evening')
    // ...and safety sits in the queue.
    expect(second.pending_flows).toHaveLength(1)
    expect(second.pending_flows[0].type).toBe('safety')
    expect(second.pending_flows[0].priority).toBe(0) // safety = priority 0 (BOT-26)
  })

  // ---------------------------------------------------------------------------
  // Test B — forced-interleaving LOCK PROOF (the important one).
  // Two concurrent acquires on the SAME phone. Caller 1 holds the row lock
  // across an 800ms injected sleep; Caller 2 must BLOCK on the acquire until
  // Caller 1 commits. Proof is DB-side: each call records clock_timestamp() at
  // its own lock-acquisition point (migration 013), so Caller 2's lock time
  // must be >= Caller 1's lock time + the sleep. The MAGNITUDE proof is immune
  // to JS/network timing noise (a JS promise-resolution measurement would not
  // be) — see ORDERING GUARANTEE below for the ordering half.
  //
  // Caller 2 passes p_test_sleep_ms=0 (not omitted): 0 is non-NULL, so the
  // function still records Caller 2's DB-side lock timestamp, but sleeps 0ms —
  // i.e. genuinely "no pause", exactly as the spec intends.
  //
  // ORDERING GUARANTEE (fixed for real 2026-08-24, docs/reviews/session-
  // transition-lock-wait-flake.md — full incident there, not repeated here).
  // TWO fixes landed for this test, in this order:
  //
  // Fix 1 (SUPERSEDED AS THE MECHANISM, kept only as a backstop below): the
  // original setup fired caller 1, slept 100ms client-side, then fired
  // caller 2, relying on that gap to guarantee caller 1 reached Postgres
  // first — nothing enforced it. The first attempt at a fix detected the
  // actual order from the two DB-side timestamps and retried the setup on
  // inversion. That retry loop hit 3/3 failures in a single real CI run —
  // the signature of a PROCESS-LEVEL bias (this test's own cached
  // `testClient()` connection/pool state disadvantaging caller 1 on every
  // attempt within that run), not per-attempt random jitter, which a bounded
  // retry cannot fix because every retry shares the same biased state.
  //
  // Fix 2 (THE ACTUAL MECHANISM, this fix): two changes.
  //   (a) WARM the shared client with a throwaway round-trip before the
  //       timed section, so caller 1 doesn't pay TCP/TLS/pool-setup cost
  //       INSIDE the measurement — addressing the suspected cause directly.
  //   (b) Don't dispatch caller 2 until caller 1's row lock is OBSERVED
  //       held, via `quoco_test_row_is_locked` (031_session_transition_
  //       lock_probe_nowait.sql) — a `SELECT ... FOR UPDATE NOWAIT` probe
  //       from a SEPARATE connection, polled until it confirms caller 1
  //       holds the lock. This requires the target row to already EXIST
  //       (a row lock inside an uncommitted INSERT is invisible cross-
  //       connection by MVCC design — the probe only works once the row is
  //       a committed row someone can attempt to re-lock), so the row is
  //       SEEDED idle beforehand — the identical starting shape a fresh
  //       INSERT would produce, so caller 1's own decision branch is
  //       unaffected. Once ordering is directly observed rather than
  //       assumed, `lock2 >= lock1` becomes a mathematical consequence of
  //       Postgres's own lock semantics (caller 2 cannot acquire until
  //       caller 1 releases), not a timing bet — ordering no longer depends
  //       on latency AT ALL, which is what a client-side sleep (Fix 1's
  //       setup) or a client-side retry (Fix 1's mechanism) could never
  //       provide.
  //
  // The retry loop is kept below as a LOUD BACKSTOP only, per the same
  // decision this file's history already recorded once — the ordering
  // guarantee should make an inversion structurally impossible, so if one
  // ever occurs anyway it is a genuine bug in this mechanism itself, worth
  // surfacing distinctly, not something to paper over with more retries.
  // ---------------------------------------------------------------------------
  it('B: caller 2 blocks on the row lock until caller 1 commits', async () => {
    const phone = testPhone('102')
    const warmupPhone = testPhone('190')

    // (a) WARM the shared cached client (test/helpers/db.ts's `testClient()`
    // singleton) with a throwaway round-trip through the EXACT same RPC
    // shape callers 1/2 use, so any TCP/TLS/connection-pool setup cost is
    // paid HERE, not inside the timed section below.
    await acquireAndTransition({ phone: warmupPhone, requestedFlow: 'evening' })

    // Fresh, idle row for the real test -- identical shape to what a
    // brand-new INSERT would produce, so caller 1's own decision branch
    // (`current_flow IS NULL` -> start fresh) is unaffected. Required for
    // the NOWAIT probe below: a row must already exist, committed, for
    // another connection to detect contention on it pre-commit.
    await cleanupTestSessions()
    await seedSession({ phone, currentFlow: null, currentStep: 0, context: {}, updatedAt: new Date().toISOString() })

    // Coarse wall-clock bracket around the whole concurrent operation. This
    // is a SANITY CHECK ONLY, not the proof: it guards against a bug in the
    // DB-side timestamp mechanism itself silently making the real assertion
    // vacuous. The authoritative proof is the lockAcquiredAt comparison below.
    const wallStart = performance.now()

    // Fire caller 1 (holds the lock 800ms) -- NOT awaited yet.
    const p1 = acquireAndTransition({ phone, requestedFlow: 'evening', testSleepMs: 800 })

    // (b) THE ORDERING GUARANTEE: poll a SEPARATE connection until it
    // directly observes caller 1 holding the row lock, before caller 2 is
    // ever dispatched. Bounded at 3000ms -- caller 1 holds the lock for
    // 800ms once acquired, so a 3s window is generous slack, not a tight
    // race; a timeout here means caller 1 never reached Postgres at all
    // within a very generous window, a different failure from an ordering
    // inversion and reported as such.
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
        `Test B: caller 1's row lock was never observed within 3000ms via quoco_test_row_is_locked -- ` +
          `caller 1 never appeared to reach Postgres at all in that window. This is a different failure ` +
          `from an ordering inversion (see docs/reviews/session-transition-lock-wait-flake.md) -- ` +
          `investigate caller 1's own dispatch/connection, not the lock mechanism.`,
      )
    }

    // Caller 1's lock is now DIRECTLY OBSERVED held. Fire caller 2 -- its
    // own acquire cannot succeed until caller 1 releases, by construction,
    // regardless of any latency from here on.
    const p2 = acquireAndTransition({ phone, requestedFlow: 'safety', testSleepMs: 0 })

    const [c1, c2] = await Promise.all([p1, p2])

    const wallElapsed = performance.now() - wallStart

    const lock1 = lockAcquiredAt(c1)
    const lock2 = lockAcquiredAt(c2)

    if (lock2 < lock1) {
      // LOUD BACKSTOP ONLY (see ORDERING GUARANTEE above) -- with ordering
      // directly observed before caller 2 ever dispatched, this branch
      // should be UNREACHABLE. Reaching it means the guarantee mechanism
      // itself has a bug, not a timing fluke -- fail immediately, do not
      // retry (retrying a structural guarantee failure would hide it the
      // same way Fix 1's retry hid the process-level bias).
      throw new Error(
        `Test B: ORDERING GUARANTEE FAILED -- lock2 (${lock2}) < lock1 (${lock1}) even though caller 1's ` +
          `lock was directly observed held before caller 2 was dispatched. This is a bug in the ` +
          `quoco_test_row_is_locked probe or the ordering mechanism itself, not timing jitter -- ` +
          `do not retry this. See docs/reviews/session-transition-lock-wait-flake.md.`,
      )
    }

    // PRIMARY PROOF (DB-side): caller 2 could not take the lock until caller 1's
    // txn (lock + 800ms sleep + write) committed. Allow a small margin under
    // 800ms for scheduling, but this is far above the ~0ms a non-blocked race
    // would show.
    expect(lock2 - lock1).toBeGreaterThanOrEqual(750)

    // SECONDARY, COARSE SANITY CHECK ONLY — NOT the proof. If the DB-side
    // mechanism above were broken, the two calls could still not have completed
    // faster than the injected 800ms serialised hold. ~700ms leaves slack for
    // client/network overhead while staying well above a would-be race.
    expect(wallElapsed).toBeGreaterThanOrEqual(700)

    // Final committed state: evening still active, safety queued behind it.
    expect(c2.current_flow).toBe('evening')
    expect(c2.pending_flows).toHaveLength(1)
    expect(c2.pending_flows[0].type).toBe('safety')
  })

  // ---------------------------------------------------------------------------
  // Test C — TTL resume vs next-day reset (BOT-07). Seeds updated_at directly
  // (the column quoco_same_ist_day compares against p_now) with FIXED,
  // IST-anchored constants so the outcome is independent of wall clock / CI TZ.
  // ---------------------------------------------------------------------------
  // The single "current instant" both sub-cases evaluate against.
  const P_NOW = '2026-03-16T12:00:00+05:30' // noon IST, 16 Mar
  // Same IST calendar day as P_NOW, 60 min earlier.
  const UPDATED_SAME_DAY = '2026-03-16T11:00:00+05:30'
  // Previous IST day, 18h before P_NOW and 6h before the 16 Mar 00:00 IST
  // midnight — no time-of-day drift can pull this onto the same IST day.
  const UPDATED_PREV_DAY = '2026-03-15T18:00:00+05:30'

  it('C: same IST day → resume (flow/step/context preserved)', async () => {
    const phone = testPhone('103')
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 3,
      context: { q1: 'poured slab' },
      updatedAt: UPDATED_SAME_DAY,
    })

    // Bare inbound (requestedFlow=null) advancing the existing flow.
    const s = await acquireAndTransition({ phone, requestedFlow: null, now: P_NOW })

    expect(s.current_flow).toBe('morning')
    expect(s.current_step).toBe(3)
    expect(s.context).toEqual({ q1: 'poured slab' })
  })

  it('C: previous IST day → fresh start (flow/step/context wiped)', async () => {
    const phone = testPhone('104')
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 3,
      context: { q1: 'poured slab' },
      updatedAt: UPDATED_PREV_DAY,
    })

    // A new day's trigger requesting 'morning' — must start clean, not resume.
    const s = await acquireAndTransition({ phone, requestedFlow: 'morning', now: P_NOW })

    expect(s.current_flow).toBe('morning')
    expect(s.current_step).toBe(0) // restarted, not resumed from step 3
    expect(s.context).toEqual({}) // prior day's context discarded
    expect(s.pending_flows).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Test D — empty drain (documented PARTIAL test).
  //
  // NOTE / KNOWN FOLLOW-UP: this covers ONLY the empty-queue path — draining a
  // session whose pending_flows is empty must be a safe no-op. Draining a
  // POPULATED queue is intentionally NOT tested here: the only real producer of
  // multi-entry pending_flows is the cron trigger routes (scheduled_trigger,
  // BOT-21), which do not exist yet. When those routes land, the populated-drain
  // path gets its own test. This is a documented gap, not an oversight.
  // ---------------------------------------------------------------------------
  it('D: draining an empty queue is a safe no-op', async () => {
    const phone = testPhone('105')
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 2,
      context: { a: 1 },
      pendingFlows: [],
      updatedAt: P_NOW,
    })

    const s = await drainNextPendingFlow({ phone, now: P_NOW })

    expect(s).not.toBeNull()
    // Nothing promoted: the active flow, step, and context are untouched.
    expect(s?.current_flow).toBe('evening')
    expect(s?.current_step).toBe(2)
    expect(s?.context).toEqual({ a: 1 })
    expect(s?.pending_flows).toHaveLength(0)
  })
})
