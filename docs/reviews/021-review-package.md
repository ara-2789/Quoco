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

**RAW-CAPTURE STATUS: COMPLETE (2026-07-27).** Every evidence block below holds
the literal SQL Editor output captured during the rehearsal. The rehearsal was
executed by the owner; the assistant that drafted this package never had planner
access (no PostgREST plan endpoint on either project, no `psql`, no DB password
— see §2.0), so the frames were captured by the owner and pasted in verbatim.
Earlier drafts of this package carried placeholder blocks with the *reported*
values stated alongside; those placeholders are now replaced by the frames
themselves, per §0 ("pinned, not paraphrased"). No value below is a summary, a
reconstruction, or a paraphrase.

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
a **hard gate**: had 2.3 shown an index scan, 021 would have been redesigned
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

### 2.2 Pre-state (test-db)

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('jobs','processed_messages','whatsapp_sessions')
ORDER BY tablename, indexname;
```

```
tablename,indexname,indexdef
jobs,idx_jobs_poll,"CREATE INDEX idx_jobs_poll ON public.jobs USING btree (status, next_retry_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))"
jobs,idx_jobs_type,"CREATE INDEX idx_jobs_type ON public.jobs USING btree (type, created_at)"
jobs,jobs_pkey,CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id)
processed_messages,idx_processed_messages_sid,CREATE INDEX idx_processed_messages_sid ON public.processed_messages USING btree (message_sid)
processed_messages,processed_messages_message_sid_key,CREATE UNIQUE INDEX processed_messages_message_sid_key ON public.processed_messages USING btree (message_sid)
processed_messages,processed_messages_pkey,CREATE UNIQUE INDEX processed_messages_pkey ON public.processed_messages USING btree (id)
whatsapp_sessions,idx_whatsapp_sessions_phone_number,CREATE INDEX idx_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
whatsapp_sessions,idx_whatsapp_sessions_tenant_id,CREATE INDEX idx_whatsapp_sessions_tenant_id ON public.whatsapp_sessions USING btree (tenant_id)
whatsapp_sessions,uq_whatsapp_sessions_phone_number,CREATE UNIQUE INDEX uq_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
whatsapp_sessions,whatsapp_sessions_pkey,CREATE UNIQUE INDEX whatsapp_sessions_pkey ON public.whatsapp_sessions USING btree (id)
```

**10 rows.** All three drop targets present. `idx_jobs_poll`'s definition matches
006:17 exactly — test-db is not drifted, so the rehearsal exercises the same
paths the prod apply will.

### 2.3 Seed (test-db)

200,000 rows via `generate_series`, marked `type = 'zz_explain_probe'`
(`jobs.type` has no CHECK — 006:7 — so the marker inserts cleanly and makes
cleanup exact).

`next_retry_at` is **deliberately non-uniform**: dead-letter ~30 days past,
retryable ~1 hour past, pending ~5 minutes past. That ordering is what makes §4.2
measurable — under uniform timestamps the dead-letter distinction is invisible.
`ANALYZE jobs` run before any EXPLAIN.

```
jobs_rows_before
0

status,attempt_count,rows,oldest_due,newest_due
failed,2,4990,2026-07-27 07:49:07.614758+00,2026-07-27 07:49:07.614758+00
failed,5,15000,2026-06-27 08:49:08.614758+00,2026-06-27 12:59:07.614758+00
pending,0,10,2026-07-27 08:44:07.614758+00,2026-07-27 08:44:07.614758+00
succeeded,1,180000,2026-05-28 08:49:07.614758+00,2026-05-28 08:49:07.614758+00
```

Total 200,000; pre-seed count 0. The dead-letter band spans ~4.17 hours 30 days
back, matching `make_interval(secs => i - 180000)` over i = 180001…195000.

### 2.4 BEFORE plan — THE GATE

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
QUERY PLAN
Limit  (cost=6334.10..6334.44 rows=3 width=107) (actual time=40.657..50.050 rows=3 loops=1)
  Buffers: shared hit=2877
  ->  Gather Merge  (cost=6334.10..7598.87 rows=10998 width=107) (actual time=40.656..50.046 rows=3 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=2877
        ->  Sort  (cost=5334.09..5361.58 rows=10998 width=107) (actual time=35.275..35.276 rows=3 loops=2)
              Sort Key: next_retry_at
              Sort Method: top-N heapsort  Memory: 25kB
              Buffers: shared hit=2877
              Worker 0:  Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Seq Scan on jobs  (cost=0.00..5191.94 rows=10998 width=107) (actual time=33.319..34.556 rows=2500 loops=2)
                    Filter: ((status = ANY ('{pending,failed}'::text[])) AND (attempt_count < 5) AND (next_retry_at <= now()))
                    Rows Removed by Filter: 97500
                    Buffers: shared hit=2839
Planning:
  Buffers: shared hit=212
Planning Time: 1.237 ms
Execution Time: 50.549 ms
```

