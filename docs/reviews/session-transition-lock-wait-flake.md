# `test/session-transition.test.ts` Test B — ordering-precondition bug, RESOLVED (PROVISIONAL), 2026-08-24

**SCOPE GAP, added 2026-08-26 — the fix below is RESOLVED for THIS FILE
ONLY.** The identical client-side-sleep ordering pattern this document
fixed here still exists, unfixed, at `test/morning-flow.test.ts:439`, and
produced a real CI failure on 2026-08-26 on an unrelated, docs-only PR.
Full record, timeline, and what it means: see "SCOPE GAP — the fix did
not generalise" at the end of this document. Not fixed tonight, per
instruction — recorded so the fix (already scoped: adapt
`test/session-transition.test.ts:140-174`'s own poll-then-dispatch block,
`quoco_test_row_is_locked` already exists in production) doesn't get
lost or rediscovered from scratch.

**Status: RESOLVED (PROVISIONAL) — for `session-transition.test.ts`'s own
Test B.** Not upgraded to a plain RESOLVED yet
— see "Why provisional, and what closes it" below before treating this
as fully closed. PR #104, run `32753275279`, headSha
`ba51f172affa82c4f834883f05c3a6ef596dee8f` — confirmed matching PR #104's
actual HEAD at read time, not just the run's own self-reported branch —
`Test (real test-db)` **passed in 6m33s**, all other checks green too
(Typecheck, Lint, Migration Lint, File Size Lint, Vercel). This is the
first CI run that ever actually exercised Fix 2's real mechanism
(poll-then-dispatch via `quoco_test_row_is_locked`, migration 032, now
permanently applied to test-db) under genuine concurrency. A second run,
`32754398812` (headSha `00270cd`, the commit that updated this document's
own status to RESOLVED before this provisional softening), also passed
`Test (real test-db)` — **10m3s** — and that is the commit PR #104
actually merged to `main` as `a6b79b1`. Five CI runs total across this
incident, four different outcomes — the first three below never reached
the mechanism at all; the last two both did, and both passed:

1. **PR #102, original CI (Failure 3, 2026-08-24T14:31:13Z).** The real
   bug: the ordering precondition wasn't guaranteed, `lock2 < lock1`. Not
   Fix 1, not Fix 2 — the thing both fixes exist to address.
2. **PR #102, post-Fix-1 CI (run `32743668591`).** Fix 1's retry loop hit
   the ordering precondition 3/3 times in the same run — a process-level
   bias, never once reaching the real assertion. See "FIX 1 FAILS FOR
   REAL" below.
