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

## Suspected instances — confirmed on test-db, still unverified on prod

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
table-level REVOKE that never names `service_role`. **Update, same
session:** the dynamic fingerprint query in POST-APPLY FINGERPRINT below
was sanity-checked against **test-db** (`exfccwlrhoutkgrlikod`,
read-only) to confirm the query itself works, and its output confirms
all three — `delete_priv`/`truncate_priv`/`references_priv`/
`trigger_priv` all `true` for `service_role` on `daily_log_edits`,
`dprs`, and `checkin_escalations`, same as `dpr_versions`. This is
CONFIRMED on test-db now, not merely textual. **Still not separately
confirmed on prod** — per this round's own instruction, no further PROD
probing happens until this finding's own migration is ready to verify
and fix all instances together, not one at a time; test-db and prod are
schema-identical post-016 (CLAUDE.md §6) but that is a documented
convention, not a substitute for actually checking prod when the fix
migration is ready to apply.

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
here. Recorded, not fixed. Its own required evidence shape is specified
below, not left to be improvised at apply time.

## Post-apply fingerprint — the fix's own required evidence shape

Specified now, ahead of the fix, per the reviewer's own instruction: the
fix's evidence must answer the question this finding actually raised —
"does ANY table in this schema still leave `service_role` with excess
privileges" — not merely confirm that the four named instances above got
patched. A probe hardcoded to a fixed list of table names (the earlier
SUSPECTED INSTANCES section above uses exactly that shape, deliberately,
since its job there was narrower — confirming or ruling out four SPECIFIC
suspects before the fix is even written) would silently miss a fifth
table nobody happened to name. The post-apply fingerprint must instead
enumerate every table dynamically:

