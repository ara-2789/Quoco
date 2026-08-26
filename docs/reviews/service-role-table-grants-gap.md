# `service_role` table-grant gap — finding, not a fix

**Recorded 2026-08-26.** This document records a finding surfaced while
answering evidentiary questions about migration 031's own rehearsal (the
`service_role` grant bug found and fixed on `outbound_sends`, PR #114). It
is NOT a fix. The fix, when it happens, is its own migration under
CLAUDE.md §0's external review gate (see SCOPE OF THE FIX, below) — this
document exists so the finding has somewhere durable to live before then,
not to authorize acting on it now.

## The mechanism

Supabase's project-level default ACL grants `service_role` **all**
privileges on every new `public`-schema table, automatically, the moment
the table is created — the same per-role default-grant mechanism already
found and fixed for FUNCTIONS in migration 020
(`020_function_execute_hardening.sql:94`,
`REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC,
anon;`) and again in migration 029 (`write_dpr_version`, U1-U5). This is
the same defect class, one object class over: a table-level `REVOKE` that
names only `anon` and `authenticated` — the two roles a migration author
is naturally thinking about, since they're the two roles PostgREST exposes
to the outside world — leaves `service_role`'s automatic DELETE, TRUNCATE,
REFERENCES, and TRIGGER privileges completely untouched. `service_role`
bypasses RLS by design (Supabase's own real Postgres role carries
`BYPASSRLS`), so for this specific role the grant layer is not one of two
independent layers of defense — it is the *only* one.

## The confirmed live instance: `dpr_versions`

Checked directly, read-only, against **production**
(`jvxwqignooseazzmwhvl`), breadcrumb confirmed immediately before the
query and the link switched back to test-db (`exfccwlrhoutkgrlikod`)
immediately after, per this project's own credential/prod-touch
discipline:

```sql
SELECT current_database(), now();
```
```json
{"rows": [{"current_database": "postgres", "now": "2026-08-26 17:23:17.154944+00"}]}
```

```sql
SELECT
  has_table_privilege('service_role', 'public.dpr_versions', 'DELETE') AS delete_priv,
  has_table_privilege('service_role', 'public.dpr_versions', 'TRUNCATE') AS truncate_priv,
  has_table_privilege('service_role', 'public.dpr_versions', 'REFERENCES') AS references_priv,
  has_table_privilege('service_role', 'public.dpr_versions', 'TRIGGER') AS trigger_priv,
  (SELECT count(*) FROM public.dpr_versions) AS live_row_count;
```
```json
{"rows": [{"delete_priv": true, "truncate_priv": true, "references_priv": true, "trigger_priv": true, "live_row_count": 6}]}
```

All four `true`, against a table holding 6 real rows, while
`029_dpr_versioning.sql`'s own `COMMENT ON TABLE public.dpr_versions`
calls it **"Append-only DPR generation history."** The table's own stated
design and its actual live privilege state directly contradict each
other, today, in production. `029_dpr_versioning.sql`'s own grant block
(lines 168-170) only ever revokes from `authenticated` and `anon`:
```sql
REVOKE INSERT, UPDATE, DELETE ON public.dpr_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dpr_versions FROM anon;
REVOKE ALL ON public.dpr_versions FROM anon;
```
`service_role` is never named on the table itself anywhere in that file —
only on the `write_dpr_version` function, which is a separate object with
its own separate ACL.

## Suspected instances — unverified, named as unverified

Grep of every table-creating migration (`grep -n "^CREATE TABLE"
supabase/migrations/*.sql`), then reading each one's own grant block:

- **`019_daily_log_corrections.sql`** (`daily_log_edits`, lines 139-140):
  `REVOKE INSERT, UPDATE, DELETE ON public.daily_log_edits FROM
  authenticated;` / `... FROM anon;`. `service_role` never named on the
  table.
- **`023_dpr_reports.sql`** (`dprs`, lines 181-182): same shape —
  `REVOKE INSERT, UPDATE, DELETE ON public.dprs FROM authenticated;` /
  `... FROM anon;`. `service_role` never named on the table.
- **`027_checkin_escalations.sql`** (`checkin_escalations`, lines
  439-440): same shape again. `service_role` never named on the table.

All three have the identical *textual* gap `dpr_versions` has — a
table-level REVOKE that never names `service_role`. Whether each one's
`service_role` privileges are actually still at Supabase's full default
(as directly confirmed for `dpr_versions`) has **not** been checked for
these three. Recorded as suspected, not confirmed, deliberately — per
this round's own instruction, no further prod probing happens until this
finding's own migration is ready to verify and fix all instances
together, not one at a time.

