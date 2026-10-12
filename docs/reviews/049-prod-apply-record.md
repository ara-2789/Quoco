# Migration 049 — PROD apply record (2026-10-12)

**Target: prod `jvxwqignooseazzmwhvl`.** One file, one run, never `db push`, no DOWN. Runbook: `docs/reviews/049-prod-apply-runbook.md` (at `df92495`). Package: `docs/reviews/049-review-package.md` sections 17–18.
Every command was run by **Aravind in his own terminal** (worktree `.claude/worktrees/049-sql` at `df92495`, plus the main checkout for D2); output was pasted into a design-review chat, which wrote this record. Markers: **[O]** raw output pasted and quoted here; **[R]** reported in words, raw output not pasted.

## 0. Inputs and decisions

- **GO** — Aravind, 12 Oct 2026, by running step C himself [R].
- **PITR — NOT OBSERVED, by decision.** Per Aravind, 12 Oct 2026: PITR is disabled on prod until beta launch; "There are no sensitive data currently, so no PITR is fine." [R]. This departs from the FULL-tier "PITR observed" step (CLAUDE.md section 0; plan v2 tier path). The rollback path relied on instead: the file's DOWN plus a Storage API bucket delete, both rehearsed on test-db in block 2b. No daily-backup timestamp was read. **PITR must be re-enabled before the first beta, customer or RCPL data lands on prod** (switch trigger).
- **P14 (project-wide Storage upload limit)** — **not re-read at apply.** Still the 11 Oct "50 MB per Aravind, dashboard, not probed" (D-11). OWED: pin with a date.
- **O-C** — the file was applied unedited; the stale "four functions" comments (SQL lines 31, 35, 1134) are recorded in package section 18, not fixed.
- **O-B** — ledger by `supabase migration repair` on both databases (sections 4–5).
- **O-A** — apply before merge (section 7).
- **CI** — run 38218724012 [O] (`gh run view`): `conclusion: success`, `headSha: cac20da0461788340ec500c7c3402248636d118a`. Run 38225962257 on `df92495` (docs-only commit) was still running when this record was written.

## 1. Reference and pre-state — [O]

- **B0, test-db reference** (`exfccwlrhoutkgrlikod` printed): `FP049.sql` — tables present 4, functions present 6, each `pg_proc_count=1`, bucket `public=false limit=16777216 mimes={application/pdf,image/jpeg,image/png,image/webp}`; saved as `/tmp/049-fp-testdb.json` on Aravind's machine.
- **B3, prod pre-state** (`PRE.sql`): server 17.6; P3 `whatsapp_sessions current_flow=invoice` **0**; P10 all four tables **absent**; all six function names **0**; bucket `capture-documents` rows 0, objects 0; ledger max **048**, 049 rows 0, ledger rows **44**; public tables **32**, public functions **135**, storage buckets **1**. `FP049.sql`: tables 0, functions 0, bucket absent.
- **This is P10's dated pin:** 12 Oct 2026, one row per name, on the database whose ledger reads 44 rows with no 049 row (test-db had a 049 row at the time), so the target is not in doubt even though the B1 `cat supabase/.temp/project-ref` line was not pasted.
- **Unexplained drift, recorded:** the 048 prod record (21 Sep) left prod with 131 public functions; B3 read 135 with no migration since 048. None collides with 049's names. Not investigated here.

## 2. The apply — [R]

`git show 3a0244f:docs/reviews/049_capture_tables.sql > /tmp/049.sql`, then the runbook's step C frame (refuses unless the ref is prod and sha256 = `069fbe16f07c383d54edd3233b845de55591548815ce5e6b068e098c9dfa574b`), then `supabase db query --linked -f /tmp/049.sql`. **The frame's output (ref, sha, timestamps, exit code) was not pasted**; this record cannot quote it. Bounds from the chat: B3 output pasted 14:27 IST, D output pasted 14:31 IST, so the apply ran between about 08:57Z and 09:01Z. The evidence that it applied completely is section 3: the file is one `BEGIN … COMMIT` whose own assertion blocks abort on any bucket or ACL surprise, and every object it creates is present and equal to test-db.

## 3. Post-apply verification — [O]

