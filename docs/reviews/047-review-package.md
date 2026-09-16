# Migration 047 — REVIEW PACKAGE (2026-09-16)

Companion to `docs/reviews/047_revoke_unused_table_rights.sql` (the
migration itself, held in `docs/reviews/` per CLAUDE.md's own "a migration
file enters `supabase/migrations/` when it is being applied, not when it
is written" rule) and `test/migration-047.test.ts` (D4's static source
guard). **This pass writes the migration and this package only — no apply
to any database, test-db included.** Order per Aravind's own D6: external
review → test-db → CI → merge → PITR → prod.

Trips CLAUDE.md's own external review gate on condition (b): grants and
RLS policy changes on existing objects.

## Decisions (Aravind, 2026-09-16, settled)

- **D1.** Revoke TRUNCATE, TRIGGER, REFERENCES, and **MAINTAIN** (addendum,
  2026-09-16) from `anon` and `authenticated` on every table in schema
  `public`.
- **D2.** Revoke DELETE from `anon` and `authenticated` on every table in
  schema `public`, and DROP the DELETE-command RLS policies this leaves
  dead. **Count note:** D2's own prose calls this "the 16 delete
  policies," but its own listed names, and the live policy count captured
  below (step 1), are both **17** — a count-label error in the prose, not
  a set mismatch. Every one of D2's 17 listed names matches a real policy
  1:1 against the live query. Verified, not assumed — see step 1.
- **D3.** `ALTER DEFAULT PRIVILEGES` in schema `public` so new tables do
  not grant TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, or DELETE to `anon`
  or `authenticated` — scoped to `FOR ROLE postgres` only. See "D3 scope"
  below for why.
- **D4.** A DB-level guard extending the no-delete invariant: no table in
  `public` grants DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN to
  `anon`/`authenticated`, and no `polcmd 'd'` policy exists in `public`.
  See "D4 design" below for why this ships as a static source guard, not
  a live vitest query.
- **D5.** `anon` SELECT cleanup is OUT of scope (backlog). SELECT/INSERT/
  UPDATE for any role is untouched.
- **D6.** `service_role` is NEVER touched. Order: external review →
  test-db → CI → merge → PITR → prod.

## The risk this closes

T-023-07's own review record (`docs/reviews/023-review-package.md` §3)
already demonstrated the risk directly, not hypothetically: `SET ROLE
anon; TRUNCATE public.dprs` actually destroyed a seeded row on test-db
(`rows_before=1, rows_after=0`, rolled back, not simulated). TRUNCATE
bypasses RLS's row-level filtering entirely; DELETE only respects RLS
through a path that applies it. The real blast radius of these default
grants is not "an external attacker with an anon key" — it is anyone (or
any compromised/misconfigured client, or a future bug) able to construct
a raw SQL connection as `anon` or `authenticated`.

Step 1's own capture (below) found a **narrower, concrete instance** of
the same exposure: 6 tables (`daily_logs`, `jobs`, `processed_messages`,
`rate_catalog`, `rate_catalog_history`, `tenants`) hold a table-level
DELETE grant for `authenticated` with **no delete RLS policy behind it at
all**. Currently inert only because RLS is enabled and blocks the
operation by default — but a live grant standing on nothing but RLS is
exactly the shape CLAUDE.md's own "a correct RLS policy does not make an
unnecessary grant harmless" principle warns against.

## What this does NOT do

- D5: `anon`'s remaining SELECT/INSERT/UPDATE surface is untouched —
  tracked as backlog, not folded in here.