3. **PR #104, post-Fix-2 CI, first attempt (run `32750655063`).** Failed
   for a THIRD, unrelated reason: `Could not find the function
   public.quoco_test_row_is_locked(p_phone_number) in the schema cache`.
   Migration 032 (which creates that function) had been applied to
   test-db for my own manual verification, then deliberately **rolled
   back** afterward, per this project's "leave test-db clean" discipline
   for every prior migration rehearsal in this session. CI's `Test (real
   test-db)` job runs `npm test` directly against the persistent shared
   test-db — it does not apply pending migration files from a PR. So the
   function genuinely did not exist when CI's test run executed. This run
   proved nothing about the ordering mechanism either way — it never got
   the chance to run.
4. **PR #104, post-Fix-2 CI, second attempt (run `32753275279`, commit
   `ba51f17`).** Migration 032 applied to test-db and left there
   (rationale: `docs/build-status.md`'s 2026-08-24 entry; client-side
   alternatives assessed and ruled out below). `Test (real test-db)`
   PASSED in 6m33s — the first genuine confirmation that Fix 2's
   poll-then-dispatch mechanism holds under real CI concurrency, the
   thing local runs in this sandbox can never prove
   (`docs/reviews/sandbox-cannot-test-concurrency.md`).
5. **PR #104, post-Fix-2 CI, third attempt (run `32754398812`, commit
   `00270cd`).** The doc commit that first marked this RESOLVED
   (non-provisional). `Test (real test-db)` PASSED again, 10m3s. This is
   the exact commit merged to `main` as `a6b79b1`.

**Runs 1–3 never actually exercised Fix 2's real mechanism under genuine
CI concurrency.** Run 1 predates it. Run 2 tested Fix 1, a different
mechanism. Run 3 couldn't reach it at all. Runs 4 and 5 both did, and
both passed — but both are on the SAME PR (#104), two commits apart, not
independent evidence from separate PRs. See below for why that
distinction matters to this document's status.

## Why provisional, and what closes it

Two consecutive passes (runs 4 and 5) is real evidence, and the nature of
the evidence matters: this isn't "re-ran the same thing and got lucky
twice" — run 5 is a structurally different commit (the SHA moved between
runs), and the fix itself is a deterministic guarantee, not a
probabilistic one, once the mechanism is confirmed to work at all — a
directly-observed lock is not a timing bet that could pass most of the
time and fail occasionally. That is meaningfully stronger evidence than
an equivalent pair of green re-runs would be for a timing-sensitive fix.

But two runs, both on one PR's branch, is still a sample of one
*context* — one Actions runner pool, one narrow time window, one set of
whatever CI-runner conditions (network path, connection-pool state after
~50 preceding files, per the "what remains genuinely open" note below)
happened to hold both times. The three prior failures on this exact test
each had a different, unrelated cause — that history is a specific
reason not to over-read a short streak here, even a streak that passed
for the reasons just given.

**This closes to a plain RESOLVED when:** two to three more independent
CI runs pass `Test (real test-db)` with this mechanism live, on
genuinely separate PRs (not just separate commits on the same branch) —
ordinary future PRs that happen to touch `test/session-transition.test.ts`
or run the full suite qualify; no special test is needed to accumulate
this. Record each run's ID and headSha here as they land:
- *(none yet — runs 4 and 5 above are both PR #104; the first
  separate-PR confirmation goes here)*

**Client-side alternatives to the function were assessed and ruled out
(2026-08-24) before deciding to keep it.** A marker write inside caller
1's own lock-holding transaction is invisible to a polling `SELECT` until
commit — by which point the lock is already released, proving "finished,"
not "holds." A marker write as a separate autocommit step immediately
before opening the lock transaction closes that gap only partially — a
poller can see the marker before the lock is actually acquired, proving
"about to," not "holds." `pg_notify`/`LISTEN` has the identical
same-transaction-visibility problem (notifications queue and only deliver
on commit). The only live-state signals that would actually work —
`pg_locks`, `pg_try_advisory_lock` — are catalog/builtin objects
PostgREST doesn't expose outside a wrapper function, so reaching either
one requires a new function regardless. **No no-migration alternative can
prove "currently holds the lock"; the function is unavoidable.**

**Decision: migration 032 applied to test-db and LEFT applied
permanently**, rather than the apply-verify-rollback cycle used for every
prior rehearsal in this session. Rationale and full record: this file's
own numbering-note header in `032_session_transition_lock_probe_nowait.sql`
plus `docs/build-status.md`'s 2026-08-24 entry. Confirmed locally
(585/587 tests green) that leaving it applied breaks nothing else; the
one local failure is the ALREADY-DOCUMENTED sandbox RPC-serialization
timeout (`docs/reviews/sandbox-cannot-test-concurrency.md`), not a new
problem — see "Verification" under "THE REAL FIX (Fix 2)" below, which
predicted exactly this local outcome before it happened.

Re-pushed for a fourth CI run — the first one that could actually
exercise the mechanism, and it passed (run `32753275279`, headSha
`ba51f17`, `Test (real test-db)` green in 6m33s — see the status line at
the top of this document). Per standing instruction, this was not called
RESOLVED until CI itself confirmed it.

---

**Fix 1's own history, corrected in place, not deleted.** Fix 1 (asserted
on ordering, retried the setup on inversion) was believed RESOLVED on the
strength of a forced-inversion proof (the retry/failure code paths do
fire) plus "30 clean runs against real test-db, zero inversions, zero
negatives." **That 30-run local capture is RETRACTED as evidence — see
`docs/reviews/sandbox-cannot-test-concurrency.md` for the full finding.**
This sandbox cannot sustain two genuinely concurrent RPC calls against
test-db: caller 2 cannot be dispatched until caller 1's own RPC call has
already fully returned, so a local run of Test B can never produce a
negative value regardless of whether the row lock does anything at all —
the 30/30 result proved the sandbox's own serialization, not the fix.
**Fix 1 was then pushed, merged (PR #103), and subsequently failed for
real** — PR #102's own CI hit Fix 1's retry loop 3 times in the SAME run,
all 3 hitting the ordering precondition, never once reaching the real
assertion (see "Fix 1 fails for real" below). That 3/3 pattern is what
first suggested a PROCESS-LEVEL bias rather than per-attempt jitter — now
understood precisely: not a bias in the row-lock mechanism, but this
sandbox-vs-CI difference in whether concurrent RPC calls can even occur —
except this 3/3 failure happened in CI itself, meaning CI's own
environment, on this occasion, also failed to achieve the ordering
Fix 1's retry loop was trying to construct. Fix 2 (the real ordering
guarantee, no longer dependent on client-side timing at all) is the
response to that.

**Fix 1's own history, corrected in place, not deleted.** Fix 1 (asserted
on ordering, retried the setup on inversion) was believed RESOLVED on the
strength of a forced-inversion proof (the retry/failure code paths do
fire) plus "30 clean runs against real test-db, zero inversions, zero
negatives." **That 30-run local capture is RETRACTED as evidence — see
`docs/reviews/sandbox-cannot-test-concurrency.md` for the full finding.**
This sandbox cannot sustain two genuinely concurrent RPC calls against
test-db: caller 2 cannot be dispatched until caller 1's own RPC call has
already fully returned, so a local run of Test B can never produce a
negative value regardless of whether the row lock does anything at all —
the 30/30 result proved the sandbox's own serialization, not the fix.
**Fix 1 was then pushed, merged (PR #103), and subsequently failed for
real** — PR #102's own CI hit Fix 1's retry loop 3 times in the SAME run,
all 3 hitting the ordering precondition, never once reaching the real
assertion (see "Fix 1 fails for real" below). That 3/3 pattern is what
first suggested a PROCESS-LEVEL bias rather than per-attempt jitter — now
understood precisely: not a bias in the row-lock mechanism, but this
sandbox-vs-CI difference in whether concurrent RPC calls can even occur —
except this 3/3 failure happened in CI itself, meaning CI's own
environment, on this occasion, also failed to achieve the ordering
Fix 1's retry loop was trying to construct. Fix 2 (the real ordering
guarantee, no longer dependent on client-side timing at all) is the
response to that.

**CORRECTION to this document's own prior reasoning, recorded rather than
silently dropped.** The "flake" LABEL was still wrong — the assertion was
correct, the setup's precondition was not guaranteed, and that is a real
bug regardless of what caused any individual failure's timing. But the
specific READING that followed from it — "two of three failures landed on
a BYTE-IDENTICAL `-317`, therefore something deterministic is producing
that exact number" — was overweighted, for a reason this document didn't
originally have the evidence to check: **if the mechanism IS lock-order
inversion under latency skew, a negative value measures the same
quantity every time it occurs** (how far caller 2's actual arrival at
Postgres preceded caller 1's, given broadly similar CI-runner network/
connection-pool conditions run to run) — so negative values should cluster
just as narrowly as this document's own POSITIVE-case evidence already
shows the equivalent positive quantity does: the 2026-08-24 investigation's
30-run capture landed entirely within **960–1108ms**, a ~150ms band, under
normal conditions. A quantity that naturally clusters that tightly landing
on the same ROUNDED figure twice, out of three total samples (`-33`,
`-317`, `-317`), is unremarkable under that clustering — not the
low-probability coincidence it was originally treated as. (This is a
different comparison than the FORCED-inversion values captured while
verifying the fix below, `-160`/`-181`/`-155` — those came from a
deliberately reversed dispatch order, a large, artificial skew, not a
genuine near-miss race, so they characterise a different scenario and are
not used as the reference band here.) Recorded so the next reader does not
re-derive the same overweighted reading from the same two numbers.

## The three recorded failures

All three are the SAME assertion, in the SAME test, with a NEGATIVE elapsed
value every time — not a marginal near-750 miss, which is what ordinary CI
slowness or scheduling noise would produce.

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

### Failure 3 — 2026-08-24T14:31:13Z

- Run: [32738215162](https://github.com/ara-2789/Quoco/actions/runs/32738215162), job `97466105058` (attempt 1, failed)
- Trigger: `pull_request` — PR #102 (`docs/credential-rule-procedural-2026-08-24`,
  **docs-only** — CLAUDE.md's §0 credential rule + a `docs/build-status.md`
  incident record, zero application code touched), SHA
  `032c975d28418b33bc5afe2750eef98a0a680d22`
- **NOT re-run, per this document's own standing instruction** ("a third
  occurrence stops the merge instead"). PR #102 left open, unmerged, held
  for Aravind rather than resolved unilaterally.
- Literal output:
  ```
  FAIL  test/session-transition.test.ts > acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits
  AssertionError: expected -317 to be greater than or equal to 750
   ❯ test/session-transition.test.ts:97:27
     97|     expect(lock2 - lock1).toBeGreaterThanOrEqual(750)
  ```
- **NEW OBSERVATION, not present in Failures 1/2's own write-up: the
  elapsed value is `-317`, BYTE-IDENTICAL to Failure 2's `-317`.** Two
  independent CI runs, two days apart, on two unrelated PRs, producing the
  EXACT SAME negative number is a much stronger signal than "two negative
  values" was on its own — genuinely random scheduling jitter across two
  separate runs landing on the identical millisecond figure is a low-
  probability coincidence. This is offered as a lead for whoever picks up
  the real fix (see "What's needed for a real fix" below), not chased down
  here: candidates worth checking include a fixed, non-random overhead in
  the CI runner's own request-dispatch path (e.g. a consistent connection-
  reuse or DNS-cache timing rather than true jitter), or GitHub Actions
  runners drawing from a smaller, more homogeneous machine pool than
  presumed — either of which would make "random" scheduling noise land on
  the same figure more often than pure randomness would predict. Not
  confirmed; flagged so the next investigation checks it rather than
  assuming pure randomness the way Failures 1/2 did.

## 2026-08-24 investigation — findings reported, nothing fixed, nothing re-run

Per direct instruction: capture raw inputs (not the difference), test the
lock-order-inversion hypothesis directly against three specific leads, report
before changing anything. Done in that order; nothing in this section altered
the test, the migration, or any committed code.

### Method

A standalone script (`lock-flake-probe.ts`, not committed — disposable,
deleted after use) replicated Test B's exact RPC call shape
(`acquire_and_transition_session`, same params, same `testPhone('102')`
slot) against real test-db, printing RAW values instead of the subtraction:
both `_test_lock_acquired_at` timestamps verbatim, a client-side "dispatched
at" timestamp per caller (`Date.now()` immediately before each RPC call),
and the wall-clock bracket — for every iteration, pass or fail. Row deleted
before each iteration (mirroring the suite's own `afterEach`).

**30 iterations, run from this session's sandbox against test-db:**
**30/30 passed. Zero negative values.** Every `lock2 - lock1` was positive
and tightly clustered: **960ms–1108ms**, a ~150ms spread consistent with
ordinary scheduling variance around the 800ms hold + ~100–200ms round-trip
overhead. The negative value was NOT reproduced locally, in this
environment, across 30 attempts.

### The three specific leads, tested directly — all three ruled out

1. **Does context merge (`||`) let a PRIOR run's `_test_lock_acquired_at`
   survive into a later read?** Tested directly: primed a row with a real
   `_test_lock_acquired_at` (first cycle), then ran a SECOND cycle on the
   SAME row WITHOUT deleting it first — the exact "stale row" condition this
   lead asks about. Result: **both callers' `_test_lock_acquired_at` still
   reflected their OWN fresh `clock_timestamp()` read, not the prior run's
   value** (`diff: 965`, a normal positive result). Ruled out. Reading the
   SQL confirms why: each caller's `v_session` is a LOCAL variable inside
   its OWN function invocation — the `||` merge always writes that CALLER's
   own `v_lock_at` as the right-hand (winning) operand, so a stale key can
   only ever be overwritten, never survive, regardless of what the row
   looked like beforehand.
   **Side finding, not the cause but worth recording:** a non-deleted row
   DOES change the DECISION branch taken (`pending_flows` accumulates
   across cycles, `current_flow`'s "already active, same flow" no-op path
   fires) — this is the function's own documented, correct behaviour for a
   same-day resume, not a bug, and it does not touch
   `_test_lock_acquired_at`.
2. **Is either timestamp ever sourced from `p_now` (client-supplied) rather
   than `clock_timestamp()`?** Checked directly against the full function
   body (`013_session_transition_test_lock_probe.sql`) — there is exactly
   ONE assignment to `v_lock_at` in the entire function
   (`v_lock_at := clock_timestamp();`), no other code path touches it.
   Test B's own two calls never pass a `now` option either
   (`test/helpers/db.ts`'s `acquireAndTransition` only includes `p_now` in
   the RPC payload `if (params.now !== undefined)` — Test B supplies
   neither call with `now`), so `p_now` falls back to Postgres's own
   `now()` default regardless — and `now()`/`transaction_timestamp()` is
   never assigned to `v_lock_at` anywhere. Ruled out by code inspection,
   corroborated empirically: across all 32 sampled calls (30 clean + 2
   stale-row), both callers' timestamps were always distinct and consistent
   with real elapsed time, never frozen or shared.
3. **Is the row from a previous test left behind, so one caller reads a
   stale row?** Tested directly (same experiment as lead 1). A pre-existing
   row changes flow-decision branching (see above) but does NOT corrupt
   `_test_lock_acquired_at` for either caller. Ruled out as the source of
   the negative-value symptom specifically, though confirmed real as a
   (harmless, by-design) side effect of skipping cleanup.

### What this does NOT rule out, and the honest gap in this reproduction

- **`vitest.config.ts` sets `fileParallelism: false`** — confirmed CI runs
  test files strictly sequentially (`npm test` = plain `vitest run`, no
  override in `.github/workflows/ci.yml`). This rules out a DIFFERENT test
  file's own `cleanupTestSessions()` racing Test B's in-flight calls — that
  is structurally impossible under this config, not merely unobserved.
- **Both the SQL migration and the test file have exactly ONE commit each,
  from 2026-07-07** (`git log`) — unchanged since long before any of the
  three failures. Rules out "something changed between occurrences."
- **The gap this investigation did NOT close:** the local reproduction was
  ISOLATED — this one RPC pair, one Node process, no other database traffic
  competing for the connection pool. CI's three failures all occurred
  during a ~50-file suite run; even with file-level parallelism off, the
  Postgres connection pooler (Supavisor) is shared and stateful across the
  WHOLE run, and dozens of short-lived connections opening/closing in the
  files that ran before this one were never replicated here. This
  reproduction cannot rule out a pooler-level effect (connection reuse,
  a lingering prepared-statement plan, TCP-level state) specific to running
  under that load — only that the mechanism, IN ISOLATION, behaves
  correctly.
- **The identical-value observation itself remains unexplained.** Genuine
  network/scheduling jitter, even under a plausible "fixed CI-runner
  connection-setup overhead" story, should still show millisecond-level
  variance run to run — two SEPARATE, ephemeral GitHub Actions runner VMs,
  two days apart, landing on the exact same `-317` is difficult to square
  with any of the timing-noise explanations this document has offered so
  far (including its own prior "lock-order inversion under jitter"
  hypothesis, tested above only for whether it's STRUCTURALLY possible, not
  for why it would repeat exactly). No code-level mechanism found in this
  pass explains a deterministic, repeatable value. **The most useful next
  step is not further local reproduction — it is instrumenting a REAL CI
  run** (the same raw-value capture used here, added temporarily to a CI
  job, or the diagnostic script run directly inside a GitHub Actions
  runner) so the actual environment that produces `-317` can be observed
  directly, rather than guessed at from a differently-networked sandbox.

## FIX 1, 2026-08-24 — asserted on ordering, retried the setup — INSUFFICIENT, see below

**Diagnosis, restated precisely.** The assertion (`lock2 - lock1 >= 750`)
was always correct — it is genuinely what needs to be true for the row
lock to have serialized the two callers as designed. The bug was in the
SETUP: firing caller 1, sleeping 100ms client-side, then firing caller 2
RELIES on that gap to guarantee caller 1 reaches Postgres first. Nothing
enforces it. Under latency skew (a cold connection, connection-pool state
after dozens of preceding CI test files, or simple network jitter), caller
2 can reach Postgres first, acquire the lock, and — since it holds it for
0ms — commit almost instantly, before caller 1 has even arrived. That
produces a genuinely negative `lock2 - lock1`, and it is a defect in the
test's setup regardless of what specifically causes the skew.

**Why this fix, not a-priori prevention.** A true, unconditional guarantee
that caller 1 always acquires first — e.g. an advisory lock caller 2's
dispatcher polls before firing, or splitting caller 1 into an
acquire-then-hold step the test can observe directly — would require NEW
database surface: a row lock held inside an uncommitted transaction is
invisible to any other connection by ordinary MVCC visibility rules, so
signaling "I hold it" across connections needs something like a
`pg_advisory_lock` (visible cross-session without a commit) or an
NOWAIT probe function, either of which is a new migration exposing new
lock-state surface. That trips this project's own external-review gate
(CLAUDE.md §0, condition (a) — creates a live function's logic) for what
is fundamentally a test-only concern, and PostgREST's one-call-per-
transaction model makes "acquire, then separately signal, then release"
a multi-round-trip protocol this architecture doesn't support without a
raw kept-alive connection bypassing PostgREST entirely — a real
architecture change, not a test fix. Detecting the ACTUAL acquisition
order from the two DB-side timestamps the test already captures costs
nothing new, needs no new database surface, and keeps the magnitude proof
exactly as it was.

**The fix itself — `test/session-transition.test.ts`'s Test B:**
1. Compare `lock1`/`lock2` directly. If `lock2 < lock1`, the ordering
   precondition was violated this attempt — caller 2 won the race, so no
   genuine 800ms-hold interleave was exercised. Log it and retry with a
   FRESH row (`cleanupTestSessions()` between attempts — the shared
   `whatsapp_sessions` cleanup helper this suite already uses everywhere
   else), rather than silently reinterpreting `min`/`max` as if the
   intended scenario had occurred (a naive swap would let a run that never
   exercised real blocking pass anyway, for the wrong reason).
2. Bounded at 3 attempts. If ordering is achieved, the ORIGINAL assertions
   run completely unchanged — `lock2 - lock1 >= 750`, the `wallElapsed`
   sanity check, and the final `current_flow`/`pending_flows` state checks.
   No retry masks a real magnitude failure: retries only ever re-run the
   SETUP, never re-attempt a failed assertion.
3. If all 3 attempts hit the ordering precondition and never reach the real
   assertion, the test fails LOUD and DISTINCT — a message naming exactly
   what happened (`"ordering precondition never satisfied after 3
   attempts... NOT evidence the row lock itself is broken"`), not the
   generic `"-N to be >= 750"` this document's own three failures show. A
   future occurrence of this specific message is now immediately
   recognizable as a setup-precondition miss, never mistaken for a locking
   regression again.

