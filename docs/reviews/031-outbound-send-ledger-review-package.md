# Migration 031 — outbound_sends ledger — external review package

Companion to `docs/plans/pass1-outbound-send-plan.md` (item C's own spec,
and the load-bearing corrections landed 2026-08-26 alongside this package:
B3 struck through as built/live, GATE 1 recorded lifted, and the plan's
own §2 recording `design-decisions-beta-feedback.md` §35's idle-inbound
interaction as OPEN, not decided) and `design-decisions-beta-feedback.md`
§36 (the proposed `project_members(user_id)` UNIQUE index this table's own
PROJECT SCOPE section depends on).

**Status: opened for review. NOT applied anywhere — test-db, prod, neither.
NOT the send primitive itself, which does not exist yet (see §11, PENDING).**

## 0. Repo-state header, raw

- `main @ e650ed8` (`origin/main`)
- `supabase migration list --linked` (test-db, `exfccwlrhoutkgrlikod`):
  local/remote agree through `001-007, 011-030, 032, 033`. **031 present in
  neither** — this package's own migration has not touched test-db, matching
  its STATUS line (written, not applied).
- Last runbook executed: migration 033's production apply
  (`docs/reviews/033-apply-record.md`, 2026-08-25).

## 1. The migration in full

Committed in this same commit as this package (first submission — there is
no prior commit to pin this content against via `git show`, unlike a
revision round). Full text: `docs/reviews/031_outbound_send_ledger.sql`,
sibling file to this one.

Summary of what it creates: one table, `outbound_sends` — 12 columns, one
composite UNIQUE constraint (the idempotency gate), two indexes, RLS
enabled with zero policies, explicit grant revoke/grant. No function, no
trigger.

## 2. CLAUDE.md §0 gating assessment — stated up front, it is why this needs the gate

Trips **(b)** grants/RLS on a new object, **(d)** destructive/irreversible
(a delivered WhatsApp message cannot be unsent, and this table is the only
record of what was sent and where), **(e)** moves money (every row this
table can produce corresponds to a billed Meta template send). Does not
trip (a) (no function) or (c) (adjacent to WhatsApp/phone identity, not
web-auth identity). Three of five conditions trip — this migration's own
workstream requires the external review gate on its own terms, independent
of anything else in Pass 1's scope.

## 3. `event_key` — the mechanism, and why the UNIQUE constraint is the idempotency gate

Composition: `'<checkpoint>:<IST calendar date>'`, e.g.
`morning_send:2026-08-26`. `<checkpoint>` matches a `CHECKIN_CHECKPOINTS`
key name (`lib/daily-logs/cutoffs.ts`) that has an associated send;
`<IST calendar date>` via `istDateString` (`lib/daily-logs/date.ts`), the
same IST-day helper `log_date` already uses elsewhere in this codebase —
never the raw UTC send timestamp, which could roll to the wrong calendar
day near midnight IST.

`event_key` alone only encodes checkpoint+day — it does not embed the
engineer. Uniqueness is `UNIQUE (tenant_id, recipient_user_id, event_key)`:
pairing event_key with `recipient_user_id` (plus `tenant_id`, defense in
depth against a cross-tenant UUID collision) is what makes "this engineer's
morning trigger for this IST day" unique. A cron retry for the same
checkpoint attempts the identical INSERT, hits the constraint, and no-ops
before any Twilio call is made — no application-layer "have I already sent
this" check is needed or trusted; the database enforces it structurally.

Secondary use: item F's coverage comparison reads `event_key` without
pinning to one engineer — `SELECT count(*) FROM outbound_sends WHERE
event_key = 'morning_send:2026-08-26' AND status = 'sent'` (see §5 for why
`AND status = 'sent'` is required, not optional).

## 4. Project scope — decided rule, unenforced schema, §36 named

