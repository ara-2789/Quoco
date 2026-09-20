# CI time, and which merges hit CI — a record

Written 2026-09-20. Tier: LIGHT (docs only — no code, no test change, no
database work, no merge). Branched from `origin/main` @ `78d7763`.

This is a RECORD of a measurement and of decisions taken from it. It changes
no behaviour. Nothing here is implemented by this PR.

## Provenance tags

Every measurement below carries one of:

- **[O]** — observed in the writing session of this file (2026-09-20), with the
  command that produced it. Reproducible from the command as written.
- **[R]** — reported from an earlier session's CI probe (run 19-20 Sep 2026)
  that this session did NOT re-derive. Carried forward as a report, not
  re-asserted as observed. Where an [O] figure in this file differs from the
  [R] figure for the same quantity, BOTH are shown and the difference is
  named — they come from different runs and must not be merged.

`gh` calls below use the repo `ara-2789/Quoco` (from `gh repo view --json
nameWithOwner`). API output was redirected to files and parsed with `node`; the
commands are given in the shape that was run. Times are UTC.

---

## PART 1 — Where the time goes

### 1.1 One step is almost all of it

- The `npm test` step of the "Test (real test-db)" job dominates wall-clock.
  Reported range: 22-36 minutes across four recent PR runs. **[R]**
- Independently observed on PR #308's branch (six pull_request runs,
  `gh run list --workflow CI --event pull_request --branch
  feat/048-engineer-registration`): run created→updated 1331s to 2146s
  (22.2 to 35.8 min), three green (1331s, 1635s, 1828s) and three red (1416s,
  1557s, 2146s). **[O]** These are whole-run times, not the test step alone.
- Main run `35455361971` (ae3df7f), per-job/step times from
  `gh api repos/ara-2789/Quoco/actions/runs/35455361971/attempts/{1,3}/jobs`
  **[O]**:

  | Job | attempt 1 | attempt 3 |
  |---|---|---|
  | Test (real test-db), whole job | 1900s (failure) | 1718s (success) |
  | — `npm ci` step | 16s | 17s |
  | — `npm test` step | 1878s | 1692s |
  | Lint | 37s | 37s |
  | Typecheck | 28s | 28s |
  | Migration Lint | 23s | 23s |
  | File Size Lint | 22s | 22s |
  | Fixture Literal Lint | 24s | 24s |
  | Detect already-green PR head | 8s | 8s |

- Every job other than the test job finished in 22-37s in that run, and they
  run in parallel. **[O]** (Reported: 20-40s. **[R]**, consistent.)

### 1.2 Nothing runs in parallel inside the test job

- `vitest.config.ts:37` sets `fileParallelism: false`. **[O]**
  (`grep -n 'fileParallelism' vitest.config.ts`)
- No test uses `.concurrent`: `grep -rn '\.concurrent' test lib app | wc -l`
  → `0`. **[O]**
- Vitest's own reported test time equals the sum of per-file times — no
  overlap. From the `npm test` log of main run `35455361971` attempt 3
  (job `106027398286`, log fetched with `gh api
  repos/ara-2789/Quoco/actions/jobs/106027398286/logs`): the summary line
  reads `tests 1657.19s`; summing the 119 per-file `Nms` figures parsed from
  the same log gives 1,657,193 ms = 1657.2s. **[O]**

### 1.3 File counts, and the DB / non-DB split

- Vitest ran **119** test files at ae3df7f (`Test Files 119 passed (119)`,
  attempt 3 log). **[O]**
- The tree at the branch point (`78d7763`) has **120** files matching
  `test/**/*.test.{ts,tsx}` (`git ls-files 'test/**' | grep -c
  '\.test\.tsx\?$'` → 120). **[O]** The one-file difference from 119 is the
  commits after ae3df7f; not itemised. (A looser `find` that also walks
  outside `test/` returned 121; `vitest.config.ts:24` only includes
  `test/**`, so 120 is the relevant count for the current tree.)
- Reported split: 66 files that never touch the database take 0.9s in total;
  about 53 DB-touching files take the rest. **[R]**
