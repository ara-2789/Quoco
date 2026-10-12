# Migration 049 — PROD apply runbook (capture tables, PR-A)

Written 12 Oct 2026, draft for Aravind. **Nothing in this file has been run.** No database was touched writing it.
Target: prod `jvxwqignooseazzmwhvl`; reference: test-db `exfccwlrhoutkgrlikod`. Tier: FULL. Skeleton: `docs/migration-runbook-template.md` steps A–H; precedent: `docs/reviews/048-prod-apply-record.md`.

**Who runs what.** Every command block here is **YOU RUN THIS** — Aravind's terminal, not Claude Code. Each write step needs Aravind's own go-ahead in the same exchange (CLAUDE.md section 0, PROD APPLIES (c)); only the exact word "yes" approves (12 Oct rule). Claude Code may draft the apply record from pasted output. Markers in the record: **[O]** observed in the applying terminal's capture, **[R]** reported.

## 0. Open before step A (decide, then strike)

| # | Question | Draft recommendation |
|---|---|---|
| O-A | **Order conflict.** Plan v2 tier path (`049-plan-evidence/pra-plan-v2.md:92`, and CLAUDE.md FULL-tier order) is CI → **merge** → PITR → prod apply. The 12 Oct handover NEXT 5 is prod apply → verify → **merge**. | Apply first, merge after (step J). PR-A ships no app code that reads these tables, so merging is not a deploy step for 049, and "the file enters `supabase/migrations/` when it is applied" (CLAUDE.md section 6) is met in the apply commit. Aravind decides. |
| O-B | **Prod ledger method** (handover NEXT 2). | `supabase migration repair --status applied 049 --linked` with `supabase/migrations/049_capture_tables.sql` present (template step E; 048 precedent). Then re-align test-db's hand-inserted NULL-statements row the same way (step F). |
| O-C | DOWN Guard 2 comment (SQL line 1134) and header lines 31 and 35 say four functions; the file has six. | Do not edit the file (any edit changes the pinned sha `069fbe16…` and the applied file would differ from the reviewed one). Record as a known comment fault; reviewer may overrule. |
| O-D | Does SQL review round 3 still come (2b step 9 HELD)? | If yes, it is before step A. |
| O-E | Pre-flight (from the 12 Oct three-advisor review; recommended, not a rule yet). | During steps A–J no Claude Code session holds a prod credential or acts through `gh` as Aravind; `chmod 600 .env.test`. |

## 1. Pins

- SQL: `docs/reviews/049_capture_tables.sql` at `3a0244f` (and unchanged at `cac20da`), 1195 lines, **sha256 `069fbe16f07c383d54edd3233b845de55591548815ce5e6b068e098c9dfa574b`**, git blob `3b50f2c6c683a5ea5481d91533be4aa9991b13bc`.
- Branch `feat/049-capture-tables`, PR #331. CI run 38218724012 on `cac20da`: success, **per Aravind 12 Oct [R]** (not pinned from `gh` output by any session). Any new commit on the branch (this runbook's commit, the apply commit) needs its own green run pinned before merge (CLAUDE.md: a green check certifies a SHA).
- Probes (`docs/reviews/049-apply-probes/`, all read-only, one SELECT each, `(k, v)` columns): `PRE.sql`, `FP049.sql`, `ACL049.sql`, `LEDGER.sql`, plus `prod-refusals.mjs`. Checked on a disposable local PG 17.6 with stub parents only: run with and without 049, a second independent apply gave a byte-identical `FP049`, and a planted grant, a planted PUBLIC EXECUTE and a changed comment each showed up in `FP049` and `ACL049`. Not run against test-db or prod.

## A. PITR and P14 (dashboard, no SQL)

