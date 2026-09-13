# Test-db shared-fixture inventory — blast radius, teardown gaps, and options

**Recorded 2026-09-13.** Requested as a research pass after a same-day incident: 32
spurious failures in one suite run, a ~14-minute investigation, two sessions blocked on
each other, and orphaned rows that made the *next* run fail on FK violations until
teardowns happened to clear them. This document is the inventory that pass produced —
it builds on, and does not re-derive, `docs/reviews/test-db-reliability-workstream.md`
and `docs/reviews/test-fixture-lifecycle-flake.md`, both of which should be read first
for the concurrency-collision mechanism itself (confirmed, timestamp-pinned, five
instances — see "The cost curve" below). This document's own contribution is the
**identifier inventory**, the **blast-radius count**, and — new, not in either linked
doc — **the 4c finding**: `removeTwoTenantFixtures()` has no FK-sweep coverage at all,
the same shape of bug that caused the 2026-09-05 16-file cascade, just for a different
parent object.

**Status as of this doc: 4c AND its morning-fixture twin are both closed** — see
`scripts/shared-fixture-fk-coverage.json`, the widened Rule 9 in
`scripts/lint-migrations.mjs`, `removeTwoTenantFixtures()` in `test/helpers/db.ts`
(same commit as this document's first version), and `removeMorningFixtures()` in the
same file (added same-PR, 2026-09-13, once the identical latent gap was named rather
than left as a fast-follow — see the closing note at the end of §4). Sections 4a–4c
below describe the state as found, before either fix; the two "closed" notes at the
end of §4 record what changed, on both fixtures.

## 1. The full inventory of shared fixed identifiers

From `test/helpers/db.ts`:

| Constant | Value | Scope |
|---|---|---|
| `TEST_TENANT_ID` | `00000000-0000-4000-a000-00000000d013` | morning/evening/session-transition shared tenant |
| `TEST_PROJECT_ID` | `00000000-0000-4000-a000-00000000f014` | shared project under that tenant |
| `TEST_ENGINEER_PHONE` | `+19995550200` | shared engineer's WhatsApp number (drives the generated `users.id`) |
| `TEST_PHONE_PREFIX` | `+19995550` | shared fake-NANP phone space; sub-slots hand-registered in `db.ts`'s own comment block (`101–105, 190, 200–299, 301–327, 401–432, 501–506, 600, 690–694, 701, 801–816, 900–901, 999`) — **corrected 2026-09-13, during the per-run-identifier design pass: 98 distinct `testPhone('NNN')` values are actually in live use, checked directly (`grep -rohE "testPhone\('[0-9]+'\)" test/ | sort -u | wc -l`), not "~40" as this line originally said. That "~40" was the compressed *range* list in the comment block, never a literal count of distinct slot values — a different question, answered wrong here.** |
| `TEST_TENANT_A_ID` / `TEST_TENANT_B_ID` | `...0007a0` / `...0007b0` | migration-007 two-tenant RLS harness |
| `TEST_PROJECT_A_ID` / `TEST_PROJECT_B_ID` | `...0007a1` / `...0007b1` | projects under those tenants |
| `TEST_007_USER_A_EMAIL` / `_B_EMAIL` / `TEST_007_PASSWORD` | fixed strings | throwaway auth users signed in for JWT-scoped RLS tests |

From `test/helpers/outbound-fixtures.ts` (a second, separate namespace, added 2026-08-28):

| Constant | Value |
|---|---|
| `OUTBOUND_TEST_TENANT_ID` | `00000000-0000-4000-a000-000000031000` |
| `OUTBOUND_TEST_PROJECT_ID` | `00000000-0000-4000-a000-000000031001` |
| phone range `+19995551NNNNNN` | reserved wholesale, 6-digit random suffix inside it |

Every one of these is a fixed literal, `upsert`-written with `onConflict: 'id'` — every
run writes the *same* row, not a fresh one. The other four `test/helpers/*.ts` files
(`morning-mirror-cases.ts`, `section-42-corpus.ts`, `write-boundary-distinctness.ts`,
`yesno-corpus.ts`) are pure in-memory test-data corpora with no DB identifiers — not
part of this problem, listed here only to rule them out.

**Note on an existing count discrepancy.** `ci-test-isolation-options.md` already
records that its own external-reviewer grep for `TEST_TENANT_ID|ensureTestTenant`
found 9 files where an earlier pass (`test-db-reliability-workstream.md`'s K3) found
"at least 12" against a broader UUID-namespace pattern — and flags, correctly, that
these may be two different, both-valid answers to two different questions rather than
a contradiction to resolve. The counts in §2 below are pinned against the *exact* file
list (not just a count), per that document's own recommendation, specifically so this
doesn't become a third disagreeing number.

## 2. Blast radius

Grepped every `test/*.test.ts` for each constant/lifecycle call above:

- **32 of 84 test files (38%)** touch at least one shared, fixed identifier.
- `ensureMorningFixtures`/`removeMorningFixtures` (`TEST_TENANT_ID`/`TEST_PROJECT_ID`): **18 files**.
- `ensureTwoTenantFixtures`/`removeTwoTenantFixtures` (the A/B pair): **10 files**.
- `testPhone()`/the phone-prefix space directly: **14 files**.
- The outbound suite's own dedicated tenant/project: **3 files** (`outbound-trigger`, `outbound-coverage-sweep`, `status-callback`).

(32 happens to match today's failure count — noted as a coincidence worth flagging, not
asserted as the same 32 files, since this document doesn't have today's actual failure
list to compare against.)

**Correction, 2026-09-13, same day, during the morning-fixture twin fix.** The "18
files" above was wrong twice over, checked directly rather than re-guessed. The
original grep for this document actually returned 19 files, not 18 — a plain
miscounting of that list when it was first written down here, not a missed file. Since
then, a 20th file (`test/dpr-stage1-plumbing.test.ts`, added 2026-09-11 — before this
document existed, so genuinely missed by the original grep, not new churn) also matched
when the same grep was re-run to scope the twin fix below. **Current, re-verified
count: 20 files.** The total 32/84 and the other three category counts above were not
re-checked against this same drift and may also be off — this correction covers only
the number actually re-verified, per this project's own "verify a number before writing
it down" convention, not a claim the rest are still accurate.

Full file list (any shared identifier):
```
daily-log-correction-rpc.test.ts       migration-023.test.ts
daily-log-detail-query.test.ts         morning-flow.test.ts
dash-03-board.test.ts                  outbound-coverage-sweep.test.ts
dispatch.test.ts                       outbound-trigger.test.ts
dpr-detail.test.ts                     owner-confirm-email.test.ts
dpr-generate-job.test.ts               owner-deliver-job.test.ts
dpr-generate-trigger.test.ts           owner-send-trigger.test.ts
evening-flow.test.ts                   reactivation-db.test.ts
inbound-start.test.ts                  section-42-row-readback.test.ts
migration-007.test.ts                  section-42-write-boundary-distinctness.test.ts
migration-015.test.ts                  session-transition.test.ts
migration-016.test.ts                  status-callback.test.ts
migration-017.test.ts                  unit/checkin-escalations-sweep.test.ts
migration-019.test.ts                  unit/morning-cutoff-sweep.test.ts
migration-020.test.ts                  unit/morning-flow-mirror.test.ts
                                        unit/project-resolution.test.ts
                                        webhook.test.ts
```

## 3. Existing randomised-fixture patterns — two, and neither is a clean isolation model

**Pattern A — random leaf, shared parent (4 files: `dpr-generate-job`,
`dpr-generate-trigger`, `owner-deliver-job`, `owner-send-trigger`).** Each has its own
`makeProject(nameSuffix)` that `.insert()`s a project with a DB-generated id under the
**shared `TEST_TENANT_ID`**. This kills project-level UNIQUE-constraint collisions
between concurrent runs, but does **not** remove the shared identifier — every one of
these files still calls `ensureMorningFixtures()`/`removeMorningFixtures()` for the
shared engineer, and `dpr-generate-trigger.test.ts` documents exactly why it can't
escape further: the code under test (`runDprGenerateTrigger`) scans *all active
projects tenant-wide*, so `TEST_PROJECT_ID` is a live participant in every run whether
the test wants it or not (its own `afterEach` cleans jobs/dprs against
`TEST_PROJECT_ID` specifically, because of this).

**Pattern B — random row, dedicated shared parent (3 files, `outbound-fixtures.ts`).**
`mintOutboundEngineer()` inserts a `users` row with a genuinely random
`whatsapp_number` (retried on collision) under a **still-fixed**
`OUTBOUND_TEST_TENANT_ID`/`OUTBOUND_TEST_PROJECT_ID`. Worth generalising for the
*leaf-object* half of the problem, but it exists because `outbound_sends` has
`RESTRICT` FKs and no `DELETE` grant (`docs/reviews/outbound-sends-test-accretion.md`)
— minting-not-reusing was forced by a different constraint, not designed as a
concurrency fix. It still leaves the shared tenant/project pair as a single point of
collision between two concurrent runs of *that* suite.

No file in the repo has eliminated a fixed shared identifier end-to-end. Both patterns
randomise the child and leave a fixed parent standing — real precedent for option (a)
in §5, not evidence the problem is already solved.

## 4. The teardown problem — three distinct things, not one

Read `removeMorningFixtures()` and `removeTwoTenantFixtures()` in full
(`test/helpers/db.ts`), plus the lint rule meant to guard them
(`scripts/lint-migrations.mjs` Rule 9), before writing this section.

### 4a — the `daily_logs`-blocks-`users`/`tenants` ordering bug (closed)

This exact shape (an FK violation deleting a shared fixture while another table still
referenced it) already happened once, on 2026-09-05
(`docs/reviews/admin-merge-retrospective-2026-09-05.md`, "Fix 1" / PR #197), and was
root-caused as a **pure completeness bug, independent of concurrency**:
`removeMorningFixtures()` deleted `users`/`tenants` without first clearing every other
table with a non-cascading FK into them. The fix — `sweepSharedFixtureReferences()` +
`scripts/shared-fixture-fk-coverage.json` — is **lint-enforced with no exceptions
mechanism** (Rule 9: any migration adding a non-cascade FK into `users(id)`/
`tenants(id)` fails CI unless the coverage file is updated). This part is closed.

### 4b — a residual race the coverage-list fix cannot close

`cleanupTestDailyLogs()`/`sweepSharedFixtureReferences()` and the parent delete that
follows are **separate, sequential, non-transactional** PostgREST calls, not one atomic
statement. Nothing stops a second concurrent writer inserting a fresh `daily_logs` row
against `TEST_PROJECT_ID` in the gap between "sweep" and "delete the project." A
coverage list can only clear what exists *at the moment it runs* — it cannot prevent a
write that arrives milliseconds later from a different process. Concurrency-shaped, and
a different bug from 4a even though it would print the identical error message. Not
addressed by anything in this document or its accompanying fix — it needs an isolation
option from §5, not a completeness fix.

### 4c — `removeTwoTenantFixtures()` has NO FK sweep (the new finding)

Stated plainly, since this is the one that bites next: **`removeTwoTenantFixtures()`
has no FK-sweep coverage at all.** It deletes `project_members` → `projects` → `users`
→ auth users → `tenants` with plain `.in('tenant_id', ...)`/`.in('id', ...)` filters and
never calls `sweepSharedFixtureReferences()`. This is invisible from either linked doc —
neither mentions this function — and was found by direct code-reading, not inference.

Two compounding facts make this a real, not theoretical, gap:

- **Lint Rule 9's regex is hardcoded to `REFERENCES\s+(users|tenants)`** — it has *zero*
  coverage for `projects(id)`. A migration adding a non-cascading FK into `projects(id)`
  today passes CI silently; the users/tenants case cannot.
- **Three tables carry non-cascading FKs into `projects(id)` that this project's tests
  actually seed under the A/B fixture**: `daily_logs.project_id`,
  `daily_log_edits.project_id`, `dprs.project_id` (all `NOT NULL`, confirmed in
  `001_core_schema.sql`, `019_daily_log_corrections.sql`, `023_dpr_reports.sql`). Six
  test files seed rows against these under `TEST_PROJECT_A_ID`/`B_ID`
  (`daily-log-correction-rpc`, `daily-log-detail-query`, `dash-03-board`, `dpr-detail`,
  `migration-017`, `migration-019`, `migration-023` — seven, not six, once
  `migration-017` is counted alongside the six already known) and **clean up by
  convention only** — nobody is forced to. `dash-03-board.test.ts` even has the
  hand-written comment acknowledging it: *"daily_logs is not swept by
  removeTwoTenantFixtures — clear it first (FK)."*

**This is the same shape as the bug that caused the 2026-09-05 16-file cascade** — a
shared-fixture teardown deleting a parent row while an uncovered child table still
references it — just for `projects(id)` instead of `users(id)`/`tenants(id)`, and
currently prevented only by every author so far remembering the convention, not by
anything mechanical.

**A wider, exhaustive scan** (same regex logic as Rule 9, widened to `projects` and run
against every migration in `supabase/migrations/` and every held migration in
`docs/reviews/`) turned up eight tables total with a non-cascading FK into `projects(id)`,
not three — the other five (`safety_incidents`, `invoices`, `hindrances`,
`vendor_invoices`, `ra_bills`, plus nullable `boq_sessions`) are Phase-2/Fast-Follow
tables, mostly unseeded, except `hindrances`/`invoices`/`safety_incidents`, which
`migration-016.test.ts` *does* seed under `TEST_PROJECT_ID` (the morning fixture, not
the A/B one) — and already cleans up by hand in its own `afterEach`, before
`removeMorningFixtures()` runs. `outbound_sends.project_id` is also non-cascading but
is a composite FK the outbound suite's own dedicated `OUTBOUND_TEST_PROJECT_ID` never
collides with (same reasoning as its existing `tenant_id`/`recipient_user_id` entries
in the coverage file).

**4c — closed, this commit.** `removeTwoTenantFixtures()` now sweeps every
`projects`-parent coverage entry for `TEST_PROJECT_A_ID`/`TEST_PROJECT_B_ID` before
deleting those rows, the same mechanism `removeMorningFixtures()` already uses for
`users`/`tenants`. Rule 9's regex now covers `users|tenants|projects`, and the coverage
file carries all ten `projects`-parent entries this scan found. The six test files'
manual cleanup was left in place deliberately — belt and braces, per the same
convention `removeMorningFixtures()` already relies on for `daily_logs` via
`cleanupTestDailyLogs()`.

**The morning-fixture twin — also closed, same PR, 2026-09-13.** `removeMorningFixtures()`
had the *identical* latent gap for `TEST_PROJECT_ID` — its own `projects` delete
(`db.ts:391`) was preceded only by `cleanupTestDailyLogs()` (which covers `daily_logs`
alone), not by any sweep of `hindrances`/`invoices`/`safety_incidents`/`dprs`/
`daily_log_edits`. It hadn't bitten yet only because every current file seeding those
tables under `TEST_PROJECT_ID` (`migration-016.test.ts`, `dpr-generate-trigger.test.ts`,
and siblings) happens to clean up by hand first — the same convention-only protection
as 4c, just never triggered, on the *more* heavily used fixture (20 files vs. 10, per
the corrected count in §2). Initially left as a fast-follow when 4c shipped; closed in
the same PR before merge rather than shipped as documented, un-owned debt — exactly the
"recorded, judged non-urgent, eventually surfaces live" pattern this document's own
cost-curve section quotes. `sweepSharedFixtureReferences('projects', TEST_PROJECT_ID)`
now runs before the `projects` delete in `removeMorningFixtures()` too, using the same
coverage entries 4c already added (fixture-agnostic — no new entries were needed).
`cleanupTestDailyLogs()` and every affected file's own manual cleanup are left in place,
unchanged, same belt-and-braces treatment as 4c.

Verified: full suite re-run clean (1103 passed / 1 failed — the same pre-existing
`session-transition.test.ts` lock-wait flake, unrelated, reproduces identically to the
4c run). Targeted re-run of all 20 morning-fixture files: 20/20 files, 218/218 tests
green.

## 5. Options, with costs

Building on `ci-test-isolation-options.md` (J7b), which already ruled out Supabase
branching (blocked: `403` + the unresolved fresh-branch `auth_id` defect,
`CLAUDE.md`'s "REHEARSE ON A CLEANED EXISTING BRANCH" rule) and already recommended its
own Option 1:

**(a) Per-run randomised UUIDs for the fixed identifiers.** Bounded effort — 18–19
files touch the constants directly, plus the 98-slot phone registry. Fixes CI-vs-CI and
CI-vs-local collisions on *row identity*. Does not fix connection/lock-level contention
(the still-unexplained "TEST-DB INCIDENT #4" `ensureMorningEngineer` "no row returned"
symptom is session/connection-level per the existing docs). Does not fix 4c on its own —
a projects-parent coverage gap is still a gap even with random IDs, unless the fix is
symmetric.

**Correction, 2026-09-13, from the follow-on design pass
(`docs/reviews/test-db-per-run-fixture-identifiers.md`).** The line above originally
claimed random-per-run "removes the need for the [phone] registry entirely, a genuine
simplification." **That is wrong, checked directly rather than re-asserted.** The
registry protects against two different things this claim conflated: intra-run/
intra-codebase slot coordination (two files in the same checkout picking the same
3-digit slot — the registry's actual, permanent job, untouched by per-run
randomisation) and cross-run collision (two separate process invocations both hardcoding
the same fixed value — the one thing randomisation actually closes). The registry stays;
only the cross-run axis closes, via a run-scoped prefix nested on top of the existing
scheme, not full replacement. Full detail and the reasoning against fully randomising
every mint independently: the design doc's decision 3 — **corrected there, 2026-09-13,
during batch 2: `whatsapp_sessions.phone_number` DOES carry a `UNIQUE` index
(`uq_whatsapp_sessions_phone_number`, migration 012), found live; this document's
original "no UNIQUE constraint exists" claim (checked only against 001's original
`CREATE TABLE`) was incomplete. The registry still stays for the reason argued
correctly elsewhere in that decision (intra-run coordination, not collision detection)
— only the detection-gap argument is retracted.**

**Also recorded there, not reproduced in full here:** a structural limit on option (a)
found during the design pass — four production queries scan every active project with
no tenant filter at all (`runDprGenerateTrigger`, `runOwnerSendTrigger`,
`runCheckinEscalationTickSweep`, `fetchActiveProjects`), and three test files exercise
them against real test-db. Randomising identifiers cannot isolate those three files,
because the scans have no tenant boundary to randomise against — only full database
isolation (option (b)) removes the shared table. Accepted as a known, permanent limit
of this option, not something the per-run-identifier migration will fix.

**(b) Per-run database/schema isolation (ephemeral Postgres from the structure-only
dump).** Already scoped as J7b's own Option 1 and recommended there. Reuses the §7
dry-run pipeline (`supabase db dump --linked --schema public --dry-run`) this project
already has to keep current for migration rehearsals. Removes both CI-vs-CI and
CI-vs-local axes structurally. Named costs: fidelity gap vs. a real incrementally-
migrated database (won't reproduce fresh-branch `auth_id`-class defects), Postgres
major-version pinning discipline (burned once already at PG16 vs PG17.6). Does not
reach a human/agent choosing to run a script directly against real test-db — a
structurally different axis, and the one the confirmed incidents below actually are.

**(c) A serialization lock.** Cheapest; the natural extension of the
`ci-test-db-suite` concurrency group that already closes CI-vs-CI (`vitest.config.ts:29`
`fileParallelism: false`; `ci.yml`'s concurrency block). Does nothing for a writer who
doesn't know to take the lock — which is exactly what every confirmed CI-vs-developer
collision below actually was.

**(d) Leave it, coordinate manually.** Today's cost is the data point.

**Recommendation:** (b) for the CI-vs-CI and CI-vs-fresh-invocation axis — it reuses
infrastructure this project's own rules already require it to maintain — **plus** (a),
which is still needed regardless of (b) specifically to close 4b, because a
fresh-per-CI-run database does nothing for a developer/agent running locally against
real test-db, which is what the cost curve below shows actually recurs. (c) is a cheap
stopgap for local/agent writers specifically, since (b) can't reach them and (a) is the
larger migration. (d) is not viable given the cost curve.

## 6. Accretion and dangling-session findings

**The ~1,000 accumulated `users` rows are the same, already-diagnosed, already-accepted
mechanism — not new debt.** `docs/reviews/outbound-sends-test-accretion.md` measured 35
accumulated `users` rows on 2026-08-28 from `mintOutboundEngineer()`.
`cleanupOutboundSends()` (added 2026-09-05, the retrospective's "Fix 2") deletes
`outbound_sends` rows by `project_id` in every suite's `afterAll` — but never deletes
the minted `users` rows themselves. Each of the 3 outbound files mints 4 new
random-phone `users` rows per run, permanently, **by explicit design**
(`outbound-trigger.test.ts`'s own header: *"cleanup is deliberately not a code path"*;
`CLAUDE.md`'s "ACCRETION, NAMED AND ACCEPTED" framing). Growing from 35 to ~1,000 over
roughly two and a half weeks of runs is consistent with that same unbounded-by-design
rate continuing, not a new bug. Same conclusion as before this pass: **unrelated to the
fixed-UUID collision problem in §1–5**, a distinct, already-scoped debt item.

**The 98 dangling `whatsapp_sessions.user_id` rows are already recorded, in more
detail than this pass could add** — `docs/reviews/whatsapp-sessions-dangling-user-id.md`
(2026-09-12, one day before this pass) confirms the number live against test-db and
narrows it further than a code-only read could: a real `RESTRICT` FK exists
(`001_core_schema.sql:90`), the coverage file already lists `whatsapp_sessions.user_id`
with action `"null"` — but that entry's own note (*"not currently populated by any test
fixture"*) is stale, contradicted by `acquire_and_transition_session` writing this
column on every real turn since migration 012. The genuine orphaning mechanism (how a
`RESTRICT` FK allowed this at all) is recorded there as **open, not resolved** — worth
noting for whoever picks that up: `removeTwoTenantFixtures()`'s bulk
`.in('tenant_id', ...)` delete of `users` (pre-4c-fix and still true post-fix, since 4c
only touched the `projects`-parent path) never goes through
`sweepSharedFixtureReferences()` at all for the `users`-parent case either — a plausible
*contributing* structural gap, not a confirmed mechanism, and explicitly not
investigated or touched by this document or its accompanying fix.

## The cost curve

`test-db-reliability-workstream.md`'s own running count reached **"Fifth confirmed
instance of the CI-vs-developer/agent contention axis"** before today — two of those
five are timestamp-pinned, concrete confirmations (the original K2 live catch during a
migration-029 rehearsal, and "Instance 5," a local `vitest run` overlapping a real CI
run down to the second, both directions failing with the identical FK-violation
signature). Add the 2026-09-05 16-file cascade (4a, closed) and today's 32-failure
incident (the trigger for this document), and the pattern the retrospective doc itself
already named applies exactly:

> "recorded, judged non-urgent, no owner, no trigger to revisit, eventually surfaces live"

Three items were already cited under that phrase in
`docs/reviews/admin-merge-retrospective-2026-09-05.md` (`cleanupTestDailyLogs()`'s
narrow scope sitting six weeks before causing 4a; the escalation sweep; the `jobs`
table's unbounded growth) before 4c became a fourth instance of the identical shape,
found the same way — recorded, not urgent, no lint coverage, no trigger to revisit,
until this pass looked for it directly.