- Re-derived split, with a stated HEURISTIC (a file counts as "touches DB" if
  its own source references `helpers/db`, `createServiceClient`,
  `createClient(`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_TENANT_ID`,
  `supabase/service`, or `TEST_SUPABASE`; transitive imports through `lib/`
  are NOT followed) applied to the per-file times of attempt 3 **[O]**:
  56 files / 1656.5s reference the DB directly; 63 files / 0.7s do not; the
  slowest no-DB-reference file is 81ms.
  The counts differ from the reported 66/53 because the classifiers differ
  (mine is direct-reference only). The conclusion is the same under either
  classification: essentially all of the wall-clock is in DB-touching files.
  The 66-vs-63 and 53-vs-56 disagreement is NOT resolved here.

### 1.4 The slowest files

From attempt 3 of `35455361971` **[O]**:

| File | Time |
|---|---|
| test/owner-deliver-job.test.ts | 188.9s |
| test/dpr-photo-selection.test.ts | 101.3s |
| test/dpr-generate-trigger.test.ts | 84.0s |
| test/hindrance-photos-flow.test.ts | 79.3s |
| test/inbound-start.test.ts | 56.8s |
| top five, summed | 510.3s |

Reported from an earlier probe: five slowest ≈ 485s; owner-deliver-job alone
≈ 181s. **[R]** Same order of magnitude, different run; the ~25s / ~8s gaps
are run-to-run variation or a different sample, not reconciled.

### 1.5 Fixture set-up / teardown multiplied per file

- Reported: two shared fixture sets are each created and destroyed about 24
  times per run; each teardown is roughly 35-40 sequential requests, most of
  which delete nothing. **[R]** The "35-40 requests" and "most delete nothing"
  figures were NOT re-derived.
- What was re-derived: how many test files call each lifecycle helper
  (`grep -rlw <fn> test --include='*.test.ts' --include='*.test.tsx' | wc -l`)
  **[O]**: `ensureMorningFixtures` 25, `removeMorningFixtures` 22,
  `ensureTwoTenantFixtures` 24, `removeTwoTenantFixtures` 24,
  `ensureTestTenant` 5, `removeTestTenant` 2. This supports "about 24 files
  each" for the two large fixture sets; whether teardown runs once per file or
  once per test within a file was not checked, so the "24 times per run"
  count is a floor on files, not a confirmed count of executions.
- Request cost: each database request costs roughly 200ms from the GitHub
  runner. **[R]** Not re-measured.
- Sizing arithmetic carried in Part 2: ~48 teardowns × ~37 requests × ~200ms.
  The inputs are all [R]; the product is therefore [R]-derived and is an
  ESTIMATE, not a measurement.

### 1.6 Things that are not the problem

- Explicit sleeps total about 10s. **[R]** Cross-check: `grep -rnE
  'setTimeout\(|sleep\(' test --include='*.ts' --include='*.tsx' | wc -l` →
  `10` lines. **[O]** (That is a count of call sites, not seconds; it does
  not confirm the ~10s total, only that there are few sites.)
- Install caching barely matters. `actions/setup-node` is configured
  `cache: 'npm'`, which caches npm's download cache, not `node_modules`;
  `npm ci` runs separately in every job that needs dependencies. **[O]**
  (`grep -n "cache:\|npm ci" .github/workflows/ci.yml` — six `npm ci` lines:
  typecheck, lint, migration-lint, file-size-lint, fixture-literal-lint,
  test.) `npm ci` inside the test job took 16-17s **[O]** (table in 1.1) — on
  the critical path, small next to ~1700s of tests.

### 1.7 Queueing

- The test job sits in `concurrency: group: ci-test-db-suite` with
  `cancel-in-progress: false` (ci.yml, `test` job), so one test job runs at a
  time across the whole project and later ones queue. **[O]** (`grep -n
  'group:\|cancel-in-progress' .github/workflows/ci.yml`.)
- Reported: one run waited 45 minutes to start. **[R]** Not re-derived. The
  runs listed for PR #308 show `createdAt == startedAt`, so the run-level
  timestamps available here do not expose queue wait for that branch.

---

## PART 2 — What to change, and what not to

Decisions, with reasoning. All four are stated as decisions about direction;
none is implemented by this PR.

### DO — batch the teardown deletes

~48 teardowns × ~37 sequential requests × ~200ms is several minutes per run
spent on round trips that mostly find nothing (all inputs [R], see 1.5).
Batching the same deletes into fewer requests removes exactly the same data,
so no cleanup guarantee weakens. A block for this was written in an earlier
session and has NOT been run. **[R]**

Constraint carried by this repo, not new: `scripts/shared-fixture-fk-coverage.json`
(read by `test/helpers/db.ts`'s sweep and enforced by
`scripts/lint-migrations.mjs`'s `shared-fixture-fk-coverage` rule) is the
single source of truth for which tables teardown must clear. Batching must
preserve that coverage; it may not shorten the list.

### DO — investigate owner-deliver-job's ~181s

Individual photo tests run 8-22s. **[R]** (Observed this session: the file
totals 188.9s over 21 tests, per the attempt 3 log line; per-test times were
not extracted.)

Separately established in an earlier session **[R]**, and the code shape
re-read this session **[O]** (`sed -n 231,266p lib/dpr/select-photos.ts`,
`sed -n 422,490p lib/dpr/owner-deliver-dispatch.ts`):

- The product downloads photos one at a time: a `for (const candidate of
  candidates)` loop awaiting `fetchAttachment` each iteration
  (`lib/dpr/select-photos.ts:231-266`). **[O]**
- It handles engineers one at a time: `for (const row of reportRows)` with
  awaits inside (`lib/dpr/owner-deliver-dispatch.ts:422-490`). **[O]**
- A failed download hits `continue` BEFORE the count/byte cap checks
  (`select-photos.ts:246-262`; `attachments.push` is after them), so failed
  downloads do not count toward the 10-photo cap. **[O]** (The cap constant
  `MAX_ATTACHMENTS` is referenced at line 232; its value "10" is from the
  brief, **[R]** — not read here.)
- Consequence, as reported: a Storage outage walks every photo row inside a
  job that has a time limit. **[R]** (Follows from the three code facts above;
  the outage behaviour itself was not exercised here.)

That is a PRODUCT bug, not a CI one, and is worth more than the minutes. A
block for this was written and has NOT been run. **[R]**

### DO NOT — enable file parallelism

Test files share fixture ids within a run. Concurrent files would let one
file's cleanup delete rows another file is still using. That trades minutes
for tests that cannot be trusted.

Fact that sharpens this, observed this session: fixture ids are now
per-RUN, not per-file — `TEST_TENANT_ID = deriveRunScopedUuid(getRunId(),
'TEST_TENANT_ID')` (`test/helpers/db.ts:178`), and likewise the project,
engineer phone and two-tenant ids. **[O]** Run-scoping separates run from run;
it does nothing to separate file from file inside one run, so the reasoning
above stands unchanged.

### DO NOT — relax the one-job-at-a-time lock

Same failure across runs instead of within one. Shortening the run shrinks the
queue without the risk.

A stale-text observation, recorded so it is not lost, NOT a decision: the
comment above the `test` job's `concurrency` block in ci.yml still justifies
the lock by "fixed, deterministic UUIDs in test/helpers/db.ts". **[O]** Those
ids are per-run now (see above). The lock is still needed for a different
reason — see PART 4 — but the ci.yml comment describes the older mechanism.
Not corrected here (docs only).

---

## PART 3 — Which merges hit CI

### 3.1 The two skip mechanisms are two different jobs

They are easy to conflate; they fire on different events.

1. **"Detect docs-only change"** (`changes` job) — `pull_request` events only.
   Skips the test job when EVERY file in the PR's file list is under `docs/`
   or is a root-level `*.md`. Source: the classify step,
   `gh api "repos/${REPO}/pulls/${PR_NUMBER}/files"`, loop at ci.yml lines
   ~86-113. **[O]**
2. **"Detect already-green PR head"** (`skip-duplicate-main-run`) — `push`
   events only (i.e. merges to main). Skips the main run's test job when the
   pushed commit is a merge of a PR whose head tree is identical and whose own
   run already concluded success with `Test (real test-db)` itself success
   (not skipped). Fails toward RUNNING the suite on any doubt. ci.yml
   ~212-262 and its own header comment. **[O]**

The test job's `if:` (ci.yml ~346-354) combines them: a PR run tests unless
`docs_only`; a push run tests unless `skip == 'true'`. **[O]**

### 3.2 The rule that follows from mechanism 1

The filter looks at the WHOLE PR's file list, not at the push's. A single
non-docs file anywhere in the PR disqualifies every later docs-only push on
it. **[O]**

Evidence, PR #308 (`gh pr view 308 --json files,...`): 15 files, 4 of them
outside `docs/` — `scripts/migration-number-reservations.json`,
`scripts/shared-fixture-fk-coverage.json`,
`supabase/migrations/048_engineer_registration.sql`, `types/database.ts`.
**[O]** Commit `5022b0d` on that PR changed only files under `docs/`
(`git show --stat 5022b0d`: `docs/reviews/048-*` × 3) and its PR run
`35499415585` still ran the full suite, 1635s. **[O]**

Correction to the brief's framing: the brief says #308 "touched
scripts/*.json". True, but it also carried a real migration and regenerated
types, so it was a code PR regardless — the scripts/*.json files alone are not
what disqualified it. The rule as stated in the previous paragraph is what
matters and is unaffected.

### 3.3 The cost, observed

`gh run list --branch main --workflow CI --limit 30` (main pushes, latest
attempt's conclusion shown by that command) **[O]**:

- Every main push from 2026-09-18 00:00Z onward except one finished in
  32-63s — the test job was SKIPPED (spot-checked at job level for `78d7763`
  and `2866e48`: `Detect already-green PR head` success, `Test (real
  test-db)` skipped). **[O]** The exception is `ae3df7f`, run
  `35455361971`, which ran the full suite.
- So main's full suite ran once in that period, on `ae3df7f`. Run history
  **[O]**, from `gh api .../actions/runs/35455361971/attempts/{1,2,3}`:

  | Attempt | Started | Ended | Conclusion |
  |---|---|---|---|
  | 1 | 2026-09-19 16:33:53 | 2026-09-19 17:05:46 | failure |
  | 2 | 2026-09-20 04:21:03 | 2026-09-20 04:44:32 | failure |
  | 3 | 2026-09-20 05:24:47 | 2026-09-20 05:53:30 | success |

  Attempt 1: `Test Files 9 failed | 110 passed (119)`, `Tests 23 failed | 1327
  passed | 1 todo (1351)`. Attempt 3, same SHA: `Test Files 119 passed
  (119)`, `Tests 1350 passed | 1 todo (1351)`. **[O]** (both from the
  fetched job logs; the 9 failing files in attempt 1 are named in PART 4.)
- Before that window: `864929b` (2026-09-17) ran the full suite and
  concluded `failure` (2837s); `1a38b12`'s skip-duplicate job landed the same
  day. **[O]**

Stated plainly: the skip saves minutes and can hide a red main for days. On
this evidence main's own suite was red on `ae3df7f` for roughly 12.8 hours
(attempt 1 ended 17:05Z on 19 Sep; attempt 3 turned it green at 05:53Z on 20
Sep), and the only reason its state was ever exercised is that this one merge
happened not to qualify for the skip. Every other merge in the window was
never tested on main at all.

What this record does NOT establish: that "nobody saw" the red. GitHub
recorded attempts 1 and 2 as failures; whether a person looked is not
observable from here. **[R]** The current headline conclusion of the run is
`success` (attempt 3), so anyone who checks the run list now sees green — the
red survives only in the attempt history.

Two qualifications so the reading stays honest:

- The skip is not unsound in its own terms. It only fires when the PR head
  tree equals the merge tree AND the PR's own run was green. A skipped main
  run is therefore "the same tree already passed once." The hazard is not the
  skip's logic; it is that the suite's pass/fail is not deterministic on a
  fixed tree (PART 4), which makes "already passed once" weak evidence.
- Why `ae3df7f` did not skip is not determined here (see UNKNOWNS).

### 3.4 Open question — recorded, NOT decided

Should `main` run the full suite on a schedule (e.g. nightly, in a quiet
window) regardless of what changed, so a red main cannot hide behind skipped
runs?

Trade-off, both sides:

- FOR: bounds how long a red main can go unseen to one day, independent of
  merge traffic and of the skip logic.
- AGAINST / COST: one more ~22-36 minute run per day (1.1) that must take the
  single `ci-test-db-suite` slot (1.7). It queues behind, and delays, any PR
  run that arrives during the window; it also adds another writer against the
  shared test database at the moment PART 4's isolation defect is unfixed, so
  a scheduled run can itself be a source of the cross-run interference it is
  meant to detect. (That last clause is an inference from PART 4's
  mechanisms, not an observed event.)

No decision is taken here. Someone with the authority to spend the
queue slot has to take it.

---

## PART 4 — Why this is second priority

The test-isolation defect ranks ABOVE CI time. Two mechanisms, both read this
session:

1. `cleanupTestSessions()` (`test/helpers/db.ts:287`) deletes
   `whatsapp_sessions` rows with
   `.or('phone_number.like.+19995550%,phone_number.eq.<TEST_ENGINEER_PHONE>')`.
   `testPhone(slot)` builds numbers as `TEST_PHONE_PREFIX` + a run-scoped
   block + slot (`test/helpers/db.ts:232-234`), so the fixed `+19995550`
   prefix matches EVERY concurrent run's session rows, not just this run's.
   **[O]**
2. `sweep_stale_morning_sessions` (migration 033, `supabase/migrations/
   033_sweep_stale_morning_sessions.sql:167`) is `SECURITY DEFINER` and
   selects `SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning'
   FOR UPDATE SKIP LOCKED` (line 199) — every morning session, no tenant
   filter. **[O]** So any run that invokes the sweep can act on any other
   run's morning sessions.

Observed 20 Sep: main red on `ae3df7f` attempt 1 (9 files, 23 tests) and green
on attempt 3, same SHA, quiet database (see 3.3; "quiet database" is
**[R]** — not re-verifiable now). **[O]** for the two attempt results. The
nine files failing in attempt 1, with per-file failing counts, from the
fetched log **[O]**: owner-deliver-job (1), inbound-start (2),
unit/morning-cutoff-sweep (6), morning-flow (4), evening-flow (2),
hindrance-photos-flow (1), dispatch (4), section-42-row-readback (2),
section-42-write-boundary-distinctness (1) — total 23. The set includes the
suite that exercises the morning sweep and several session-flow suites; that
is CONSISTENT with mechanisms 1-2 but this session did not establish either as
the cause of those failures. It is not a proof.

A suite whose failures are ambiguous cannot gate anything. Slice 1 is FULL
tier and gated on CI. Until failure on a fixed SHA means a real defect and
not the weather, a green run is weak evidence and a red run is weak evidence
in the other direction.

The fix may be larger than a helper change. Mechanism 1 is a test helper and
could plausibly be scoped by the run block. Mechanism 2 is shipped SQL in a
`SECURITY DEFINER` function that touches auth/production behaviour; changing
its predicate is a migration, and per CLAUDE.md §0's external-review gate
triggers (a) and (b) that is a FULL-tier change in its own right, not a
helper tweak. That sizing is the reason isolation is second priority and not
first-cheap: it is not a small change.

---

## Evidence commands (as run, 2026-09-20)

```
git fetch origin && git log origin/main --oneline -3        # branch point 78d7763
git checkout -b docs/ci-time-record origin/main
grep -n 'fileParallelism' vitest.config.ts
grep -rn '\.concurrent' test lib app | wc -l
git ls-files 'test/**' | grep -c '\.test\.tsx\?$'
grep -n 'cache:\|npm ci\|group:\|cancel-in-progress' .github/workflows/ci.yml
gh run list --branch main --workflow CI --limit 30 --json databaseId,headSha,conclusion,createdAt,updatedAt,startedAt,event,displayTitle
gh api repos/ara-2789/Quoco/actions/runs/35455361971/attempts/{1,2,3}
gh api repos/ara-2789/Quoco/actions/runs/35455361971/attempts/{1,3}/jobs
gh api repos/ara-2789/Quoco/actions/runs/{35508554723,35504199011}/jobs
gh api repos/ara-2789/Quoco/actions/jobs/{105929585703,106027398286}/logs   # attempt 1 / 3 test jobs
gh pr view 308 --json files,headRefOid,mergedAt,commits
gh run list --workflow CI --event pull_request --branch feat/048-engineer-registration --limit 15
git show --stat 5022b0d
grep -n 'sweep_stale_morning_sessions\|FROM whatsapp_sessions' supabase/migrations/033_sweep_stale_morning_sessions.sql
```

Output was redirected to files under the job's temp directory and read
selectively; job logs were grepped for the vitest summary and per-file lines
only, not printed whole.

## UNKNOWNS

- Why `ae3df7f` (PR #307's merge) did not qualify for the already-green skip
  when the merges around it did. Not investigated.
- Whether teardown runs once per file or once per test in the ~24 files that
  use each large fixture set, and the true per-teardown request count and
  fraction that delete nothing. All [R]; the ~48 × ~37 × ~200ms estimate rests
  on them.
- The ~200ms per-request figure, the ~10s sleep total, the 45-minute queue
  wait, and the "quiet database" condition on 20 Sep. All [R].
- The reconciliation of file counts: 119 (vitest at ae3df7f) vs 120 (tree at
  `78d7763`); and the DB/non-DB split, 66/53 reported vs 63/56 by a
  direct-reference heuristic.
- The value of `MAX_ATTACHMENTS` (reported as 10, not read this session).
- That the two written-but-unrun blocks (teardown batching, owner-deliver
  investigation) exist as described. Reported only; not located.
- What actually caused attempt 1's 23 failures. Mechanisms 1-2 in PART 4 are
  each real and each capable of cross-run interference; neither was shown to
  have fired.
- Whether anyone saw main's red between 19 Sep 17:05Z and 20 Sep 05:53Z.
- Whether main should run a scheduled full suite (3.4) — deliberately open.
- The ci.yml `concurrency` comment's stale "fixed, deterministic UUIDs"
  wording — noted, not corrected here.