- **Backlog, named explicitly (per Aravind's addendum):** new functions in
  `public` are still EXECUTE-able by `anon`/`authenticated` by default via
  Postgres's `postgres`-role default ACL (`X` in `pg_default_acl`). Every
  migration since 020 has revoked this by hand, per-function, at CREATE
  time — changing that default is out of 047's scope.
- No sequence USAGE grants are touched.
- `service_role` is never touched (D6) — including on test-db, where
  `scripts/test-db-only-grants.sql` deliberately grants `service_role`
  DELETE on `outbound_sends`/`daily_log_photos` for test cleanup only (a
  documented, standing exception, CLAUDE.md's own "OUTBOUND_SENDS' GRANTS
  NOW DIFFER BETWEEN TEST-DB AND PROD" rule) — this migration does not
  touch, alter, or need to reconcile that.

---

## Step 1 — read-only capture on test-db (exfccwlrhoutkgrlikod)

Project ref confirmed before every command (`cat supabase/.temp/project-ref`
→ `exfccwlrhoutkgrlikod`).

### 1a. Every `polcmd = 'd'` policy in public

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

**17 rows returned** (table: policy, roles, using_expr):

| table | policy | roles | using_expr |
|---|---|---|---|
| boq_items | boq_items_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| boq_sessions | boq_sessions_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| hindrances | hindrances_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| invoices | invoices_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| project_members | project_members_delete | {authenticated} | `(tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text]))` |
| projects | projects_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| ra_bill_payments | ra_bill_payments_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| ra_bills | ra_bills_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| safety_incidents | safety_incidents_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| tender_chat_messages | tender_chat_messages_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| tender_chat_sessions | tender_chat_sessions_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| tender_document_chunks | tender_document_chunks_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| tender_documents | tender_documents_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| tenders | tenders_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| vendor_invoices | vendor_invoices_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| vendors | vendors_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |
| whatsapp_sessions | whatsapp_sessions_delete | {authenticated} | `tenant_id = get_user_tenant_id()` |

All 17 names match D2's own list 1:1 (D2's "16" is a count-label error).
Full raw JSON preserved in this session's own scratch output; every
`with_check_expr` is NULL (all 17 are USING-only, no WITH CHECK), every
policy is PERMISSIVE, targeting `authenticated` only (never `anon`).

### 1b. Table-level and per-table grant matrix (DELETE/TRUNCATE/TRIGGER/REFERENCES, `anon`/`authenticated`)

Summary counts (distinct tables per privilege/role):

| privilege | anon | authenticated |
|---|---|---|
| DELETE | 0 | 23 |
| TRUNCATE | 27 | 28 |
| TRIGGER | 27 | 28 |
| REFERENCES | 27 | 28 |

~~`MAINTAIN`: **0 rows for either role, on any table** — confirmed via
`grep -c "MAINTAIN" <output file>` → `0`. Postgres 17's newest privilege is
not currently granted to `anon`/`authenticated` on test-db at all; D1's
REVOKE for it is a no-op today, included for defense-in-depth and to close
D3's default-privilege gap for it too.~~

**DATED CORRECTION (2026-09-16): MAINTAIN IS held** (relacl: anon 27,
authenticated 28 on prod; test-db per step 1e below, matching exactly).
`information_schema.role_table_grants` does not report `MAINTAIN` — the
`grep -c "MAINTAIN" <output file>` result above was checking the wrong
source, not the wrong database. Rebuilt from `pg_class.relacl` via
`aclexplode()`; see §1e for the full re-capture. D1's REVOKE for MAINTAIN
is therefore a real, live revoke on 27–28 tables, not a no-op.

Full per-table matrix (32 tables; `postgres` is the single distinct owner
of every one — confirmed via `pg_class`/`pg_roles` join):

- **4 tables already fully clean** (zero of the four privileges for
  either role — prior migrations' own `REVOKE ALL`): `daily_log_photos`,
  `hindrance_photos`, `outbound_sends`, `owner_email_verifications`.
- **`dpr_versions`**: `anon` has none of the four; `authenticated` has
  TRUNCATE/TRIGGER/REFERENCES but not DELETE (migration 029's own U1-U5
  hardening).
- **5 tables where `authenticated` lacks DELETE but has the other three**
  (no delete RLS policy, RLS-blocked by default): `checkin_escalations`,
  `daily_log_edits`, `dprs`, `users`, plus `dpr_versions` above.
- **6 tables with a live DELETE grant for `authenticated` but NO delete
  policy** (the "risk this closes" instance above): `daily_logs`, `jobs`,
  `processed_messages`, `rate_catalog`, `rate_catalog_history`, `tenants`.
- **The remaining 17 tables** (exactly the 17 with a delete policy) have
  `anon`: TRUNCATE/TRIGGER/REFERENCES only; `authenticated`: all four
  including DELETE.

`23 (authenticated DELETE) − 17 (delete-policy tables) = 6` — reconciles
exactly with the 6-table list above.

### 1c. `pg_default_acl`

```sql
SELECT r.rolname AS owner_role, n.nspname AS schema_name,
       d.defaclobjtype AS objtype, d.defaclacl AS acl
FROM pg_default_acl d
JOIN pg_roles r ON r.oid = d.defaclrole
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY r.rolname, n.nspname, d.defaclobjtype;
```

For schema `public` (test-db):
- `owner_role=postgres`: sequences (`S`) `rwU` to postgres/anon/authenticated/service_role; functions (`f`) `X` to all four; **tables (`r`) `arwdDxtm` to all four**.
- `owner_role=supabase_admin`: identical shape — sequences `rwU`, functions `X`, **tables `arwdDxtm`** to all four (postgres/anon/authenticated/service_role).

### Prod state (supplied by Aravind, 2026-09-16 — recorded verbatim)

> All public tables are owned by `postgres` (single distinct owner).
> `pg_default_acl` on prod, schema public: `postgres` and `supabase_admin`
> both grant `anon`/`authenticated` `arwdDxtm` on tables, `rwU` on
> sequences, `X` on functions.

**Comparison: test-db vs. prod — NO DIFFERENCE FOUND.** Test-db's own
`pg_default_acl` capture (1c above) matches Aravind's reported prod state
exactly for schema `public`, on every dimension (owner roles, object
types, ACL shape). Table ownership also matches: single owner `postgres`
on both databases.

### 1d. Migration-runner role identity (governs D3's scope)

```sql
SELECT current_user, session_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser;
```
→ `current_user=postgres, session_user=postgres, is_superuser=false`

```sql
SELECT pg_has_role('postgres', 'supabase_admin', 'MEMBER');
```
→ `false`

**Conclusion:** the migration runner connects as `postgres`, is not a
superuser, and is not a member of `supabase_admin`. It can only run
`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` — never
`FOR ROLE supabase_admin`. D3 is scoped accordingly. No Quoco table is
created under `supabase_admin` today (confirmed: single owner `postgres`
on both test-db and prod), so this gap has no live consequence today —
named as a limit for the future, not a current exposure.

### 1e. `pg_class.relacl` re-capture (2026-09-16 correction pass — MAINTAIN)

`information_schema.role_table_grants` does not report `MAINTAIN` — found
live, this correction pass: the original §1b capture (above, now struck
through) read `information_schema` and reported zero `MAINTAIN` grants,
which was wrong about the *source*, not the database. Rebuilt from
`pg_class.relacl` via `aclexplode()`, all five privileges:

```sql
select c.relname, pg_get_userbyid(a.grantee) as role, string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public' and c.relkind = 'r'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated')
  and a.privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
group by 1, 2 order by 1, 2;
```

~~**282 rows returned.**~~

**DATED CORRECTION (2026-09-16): the query returns 55 rows on test-db
(re-run, raw output below) and 55 on prod. "282" was wrong.** That number
was the raw JSON output's *line count* (`wc -l` on the pretty-printed
`supabase db query` response — each row spans ~6 lines of JSON), not the
SQL row count. The actual row count, confirmed via a wrapping `SELECT
count(*)`, is 55 — matching prod's own 55-row capture exactly (anon 27
tables, authenticated 28 tables; authenticated DELETE on 23 tables), and
matching the DOWN block's GRANT list table for table (27 `anon` GRANT
lines + 28 `authenticated` GRANT lines = 55).

