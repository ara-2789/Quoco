# Migration 045 — PRODUCTION APPLY RECORD (2026-09-15)

Companion to `docs/reviews/045-review-brief.md` (design review, cleared at
head `6cae54a3`, folds `7869b74`/`db94be9`) and `docs/reviews/045-test-db-
apply-record.md` (the test-db apply this prod apply follows). Applied
against `jvxwqignooseazzmwhvl` (prod) only after: Stage 3 app code was
already live on prod (Vercel, `main @ 3fb18c7`) and calling
`claim_media_nudge`, which did not exist there yet; PITR was directly
observed (not assumed); and CI was confirmed green at the exact merged SHA.

**PITR_OBSERVED** (Aravind, in the Supabase dashboard, before this apply):
latest restore point 2026-09-15 22:07:23 IST (16:37:23 UTC); restore
window starts 2026-09-08 22:07:23 IST.

**CI_PROOF**: run `34987721456` green at `b8294c4b00fe1fad6afcfdf88065751c73551dd7`,
merged as `3fb18c7`; `git diff b8294c4 3fb18c7` empty (confirmed directly,
this session, before the apply below) —
https://github.com/ara-2789/Quoco/actions/runs/34987721456

Everything below is a live, first-hand transcript from this session —
every command was actually run, in order, raw output pasted verbatim
(CLI banner lines kept in place).

## a. Link to prod, confirm target

```
$ supabase link --project-ref jvxwqignooseazzmwhvl
{"project_ref":"jvxwqignooseazzmwhvl","message":""}

$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
```
Equals the named prod ref exactly. Proceeded.

## b. Pre-probes

**`claim_media_nudge` absent:**
```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
$ supabase db query --linked -f probe-preapply.sql
{ "rows": [] }
```

**Ledger row for 045 before apply** (full raw listing; prod's ledger is
clean through 044, unlike test-db's own 042-044 gap recorded in the
companion test-db apply record):
```
$ supabase migration list --linked
{"migrations":[{"local":"001","remote":"001",...},...,{"local":"041","remote":"041","time":"041"},{"local":"042","remote":"042","time":"042"},{"local":"043","remote":"043","time":"043"},{"local":"044","remote":"044","time":"044"},{"local":"045","remote":"","time":"045"}],"message":"Migrations listed"}
```
`045`: `local=045`, `remote=""`.

**No trigger on `whatsapp_sessions`:**
```sql
SELECT tgname, tgrelid::regclass AS table_name FROM pg_trigger WHERE tgrelid = 'whatsapp_sessions'::regclass AND NOT tgisinternal;
```
```
{ "rows": [] }
```

## c. File provenance — md5 pinned to origin/main, then applied

```
$ git show origin/main:supabase/migrations/045_media_nudge_throttle.sql | md5
a3a6524a893e6c961ee99572bc5e9809
```
Equals the required value exactly — no difference to report. Extracted
that exact pinned content to a local file and re-verified before use:
```
$ git show origin/main:supabase/migrations/045_media_nudge_throttle.sql > 045-pinned-from-origin-main.sql
$ md5 -q 045-pinned-from-origin-main.sql
a3a6524a893e6c961ee99572bc5e9809
```
Applied that exact pinned file (not a local worktree copy), ref
re-confirmed in the same output immediately before:
```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl

$ supabase db query --linked -f 045-pinned-from-origin-main.sql
{ "rows": [] }
```
No error.

## d. Verify by observation

**Exactly one signature:**
```sql
SELECT oid, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "oid": 27204, "args": "p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_now timestamp with time zone, p_window_seconds integer, p_test_sleep_ms integer" }] }
```

**`prosecdef` / `search_path`:**
```sql
SELECT oid, prosecdef, proconfig FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "oid": 27204, "prosecdef": true, "proconfig": ["search_path=public"] }] }
```

**Grants — `has_function_privilege`:**
```sql
SELECT has_function_privilege('anon', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS service_role_execute;
```
```
{ "rows": [{ "anon_execute": false, "authenticated_execute": false, "service_role_execute": true }] }
```
**Grants — `aclexplode` (no `PUBLIC` grantee):**
```sql
SELECT r.rolname AS grantee, a.privilege_type
FROM pg_proc p, LATERAL aclexplode(p.proacl) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE p.proname = 'claim_media_nudge';
```
```
{ "rows": [{ "grantee": "postgres", "privilege_type": "EXECUTE" }, { "grantee": "service_role", "privilege_type": "EXECUTE" }] }
```
Only `postgres` (owner) and `service_role` — no `PUBLIC`, `anon`, or
`authenticated` grant.

**Function-body hash, paired.** Database:
```sql
SELECT md5(prosrc) AS body_md5, length(prosrc) AS body_len FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "body_md5": "2c94faf15368bbe82d3a03508a7d53fe", "body_len": 3767 }] }
```
File (same extraction method as the test-db apply — the literal text
between the `$fn$...$fn$` delimiters, matching Postgres's own `prosrc`
capture exactly, leading/trailing newline included):
```
local len: 3767
local md5: 2c94faf15368bbe82d3a03508a7d53fe
```
Matches the expected value (`2c94faf15368bbe82d3a03508a7d53fe`) and the
database's own hash, exactly.