**Verification, two pieces, both required — neither substitutes for the
other:**

1. **The retry/loud-failure path genuinely fires — proven, not assumed.**
   Dispatch order was temporarily, deliberately reversed (caller 2 fired
   FIRST, caller 1 100ms later) to force a deterministic inversion on every
   attempt, then reverted immediately after capture:
   ```
   [session-transition Test B] ordering precondition missed on attempt 1/3 (lock1=1787583221803, lock2=1787583221643, diff=-160) -- retrying with a fresh row
   [session-transition Test B] ordering precondition missed on attempt 2/3 (lock1=1787583223113, lock2=1787583222932, diff=-181) -- retrying with a fresh row
   [session-transition Test B] ordering precondition missed on attempt 3/3 (lock1=1787583224424, lock2=1787583224269, diff=-155) -- retrying with a fresh row

    × acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits
      → Test B: ordering precondition never satisfied after 3 attempts -- caller 2 kept acquiring the row lock before caller 1 despite the 100ms head start every time (last attempt: lock1=1787583224424, lock2=1787583224269, diff=-155). This means the test setup could not construct the intended interleave in 3 tries -- it is NOT evidence the row lock itself is broken (the magnitude assertion, which IS that evidence, never ran). See docs/reviews/session-transition-lock-wait-flake.md.
   ```
   All three retry attempts logged correctly, and the final error is the
   distinct, self-diagnosing message, not the old generic assertion —
   confirmed byte-for-byte against what the code actually produces, not
   read from the source.