```sql
SELECT
  c.relname AS table_name,
  has_table_privilege('service_role', 'public.' || c.relname, 'DELETE')     AS delete_priv,
  has_table_privilege('service_role', 'public.' || c.relname, 'TRUNCATE')   AS truncate_priv,
  has_table_privilege('service_role', 'public.' || c.relname, 'REFERENCES') AS references_priv,
  has_table_privilege('service_role', 'public.' || c.relname, 'TRIGGER')    AS trigger_priv
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

`pg_class`/`pg_namespace`, not `information_schema.tables` — the same
catalog-level source this project's own probes already use elsewhere
(`pg_constraint`, `pg_indexes` in migration 031's own rehearsal), and
`relkind = 'r'` scopes to ordinary tables only (excludes views, sequences,
indexes — none of which `has_table_privilege` questions like DELETE/
TRUNCATE apply to in the same way). Run against a live database only
(read-only, safe by construction), never inferred from migration file
text — this is exactly the dimension `scripts/lint-migrations.mjs`'s new
`service-role-grant-required` rule (added alongside this document, same
day) CANNOT verify: that rule confirms `service_role` is NAMED in some
REVOKE targeting the table, not that the resulting live privilege set is
actually correct. A `REVOKE SELECT ON t FROM ... service_role` would
satisfy the textual rule while leaving DELETE/TRUNCATE untouched; only
this query catches that.

**The fix's evidence is not "these four tables are now clean."** It is
this query's full output, every row, both BEFORE the fix (establishing
what the fix actually changed) and AFTER (proving every table intended to
be restrictive now is — `jobs`/`processed_messages` excluded or included
deliberately, by name, depending on whatever this document's still-open
scoping question about their larger gap resolves to, not by omission).
Any row the fix's author did not expect to see — a table nobody's REVOKE
touches at all, DELETE still `true` — is exactly the shape of surprise
this finding exists to prevent happening a second time.

**Sanity-checked, this session, against test-db (`exfccwlrhoutkgrlikod`,
read-only, not prod) — confirms the query works and confirms the
mechanism is schema-wide, not confined to the tables named above:**
every single `public` table returns `delete_priv`/`truncate_priv`/
`references_priv`/`trigger_priv` all `true` for `service_role` EXCEPT
`outbound_sends` (all `false` — this round's own fix, holding). That is
28 of 29 tables, including `daily_log_edits`/`dprs`/`checkin_escalations`
(the three SUSPECTED instances above — now confirmed on test-db, though
still not separately confirmed on **prod** specifically, which this
session deliberately did not re-probe), `jobs`/`processed_messages` (as
expected, matching their no-REVOKE-at-all shape), and every one of
`001_core_schema.sql`'s original tables (`tenants`, `users`, `projects`,
`daily_logs`, `boq_items`, `tenders`, `vendors`, `ra_bills`, and the rest).

**Important, stated precisely so this evidence isn't misread as 28
confirmed instances of THE SAME finding:** `service_role` holding full
DML/DDL privileges is not automatically a problem — for most of these 28
tables (`daily_logs`, `projects`, `users`, and similar ordinary
operational tables), the backend legitimately needs full CRUD access as
part of normal application behavior, and nothing in their own design
claims otherwise. The finding this document exists to track is narrower:
tables whose OWN STATED DESIGN promises append-only or durable-record
status while `service_role` can silently violate that promise —
`dpr_versions` (confirmed), and by the same argument `daily_log_edits`
("audit trail... source of truth") and `checkin_escalations` ("written
only by the escalation sweep job... upserting") are plausible members of
that narrower set, `dprs` less obviously so (no comparable immutability
claim found in `023_dpr_reports.sql`, worth checking specifically before
the fix migration decides its own scope). This test-db fingerprint proves
the MECHANISM is universal; it does NOT by itself prove all 28 tables
need the same fix — that judgment belongs to whoever scopes the fix
migration, table by table, against each one's own documented design
intent, not to a blanket "service_role should never have DELETE
anywhere" rule this document does not argue for.

## Additional confirmed instances (2026-08-28) — three more, none on the original suspect list

Found while answering an unrelated schema question about the ad-hoc menu
spec (`docs/plans/adhoc-menu-spec.md`) — `hindrances`, `safety_incidents`,
and `invoices` all needed a live schema read anyway, and the same
`has_table_privilege` shape from the `dpr_versions` probe above was run
against them at the same time. **None of these three appeared anywhere on
this document's own SUSPECTED INSTANCES list above** — that list named
`daily_log_edits`, `dprs`, and `checkin_escalations` specifically, found
by grepping table-creating migrations for a REVOKE block that named only
`anon`/`authenticated`. These three were never grepped for at all in that
pass. **That is itself a finding about the scope of the original
assessment, not just three more data points**: the SUSPECTED INSTANCES
section was built by reading REVOKE blocks in migration files, which finds
tables that tried and got it wrong — it cannot find tables that never had
a REVOKE attempted in the first place, which is exactly this case (see
below).

Checked directly, read-only, against **production** (`jvxwqignooseazzmwhvl`),
same breadcrumb-then-probe-then-relink discipline as the `dpr_versions`
instance above:

```sql
SELECT current_database(), now(), inet_server_addr();
```
```json
{"rows": [{"current_database": "postgres", "now": "2026-08-28 15:31:06.188661+00", "inet_server_addr": "2406:da1c:4c7:f801:fe9c:cf7d:17b0:8d1f"}]}
```

```sql
SELECT
  t.tbl AS table_name,
  has_table_privilege('service_role', 'public.' || t.tbl, 'DELETE') AS service_role_can_delete,
  has_table_privilege('service_role', 'public.' || t.tbl, 'TRUNCATE') AS service_role_can_truncate,
  has_table_privilege('service_role', 'public.' || t.tbl, 'REFERENCES') AS service_role_can_references,
  has_table_privilege('service_role', 'public.' || t.tbl, 'TRIGGER') AS service_role_can_trigger,
  has_table_privilege('anon', 'public.' || t.tbl, 'SELECT') AS anon_can_select,
  has_table_privilege('anon', 'public.' || t.tbl, 'INSERT') AS anon_can_insert,
  has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT') AS authenticated_can_insert
