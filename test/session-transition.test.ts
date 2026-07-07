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
  // must be >= Caller 1's lock time + the sleep. This is immune to JS/network
  // timing noise (a JS promise-resolution measurement would not be).
  //
  // Caller 2 passes p_test_sleep_ms=0 (not omitted): 0 is non-NULL, so the
  // function still records Caller 2's DB-side lock timestamp, but sleeps 0ms —
  // i.e. genuinely "no pause", exactly as the spec intends.
  // ---------------------------------------------------------------------------
  it('B: caller 2 blocks on the row lock until caller 1 commits', async () => {
    const phone = testPhone('102')

    // Coarse wall-clock bracket around the whole concurrent operation. This is
    // a SANITY CHECK ONLY, not the proof: it guards against a bug in the
    // DB-side timestamp mechanism itself silently making the real assertion
    // vacuous. The authoritative proof is the lockAcquiredAt comparison below.
    const wallStart = performance.now()

    // Fire caller 1 (holds the lock 800ms), then caller 2 a beat later so
    // caller 1 is guaranteed to reach the acquire first.
    const p1 = acquireAndTransition({ phone, requestedFlow: 'evening', testSleepMs: 800 })
    await sleep(100)
    const p2 = acquireAndTransition({ phone, requestedFlow: 'safety', testSleepMs: 0 })

    const [c1, c2] = await Promise.all([p1, p2])

    const wallElapsed = performance.now() - wallStart

    const lock1 = lockAcquiredAt(c1)
    const lock2 = lockAcquiredAt(c2)

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
