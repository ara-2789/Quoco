# Migration 021 — index hygiene + claim-poll index — review package

Index-only migration. Three changes: one replacement (a partial index the
production query provably cannot use) and two drops (indexes that duplicate an
index already created by a constraint). Zero data mutation. Exact-inverse DOWN.

**NO EXTERNAL-REVIEWER GATE** — agreed with the owner on the **018** precedent
("Feature-class, trivially reversible — NO external-reviewer gate"). 021 is
weaker still than 018: no function bodies, no DDL on tables, no ACL change, no
row touched. The justification is empirical rather than argued — see §2/§3.
(Note: the precedent is 018, not 019. 019 went through three reviewer rounds and
is not the applicable precedent.)

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts are pinned to source, never paraphrased.

| Artifact | Pin |
|---|---|
| Migration file | `git show 19b1e39:supabase/migrations/021_index_hygiene.sql` |
| `sha256` of that file | `bcf16a2436a6f36841264b6cdc574b992e1f1303774d2814f8946011acf83802` |
| Commit | `19b1e39204625bb80d807556984298c14eb34b01` |
| Branch | `feat/021-index-hygiene` |
| Unit test | `test/unit/jobs-claim-index.test.ts` (same commit) |
| Suite run | 169/169, SHA echoed + empty `git status --porcelain` (§8) |
| Types gate | zero diff, byte-identical `sha256 e48cfb04…59ef` (§9) |

> **RAW-CAPTURE STATUS (read before signing this off).** The rehearsal was
> executed by the owner in the Supabase SQL Editor; the assistant that drafted
> this package never had planner access (no PostgREST plan endpoint on either
> project, no `psql`, no DB password — see §2.0). Every measured value below is
> as **reported** by the owner during the step-by-step rehearsal. Per §0
> ("pinned, not paraphrased"), the reported values are NOT a substitute for the
> frames: each evidence block marked `PASTE RAW CAPTURE` must have the literal
> SQL Editor output pasted in before this package is considered complete. The
> numbers are stated alongside so a paste that disagrees is immediately visible.

---

## Environment matrix

| | Project ref | State |
|---|---|---|
| **prod** | `jvxwqignooseazzmwhvl` | 021 **NOT APPLIED** as of this package |
| **test-db** | `exfccwlrhoutkgrlikod` | 021 applied + rehearsed + seed cleaned |

Rehearsed on the **cleaned existing test-db**, not a fresh Supabase branch, per
the CLAUDE.md §0 conditional rule (fresh provisions were observed to come up
missing `users.auth_id`; see `docs/reviews/supabase-fresh-branch-auth-id-bug.md`).
That rule is still in force — it lapses only when a fresh provision is observed
to come up with the column present.

---

## 1. The three changes

```sql
DROP INDEX IF EXISTS idx_jobs_poll;

CREATE INDEX idx_jobs_claim ON public.jobs (next_retry_at)
  WHERE status IN ('pending', 'failed') AND attempt_count < 5;

DROP INDEX IF EXISTS idx_processed_messages_sid;

DROP INDEX IF EXISTS idx_whatsapp_sessions_phone_number;
```

Four statements inside one `BEGIN…COMMIT`. Everything else in the file is
comment; the DOWN block is commented out, so a full-file paste runs only the UP.

**1a. `idx_jobs_poll` → `idx_jobs_claim`** (the defect fix — §2, §3)
**1b. `idx_processed_messages_sid`** duplicates the index created by
`message_sid TEXT NOT NULL UNIQUE` (011:11). `isNewMessage`
(`lib/whatsapp/idempotency.ts:15-27`) never SELECTs — it inserts and catches
`23505`, raised by the **constraint**, whose index is untouched. Highest-frequency
INSERT path in the system.
**1c. `idx_whatsapp_sessions_phone_number`** (003:49, plain) superseded by
`uq_whatsapp_sessions_phone_number` (012:34, UNIQUE) on the same column. The
UNIQUE index backs `ON CONFLICT (phone_number)` in 012/013/014/018 and is
**not** touched — §7 asserts its survival.