FROM (VALUES ('hindrances'), ('safety_incidents'), ('invoices')) AS t(tbl);
```
```json
{
  "rows": [
    {
      "table_name": "hindrances",
      "service_role_can_delete": true,
      "service_role_can_truncate": true,
      "service_role_can_references": true,
      "service_role_can_trigger": true,
      "anon_can_select": true,
      "anon_can_insert": false,
      "authenticated_can_insert": true
    },
    {
      "table_name": "safety_incidents",
      "service_role_can_delete": true,
      "service_role_can_truncate": true,
      "service_role_can_references": true,
      "service_role_can_trigger": true,
      "anon_can_select": true,
      "anon_can_insert": false,
      "authenticated_can_insert": true
    },
    {
      "table_name": "invoices",
      "service_role_can_delete": true,
      "service_role_can_truncate": true,
      "service_role_can_references": true,
      "service_role_can_trigger": true,
      "anon_can_select": true,
      "anon_can_insert": false,
      "authenticated_can_insert": true
    }
  ]
}
```

**All `true` for `service_role` DELETE and TRUNCATE, on all three tables.
CONFIRMED, not suspected — moved from "not assessed" to CONFIRMED as of
this entry.** All three were created in `supabase/migrations/001_core_schema.sql`
and have **never had a REVOKE run against them at all**, by any later
migration: a grep for every migration file referencing `hindrances`,
`safety_incidents`, or `invoices` by name (`001`, `002_rls_policies.sql`,
`003_indexes.sql`, `016_corrections.sql`, `017_rls_column_bounding.sql`,
`030_morning_flow_attendance.sql` — the last four only touch them
incidentally, e.g. `017`'s hit is `daily_logs.morning_hindrances`, a
different column entirely, not the `hindrances` table) turns up zero
`REVOKE` statements naming any of the three anywhere in this repo's
migration history. This is a DIFFERENT shape from the four instances
above: `dpr_versions`/`daily_log_edits`/`dprs`/`checkin_escalations` each
had a REVOKE that named `anon`/`authenticated` and simply forgot
`service_role` — an attempt that fell short. These three never had an
attempt at all — the REVOKE block for these tables was never written,
which is why grepping for "REVOKE blocks that omit service_role" (the
method that built the original SUSPECTED INSTANCES list) could not have
found them; the grep target itself doesn't exist for these three tables.

Row counts on production, same session: all three **empty** (`count = 0`).
No live data is currently exposed by this gap on these tables — same
"latent, not active" framing as the rest of this document's EXPOSURE
section applies here too.

## A second, wider gap, not previously recorded (2026-08-28) — `authenticated` holds full CRUD on all three, and this document's own framing did not anticipate it

The same investigation that found the three `service_role` instances
above also read the full table-level grant list for `hindrances`,
`safety_incidents`, and `invoices` (`information_schema.role_table_grants`,
filtered to `anon`/`authenticated`/`service_role`). **On all three tables,
`authenticated` holds all seven table-level privileges Postgres tracks:
DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.** Like the
`service_role` gap, this is Supabase's own default per-role ACL, untouched
since table creation — the same "no REVOKE was ever attempted" fact
established above applies to `authenticated` on these three tables too,
not only to `service_role`.

**Stated precisely, not alarmingly.** Every one of these three tables has
RLS enabled with four policies (SELECT/INSERT/UPDATE/DELETE), each scoped
to `roles: {authenticated}` and gated `tenant_id = get_user_tenant_id()`.
A logged-in user cannot reach another tenant's rows through these grants —
RLS still evaluates on every query `authenticated` issues, and every
policy correctly bounds by tenant. **This is not currently exploitable
across tenants.** But the grant layer itself offers zero restriction of
its own: nothing at the GRANT level stops `authenticated` from issuing a
DELETE or TRUNCATE against these tables — RLS is the only thing doing that
job. That makes this **materially different from the `service_role` case
this document otherwise concerns itself with**: for `service_role`, the
grant layer is the only control because RLS is bypassed by design (`BYPASSRLS`) —
there is no second layer to fall back on if the grant is wrong. For
`authenticated`, RLS is a real, currently-correct second layer — but a
single RLS policy regression (a bad migration, a policy accidentally
dropped and not replaced), or a future table created without policies at
all before anyone notices, would immediately expose full CRUD to any
authenticated session, tenant-bounding or not, with the grant layer
offering no independent backstop either way. This document's own EXPOSURE
section above only ever framed the risk in terms of `service_role`
bypassing RLS; it did not anticipate or record that the SAME missing-REVOKE
pattern also strips the grant layer's independent value for `authenticated`,
even where RLS itself is currently sound.

## Rescoped (2026-08-28) — this is larger than "probe every table, fix the append-only ones"

**The fix's scope, as written above (Scope of the fix, when it happens),
was: probe every table for the `service_role` gap specifically, then fix
whichever ones this document's own EXPOSURE reasoning judges should be
restrictive (the append-only/durable-record subset).** That framing no
longer matches what's actually been found. Two things changed it:

1. **The `service_role` gap is closer to universal than exceptional.**
   The POST-APPLY FINGERPRINT section above already recorded, from a
   test-db sanity check, that 28 of 29 `public` tables show `service_role`
   holding full DELETE/TRUNCATE/REFERENCES/TRIGGER — only `outbound_sends`
   (031's own fix) does not. That was recorded as evidence the *mechanism*
   is schema-wide; this entry's own three new confirmed instances
   (`hindrances`, `safety_incidents`, `invoices`) are simply three more
   rows in a table that was already 28-of-29 wide. Treating each newly
   confirmed table as its own "instance" undercounts what this actually
   is: a property of how every table in this schema was created, not a
   scattering of individual oversights.
2. **`authenticated`'s posture across the OTHER 26+ tables is completely
   unknown, because that probe has never been run.** Every privilege
   statement in this document up to this point — the original four, the
   28-of-29 test-db fingerprint, the three new instances above — was
   scoped to `service_role` only. Whether `authenticated` also holds full
   CRUD (as now confirmed for these three) on `daily_logs`, `projects`,
   `dpr_versions`, or any other `public` table, and whether each of those
   tables' own RLS policies are as complete as the three checked here, is
   simply not known. Given that these three turned out to have RLS fully
   in place (mitigating, not eliminating, the finding above), and given
   that RLS completeness has never been the subject of a schema-wide sweep
   any more than grants have, assuming the rest of the schema is fine by
   default is exactly the assumption that let 28-of-29 tables carry the
   `service_role` gap unnoticed for as long as they did.

**The fix is not a patch over the instances named across this document.**
It needs, ahead of any migration:

- A full privilege matrix across **every `public` table**, for **both**
  `service_role` and `authenticated` (the POST-APPLY FINGERPRINT query
  above, generalized to both roles rather than one), run once and read in
  full — not filtered to a suspect list assembled by grepping REVOKE
  blocks, which this entry's own three new instances already proved
  misses tables that never had a REVOKE attempted at all.
- For `authenticated` specifically, the matrix needs a second pass this
  document has never required for `service_role`: RLS completeness per
  table (is RLS enabled, does a policy exist for every operation the
  grant allows) — because for `authenticated`, unlike `service_role`,
  RLS is the thing actually doing the restricting, so the grant matrix
  alone doesn't tell the whole story the way it does for `service_role`.
- A per-table decision, made against each table's own documented design
  intent (the same judgment call this document's own closing paragraph
  above already named for the `service_role`-only version of this
  question), not a blanket rule for either role.

**This is now larger than one migration and needs its own plan** — scoping
it, sequencing the privilege-matrix probe ahead of any fix migration, and
deciding how many separate migrations the eventual fix becomes (grants
alone trip CLAUDE.md §0's external review gate condition (b) regardless of
how many tables one migration touches) is not attempted in this document.
Recorded here so the next person scoping the fix starts from "this is
schema-wide across two roles," not from the narrower "four known tables,
one role" framing this document opened with.

## Next step, named — the `authenticated` equivalent of the `service_role` matrix, not yet run

The POST-APPLY FINGERPRINT query above (`has_table_privilege('service_role', ...)`
across every `public` table via `pg_class`/`pg_namespace`) has been run,
sanity-checked on test-db, and its shape is proven. **The identical query,
parameterized to `'authenticated'` instead of `'service_role'`, across
every `public` table, has never been run** — not on test-db, not on prod.
That is the concrete next step this document names but does not execute:
run it once, against test-db first (this document's own established
discipline — sanity-check on test-db before ever touching prod with a new
probe shape), and pin the result as this schema's baseline `authenticated`
privilege posture, the same way the `service_role` 28-of-29 result already
serves as this document's baseline for that role. Until that probe runs,
"how bad is the `authenticated` gap, schema-wide" has exactly one data
point (these three tables, all fully RLS-covered) — not enough to
generalize from in either direction, optimistic or pessimistic.
