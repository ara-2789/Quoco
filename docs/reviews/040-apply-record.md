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

## Apply — PENDING, Aravind has not opened the dead-zone window

Everything below is a stub, per the runbook (`docs/reviews/040-apply-runbook.md`), filled in only when
the real apply happens. **Do not treat any line below as having occurred.**

### PITR observation (prod, at apply time)
PENDING.

### FIX-1 probe — both databases
```sql
SELECT count(*) FROM public.daily_log_edits WHERE column_name = 'evening_schedule_miss_reason';
```
test-db: PENDING. prod: PENDING.

### Dead-zone session probe (immediately before BEGIN)
```sql
SELECT current_flow, current_step, count(*) FROM whatsapp_sessions WHERE current_flow = 'evening' GROUP BY 1, 2;
```
PENDING.

### Migration-number reservation re-verified against current `origin/main`
PENDING.

### Apply — test-db, then prod
PENDING.

### Ledger rows
PENDING.

### S5 post-apply fingerprint (prosrc hashes vs. the applied file's STEP 6/7)
PENDING.

### Stage 2 merge (same sitting as apply)
PENDING.

### test-db permanent apply + ledger repair (runbook Step F) + types regen (Step G)
PENDING.
