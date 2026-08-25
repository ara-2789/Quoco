# This sandbox cannot test concurrency against test-db — CI is the only environment that has

**Status: FINDING, recorded 2026-08-24, while building the real ordering
guarantee for `test/session-transition.test.ts` Test B
(`docs/reviews/session-transition-lock-wait-flake.md`).** Bigger than that
one test — this affects any future test that needs two genuinely concurrent
RPC calls against test-db, run from this Claude Code sandbox.

## The evidence, verbatim

While diagnosing why `quoco_test_row_is_locked` (a `SELECT ... FOR UPDATE
NOWAIT` probe, `032_session_transition_lock_probe_nowait.sql`) never
observed caller 1's row lock during Test B's own poll loop, three
experiments were run, each isolating one variable:

1. **The probe function itself, tested via raw dual-session SQL** (two
   independent `supabase db query --linked -f` invocations, one backgrounded
   holding a row lock across `pg_sleep(10)`, the other probing while it
   ran): **correctly detected the held lock** (`{"locked": true}`), and
   correctly reported unlocked before/after the hold. This is direct,
   unambiguous evidence the SQL mechanism itself is correct.

2. **The identical probe, called via the JS Supabase client
   (`db.rpc('quoco_test_row_is_locked', ...)`) while a real `caller 1`
   (`acquire_and_transition_session`, holding the row lock across an
   injected 800ms sleep) was in flight**: the probe call did not resolve
   until caller 1's ENTIRE round-trip — including the 800ms server-side
   hold — had already completed. Every single poll attempt, across 15
   attempts spanning the whole window, reported `false` (not locked) —
   because by the time each probe's own request actually reached Postgres,
   caller 1 had already committed and released. A separate, independent
   Supabase client instance for the probe (ruling out a shared-connection-
   pool-object explanation) made no difference.

3. **The decisive test — a THIRD call to the already-proven-working
   `acquire_and_transition_session` RPC, targeting a COMPLETELY DIFFERENT,
   non-contended phone number** (zero possible data-level lock conflict —
   two entirely separate rows, no shared state): this third call ALSO did
   not resolve until caller 1's own round-trip finished, despite having
   nothing to contend for. This rules out row-level locking, this project's
   own SQL, and the new probe function specifically as the cause — the
   serialization is unconditional, independent of what the second call
   actually does.

Raw timings from experiment 3 (phone1 = caller 1, 800ms hold; phone2 =
caller 3, 0ms hold, dispatched essentially simultaneously with caller 1,
different row, different client instance):
```
[705.5ms] firing caller 1 (phone1, 800ms hold)...
[706.5ms] firing caller 3 (DIFFERENT phone, 0ms, same RPC, separate client)...
[1755.0ms] caller 1 RESOLVED, error=none
[1924.3ms] caller 3 RESOLVED, error=none
```
Caller 3 was dispatched 1ms after caller 1, had zero work to contend for,
and still didn't resolve until AFTER caller 1 fully finished.

**Control, ruling out "this sandbox can't do concurrency at all":** two
TRIVIAL, unrelated REST table reads (`select('id', {head:true})` on
`tenants`, no RPC involved), fired simultaneously with separate client
instances, DID run genuinely concurrently — both resolved within ~230ms of
each other, not serialized. So this sandbox's network path can sustain
real concurrent HTTP requests to Supabase in general. The serialization is
specific to concurrent RPC (`/rpc/<fn>`, POST) calls against test-db —
plain REST table reads are unaffected. Not confirmed further (see
"What this does NOT establish" below), but consistent with a small
connection-pool specifically constrained for function-call/session-mode
traffic on this particular (low-tier, test) project, distinct from the
pool serving ordinary REST reads.

## The consequence, stated plainly

**No concurrency behaviour can be verified from this sandbox, against
test-db, via the JS/RPC path.** Any local test where caller 2 must run
WHILE caller 1 holds a lock passes trivially here — not because the lock
mechanism works, but because caller 2 physically cannot be dispatched
until caller 1's own RPC call has already fully returned. The result looks
identical either way: `lock2` always ends up later than `lock1`.

**This retracts a specific piece of prior evidence in this same session's
own record:** the "30/30 clean runs, zero negative values, zero
inversions" capture used to verify `test/session-transition.test.ts` Test
B's FIRST fix (the retry-based one, `docs/reviews/session-transition-lock-
wait-flake.md`) is **not evidence the ordering guarantee worked** — under
this same serialization, that 30-run capture could not have produced a
negative value even if the row lock did nothing at all. The retraction
does not change what actually happened in CI (three real, independent
failures, the basis for treating this as a genuine bug rather than
flakiness) — only what the LOCAL 30-run capture proved, which is: nothing,
about ordering specifically.

## Why this is bigger than one test

`acquire_and_transition_session` (migrations 012/013) exists specifically
to serialize concurrent callers on the SAME phone number — BOT-21's
queueing behavior (a second flow request while one is active gets queued,
never clobbers the active one) depends on this row lock working correctly
under real concurrent access. Once Pass 1's cron ships (the #69/031
outbound-send primitive, CLAUDE.md §3), this exact code path will be
exercised for real, twice daily, at scale, across every active engineer.
**CI is the only environment that has ever genuinely tested this
mechanism under real concurrency** — not by design, but because this
sandbox structurally cannot produce the condition being tested.

## What this does NOT establish

- **The specific cause is not confirmed** — "a small connection pool for
  RPC/session-mode traffic on this particular project" is the most
  consistent explanation of the three experiments above, not a proven root
  cause. Not pursued further here, matching this session's own standing
  practice (docs/reviews/session-transition-lock-wait-flake.md's own
  "proving it costs more than working around it" call on a related
  question) — the CONSEQUENCE (verify concurrency in CI only) holds
  regardless of the exact mechanism.
- **This is not necessarily a Claude Code sandbox property in general** —
  it may be specific to test-db's own tier/configuration, to this
  particular network path, or to something else entirely. Scoped here to
  "this sandbox, this project's test-db" — not generalized to "sandboxes
  can never test concurrency," which has not been checked.
- **REST-only concurrency (no RPC) appears unaffected** (see the control
  above) — this finding is specific to concurrent RPC calls, not a
  blanket claim about all concurrent database access from this sandbox.

## Standing rule this finding produced (CLAUDE.md §0)

See CLAUDE.md's own entry, same date — concurrency/lock/race verification
for this project is CI-only; a local pass on that class of test is not
evidence and must be reported as untested-locally, not verified.