Re-run, raw output (`supabase db query --linked -f <the same §1e query>`):

```json
{
  "rows": [
    {"relname": "boq_items", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "boq_items", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "boq_sessions", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "boq_sessions", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "checkin_escalations", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "checkin_escalations", "role": "authenticated", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "daily_log_edits", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "daily_log_edits", "role": "authenticated", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "daily_logs", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "daily_logs", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "dpr_versions", "role": "authenticated", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "dprs", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "dprs", "role": "authenticated", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "hindrances", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "hindrances", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "invoices", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "invoices", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "jobs", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "jobs", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "processed_messages", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "processed_messages", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "project_members", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "project_members", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "projects", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "projects", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "ra_bill_payments", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "ra_bill_payments", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "ra_bills", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "ra_bills", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "rate_catalog", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "rate_catalog", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "rate_catalog_history", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "rate_catalog_history", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "safety_incidents", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "safety_incidents", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tenants", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tenants", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_chat_messages", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_chat_messages", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_chat_sessions", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_chat_sessions", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_document_chunks", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_document_chunks", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_documents", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tender_documents", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tenders", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "tenders", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "users", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "users", "role": "authenticated", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "vendor_invoices", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "vendor_invoices", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "vendors", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "vendors", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "whatsapp_sessions", "role": "anon", "privs": "MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"},
    {"relname": "whatsapp_sessions", "role": "authenticated", "privs": "DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE"}
  ]
}
```

