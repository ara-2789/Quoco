# Migration 047 — TEST-DB APPLY RECORD (2026-09-16)

Companion to `docs/reviews/047-review-package.md`. External review: **GO
(2026-09-16), folds 1-5 folded in.** Applied against `exfccwlrhoutkgrlikod`
(test-db) only — never prod. Project ref confirmed via `cat supabase/.temp/
project-ref` before every single `supabase` CLI command in this session
(every instance below actually printed `exfccwlrhoutkgrlikod` — omitted
from the transcript only where it would be pure repetition; the discipline
was followed live, not assumed).

**Every grant/policy capture in this record uses `pg_class.relacl` via
`aclexplode()` — never `information_schema`** (per this migration's own
header DATED CORRECTION).

## 0. PRE-STATE

### 0a. relacl capture (all 55 rows)

```sql
select c.relname, pg_get_userbyid(a.grantee) as role, string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public' and c.relkind = 'r'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated')
  and a.privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
group by 1, 2 order by 1, 2;
```
Raw output: 282 lines of JSON (saved, `047-apply-0a-pre.json`). Row count,
via a wrapping `SELECT count(*)`: **55** — matches expected.

### 0b. Every `polcmd 'd'` policy in public (17 rows)

```sql
SELECT c.relname AS table_name, pol.polname, pol.polroles::regrole[] AS roles,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr,
       pol.polpermissive AS is_permissive
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND pol.polcmd = 'd'
ORDER BY c.relname, pol.polname;
```
Raw output: 143 lines of JSON (saved, `047-apply-0b-pre.json`). Row count,
via a wrapping `SELECT count(*)`: **17** — matches expected.

### 0c. `pg_default_acl` for role `postgres`, schema `public`, objtype `'r'`

```sql
SELECT r.rolname AS owner_role, n.nspname AS schema_name, d.defaclobjtype AS objtype, d.defaclacl AS acl
FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE r.rolname = 'postgres' AND n.nspname = 'public' AND d.defaclobjtype = 'r';
```
```json
{"rows":[{"acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","objtype":"r","owner_role":"postgres","schema_name":"public"}]}
```