2. **30 runs against real test-db, normal (unforced) conditions — zero
   negatives, zero inversions, every result printed:** 30/30 passed on the
   FIRST attempt each time (no retry ever fired — the log line above never
   appeared once across all 30 runs), test duration ~1.3–1.6s per run,
   consistent with the timing this document's own earlier captures show.
   Confirms the fix does not change behaviour under normal conditions — it
   only activates the (now-proven-working) retry path when the precondition
   is actually violated, which normal conditions never trigger locally.

**What remains genuinely open, stated plainly rather than left implicit:**
the underlying environmental trigger for WHY caller 2 occasionally wins the
race specifically in CI (network path, connection-pool state after ~50
preceding files, or something else) was never confirmed — the 2026-08-24
investigation ruled out three specific code-level causes but could not
reproduce the inversion locally to observe the real trigger directly. That
question is now MOOT for this test's own correctness (it self-corrects
either way), but is left here, not silently dropped, in case the same
class of skew ever matters to a different test in the future.

## FIX 1 FAILS FOR REAL, same day (2026-08-24) — the 30-run local capture retracted

PR #103 (Fix 1) merged. PR #102's own CI (docs-only, zero application
code — the credential-rule PR this whole investigation started from) then
hit Fix 1's retry loop directly:
```
[session-transition Test B] ordering precondition missed on attempt 1/3 (lock1=1787585242109, lock2=..., diff=...) -- retrying with a fresh row
[session-transition Test B] ordering precondition missed on attempt 2/3 (...) -- retrying with a fresh row
[session-transition Test B] ordering precondition missed on attempt 3/3 (lock1=1787585242416, lock2=1787585242109, diff=-307) -- retrying with a fresh row

FAIL test/session-transition.test.ts > ... > B: caller 2 blocks on the row lock until caller 1 commits
Error: Test B: ordering precondition never satisfied after 3 attempts -- caller 2 kept acquiring the row lock before caller 1 despite the 100ms head start every time (last attempt: lock1=1787585242416, lock2=1787585242109, diff=-307). ...
```
Run [32743668591](https://github.com/ara-2789/Quoco/actions/runs/32743668591) —
**3 out of 3 attempts, in the SAME run, all hit the ordering precondition.**
The loud, distinct failure message DID fire correctly (proving Fix 1's
diagnostic mechanism itself worked as designed) — but the retry never
found a correctly-ordered attempt, meaning the real magnitude assertion
never ran even once in that CI job.

**Root-causing this led directly to `docs/reviews/sandbox-cannot-test-
concurrency.md` (full record there).** While building a genuine ordering
guarantee (Fix 2, below) to replace the retry, three diagnostic
experiments established that THIS SANDBOX cannot sustain two genuinely
concurrent RPC calls against test-db at all — a second RPC call never
resolves until the first one's entire round-trip completes, PROVEN via a
third call to an already-working RPC against a completely different,
non-contended row (zero possible data conflict), which still waited for
caller 1 to finish. **This retracts Fix 1's own "30/30 clean, zero
negatives" local verification as evidence**: under this same
serialization, that 30-run capture could never have produced a negative
value regardless of whether the row lock does anything — it proved the
sandbox's own behavior, not the fix's. It does not retract the 3
independent REAL CI failures (Failures 1-3, above) — those happened in
CI, where genuine concurrency is possible, and remain the actual evidence
this incident is built on.

## THE REAL FIX (Fix 2), 2026-08-24 — a genuine ordering guarantee, no retry needed

**Mechanism: don't dispatch caller 2 until caller 1's row lock is directly
OBSERVED held, via a new database-side probe — not a sleep, not a
client-side retry.** `032_session_transition_lock_probe_nowait.sql` adds
`quoco_test_row_is_locked(p_phone_number TEXT) RETURNS BOOLEAN` —
`SELECT ... FOR UPDATE NOWAIT` on the target row from a SEPARATE
connection, catching `lock_not_available` (SQLSTATE `55P03`) to report
`true`. Postgres's lock manager surfaces this synchronously, independent
of MVCC snapshot visibility, so it detects an uncommitted transaction's
row lock correctly (proven directly — see below) even though the OTHER
transaction hasn't committed yet. Read-only, `service_role`-only (REVOKE
FROM PUBLIC/anon/authenticated, same discipline as every other function
in this project), no write path, no production call site — it exists only
for this test to call.