**Smoke test, inside `BEGIN ... ROLLBACK` only.** First attempt used
`MATERIALIZED` CTEs with FROM-clause co-references to force ordering
between the two `claim_media_nudge` calls and the reads between them —
this returned zero rows: Postgres does not guarantee execution order
between sibling CTEs from a bare `FROM` co-reference (no real per-row
join condition), so the count-of-sessions subquery could be — and was —
evaluated before the volatile function call actually ran. Verified this
diagnosis directly (a debug query showed `first_claim_value: true` but
`session_row_count: 0` in the same statement) before rewriting the test
using a `DO` block (strictly sequential by construction) that writes its
captured values into a `TEMP TABLE`, then a final `SELECT` from that
table — the shape already proven safe by a preceding dry run (a `TEMP
TABLE` insert-then-rollback, and a real-table insert-then-rollback into
`whatsapp_sessions` itself, both confirmed to leave zero rows in a
genuinely separate subsequent connection before this smoke test was run
for real):

Pre-check, no existing row for the disposable phone:
```sql
SELECT count(*) AS existing_rows FROM whatsapp_sessions WHERE phone_number = '+19995559999';
```
```
{ "rows": [{ "existing_rows": 0 }] }
```

```sql
BEGIN;
CREATE TEMP TABLE smoke_test_result (first_claim boolean, second_claim boolean, updated_at_after_first timestamptz, updated_at_after_second timestamptz, context_after_first jsonb, context_after_second jsonb);
DO $$
DECLARE v_tenant_id uuid; v_first boolean; v_second boolean; v_ua1 timestamptz; v_ctx1 jsonb; v_ua2 timestamptz; v_ctx2 jsonb;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  v_first := claim_media_nudge('+19995559999', v_tenant_id, NULL, now(), 300);
  SELECT updated_at, context INTO v_ua1, v_ctx1 FROM whatsapp_sessions WHERE phone_number = '+19995559999';
  v_second := claim_media_nudge('+19995559999', v_tenant_id, NULL, now(), 300);
  SELECT updated_at, context INTO v_ua2, v_ctx2 FROM whatsapp_sessions WHERE phone_number = '+19995559999';
  INSERT INTO smoke_test_result VALUES (v_first, v_second, v_ua1, v_ua2, v_ctx1, v_ctx2);
END $$;
SELECT first_claim, second_claim, updated_at_after_first, updated_at_after_second,
       (updated_at_after_first = updated_at_after_second) AS updated_at_unchanged,
       context_after_first, context_after_second
FROM smoke_test_result;
ROLLBACK;
```
```
{
  "rows": [
    {
      "first_claim": true,
      "second_claim": false,
      "updated_at_after_first": "2026-09-15 17:02:30.045937+00",
      "updated_at_after_second": "2026-09-15 17:02:30.045937+00",
      "updated_at_unchanged": true,
      "context_after_first": { "last_media_nudge_at": "2026-09-15T17:02:30.045937+00:00" },
      "context_after_second": { "last_media_nudge_at": "2026-09-15T17:02:30.045937+00:00" }
    }
  ]
}
```
First claim `true`, second `false`, `updated_at` byte-identical across
both — exactly as designed. Then, in a genuinely separate connection
(after `ROLLBACK`), zero rows persist:
```sql
SELECT count(*) AS row_count_after_rollback FROM whatsapp_sessions WHERE phone_number = '+19995559999';
```
```
{ "rows": [{ "row_count_after_rollback": 0 }] }
```
No row for `+19995559999` (or anything else) was left on prod by this
apply's own verification.

## e. Ledger repair

Before (§b): `045` → `local=045`, `remote=""`.
```
$ supabase migration repair --status applied 045 --linked
Repaired migration history: [045] => applied
{"versions":["045"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
```
After:
```
$ supabase migration list --linked
{"migrations":[...,{"local":"044","remote":"044","time":"044"},{"local":"045","remote":"045","time":"045"}],"message":"Migrations listed"}
```
`045`: `local=045`, `remote=045`. Prod's ledger is now clean, gapless,
001 through 045.

## f. Relink to test-db

```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}

$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
```
CLI left pointed at test-db, not prod, at the end of this session.

## WhatsApp end-to-end proof

**OWED (Aravind — burst of 3 idle photos → 1 reply).** Everything above
verifies the function and its grants/hash/lock behavior directly against
the database; it does not exercise the real webhook → `handleIdlePhoto` →
`claimMediaNudge` path against a real WhatsApp number. That live
end-to-end check — sending three idle photos in a burst and confirming
exactly one nudge reply arrives — is Aravind's own next step, not
performed in this session.

## Summary

- Applied: `claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)`, `jvxwqignooseazzmwhvl` (prod).
- Grants: `service_role` only (plus owner `postgres`); `PUBLIC`/`anon`/`authenticated` all false/absent.
- `prosecdef=true`, `search_path=public`.
- Body hash paired and matching: `2c94faf15368bbe82d3a03508a7d53fe`.
- No trigger on `whatsapp_sessions`.
- Smoke test (`BEGIN...ROLLBACK`): first claim true, second false, `updated_at` unchanged across both, zero rows persisted afterward.
- Ledger repaired: `045` now `local=045`/`remote=045`, prod gapless 001-045.
- CLI relinked to test-db (`exfccwlrhoutkgrlikod`) at session end.
- PITR observed live before this apply (§ top); CI proof pinned to the exact merged SHA (§ top).
- WhatsApp end-to-end proof: **OWED** (Aravind).
