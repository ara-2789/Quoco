# Migration 047 — PROD apply record (2026-09-17)

FULL TIER apply. Target: `jvxwqignooseazzmwhvl` (prod). Authorised by Aravind
for this ref only, this task. Every command below was preceded by a printed
`cat supabase/.temp/project-ref` confirming the linked project; those prints
are reproduced verbatim alongside each command.

## Source

```
$ git fetch origin
(no output)
$ git log origin/main --oneline -5
65da736 Add migration 047: revoke unused table rights from anon/authenticated (#282)
f622621 CLAUDE.md: pre-launch two-tier change process (#284)
a31340b Stage 4: attach photos to the Owner DPR email (#283)
c623ddb docs(046): production apply record (#281)
ecf6105 Add migration 046: hindrances.report_date (generated IST date) (#280)
```

`65da736` confirmed on `origin/main`.

```
$ git rev-parse 65da736:supabase/migrations/047_revoke_unused_table_rights.sql
f81b3a521f8a6243b30e6275656f48604e4ce37b
$ git rev-parse 1371f90:supabase/migrations/047_revoke_unused_table_rights.sql
f81b3a521f8a6243b30e6275656f48604e4ce37b
```

Blobs identical. Apply performed from a clean, detached checkout of
`origin/main` (`65da7367e0fe685310a6b261ccaa967cb893d43c`), `git status
--short` empty.

## PITR

Observed by Aravind in the dashboard before this apply (not independently
observed by this session): **restore window 10 Sep 2026 22:02:00 to 17 Sep
2026 09:40:02 IST.** Recorded exactly as supplied.

## CI proof (fold 4)

Run: https://github.com/ara-2789/Quoco/actions/runs/35179571418, at
`1371f905acb9b59a752170e224c1e10c8766fd28`, attempt 2 (attempt 1 failed on
network errors, "fetch failed" — unrelated to 047). `test/migration-047.test.ts`
passed; 106/106 files. PR #282 merged as `65da7367e0fe685310a6b261ccaa967cb893d43c`.

## Test-db rehearsal (prior work, referenced not repeated)

Test-db DOWN rehearsal 2026-09-16: diffs described in the test-db record, raw
diff not pasted; final state independently confirmed by Aravind's query
(0/0/1). Full record: `docs/reviews/047-test-db-apply-record.md`.

## Step 1 — link

```
$ supabase link --project-ref jvxwqignooseazzmwhvl
{"project_ref":"jvxwqignooseazzmwhvl","message":""}
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
```

## Step 2 — pre-probes (prod, read-only)

### Migration ledger

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
$ supabase migration list --linked
```
`047` returned `{"local":"047","remote":"","time":"047"}` — every other
version 001-046 had matching local/remote. 047 confirmed NOT remote-applied.

### §1e relacl (expect 55 rows)

Query (verbatim from `docs/reviews/047-review-package.md` §1e):
```sql
select c.relname, pg_get_userbyid(a.grantee) as role, string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public' and c.relkind = 'r'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated')
  and a.privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
group by 1, 2 order by 1, 2;
```
Result: **55 rows** (27 `anon`, 28 `authenticated`), matching the DOWN
block's GRANT list table-for-table and matching the test-db capture exactly.
Full raw JSON preserved in this session's scratch output
(`prod047_pre_1e_relacl_output.json`); row/role counts independently
verified via `grep -c`.

### 1a. polcmd='d' policies (expect 17)

Query (verbatim from §1a):
```sql
SELECT c.relname AS table_name, pol.polname, pol.polroles::regrole[] AS roles,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr,
       pol.polpermissive AS is_permissive
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND pol.polcmd = 'd'
ORDER BY c.relname, pol.polname;
```
Result: **17 rows**, same 17 policy names/USING expressions as §1a's own
test-db capture (`boq_items_delete` ... `whatsapp_sessions_delete`, all
`{authenticated}`, all permissive, all `with_check_expr` null). Matches
DOWN block's CREATE POLICY texts.

### 1c. pg_default_acl (expect anon/authenticated arwdDxtm)

Query (verbatim from §1c):
```sql
SELECT r.rolname AS owner_role, n.nspname AS schema_name,
       d.defaclobjtype AS objtype, d.defaclacl AS acl