DECIDED (Aravind, 2026-08-26): one engineer belongs to exactly one project;
a project may have many engineers. Under this rule `project_id` is
unambiguous per `recipient_user_id`, so it needs no place in the UNIQUE
constraint. **The schema does not enforce this rule** — `project_members`
permits multiple rows per `user_id` today, the exact ambiguity migration
033's own sweep (`sweep_stale_morning_sessions`) has to count and skip
around rather than guess. This migration trusts the decided rule instead of
repeating that defensive count, on the reasoning that the send primitive's
own roster query is the correct place to resolve `project_id` per engineer
— a real, named dependency on an unenforced rule, not a silent assumption.
`design-decisions-beta-feedback.md` §36 (2026-08-26, "DECIDED IN PRINCIPLE,
NOT SCHEDULED") proposes a `UNIQUE INDEX ON project_members(user_id)` to
make this structural — its own migration, its own review, gated on a
pre-check that today's data has no existing duplicate.

## 5. Stuck-claim analysis

**The gap.** A claim commits `status='sending'` BEFORE the Twilio call
(send primitive ordering: claim → send → activate, plan §1). A process
death anywhere before the terminal UPDATE leaves the row stuck at
`'sending'` FOREVER under the bare UNIQUE constraint — a later claim
attempt for the identical `(tenant_id, recipient_user_id, event_key)` hits
the constraint and no-ops (safe: no double-send), but that also means no
retry ever happens for that engineer, that checkpoint, that day. Nothing
resends tomorrow either — tomorrow's `event_key` is a different string.

**Why it is not separable from item F.** Item F's original spec (plan
Amendment (b)) compared a bare row count against expected roster size — a
stuck `'sending'` row COUNTS as coverage under that query, making the exact
failure item F exists to catch (nothing sent, no signal anywhere)
invisible to it, because the ledger does have a row, it just never left
`'sending'`. Both are in the same Pass. Originally scoped as separate
("known gap, future work" for the stuck row; item F shipped standalone) —
corrected: deferring one while shipping the other ships a check that
reports full coverage on a day it wasn't true.

**Rejected: blind claim-age auto-reclaim.** `INSERT ... ON CONFLICT (...)
DO UPDATE SET status='sending' WHERE outbound_sends.status='sending' AND
outbound_sends.updated_at < now() - INTERVAL '10 minutes'`, then retry the
send. Cannot distinguish two cases with an IDENTICAL ledger signature: (i)
died before the Twilio call — safe to retry — versus (ii) died AFTER
Twilio's 2xx but BEFORE the status UPDATE committed — the message genuinely
went out. Retrying case (ii) sends a real, already-delivered WhatsApp
message a second time. No threshold resolves the ambiguity, only narrows
it — "usually safe" is not the guarantee this table's own UNIQUE constraint
provides everywhere else in its design.

**Chosen: alert-only reconciliation, folded into item F's own scan.**
Already reading this table, already running inside the existing `jobs/tick`
cron (60s cadence). In addition to the coverage count (fix (a): `AND status
= 'sent'`), item F also selects `status = 'sending' AND updated_at < now()
- INTERVAL '10 minutes'` and raises a Sentry alert per stuck row
(fingerprinted on the row's `id`, same per-item dedup discipline as
`reportMorningSweepAnomalies`), naming `to_phone_number` and `content_sid`
directly so investigation never requires reconstruction from other tables.
**Nothing auto-retries.** Resolution requires a human to check Twilio's own
delivery log before deciding whether to manually mark the row resolved or
trigger a fresh send.