**`006_jobs_queue.sql`** (`jobs`) and **`011_processed_messages.sql`**
(`processed_messages`) are a different, and structurally larger, case:
neither file contains *any* `REVOKE`, `GRANT`, or `ENABLE ROW LEVEL
SECURITY` statement at all (confirmed: `grep -n "REVOKE\|GRANT\|ENABLE
ROW LEVEL SECURITY" supabase/migrations/006_jobs_queue.sql
supabase/migrations/011_processed_messages.sql` returns nothing, and a
repo-wide grep for either table name alongside `GRANT`/`REVOKE`/`POLICY`
in every other migration also returns nothing — no later migration ever
retrofits either). This means, for these two tables specifically, the gap
is not scoped to `service_role` — **`anon` and `authenticated` also carry
Supabase's full default privilege set**, with no RLS policy of any kind
to compensate. This is outside this document's own scope (`service_role`
excess privilege on tables that otherwise correctly restrict `anon`/
`authenticated`) and is not analyzed further here — it needs its own
separate probe and its own separate judgment about severity, named here
only so it isn't lost now that grep has already surfaced it.

**The probe that would confirm or rule out each suspected instance**,
when this finding's own migration is ready to run it (read-only, safe to
run against prod by construction, same shape as the `dpr_versions`
query above):
```sql
SELECT relname,
       has_table_privilege('service_role', 'public.' || relname, 'DELETE') AS delete_priv,
       has_table_privilege('service_role', 'public.' || relname, 'TRUNCATE') AS truncate_priv,
       has_table_privilege('service_role', 'public.' || relname, 'REFERENCES') AS references_priv,
       has_table_privilege('service_role', 'public.' || relname, 'TRIGGER') AS trigger_priv
FROM (VALUES ('daily_log_edits'), ('dprs'), ('checkin_escalations'),
             ('jobs'), ('processed_messages')) AS t(relname);
```

## Exposure — stated honestly, not inflated

`service_role` is server-side only; the anon key is the one that ships in
client code, not this one. Nothing in this codebase's current application
code issues a DELETE or TRUNCATE against any of these tables today
(grepped: no `.delete(` call against `dpr_versions`, `daily_log_edits`,
`dprs`, or `checkin_escalations` anywhere in `lib/`/`app/`). **There is no
live exploit path today** — this is not a "this table is being deleted
right now" finding.

The actual risk is latent, not active: a future cleanup script, a
mis-pointed job (a `processed_messages`-style pruning routine written for
one table and accidentally pointed at another), or a bug in code that
legitimately holds the service-role key, would **silently succeed**
against records these tables' own design calls append-only or durable —
with the database offering zero rejection, because the only mechanism
that could have rejected it (the grant layer) was never actually
restrictive for this role. The symptom, if this ever fires, is not an
error anyone would see and investigate. It's a coverage check (031's own
item F) or an unreachability count (C2) quietly computing against rows
that used to exist and don't anymore — which reads as "nothing was sent
that day" or a wrong failure streak, not as "someone deleted data."

## Why the dry-run scaffold could not have caught it — evidence FOR the existing rule, not against it

Vanilla local Postgres has no analog to Supabase's project-level default
ACL configuration. A bare `CREATE ROLE service_role` in a disposable local
scaffold starts with *no* privileges on a freshly created table until
something explicitly grants them — so even a dedicated `service_role
DELETE, expect denied` test, if one had been written into 031's round-1
dry-run suite, would have come back **denied** on the local stub, a false
negative on the actual bug, because the stub cannot reproduce the
mechanism (Supabase's own default ACL) that creates the excess privilege
in the first place.

This is not a new failure mode to name — it is CLAUDE.md's own existing
dry-run-discipline rule (`EVERY NEW MIGRATION GETS A DISPOSABLE DRY-RUN
BEFORE IT ENTERS A REVIEW PACKAGE`) firing exactly as documented: "this is
NOT the test-db rehearsal and does not substitute for it." That line was
written for a different limit (the two NAMED STUBS — `auth` schema and
roles) but the same underlying truth applies here: a hand-stubbed local
Postgres cannot verify anything that depends on Supabase's own
account-level configuration, and grant-completeness against Supabase's
default ACLs is exactly that kind of thing. This finding is evidence the
existing rule's stated limit is real and was correctly scoped, not
evidence the rule needs to be distrusted.

## Scope of the fix, when it happens

Its own migration, when it ships: touches grants on existing objects,
trips CLAUDE.md §0's external review gate condition (b) directly (same
condition 020 and 029's own fixes tripped). Before that migration is
written, it must **probe every table-creating migration**, not just the
four identified here (`dpr_versions` confirmed; `daily_log_edits`,
`dprs`, `checkin_escalations` suspected) — plus resolve what to do about
`jobs`/`processed_messages`'s larger, differently-shaped gap, which this
document deliberately does not attempt to fix or fully scope. Not started
here. Recorded, not fixed.