---

## 2. Prove-open — the defect, observed

### 2.0 Why this section exists

The defect was originally identified by **static predicate comparison**, and the
audit that found it flagged that as insufficient under §0. Three access paths to
a planner were tried and all failed: PostgREST's plan endpoint (`PGRST107`,
disabled on **both** projects), `psql` (not installed), and a DB connection
string (absent from `.env.local`, `.env.test`, `~/.supabase`). The rehearsal
below is how the inference was converted into an observation — and it was run as
a **hard gate**: had 2b shown an index scan, 021 would have been redesigned
rather than applied.

### 2.1 The mismatch

`idx_jobs_poll` (006:17): `(status, next_retry_at) WHERE status IN ('pending','running')`

`claimJobs` (`lib/queue/jobs.ts:70-77`, `MAX_ATTEMPTS = 5` at :26):

```sql
SELECT * FROM jobs
WHERE status IN ('pending','failed')
  AND next_retry_at <= now()
  AND attempt_count < 5
ORDER BY next_retry_at ASC
LIMIT 3;
```

A partial index is usable only when the query predicate **implies** the index
predicate. `status IN ('pending','failed')` does not imply
`status IN ('pending','running')` — `'failed'` rows are absent from the index, so
scanning it would return wrong results. Postgres can decompose the `IN` into `OR`
branches and BitmapOr them, and the `status='pending'` branch *would* qualify, but
the `status='failed'` branch has no usable index; Postgres will not mix an index
path with a seq-scan path in a BitmapOr, so the whole node degrades to a Seq Scan.

That scan runs **every 60 seconds forever** (`vercel.json` cron `* * * * *`) over
a table with no pruning mechanism.

### 2.2 Seed (test-db)

200,000 rows via `generate_series`, marked `type = 'zz_explain_probe'`
(`jobs.type` has no CHECK — 006:7 — so the marker inserts cleanly and makes
cleanup exact). Pre-seed `count(*)` = 0.

| status | attempt_count | rows | role |
|---|---:|---:|---|
| `succeeded` | 1 | 180,000 | the accumulation nothing prunes |
| `failed` | 5 | 15,000 | dead-letter, permanent (NFR-17) |
| `failed` | 2 | 4,990 | retryable |
| `pending` | 0 | 10 | live work |

`next_retry_at` is **deliberately non-uniform**: dead-letter ~30 days past,
retryable ~1 hour past, pending ~5 minutes past. That ordering is what makes §4.2
measurable — under uniform timestamps the dead-letter distinction is invisible.
`ANALYZE jobs` run before any EXPLAIN.

```
PASTE RAW CAPTURE — seed verification (GROUP BY status, attempt_count)
Reported: 4 rows exactly as tabulated above; total 200,000.
```

### 2.3 BEFORE plan — THE GATE

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM jobs
WHERE status IN ('pending','failed')
  AND next_retry_at <= now()
  AND attempt_count < 5
ORDER BY next_retry_at ASC
LIMIT 3;
```

```
PASTE RAW CAPTURE — BEFORE plan
Reported: Parallel Seq Scan on jobs
          Rows Removed by Filter ≈ 97,500/worker (the ~195,000 non-matching rows)
          Buffers: shared hit=2877 (full heap read)
          Sort node present (no index serving ORDER BY)
          Execution Time: 50.549 ms
```

### 2.4 BEFORE — real-execution corroboration

`EXPLAIN` shows what the planner *would* choose for one statement. This shows
what it *did* choose, ten times, via a `DO` block executing the production query
in a loop, with `pg_stat_user_indexes` read either side.

```
PASTE RAW CAPTURE — pg_stat_user_indexes before/after the 10× loop
Reported: idx_jobs_poll.idx_scan = 0, unchanged across 10 real executions.
```

**`idx_scan = 0` is stronger than "unmoved"** — the index built for this query has
never been used in its lifetime on test-db.

---

## 3. Prove-closed — the fix, measured

### 3.1 AFTER plan (identical query text — paired frame)

```
PASTE RAW CAPTURE — AFTER plan
Reported: Index Scan using idx_jobs_claim on jobs
          Index Cond only — NO Filter: line at all
          No Sort node
          No parallelism (no Gather / Workers Planned)
          Buffers: shared hit=1 read=2  (3 total)
          Execution Time: 0.149 ms