Test B's setup: (a) WARM the shared cached client with a throwaway
round-trip through the same RPC shape, before the timed section, so
connection-setup cost isn't measured as part of the operation; (b) SEED
the target row idle beforehand (required — a row lock inside an
uncommitted INSERT is invisible cross-connection until commit, so the
probe needs an already-existing, committed row to detect contention
against); (c) fire caller 1; (d) poll `quoco_test_row_is_locked` (bounded
at 3000ms, ~800ms of genuine slack) until it confirms caller 1 holds the
lock; (e) only then dispatch caller 2. Once ordering is directly observed
rather than assumed, `lock2 >= lock1` becomes a mathematical consequence
of Postgres's own lock semantics — caller 2 cannot acquire until caller 1
releases — not a timing bet. The retry loop from Fix 1 is kept as a LOUD
BACKSTOP only (an inversion at this point would mean a bug in the
guarantee mechanism itself, worth surfacing immediately, not retrying).

**Migration numbering:** takes 032, not 030 (already claimed by
`030_morning_flow_attendance.sql` on the unmerged `feat/morning-flow-
attendance-migration` branch) or 031 (already informally reserved by
CLAUDE.md §3's own text for the "#69/031 outbound-send primitive").

**Verification — stated precisely by WHICH mechanism was checked HOW,
per the new standing rule (`docs/reviews/sandbox-cannot-test-concurrency.md`,
CLAUDE.md §0) that this exact incident produced:**
- **The SQL mechanism itself: verified directly, not locally-inferred.**
  Two independent `supabase db query --linked -f` invocations — one
  backgrounded, holding a row lock across `pg_sleep(10)`, the other
  probing while it ran — showed `quoco_test_row_is_locked` correctly
  report `{"locked": true}` during the hold and `false` before/after.
  This IS solid evidence; it does not depend on the sandbox's RPC
  serialization at all (raw `supabase db query` sessions are genuinely
  concurrent, unlike JS-client RPC calls here).
- **The JS-level poll-then-dispatch mechanism (does Test B, as a whole,
  correctly wait for the observed lock before firing caller 2, under
  genuine concurrent execution): CONFIRMED by CI, not locally — could
  never be, per the standing rule above.** A local run of the actual test
  timed out (`caller 1's row lock was never observed within 3000ms`) —
  consistent with, not contradicting, the sandbox-serialization finding:
  the probe could never get a concurrent connection to observe the lock
  while caller 1 held it, in THIS environment. **CI was the only
  environment that could confirm this half of the fix, and it did** — PR
  #104, run `32753275279`, headSha `ba51f17`, `Test (real test-db)` green
  in 6m33s (2026-08-24). See the status line at the top of this document.

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

## What's needed for a real fix — SUPERSEDED, 2026-08-24, see "THE FIX" above

Kept below as the historical record of what this document asked for while
the bug was still open — not deleted, since the reasoning trail is part of
what makes this incident useful to a future reader. The actual fix landed
took a DIFFERENT shape than items 1/2 anticipated (assert-and-retry on the
TEST side, not a CI-side capture or a DB-side prevention mechanism) — see
"THE FIX, 2026-08-24" above for what was actually built and why.

1. ~~UPDATED, 2026-08-24 investigation. The client-side "request sent at"
   capture this item originally proposed WAS built and run (30 iterations,
   see above)... What's actually needed now: the same raw-value capture
   run FROM INSIDE a GitHub Actions runner...~~ Not pursued — the fix
   sidesteps needing to observe the CI-specific trigger at all, since it
   makes the test correct regardless of what causes the skew.
2. ~~If lock-order-inversion is confirmed as A cause..., the fix is almost
   certainly changing how caller-1-goes-first is guaranteed...~~ Considered
   and explicitly rejected in favor of detect-and-retry — see "Why this
   fix, not a-priori prevention" above (new production SQL surface would
   trip the external-review gate for a test-only concern).
