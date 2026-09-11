# Migration 040 apply record

Living document — filled in as each real step actually happens. **Apply has not happened.** This
document is seeded now with the external-review-round-2 dry-run condition (complete, below) and stub
sections for the runbook's non-negotiable apply-time items (`docs/reviews/040-apply-runbook.md`),
pending only on Aravind opening the dead-zone window.

## Security note, recorded transparently before anything else

While preparing the dry-run condition, `supabase db dump --linked --schema public --dry-run` was run
piped through `tail` instead of redirected straight to a file — the exact incident class CLAUDE.md's own
standing rule already names (three prior instances, this command specifically being the third: "an
earlier draft's `PGPASSWORD` ... printed a live test-db connection password"). A live test-db
`PGPASSWORD` (role `cli_login_postgres`, project `exfccwlrhoutkgrlikod`) was printed into the session
transcript. **Contained the same way the prior instance was, per that rule's own precedent:** the
command was re-run with output redirected directly to a file, the credential-bearing file was deleted
immediately afterward, and the password was never printed a second time. Per this project's own standing
distinction ("far more force to production... than to test-db — a prod... credential... is not a
disposable test-db key"), no rotation was performed, matching the established precedent for this exact
incident class on test-db. **Flagged here for Aravind's own judgment, not decided unilaterally** — if
rotating this test-db credential is wanted regardless, that is a call for him, not something this session
resolved on its own authority.

## External review round 2 — DRY RUN CONDITION (complete, 2026-09-11)

Per CLAUDE.md §7's unconditional dry-run rule and the 029 precedent (a file's bytes changed since its
last execution anywhere → re-run before it re-enters a review package). The corrected file (FIX 1's
widened CHECK list, FIX 2's DOWN rewrite, the comment sweep) had never been executed anywhere in that
exact form — the original rehearsal round ran an earlier version of STEP 5/the DOWN block.

**Scaffold, same discipline as the original rehearsal round:** local Postgres 17.11 (matching test-db/
prod's PG17; confirmed already installed from prior session setup), disposable database
`quoco_dryrun_040`, schema sourced via `supabase db dump --linked --schema public --dry-run` against
test-db (the credential-safe way — script executed directly via `bash`, never printed, deleted
immediately after use — see the security note above for the one instance this session did NOT do that
correctly on the first attempt). Named stubs applied per CLAUDE.md's own dry-run rule: `auth.users`
(bare `id uuid primary key`), `auth.uid()` (`RETURNS uuid` → `NULL`), and the five roles (`postgres`,
`anon`, `authenticated`, `service_role`, `supabase_auth_admin` — all already present locally from a
prior session). `pgvector` extension installed by hand before the schema load (same named gap this
project's own dry-run rule already documents) — the schema load was genuinely clean (0 errors) only after
that; without it, 14 errors surfaced, every one of them on `tender_document_chunks` (an unrelated
Phase-2/pre-contract skeleton table with a vector column — nothing this migration touches).

**Schema load result:**
```
$ psql quoco_dryrun_040 -f .tmp/schema_dump.sql
exit code: 0
```
Zero `ERROR` lines in the full load output (4080-line dump).

**Migration 040 execution — the actual condition:**
```
$ psql quoco_dryrun_040 -f docs/reviews/040_evening_q5_tomorrow_needs.sql
BEGIN
ALTER TABLE
REVOKE
GRANT
COMMENT
COMMENT
ALTER TABLE
ALTER TABLE
CREATE FUNCTION
REVOKE
GRANT
CREATE FUNCTION
REVOKE
GRANT
COMMIT
exit code: 0
```
Clean, complete, start to finish — every statement in the corrected file executed in order, ending in a
real `COMMIT`, no errors, no warnings.

**Substantive spot-check, not just "it ran":**
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname='daily_log_edits_column_name_check';
```
```
CHECK ((column_name = ANY (ARRAY['is_holiday'::text, 'holiday_reason'::text, 'weather'::text,
'morning_plan'::text, 'morning_execution_plan'::text, 'evening_output'::text,
'evening_schedule_met'::text, 'evening_schedule_miss_reason'::text, 'evening_tomorrow_needs'::text,
'evening_workers_on_site'::text])))
```
Confirms FIX 1's retention (10 values, both old and new column present) landed correctly on a genuinely
fresh apply, not just in the rehearsal round's already-patched live state.

```sql
select
  pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure) ilike '%current_flow = ''hindrance''%' as hindrance_branch_present,
  pg_get_functiondef('public.correct_daily_log(uuid,text,jsonb)'::regprocedure) ilike '%WHEN ''evening_tomorrow_needs''%' as new_case_branch_present;
```
```
 hindrance_branch_present | new_case_branch_present
---------------------------+-------------------------
 t                         | t
```
Confirms the 038 hindrance-collision branch and the new CASE branch both landed correctly on a fresh
apply.

**Teardown:** `DROP DATABASE quoco_dryrun_040;` — confirmed gone (`\l` no longer lists it). Fully
disposable; no test-db or prod object was touched by this condition at any point — the only network call
was the read-only schema dump.

**Condition satisfied.** Not skipped despite the delta looking harmless, per the reviewer's own
instruction.

---

## Apply — COMPLETE, 2026-09-11, dead-zone window opened by Aravind

Aravind confirmed the dead-zone window was open. Everything below actually happened, in this order, raw
output throughout.

### PITR observation — LIVE on PROD, at apply time
```
$ supabase backups list --project-ref jvxwqignooseazzmwhvl
{"region":"ap-southeast-2","walg_enabled":true,"pitr_enabled":true,"backups":[],
 "physical_backup_data":{"earliest_physical_backup_date_unix":1788539645,
 "latest_physical_backup_date_unix":1789104142},"message":""}
```
`pitr_enabled: true`. Earliest restore point: 2026-09-04 22:04:05 IST. Latest physical backup:
2026-09-11 10:52:22 IST (~4h before this apply). **Observed live on prod at apply time, not carried over
from the rehearsal round's note** (which was test-db, and found `pitr_enabled: false` there — a
genuinely different result, confirming this was a fresh check, not a stale assumption).

### FIX-1 probe — both databases, recorded either way
```sql
SELECT count(*) FROM public.daily_log_edits WHERE column_name = 'evening_schedule_miss_reason';
```
**PROD: `count = 1`.** **test-db: `count = 0`.**

This is not a hypothetical the B1 finding guarded against — it is a real fact. A historical
`evening_schedule_miss_reason` correction exists on prod. Under the original (pre-FIX-1) swap-based CHECK,
this exact row would have failed the apply at `23514`. FIX 1's retention of the old value in STEP 5's
CHECK is why this apply proceeded cleanly rather than aborting on this row.

### Dead-zone session probe — immediately before `BEGIN`, on PROD
```sql
SELECT current_flow, current_step, count(*) FROM whatsapp_sessions WHERE current_flow = 'evening' GROUP BY 1, 2;
```
**Zero rows.** PROCEED condition met.

### Pre-apply hash pin — PROD, immediately before `BEGIN`
```sql
SELECT 'correct_daily_log' AS fn, md5(pg_get_functiondef('public.correct_daily_log(uuid,text,jsonb)'::regprocedure)) AS body_md5
UNION ALL
SELECT 'apply_evening_flow_turn', md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure));
```
```
 correct_daily_log       | 61892c8d09fa3252d4d7d24e407876d3
 apply_evening_flow_turn | ec80f6821a4bf73adadb1c172e8eaef3
```
Identical to test-db's own pre-apply state throughout the rehearsal round — prod and test-db were
genuinely function-identical before this apply.

### Migration-number reservation re-verified against current `origin/main`
```
$ git fetch origin && git rev-parse origin/main
9c34be83c10a037bb7556817ee37064c0c80cd88
$ git ls-tree -r --name-only origin/main -- supabase/migrations/ | grep "^supabase/migrations/040"
none found -- 040 still free
```
`origin/main` HEAD unchanged since Stage 1 (`9c34be8`). 040 confirmed still free. File promoted from
`docs/reviews/` into `supabase/migrations/` as its own commit (`b993a68`) immediately after.

### Apply — PROD, by file, standalone
```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
$ supabase db query --linked -f supabase/migrations/040_evening_q5_tomorrow_needs.sql
{"rows":[],"warning":"..."}
```
No error. Post-apply readback (PROD):
```sql
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_logs' AND column_name='evening_tomorrow_needs') AS new_col_exists,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='daily_log_edits_column_name_check') AS whitelist_def;
```
```
new_col_exists: 1
whitelist_def: CHECK ((column_name = ANY (ARRAY['is_holiday'::text, 'holiday_reason'::text,
'weather'::text, 'morning_plan'::text, 'morning_execution_plan'::text, 'evening_output'::text,
'evening_schedule_met'::text, 'evening_schedule_miss_reason'::text, 'evening_tomorrow_needs'::text,
'evening_workers_on_site'::text])))
```

### Ledger row — PROD
```
$ supabase migration repair --status applied 040 --linked
Repaired migration history: [040] => applied
{"versions":["040"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
$ supabase migration list --linked
... {"local":"040","remote":"040","time":"040"}] ...
```
040 confirmed present on both `local` and `remote`.

### S5 post-apply fingerprint — THE instrument that caught the 038 near-miss

Not a trust-the-CI-diff check — independently reconstructed. Extracted STEP 6 and STEP 7's literal text
from the now-applied file (`supabase/migrations/040_evening_q5_tomorrow_needs.sql` lines 263–397 and
432–902), loaded PROD's own current schema (fresh `pg_dump`, credential-safe redirection this time —
see the security note below) into a disposable local Postgres 17.11 database, captured that database's
hash for both functions, then re-applied the file's literal STEP 6/7 text on top and re-hashed:

```
BEFORE re-applying the file's literal text (sourced from PROD's own dump):
 correct_daily_log       | 7c18227f07239fde8b931324dc6c77aa
 apply_evening_flow_turn | d19d07507abccdaf7d54ee1d74419af7

AFTER re-applying the file's literal STEP 6/7 text:
 correct_daily_log       | 7c18227f07239fde8b931324dc6c77aa
 apply_evening_flow_turn | d19d07507abccdaf7d54ee1d74419af7
```
Identical, before and after. Then re-queried PROD directly, live:
```sql
SELECT 'correct_daily_log', md5(pg_get_functiondef('public.correct_daily_log(uuid,text,jsonb)'::regprocedure))
UNION ALL SELECT 'apply_evening_flow_turn', md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure));
```
```
 correct_daily_log       | 7c18227f07239fde8b931324dc6c77aa
 apply_evening_flow_turn | d19d07507abccdaf7d54ee1d74419af7