```

| | BEFORE | AFTER | Δ |
|---|---:|---:|---:|
| Scan node | Parallel Seq Scan | Index Scan | — |
| Buffers | 2,877 | 3 | **959× fewer** |
| Execution time | 50.549 ms | 0.149 ms | **~340×** |
| Sort node | present | absent | eliminated |

The absent `Filter:` line is the substantive detail: because `status` and
`attempt_count` live in the index **predicate**, Postgres treats every entry as
already qualifying and re-checks nothing. Only `Index Cond: (next_retry_at <= now())`
remains.

### 3.2 AFTER — real-execution corroboration

```
PASTE RAW CAPTURE — pg_stat_user_indexes after the 10× loop
Reported: idx_jobs_claim.idx_scan 1 → 11 (clean +10).
```

Paired against §2.4 — where `idx_jobs_poll` sat at 0 through ten identical
executions — this is the before/after stated as observed behaviour, not planner
intent.

### 3.3 Index size

```
PASTE RAW CAPTURE — pg_relation_size per index on jobs
Reported: idx_jobs_claim   56 kB
          idx_jobs_type  9,728 kB
          jobs_pkey      8,232 kB
```

Noted for the record, not acted on: `idx_jobs_type` is ~174× the size of the
index that does the actual work and still has **zero readers** (nothing queries
`jobs` by `type`). Its deferral is deliberate (§6) — this measurement is evidence
for revisiting it, not for widening 021.

---

## 4. Design record — why not the obvious fix

The obvious fix is widening the predicate to
`WHERE status IN ('pending','failed','running')`. It was **rejected**, for two
reasons. This section exists so the rejection is on the record rather than
re-derived later.

### 4.1 Column order

Leading with `status` (2-3 distinct values, effectively no selectivity) cannot
serve `ORDER BY next_retry_at` across multiple statuses without a sort. Leading
with `next_retry_at` lets **one** index scan serve the range filter, the ORDER BY
and the LIMIT — the walk stops after 3 rows. §3.1's absent Sort node is that
choice, measured.

### 4.2 The dead-letter trap — the deciding reason

`failJob` (`jobs.ts:148-158`) leaves an exhausted job at `status='failed'`,
`attempt_count=5`, `next_retry_at=<moment of death>`. Those rows are permanent by
design (NFR-17) and nothing deletes them. They satisfy `status` +
`next_retry_at <= now()` **forever**, and their past `next_retry_at` sorts them to
the **front** of an ascending scan.

So a status-only predicate would make every poll walk the entire accumulated
dead-letter set before reaching live work — **the same linear degradation in
better camouflage**: the planner would use the index, and it would slow down on
every permanent failure. Measured:

```
PASTE RAW CAPTURE — entries_if_status_only vs entries_as_shipped
Reported: 20,000  vs  5,000
```

15,000 permanently-dead rows excluded from the index by putting `attempt_count`
in the predicate rather than leaving it to a runtime filter.

### 4.3 The coupling this introduces, and its mitigation

Putting `attempt_count < 5` in the predicate couples the migration to a
TypeScript constant. If `MAX_ATTEMPTS` moves and the predicate does not, the
query predicate stops implying the index predicate and the index **silently**
becomes unusable — with no error, no failing behaviour, and no symptom until the
table is large.

Mitigated by two independent gates that must agree (the 019 duplicated
CHECK/CASE discipline), each commenting the other:

1. the load-bearing comment in `021_index_hygiene.sql`
2. `test/unit/jobs-claim-index.test.ts`, which parses both files and fails on
   drift (§8)

The alternative that removes the coupling entirely — a distinct terminal status
for exhausted jobs, so the predicate needs no integer — changes the `status`
CHECK and NFR-17 semantics, and is therefore **deliberately out of scope** for an
index-only migration. Recorded as the better long-term shape, to revisit when
dead-letter Sentry alerting is built.

---

## 5. Negative controls — the coupling is real, and the index is not broken

Three plans, same session, same data, same statistics; only the predicate text
varies.

```
PASTE RAW CAPTURE — 5a: attempt_count < 7 (MAX_ATTEMPTS drift)
Reported: Parallel Seq Scan, 2877 buffers, 49.036 ms
```

```
PASTE RAW CAPTURE — 5b: status IN ('pending','failed','running') (status drift)
Reported: Seq Scan, 2877 buffers, 52.144 ms
```

```
PASTE RAW CAPTURE — 5c: CONTROL, unmodified production query
Reported: Index Scan using idx_jobs_claim, buffers=3, 0.123 ms
```

5a is the `MAX_ATTEMPTS` drift scenario made concrete. 5b is the scenario where a
future author builds the stale-claim sweep for orphaned `running` jobs (§6) by
extending `claimJobs` instead of giving the sweep its own index. **5c is the
methodological control** — without it, 5a/5b would be ambiguous (a skeptic could
argue the index simply stopped working); with it, the only variable is the
predicate text, so the three frames demonstrate the *mechanism*, not just the
outcome.

---

## 6. Explicitly out of scope

Recorded so neither reads as an oversight.

**`idx_jobs_type` — DEFERRED, not dropped.** Non-partial, indexes every job
forever, 9,728 kB at 200k rows, and nothing queries by `type`. It is a genuine
growth liability, but it differs in kind from 021's three changes: those are
*provably redundant or provably unusable*, this one is merely *currently unused*,
and a jobs-by-type admin view is plausible. Dropping it is a product bet; 021
contains only provable facts. Owner decision, 2026-07-27.

**Orphaned `running` jobs — real latent bug, unrelated to indexing.** `claimJobs`
reads only `pending`/`failed`, so a worker dying between `status='running'`
(`jobs.ts:94`) and `completeJob`/`failJob` strands that job permanently. Nothing
re-claims it. bot-flows.md specifies a stale-claim reset for *DPR generation*
(DPR-23, >5 min → retry) but there is no equivalent for `jobs`. **021 drops the
only index that covered `'running'`** — not a regression (nothing queries it;
grep: written only), but a future stale-claim sweep must not assume an index
survives, and must not be built by widening `claimJobs` (§5b shows why).

**Retention.** 021 removes index overhead and **prunes nothing**. No retention
policy exists for any table. See the audit origin in CLAUDE.md §10.

---

## 7. Paired inventory probes

Identical query text before and after, so the frames are directly comparable:

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('jobs','processed_messages','whatsapp_sessions')
ORDER BY tablename, indexname;
```

