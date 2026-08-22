# `test/session-transition.test.ts` Test B — lock-wait flake, tracked not fixed

**Status: OPEN. Do not fix from this document alone** — this is a tracking
record, written so tomorrow's fix starts from the actual timing code instead
of a rediscovery, not a diagnosis run to a conclusion. Filed per direct
instruction, 2026-08-22, after the second same-day occurrence and an explicit
"do not re-run a third time" decision.

## The two recorded failures

Both are the SAME assertion, in the SAME test, with a NEGATIVE elapsed value
both times — not a marginal near-750 miss, which is what ordinary CI slowness
or scheduling noise would produce.

### Failure 1 — 2026-08-22T04:05:50Z ("this morning")

- Run: [32550782109](https://github.com/ara-2789/Quoco/actions/runs/32550782109), job `96977041934`, run attempt 1 (never itself re-run)
- Trigger: `push` to `main` — the merge commit for PR #84
  (`docs/record-real-submission-results`, **docs-only**), SHA
  `41276b8e9a19acfe94ee255d48725427189dd4c4`
- Not a PR gate, so nothing blocked on it — it failed silently on a
  post-merge `main` push and nobody had to look at it. Left alone; not acted
  on until this write-up.
- Literal output:
  ```
  FAIL  test/session-transition.test.ts > acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits
  AssertionError: expected -33 to be greater than or equal to 750
   ❯ test/session-transition.test.ts:97:27
     97|     expect(lock2 - lock1).toBeGreaterThanOrEqual(750)
  ```

### Failure 2 — 2026-08-22T16:32:42Z (just now)

- Run: [32585024502](https://github.com/ara-2789/Quoco/actions/runs/32585024502), job `97059987908` (attempt 1, failed)
- Trigger: `pull_request` — PR #90 (`docs/rescue-only-here-findings`,
  **docs-only**), SHA `03d4a2c3d4ac22873dcf4d05909ccb2a48c81375`
- **Re-run once** (`gh run rerun 32585024502 --failed`, classified in the
  moment as timing/lock-order flakiness given the PR touches zero
  application code — not blindly re-run without a stated reason, but a
  re-run all the same). Second attempt, job `97061188848`, passed. Per
  direct instruction, this is the LAST time this test gets re-run to green
  without a real fix — a third occurrence stops the merge instead.
- Literal output:
  ```
  FAIL  test/session-transition.test.ts > acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits
  AssertionError: expected -317 to be greater than or equal to 750
   ❯ test/session-transition.test.ts:97:27
     97|     expect(lock2 - lock1).toBeGreaterThanOrEqual(750)
  ```

## Why "negative" is a specific, meaningful signal — not generic flakiness

`lock2 - lock1` measures the gap between two `clock_timestamp()` reads taken
**inside the same Postgres function, on the same server**, at the moment each
caller acquires the row lock (see the SQL below). A small-but-positive value
under 750 would be consistent with CI-runner scheduling slack eating into the
800ms hold — ordinary noise. A **negative** value means caller 2's recorded
lock-acquisition timestamp is *earlier* than caller 1's, on the same clock —
which is not noise, it is either (a) the two variables genuinely got the
wrong caller's data, or (b) caller 2 actually acquired the row lock before
caller 1 did, inverting the order the test assumes.

**(a) is ruled out by direct code inspection** (see the test source below):
`[c1, c2] = await Promise.all([p1, p2])` destructures by *position*, not by
resolution order — `c1` is always caller 1's response and `c2` is always
caller 2's, regardless of which promise settles first. So this is not a
`c1`/`c2` mislabeling bug in the test.

**(b) is the standing, UNCONFIRMED hypothesis, recorded so it doesn't need
re-deriving:** the test fires caller 1's request, `await sleep(100)`, then
fires caller 2's request — relying on that 100ms client-side head start to
guarantee caller 1's HTTP/PostgREST request reaches Postgres and acquires the
row lock first. There is no DB-side or server-side synchronization enforcing
that order — only a 100ms client-side gap between when the two `fetch`-level
calls are *issued*. Under sufficient network/scheduling jitter on the CI
runner or against test-db, it is possible for caller 2's request to reach
Postgres and begin its transaction (acquiring the lock) before caller 1's
does, despite firing 100ms later. If that happens: caller 2 (0ms configured
sleep) acquires the lock, reads its `clock_timestamp()` immediately, and
commits almost instantly; caller 1 (800ms configured sleep) then acquires the
now-free lock *afterward*, reads *its* `clock_timestamp()` at that later
point, and holds it for 800ms. Caller 1's timestamp (`lock1`) ends up later
than caller 2's (`lock2`) — producing exactly the negative-value signature
observed both times, not a smaller-than-expected positive one. This is
consistent with, but not proven by, the two recorded failures; nothing here
has been instrumented to confirm it directly (e.g. no server-side request
timestamp was captured to compare against `clock_timestamp()` ordering).

**The consequence, stated as directly as the instruction asked:** this test
is the DB-side proof that the row lock genuinely serializes two concurrent
callers on the same phone number — the exact invariant BOT-21's queueing
behavior and the whole session-transition design depend on. As long as this
flake is unexplained, a THIRD failure cannot be told apart from a real
regression in that locking behavior by looking at the assertion alone — both
would produce the identical "expected N to be >= 750" failure shape. Only a
negative value is currently known to correlate with the flake; a real
regression could plausibly also show up as a small positive miss (e.g. lock2
- lock1 = 400), which this record cannot yet distinguish from ordinary CI
slack. That gap is real and unresolved.

## Test source — `test/session-transition.test.ts:58-109`

```ts
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
```

**Note: the test's own comment claims this is "immune to JS/network timing
noise."** That claim is true for the *magnitude* of the measured gap (both
`clock_timestamp()` reads happen server-side, so client/network latency can't
compress or stretch the 750ms margin once both timestamps are captured) — but
it is NOT true for *which caller acquires the lock first*, which still
depends on when each HTTP/PostgREST request actually reaches Postgres, a
client/network-timing-sensitive property the 100ms `sleep(100)` head start
only makes *likely*, not guaranteed. This is the gap the hypothesis above
lives in.