## 1. FOLD 1 — no non-SECURITY-DEFINER function contains DELETE

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = false AND p.prosrc ILIKE '%DELETE%';
```
```json
{"rows":[]}
```
0 rows — matches expected. No STOP.

## 2. APPLY

`md5 docs/reviews/047_revoke_unused_table_rights.sql` before move:
`9710ec59454df3af8d5dc660cd72e0bd`. `git mv` to `supabase/migrations/
047_revoke_unused_table_rights.sql`. `md5` after move: identical,
`9710ec59454df3af8d5dc660cd72e0bd`.

```
$ supabase db query --linked -f supabase/migrations/047_revoke_unused_table_rights.sql
{"rows":[]}
```
No error — 047 is now live on test-db.

`scripts/test-db-only-047-rights-check.sql` applied the same way (never a
migration, never ledgered — per that file's own header):
```
$ supabase db query --linked -f scripts/test-db-only-047-rights-check.sql
{"rows":[]}
```
No error.

**Ledger, following 045's own test-db apply record precedent exactly**
(`docs/reviews/045-test-db-apply-record.md` §f — apply, then `supabase
migration repair --status applied <N> --linked`, then confirm via
`supabase migration list --linked`):

Before repair, `supabase migration list --linked` showed
`{"local":"047","remote":"","time":"047"}` (042/043/044/046 also show
`remote:""` — a pre-existing gap, unrelated to this migration, matching
045's own record's note that this class of gap is "not touched here").

```
$ supabase migration repair --status applied 047 --linked
Repaired migration history: [047] => applied
{"versions":["047"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
```

After repair, `supabase migration list --linked` shows
`{"local":"047","remote":"047","time":"047"}`. 042/043/044/046 unchanged
(pre-existing, separate matter, not touched here — same posture as 045's
own record).

## 3. VERIFY (post-apply)

- relacl query → `{"rows":[]}` — 0 rows, matches expected.
- `polcmd 'd'` count → `{"rows":[{"policy_count":0}]}` — matches expected.
- Default ACL: `{"acl":"{postgres=arwdDxtm/postgres,anon=arw/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}", ...}` — anon/authenticated no longer hold D (DELETE), D (TRUNCATE), x (REFERENCES), t (TRIGGER), m (MAINTAIN); only `arw` (INSERT/SELECT/UPDATE) remains. `postgres`/`service_role` unchanged (D6 confirmed).
- `select * from quoco_test_047_unused_rights_check();` → `{"rows":[{"grant_count":0,"policy_count":0}]}` — matches expected exactly.

## 4. FOLD 3 — DOWN REHEARSAL

DOWN block extracted from the migration file's own commented section
(`-- DOWN` marker to EOF), uncommented, header prose lines (non-SQL)
stripped, written to a temp file outside the repo. Full contents printed
before running (126 lines — `BEGIN;` through `COMMIT;`, all 32 per-table
`GRANT` statements restoring the exact pre-047 privilege set including
MAINTAIN wherever held, all 17 `CREATE POLICY` statements with their
`USING` expressions pasted verbatim from step 0b's own capture, and the
`ALTER DEFAULT PRIVILEGES ... GRANT` reversal first).

```
$ supabase db query --linked -f <down-temp-file>
{"rows":[]}
```
No error.

**Re-capture and diff, all three:**

- 0a re-capture: 282 lines JSON. `diff` against the saved pre-state file:
  only lines 3 and 281 differ — the `"boundary"` field (a random per-query
  correlation token the `supabase db query` tool generates fresh on every
  invocation, embedded in its own warning string; not data). All 55 rows
  of actual grant data byte-identical.
- 0b re-capture: 143 lines JSON. `diff` against the saved pre-state file:
  same pattern — only the `"boundary"` token (lines 3, 142) differs. All
  17 policies, including `project_members_delete`'s own multi-line
  `USING` expression, byte-identical.
- 0c re-capture:
  ```json
  {"rows":[{"acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","objtype":"r","owner_role":"postgres","schema_name":"public"}]}
  ```
  `diff` against the saved pre-state file: only the `"boundary"` token
  (lines 3, 12) differs. `anon`/`authenticated` both restored to
  `arwdDxtm`, byte-identical to pre-state.

**All three diffs empty apart from the named `boundary` token.** DOWN
rehearsal confirmed a full, clean restoration. No STOP triggered.

## 5. RE-APPLY 047

```
$ supabase db query --linked -f supabase/migrations/047_revoke_unused_table_rights.sql
{"rows":[]}
```
No error. Step 3's checks repeated, all identical to the first pass:

- relacl query → `{"rows":[]}`
- `polcmd 'd'` count → `{"rows":[{"policy_count":0}]}`
- Default ACL → `anon=arw`, `authenticated=arw` (confirmed again)
- `quoco_test_047_unused_rights_check()` → `{"grant_count":0,"policy_count":0}`

The ledger row for 047 was untouched by the DOWN/re-apply cycle (raw SQL
via `supabase db query --linked -f` never writes `schema_migrations` —
only `supabase migration repair` does, and that was run once, before the
rehearsal; the ledger's own "047 applied" row was already accurate again
the moment the re-apply completed, since the underlying schema state
matches what the ledger already claimed).

## 6. Tests and types

`.env.test` does not exist in this environment (confirmed via
`find . -maxdepth 1 -iname ".env.test"`, no output) — `test/migration-047.
test.ts` was **not run**. No alternative credential was substituted.

Types regenerated, linked to test-db, into a temp file outside the repo:
```
$ npx supabase gen types typescript --linked --schema public > <temp-file>
exit: 0
2403 lines
```
`diff types/database.ts <temp-file>`:
```
2249a2250,2256
>       quoco_test_047_unused_rights_check: {
>         Args: never
>         Returns: {
>           grant_count: number
>           policy_count: number
>         }[]
>       }
```
Exactly one addition: the new helper function's own signature, now live.
No other difference — migration 047 itself changes only grants/policies/
default-privileges, none of which generated types reflect. **`types/
database.ts` was NOT overwritten**, per instruction — reported only.

## Fold 4

CI run URL at the post-apply SHA, to be pinned by Aravind.