**test-db BEFORE: 10 rows. test-db AFTER: 8 rows** (three dropped, one created).
Post-apply completeness check (FULL OUTER JOIN against the expected post-021
set): **8/8 `ok`**, nothing missing, nothing unexpected.

```
PASTE RAW CAPTURE — test-db before (10 rows)
PASTE RAW CAPTURE — test-db after (8 rows)
PASTE RAW CAPTURE — completeness check (8/8 ok)
```

### Safety assertions — the two indexes that must survive

| Index | Why it is load-bearing |
|---|---|
| `uq_whatsapp_sessions_phone_number` | backs `ON CONFLICT (phone_number)` in every session RPC; dropping it breaks the morning flow outright |
| `processed_messages_message_sid_key` | raises the `23505` that `isNewMessage` depends on; dropping it breaks webhook idempotency |

Both confirmed present post-apply on test-db. Both must be re-confirmed on prod
(§10 step D). The naming similarity between
`idx_whatsapp_sessions_phone_number` (dropped) and
`uq_whatsapp_sessions_phone_number` (kept) is the single likeliest fatal typo in
this migration; the unit test asserts no DROP statement names the `uq_` one.

### Cleanup

`DELETE FROM jobs WHERE type = 'zz_explain_probe'` → 200,000 removed;
`count(*)` back to **0**, matching the pre-seed baseline exactly.
`VACUUM ANALYZE jobs` clean. Post-cleanup index list identical to the after-frame
— cleanup touched only data.

