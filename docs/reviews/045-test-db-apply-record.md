# Migration 045 — TEST-DB APPLY RECORD (2026-09-15)

**TEST-DB ONLY — PROD APPLY PENDING.** This document records applying
`claim_media_nudge` (migration 045) to `exfccwlrhoutkgrlikod` (test-db)
only. **Prod (`jvxwqignooseazzmwhvl`) was never written to, linked for a
write, or otherwise touched in this round** — the only prod-facing calls
made were read-only account-level listings (`supabase projects list`,
`supabase branches list --project-ref jvxwqignooseazzmwhvl`) used solely to
discover that this account has test-db access at all; see §0 below.
Companion documents: `docs/reviews/045-review-brief.md` (the design
review, cleared at head `6cae54a3`, folded per commits `7869b74`/`db94be9`)
and `supabase/migrations/045_media_nudge_throttle.sql` (the applied file
itself).

Everything below is a live, first-hand transcript from this session —
every command was actually run, in order, and its raw output pasted
verbatim (`Initialising login role...`/`Connecting to remote database...`
banner lines from the `supabase` CLI kept in place, not trimmed).

## 0. How test-db access was established

This environment has no `.env.test`/`.env.local` and no
`SUPABASE_TEST_*` env vars set — the same gap this branch's own earlier
rounds recorded. What it DOES have is a `supabase` CLI already
authenticated via the macOS Keychain (`security find-generic-password -s
"Supabase CLI"` resolves an entry; the token itself was never printed,
per this project's own credential-safety discipline). This is a
machine-level credential, not something scoped to this worktree's own
files.

```
$ supabase projects list
{"projects":[{"id":"jvxwqignooseazzmwhvl","ref":"jvxwqignooseazzmwhvl","organization_id":"dfsussvldqxngzkuaraw","organization_slug":"dfsussvldqxngzkuaraw","name":"Quoco","region":"ap-southeast-2","created_at":"2026-06-15T12:58:12.021353Z","status":"ACTIVE_HEALTHY","database":{"host":"db.jvxwqignooseazzmwhvl.supabase.co","version":"17.6.1.127","postgres_engine":"17","release_channel":"ga"},"linked":false}],"message":""}
```
Only the top-level prod project is listed. Test-db is a Supabase branch of
that project, not a separate top-level project, so it does not appear
here — confirmed by listing branches instead:

```
$ supabase branches list --project-ref jvxwqignooseazzmwhvl
{"branches":[{"id":"b502de63-612e-45af-83cb-e9bf7a88e53d","name":"main","project_ref":"jvxwqignooseazzmwhvl","parent_project_ref":"jvxwqignooseazzmwhvl","is_default":true,"persistent":false,"status":"FUNCTIONS_DEPLOYED","created_at":"2026-07-05T15:48:35.245699+00:00","updated_at":"2026-07-05T15:48:35.245699+00:00","with_data":false,"preview_project_status":"ACTIVE_HEALTHY"},{"id":"47f52b48-23a7-4a47-929a-85b4fdb7dbf8","name":"test-db","project_ref":"exfccwlrhoutkgrlikod","parent_project_ref":"jvxwqignooseazzmwhvl","is_default":false,"persistent":false,"status":"FUNCTIONS_DEPLOYED","created_at":"2026-07-05T15:48:35.337743+00:00","updated_at":"2026-07-05T15:55:55.925148+00:00","with_data":false,"preview_project_status":"ACTIVE_HEALTHY"}]}
```
The `"test-db"` branch's `project_ref` (`exfccwlrhoutkgrlikod`) is exactly
`test/setup/guard.ts`'s own `ALLOWED_TEST_REF` — the one project this
whole codebase's own test suite is allowed to touch. Both `branches list`
calls above are read-only (list operations); neither wrote to prod or any
branch of it.

## a. Confirm target

```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}

$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
```
`exfccwlrhoutkgrlikod` — the test-db ref, not `jvxwqignooseazzmwhvl`
(prod). Independently confirmed with a live SQL probe (never a printed
credential — `current_database()`/`now()` only):
```
$ supabase db query --linked -f probe-identity.sql   # SELECT current_database(), now(), inet_server_addr();
{
  "rows": [
    { "current_database": "postgres", "inet_server_addr": "2406:da1c:4c7:f800::9b00", "now": "2026-09-15 15:07:47.888224+00" }
  ]
}
```
And the migration ledger itself, matching test-db's own known history
(001-041 present on both sides; see §f for the 042-044 ledger-gap
observation, unrelated to this apply):
```
$ supabase migration list --linked
{"migrations":[...,{"local":"041","remote":"041","time":"041"},{"local":"042","remote":"","time":"042"},{"local":"043","remote":"","time":"043"},{"local":"044","remote":"","time":"044"}]}
```

## b. Pre-probe: claim_media_nudge does not exist

```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'claim_media_nudge';
```
```
$ supabase db query --linked -f probe-preapply.sql
{ "rows": [] }
```
Zero rows.

**Aside, not part of this apply, recorded because it turned up during
reconnaissance**: the same `migration list` output above shows `042`,
`043`, `044` with an empty `remote` cell — a LEDGER gap, not a schema
gap. Checked directly, all three objects those migrations create already
exist on test-db:
```sql
SELECT 'hindrance_photos' AS check, EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hindrance_photos') AS present
UNION ALL SELECT 'daily_log_photos', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_log_photos')
UNION ALL SELECT 'storage.buckets daily-log-photos', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'daily-log-photos');
```
```
{ "rows": [
  {"check":"hindrance_photos","present":true},
  {"check":"daily_log_photos","present":true},
  {"check":"storage.buckets daily-log-photos","present":true}
]}
```
Not repaired here — out of scope for this task, which is 045 only. Named
so it isn't mistaken for a new finding by whoever next touches those
numbers.

## c. Move the file, update the reservation, prove content unchanged

```
$ md5 -q docs/reviews/045_media_nudge_throttle.sql
a3a6524a893e6c961ee99572bc5e9809

$ git mv docs/reviews/045_media_nudge_throttle.sql supabase/migrations/045_media_nudge_throttle.sql

$ md5 -q supabase/migrations/045_media_nudge_throttle.sql
a3a6524a893e6c961ee99572bc5e9809

$ git diff --stat HEAD -- supabase/migrations/045_media_nudge_throttle.sql docs/reviews/045_media_nudge_throttle.sql
 {docs/reviews => supabase/migrations}/045_media_nudge_throttle.sql | 0
 1 file changed, 0 insertions(+), 0 deletions(-)
```
Identical hash before and after the move; git itself reports zero
insertions/deletions for the rename. `scripts/migration-number-
reservations.json`'s own 045 entry gained one appended "DATED CORRECTION"
sentence (via targeted string replacement, not a full-file rewrite —
`git diff --stat` shows exactly one line changed):
```
$ git diff --stat scripts/migration-number-reservations.json
 scripts/migration-number-reservations.json | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```
Full text of the appended correction: "DATED CORRECTION (2026-09-15):
APPLIED TO TEST-DB ONLY (exfccwlrhoutkgrlikod) -- NOT applied to prod.
The signature above is now stale: two external-review folds (commits
7869b74, db94be9) added a p_test_sleep_ms parameter before this apply, so
the live signature is claim_media_nudge(text, uuid, uuid, timestamptz,
integer, integer), not the 5-argument form this note originally
described -- file contents were verified byte-identical (md5
a3a6524a893e6c961ee99572bc5e9809) across the docs/reviews/ ->
supabase/migrations/ move, so this is a staleness in this note's own
prose, not a drift between what was reviewed and what was applied. File
moved to supabase/migrations/045_media_nudge_throttle.sql per CLAUDE.md's
own \"migration file enters supabase/migrations/ when applied\" rule.
Full apply sequence: docs/reviews/045-test-db-apply-record.md."

```
$ node scripts/lint-migrations.mjs
migration-lint: clean. 97 known violation(s), all exempted.
```

## d. Apply

```
$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
$ supabase db query --linked -f supabase/migrations/045_media_nudge_throttle.sql
{ "rows": [] }
```
No error. Ref printed immediately before the apply, in the same output,
per CLAUDE.md's own apply discipline.

## e. Verify by observation

**Exactly one signature:**
```sql
SELECT oid, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "oid": 20327, "args": "p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_now timestamp with time zone, p_window_seconds integer, p_test_sleep_ms integer" }] }
```

**`prosecdef` / `proconfig`:**
```sql
SELECT oid, prosecdef, proconfig FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "oid": 20327, "prosecdef": true, "proconfig": ["search_path=public"] }] }
```

**Four-way grants matrix.** `has_function_privilege('PUBLIC', ...)`
errors (`role "PUBLIC" does not exist` — PUBLIC is a pseudo-role, not a
real one `has_function_privilege` accepts as a string), so PUBLIC is
checked via `aclexplode` grantee inspection instead, alongside the three
real roles:
```sql
SELECT has_function_privilege('anon', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', 'public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)', 'EXECUTE') AS service_role_execute;
```
```
{ "rows": [{ "anon_execute": false, "authenticated_execute": false, "service_role_execute": true }] }
```
```sql
SELECT r.rolname AS grantee, a.privilege_type
FROM pg_proc p, LATERAL aclexplode(p.proacl) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE p.proname = 'claim_media_nudge';
```
```
{ "rows": [{ "grantee": "service_role", "privilege_type": "EXECUTE" }, { "grantee": "postgres", "privilege_type": "EXECUTE" }] }
```
Only `service_role` (plus the owning role `postgres`, standard/expected)
holds EXECUTE. `PUBLIC`, `anon`, `authenticated` all false/absent.

**Function-body hash, paired file vs. database.** DB side:
```sql
SELECT md5(prosrc) AS body_md5, length(prosrc) AS body_len FROM pg_proc WHERE proname = 'claim_media_nudge';
```
```
{ "rows": [{ "body_md5": "2c94faf15368bbe82d3a03508a7d53fe", "body_len": 3767 }] }
```
File side (Python, extracting the exact text between the `$fn$...$fn$`
delimiters — Postgres's own `prosrc` capture is verbatim between those
markers, leading/trailing newline included, which a first naive
extraction attempt initially missed — length 3765 vs 3767 — before the
boundary was corrected to match Postgres's own capture exactly):
```
local len: 3767 db len: 3767
local md5: 2c94faf15368bbe82d3a03508a7d53fe
db md5: 2c94faf15368bbe82d3a03508a7d53fe
MATCH: True
```

**No trigger on `whatsapp_sessions`:**
```sql
SELECT tgname, tgrelid::regclass AS table_name FROM pg_trigger WHERE tgrelid = 'whatsapp_sessions'::regclass AND NOT tgisinternal;
```
```
{ "rows": [] }
```

**Smoke call**, disposable phone `+19998887777`:
```sql
SELECT claim_media_nudge('+19998887777', (SELECT id FROM tenants LIMIT 1), NULL, now(), 300) AS first_claim;
```
```
{ "rows": [{ "first_claim": true }] }
```
```sql
SELECT updated_at, context FROM whatsapp_sessions WHERE phone_number = '+19998887777';
```
```
{ "rows": [{ "updated_at": "2026-09-15 15:14:42.780145+00", "context": {"last_media_nudge_at": "2026-09-15T15:14:42.780145+00:00"} }] }
```
Immediate second call:
```sql
SELECT claim_media_nudge('+19998887777', (SELECT id FROM tenants LIMIT 1), NULL, now(), 300) AS second_claim;
```
```
{ "rows": [{ "second_claim": false }] }
```
Re-read `updated_at`/`context` — byte-identical to before the second call:
```
{ "rows": [{ "updated_at": "2026-09-15 15:14:42.780145+00", "context": {"last_media_nudge_at": "2026-09-15T15:14:42.780145+00:00"} }] }
```
`updated_at` unchanged across both calls (`2026-09-15 15:14:42.780145+00`
both times), exactly as designed. Cleanup:
```sql
DELETE FROM whatsapp_sessions WHERE phone_number = '+19998887777';
SELECT count(*) FROM whatsapp_sessions WHERE phone_number = '+19998887777';
```
```
{ "rows": [{ "count": 0 }] }
```
Test row removed.

## f. Ledger

Before:
```
$ supabase migration list --linked
...,{"local":"044","remote":"","time":"044"},{"local":"045","remote":"","time":"045"}
```
Repair:
```
$ supabase migration repair --status applied 045 --linked
Repaired migration history: [045] => applied
{"versions":["045"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
```
After:
```
$ supabase migration list --linked
...,{"local":"044","remote":"","time":"044"},{"local":"045","remote":"045","time":"045"}
```
`045` now shows `local=045`, `remote=045`. `042`/`043`/`044` are
unchanged by this apply — their own ledger gap (§b's aside) is a
pre-existing, separate matter, not touched here.

## g. Types regeneration

```
$ npx supabase gen types typescript --linked --schema public > new-database-types.ts
$ diff types/database.ts new-database-types.ts
2202a2203,2213
>       claim_media_nudge: {
>         Args: {
>           p_now?: string
>           p_phone_number: string
>           p_tenant_id: string
>           p_test_sleep_ms?: number
>           p_user_id?: string
>           p_window_seconds?: number
>         }
>         Returns: boolean
>       }
```
Exactly one new `Functions` entry, nothing else changed — applied to
`types/database.ts`, committed alongside this record.

**`tsc --noEmit` sanity check**: two pre-existing `RejectExcessProperties`
errors (`lib/media/ingest.ts:155`, `lib/whatsapp/inbound-start.ts:835`)
were confirmed, by temporarily stashing this round's own changes and
re-running `tsc` against the UN-regenerated baseline, to already exist
before this apply and before this round touched anything — unrelated to
`claim_media_nudge` or this types diff, not introduced or fixed here, out
of scope for this task. With the regenerated types restored, `tsc
--noEmit` reproduces exactly those same two errors and no others — the
`claim_media_nudge` RPC-name error that existed against the OLD types
(before this update) is gone, as expected.

## Summary

- Applied: `claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer)`, `exfccwlrhoutkgrlikod` (test-db) only.
- Grants: `service_role` only (plus owner `postgres`); `PUBLIC`/`anon`/`authenticated` all false/absent.
- `prosecdef=true`, `search_path=public`.
- Body hash paired and matching: `2c94faf15368bbe82d3a03508a7d53fe`.
- No trigger on `whatsapp_sessions`.
- Smoke call: first claim true, immediate second false, `updated_at` unchanged across both, test row deleted.
- Ledger repaired: `045` now `local=045`/`remote=045`.
- Types regenerated, one new `Functions` entry, committed.
- **Prod (`jvxwqignooseazzmwhvl`) never linked for a write, never queried beyond two read-only account-level listings, never touched.**
- **NOT applied to prod. That apply is a separate, future, explicitly-authorized step.**