3. Whatever the fix, it should preserve the DB-side, network-noise-immune
   character of the magnitude proof (`lock2 - lock1 >= 750`) — DONE: the
   magnitude assertion is byte-for-byte unchanged from before this fix.
4. ~~If the CI-runner-side capture ALSO fails to explain the exact-repeat,
   broaden the search beyond timing entirely...~~ Superseded by the
   CORRECTION above (the exact-repeat was overweighted evidence to begin
   with) — no further search needed on that specific question.

This document's own earlier line — "not fixed here, per instruction, this
document exists so the fix starts from this analysis, not a
re-investigation" — held: the fix above started from exactly the analysis
in this document, not a rediscovery.

## SCOPE GAP, 2026-08-26 — the fix did not generalise

**Record only. Not fixed tonight** — the fix itself is scoped and waiting:
adapt `test/session-transition.test.ts:140-174`'s own poll-then-dispatch
block into `test/morning-flow.test.ts`'s Test 18.
`quoco_test_row_is_locked` already exists in production (migration 032),
so this is copy-and-adapt, not new design.

**The failure.** 2026-08-26, PR #115 (`docs/service-role-table-grants-gap-
2026-08-26`, a docs-only PR touching only `CLAUDE.md` and one new markdown
file — no code, no migrations) had its `Test (real test-db)` CI job fail:
```
AssertionError: expected null to be 'Plan from caller 2'
 ❯ test/morning-flow.test.ts:447:31
