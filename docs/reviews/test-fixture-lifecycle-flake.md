# Shared morning/evening fixture lifecycle — transient cross-file flake

**Recorded 2026-09-01.** Not fixed here, deliberately — named so the next
person recognises it in thirty seconds instead of re-deriving it from a
mystery FK violation, the way this session had to, twice, in one day.

## The signature

A batch of `foreign key constraint` violations — always on
`daily_logs`/`whatsapp_sessions`/`users`/`project_members`, always pointing
back to `tenants`/`projects`/`users` rows keyed by this suite's hardcoded
fixture IDs (`TEST_TENANT_ID`, `TEST_PROJECT_ID`, `TEST_ENGINEER_PHONE`,
`test/helpers/db.ts`) — landing across MANY unrelated test files in the
same run, never a single isolated test. The exact constraint that trips
varies between occurrences (see below) — that variance is itself a clue,
not noise: it means whichever row happens to be mid-flight when the shared
fixture disappears is whatever gets named in the error, not a fixed one.

Every failing test calls into the shared fixture lifecycle
(`ensureMorningFixtures()`, `test/helpers/db.ts:246-272`, and
`removeMorningFixtures()`, `test/helpers/db.ts:297-321`) via its own file's
`beforeAll`/`afterAll` —
directly (the morning/evening RPC-integration suites) or indirectly (a
suite that shares the same `daily_logs`/`whatsapp_sessions` rows or the
same tenant/project scope).

## Two observed occurrences, same day

**Occurrence 1 — this session's own local full-suite run**, migration 035
round-3 build, before commit `448dd4f`. `npx vitest run`, no path filter:
**63 failed, 843 passed** (934 total), **12 files** failed:
```
test/dpr-generate-job.test.ts       test/migration-024.test.ts
test/dpr-generate-trigger.test.ts   test/morning-flow.test.ts
test/inbound-start.test.ts          test/session-transition.test.ts
test/migration-016.test.ts          test/unit/morning-cutoff-sweep.test.ts
test/migration-019.test.ts          test/unit/morning-flow-mirror.test.ts
test/migration-022.test.ts          test/webhook.test.ts
```
Dominant constraint: `daily_logs_project_id_fkey` (45 occurrences).
Secondary: `users_tenant_id_fkey`, `whatsapp_sessions_user_id_fkey`,
`daily_logs_engineer_id_fkey`. A re-run immediately after, no code changes,
reproduced cleanly: 1 failure (the known, unrelated
`session-transition.test.ts` lock-wait flake — see that file's own
`docs/reviews/session-transition-lock-wait-flake.md`), 932 passed.

**Occurrence 2 — PR #155's CI**, a **docs-only PR** (317 additions, all
markdown, zero code changed — ruling out a code regression on its own
terms), GitHub Actions run `33512426525`, job `99871125268`, first
attempt, 2026-09-01T13:24:26Z: **40 failed, 840 passed** (899 total), **13
files** failed:
```
test/dpr-generate-job.test.ts            test/morning-flow.test.ts
test/dpr-generate-trigger.test.ts        test/productivity-reconciliation-mirror.test.ts
test/inbound-start.test.ts               test/session-transition.test.ts
test/migration-016.test.ts               test/unit/morning-flow-mirror.test.ts
test/migration-017.test.ts               test/webhook.test.ts
test/migration-019.test.ts
test/migration-022.test.ts
test/migration-024.test.ts
```
Dominant constraint: `whatsapp_sessions_tenant_id_fkey` (6 occurrences).
Secondary: `whatsapp_sessions_user_id_fkey`, `daily_logs_tenant_id_fkey`,
`project_members_project_id_fkey`, `daily_logs_project_id_fkey`,
`daily_logs_engineer_id_fkey`. A re-run of the same job (no code change to
the PR) came back fully green, all jobs including the test-db suite —
PR #155 merged as `512bd8e` on that green run.