`Parallel Seq Scan on jobs`. `Rows Removed by Filter: 97500` per worker across 2
loops = 195,000 discarded to find 5,000. `Buffers: shared hit=2877` — the whole
heap. A `Sort` node is present because no index serves `ORDER BY next_retry_at`.
**Execution Time: 50.549 ms.**

### 2.5 BEFORE — real-execution corroboration

`EXPLAIN` shows what the planner *would* choose for one statement. This shows
what it *did* choose, ten times, via a `DO` block running the production query in
a loop, with `pg_stat_user_indexes` read either side.

```
BEFORE the 10× loop:
indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
idx_jobs_poll,0,0,0
idx_jobs_type,0,0,0
jobs_pkey,0,0,0

AFTER the 10× loop:
indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
idx_jobs_poll,0,0,0
idx_jobs_type,0,0,0
jobs_pkey,0,0,0
```

**`idx_jobs_poll.idx_scan = 0`, unchanged across ten real executions** — and 0 is
stronger than "unmoved": the index built for this query has never been used in
its lifetime on test-db.

---

## 3. Prove-closed — the fix, measured

### 3.1 Post-apply index list (test-db)

```
indexname,indexdef
idx_jobs_claim,"CREATE INDEX idx_jobs_claim ON public.jobs USING btree (next_retry_at) WHERE ((status = ANY (ARRAY['pending'::text, 'failed'::text])) AND (attempt_count < 5))"
idx_jobs_type,"CREATE INDEX idx_jobs_type ON public.jobs USING btree (type, created_at)"
jobs_pkey,CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id)
processed_messages_message_sid_key,CREATE UNIQUE INDEX processed_messages_message_sid_key ON public.processed_messages USING btree (message_sid)
processed_messages_pkey,CREATE UNIQUE INDEX processed_messages_pkey ON public.processed_messages USING btree (id)
idx_whatsapp_sessions_tenant_id,CREATE INDEX idx_whatsapp_sessions_tenant_id ON public.whatsapp_sessions USING btree (tenant_id)
uq_whatsapp_sessions_phone_number,CREATE UNIQUE INDEX uq_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
whatsapp_sessions_pkey,CREATE UNIQUE INDEX whatsapp_sessions_pkey ON public.whatsapp_sessions USING btree (id)
```

`idx_jobs_claim` created with `next_retry_at` as the indexed column and both
predicate halves intact. All three drop targets gone. Both safety-critical
indexes present.

### 3.2 AFTER plan (identical query text — paired against §2.4)

```
QUERY PLAN
Limit  (cost=0.29..0.36 rows=3 width=107) (actual time=0.053..0.055 rows=3 loops=1)
  Buffers: shared hit=1 read=2
  ->  Index Scan using idx_jobs_claim on jobs  (cost=0.29..498.55 rows=18697 width=107) (actual time=0.052..0.053 rows=3 loops=1)
        Index Cond: (next_retry_at <= now())
        Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=209 read=1
Planning Time: 1.416 ms
Execution Time: 0.149 ms
```

| | BEFORE (§2.4) | AFTER | Δ |
|---|---:|---:|---:|
| Scan node | Parallel Seq Scan | Index Scan | — |
| Buffers | 2,877 | 3 | **959× fewer** |
| Execution time | 50.549 ms | 0.149 ms | **~340×** |
| Sort node | present | absent | eliminated |
| Parallelism | Gather Merge, 1 worker | none | eliminated |

Two details worth reading closely:

**There is no `Filter:` line at all.** Because `status` and `attempt_count` live
in the index **predicate**, Postgres treats every entry as already qualifying and
re-checks nothing. Only `Index Cond: (next_retry_at <= now())` remains. That is
the predicate design working exactly as intended.