`SELECT count(*)` wrapping the same query → `row_count: 55`.

Every row for `anon` reads `MAINTAIN, REFERENCES,
TRIGGER, TRUNCATE`; every row for `authenticated` reads either `MAINTAIN,
REFERENCES, TRIGGER, TRUNCATE` or, on the 23 tables with a live DELETE
grant, `DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE`. MAINTAIN
co-occurs with TRUNCATE/TRIGGER/REFERENCES table-for-table, in every row,
for both roles — never granted alone, never missing where the other three
are present.

Per-role table counts, cross-checked programmatically (not by eye):

```sql
select pg_get_userbyid(a.grantee) as role, count(distinct c.relname) as table_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public' and c.relkind = 'r'
  and pg_get_userbyid(a.grantee) in ('anon','authenticated')
  and a.privilege_type = 'MAINTAIN'
group by 1 order by 1;
```
→ `anon: 27, authenticated: 28`

**Matches prod exactly** (Aravind, 2026-09-16: "`aclexplode(pg_class.
relacl)` on public tables, privilege MAINTAIN: anon 27 tables,
authenticated 28 tables"). No STOP condition triggered.

**Cross-check against the other four privileges** — confirms `relacl` and
`information_schema` agree everywhere EXCEPT `MAINTAIN` (i.e., the
original §1b capture's DELETE/TRUNCATE/TRIGGER/REFERENCES counts were
already correct; only `MAINTAIN` was blind):

| privilege | anon (relacl) | authenticated (relacl) | matches §1b (information_schema)? |
|---|---|---|---|
| DELETE | 0 | 23 | yes |
| TRUNCATE | 27 | 28 | yes |
| TRIGGER | 27 | 28 | yes |
| REFERENCES | 27 | 28 | yes |
| MAINTAIN | 27 | 28 | **no — information_schema reported 0** |

**Reviewer note: this migration's grant captures and checks now use
`pg_class.relacl` throughout, not `information_schema`** — the migration
file's own final `DO` block (the live abort-on-failure check) and every
per-table `REVOKE`/`GRANT` capture in this package are `relacl`-sourced as
of this correction pass. The 32 explicit `REVOKE` statements in the
migration file itself, and the 17 `DROP POLICY` statements, are
unchanged — `relacl` and `information_schema` already agreed on every
table/privilege pair those statements cover (DELETE/TRUNCATE/TRIGGER/
REFERENCES); only `MAINTAIN`'s omission from `information_schema` was
ever wrong, and the `REVOKE` statements already included `MAINTAIN`
explicitly (it is a safe no-op to revoke something a table doesn't hold,
so the forward migration's own correctness never depended on knowing
`MAINTAIN`'s true count) — only the DOWN block's re-grants and the
header's own narrative claims needed correcting.

---

## Step 2 — test impact

**Conclusion: zero tests break.**

`grep -rn "\.delete(" test --include='*.ts'` returns 130+ hits across
~40 files. Every `db` variable resolving any of these calls was traced to
its declaration; **every single one is `const db = testClient()`**
(service-role, D6, never touched) — confirmed exhaustively via
`grep -rn "^\s*\(const\|let\)\s*db\s*[:=]" test/*.ts test/unit/*.ts
test/helpers/*.ts`, which returned only `testClient()` assignments, plus
two inline `testClient().from(...)` calls (`test/dpr-generate-trigger.
test.ts:81-82`, `test/webhook.test.ts:256-257`) and two bare `.delete()`
calls inside `test/helpers/db.ts` functions that each declare their own
`const db = testClient()` earlier in the same function scope.

**Exactly one non-service-role hit:** `test/migration-023.test.ts:210`,
`jwtA.from('dprs').delete().eq('id', DPR_A1_ID)` — `jwtA` is a real
authenticated-session client (`jwtClient(email, password)`). This test
(T-023-04) **already expects `error.code === '42501'`** (permission
denied), because `authenticated` already lacks a DELETE grant on `dprs`
today (step 1b above: `dprs` is one of the 5 tables where `authenticated`
has TRUNCATE/TRIGGER/REFERENCES but not DELETE). This migration does not
change `dprs`'s behaviour for this test at all — **SAFE, no fix needed.**

**No `anon`-client delete calls exist anywhere** — confirmed via
`grep -rn "anon\.from\|anon\s*\.\s*delete" test/*.ts` → zero hits.

**No `truncate`/`CREATE TRIGGER` usage exists in test/** — confirmed via
`grep -rni "truncate" test/*.ts test/unit/*.ts test/helpers/*.ts` (all
hits are unrelated prose/array-truncation comments or the T-023-07
tracked-gap note itself) and `grep -rni "CREATE TRIGGER" test/*.ts
test/unit/*.ts test/helpers/*.ts` (zero hits). TRUNCATE/TRIGGER have no
PostgREST verb — nothing in the test suite can exercise them, matching
T-023-07's own established reasoning.

**Application code:** `grep -rn "\.delete(" lib app --include='*.ts'
--include='*.tsx'` returns exactly 4 hits, all `requiredList.delete(...)`
calls on a plain JS `Set` in `lib/dpr/generate.ts` — **zero real
`.from(<table>).delete(` database calls anywhere in `lib/` or `app/`, via
any client.** This is the evidence the migration header cites for "no
application code deletes via a user session" — stronger than the claim
requires (no app-code delete at all, by any client).

**`test/unit/no-app-delete-invariant.test.ts` — cited, scope corrected.**
This file exists and is cited in the migration header, but its actual
scope is narrower than "no app code deletes": it is a static guard for
exactly two tables (`outbound_sends`, `daily_log_photos`) where
`service_role` itself has a test-db-only DELETE divergence from prod. It
does **not** generally assert "no app code deletes anywhere" — that
broader claim is independently established by this package's own grep
above, not by that test.

**Static grant-shape tests unaffected:** `test/hindrance-photos-rls.
test.ts`'s three grant-shape tests parse migration `044_hindrance_photos.
sql`'s own file text (a different migration file) — 047 does not touch
that file, so these are unaffected. Confirmed by reading the test: it
locates `044_hindrance_photos.sql` by path, not a live query.

---

## Full SQL

See `docs/reviews/047_revoke_unused_table_rights.sql` in full — reproduced
inline here would exceed this package's own readability budget (385
lines). Structure: header (purpose/decisions/risk/scope, as above) →
`BEGIN` → 32 explicit per-table `REVOKE` statements (D1+D2 combined, one
statement per table, no dynamic loop) → 17 `DROP POLICY` statements (D2)
→ `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ... ON
TABLES FROM anon, authenticated` (D3) → a final `DO $$ ... $$` block that
`RAISE EXCEPTION`s if any public table still grants the five privileges
to `anon`/`authenticated`, or any `polcmd 'd'` policy remains → `COMMIT`
→ a fully-commented `DOWN` block.

## DOWN block

Fully commented (every line blank or `--`-prefixed, confirmed via
`scripts/lint-migrations.mjs`'s `down-section-must-be-commented` rule,
clean). Reverses in this order: (1) `ALTER DEFAULT PRIVILEGES ... GRANT
TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ... TO anon, authenticated`
(D3 reversed first, so tables created after 047 during a rollback window
don't end up permanently missing these grants) — **CORRECTED 2026-09-16:
MAINTAIN IS re-granted here.** The prior version of this DOWN block
deliberately omitted MAINTAIN from this reversal on the belief (from an
`information_schema`-based capture) that it was never granted pre-047;
§1e's `relacl` re-capture found that belief wrong — MAINTAIN is held by
`anon` on 27 tables and `authenticated` on 28, matching prod's own default
ACL (`'m'` present for both roles); (2) per-table `GRANT` statements
restoring the EXACT privilege set §1e's `relacl` capture found for each
table/role pair, now including MAINTAIN wherever held (the 4 already-clean
tables get nothing re-granted; `dpr_versions` gets nothing for `anon`);
(3) all 17 `CREATE POLICY` statements, USING expressions pasted verbatim
from step 1's `pg_get_expr` output, not retyped from memory.

## D3 scope — FOR ROLE postgres ONLY

See step 1d above. The migration runner (`postgres`) is not a superuser
and is not a member of `supabase_admin`, so it can only alter its own
role's defaults. `supabase_admin`'s own default ACL (also `arwdDxtm` on
tables, per both the test-db capture and Aravind's prod-state supply)
is **out of reach of this migration** and **out of scope** — no Quoco
table is created under `supabase_admin` today, so this has no live
consequence, but a future migration that ever creates a table owned by
`supabase_admin` would not be covered by this default-privilege closure.
Named as a limit, not fixed here.

## D4 design — why a static guard, not a live query

~~`test/migration-047.test.ts` is a **static source guard** parsing
`047_revoke_unused_table_rights.sql`'s own text — not a live
`information_schema`/`pg_catalog` query. This follows the exact,
already-established precedent in this codebase
(`test/unit/no-app-delete-invariant.test.ts`, `test/hindrance-photos-rls.
test.ts`): PostgREST does not expose `information_schema`/`pg_catalog` to
the Supabase JS client, so a live `has_table_privilege()`/`pg_policy`
probe cannot run inside vitest. Two things provide the actual **live,
database-level** enforcement this static guard cannot: (1) the
migration's own final `DO` block, which `RAISE EXCEPTION`s and aborts the
whole transaction if the invariant doesn't hold, the moment the migration
is ever applied anywhere; (2) this migration's own future rehearsal pass
(not this one — write + package only), which will run the same live
`has_table_privilege`/`pg_policy` probes this package's own step 1 used,
via `supabase db query --linked`, the CLI-level path vitest cannot reach.
`test/migration-047.test.ts` was NOT run in this pass (no `.env.test` in
this environment) — `npx tsc --noEmit` was run instead and is clean.~~

**DATED CORRECTION (2026-09-16): D4 is now a live test, not a static
guard.** Aravind's own decision, same day. `test/migration-047.test.ts`
was rewritten to call a new, dedicated, test-db-only SQL helper —
`quoco_test_047_unused_rights_check()`, `docs/reviews/
048_test_047_unused_rights_check.sql` — via `testClient()` (`db.rpc(...)`),
the exact live-query pattern `test/session-transition.test.ts` already
uses for `quoco_test_row_is_locked` (migration 032). The helper is
`SECURITY DEFINER`, `service_role`-only (`REVOKE EXECUTE ... FROM PUBLIC,
anon, authenticated; GRANT EXECUTE ... TO service_role`), and returns one
row: the live `pg_class.relacl`/`aclexplode()` grant count (DELETE/
TRUNCATE/TRIGGER/REFERENCES/MAINTAIN, anon/authenticated, public tables)
and the `polcmd 'd'` policy count in public — the exact same two counts
migration 047's own final `DO` block checks. The test asserts both are
zero, and throws a clear, named error (never skips) if the helper call
itself fails — e.g. because the helper hasn't been applied to test-db
yet.

**The prior static-guard rationale above (struck through) is retained,
not deleted, per this project's own correction discipline** — it was an
accurate account of the codebase's PostgREST-access limitation at the
time it was written, and remains true as a general fact (PostgREST still
does not expose `information_schema`/`pg_catalog` directly); it just no
longer describes what `test/migration-047.test.ts` itself does, now that
a dedicated `SECURITY DEFINER` helper gives the test a live, credentialed
path around that limitation — the same workaround `quoco_test_row_is_locked`
already established for a different test.

**CI on this PR will fail on `test/migration-047.test.ts` until 047 and
the helper (048) are both applied to test-db.** Expected, per order:
review → test-db → CI. The helper is HELD, not yet applied anywhere (see
its own file header) — this pass writes it, applies nothing.

**Prod-exclusion status, per the task's own instruction to confirm or
state otherwise: NOT CONFIRMED, stated plainly rather than assumed.**
`quoco_test_047_unused_rights_check()` is a brand-new function that has
never been applied anywhere yet, so it cannot appear in any type
generation run today — there is nothing to diff. Whether it will be
excluded from a FUTURE prod type-generation run the same way
`quoco_test_row_is_locked` currently is depends on whether it is ever
applied to prod at all, which is not planned (it has no production call
site, same reasoning as 032's own function) — but this project's own
`docs/reviews/032-ledger-repair-record.md` shows that "never applied to
prod" and "prod's ledger says applied" can diverge for this exact class
of object (see `048_test_047_unused_rights_check.sql`'s own header for
the full account) — so this migration does not claim a mechanism
guarantees prod-exclusion; it only observes that no one currently has a
reason to apply it there, the same footing 032 was on.

## Open questions / flagged for reviewer attention

1. **D2's "16" vs. the actual 17.** Confirmed a count-label error in D2's
   own prose, not a set mismatch — every one of the 17 listed names
   matches a live policy exactly. Recorded here in case Aravind wants the
   original decision text corrected for the record.
2. **Stale comment, not fixed by this migration.** `test/migration-023.
   test.ts`'s own T-023-07 `it.todo` comment claims this exact gap
   "closes via migration 024 (sweeps the REVOKE across all 25 affected
   tables)." This is factually wrong — `024_evening_flow_q4_q5.sql` is an
   unrelated evening-flow parser migration (confirmed by reading the
   file) — and contradicted by this package's own step 1 capture, which
   found the privileges still held broadly on test-db today. **047 is the
   migration that actually closes T-023-07's gap.** Correcting that stale
   test comment is out of 047's own scope; flagged here for a follow-up
   PR, not fixed silently.
3. **D3's `supabase_admin` gap** (see above) — accepted as a named limit,
   not resolved. Worth a decision on whether a future migration should
   ever be allowed to create a table owned by `supabase_admin` at all,
   given this gap.
4. **Function EXECUTE default** (backlog, per Aravind's addendum) — new
   functions in `public` are still EXECUTE-able by `anon`/`authenticated`
   by default; every migration since 020 revokes this by hand. Changing
   the default is out of 047's scope but named here as the natural next
   piece of the same "unused default privilege" family.