FROM pg_default_acl d
JOIN pg_roles r ON r.oid = d.defaclrole
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY r.rolname, n.nspname, d.defaclobjtype;
```
For `owner_role=postgres`, `schema=public`, `objtype=r`:
```
"acl": "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"
```
`anon`/`authenticated` both `arwdDxtm` pre-apply, as expected.

### service_role aclexplode (captured for post-apply diff)

Same query shape as §1e, filtered to `grantee = 'service_role'`. **32 rows**
captured pre-apply (`prod047_pre_service_role_acl_output.json`) — includes
the deliberately-narrower rows for `daily_log_photos`, `hindrance_photos`,
`outbound_sends`, `owner_email_verifications` (INSERT/SELECT/UPDATE only,
per migrations 031/043/044/034's own tombstone-table design), all other
tables the full DELETE/INSERT/MAINTAIN/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE
set.

### Fold 1 (expect 0)

```sql
SELECT p.proname, n.nspname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = false
  AND p.prosrc ILIKE '%DELETE%';
```
Result: `"rows": []` — 0 rows.

### Helper absence (expect 0)

```sql
SELECT p.proname, n.nspname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'quoco_test_047_unused_rights_check';
```
Result: `"rows": []` — 0 rows. `scripts/test-db-only-047-rights-check.sql`
was never applied to prod, per its own header — confirmed by this absence,
not by trusting the header alone.

### Role identity

```sql
SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper;
```
Result: `{"current_user": "postgres", "rolsuper": false}` — matches expectation.

All pre-probes matched expectation. No STOP condition triggered.

## Step 3 — apply

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
$ supabase db query --linked -f supabase/migrations/047_revoke_unused_table_rights.sql
{"boundary": "1e15c5ee1b2092e3fb27626b264ed66c", "rows": [], "warning": "..."}
```
No error. The migration's own final `DO $$ ... $$` block (which
`RAISE EXCEPTION`s on any leftover grant or `polcmd='d'` policy, verified via
`pg_class.relacl`/`aclexplode()`, never `information_schema`) passed silently.

## Step 4 — verify

- relacl re-run: **0 rows** (was 55).
- polcmd='d' re-run: **0 rows** (was 17).
- pg_default_acl, `postgres`/`public`/`r`: `{postgres=arwdDxtm/postgres,anon=arw/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}` — `anon`/`authenticated` reduced to `arw`; `postgres` and `service_role` unchanged at `arwdDxtm`.
- service_role aclexplode re-captured and diffed against the pre-apply capture: `diff` shows only the two per-query `"boundary"` correlation-token lines differing — the `rows` payload (32 rows) is byte-identical. `service_role` untouched (D6), confirmed by observation.
- Behaviour check, inside `BEGIN … ROLLBACK`:
  ```sql
  BEGIN;
  SET LOCAL ROLE authenticated;
  DELETE FROM public.hindrances WHERE false;
  ROLLBACK;
  ```
  Result: `ERROR: 42501: permission denied for table hindrances` (HINT: `Grant the required privileges to the current role with: GRANT DELETE ON public.hindrances TO authenticated;`) — the expected, required outcome, not a failure.
- Helper re-checked: **0 rows**. Still absent.

## Step 5 — ledger

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
$ supabase migration repair --status applied 047 --linked
Repaired migration history: [047] => applied
{"versions":["047"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
$ supabase migration list --linked
```
`047` now `{"local":"047","remote":"047","time":"047"}`. Local = remote,
no gap.

## Step 6 — types

```
$ npx supabase gen types typescript --linked --schema public > <temp file>
```
Diff against committed `types/database.ts`: exactly one difference —
`quoco_test_row_is_locked` (a test-db-only diagnostic function, present in
the committed file, absent from prod's own generation) — the SAME
pre-existing, unrelated gap already documented at migration 046's own prod
apply (`docs/reviews/046-apply-record.md`). Nothing from 047 itself appears
in the diff (047 touches only grants/RLS, no table/column/function
signature change). `types/database.ts` was **not** overwritten, per
instruction — report only.

## Step 7 — relink

```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}
$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
```
Confirmed relinked to test-db.

## Outcome

Migration 047 is live on prod (`jvxwqignooseazzmwhvl`), ledgered, verified
by observation on every dimension the migration touches (table grants,
DELETE policies, default ACL, `service_role` untouched, behavioural
`authenticated` DELETE denial). `scripts/test-db-only-047-rights-check.sql`
was never applied to prod, confirmed by absence, not by trusting its own
header.