**`rows=18697` is an estimate, not a count.** The index contains 5,000 entries
(§4.2). Postgres's selectivity estimation for partial indexes is approximate; the
estimate is harmless here because `LIMIT 3` stops the scan after three rows —
visible in `actual … rows=3`.

### 3.3 AFTER — real-execution corroboration

```
BEFORE the 10× loop:
indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
idx_jobs_claim,1,3,3
idx_jobs_type,0,0,0
jobs_pkey,0,0,0

AFTER the 10× loop:
indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
idx_jobs_claim,11,33,33
idx_jobs_type,0,0,0
jobs_pkey,0,0,0
```

**`idx_jobs_claim.idx_scan` 1 → 11, a clean +10** (the leading 1 is the
`EXPLAIN ANALYZE` in §3.2), with `idx_tup_read` 3 → 33 confirming three rows per
execution. Paired against §2.5 — where `idx_jobs_poll` sat at 0 through ten
identical executions — this is the before/after stated as observed behaviour, not
planner intent.

### 3.4 Index sizes

```
indexrelname,size
idx_jobs_claim,56 kB
idx_jobs_type,9728 kB
jobs_pkey,8232 kB
```

Noted for the record, not acted on: `idx_jobs_type` is ~174× the size of the
index that does the actual work and still has **zero readers** across every
capture in this package (`idx_scan` = 0 in §2.5 and §3.3 alike). Its deferral is
deliberate (§6) — this measurement is evidence for revisiting it, not for
widening 021.

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
and the LIMIT — the walk stops after 3 rows. §3.2's absent Sort node is that
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
entries_if_status_only,entries_as_shipped
20000,5000
```

15,000 permanently-dead rows excluded from the index by putting `attempt_count`
in the predicate rather than leaving it to a runtime filter.

§5a corroborates the mechanism from the other direction: relaxing the query bound
to `attempt_count < 7` makes the scan match `rows=10000 loops=2` = 20,000 and
discard `90000 × 2` = 180,000 — i.e. exactly the 15,000 dead-letter rows joining
the 5,000 live ones, leaving only the `succeeded` band. The dead-letter effect is
visible in the plan's own row counts.

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

### 5a. `attempt_count < 7` — MAX_ATTEMPTS drift

```
QUERY PLAN
Limit  (cost=6345.94..6346.28 rows=3 width=107) (actual time=40.718..48.912 rows=3 loops=1)
  Buffers: shared hit=2877
  ->  Gather Merge  (cost=6345.94..7716.05 rows=11914 width=107) (actual time=40.717..48.908 rows=3 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=2877
        ->  Sort  (cost=5345.93..5375.71 rows=11914 width=107) (actual time=35.591..35.592 rows=2 loops=2)
              Sort Key: next_retry_at
              Sort Method: top-N heapsort  Memory: 25kB
              Buffers: shared hit=2877
              Worker 0:  Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Seq Scan on jobs  (cost=0.00..5191.94 rows=11914 width=107) (actual time=28.162..33.017 rows=10000 loops=2)
                    Filter: ((status = ANY ('{pending,failed}'::text[])) AND (attempt_count < 7) AND (next_retry_at <= now()))
                    Rows Removed by Filter: 90000
                    Buffers: shared hit=2839
Planning:
  Buffers: shared hit=223
Planning Time: 1.302 ms
Execution Time: 49.036 ms
```

### 5b. status list + `'running'` — status drift

```
QUERY PLAN
Limit  (cost=6481.16..6481.50 rows=3 width=107) (actual time=43.204..52.012 rows=3 loops=1)
  Buffers: shared hit=2877
  ->  Gather Merge  (cost=6481.16..7745.93 rows=10998 width=107) (actual time=43.202..52.008 rows=3 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=2877
        ->  Sort  (cost=5481.15..5508.64 rows=10998 width=107) (actual time=38.263..38.264 rows=3 loops=2)
              Sort Key: next_retry_at
              Sort Method: top-N heapsort  Memory: 25kB
              Buffers: shared hit=2877
              Worker 0:  Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Seq Scan on jobs  (cost=0.00..5339.00 rows=10998 width=107) (actual time=36.353..37.523 rows=2500 loops=2)
                    Filter: ((attempt_count < 5) AND (status = ANY ('{pending,failed,running}'::text[])) AND (next_retry_at <= now()))
                    Rows Removed by Filter: 97500
                    Buffers: shared hit=2839
Planning:
  Buffers: shared hit=210
Planning Time: 1.101 ms
Execution Time: 52.144 ms
```

Note `Rows Removed by Filter: 97500` — **identical to §2.4**. No `'running'` rows
exist, so adding that status changes nothing about the data; the only thing it
changes is that the predicate is no longer implied. That isolates the
predicate-implication failure from any data effect.

### 5c. CONTROL — unmodified production query

```
QUERY PLAN
Limit  (cost=0.29..0.36 rows=3 width=107) (actual time=0.034..0.036 rows=3 loops=1)
  Buffers: shared hit=3
  ->  Index Scan using idx_jobs_claim on jobs  (cost=0.29..498.55 rows=18697 width=107) (actual time=0.033..0.034 rows=3 loops=1)
        Index Cond: (next_retry_at <= now())
        Buffers: shared hit=3
Planning:
  Buffers: shared hit=210
Planning Time: 1.092 ms
Execution Time: 0.123 ms
```

| | Scan | Buffers | Time |
|---|---|---:|---:|
| 5a `attempt_count < 7` | Parallel Seq Scan | 2,877 | 49.036 ms |
| 5b status + `'running'` | Parallel Seq Scan | 2,877 | 52.144 ms |
| **5c control (unmodified)** | **Index Scan** | **3** | **0.123 ms** |

5a is the `MAX_ATTEMPTS` drift scenario made concrete. 5b is the scenario where a
future author builds the stale-claim sweep for orphaned `running` jobs (§6) by
extending `claimJobs` instead of giving the sweep its own index. **5c is the
methodological control** — without it, 5a/5b would be ambiguous (a skeptic could
argue the index simply stopped working); with it, the only variable is the
predicate text, so the three frames demonstrate the *mechanism*, not just the
outcome.

(5c reads `shared hit=3` where §3.2 read `hit=1 read=2` — same three buffers,
differing only in cache warmth between the two runs.)

---

## 6. Explicitly out of scope

Recorded so neither reads as an oversight.

**`idx_jobs_type` — DEFERRED, not dropped.** Non-partial, indexes every job
forever, 9,728 kB at 200k rows (§3.4), and `idx_scan = 0` in every counter
capture in this package. It is a genuine growth liability, but it differs in kind
from 021's three changes: those are *provably redundant or provably unusable*,
this one is merely *currently unused*, and a jobs-by-type admin view is
plausible. Dropping it is a product bet; 021 contains only provable facts. Owner
decision, 2026-07-27.

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

Identical query text before and after, so the frames are directly comparable.
The BEFORE frame is §2.2 (10 rows); the AFTER frame is §3.1 (8 rows) — three
dropped, one created.

### Completeness check (test-db, post-021)

A FULL OUTER JOIN of the actual index set against the expected post-021 set, so
the verdict does not depend on counting rows by eye:

```
tablename,indexname,verdict
jobs,idx_jobs_claim,ok
jobs,idx_jobs_type,ok
jobs,jobs_pkey,ok
processed_messages,processed_messages_message_sid_key,ok
processed_messages,processed_messages_pkey,ok
whatsapp_sessions,idx_whatsapp_sessions_tenant_id,ok
whatsapp_sessions,uq_whatsapp_sessions_phone_number,ok
whatsapp_sessions,whatsapp_sessions_pkey,ok
```

**8/8 `ok`** — nothing missing, nothing unexpected.

### Safety assertions — the two indexes that must survive

| Index | Why it is load-bearing |
|---|---|
| `uq_whatsapp_sessions_phone_number` | backs `ON CONFLICT (phone_number)` in every session RPC; dropping it breaks the morning flow outright |
| `processed_messages_message_sid_key` | raises the `23505` that `isNewMessage` depends on; dropping it breaks webhook idempotency |

Both confirmed present post-apply on test-db (§3.1, and `ok` above). Both must be
re-confirmed on prod (§10 step D). The naming similarity between
`idx_whatsapp_sessions_phone_number` (dropped) and
`uq_whatsapp_sessions_phone_number` (kept) is the single likeliest fatal typo in
this migration; the unit test asserts no DROP statement names the `uq_` one.

### Cleanup

```
jobs_rows_after_cleanup
0

tablename,indexname
jobs,idx_jobs_claim
jobs,idx_jobs_type
jobs,jobs_pkey
processed_messages,processed_messages_message_sid_key
processed_messages,processed_messages_pkey
whatsapp_sessions,idx_whatsapp_sessions_tenant_id
whatsapp_sessions,uq_whatsapp_sessions_phone_number
whatsapp_sessions,whatsapp_sessions_pkey
```

`DELETE FROM jobs WHERE type = 'zz_explain_probe'` → 200,000 removed; `count(*)`
back to **0**, matching the pre-seed baseline (§2.3) exactly. `VACUUM ANALYZE
jobs` clean. Post-cleanup index list identical to §3.1 — cleanup touched only
data.

### Transcription note (2026-07-27)

During the step-by-step rehearsal, one intermediate reading of the pre-state was
transcribed as 9 rows rather than 10, which briefly made the after-count look
like a net −1 instead of −2. Resolved: the authoritative capture is the 10-row
frame pinned in §2.2 (the missing line was `whatsapp_sessions_pkey`, lost in chat
rendering, not absent from the database), and 10 − 3 + 1 = 8 matches §3.1
exactly. Corroborated independently by the 8/8 completeness check above and by
prod's own before-frame (§10 step B) showing all three drop targets present.
**No schema drift, on either environment.** Recorded because the alternative
explanation — a drop target genuinely missing on test-db — would have meant the
rehearsal never exercised that drop, and that distinction was worth resolving
before proceeding rather than after.

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

```
tablename,indexname,indexdef
jobs,idx_jobs_poll,"CREATE INDEX idx_jobs_poll ON public.jobs USING btree (status, next_retry_at) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))"
jobs,idx_jobs_type,"CREATE INDEX idx_jobs_type ON public.jobs USING btree (type, created_at)"
jobs,jobs_pkey,CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id)
processed_messages,idx_processed_messages_sid,CREATE INDEX idx_processed_messages_sid ON public.processed_messages USING btree (message_sid)
processed_messages,processed_messages_message_sid_key,CREATE UNIQUE INDEX processed_messages_message_sid_key ON public.processed_messages USING btree (message_sid)
processed_messages,processed_messages_pkey,CREATE UNIQUE INDEX processed_messages_pkey ON public.processed_messages USING btree (id)
whatsapp_sessions,idx_whatsapp_sessions_phone_number,CREATE INDEX idx_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
whatsapp_sessions,idx_whatsapp_sessions_tenant_id,CREATE INDEX idx_whatsapp_sessions_tenant_id ON public.whatsapp_sessions USING btree (tenant_id)
whatsapp_sessions,uq_whatsapp_sessions_phone_number,CREATE UNIQUE INDEX uq_whatsapp_sessions_phone_number ON public.whatsapp_sessions USING btree (phone_number)
whatsapp_sessions,whatsapp_sessions_pkey,CREATE UNIQUE INDEX whatsapp_sessions_pkey ON public.whatsapp_sessions USING btree (id)
```

**10 rows, byte-identical to test-db's pre-state (§2.2).** PROCEED condition: all
three drop targets present (met). Prod is **not** drifted on any of them, so the
apply exercises exactly the paths the rehearsal exercised.

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

**D. Post-apply probes (read-only).** Re-run the §2.2 inventory query on prod and
pair it against step B. Assert: `idx_jobs_claim` present with `next_retry_at`
leading and `attempt_count < 5` in the predicate; the three targets absent;
**`uq_whatsapp_sessions_phone_number` and `processed_messages_message_sid_key`
both present**; `idx_jobs_type` and all three `*_pkey` untouched. Expect 8 rows
matching §3.1. Then run the §7 completeness check and expect 8/8 `ok`.

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
| Evidence | Empirical: 50.549 ms → 0.149 ms, 2,877 → 3 buffers, with negative controls and a methodological control |
| Blast radius if wrong | Two named indexes must survive (§7); both asserted pre- and post-apply, and by unit test |
| External reviewer | Not gated — 018 precedent, owner-agreed 2026-07-27 |
| Raw captures | **Complete** — every evidence block holds literal SQL Editor output |
| Prod status | **NOT APPLIED.** Before-frame captured (§10 B); runbook ready to execute |
