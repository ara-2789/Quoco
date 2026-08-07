# Migration 023 — `dprs` table — review package

Phase 0 of the Claude API / DPR generation build. Creates `public.dprs` (a
table `docs/schema.md` has documented as a design since migration 007 but
that no migration ever actually created — see that file's own historical
banner), drops `daily_logs.dpr_content` (the interim per-engineer column DPR
content lived in with no real table to hold it), and repoints
`app/(dashboard)/dprs/page.tsx` at the new table — all in one migration/PR,
since dropping the column and repointing the page are not independently
safe to stage.

- Migration: `supabase/migrations/023_dpr_reports.sql`
- App: `app/(dashboard)/dprs/page.tsx` (repointed; separately, its
  pre-existing dead "View" link removed — see §8, tracked in CLAUDE.md §10,
  not part of 023's own migration content)
- Docs: `docs/schema.md` (both the `dprs` and `daily_logs.dpr_content`
  entries updated to reflect this migration's actual state)
- Tests: `test/migration-023.test.ts` — **written, run against test-db,
  green: 6/6 assertions pass, 1 `it.todo`** (§6)

**STATUS: WRITTEN + REHEARSED CLEAN ON TEST-DB. NOT YET APPLIED TO PROD.**
Everything in this package describes rehearsal, not a prod apply — §9's
runbook is planned steps, not an executed record. §7 covers a real
consequence of that: this PR's `tsc --noEmit` is red until the apply
happens, and CI now gates merges on it.

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts are pinned to source, never paraphrased.

| Artifact | Pin |
|---|---|
| Commit | `fe62d90c4c7f31cc89840d5da08457062804f7a7` |
| Branch | `feat/023-dpr-reports` |
| `git status --porcelain` at that commit | `''` (empty — clean tree) |
| `023_dpr_reports.sql` | sha256 `afb7c9de4ca8aa73e0234a012b92e079caf6664a23ecea41e7a7a587e8ea89b3` (unchanged since `8de1ae8`) |
| `app/(dashboard)/dprs/page.tsx` | sha256 `058fdf27709216b4752a87154d4bc66e850e24a1f56a9a1073d0fe0da46fb685` |
| `CLAUDE.md` | sha256 `692ee250bd882263b7c928d6e98265c5e9d2b4d9f86f7fc4048c0cf4c83a65b6` |
| `docs/schema.md` | sha256 `cd59d3c41b2bc7bfb5225aa91ca3a3d5b4dc09470389bd74fa7d5be34c800c81` |
| `test/migration-023.test.ts` | sha256 `36a7c4e7670c4b4d01197a71b5a3e1275e3af414357de1a7f11444771bfe300a` |

This document's own commit (adding/updating this file) necessarily lands
AFTER `fe62d90` — same chicken-and-egg every package in this series has had
(the file can't hash itself). The pin above describes everything this
package draws evidence FROM; it does not need to chase its own HEAD.

Each hash computed individually — filename and hash printed on the same
line, never reassembled from a batch — per the discipline 022's package
adopted after an earlier mislabelling.

**RAW-CAPTURE STATUS — read before treating any section below as equally
weighted.** This package is more mixed than most in this series, and it says
so precisely rather than letting a summary read as a paste:

- **§2's post-apply verification (6a-f, the column/RLS/policy/grants/constraint
  checks) — NARRATIVE-CONFIRMED, not raw.** The queries themselves were
  handed over in `docs/scratch/023-rehearsal.md` (gitignored, never
  committed — its content is folded into §2 below since it would otherwise
  vanish). The owner ran them in the Supabase SQL Editor and reported a
  rolled-up pass/fail summary per check, not the literal per-query result
  rows. Recorded as what it is — a trustworthy confirmation, not a raw
  capture — rather than reconstructed to look like one.
- **§2's pre-apply probe — MIXED.** PROD's count is LITERAL (`supabase db
  query --linked`, captured directly, shown below). test-db's count was not
  independently reported as a number before the owner proceeded to the DDL
  paste — the rehearsal's overall PASS implies it was non-blocking, but the
  exact pre-drop count on test-db specifically is not in this package as a
  captured figure.
- **§3's TRUNCATE finding — LITERAL throughout, both databases.** The
  `rows_before, rows_after` result (`1, 0`) was pasted directly by the
  owner, from a query I proposed and the owner corrected before running
  (the correction is recorded in §3, not smoothed over). The 25-table
  grants audit, `pg_default_acl`, `pg_event_trigger`, and the role-membership
  queries against **prod** were run directly by me. The same class of
  queries against **test-db** were run by the owner and relayed as raw
  structured output (not prose) — graded LITERAL on the same standard as
  the TRUNCATE result itself, not downgraded just because I didn't run them.
- **§4 (new — the `ensure_rls` event trigger) — MIXED, and it says which
  half is which inline, not just here.** The function source and the event
  trigger's own catalog row are LITERAL (read directly from prod). The
  claim that 020's `REVOKE EXECUTE` doesn't affect the trigger firing is
  reasoned from documented PostgreSQL trigger/event-trigger semantics, not
  from an isolated empirical test — §4 flags this distinction at the point
  the claim is made, not just in this summary.
- **§5 (migration-lint) — LITERAL**, including the `no-orphan-security-definer`
  demonstration: the throwaway fixture file was created, the linter run
  against it (twice — failing, then passing), and deleted, all directly by
  me, with the output pasted unedited.
- **§6 (RLS isolation test) — LITERAL.** `test/migration-023.test.ts` was
  written, run directly against test-db via `npx vitest run`, and the
  passing output pasted unedited. The `42501` message text was captured via
  a standalone probe script, run and deleted the same way as §5's lint
  fixture — not inferred from the test's own loose regex match.
- **§7 (CI / merge-gating) — LITERAL.** `.github/workflows/ci.yml`'s own
  content, `package.json`'s `typecheck` script, and every `git log` date
  used to check the "matches 022" claim were read/run directly, not
  recalled from earlier in this conversation. That claim was made
  unverified in chat before this package existed; §7 states plainly that
  it does not hold, rather than carrying it forward.

---

## 1. What changed, structurally

**`public.dprs`** — one row per `(project_id, log_date)`, UPSERT target for
regeneration (never a new version row). 13 columns: `id`, `created_at`,
`tenant_id`, `project_id`, `log_date`, `structured` (JSONB), `content`
(TEXT), `generated_at`, `last_regenerated_at`, `delivered_owner_at`,
`delivery_status` (TEXT + CHECK: pending/delivered/paused/skipped_no_data/failed),
`generation_status` (TEXT + CHECK: idle/pending/running/stale),
`generator_job_id` (UUID, deliberately not a FK — see below).
`UNIQUE(project_id, log_date)`.

**Two departures from `docs/schema.md`'s original design, both argued in
the migration's own header comments, not just decided in conversation:**

- **RLS is scoped via `project_members`, not tenant-wide.** `daily_logs`'
  own SELECT policy is tenant-wide, with the dashboard narrowing further at
  the app layer — migration 019's own header names that exact gap
  (`correct_daily_log` had to re-implement membership checking in its body
  because `daily_logs_update`'s RLS is broader than what a PM can actually
  see). CLAUDE.md §4 states a stricter rule specifically for DPR content
  ("strictly single-project scoped"), so `dprs`' policy is
  `project_members`-scoped from creation — mirrors `daily_log_edits` (019
  §2) directly, the closest existing precedent for "project-scoped read,
  service-role-only write."
  - **PM-only by design, confirmed three independent ways, not assumed**
    (recorded in the migration's own comment): owners are never associated
    via `project_members` (only `projects.owner_user_id`, a separate
    mechanism); owners have no web login in Phase 1 at all (`auth_id =
    null`, CLAUDE.md §5); and bot-flows.md places DASH-04 under "PM
    DASHBOARD — SPINE," never owner-facing. Owners receive DPR content
    exclusively through the push path (`delivered_owner_at`/`delivery_status`).
- **`generator_job_id` is not a foreign key.** `jobs` rows are a pruning
  candidate (CLAUDE.md §10's data-retention audit); a hard FK, even `ON
  DELETE SET NULL`, would either block the prune or erase the correlation
  the moment the referenced job is pruned. Diagnostic only, deliberately not
  referentially enforced — the option not taken (FK + `ON DELETE SET NULL`)
  is named and rejected in the migration comment, not silently omitted.

**No `SECURITY DEFINER` RPC.** Only `service_role` ever writes to `dprs`,
from a cron-triggered job handler — no user-facing write path to protect,
so a definer RPC would add a parameter-trusting surface (the 020 incident
class) for zero authorization benefit. Plain parameterized queries from the
job handler, matching CLAUDE.md §4's actual requirement, not a smaller copy
of 019's pattern.

**`daily_logs.dpr_content` — dropped, same migration.** Zero non-null rows
on prod (see §2's pre-apply probe) — same justification class as migration
016's `evening_dependencies_tomorrow` drop. `app/(dashboard)/dprs/page.tsx`
is repointed at `dprs` in the same commit, since dropping the column first
would 500 the page.

---

## 2. Rehearsal — test-db

### Pre-apply probe

```sql
SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE dpr_content IS NOT NULL) AS non_null_dpr_content
FROM public.daily_logs;
```

**PROD (LITERAL — `supabase db query --linked`, run earlier in this
session):**
```
{"rows": [{"non_null_dpr_content": 0, "total_rows": 1}]}
```

**test-db:** rehearsal proceeded to the DDL paste on the strength of this
being non-blocking; the exact pre-drop count on test-db itself was not
independently captured as a number in this conversation. Flagged as a gap
in this package's own evidence, not silently smoothed over.

### Post-apply verification (NARRATIVE-CONFIRMED — see the grading above)

Six checks, each with an explicit pass/fail condition defined in
`docs/scratch/023-rehearsal.md` before the owner ran them (so a mismatch
would have been visible immediately, not read as raw rows and guessed at):

| Check | Condition | Result |
|---|---|---|
| a. Columns | 13 columns, names/types/nullability/defaults matching the DDL | **PASS** — 13 columns correct |
| b. RLS enabled | `relrowsecurity=true`, `relforcerowsecurity=false` | **PASS** — RLS on |
| c. Policy shape | `polname='dprs_select'`, `roles={authenticated}` (not `{public}`), `using_expr` contains both the `tenant_id` check AND the `project_members` EXISTS clause, `with_check` NULL | **PASS** — roles scoped to `{authenticated}`, both clauses present in `using_expr`, `with_check` null |
| d. `dpr_content` gone | zero rows for that column in `information_schema.columns` | **PASS** — gone |
| e. Grants / `relacl` | `relacl` non-NULL, no bare-`PUBLIC` entry | **PASS** — `relacl` non-NULL, no PUBLIC entry (see §3 for the SEPARATE, real finding this same query surfaced about `anon`/`authenticated` themselves — not a PUBLIC grant, a different issue) |
| f. Constraints | PK, 2 FKs (`tenant_id`→`tenants`, `project_id`→`projects`), `UNIQUE(project_id, log_date)`, 2 CHECKs, `generator_job_id` in no FK | **PASS** — all 6 correct by name+definition, `generator_job_id` confirmed absent from every FK |

**Every one of the three stop conditions named going in was clear**: no
tenant-wide policy text where `project_members`-scoping was required, no
`PUBLIC` entry in `relacl`, `dpr_content` genuinely gone.

---

## 3. NEW FINDING — `anon`/`authenticated` hold `TRUNCATE`, `REFERENCES`,
`TRIGGER` on every public-schema table (systemic, NOT a 023 defect)

Surfaced by §2's own grants check (6e) going one query further than "is
there a PUBLIC entry" — checking what `anon`/`authenticated` *themselves*
hold beyond what 023's `REVOKE` (INSERT/UPDATE/DELETE only) actually covers.

**Audit — LITERAL, `supabase db query --linked` (PROD), unedited:**

```sql
SELECT c.relname AS table_name, r.rolname AS grantee, a.privilege_type
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
JOIN pg_roles r ON r.oid = a.grantee
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND r.rolname IN ('anon','authenticated')
  AND a.privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')
ORDER BY c.relname, r.rolname, a.privilege_type;
```

25 tables, every one showing the identical 6-row pattern (`anon` +
`authenticated` × `REFERENCES`/`TRIGGER`/`TRUNCATE`) — zero exceptions:
`boq_items`, `boq_sessions`, `daily_log_edits`, `daily_logs`, `hindrances`,
`invoices`, `jobs`, `processed_messages`, `project_members`, `projects`,
`ra_bill_payments`, `ra_bills`, `rate_catalog`, `rate_catalog_history`,
`safety_incidents`, `tenants`, `tender_chat_messages`, `tender_chat_sessions`,
`tender_document_chunks`, `tender_documents`, `tenders`, `users`,
`vendor_invoices`, `vendors`, `whatsapp_sessions`. No migration in this
repo's history (015/017/019/020, which hardened INSERT/UPDATE/DELETE and
`SECURITY DEFINER` EXECUTE respectively) ever touched these three
privileges.

### Empirically verified, not just inferred from `relacl`

Proposed test (mine) had a false-pass hole: seeding from `tenants LIMIT 1`
/`projects LIMIT 1` independently could insert zero rows if either table was
empty, and the SQL Editor only surfaces the last result set, so an
intermediate guard `SELECT` would never be visible. **Corrected version (the
owner's), actually run on test-db:**

```sql
BEGIN;
INSERT INTO public.dprs (tenant_id, project_id, log_date, content)
SELECT p.tenant_id, p.id, CURRENT_DATE, 'trunc-test'
FROM public.projects p LIMIT 1;
CREATE TEMP TABLE _trunc_probe AS
SELECT count(*) AS rows_before FROM public.dprs;
SET ROLE anon;
TRUNCATE public.dprs;
RESET ROLE;
SELECT p.rows_before, (SELECT count(*) FROM public.dprs) AS rows_after
FROM _trunc_probe p;
ROLLBACK;
```

**Result, LITERAL, pasted directly by the owner:**
```
rows_before, rows_after
1, 0
```

A real seeded row was destroyed by `SET ROLE anon; TRUNCATE public.dprs;`.
The `dprs_select` policy is `TO authenticated` — `anon` matches no policy
and cannot `SELECT` a single row of this table — yet `anon` destroyed all
of them. Entire transaction rolled back; test-db is unchanged.

### Severity — stated plainly, matching 020's own opening caution against
overstating, not inflated by this demonstration

`anon` can read nothing and destroy everything, and that asymmetry is real
— but PostgREST exposes no `TRUNCATE` verb (nor an equivalent for
`REFERENCES`/`TRIGGER`), so the `anon` key cannot reach this via the live
API. **This is the 020 "not exploitable, hardened for defense in depth"
class, not a disclosed incident.** The `SET ROLE` demonstration required a
raw Postgres session (the SQL Editor) that an external caller does not have.
Recorded with the same weight 020's own entry gave that class — real,
worth closing, not a live hole.

### `pg_default_acl` / `pg_event_trigger` — settling *why*, by observation, on BOTH databases

**PROD, LITERAL:**

```sql
SELECT defaclrole::regrole AS grantor,
       CASE WHEN defaclnamespace = 0 THEN '(all schemas)'
            ELSE defaclnamespace::regnamespace::text END AS schema,
       defaclobjtype AS objtype,
       defaclacl
FROM pg_default_acl
ORDER BY 1, 2, 3;
```

Full result (24 rows, all schemas) — the two rows that matter for `public`
tables (`objtype='r'`):

```
{"grantor":"supabase_admin","schema":"public","objtype":"r",
 "defaclacl":"{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}"}
{"grantor":"postgres","schema":"public","objtype":"r",
 "defaclacl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"}
```

**Two independent default-ACL grantors for `public`-schema tables** — one
owned by `postgres` (the role migrations run as), one by `supabase_admin`
(Supabase's own bootstrap role). Both grant `arwdDxtm` (includes `D`=TRUNCATE,
`x`=REFERENCES, `t`=TRIGGER) to `anon`/`authenticated`/`service_role`. This
confirms `ALTER DEFAULT PRIVILEGES` is the real mechanism — not inferred,
observed.

```sql
SELECT evtname, evtevent, evtenabled, evtfoid::regproc AS function
FROM pg_event_trigger
ORDER BY evtname;
```

Full result, 7 rows: `ensure_rls`→`rls_auto_enable` (`ddl_command_end`,
enabled) — the already-catalogued §10 out-of-band RLS-auto-enable object,
not a privilege-granting trigger by name or purpose. The other six
(`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`,
`issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) are standard
Supabase infrastructure (PostgREST schema-cache reload, extension-specific
access) — none by name or function look like they regrant
TRUNCATE/REFERENCES/TRIGGER on arbitrary new public tables. No event-trigger
reassertion path found for the TRUNCATE/REFERENCES/TRIGGER grants
specifically; the two-grantor `pg_default_acl` state is the confirmed
mechanism for that. (`ensure_rls` itself does something unrelated but
real for 023 specifically — see §4.)

**test-db, relayed by the owner as raw structured output — graded LITERAL,
same standard as the TRUNCATE result above:**

```
pg_default_acl (test-db) — same two-grantor shape as prod:
  supabase_admin, public, r, {postgres=arwdDxtm/...,anon=arwdDxtm/...,authenticated=arwdDxtm/...,service_role=arwdDxtm/...}
  postgres,       public, r, {postgres=arwdDxtm/...,anon=arwdDxtm/...,authenticated=arwdDxtm/...,service_role=arwdDxtm/...}
  (plus S and f rows for public, and entries for extensions/graphql/
   graphql_public/realtime/storage/auth under their respective admins)

pg_event_trigger (test-db) — SIX rows, and NO ensure_rls:
  issue_graphql_placeholder, sql_drop,        O, set_graphql_placeholder
  issue_pg_cron_access,      ddl_command_end, O, grant_pg_cron_access
  issue_pg_graphql_access,   ddl_command_end, O, grant_pg_graphql_access
  issue_pg_net_access,       ddl_command_end, O, grant_pg_net_access
  pgrst_ddl_watch,           ddl_command_end, O, pgrst_ddl_watch
  pgrst_drop_watch,          sql_drop,        O, pgrst_drop_watch
```

**Comparison against PROD's 7 rows: identical except PROD has an eighth
row, `ensure_rls`→`rls_auto_enable`, which test-db lacks entirely.** Not a
new finding by itself — already in the OUT-OF-BAND DB OBJECTS registry
(CLAUDE.md §10) as prod-only — but this is the first time that divergence
has been checked against a migration about to run `CREATE TABLE` on prod.
§4 below covers what that means specifically for 023's own apply.

**Arithmetic closes on the TRUNCATE finding, both databases now checked**:
the default ACL grants `anon`/`authenticated` `arwdDxtm` the moment `CREATE
TABLE dprs` runs, before 023's own `REVOKE INSERT, UPDATE, DELETE`
statements execute. That REVOKE strips exactly `a`/`w`/`d`. The remainder —
`r`/`D`/`x`/`t` (SELECT/TRUNCATE/REFERENCES/TRIGGER) — is exactly what §2's
grants check (6e) and the 25-table audit above observed on `dprs` and every
other table. No third mechanism is needed; the two-grantor default ACL
fully accounts for the finding on both databases.

**`postgres`'s ability to close the `supabase_admin`-owned entry — verified,
not assumed, LITERAL (PROD):**

```sql
SELECT rolname, rolsuper, rolinherit, rolcanlogin
FROM pg_roles WHERE rolname IN ('postgres','supabase_admin');
```
```
postgres:       rolsuper=false, rolinherit=true, rolcanlogin=true
supabase_admin: rolsuper=true,  rolinherit=true,  rolcanlogin=true
```
```sql
SELECT pg_has_role('postgres', 'supabase_admin', 'member') AS is_member,
       pg_has_role('postgres', 'supabase_admin', 'usage')  AS has_usage;
```
```
is_member=false, has_usage=false
```

`postgres` (the role every migration runs as) is confirmed **not** a
superuser and confirmed **not** a member of `supabase_admin` in any sense
`pg_has_role` recognizes. `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
...` requires being that role, a member of it, or a superuser — `postgres`
is none of the three. This settles categorically, by observation, that a
migration can only ever touch the `postgres`-owned default-ACL entry —
never the `supabase_admin`-owned one — confirming (not merely structurally
implying) why the migration-024 proposal below favors approach **(b)** over
**(a)**.

**Function-level default ACL — confirms 020's root cause is structurally
unfixed, LITERAL (PROD):**

```sql
SELECT defaclrole::regrole AS grantor, defaclnamespace::regnamespace AS schema,
       defaclobjtype, defaclacl
FROM pg_default_acl
WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'f';
```
```
supabase_admin, public, f, {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
postgres,       public, f, {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

Same two-grantor shape, `X`=EXECUTE. Every **new** function created in
`public` — including a hypothetical future `SECURITY DEFINER` function
(020's incident class, "function eight") — gets `anon`/`authenticated`
EXECUTE by default, exactly as the original seven did before 020's manual
`REVOKE`. Nothing about 020 changed this default; 020 only fixed the seven
functions that already existed. This is exactly the gap
`no-orphan-security-definer` (`scripts/lint-migrations.mjs`) exists to
catch at write time — see §5 for a live demonstration that the rule
actually fires, not just that it was written with that intent.

### Consequence for `migration-023.test.ts`

The originally-planned assertion — "authenticated has no write path at all"
— is **false as usually written**: a test asserting INSERT/UPDATE/DELETE
all fail would pass while the table stays destroyable via `TRUNCATE`. §6
covers how the test file handles this (a tracked-gap comment, not a new
untestable assertion — TRUNCATE has no PostgREST/`supabase-js` surface to
assert against in an automated test).

### Migration 024 — proposed, not written

Sweep `REVOKE REFERENCES, TRIGGER, TRUNCATE ON <table> FROM anon,
authenticated;` across all 25 tables above, framed with the same
not-inflated severity as this section. **Does not gate 023** — 023 is
already rehearsed and passed against a pinned SHA; amending it now would
fork the pattern and leave `daily_log_edits` (019) weaker than the newly
hardened `dprs`, which is the opposite of the goal. The recurring-grant
question (does table 26 arrive with the same exposure) is decided **(b)**:
a new `scripts/lint-migrations.mjs` rule requiring same-file `REVOKE
TRUNCATE, REFERENCES, TRIGGER` alongside any `CREATE TABLE`, CI-enforced
where the linter is already load-bearing — not **(a)**, altering
`ALTER DEFAULT PRIVILEGES` directly, because the two-grantor finding above
(now confirmed by the role-membership query, not just inferred) means a
migration (as `postgres`) can only ever fix one of the two sources, and (b)
doesn't depend on that gap closing to be effective. Full reasoning: this
conversation; formal proposal doc not yet written.

---

## 4. PROD-only event trigger — `ensure_rls` / `rls_auto_enable`
(bears on 023's own apply, NOT on §3/024)

Raised because 023 runs `CREATE TABLE dprs` — the first `CREATE TABLE` on
prod since migration 020 revoked `PUBLIC EXECUTE` on `rls_auto_enable()` —
and §3's fresh test-db comparison just reconfirmed directly that
`ensure_rls` is prod-only (test-db's `pg_event_trigger` has 6 rows, none
named `ensure_rls`; already flagged in the OUT-OF-BAND DB OBJECTS registry,
CLAUDE.md §10, but never before checked against a migration about to
`CREATE TABLE` on prod). **This is CLAUDE.md §0's fresh-branch-rule class by
name**: test-db's rehearsal proves 023's *SQL* is correct; it cannot prove
what happens where this object exists, because the object isn't there to
exercise.

**Function source, LITERAL (PROD):**

```sql
SELECT prosrc FROM pg_proc
WHERE proname = 'rls_auto_enable' AND pronamespace = 'public'::regnamespace;
```
```plpgsql
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
```

**Event trigger row, LITERAL (PROD):**
```sql
SELECT evtname, evtevent, evtenabled, evtfoid::regproc
FROM pg_event_trigger WHERE evtname = 'ensure_rls';
```
```
evtname=ensure_rls, evtevent=ddl_command_end, evtenabled=O, evtfoid=rls_auto_enable
```
`evtenabled='O'` — fires for ORIGIN sessions, i.e. ordinary client
connections, including whatever session runs 023's apply. It is armed.

### What it actually does to a table

Reads the DDL commands completed by the statement that just fired
`ddl_command_end`, filtered to `command_tag IN ('CREATE TABLE', 'CREATE
TABLE AS', 'SELECT INTO')` in schema `public`. For each match:

```sql
ALTER TABLE IF EXISTS <table> ENABLE ROW LEVEL SECURITY;
```

wrapped in its own `EXCEPTION WHEN OTHERS` that swallows any error into a
`RAISE LOG` — it can never abort the transaction it fires inside.

**On a table where RLS is already enabled, this is a no-op.** `ENABLE ROW
LEVEL SECURITY` sets one catalog flag (`pg_class.relrowsecurity`); running
it again when already `true` does not error and does not change state. The
function never touches `FORCE ROW LEVEL SECURITY` and never touches any
grant — no interaction with the `REVOKE`/policy statements 023 also runs.

**Firing order inside 023's own transaction**: the filter list excludes
`ALTER TABLE`, so the trigger does not fire on 023's own explicit `ALTER
TABLE public.dprs ENABLE ROW LEVEL SECURITY;` statement, nor on `ALTER
TABLE public.daily_logs DROP COLUMN dpr_content;` — only on the `CREATE
TABLE dprs` statement itself. Net sequence on prod: `CREATE TABLE dprs`
completes → `ensure_rls` fires → RLS enabled on `dprs` via the trigger →
023's own `ENABLE ROW LEVEL SECURITY` statement runs moments later as a
harmless no-op on top of that. Final state is identical to what rehearsal
observed (RLS on, force off, §2 check b) — test-db just reaches it via
023's own statement alone, since the trigger isn't there to act first.

### Does 020's `REVOKE EXECUTE` affect whether it fires?

**No — with high confidence, but this is reasoned from documented
PostgreSQL mechanics, not an isolated empirical test, and that distinction
is stated plainly here rather than blurred into the LITERAL findings
above.** Event trigger functions are invoked by the server as part of
internal DDL processing — the same mechanism by which an ordinary
row-level trigger function fires on `INSERT` regardless of whether the
inserting role holds `EXECUTE` on that trigger function. Neither is an
explicit SQL function call (`SELECT foo()`) subject to the caller's
`EXECUTE`-privilege ACL check; `EXECUTE` gates direct invocation, not
trigger/event-trigger firing. 020's `REVOKE` closed a real PostgREST
`/rpc/` exposure (a role calling the function directly); it was never able
to touch — and was never intended to touch — the event-trigger firing
path, which isn't privilege-gated the same way.

If true observational confirmation is wanted before the apply rather than
this documented-mechanism reasoning, it would require constructing an
isolated fixture (a throwaway event trigger + `REVOKE EXECUTE` + a `CREATE
TABLE` test) — test-db doesn't have one to reuse, since it lacks
`ensure_rls` entirely, so this would mean building the scenario from
scratch rather than observing the existing object. Not done here; flagged
as available if wanted, not assumed necessary.

### Net risk for 023's prod apply

**Benign.** One redundant, idempotent `ENABLE ROW LEVEL SECURITY` on
`dprs` alone, swallowed-on-error by design, no interaction with grants or
policies, no effect on `daily_logs` (no `CREATE TABLE` there). Confidence:
HIGH on "what the function does to RLS state" (read directly from `prosrc`,
LITERAL); HIGH-but-not-empirically-isolated on "020's revoke doesn't block
firing" (documented PostgreSQL trigger semantics, not a live test). §9's
runbook adds a step to look for `rls_auto_enable: enabled RLS on
public.dprs` in the apply-time Postgres logs as confirmatory evidence that
the mechanism behaved as read here — its *absence* would be the more
interesting finding, not its presence.

---

## 5. Migration-lint — LITERAL

```
$ node scripts/lint-migrations.mjs
migration-lint: clean. 53 known violation(s), all exempted.
exit: 0
```

Run fresh against commit `c1d8005` while drafting this package. Zero new
exceptions-file entries for 023 — the first new migration since branch
protection went load-bearing, passing clean on its own design rather than
needing a grandfather entry.

### Rule validation — does `no-orphan-security-definer` actually fire?

Asked directly because §3 confirms the underlying default-EXECUTE gap this
rule exists to catch (020's root cause) is still structurally live for any
future `SECURITY DEFINER` function — the rule's design intent was never in
question, whether it actually fires was. Demonstrated with a throwaway
file (`supabase/migrations/999_demo_orphan_lint_test.sql`), created,
exercised, and deleted in this session — never committed:

**Negative fixture — `SECURITY DEFINER`, no `REVOKE`, no `GRANT`:**
```sql
CREATE OR REPLACE FUNCTION public.demo_orphan_fn()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM 1;
END;
$$;
```
```
$ node scripts/lint-migrations.mjs
migration-lint: 1 violation(s) not covered by scripts/migration-lint-exceptions.json:

  999_demo_orphan_lint_test.sql: demo_orphan_fn  [no-orphan-security-definer]

Each violation needs either a fix, or a new (file, object, rule) entry in scripts/migration-lint-exceptions.json with a reason — never a file-wide or rule-wide exemption.
exit: 1
```

**Same function, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO
authenticated` added** (the pattern 020 and every migration since has
used):
```
$ node scripts/lint-migrations.mjs
migration-lint: clean. 53 known violation(s), all exempted.
exit: 0
```

File deleted immediately after; `git status --porcelain` confirmed the
repo returned to only this package's own untracked file. **The rule fires
precisely** — flags the orphan case, clears once the 020 pattern is
followed — so a real "function eight" shipped without its `REVOKE` would
be caught at CI time, not rediscovered the way the original seven were.

---

## 6. RLS isolation test (CLAUDE.md §7) — RESULTS

**Written, run against test-db, green.** `test/migration-023.test.ts`,
committed at `fe62d90`. §2f proved the policy's *text* is shaped correctly;
this proves *behavior*, under real JWT sessions, not service-role (which
bypasses RLS by construction and would pass trivially).

**Full run, LITERAL:**
```
$ npx vitest run test/migration-023.test.ts
✓ test/migration-023.test.ts (7 tests | 1 skipped) 8006ms
  ✓ T-023-04: authenticated cannot INSERT, UPDATE, or DELETE via PostgREST — code 42501, no write path  633ms
  ✓ T-023-05: UNIQUE(project_id, log_date) rejects a duplicate  464ms
  ✓ T-023-06: CHECK rejects a bad delivery_status and a bad generation_status  304ms
Test Files  1 passed (1)
     Tests  6 passed | 1 todo (7)
```

**T-023-01/T-023-02 (the centrepiece) passed WITH the presence assertion
intact.** `jwtA` — a PM who is a member of project A1 and deliberately NOT
a member of same-tenant project A2 — queried `dprs` filtered to `[A1, A2]`
and separately to `[A1, B1]` (tenant B) and got back exactly `{A1}` both
times, never an empty set. This distinction is load-bearing, not
decorative: a total lockout (neither row visible) would satisfy an
absence-only assertion just as well as correct scoping would, so both
tests assert the present row explicitly rather than only the missing one.

**Why this result matters beyond 023**: `dprs_select`'s USING clause
(`tenant_id = get_user_tenant_id() AND EXISTS(project_members ... users
...)`) is byte-identical to `daily_log_edits_select` (019:128-137).
Grepping `test/` for any place that SELECTs `daily_log_edits` through a
real JWT client turns up nothing — 019's own suite reaches that table only
indirectly, through the `correct_daily_log` SECURITY DEFINER RPC, which
bypasses RLS on write. **T-023-01/02 are therefore the first live-JWT
validation anywhere in this repo of a nested-EXISTS policy pattern already
shipped to prod on `daily_log_edits`.** Recorded explicitly here, not just
in conversation, so whoever next touches `daily_log_edits` can find this
result instead of re-deriving it from scratch: the pattern resolves
correctly under a real authenticated session — not merely by schema
inspection, which is all 019 ever proved of it.

**T-023-04's `42501` message, captured rather than guessed:**
```json
{"code":"42501","message":"permission denied for table dprs",
 "hint":"Grant the required privileges to the current role with: GRANT INSERT ON public.dprs TO anon;"}
```
`"table"`, not `"relation"` — the loose `/permission denied/i` matcher in
the test was the right call rather than pinning an unobserved guess.

**A real ambiguity this message surfaced, and how the test closes it, not
just notes it**: the hint names whichever role actually lacked the
privilege — `anon` and `authenticated` both produce `42501` on a write
attempt here, so the code alone can't distinguish them, and a T-023-04
that accidentally ran under an `anon` session would prove nothing about
`authenticated` having no write path, which is the entire point of the
test. T-023-04 resolves this by deliberately reusing `jwtA` — the exact
client object T-023-01 already proved carries a genuine authenticated
session (only a real authenticated JWT could have returned a
`dprs_select`-scoped row there; T-023-03 shows `anon` gets an empty array,
not an error, on the identical query shape) — rather than re-asserting
authentication inside T-023-04 itself. The test file documents this
reasoning inline (not just here), specifically so a future edit that swaps
in a fresh client for one call doesn't silently reopen the ambiguity.

**T-023-07 — the TRUNCATE/REFERENCES/TRIGGER gap — is `it.todo`, not a
comment alone**: it surfaces in every `npm test` run output line, not only
to someone who opens this file, per the standing concern that this
project's records tend to read stronger than what they cover. Heading
narrowed to "cannot be tested via PostgREST" (never "no write path at
all"); cites §3's empirical `1, 0` TRUNCATE result and names migration 024
+ the new lint rule as what actually closes it.

---

## 7. CI / merge-gating — `tsc --noEmit` is red until the prod apply, verified not assumed

`app/(dashboard)/dprs/page.tsx` (repointed at `dprs` in this same PR) fails
`tsc --noEmit` today — `types/database.ts` has no `dprs` entry until it's
regenerated, and that regen has to run against PROD (§8 step F; CLAUDE.md
§6), which doesn't have the table yet. This was first waved off in
conversation as "expected, matches migration 022's own pattern" —
unverified when said. Checked here, and corrected rather than carried
forward, because that specific phrase ("matches X's pattern") is the shape
this session has already had to walk back twice before.

### Does CI actually gate merges on this? — yes, LITERAL

`.github/workflows/ci.yml`'s own header: *"STAGE 1 of the process-hardening
work order's P2 (CI gates) — typecheck, lint, test. LOAD-BEARING as of
2026-08-07: branch protection on main requires all three (Typecheck / Lint
/ Test (real test-db))."* The `typecheck` job runs `npm run typecheck`,
which `package.json:13` defines as `tsc --noEmit`. No conditional, no
carve-out for a migration whose types can't exist before it's applied.
**This PR cannot merge to `main` while `tsc --noEmit` is red — plainly
yes.**

### Does migration 022 actually establish that precedent? — checked; no, it doesn't

```
$ git log --diff-filter=A --format='%h %ad %s' --date=short -- .github/workflows/ci.yml
8582855 2026-08-07 ci: add stage 1 workflow (typecheck, lint, test) — P2 CI gates

$ git log --format='%h %ad %s' --date=short -1 88d60ca   # 022 feature commit
88d60ca 2026-08-03 feat(022): evening check-in flow Pass 1 (apply_evening_flow_turn)
$ git log --format='%h %ad %s' --date=short -1 6bbbc59   # 022 fix commit
6bbbc59 2026-08-05 fix(022): CONTEXT DISCIPLINE — merge context at all 4 sites, not 2
$ git log --format='%h %ad %s' --date=short -1 e7d57fb   # 022's own type regen
e7d57fb 2026-08-05 chore(022): regenerate types post-prod-apply (R6)
```

`ci.yml` did not exist until `8582855` (2026-08-07). Every 022 commit — the
feature, the fix, and its own post-apply type regen — landed on 2026-08-03
and 2026-08-05, two days before CI, let alone branch protection, existed.
**022 never had to clear a load-bearing `tsc` gate with an open type-gap,
because there was no gate to clear.** One part of the earlier claim does
hold and is worth keeping: 022's regen genuinely was its own commit,
sequenced strictly after the prod apply (the commit message says
"post-prod-apply (R6)" verbatim) — that shape is real. But "matches 022's
pattern" as a claim about clearing CI is false, and 023 is the first
migration in this repo's history to hit this exact interaction: a schema
change whose types cannot exist before the apply, landing after CI became
load-bearing.

### Options — laid out, not acted on

- **(A) Accept red until apply.** Leave `typecheck` failing; branch
  protection blocks the merge button by construction until the runbook's
  steps C (apply) through F (regen) complete. Not a new risk CI
  introduces — every migration here has always applied out-of-band via the
  SQL Editor, never by merging to `main`, and §9's own runbook already
  sequences "apply → regen + commit → CI green → merge" at step H, written
  before this question came up. CI mainly makes that ordering enforced
  rather than merely intended: a reviewer can still read a red-CI PR's
  diff, they just can't click merge early. Cost: the PR sits visibly red
  on GitHub for however long review takes before the apply happens — a
  cosmetic state, not a functional one.
- **(B) Regenerate from test-db now, commit, go green immediately.**
  Rejected on provenance grounds, not convenience. CLAUDE.md §6's regen
  discipline and this migration's own runbook (§9 step F) both specify
  regenerating against PROD specifically, and the "verify by observation on
  the actual target, not a rehearsal proxy" discipline running through this
  whole package (§0, the `ensure_rls` divergence in §4) argues directly
  against treating test-db's schema as interchangeable with prod's for this
  purpose — even though in THIS case the DDL rehearsed byte-identically and
  the generated types would almost certainly come out identical either way.
  It would also produce a committed `types/database.ts` indistinguishable
  from a genuine prod regen unless explicitly labeled otherwise — the same
  "record reads stronger than reality" failure mode already named for the
  `it.todo` decision in §6.
- **(C) Bypass branch protection for this one PR.** Not recommended:
  protection went load-bearing eight days before this PR, specifically to
  close the honour-system gap process-hardening existed to remove;
  bypassing it on its first real collision with a migration undercuts the
  reason it exists. Not structurally avoidable by splitting the PR either —
  023's own header note (DPR_CONTENT DROP — SEQUENCING) requires the column
  drop and the page repoint to land together, so there's no smaller PR that
  avoids referencing `dprs` from a typed client path.

**Recommendation: (A).** Costs nothing beyond a red check sitting on an
unmerged branch during review, matches the runbook's own already-planned
ordering, and doesn't compromise anything §0 or §6 care about. **Not acted
on** — CI config, the runbook, and the apply sequence are all unchanged
pending your call.

---

## 8. Explicitly out of scope / already handled separately

- **Dead "View" link on the DPR Archive page** — found during this review,
  fixed in a follow-up commit (`c1d8005`, same branch) rather than left
  for later: the link (and its `<th>`/`<td>`) predated 023's repoint
  entirely (confirmed via `git show` against the exact commit that touched
  this file) and was independently wrong-shaped
  (`/dashboard/dprs/...` — the `(dashboard)` route group contributes no URL
  segment). Tracked in `CLAUDE.md` §10 ("DASH-04 DPR ARCHIVE SHIPS
  LIST-ONLY IN MIGRATION 023's PR") with both facts recorded for whoever
  builds the detail route later, not just the deletion.
- **Migration 024** — proposed in §3, not written. Does not gate this PR.
- **Phase 1 (the DPR generator itself)** — cannot start before this table
  exists on prod; out of scope for this migration entirely.

---

## 9. PROD apply — runbook (NOT YET EXECUTED — planned steps only)

Following the same strict-alternation template as 017-022
(`docs/migration-runbook-template.md`), NOT run yet:

- [ ] **A. PITR window observation** — dashboard, before any write.
- [ ] **B. Pre-apply state probe (read-only)** — re-run the `dpr_content`
  count query above against PROD, at apply time, not trusting the number
  captured earlier in this package as still current (same discipline
  migration 016 and this migration's own header comment both name).
- [ ] **C. Apply (write)** — pinned SQL from `git show`, full paste,
  deselect, run.
- [ ] **C.1 Log check (new, from §4)** — check apply-time Postgres logs for
  `rls_auto_enable: enabled RLS on public.dprs`, fired by the `ensure_rls`
  event trigger on the `CREATE TABLE dprs` statement. Expected and
  confirmatory, not alarming — its *absence* is the more interesting
  finding and would warrant stopping to investigate before proceeding to D.
- [ ] **D. Post-apply probes** — the same six checks from §2, re-run
  against PROD.
- [ ] **E. Ledger INSERT + verify.**
- [ ] **F. Types regen** — `types/database.ts`, against PROD this time (not
  the rehearsal-only test-db proof already done against this same
  migration during rehearsal — see the working notes for that dry run).
- [ ] **G. `schema.md` update** — from "rehearsed, not applied" to
  "applied," only after E confirms.
- [ ] **H. Merge ordering** — apply → regen + commit → CI green → merge.
  §7 lays out why this ordering is currently mandatory, not just tidy: the
  PR cannot merge before F regardless, since `tsc --noEmit` stays red until
  then.

---

## 10. Summary

| | |
|---|---|
| Risk | Low-moderate — new table (additive) + one small destructive-but-data-free column drop (0 rows, probe-backed); no `SECURITY DEFINER` surface at all (deliberately avoided) |
| Reversibility | DOWN block drops `dprs`, re-adds `dpr_content TEXT`; data loss from the drop is nil (0 rows pre-drop) |
| Evidence | Rehearsal narrative-confirmed against explicit pass conditions (§2), migration-lint literal-clean including a live rule demonstration (§5), TRUNCATE finding literal-empirical on both databases (§3), RLS isolation suite literal-green on test-db (§6) |
| New finding — access | `anon`/`authenticated` hold TRUNCATE/REFERENCES/TRIGGER on all 25 public tables, systemic since 001, empirically confirmed exploitable-in-principle but not via PostgREST — 020-class, not a live hole; mechanism (`pg_default_acl`, two grantors) and `postgres`'s inability to touch the `supabase_admin`-owned entry both confirmed by observation, on both databases (§3) |
| New finding — apply mechanics | `ensure_rls` event trigger (`rls_auto_enable`) is armed and prod-only; will fire once, redundantly and harmlessly, on 023's `CREATE TABLE dprs` statement; 020's EXECUTE revoke does not gate event-trigger firing (reasoned from documented Postgres semantics, flagged as such, not empirically isolated) (§4) |
| Migration-lint | Clean, 53 (unchanged), zero new exceptions entries — first new migration since CI went load-bearing; `no-orphan-security-definer` demonstrated live against a throwaway fixture, fires on the orphan case and clears on the 020 pattern (§5) |
| RLS isolation test | **Written, green: 6/6 pass + 1 `it.todo`.** Centrepiece (T-023-01/02) is the first live-JWT proof anywhere in this repo of the nested-EXISTS policy shape also shipped, untested this way, on `daily_log_edits` (019) (§6) |
| New finding — CI/merge | This PR's `tsc --noEmit` is red until the prod apply (types can't exist before the table does) and branch protection is load-bearing since 2026-08-07 — 023 is the first migration to hit this exact interaction. The "matches 022" comparison made in conversation does not hold, checked and corrected here. Three options laid out, (A) accept-red-until-apply recommended, none acted on (§7) |
| Follow-ups tracked, not blocking | Migration 024 + lint rule (§3); dead-link fix already landed separately (§8) |
| Prod status | **NOT APPLIED.** Rehearsed clean on test-db only (§2). Runbook is planned steps (§9), not an executed record. |