**The honest line.** Alert-only means a stuck row is a Sentry issue nobody
may actually read at 08:30 — that engineer silently receives nothing that
day regardless of whether the alert fired. Item F's coverage check
independently catches the same gap as a count mismatch, so the failure is
caught TWICE — but both surfaces are ALERTS, not RECOVERIES. Correct for
Pass 1's actual scale (same reasoning as `design-decisions-beta-
feedback.md` §35f's own accepted gap) — but "caught by two independent
alerts" must not be misread as "handled." It is observed, twice. It is not
fixed, either time.

## 6. `content_sid` / `to_phone_number` — self-describing, and why NOT NULL holds

Without these, this table's header calling itself "the only record that it
happened" was not fully true — it could not say WHAT was sent or WHERE.
`content_sid` (Twilio's Content SID for the template body actually sent) —
four `_v2` spare templates exist precisely so a primary template Meta later
disables has a fallback, meaning two different bodies can legitimately be
sent for the identical `event_key` shape on different days; without this
column the ledger cannot say which one an engineer received.
`to_phone_number` (the destination as actually sent, not derived after the
fact) — engineers changing numbers over time means resolving
`recipient_user_id → users.whatsapp_number` later returns today's number,
not the one this specific message went to.

**The actual reason, not convenience:** without these, `twilio_sid` is the
only lookup path back to what was sent — making Twilio's own log retention
the system of record for this project's own billed sends, not this
database. **Stuck-row investigation becomes self-contained** as a direct
consequence — the Sentry alert in §5 can name the exact number and template
to check in Twilio's own log, not require reconstruction from other tables
first.

**Why NOT NULL holds — confirmed against the send primitive's own
ordering, not assumed.** Both values are required *parameters* of the
Twilio Messages API POST call itself (`ContentSid`, `To`) — the send
primitive cannot construct that call without already having resolved both.
The claim INSERT happens before the POST (claim → send → activate), so by
construction both are already known at INSERT time. No case exists where
either is legitimately unknown then.

**No format CHECK on `content_sid`, deliberately — three rounds of review
on this file, this was the last correction.** `event_key` gets a format
CHECK because this codebase constructs every character of it — validating
it validates our own code. `content_sid` originates with Twilio; a format
assumption about a third party's identifier buys nothing we control, and a
false rejection is severe and asymmetric — the claim precedes the send, so
a rejected claim is a hard fail on the WHOLE checkpoint for that engineer,
caused by an assumption about a format Twilio owns, not this codebase. A
genuinely malformed `content_sid` is already caught, safely, one step
later: Twilio's own 4xx, which this table's existing failure-mode design
already handles (`status='failed'`, `error` populated, a loud Sentry
alert). A DB-level CHECK adds nothing real over that path; it only adds an
earlier, higher-stakes rejection point that can misfire on a legitimately-
shaped value guessed wrong. Even a loosened check (`^HX` + a length floor)
carries the same category of risk at lower odds — narrowing is not
removing, and the stakes don't justify keeping it at any strictness.
`to_phone_number` keeps its E.164 CHECK — that value is ours, already
normalised by this codebase's own code before it reaches this table, same
reasoning as `event_key`.

## 7. Grants and RLS evidence

```sql
ALTER TABLE outbound_sends ENABLE ROW LEVEL SECURITY;  -- zero policies, default-deny
REVOKE ALL ON outbound_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON outbound_sends TO service_role;
```
Behavioral proof (§8, T8-T10): `anon` SELECT → `permission denied for table
outbound_sends`. `authenticated` INSERT → `permission denied for table
outbound_sends`. `service_role`, with the `BYPASSRLS` attribute Supabase's
real `service_role` Postgres role carries (this scaffold's stub explicitly
grants it to model that, confirmed correct in an earlier round by testing
both with and without it) → reads and writes freely. No DELETE granted to
any role — this table is a durable send record, not a queue to be pruned.

## 8. Dry-run scaffold evidence — every constraint exercised

Disposable local Postgres 17.11 (matching prod/test-db's 17.x), stub roles
+ `tenants`/`projects`/`users` (stable, unchanged FK targets — the three
prior review rounds on this file used the same minimal stub each time, not
a full `pg_dump` scaffold, since the risk class this migration carries is
about its own constraints, not about referencing something that doesn't
exist). Torn down after every round; nothing left running.

Full behavioral suite, this round, raw:
```
=== T1: well-formed claim -- expect INSERT 0 1 ===
INSERT 0 1
=== T2: duplicate claim (same tenant/engineer/event_key) -- expect UNIQUE violation ===
ERROR:  duplicate key value violates unique constraint "outbound_sends_tenant_id_recipient_user_id_event_key_key"
DETAIL:  Key (tenant_id, recipient_user_id, event_key)=(...) already exists.
=== T3: malformed event_key -- expect CHECK violation ===
ERROR:  new row for relation "outbound_sends" violates check constraint "outbound_sends_event_key_check"
=== T4: NULL content_sid -- expect NOT NULL violation ===
ERROR:  null value in column "content_sid" of relation "outbound_sends" violates not-null constraint
=== T5: NULL to_phone_number -- expect NOT NULL violation ===
ERROR:  null value in column "to_phone_number" of relation "outbound_sends" violates not-null constraint
=== T6: malformed to_phone_number -- expect CHECK violation ===
ERROR:  new row for relation "outbound_sends" violates check constraint "outbound_sends_to_phone_number_check"
=== T7: non-HX-shaped content_sid -- expect SUCCESS (no format check, by design) ===
INSERT 0 1
=== T8: anon SELECT -- expect permission denied ===
ERROR:  permission denied for table outbound_sends
=== T9: authenticated INSERT -- expect permission denied ===
ERROR:  permission denied for table outbound_sends
=== T10: service_role (BYPASSRLS) SELECT -- expect the 2 rows from T1+T7 ===
        event_key        |            content_sid             | to_phone_number | status