**11 of the 12–13 failing files are identical across both occurrences**
(`migration-017`/`unit/morning-cutoff-sweep`/`productivity-reconciliation-
mirror` are the only files that differ between the two lists) — despite
occurrence 1 running locally against a branch with four brand-new test
files, and occurrence 2 running in GitHub Actions against a completely
unrelated, docs-only branch with zero shared code. That overlap is the
strongest evidence this is a general property of the shared-fixture
design, not something either branch introduced.

## Passes standalone, both times, checked directly

- `test/morning-flow.test.ts` (occurrence 1's most-failed file, 15/19)
  run alone: **19/19 passed.**
- `test/unit/morning-flow-mirror.test.ts` (the one file present in every
  failure list checked, including the CI one) run alone, on `main`, after
  occurrence 2: **20/20 passed.**

Neither file has a defect that fails under isolation — the failure only
exists in the presence of the other files sharing the same fixture
lifecycle in the same run.

## What makes it transient — candidate mechanisms, not resolved

`vitest.config.ts` sets `fileParallelism: false` specifically so test
FILES don't run concurrently — but that guarantees ordering between files,
not that one file's teardown and the next file's setup are separated by a
hard barrier with zero possible overlap. Every file in the failing set
independently calls `ensureMorningFixtures()`
(`upsert`-based, meant to be idempotent) in its own `beforeAll` and
`removeMorningFixtures()` (a five-step sequential DELETE chain —
`daily_logs` → `project_members` → sessions → `projects` → `users` →
`tenants`, `test/helpers/db.ts:297-321`) in its own `afterAll`, all against
the SAME three hardcoded IDs. Three candidate mechanisms, none confirmed
over the others:

1. **A slow in-flight operation from an EARLIER file resolves after that
   file's own teardown has already started or finished** — an RPC call or
   insert that hasn't actually returned yet when `afterAll` begins
   deleting, landing after the delete rather than before it. Consistent
   with the constraint varying by occurrence (whichever object happened to
   be in flight), and with CI (occurrence 2, higher/more variable Supabase
   latency than a local run) hitting a different dominant constraint than
   the local run (occurrence 1).
2. **A partial teardown failure.** `removeMorningFixtures()`'s five deletes
   run in sequence with no `try`/`catch` around the chain — an error at
   any step (a transient network blip, not a logic bug) throws and abandons
   every step after it. A transient failure at, say, the `projects` delete
   would leave `users`/`tenants` never removed, but the NEXT file's
   `ensureMorningFixtures()` re-`upsert`s the project fresh regardless, so
   this specific partial state may or may not be enough on its own to
   explain the observed FK violations — flagged as a candidate, not
   confirmed.
3. **A genuine cross-file race despite `fileParallelism: false`** — vitest
   hook scheduling not providing as hard a barrier between one file's
   `afterAll` and the next file's `beforeAll` as the config's own intent
   suggests. Not verified either way here.

Distinguishing these needs instrumentation (timestamps on every fixture
create/destroy call, correlated across files) that this record does not
attempt — naming the failure class and ruling out what it is NOT (a code
regression, in either occurrence) is the goal here, not resolving which of
the three mechanisms above is the actual one.

## Not the same root cause as the `outbound_sends` accretion finding

**Different, unrelated mechanism** — `docs/reviews/outbound-sends-test-
accretion.md` (2026-08-28) is a **permanent, unbounded row-accumulation**
problem: `outbound_sends` has no `DELETE` grant for any role and
`RESTRICT` FKs, so a minted `users` row referenced by an `outbound_sends`
row can never be removed by any code path — the failure mode there is
rows piling up forever, not a race.

This finding is the opposite shape: every table involved
(`daily_logs`, `whatsapp_sessions`, `project_members`, `projects`, `users`,
`tenants`) has ordinary `DELETE` grants and `removeMorningFixtures()`
successfully deletes all of them, every normal run — the failure is a
TRANSIENT timing/ordering problem in a lifecycle that is otherwise fully
capable of cleaning up after itself, not a table that structurally cannot
be cleaned up at all. The two findings share a symptom (an unexpected FK
violation surfacing from shared test fixtures) but not a cause, and the
fix shapes would be unrelated: the accretion fix was "stop minting a new
row per test"; whatever eventually addresses this would be about hook
ordering/isolation, not row-minting frequency.

## Cost so far

Two full investigations in one session, one of them delaying a docs-only
PR merge by a re-run cycle (~13 minutes) for a failure that had nothing to
do with that PR's actual content. Recorded here specifically so the next
occurrence is a thirty-second "known flake, check morning-flow-mirror.ts:83
or the failing file standalone, re-run once" instead of a fresh
investigation from zero.

## A structural filter gap in `removeMorningFixtures()`, found separately (2026-09-03)

**Not the same class as the occurrences above — those are timing races on an
otherwise-complete teardown; this is the teardown itself being incomplete for a
specific case, independent of any race.** Found during a local `npm test` run for
an unrelated, UI-only PR (#177, ProjectStatusTag): `test/reactivation-db.test.ts >
clearMessagingBlock (BOT-27 clear-half)` failed in its own `afterAll` with
`removeMorningFixtures user failed: update or delete on table "users" violates
foreign key constraint "whatsapp_sessions_user_id_fkey" on table
"whatsapp_sessions"` (`test/helpers/db.ts:320`). CI for the same PR passed clean
(`Test (real test-db)`, 10m13s, no failures) — so this did not collide with
anything that run, and per this document's own standing rule, that clean CI result
is not being treated as evidence the local failure was transient; the mechanism
below was checked directly against the code instead.

**Checked directly, not assumed:** `removeMorningFixtures()`
(`test/helpers/db.ts:297-321`) already calls `cleanupTestSessions()` *before* the
`users` delete — ordering is not the defect. `cleanupTestSessions()`
(`test/helpers/db.ts:201-208`) deletes `whatsapp_sessions` rows via
`.like('phone_number', '${TEST_PHONE_PREFIX}%')` (`TEST_PHONE_PREFIX =
'+19995550'`, `db.ts:28`) — a **phone-number-prefix filter, not a `user_id =
engineerId` filter**. Any `whatsapp_sessions` row created against `engineerId`
during a test but carrying a phone number outside that prefix (or otherwise missed
by the `LIKE` match) survives `cleanupTestSessions()` intact, and the later
`.from('users').delete().eq('id', engineerId)` then hits the FK —
deterministically, for that row, regardless of timing. `clearMessagingBlock
(BOT-27 clear-half)` is a plausible place for this to surface (its own subject is
messaging-block/session state), but this record does not claim to have inspected
that specific test's fixture data to confirm which row triggered it — the
mechanism is confirmed from the teardown code itself, not from tracing this one
occurrence's exact row.

**Consequence, left unresolved deliberately (per this document's own "not fixed
here"):** this run's own teardown aborted after `project_members`/sessions/
`projects` deletes succeeded but before `users`/`tenants` ran (the five-step chain
has no `try`/`catch`, per this document's mechanism #2 above) — leaving an
orphaned `users` row (and, transitively, whatever still references it) in the
shared test DB (`exfccwlrhoutkgrlikod`) after this local run. Not cleaned up by
this record. The fix, when someone picks this up, is narrow and named so it isn't
re-derived: scope `cleanupTestSessions()` (or a variant called from
`removeMorningFixtures()`) by `user_id = engineerId` in addition to, or instead
of, the phone-number prefix, so a session row can't outlive the user it's about to
orphan a delete against.

**The open question this record currently leaves unasked.** If the orphaned
`whatsapp_sessions` row persists in the shared test DB, every subsequent local
run of this teardown should hit the same FK — yet CI's `Test (real test-db)`
passed clean against the same database afterwards. Three possibilities, not
resolved here: (a) the row was removed between the two runs by another suite's
own cleanup, (b) CI does not reach this teardown in the same fixture state, or
(c) the local failure depended on local-run state this record has not
identified. Which one is true changes what the fix has to cover: under (a) or
(b) the filter change alone is enough; under (c) there may also be a row to
delete by hand before the next local run. Note that seeding is not at risk
either way — `ensureMorningEngineer()` (`test/helpers/db.ts:216-220`) is
idempotent on the unique `whatsapp_number`, so a leftover `users` row is
reused, not collided with. It is the teardown that keeps failing, not the
setup.