```
Re-run of the same job, same commit, passed clean. That a green retry
does not answer the underlying question is the entire lesson of THIS
document's own history — Fix 1's retry-on-inversion hid a real defect for
one CI run's worth of "looks fine now," and the retry here was not
treated as closing the question either; the test was actually read.

**The test** (`test/morning-flow.test.ts:430-452`):
```ts
  // 18. concurrency — two near-simultaneous turns serialise on the row lock.
  it('concurrency: two simultaneous turns are serialised by the row lock', async () => {
    const phone = testPhone('312')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })

    // Caller 1 holds the lock across an 800ms sleep (answers Q1 attendance);
    // caller 2 fires a beat later and must block until caller 1 commits (then
    // answers Q2 plan).
    const c1 = applyMorningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW, testSleepMs: 800 })
    await sleep(100)
    const c2 = applyMorningFlowTurn({ phone, message: 'Plan from caller 2', startFlow: false, now: P_NOW, testSleepMs: 0 })
    await Promise.all([c1, c2])

    // Serialised: caller 1's Q1 answer landed as attendance=present, then
    // caller 2 saw step 2 and answered Q2 (plan). No lost update.
    const log = await getDailyLog(LOG_DATE)
    expect(log?.attendance).toBe('present')
    expect(log?.morning_plan).toBe('Plan from caller 2')

    const session = await readSession(phone)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(3)
  })
