# CI time, and which merges hit CI — a record

Written 2026-09-20. Tier: LIGHT (docs only — no code, no test change, no
database work, no merge). Branched from `origin/main` @ `78d7763`.

**Corrected 2026-09-20 (second pass).** Where the first version was wrong, the
original text is struck through (~~like this~~) and a dated correction sits next
to it. Where a figure could not be supported it was removed, and a dated note
says what kind of figure was removed. Nothing was silently rewritten.

This is a RECORD of a measurement and of decisions taken from it. It changes
no behaviour. Nothing here is implemented by this PR.

## PRIMARY FINDING (added 2026-09-20, correction pass)

**A docs-only PR skips the test job, so its merge carries no test-db
evidence, and the first full run happens on main, where a red gates
nothing.**

How, from `.github/workflows/ci.yml` at `78d7763`:

1. On a `pull_request` event the test job is skipped when every changed file is
   under `docs/` or is a root-level `*.md` (`ci.yml:70`, `ci.yml:106-113`,
   `ci.yml:355`). That PR's run reports `Test (real test-db)` as skipped.
2. On the merge to main (a `push` event) the already-green check looks for a
   prior run of that PR head in which `Test (real test-db)` concluded
   `success`, "not skipped" (`ci.yml:331-332`). It finds none, leaves
   `skip=false` (`ci.yml:338-339`), and the full suite runs (`ci.yml:356`).
3. That push run starts after the merge. Nothing in `ci.yml` gates the merge on
   it, so a red there stops nothing.

Observed instance — PR #307 (changed only `CLAUDE.md`, head `7ba18a1`, merged as
`ae3df7f` at 2026-09-19T16:33:50Z):

- Its PR run
  https://github.com/ara-2789/Quoco/actions/runs/35455151071 :
  `Detect docs-only change` success; `Detect already-green PR head` skipped;
  `Test (real test-db)` **skipped**.
- The main run for the merge,
  https://github.com/ara-2789/Quoco/actions/runs/35455361971 (`ae3df7f`):
  attempt 1 (https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/1)
  failed, attempt 2 (.../attempts/2) failed, attempt 3 (.../attempts/3) passed —
  same SHA.
- Raw output for the PR run's job list: `~/Desktop/quoco-310-review.txt`,
  STEP 3-SUPPLEMENT (local file, not committed).

This finding does not say why attempts 1 and 2 failed; see PART 4.

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

Standing rule for this document (added 2026-09-20): every duration carries the
run or job URL it came from, or it is not carried. Every file count states the
commit or tree it was taken from.

---

## PART 1 — Where the time goes

### 1.1 One step is almost all of it

- The `npm test` step of the "Test (real test-db)" job dominates wall-clock.
  [Removed 2026-09-20: a reported duration range for four PR runs — no run
  URL, so it is not carried. The observed durations below all carry URLs.]