## `lockAcquiredAt` — `test/helpers/db.ts:537-543`

```ts
// Read the test-only diagnostic timestamp the session function merges into
// context when p_test_sleep_ms is supplied (migration 013). Present only in the
// session-transition suite's Test B rows.
export function lockAcquiredAt(session: WhatsAppSession): number {
  const raw = (session.context as Record<string, unknown>)['_test_lock_acquired_at']
  if (typeof raw !== 'string') {
    throw new Error('_test_lock_acquired_at missing from context — did 013 apply to the branch?')
  }
  return new Date(raw).getTime()
}
```

## The code computing the elapsed value — `supabase/migrations/013_session_transition_test_lock_probe.sql:56-76, 145-160`

The actual `clock_timestamp()` capture, inside `acquire_and_transition_session`:

```sql
  -- (1) ATOMIC ACQUIRE. Insert-or-lock the row for this phone in one step.
  -- The DO UPDATE is a deliberate no-op whose only purpose is to lock the
  -- existing row and let us RETURN its current values. This closes the race
  -- where two "no session exists, create one" paths both INSERT and one
  -- crashes on the UNIQUE constraint.
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number   -- no-op: lock + return existing row
  RETURNING * INTO v_session;

  -- (Test B only) The lock is now held. Capture the DB-side wall clock at this
  -- exact point, then hold the lock across an injected pause so a second
  -- concurrent caller is forced to block on the acquire until we commit. This
  -- proves the lock genuinely spans acquire -> decide -> save.
  IF p_test_sleep_ms IS NOT NULL THEN
    v_lock_at := clock_timestamp();
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;
```

...and where it's written into the returned row (the single UPDATE the
function always performs, further down in the same function body):

```sql
  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = CASE
                           WHEN p_test_sleep_ms IS NOT NULL
                             THEN v_session.context
                                  || jsonb_build_object('_test_lock_acquired_at', v_lock_at)
                           ELSE v_session.context
                         END,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;
```

Both callers run this SAME function (`acquire_and_transition_session`,
`CREATE OR REPLACE`d by this migration over 012's original), on the same
Postgres primary — there is no read-replica or cross-node clock involved,
since this is a write RPC and both calls must hit the primary. Whatever is
producing the inversion, it is not clock skew between two different
database servers.

## What's needed for a real fix (not attempted here)

1. Confirm or refute the lock-order-inversion hypothesis directly — e.g. by
   having the test also capture a client-side "request sent at" timestamp per
   caller and compare it against which `_test_lock_acquired_at` came back
   first, across enough repeated runs to catch the inversion in the act.
2. If confirmed, the fix is almost certainly changing how caller-1-goes-first
   is guaranteed — e.g. having caller 1 acquire its lock and confirm
   (round-trip) before caller 2 is even dispatched, rather than a bare
   client-side `sleep(100)` — not touching the SQL/locking logic itself,
   which this hypothesis does not implicate.
3. Whatever the fix, it should preserve the DB-side, network-noise-immune
   character of the magnitude proof (`lock2 - lock1 >= 750`) — only the
   ordering guarantee is suspect, not the measurement.

Not fixed here, per instruction — this document exists so the fix starts
from this analysis, not a re-investigation.