1. Dashboard → Database → Backups → Point in Time on **prod**: record the latest restore point (IST) and the time you read it. Must be within the last ~30 minutes and before step C.
2. **P14:** Dashboard → Storage → Settings on **prod**: record the project-wide upload limit and the date. PROCEED if it is ≥ 16 MiB (the bucket's own limit is 16777216).
3. **P10** is pinned by step B's `P10` lines (same fact, now with one row per name and the ref printed).

Paste: `PITR_LATEST_RESTORE_IST=…  READ_AT_IST=…  P14=… (prod, read <date>)`.

## B. Reference, link, pinned file, pre-state (read-only)

```bash
# B0 — live rehearsal reference, on TEST-DB, immediately before linking prod
cat supabase/.temp/project-ref                       # must print exfccwlrhoutkgrlikod
supabase db query --linked -f docs/reviews/049-apply-probes/FP049.sql | tee /tmp/049-fp-testdb.json

# B1 — link prod
supabase link --project-ref jvxwqignooseazzmwhvl
cat supabase/.temp/project-ref                       # must print jvxwqignooseazzmwhvl

# B2 — the pinned file, from the commit, not the working tree
git fetch origin
git show 3a0244f:docs/reviews/049_capture_tables.sql > /tmp/049.sql
shasum -a 256 /tmp/049.sql                           # must be 069fbe16…dfa574b

# B3 — pre-state
supabase db query --linked -f docs/reviews/049-apply-probes/PRE.sql
supabase db query --linked -f docs/reviews/049-apply-probes/FP049.sql
```

**PROCEED only if** `server_version` 17.6; `P3 … = invoice` **0**; all four `P10` lines **absent**; all six `fn` lines **0**; `bucket capture-documents rows` **0**; `ledger max version` **048**; `ledger 049 rows` **0**. `FP049` on prod reads `tables present 0`, `functions present 0`, `bucket … absent`. Keep `public tables`, `public functions`, `storage buckets` and `ledger rows` as the pre-counts. **STOP on anything else.**

## C. Apply (write — "yes" required)

One run, foreground, no retry, never `db push`. The frame refuses unless both checks pass:

```bash
REF=$(cat supabase/.temp/project-ref); echo "ref: $REF"
[ "$REF" = "jvxwqignooseazzmwhvl" ] || { echo "STOP: not prod"; exit 1; }
SHA=$(shasum -a 256 /tmp/049.sql | cut -d' ' -f1); echo "sha: $SHA"
[ "$SHA" = "069fbe16f07c383d54edd3233b845de55591548815ce5e6b068e098c9dfa574b" ] || { echo "STOP: sha"; exit 1; }
date -u +%FT%TZ
supabase db query --linked -f /tmp/049.sql; echo "[exit $?]"
date -u +%FT%TZ
```

Expect exit 0 and no error. The file is one `BEGIN … COMMIT` (lines 273–1101) whose last blocks assert the bucket settings and the full ACL/owner/definer matrix and abort on any surprise; 2b's B1 showed `db query -f` is all-or-nothing. **On any error: STOP, paste, do not retry** — nothing was applied.

## D. Verify by observation (read-only)

```bash
cat supabase/.temp/project-ref                       # jvxwqignooseazzmwhvl
supabase db query --linked -f docs/reviews/049-apply-probes/FP049.sql | tee /tmp/049-fp-prod.json
supabase db query --linked -f docs/reviews/049-apply-probes/ACL049.sql
supabase db query --linked -f docs/reviews/049-apply-probes/PRE.sql
```

- **FP049:** every `(k, v)` row identical to `/tmp/049-fp-testdb.json` from B0 (compare the `rows` arrays; the CLI's `boundary` value differs per run by design). Includes `pg_proc_count=1` for each of the six functions (the package's post-apply fingerprint item) and the bucket line `public=false limit=16777216 mimes={application/pdf,image/jpeg,image/png,image/webp}`.
- **ACL049:** `table cells checked 96`, `table cells unexpected 0`, list `-`, `PUBLIC grants on 049 tables 0`, `function cells checked 18`, `function cells with EXECUTE 0`, `functions with NULL proacl 0`, `PUBLIC grants on 049 functions 0`.
- **PRE again:** `P10` lines now name the tables; `fn` lines 1; bucket rows 1, objects 0; `ledger max version` **still 048** (`db query` does not write the ledger); `public tables` +4, `public functions` +6, `storage buckets` +1 against B3.
- **D2, refusals through PostgREST:** `node docs/reviews/049-apply-probes/prod-refusals.mjs` from the main checkout. It stops before any call unless the host and both keys' JWT claims are prod. Expect `TARGET CONFIRMED`, `positive controls OK=4/4`, `RESULT PASS=28 FAIL=0`.

**Any mismatch: STOP.** Rollback is section R, before any row is written.

## E. Ledger on prod (write — "yes" required)

```bash
git mv docs/reviews/049_capture_tables.sql supabase/migrations/049_capture_tables.sql
shasum -a 256 supabase/migrations/049_capture_tables.sql   # must be 069fbe16…dfa574b
cat supabase/.temp/project-ref                              # jvxwqignooseazzmwhvl
supabase migration repair --status applied 049 --linked; echo "[exit $?]"
supabase db query --linked -f docs/reviews/049-apply-probes/LEDGER.sql
supabase migration list --linked
```

Expect: top row `049 | capture_tables | <non-NULL count>`, `ledger_rows` = B3's count + 1; `migration list` local = remote on every row. If `n_statements` reads NULL, record it as observed: then the test-db row in step F already matches and needs only the name check.

## F. Test-db: same ledger method (write — "yes" required)

049 is already applied on test-db (block 2b, and B0's fingerprint). Step F here is the ledger re-alignment only, not a re-apply.

```bash
supabase link --project-ref exfccwlrhoutkgrlikod
cat supabase/.temp/project-ref                              # exfccwlrhoutkgrlikod
supabase migration repair --status reverted 049 --linked; echo "[exit $?]"   # history row only; runs no SQL
supabase migration repair --status applied 049 --linked; echo "[exit $?]"
supabase db query --linked -f docs/reviews/049-apply-probes/LEDGER.sql
```

Expect the same top row shape as prod in step E. The CLI is left linked to test-db.

## G. Types (D-16: separate commit, after the apply, source test-db)

```bash
npx supabase gen types typescript --linked --schema public > types/database.ts
npx tsc --noEmit
```

Commit on its own, message stating the source was test-db (043/044/048 precedent).

## H. Reservations file (same commit as E)

`scripts/migration-number-reservations.json`, entry 049: dated correction — applied to prod `<UTC>` and ledgered on both databases; `claimedBy` → `supabase/migrations/049_capture_tables.sql`; "four SECURITY DEFINER trigger functions" → six (F4-2 added two; the old text is kept as history, not rewritten).

## I. Apply record

`docs/reviews/049-prod-apply-record.md` in the 048 record's shape: inputs verbatim, the C frame, B/D/E/F output, [O]/[R] marked. Claude Code can draft it from pasted captures.

## J. Merge (per O-A)

1. Push the apply commit (E + H + record). Wait for CI on that SHA; pin it with `gh run view <id> --json conclusion,headSha,url` — conclusion `success`, `headSha` = PR head.
2. `gh pr ready 331` if still draft; Aravind merges with a **regular merge commit**.
3. `git fetch origin && git show origin/main:supabase/migrations/049_capture_tables.sql | shasum -a 256` → `069fbe16…` (CLAUDE.md PROD APPLIES (d)).

## R. Rollback (only before any row exists)

Uncomment and run the file's DOWN block (helpers do not exist on prod, so Guard 2 passes; Guards 1 and the zero-objects guard must pass). It removes the tables, functions and the 049 ledger row in one transaction. Then remove the bucket **through the Storage API** (service_role key, prod): on real Storage, 2b observed the SQL `DELETE FROM storage.buckets` refused with 42501 by `storage.protect_delete()`, and the API `deleteBucket` succeed on an empty bucket. Re-run `PRE.sql` and expect the B3 values. After any row exists, DOWN is data loss; the answer is PITR (step A).

## Not covered here

PR-B and PR-C blocking conditions (review package section 10, plus vitest c, d, f); the switch trigger (unchanged: first RCPL, beta or customer data on prod makes everything FULL tier permanently); `test/capture-tables.test.ts` fails in CI whenever test-db lacks 049, so any future DOWN rehearsal on test-db turns CI red until 049 is re-applied.