-------------------------+------------------------------------+-----------------+---------
 morning_send:2026-08-26 | HX1234567890abcdef1234567890abcdef | +919176865600   | sending
 evening_send:2026-08-26 | some-other-shape-entirely          | +919176865600   | sending
(2 rows)
=== T11: stuck-row scan finds nothing yet (all rows fresh) ===
 stuck_count
-------------
           0
=== T12: item F coverage query (status=sent only) -- expect 0, nothing marked sent yet ===
 count
-------
     0
=== T13: simulate a completed send, then re-run T12 -- expect 1 ===
UPDATE 1
 count
-------
     1
=== T14: simulate a stuck row (20 min old, still sending) -- scan finds it, index is used ===
                         QUERY PLAN
-------------------------------------------------------------
 Index Scan using idx_outbound_sends_stuck on outbound_sends
   Index Cond: (updated_at < (now() - '00:10:00'::interval))
(2 rows)
        event_key         | to_phone_number |            content_sid
--------------------------+-----------------+------------------------------------
 evening_nudge:2026-08-26 | +919176865600   | HXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
(1 row)
```
All 14 cases behaved exactly as designed — every constraint this table
carries was exercised, both the ones that must reject and the one that
must deliberately let a value through (T7, proving the content_sid
non-check decision is real, not accidental).

## 9. Rollback — executed, not asserted

For a new table, the rollback is `DROP TABLE outbound_sends`. Run for
real against the same disposable scaffold, literal output at each step.

**R1 — pre-rollback state.**
```sql
SELECT count(*) FROM pg_class WHERE relname = 'outbound_sends' AND relkind = 'r';
SELECT count(*) FROM pg_indexes WHERE tablename = 'outbound_sends';
SELECT count(*) FROM pg_constraint WHERE conrelid = 'outbound_sends'::regclass;
SELECT count(*) FROM outbound_sends;
```
```
 table_count | index_count | constraint_count | row_count
-------------+-------------+------------------+-----------
           1 |           4 |                8 |         3
```

**R2 — rollback (write).**
```sql
DROP TABLE outbound_sends;
```
```
DROP TABLE
```

**R2a — confirmed gone, table and everything attached to it.**
```sql
SELECT count(*) FROM pg_class WHERE relname = 'outbound_sends' AND relkind = 'r';  -- 0
SELECT count(*) FROM pg_indexes WHERE tablename = 'outbound_sends';                -- 0
SELECT count(*) FROM pg_constraint WHERE conrelid = 'outbound_sends'::regclass;    -- ERROR: relation "outbound_sends" does not exist
SELECT count(*) FROM outbound_sends;                                              -- ERROR: relation "outbound_sends" does not exist
```
The two errors are stronger confirmation than a zero count would be —
`'outbound_sends'::regclass` cannot even resolve once the table is gone,
so both queries fail at the catalog-lookup stage, before ever reaching a
row scan. Indexes and constraints went with the table, not left orphaned.

**R3 — re-apply.**
```
BEGIN / CREATE TABLE / CREATE INDEX / CREATE INDEX / ALTER TABLE / REVOKE / GRANT / COMMIT
```
Clean, no errors.

**R3a — confirmed restored, structurally identical to R1.**
```
 table_count | index_count | constraint_count | row_count
-------------+-------------+------------------+-----------
           1 |           4 |                8 |         0
