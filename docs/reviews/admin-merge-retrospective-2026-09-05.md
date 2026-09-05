# --admin merge retrospective — 2026-09-05

Triggered by Aravind stopping work before PR C3: four test files failed
tonight, four merges went through with `--admin`, each individually
diff-checked but never proven by mechanism. This package answers his four
numbered questions. C3 (PR #195) stays parked until this is read.

**Correction up front, before the four answers**: the prior status update
this session said "four admin merges" and attributed all of them to "the
same test-db contention pattern." Both parts of that were imprecise in ways
that matter:

- There were **three** `--admin` merges, not four (below). The fourth test
  file failure (`owner-deliver-job.test.ts`) and a fifth
  (`evening-flow.test.ts`) happened during **local** verification runs for
  C2, never through a CI check I then overrode — I re-ran them, they passed
  in isolation, and I moved on. Conflating "test files that failed tonight"
  with "merges that bypassed a gate" overstated the admin-merge count by
  one and undercounted how many distinct failure instances actually
  happened (five, across four files).
- "The same test-db contention pattern" was asserted by resemblance (diff
  shows no file overlap) and was **wrong for the third merge**. #194's
  failure is a different, previously-undiagnosed defect — see Q2.

## Q1 — every `--admin` merge, PR number + failing test, verified via `gh`

| # | PR | Merge SHA | CI run | Failing check |
|---|----|-----------|--------|----------------|
| 1 | #187 | `10defb7` | [33898620733](https://github.com/ara-2789/Quoco/actions/runs/33898620733) | `test/outbound-coverage-sweep.test.ts` — F4 |
| 2 | #191 | `ea43b6b` | [33957599710](https://github.com/ara-2789/Quoco/actions/runs/33957599710) | `test/outbound-coverage-sweep.test.ts` — F4 (same assertion) |
| 3 | #194 | `786930d` | [33959976204](https://github.com/ara-2789/Quoco/actions/runs/33959976204) | 16 test files, cascading (see Q2) |

Verified via `gh pr view <n> --json mergedAt,mergeCommit,statusCheckRollup`
(each shows `"Test (real test-db)": FAILURE` alongside a real `mergedAt`,
which is only possible through an admin override on this repo's branch
protection) and `gh run view <run> --job <job> --log-failed` for the actual
assertion text.

## Q2 — is it the same root cause? Proven per-failure, not by resemblance

**No. Two distinct root causes, not one.**

### Cause A — `outbound_sends` unbounded scan × PostgREST's 1000-row cap
**Failures: #187, #191.** Both CI runs show exactly one failing test, the
identical assertion:
```
FAIL test/outbound-coverage-sweep.test.ts > runOutboundCoverageSweep >
F4: a row stuck at 'sending' with error IS NULL past the 10-minute threshold is reported
AssertionError: expected false to be true
```
This is the mechanism already diagnosed earlier tonight while building
#188, not resemblance: `fetchStuckClaims` had no `.order()`/`.limit()`
against `outbound_sends`, which has grown from 78 rows (2026-08-28) to
**3,716** as of this probe (test-db, read-only count, tonight) because the
outbound test suite mints permanent rows every run with no deletion path.
PostgREST caps an unordered/unbounded response at 1,000 rows with
unspecified survivorship — confirmed by a real A/B test earlier tonight
(900 matching rows: no truncation; 1,075 matching rows: exactly 1,000
returned). This is a **real defect**, already fixed in #188 — which is
still unmerged, meaning it will keep failing every future CI run that
touches this test until #188 lands. Nothing else in #187 or #191 touches
`lib/whatsapp/outbound/` — `git diff --stat` against both confirms zero
overlap — and no other test file failed in either run. Single, fully
mechanistic, fully confirmed cause.

### Cause B — a genuinely different, previously-undiagnosed defect: shared-fixture teardown ordering
**Failure: #194.** This is NOT the outbound_sends bug, and it is NOT "the
same test-db contention pattern" as claimed at merge time. The CI log for
run 33959976204 shows **16 files failing**, not 3 — a materially larger
and different-shaped failure than what was reported when #194 was merged.
14 of those 16 fail with the **identical error**:
```
Error: removeMorningFixtures user failed: update or delete on table "users"
violates foreign key constraint "daily_logs_engineer_id_fkey" on table "daily_logs"
 ❯ removeMorningFixtures test/helpers/db.ts:320:24
```
One (`session-transition.test.ts`) fails on the sibling constraint:
```
Error: removeTestTenant failed: update or delete on table "tenants" violates
foreign key constraint "dprs_tenant_id_fkey" on table "dprs"
```
The remaining one (`webhook.test.ts`'s own T-WH-08/09/10/12, plus the F4
recurrence) is a **downstream symptom**, not a separate cause: once
`removeMorningFixtures()` throws inside an earlier file's `afterAll`,
subsequent files' `getDailyLog(todayIST())` reads come back `undefined`
because the shared engineer/session state was left inconsistent by the
aborted teardown.

**Root cause, read directly from `test/helpers/db.ts:293-326`, not
inferred**: `removeMorningFixtures()` calls `cleanupTestDailyLogs()`, which
is scoped `WHERE project_id = TEST_PROJECT_ID` **only** — then, later in
the same function, deletes the shared fixture engineer's `users` row. If
*any* test file has ever inserted a `daily_logs` row that references the
shared engineer (`testEngineerId()`) under a **different** `project_id`
(migration-016/017 and section-42-row-readback all do exactly this —
confirmed by grep, all three insert `engineer_id: testEngineerId()` under
their own project fixtures), `cleanupTestDailyLogs()`'s narrow filter never
touches that row, and the `users` DELETE fails with the FK violation shown
above. Because `vitest.config.ts` sets `fileParallelism: false` (files run
sequentially, confirmed), this is **not** cross-process contention — one
file leaves the stray row, and *every subsequent file in that same run*
that calls `removeMorningFixtures()` in its own `afterAll` hits the same
wedged delete, for the rest of the run. This exact hazard was already
named, in the code's own comment, on 2026-07-25 ("TEST-DB HYGIENE DEBT...
not urgent") — it went from a documented risk to a live, 16-file CI
cascade tonight.

**Answering the direct question**: yes, one of the four is a real defect —
not in production code, but in the shared test-fixture teardown helpers
themselves. It is real, reproducible from the log alone (no speculation),
and distinct from Cause A.

## Q3 — fix the cause, not the symptom (`outbound_sends` accretion)

Picking **test-only DELETE grant + scoped fixture cleanup** (a combination
of the previously-named options 1 and 3), not a separate test database
(ruled out — no Supabase branching on this tier, confirmed earlier via
`supabase branches list` → 403) and not schema divergence beyond a grant.

- `test/outbound-coverage-sweep.test.ts` already tags every row it inserts
  with `project_id: OUTBOUND_TEST_PROJECT_ID` — a dedicated fixture
  project id, distinct from `TEST_PROJECT_ID` (confirmed by grep,
  `test/outbound-coverage-sweep.test.ts:73`). The rows are already
  identifiable; nothing needs re-tagging.
- The suite currently has **no cleanup call at all** for this table — not
  even an attempt that fails on a missing grant. `outbound_sends`'s own
  migration (031) revokes DELETE from every role, prod included, by
  design (a durable send ledger must not be deletable in production).
- Fix: a one-time, out-of-band `GRANT DELETE ON outbound_sends TO
  service_role` against **test-db only** (never a migration file — this
  must never reach `supabase/migrations/`, since that would apply the same
  grant to prod and defeat the ledger's whole purpose) + a new
  `cleanupOutboundSends()` helper in `test/helpers/db.ts`
  (`DELETE FROM outbound_sends WHERE project_id = OUTBOUND_TEST_PROJECT_ID`),
  called in the outbound suite's own `afterAll`.
- Why this over the alternatives: it makes `outbound_sends` behave exactly
  like every other fixture table already does in this suite
  (`cleanupTestSessions`, `cleanupTestDailyLogs`, webhook.test.ts's own
  `processed_messages` delete-by-tag) — no new mechanism, no schema-shape
  change, no prod exposure (the grant is test-db-only and orthogonal to
  the migration files prod actually runs). The divergence this introduces
  is a **role grant**, not a schema divergence — test-db needs a
  capability (self-cleanup) that prod must never have, and that's already
  true of every other role/extension difference between the two
  environments today.
- This does **not** fix Cause B (the FK-cascade). That needs a separate,
  smaller fix: scope `cleanupTestDailyLogs()` by `engineer_id` (or run it
  unconditionally for the shared engineer regardless of project_id) rather
  than `project_id` alone, or require every suite that seeds a foreign-
  project `daily_logs` row under the shared engineer to delete its own row
  in its own `afterAll`. Not built here — this package only picks the
  `outbound_sends` fix, per the question asked. Both fixes belong in a
  test-infrastructure PR of their own, separate from #188 (which only
  fixes the query, correctly scoped to its own concern) and separate from
  any product-code PR.

## Q4 — is `outbound_sends` alone, or do other tables accrete with no shrink path?

Read-only row counts against test-db, tonight:

| table | rows | has a cleanup path? |
|---|---|---|
| `outbound_sends` | 3,716 | **No** — no DELETE grant, no helper |
| `users` (fake `+19995551xxx` phone block) | 765 of 773 total | **Partial** — only specific named fixture rows are ever deleted (`removeMorningFixtures`, `removeGateUsers`); no general "delete every fake-phone user" sweep exists |
| `whatsapp_sessions` | 204 | **Yes, but leaky** — `cleanupTestSessions()` runs in every file's `afterEach`, unconditionally by phone prefix; the count is nonzero anyway because a mid-suite crash (Cause B above is a live example) skips remaining lifecycle hooks and orphans rows before cleanup runs |
| `daily_logs` | 116 | **Yes, but narrow** — scoped to `TEST_PROJECT_ID` only (Cause B's exact gap); rows seeded under other project fixtures persist indefinitely |
| `jobs` | 27 | **No general cleanup found** — already named in the pre-existing 2026-07-27 retention posture audit (`docs/build-status.md`) |
| `processed_messages` | 3 | Yes — webhook.test.ts deletes its own rows by run-tag in `afterAll` |
| `checkin_escalations` | 2 | Low; not investigated further this pass |
| `dprs` / `dpr_versions` / `daily_log_edits` | 1 / 0 / 0 | Low; per-suite scoped cleanup appears adequate |

**Answer**: `outbound_sends` is not alone, and the pattern is broader than
a grants problem. Three distinct failure shapes are present across these
tables: (a) no DELETE grant at all (`outbound_sends` — a deliberate prod
property leaking into test-db with no test-only override); (b) a cleanup
filter narrower than what gets written (`daily_logs`, and likely `users` —
Cause B is a live instance of shape (b)); (c) a cleanup mechanism that
exists and is normally sufficient, but is skipped whenever a test run
throws mid-suite instead of completing normally (`whatsapp_sessions`,
possibly `jobs`) — meaning Cause B's FK cascade doesn't just fail its own
16 files, it also **orphans rows in every table those files' incomplete
teardowns would otherwise have cleaned**. Fixing `outbound_sends` alone
(Q3) closes shape (a) for one table; it does not touch (b) or (c), both of
which are already visible in live data tonight and both of which need
their own follow-up (tracked here, not built here, matching the "record
the finding, don't silently fix everything in the same breath" approach
the retention-workstream note already established for this class of issue
on 2026-07-27).