```
PASTE RAW CAPTURE — post-cleanup count(*) = 0 and 8-row index list
```

### Reconciliation note (2026-07-27)

The first reading of the after-frame appeared to show a net −1 rather than the
expected −2. Reconciled: the expected complete set is **10**, and 10 − 3 + 1 = 8,
so the after-count was correct and the *baseline* reading was short by one row.
Cause: one row (`idx_processed_messages_sid`) was lost in chat rendering during
transcription, not absent from the database. Confirmed by the 8/8 completeness
check and by prod's own before-frame showing all three drop targets present with
definitions matching their migration files. **No schema drift.** Recorded because
the alternative explanation — a drop target genuinely missing on test-db — would
have meant the rehearsal never exercised that drop, and that distinction was
worth resolving before proceeding rather than after.

---

## 8. Test evidence

**Suite: 169/169 across 18 files**, on test-db at the post-021 schema.

```
=== PINNED SUITE RUN — migration 021 ===
commit:  19b1e39204625bb80d807556984298c14eb34b01
branch:  feat/021-index-hygiene
porcelain: ''  <- empty between quotes = clean tree
date:    2026-07-27T09:48:49Z UTC
sha256(021): bcf16a2436a6f36841264b6cdc574b992e1f1303774d2814f8946011acf83802
==========================================
 Test Files  18 passed (18)
      Tests  169 passed (169)
   Duration  181.29s
```

SHA + empty `--porcelain` together per the 017 round-2 rule: the SHA names the
commit, the porcelain line proves the working tree matched it. A dirty tree can
run code that differs from the named SHA.

**New unit test — `test/unit/jobs-claim-index.test.ts`, 8 tests.** Static source
assertions over both `021_index_hygiene.sql` and `lib/queue/jobs.ts` (the
technique `reactivate-copy.test.ts` established). It does **not** import
`MAX_ATTEMPTS` — the constant is module-private, and exporting it purely to serve
a test would widen the module surface for the guard's convenience. It strips `--`
comment lines before parsing, because the migration's own prose quotes the
predicate verbatim and a naive parse would match the explanation instead of the
statement.

Asserts: the predicate integer equals `MAX_ATTEMPTS`; `MAX_ATTEMPTS` is pinned at
5; every status in any `.in('status', [...])` filter appears in the predicate;
`'running'` does **not**; the index leads with `next_retry_at`; `idx_jobs_poll` is
dropped and not recreated; no DROP names `uq_whatsapp_sessions_phone_number`; and
the migration contains no data-mutating verb.

**The guard was verified to fail before it was shipped.** The predicate was
temporarily mutated to `attempt_count < 7` and the suite re-run: the coupling
assertion failed with `expected 7 to be 5` while the other seven passed; the file
was then restored and re-verified 8/8. A guard that has never been observed to
fail is not evidence.

---

## 9. Types regeneration gate

```
npx supabase gen types typescript --linked --schema public
diff types/database.ts <generated>   ->  exit 0
committed: 1835 lines, sha256 e48cfb0474c00cbda2eeef0c9a1124fbaab40c032812cb4300c813220ba759ef
generated: 1835 lines, sha256 e48cfb0474c00cbda2eeef0c9a1124fbaab40c032812cb4300c813220ba759ef
```

**Zero diff, byte-identical.** Indexes do not surface in generated types, so zero
is the expected result and any diff at all would mean something unintended
changed — the 018 precedent for using the regen as a confirmation gate rather
than a routine step.

Scope note: `--linked` targets **prod**, which has not had 021 applied, so this
run confirms the committed types match prod's *current* state. The post-apply
regen (§10 step F) is the equivalent gate for the apply itself and should also
return zero.

---

## 10. PROD apply — runbook (NOT YET EXECUTED)