- Observed on PR #308's branch (six pull_request runs, `gh run list --workflow
  CI --event pull_request --branch feat/048-engineer-registration --json
  url,headSha,conclusion,createdAt,updatedAt`) **[O]**. Times are run
  created→updated, i.e. whole-run times, not the test step alone:

  | Run | Head SHA | Conclusion | Duration |
  |---|---|---|---|
  | https://github.com/ara-2789/Quoco/actions/runs/35496136697 | `fd96199` | success | 1331s |
  | https://github.com/ara-2789/Quoco/actions/runs/35499415585 | `5022b0d` | success | 1635s |
  | https://github.com/ara-2789/Quoco/actions/runs/35500804334 | `c0bc9de` | success | 1828s |
  | https://github.com/ara-2789/Quoco/actions/runs/35458046968 | `f26a533` | failure | 1557s |
  | https://github.com/ara-2789/Quoco/actions/runs/35460472253 | `67b6e3b` | failure | 1416s |
  | https://github.com/ara-2789/Quoco/actions/runs/35458696055 | `b6af1b1` | failure | 2146s |

- Main run https://github.com/ara-2789/Quoco/actions/runs/35455361971
  (`ae3df7f`), per-job/step times from `gh api
  repos/ara-2789/Quoco/actions/runs/35455361971/attempts/{1,3}/jobs` **[O]**.
  Attempt 1: https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/1
  (test job https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/105929585703).
  Attempt 3: https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/3
  (test job https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286).

  | Job | attempt 1 | attempt 3 |
  |---|---|---|
  | Test (real test-db), whole job | 1900s (failure) | 1718s (success) |
  | — `npm ci` step | 16s | 17s |
  | — `npm test` step | 1878s | 1692s |
  | Lint | 37s | ~~37s~~ (not re-run) |
  | Typecheck | 28s | ~~28s~~ (not re-run) |
  | Migration Lint | 23s | ~~23s~~ (not re-run) |
  | File Size Lint | 22s | ~~22s~~ (not re-run) |
  | Fixture Literal Lint | 24s | ~~24s~~ (not re-run) |
  | Detect already-green PR head | 8s | ~~8s~~ (not re-run) |

  **Correction (20 Sep 2026):** the attempt 3 values originally shown for the
  six non-test jobs were attempt 1's, not attempt 3's. Attempt 3 re-ran only the
  test job; the other jobs in attempt 3's job list carry attempt 1's
  timestamps (`started_at` 2026-09-19T16:33:55Z, `completed_at` between
  16:34:03Z and 16:34:32Z). Raw output: `~/Desktop/quoco-310-review.txt`,
  STEP 6-SUPPLEMENT (local file, not committed). The struck cells are not
  attempt 3 measurements.

- The five lint/typecheck jobs finished in 22-37s in attempt 1 and run in
  parallel **[O]** (attempt 1 URL above); the skip-detection job took 8s.
  ~~Every job other than the test job finished in 22-37s in that run.~~
  **Correction (20 Sep 2026):** the table itself shows the 8s skip-detection
  job, so "every job" was wrong. [Removed 2026-09-20: a reported duration
  range for these jobs — no run URL.]

### 1.2 Nothing runs in parallel inside the test job

- `vitest.config.ts:37` sets `fileParallelism: false`. **[O]**
  (`grep -n 'fileParallelism' vitest.config.ts`, working tree at `78d7763`)
- No test uses `.concurrent`: `grep -rn '\.concurrent' test lib app | wc -l`
  → `0`. **[O]** (working tree at `78d7763`)
- Vitest's own reported test time equals the sum of per-file times — no
  overlap. From the `npm test` log of main run `35455361971` attempt 3
  (job https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286,
  log fetched with `gh api
  repos/ara-2789/Quoco/actions/jobs/106027398286/logs`): the summary line
  reads `tests 1657.19s`; summing the 119 per-file `Nms` figures parsed from
  the same log gives 1,657,193 ms = 1657.2s. **[O]**

### 1.3 File counts, and the DB / non-DB split

- Vitest ran **119** test files at `ae3df7f` (`Test Files 119 passed (119)`,
  attempt 3 log, job
  https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286).
  Independently, from the `ae3df7f` tree: `git ls-tree -r --name-only ae3df7f
  -- test/ | grep -c '\.test\.tsx\?$'` → 119. **[O]**
- The `78d7763` tree has **120** files matching `test/**/*.test.{ts,tsx}`
  (`git ls-tree -r --name-only 78d7763 -- test/ | grep -c '\.test\.tsx\?$'` →
  120). **[O]** ~~The one-file difference from 119 is the commits after
  ae3df7f; not itemised.~~ **Correction (20 Sep 2026):** the difference is
  `test/engineer-copy.test.ts`, added in `75bcb7e` (PR #309, merged as
  `78d7763`); `git diff --name-status ae3df7f 78d7763 -- test/` prints only
  `A	test/engineer-copy.test.ts`. **[O]** (A looser `find` that also walks
  outside `test/` returned 121 in the working tree checked out at `78d7763`,
  not from a tree object; the extra file was not identified.
  `vitest.config.ts:24` only includes `test/**`.)
- Reported split: 66 files that never touch the database and about 53 that do.
  **[R]** No commit, tree or run is recorded for these counts. [Removed
  2026-09-20: a reported total time for the 66 files — no run URL.]
- Re-derived split, INFERRED (not observed): a file counts as "touches DB" if
  its own source references `helpers/db`, `createServiceClient`,
  `createClient(`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_TENANT_ID`,
  `supabase/service`, or `TEST_SUPABASE`; transitive imports through `lib/`
  are NOT followed. The file set is the 119 files in the `ae3df7f` job above;
  each file's source was read from the working tree at `78d7763`, where all
  119 exist at the same paths. The per-file times are observed
  (https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286).
  Result: 56 files / 1656.5s reference the DB directly; 63 files / 0.7s do not;
  the slowest no-DB-reference file is 81ms.
  The counts differ from the reported 66/53 because the classifiers differ
  (mine is direct-reference only). The conclusion is the same under either
  classification: essentially all of the wall-clock is in DB-touching files.
  The 66-vs-63 and 53-vs-56 disagreement is NOT resolved here.

### 1.4 The slowest files

From attempt 3 of `35455361971`, job
https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286
**[O]**:

| File | Time |
|---|---|
| test/owner-deliver-job.test.ts | 188.9s |
| test/dpr-photo-selection.test.ts | 101.3s |
| test/dpr-generate-trigger.test.ts | 84.0s |
| test/hindrance-photos-flow.test.ts | 79.3s |
| test/inbound-start.test.ts | 56.8s |
| top five, summed | 510.3s |

[Removed 2026-09-20: reported durations for the five slowest files and for
owner-deliver-job from an earlier probe, and my comparison of them with the
observed table — reported figures with no run URL.]

### 1.5 Fixture set-up / teardown multiplied per file

- [Removed 2026-09-20: the teardown-cost arithmetic that stood here, and the
  reported per-teardown, per-request and per-run figures that fed it. All were
  reported from an earlier probe; none was re-measured.]
- How many test files call each lifecycle helper
  (`grep -rlw <fn> test --include='*.test.ts' --include='*.test.tsx' | wc -l`,
  working tree at `78d7763`) **[O]**: `ensureMorningFixtures` 25,
  `removeMorningFixtures` 22, `ensureTwoTenantFixtures` 24,
  `removeTwoTenantFixtures` 24, `ensureTestTenant` 5, `removeTestTenant` 2.
  These count files that reference a helper, not executions.
- The teardown cost is not established here. The single measurement that would
  establish it is the wall-clock time of one `removeMorningFixtures()` call,
  timed inside one CI run and recorded with that run's URL.

### 1.6 Things that are not the problem

- [Removed 2026-09-20: a reported total for explicit sleeps — no run URL. The
  sleep total is therefore not established here.] What was observed: `grep
  -rnE 'setTimeout\(|sleep\(' test --include='*.ts' --include='*.tsx' | wc -l`
  → `10` lines **[O]** (working tree at `78d7763`), a count of call sites, not
  seconds.
- Install caching barely matters. `actions/setup-node` is configured
  `cache: 'npm'`, which caches npm's download cache, not `node_modules`;
  `npm ci` runs separately in every job that needs dependencies. **[O]**
  (`grep -n "cache:\|npm ci" .github/workflows/ci.yml` at `78d7763` — six
  `npm ci` lines: typecheck, lint, migration-lint, file-size-lint,
  fixture-literal-lint, test.) `npm ci` inside the test job took 16s and 17s
  **[O]** (table in 1.1, with job URLs) — on the critical path, small next to
  the `npm test` step in the same table.

### 1.7 Queueing

- The test job sits in `concurrency: group: ci-test-db-suite` with
  `cancel-in-progress: false` (ci.yml, `test` job), so one test job runs at a
  time across the whole project and later ones queue. **[O]** (`grep -n
  'group:\|cancel-in-progress' .github/workflows/ci.yml`.)
- [Removed 2026-09-20: a reported queue wait for one run — no run URL.] The
  runs listed for PR #308 (URLs in 1.1) show `createdAt == startedAt`, so the
  run-level timestamps available here do not expose queue wait for that
  branch.

---

## PART 2 — What to change, and what not to

Decisions, with reasoning. All four are stated as decisions about direction;
none is implemented by this PR.

### DO — batch the teardown deletes

[Removed 2026-09-20: the sizing arithmetic that stood here. The teardown cost
is not established; see 1.5.] Batching the same deletes into fewer requests
removes exactly the same data, so no cleanup guarantee weakens. A block for
this was written in an earlier session and has NOT been run. **[R]**

Constraint carried by this repo, not new: `scripts/shared-fixture-fk-coverage.json`
(read by `test/helpers/db.ts`'s sweep and enforced by
`scripts/lint-migrations.mjs`'s `shared-fixture-fk-coverage` rule) is the
single source of truth for which tables teardown must clear. Batching must
preserve that coverage; it may not shorten the list.

### DO — investigate owner-deliver-job's runtime

(Heading figure removed 2026-09-20: it was a reported duration with no run
URL.) [Removed 2026-09-20: reported per-test durations — no run URL.]
Observed: the file totals 188.9s over 21 tests, per the attempt 3 log line
(job https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286);
per-test times were not extracted.

Separately established in an earlier session **[R]**, and the code shape
re-read this session **[O]** (`sed -n 231,266p lib/dpr/select-photos.ts`,
`sed -n 422,490p lib/dpr/owner-deliver-dispatch.ts`):

- The product downloads photos one at a time: a `for (const candidate of
  candidates)` loop awaiting `fetchAttachment` each iteration
  (`lib/dpr/select-photos.ts:231-266`). **[O]**
- It handles engineers one at a time: `for (const row of reportRows)` with
  awaits inside (`lib/dpr/owner-deliver-dispatch.ts:422-490`). **[O]**
- ~~A failed download hits `continue` BEFORE the count/byte cap checks
  (`select-photos.ts:246-262`; `attachments.push` is after them), so failed
  downloads do not count toward the 10-photo cap.~~ **Correction (20 Sep
  2026):** the count cap is checked at the top of each loop iteration, `if
  (attachments.length >= MAX_ATTACHMENTS) break` (`select-photos.ts:232`), on
  the number of attachments already pushed. A failed download reaches
  `continue` at line 257 (the `catch` block is lines 237-258) and never
  reaches `attachments.push` at line 264, so it does not advance that count:
  failed downloads still do not count toward the cap. Only the byte-cap check
  (line 262) sits after the `continue`. The line reference `246-262` was wrong.
  **[O]** (`awk 'NR>=228 && NR<=268 …' lib/dpr/select-photos.ts`, working tree
  at `78d7763`; output in `~/Desktop/quoco-310-fix.txt`, local, not committed.)
  (The value "10" for `MAX_ATTACHMENTS` is **[R]**, from the brief; it was not
  read here.)
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
ids are per-run now (see above). ~~The lock is still needed for a different
reason — see PART 4 —~~ **Correction (20 Sep 2026):** the PART 4 mechanisms
need a writer outside CI (see the correction there), which this lock does not
govern, so "see PART 4" did not establish a reason for the lock; a different
reason is recorded in B 779-786 (see "Related records" below). The ci.yml
comment describes the older mechanism. Not corrected here (docs only).

---

## PART 3 — Which merges hit CI

### 3.1 The two skip mechanisms are two different jobs

They are easy to conflate; they fire on different events.

1. **"Detect docs-only change"** (`changes` job) — `pull_request` events only.
   Skips the test job when EVERY file in the PR's file list is under `docs/`
   or is a root-level `*.md`. Source: the classify step,
   `gh api "repos/${REPO}/pulls/${PR_NUMBER}/files"`, loop at ci.yml lines
   ~~~86-113~~ 92-117. **[O]**
2. **"Detect already-green PR head"** (`skip-duplicate-main-run`) — `push`
   events only (i.e. merges to main). Skips the main run's test job when the
   pushed commit is a merge of a PR whose head tree is identical and whose own
   run already concluded success with `Test (real test-db)` itself success
   (not skipped). Fails toward RUNNING the suite on any doubt. ci.yml
   ~~~212-262~~ 234-343 and its own header comment (212-233). **[O]**

The test job's `if:` (ci.yml ~~~346-354~~ 353-356) combines them: a PR run
tests unless `docs_only`; a push run tests unless `skip == 'true'`. **[O]**

**Correction (20 Sep 2026):** the approximate line references struck above were
loose. Verified with `grep -n` on `.github/workflows/ci.yml` at `78d7763`
(output in `~/Desktop/quoco-310-fix.txt`, local, not committed): the `changes`
job starts at line 67, its `if:` is line 70, and its classifier script is
lines 92-117; the `skip-duplicate-main-run` job is lines 234-343, its `if:` is
line 237; the `test` job starts at line 344 and its `if:` is lines 353-356.
The `ci.yml:70`, `106-113`, `331-332`, `338-339`, `355` and `356` references in
the PRIMARY FINDING were checked against the same output and the earlier
`cat -n` of the file.

### 3.2 The rule that follows from mechanism 1

The filter looks at the WHOLE PR's file list, not at the push's. A single
non-docs file anywhere in the PR disqualifies every later docs-only push on
it. **[O]**

Evidence, PR #308 (`gh pr view 308 --json files,...`): 15 files, 4 of them
outside `docs/` — `scripts/migration-number-reservations.json`,
`scripts/shared-fixture-fk-coverage.json`,
`supabase/migrations/048_engineer_registration.sql`, `types/database.ts`.
**[O]** (File list as of PR head `c0bc9de`, `gh pr view 308 --json
headRefOid,files`.) Commit `5022b0d` on that PR changed only files under
`docs/` (`git show --stat 5022b0d`: `docs/reviews/048-*` × 3) and its PR run
https://github.com/ara-2789/Quoco/actions/runs/35499415585 still ran the full
suite, 1635s. **[O]**

Correction to the brief's framing: the brief says #308 "touched
scripts/*.json". True, but it also carried a real migration and regenerated
types, so it was a code PR regardless — the scripts/*.json files alone are not
what disqualified it. The rule as stated in the previous paragraph is what
matters and is unaffected.

### 3.3 The cost, observed

`gh run list --branch main --workflow CI --limit 30` (main pushes, latest
attempt's conclusion shown by that command) **[O]**:

- Every main push from 2026-09-18 00:00Z onward except one was a short run in
  which the test job was SKIPPED. Only two were opened at job level:
  `78d7763` (44s, https://github.com/ara-2789/Quoco/actions/runs/35508554723)
  and `2866e48` (32s, https://github.com/ara-2789/Quoco/actions/runs/35504199011):
  `Detect already-green PR head` success, `Test (real test-db)` skipped.
  **[O]** The exception is `ae3df7f`, run
  https://github.com/ara-2789/Quoco/actions/runs/35455361971, which ran the
  full suite. **Correction (20 Sep 2026):** the duration range originally
  given for these runs is withdrawn — it spanned about a dozen runs, of which
  two are linked above. The other runs in the window are in the `gh run list
  --branch main --workflow CI --limit 30` output in
  `~/Desktop/quoco-310-fix.txt` (local, not committed); their durations are not
  restated here.
- So main's full suite ran once in that period, on `ae3df7f`. Run history
  **[O]**, from `gh api .../actions/runs/35455361971/attempts/{1,2,3}`:

  | Attempt | Started | Ended | Conclusion | URL |
  |---|---|---|---|---|
  | 1 | 2026-09-19 16:33:53 | 2026-09-19 17:05:46 | failure | https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/1 |
  | 2 | 2026-09-20 04:21:03 | 2026-09-20 04:44:32 | failure | https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/2 |
  | 3 | 2026-09-20 05:24:47 | 2026-09-20 05:53:30 | success | https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/3 |

  Attempt 1: `Test Files 9 failed | 110 passed (119)`, `Tests 23 failed | 1327
  passed | 1 todo (1351)`. Attempt 3, same SHA: `Test Files 119 passed
  (119)`, `Tests 1350 passed | 1 todo (1351)`. **[O]** (both from the
  fetched job logs; the 9 failing files in attempt 1 are named in PART 4.)
- Before that window: `864929b` (2026-09-17) ran the full suite and
  concluded `failure` (2837s,
  https://github.com/ara-2789/Quoco/actions/runs/35249930937); `1a38b12`'s
  skip-duplicate job landed the same day. **[O]**

Stated plainly: the skip saves minutes and can hide a red main for days. On
this evidence main's own suite was red on `ae3df7f` for roughly 12.8 hours
(attempt 1 ended 17:05:46Z on 19 Sep,
https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/1;
attempt 3 turned it green at 05:53:30Z on 20 Sep,
https://github.com/ara-2789/Quoco/actions/runs/35455361971/attempts/3),
~~and the only reason its state was ever exercised is that this one merge
happened not to qualify for the skip.~~ **Correction (20 Sep 2026):** this
merge ran the full suite because PR #307 was docs-only: its PR run skipped
the test job, so no prior successful test job existed for the already-green
check to find (`ci.yml:338-339`). It did not "happen not to qualify"; see the
PRIMARY FINDING. Every other merge in the window was never tested on main at
all.

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
- ~~Why `ae3df7f` did not skip is not determined here (see UNKNOWNS).~~
  **Correction (20 Sep 2026):** determined — see the PRIMARY FINDING.

### 3.4 Open question — recorded, NOT decided

Should `main` run the full suite on a schedule (e.g. nightly, in a quiet
window) regardless of what changed, so a red main cannot hide behind skipped
runs?

Trade-off, both sides:

- FOR: bounds how long a red main can go unseen to one day, independent of
  merge traffic and of the skip logic.
- AGAINST / COST: one more full-suite run per day (durations in 1.1, with
  URLs) that must take the single `ci-test-db-suite` slot (1.7). It queues
  behind, and delays, any PR run that arrives during the window. ~~It also
  adds another writer against the shared test database at the moment PART 4's
  isolation defect is unfixed, so a scheduled run can itself be a source of the
  cross-run interference it is meant to detect. (That last clause is an
  inference from PART 4's mechanisms, not an observed event.)~~ **Correction
  (20 Sep 2026):** the struck clause is withdrawn. The lock (`ci.yml:372`,
  `ci.yml:405`) serialises CI runs against each other, so a scheduled CI run
  adds no CI-against-CI overlap.

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
   prefix matches ~~EVERY concurrent run's session rows~~ the session rows of
   any run whose numbers carry the prefix, not just this run's. **[O]**
   **Correction (20 Sep 2026):** the struck words said "concurrent" runs. The
   CI lock (`ci.yml:372`, `ci.yml:405`) serialises CI runs against each other,
   so two CI runs do not overlap. For mechanism 1 to delete another run's rows
   while that run is in progress, a writer outside CI must be running against
   the same test database at that time (a local suite run, an agent session, a
   script). **The trigger for mechanism 1 is unobserved:** no such writer has
   been shown active during any failing run.
2. `sweep_stale_morning_sessions` (migration 033, `supabase/migrations/
   033_sweep_stale_morning_sessions.sql:167`) is `SECURITY DEFINER` and
   selects `SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning'
   FOR UPDATE SKIP LOCKED` (line 199) — every morning session, no tenant
   filter. **[O]** ~~So any run that invokes the sweep can act on any other
   run's morning sessions.~~ **Correction (20 Sep 2026):** under the CI lock
   the sweep can reach another run's morning sessions only if those rows are
   still in test-db when it runs — rows left behind by an earlier run, or a
   writer outside CI. Neither has been shown.

Observed 20 Sep: main red on `ae3df7f` attempt 1 (9 files, 23 tests; job
https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/105929585703,
tree `ae3df7f`) and green on attempt 3, same SHA (job
https://github.com/ara-2789/Quoco/actions/runs/35455361971/job/106027398286),
quiet database (see 3.3; "quiet database" is **[R]** — not re-verifiable now).
**[O]** for the two attempt results. The nine files failing in attempt 1, with
per-file failing counts, from the fetched log **[O]**: owner-deliver-job (1),
inbound-start (2), unit/morning-cutoff-sweep (6), morning-flow (4),
evening-flow (2), hindrance-photos-flow (1), dispatch (4),
section-42-row-readback (2), section-42-write-boundary-distinctness (1) —
total 23. The set includes the suite that exercises the morning sweep and
several session-flow suites; that is CONSISTENT with mechanisms 1-2 but this
session did not establish either as the cause of those failures. It is not a
proof.

**Neither isolation mechanism has been shown to fire, and attempt 1's 23
failures have no established cause.**

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

## Related records, and one UNRESOLVED disagreement (added 2026-09-20)

Two existing records cover the same ground. Neither is edited by this
document; "A" and "B" below name them, and line numbers are those of each file.

- A = `docs/reviews/ci-test-isolation-options.md`
- B = `docs/reviews/test-db-per-run-fixture-identifiers.md`

**UNRESOLVED — `cleanupTestSessions` and the fixed `+19995550` prefix.**

- B 294-302 records the batch-2 `.or(...)` widening of `cleanupTestSessions`.
  B 548-551 says its `TEST_PHONE_PREFIX` LIKE pattern "keeps correctly
  clearing the new, longer values"; B 674-677 says the cross-run isolation
  goal "is met".
- This document, PART 4 item 1 (line 475, as of this commit), says the same
  LIKE also matches other runs' session rows.
- All three describe the same code. They differ on whether that reach is a
  defect. It is not resolved here and no side is taken.
- The observation that would settle it: a record, from a CI run, of
  `cleanupTestSessions` deleting a `whatsapp_sessions` row that the calling
  run did not create.

A 172-178 (Option 1, a per-run Postgres container) and B's option (b)
(B 710-713) already propose structural fixes; any isolation work should start
from them.

## Gates that do not apply to this document

The file-size lint (`scripts/check-file-sizes.mjs:24-26` and `100-104`) cannot
hard-fail on a docs path — a docs file over the threshold only warns — so it is
not a gate on this document.

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

Added 2026-09-20 (correction pass), all read-only: `git ls-tree -r --name-only
{ae3df7f,78d7763} -- test/ | grep -c '\.test\.tsx\?$'`; `git diff --name-status
ae3df7f 78d7763 -- test/`; `git show -s --format='%h parents=%p %s' 78d7763`;
`gh run list --workflow CI --event pull_request --branch
feat/048-engineer-registration --json url,…`; `gh run list --workflow CI
--branch main --limit 30 --json url,…`; `gh pr view 308 --json
headRefOid,files`; `awk 'NR>=228 && NR<=268 …' lib/dpr/select-photos.ts`;
`grep -n` anchors on `.github/workflows/ci.yml`. Raw output of this pass:
`~/Desktop/quoco-310-fix.txt` (local, not committed). Raw output of the review
that prompted it: `~/Desktop/quoco-310-review.txt` (local, not committed).

## UNKNOWNS

- ~~Why `ae3df7f` (PR #307's merge) did not qualify for the already-green skip
  when the merges around it did. Not investigated.~~ **Resolved 2026-09-20:**
  see the PRIMARY FINDING.
- [Removed 2026-09-20: the teardown-cost unknown as first worded, which quoted
  the withdrawn arithmetic.] The teardown cost is not established; see 1.5.
- The "quiet database" condition on 20 Sep (reported, no run URL). [Removed
  2026-09-20: the other reported duration figures previously listed here.]
- ~~The reconciliation of file counts: 119 (vitest at ae3df7f) vs 120 (tree at
  `78d7763`); and~~ **Resolved 2026-09-20** (119 vs 120: see 1.3). Still open:
  the DB/non-DB split, 66/53 reported vs 63/56 by a direct-reference heuristic.
- The value of `MAX_ATTACHMENTS` (reported as 10, not read this session).
- That the two written-but-unrun blocks (teardown batching, owner-deliver
  investigation) exist as described. Reported only; not located.
- What actually caused attempt 1's 23 failures. Neither PART 4 mechanism has
  been shown to fire. ~~Mechanisms 1-2 in PART 4 are each real and each capable
  of cross-run interference;~~ **Correction (20 Sep 2026):** both are real
  code, but mechanism 1's trigger requires a writer outside CI and none has
  been observed (see PART 4).
- Whether anyone saw main's red between 19 Sep 17:05Z and 20 Sep 05:53Z.
- Whether main should run a scheduled full suite (3.4) — deliberately open.
- The ci.yml `concurrency` comment's stale "fixed, deterministic UUIDs"
  wording — noted, not corrected here.