- **FP049 (prod) vs B0 (test-db):** `diff` of the two tables printed nothing and echoed `FP049 MATCH: prod == test-db`. Every line equal: per-table owner, RLS, ACL (`{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}`), columns (11/16/23/17), constraints (15/16/33/21), triggers (2/0/2/2), policies (1 each), indexes (5/3/7/4), comments (1 each); per function `pg_proc_count=1 owner=postgres secdef=true config={"search_path=\"\""} acl={postgres=X/postgres}` with identical `md5_prosrc` and `md5_def`; the bucket line.
- **ACL049:** table cells checked 96, unexpected 0, list `-`; PUBLIC grants on 049 tables 0; function cells checked 18, with EXECUTE 0; NULL `proacl` 0; PUBLIC grants on 049 functions 0.
- **PRE after:** P10 all four present; each function 1; bucket rows 1, objects 0; ledger max still 048 (44 rows; `db query` does not write the ledger); public tables **36** (+4), functions **141** (+6), buckets **2** (+1).
- **D2, PostgREST** (`prod-refusals.mjs`, run from the main checkout, started 2026-10-12T09:01:25.939Z, finished 09:01:36.951Z): `host: jvxwqignooseazzmwhvl.supabase.co`; both JWTs `ref=jvxwqignooseazzmwhvl`, roles anon / service_role; `TARGET CONFIRMED`. 16/16 anon SELECT/INSERT/UPDATE/DELETE refused `42501`; 12/12 service_role INSERT/UPDATE/DELETE refused `42501`; service_role SELECT on all four tables returned empty arrays (4/4). `RESULT PASS=28 FAIL=0`. Keys were never printed (`grep -o` of the three variable names only).

## 4. Ledger, prod — [O]

`git mv docs/reviews/049_capture_tables.sql supabase/migrations/049_capture_tables.sql`; `shasum -a 256` after the move = `069fbe16…dfa574b`; ref printed `jvxwqignooseazzmwhvl`; `supabase migration repair --status applied 049 --linked` → `Repaired migration history: [049] => applied`, `[exit 0]`. `LEDGER.sql`: `049 | capture_tables | 59 | 45`, then 048 (14), 047 (54). `supabase migration list --linked`: `049 | 049 | 049`. `migration repair` writes the statements from the local file, which is why the row is non-NULL.

## 5. Test-db ledger re-alignment — [O]

Linked `exfccwlrhoutkgrlikod` (printed). Before: `049 | capture_tables | NULL | 45`. `migration repair --status reverted 049` → `[exit 0]`; `--status applied 049` → `[exit 0]`. After: `049 | capture_tables | 59 | 45`. History rows only; no schema change (049's objects on test-db were already in place, B0). The CLI was left linked to test-db.

## 6. Types — deferred, separate commit (D-16)

Generated from test-db: 4 new tables **plus 6 `quoco_test_capture_*` helpers** (test-only, never on prod). Generated from prod: 4 new tables, no helpers, and **drops** `quoco_test_047_unused_rights_check` and `quoco_test_row_is_locked`, which the current file carries from earlier test-db generations (048 hit the same question, its reservation entry). `npx tsc --noEmit` in the worktree fails with the **same two errors** with the current file and with either regenerated file (`lib/media/ingest.ts:155`, `lib/whatsapp/inbound-start.ts:842`, computed-key `.update()` on `daily_logs`), so the errors are local and pre-existing (likely the worktree's `node_modules` vs the lockfile; CI typecheck passed on `cac20da`), not caused by 049. Supabase CLI 2.109.1. Decision for the follow-up commit: per D-16, test-db source; CI's typecheck on that commit is the gate.

## 7. Still open after this record

1. P14 pinned with a date (section 0).
2. Types commit (section 6), then CI on the final head pinned with `gh run view … --json conclusion,headSha`.
3. Merge #331 with a **regular merge commit**; then `git show origin/main:supabase/migrations/049_capture_tables.sql | shasum -a 256` = `069fbe16…` (CLAUDE.md PROD APPLIES (d)).
4. PITR re-enabled before the switch trigger fires.
5. The 131 → 135 function drift on prod (section 1).
6. The local `tsc` baseline in the 049-sql worktree (section 6).
7. PR-B / PR-C blocking conditions (package section 10) unchanged.