Instance of `docs/migration-runbook-template.md`. Strict alternation; owner
confirms at each step. Point the SQL Editor at **prod** (`jvxwqignooseazzmwhvl`)
and confirm the project ref before any write step.

**A. PITR observation — NOT REQUIRED for this migration, and here is why.**
§0 requires observing the restore window before any migration whose rollback
*depends on a backup*. 021's does not: the DOWN block exactly reconstructs the
prior state, and no row is created, altered or deleted. Stated explicitly rather
than skipped silently, per §0's insistence that a record is not the thing.

**B. Pre-apply state probe (read-only) — ALREADY CAPTURED, 2026-07-27.**
Prod returned **10 rows**, with all three drop targets present and their
`indexdef` matching their migration-file definitions:

```
jobs,idx_jobs_poll,"CREATE INDEX idx_jobs_poll ON public.jobs USING btree (status, next_retry_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))"
processed_messages,idx_processed_messages_sid,CREATE INDEX idx_processed_messages_sid ON public.processed_messages USING btree (message_sid)
whatsapp_sessions,idx_whatsapp_sessions_phone_number,CREATE INDEX idx_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
```

PROCEED condition: all three present (met). Prod is **not** drifted on any of
them, so the apply exercises all three drops — the same paths the rehearsal
exercised.

**C. Apply (write).** Fresh tab. Full paste of the pinned body:
`git show 19b1e39:supabase/migrations/021_index_hygiene.sql | pbcopy`
(clipboard hash must equal `bcf16a24…f83802`). **Deselect before running** — a
stray highlight runs "only this". Single `BEGIN…COMMIT`.

Lock note: `DROP INDEX` takes `ACCESS EXCLUSIVE` briefly; `CREATE INDEX` takes
`SHARE` on `jobs` (blocks writes, allows reads). Prod row counts at audit time
were `jobs` 0, `processed_messages` 5, `whatsapp_sessions` 1 — microseconds.
Applying at this size is deliberate: at ~1M `processed_messages` rows the same
drop would stall webhook inserts and `CONCURRENTLY` (which forbids the
transaction wrapper) would become mandatory.

**D. Post-apply probes (read-only).** Re-run the §7 inventory query on prod and
pair it against step B. Assert: `idx_jobs_claim` present with `next_retry_at`
leading and `attempt_count < 5` in the predicate; the three targets absent;
**`uq_whatsapp_sessions_phone_number` and `processed_messages_message_sid_key`
both present**; `idx_jobs_type` and all three `*_pkey` untouched. Expect 8 rows.

**E. Ledger INSERT (write) + verify.**

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('021', 'index_hygiene', ARRAY[]::text[]);
```

Then `SELECT count(*)` — **observe the total before and after rather than
asserting a number** (§0). The CLI `migration repair` is 28P01-blocked for this
project and has never been executed; the manual INSERT is the real method, as
with 013-020.

**F. Post-apply types regen.** Re-run the §9 command against prod. Expect zero
diff again.

**G. schema.md.** Update the 021 entry from "pending" to applied — **only after E
confirms** — so no "applied" line is asserted before it is true.

**Optional, ~1 week post-apply.** Re-read `pg_stat_user_indexes` on prod and
confirm `idx_jobs_claim.idx_scan` is climbing. Prod has no job traffic yet (the
queue has no handlers), so this will read 0 until the first real job type ships —
that is expected, not a failure.

---

## 11. Summary

| | |
|---|---|
| Risk | Very low — index-only, zero data mutation, exact-inverse DOWN, no ACL/RLS/function change |
| Reversibility | Complete. DOWN block reconstructs the prior state exactly; no backup dependency |
| Evidence | Empirical: 340× measured, with negative controls and a methodological control |
| Blast radius if wrong | Two named indexes must survive (§7); both asserted pre- and post-apply, and by unit test |
| External reviewer | Not gated — 018 precedent, owner-agreed 2026-07-27 |
| Prod status | **NOT APPLIED.** Before-frame captured; runbook §10 ready to execute |