```
Line 439 (`await sleep(100)`) is exactly **Fix 1, "SUPERSEDED AS THE
MECHANISM"** above, verbatim: *"the original setup fired caller 1, slept
100ms client-side, then fired caller 2, relying on that gap to guarantee
caller 1 reached Postgres first — nothing enforced it."* This file never
received Fix 2.

**The failure signature matches inversion, mechanistically, not just by
resemblance.** `log?.attendance` passed (`'present'`); only
`log?.morning_plan` failed (`null`). Consistent with: caller 2 reached
Postgres and acquired the row lock before caller 1 (the 100ms gap wasn't
enough — plausibly under the same kind of CI-runner/shared-test-db load
this document's own investigation already named as a live variable).
Caller 2's message, "Plan from caller 2," would then be evaluated against
the still-idle session expecting an *attendance* answer — not a valid
one, so no `morning_plan` write. Caller 1's "yes" would land afterward,
once it got the lock, as the attendance answer against the still-current
step — explaining why `attendance` succeeded while `morning_plan` didn't.
Not proven beyond doubt (the CI run's own internal timestamps weren't
captured, the same class of gap this document's "honest gap" section
already named for the original incident), but the ONLY mechanism
consistent with both the pass and the fail in the same run.

**The timeline, because it is the finding:**
- **2026-07-07** (`61d8b39`) — `await sleep(100)` (the vulnerable line,
  `morning-flow.test.ts:439` today) written. Original commit for this
  file; never touched since.
- **2026-08-24 21:53:56 IST** (`14737cd`) — Fix 2, THE actual structural
  fix, lands in `session-transition.test.ts`. Solves the identical
  problem: don't dispatch caller 2 until caller 1's lock is directly
  observed, not guessed at via a client sleep.
- **2026-08-25 08:52:48 IST** (`d305e4c`, "morning flow migration —
  attendance-first," reviewer GO 2026-08-24, PR #107) — this exact test
  block's surrounding lines (435-438, 440, 443-444, 446-447 — the
  assertion that later failed is IN this edit) are rewritten. Line 439
  itself — the vulnerable sleep — is untouched, because nothing about
  this edit looked at it.

Eleven hours. The fix existed, complete, proven, in a sibling file, the
night before this file's own most recent touch to the exact same
pattern — and it was not carried across.

**What this means, named plainly:** this is not a missed test. A missed
test implies nobody thought to test the thing. This is a fix that did
not generalise — the defect class was found, understood, and solved once,
and the solution stayed local to the file it was solved in. Nothing in
this project's process would have caught that, because no rule says "when
you fix a pattern, grep the repository for the same pattern before
closing it." `d305e4c`'s own author had every reason to know the pattern
was dangerous (it had just cost real investigation time, twice, the day
before) and no prompt to check whether the file being edited that morning
carried the same shape.

**Grep for a third instance — none found.** Searched the entire `test/`
directory for every variant of the pattern (an unawaited promise, a fixed
sleep, a second concurrent call, joined via `Promise.all` or otherwise):
```
grep -rln "Promise.all" test/
  test/morning-flow.test.ts
  test/session-transition.test.ts

grep -rn "sleep(" test/
  test/session-transition.test.ts:160:      await sleep(5)      # inside the FIXED poll loop, not the pattern
  test/morning-flow.test.ts:439:    await sleep(100)             # the vulnerable line

grep -rn "setTimeout" test/
  test/session-transition.test.ts:21:const sleep = (ms) => new Promise((r) => setTimeout(r, ms))   # helper def
  test/morning-flow.test.ts:43:const sleep = (ms) => new Promise((r) => setTimeout(r, ms))         # helper def

grep -rn "testSleepMs" test/
  (every call site across the whole suite — only the two known pairs use it
   concurrently; every other call site is a single sequential await)

grep -rn "applyMorningFlowTurn|applyEveningFlowTurn|acquireAndTransition|drainNextPendingFlow" test/*.test.ts test/unit/*.test.ts
  (~150 call sites across migration-017/022/024, morning-flow.test.ts's own
   other 20 tests, session-transition.test.ts's own other 3 tests,
   morning-cutoff-sweep.test.ts, morning-flow-mirror.test.ts — every one of
   them a single `await`ed call in sequence; zero additional unawaited pairs)

grep -rn "^\s*const \w+ = .*\.rpc\(" test/*.test.ts test/unit/*.test.ts
  test/migration-020.test.ts:120,122 — both awaited, different auth roles,
  not a concurrency test
```
Exactly two files in the entire suite touch this pattern: the one that was
fixed, and the one that wasn't. Two occurrences of a copied pattern
usually means more were meant to exist and got missed by the same blind
spot that missed this one — worth remembering if a THIRD file is ever
added that needs the same concurrency shape (an evening-flow equivalent of
Test 18 does not exist yet; `applyEveningFlowTurn` already supports
`testSleepMs`, so it's an easy trap to fall into fresh, not just
inherited).

**Standing rule added**, CLAUDE.md §0, same day: when a defect is fixed
structurally, grep the repository for the same pattern before closing it.
This incident is the rule's own citation.