```
Same table/index/constraint counts as R1; `row_count=0` is correct and
expected — a fresh table, not a restore of the specific test rows from
before (which were disposable test data, not something the rollback needs
to preserve).

**R3b — grants/RLS also confirmed restored.**
```
SET ROLE anon; SELECT * FROM outbound_sends;      -- ERROR: permission denied for table outbound_sends
SET ROLE service_role; SELECT count(*) FROM outbound_sends;  -- count: 0, succeeds
```

Scaffold torn down after. Nothing left applied anywhere — this migration
has never touched test-db or prod.

## 10. Apply runbook — S0-S5

Instantiates `docs/migration-runbook-template.md`'s canonical A-E
skeleton, same S-numbering convention as migrations 030 and 033's own
runbooks.

### Session-probe analog — not needed, argued

030/033's own runbooks each carried a pre-apply state probe of
`whatsapp_sessions` because their own SQL either changed what an
in-flight session's `current_step` MEANT (030) or acted directly on live
session rows (033). This migration does neither — `CREATE TABLE` has no
interaction with any existing row, session, or in-flight request of any
kind. There is no equivalent pre-existing state this migration could
disturb. No session probe in this runbook.

### The lockstep clause — NOT critical this time, unlike 033's own

033 shipped its SQL and its TS caller (the wrapper, the tick-route hook)
in the SAME PR, so merge-before-apply created a real window of a deployed
route calling a function that didn't exist yet. **This migration ships
ALONE — the send primitive that will eventually call it does not exist
yet (§11, PENDING)**, so there is no caller in `main` today, and none
shipping alongside this PR. Applying the SQL before OR after this PR
merges creates a dormant, unused table either way — safe in both orders.
Confirmed, not assumed: `grep -rn "outbound_sends" lib/ app/` on current
`main` returns nothing. Merge and apply may happen in either order.

### S0-S5

- **S0. PITR window observation (no SQL).** Dashboard → Database →
  Backups → Point in Time. Observe an active restore window ending ~now,
  record the timestamp (CLAUDE.md §0: verified by observation).

- **S1. Pre-apply identity + fingerprint probe (read-only), pinned raw.**
  Confirm the linked project ref is **prod** (`jvxwqignooseazzmwhvl`),
  pasted immediately before, in the same output. Then:
  ```sql
  SELECT count(*) FROM pg_class WHERE relname = 'outbound_sends' AND relkind = 'r';
  ```
  **Expected: 0** (not yet applied to prod).

- **S2. Apply (write).** `supabase db query --linked -f
  supabase/migrations/031_outbound_send_ledger.sql` (never `db push`).
  Paste the result.

- **S3. Post-apply probes (read-only).** Same fingerprint as §9's R3a/R3b:
  table/index/constraint counts (1/4/8), `anon`/`authenticated` denied,
  `service_role` granted. Paste each.

- **S4. Merge.** Per the lockstep argument above, order relative to S2
  does not matter for correctness — merge whenever convenient once S3
  confirms clean.

- **S5. Ledger repair (write) + verify.** `supabase migration repair
  --status applied 031 --linked` (breadcrumb confirmed first), then
  `SELECT count(*)` and the full version list from
  `supabase_migrations.schema_migrations`. Same discipline as 030/033's
  own S6 — not optional scaffolding.

**After apply:** `docs/schema.md`'s `031` entry, written only after S5
confirms. Record the applied SHA + probe frame in this package's own
apply-record addendum, matching `docs/reviews/030-apply-record.md` and
`docs/reviews/033-apply-record.md`'s shape.

## 11. PENDING — what cannot exist yet, and what it will contain when it can

**No test-db rehearsal.** Deliberately not run — the send primitive that
writes to this table (claims, INSERTs, the status transitions) does not
exist yet (plan items B/D/F, none built). A rehearsal against test-db
would only prove `CREATE TABLE` succeeds against a real database, which
§8/§9's disposable-scaffold evidence already establishes with the same
Postgres major version. Real rehearsal value — proving the claim/send/
activate ordering behaves correctly under real writes — requires the
primitive to exist. **When it can be produced:** alongside the send
primitive's own review package, exercising real `INSERT`/`UPDATE` calls
through the actual TypeScript code path, not hand-written SQL.

**No CI run.** This PR touches only `docs/` and one file under
`docs/reviews/` — no `supabase/migrations/` entry yet (per the standing
rule, it moves there only at apply time), so CI's migration-lint/test-db
suite has nothing new to exercise. **When it can be produced:** the same
moment the migration moves into `supabase/migrations/` for a real apply
(S2 above) — that PR will show CI running against test-db with 031
applied, same shape as migration 033's own PR #111.

**No first-real-send observation.** §10's S5 has no analog to 030/033's
own "first real production observation" step, because nothing calls this
table yet. **When it can be produced:** the send primitive's own apply
runbook, once items B-F exist and `vercel.json`'s two cron entries are
eventually added (still withheld per Aravind's own pacing, unrelated to
this migration's own review).