```
**Three-way match: PROD live = fresh reconstruction from the applied file's own literal text = the
round-1 rehearsal's own forward-apply result.** Permanent proof of what is live. Local scratch database
dropped immediately after.

### test-db — permanent apply + ledger repair (runbook Step F)
```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}
$ supabase db query --linked -f supabase/migrations/040_evening_q5_tomorrow_needs.sql
{"rows":[],"warning":"..."}
```
No error. Same post-apply readback as prod (new column + widened CHECK, identical). Ledger repair:
```
$ supabase migration repair --status applied 040 --linked
Repaired migration history: [040] => applied
$ supabase migration list --linked
... {"local":"040","remote":"040","time":"040"}] ...
```
Function hashes re-checked on test-db directly — identical to prod's (`7c18227f07239fde8b931324dc6c77aa`,
`d19d07507abccdaf7d54ee1d74419af7`). Prod and test-db confirmed identical post-apply, not just
independently correct.

### types/database.ts regeneration (runbook Step G)
```
$ npx supabase gen types typescript --linked --schema public > types/database.ts
exit code: 0
```
Diff: 3 lines added (`evening_tomorrow_needs: string | null` in the Row/Insert/Update shapes for
`daily_logs`), nothing else changed. Clean, additive, matches expectations exactly.

### Security note — a second instance this session, contained the same way

Building the S5 fingerprint required a fresh schema dump of PROD via `supabase db dump --linked
--schema public --dry-run`. Learning directly from this same session's earlier mistake (the round-2
dry-run condition), this was redirected straight to a file from the first command this time —
`bash <(that script) > file 2>stderr_file`, script output never printed, credential-bearing intermediate
deleted immediately after use. No repeat of the earlier incident.

### Stage 2 — see below, same sitting
