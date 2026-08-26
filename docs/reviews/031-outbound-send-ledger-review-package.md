# Migration 031 — outbound_sends ledger — external review package

Companion to `docs/plans/pass1-outbound-send-plan.md` (item C's own spec,
and the load-bearing corrections landed 2026-08-26 alongside this package:
B3 struck through as built/live, GATE 1 recorded lifted, and the plan's
own §2 recording `design-decisions-beta-feedback.md` §35's idle-inbound
interaction as OPEN, not decided) and `design-decisions-beta-feedback.md`
§36 (the proposed `project_members(user_id)` UNIQUE index this table's own
PROJECT SCOPE section depends on).

**Status: reviewer round 4 — design GO, conditional on B1 (now fixed, see
§4a). APPLIED to test-db (round 4's own rehearsal, §11a below) — rolled
back and re-applied for real as part of that rehearsal, ledgered, left
applied. NOT yet applied to prod. NOT the send primitive itself, which does
not exist yet (see §11, PENDING).**

## 0. Repo-state header, raw

- `main @ e650ed8` (`origin/main`, unchanged this round — this PR has not
  merged).
- `supabase migration list --linked` (test-db, `exfccwlrhoutkgrlikod`), as
  of round 4's own rehearsal (2026-08-26): local/remote agree through
  `001-007, 011-033` — **031 now present on both**, ledgered via `supabase
  migration repair --status applied 031 --linked` at the end of this
  round's rehearsal (§11a).
- Last runbook executed: THIS package's own §11a test-db rehearsal
  (2026-08-26), superseding migration 033's production apply
  (`docs/reviews/033-apply-record.md`, 2026-08-25) as the most recent
  database-touching action in this session.

## 1. The migration in full

Now at `supabase/migrations/031_outbound_send_ledger.sql` — moved there
this round (§11a, F0) per the migration-file-lifecycle rule, since it is
now actually being applied. Prior rounds' revisions are pinned via `git
show <sha>:docs/reviews/031_outbound_send_ledger.sql` against this PR
branch's own history for anything predating the move; this round's own
delta is pinned against the new path once committed.

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

**Calibration note (added round 4) — why 033 counts-and-skips against this
exact same unenforced rule while this migration trusts it.** Not drift; a
future reader must not conclude one of the two siblings is simply wrong.
The difference is consequence class, not carelessness in either direction.
033 (the sweep): a wrong guess FABRICATES a `daily_logs` absence record
against a possibly-unrelated project — a write, with downstream consumers
(DPR generation, PM visibility) that treat the fabricated row as real data;
guessing wrong there creates a false fact that outlives the bug that caused
it. 031 (here): `event_key` deliberately excludes `project_id`, and the
UNIQUE constraint is `(tenant_id, recipient_user_id, event_key)` —
`project_id` plays no role in idempotency at all. A duplicate
`project_members` row therefore cannot cause a second send or a second
billed row: whichever `project_id` the roster query resolves, the SAME
claim (same tenant, same engineer, same checkpoint, same day) is attempted,
and the second attempt hits the UNIQUE constraint and no-ops. The blast
radius of a wrong guess here is `project_id` attribution on ONE row, never
a fabricated event or a duplicate charge. Different failure shapes justify
different defenses.

## 4a. B1 — composite tenant-scoped FKs (BLOCKING, round 4, fixed)

**The gap, as found by the reviewer.** All three FKs were plain
`REFERENCES parent(id)` with no `ON DELETE`/`ON UPDATE` — violating this
project's own standing rule that referential actions are chosen
deliberately, never left to the implicit default by omission. Worse:
`UNIQUE (tenant_id, recipient_user_id, event_key)` does not itself validate
that `recipient_user_id` actually belongs to `tenant_id` — a service-role
bug (a wrong join, a copy-pasted `tenant_id` from a different request)
could write a row pairing tenant A with tenant B's engineer, into the exact
table this file's own header calls "the only record that it happened."

**The fix.** `(recipient_user_id, tenant_id) REFERENCES users (id,
tenant_id)` and `(project_id, tenant_id) REFERENCES projects (id,
tenant_id)` — composite FKs, not single-column ones, so the database
itself rejects a cross-tenant pairing at INSERT time. Parent indexes
verified present, not assumed: `users_id_tenant_id_key` and
`projects_id_tenant_id_key`, both `UNIQUE (id, tenant_id)`, both added in
migration 017 specifically to support composite FKs — confirmed by reading
that file directly (017:58-61). Same pattern already load-bearing
elsewhere: `projects.owner_user_id` and `project_members.user_id`/
`.project_id` (017), `dpr_versions.generated_by_user` (029) — this
migration was the outlier, not the composite-FK convention. `ON DELETE
RESTRICT` on all three FKs (`tenant_id`'s own single-column FK included):
a durable billed record, users never hard-deleted (§10a,
`design-decisions-beta-feedback.md`), nothing may silently cascade a send
record away — matching `projects.owner_user_id`'s own RESTRICT precedent
over `project_members`'s CASCADE, since this table records a thing that
happened, not a membership row whose parent's deletion should take it
along.

**Dry-run proof, isolated, before ever touching test-db.** A disposable
local Postgres (separate from the §8 scaffold, torn down after use)
confirmed all three FK RESTRICT properties directly against
`pg_constraint.confdeltype`/`confupdtype` (`'r'` for RESTRICT), not via a
`DELETE FROM tenants ...` behavioral attempt — an early attempt at the
behavioral form was masked by the stub's own `projects.tenant_id` FK
firing first among tied dependents, so the catalog read was used instead
as the unambiguous form of evidence for this specific claim.

**Re-confirmed against real test-db, round 4's own rehearsal (§11a, F2).**
```sql
SELECT conname, confdeltype::text
FROM pg_constraint
WHERE conrelid = 'public.outbound_sends'::regclass AND contype = 'f';
```
```
outbound_sends_project_id_tenant_id_fkey:r
outbound_sends_recipient_user_id_tenant_id_fkey:r
outbound_sends_tenant_id_fkey:r
```
All three RESTRICT, matching the dry-run proof exactly. Both composite FKs
also behaviorally exercised with real cross-tenant INSERT attempts against
test-db (§11a, claim-path exercises C3/C4) — both rejected with a real
`23503` foreign key violation, not merely a catalog read.

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

**The designed closer (round 4)** — so "observed twice, fixed neither
time" reads as a bridge with a destination, not a dead end. The
status-callback route (plan item D, unbuilt) logs Twilio's own per-message
delivery status, keyed by `MessageSid`. Once it exists, a stuck `'sending'`
row plus Twilio's OWN record for `to_phone_number` in that time window is
EVIDENCE, not a guess — it distinguishes "died before the POST" (no Twilio
record for that number in that window: case (i), provably safe to retry)
from "died after Twilio's 2xx" (a real Twilio record exists: case (ii),
retrying would double-send). This upgrades alert-only to evidence-based
resolution, and for the provably-safe case (i) specifically, a genuine
automated retry becomes possible. **Not Pass 1** — item D is still unbuilt;
this names the shape of the eventual fix so it is designed toward, not
rediscovered from scratch once D ships.

**Named verification item for the send-primitive build (round 4).** Before
implementing the claim/send/activate sequence (item B), check whether
Twilio's Messages POST endpoint accepts an idempotency key — against
Twilio's CURRENT documentation at build time, not from memory or from this
file's own assumptions written tonight. If it does, that is the structural
fix to the entire stuck-claim window this section argues about: a
Twilio-side idempotency key would let a safe retry be attempted even
without status-callback evidence, because Twilio itself would refuse to
double-send on a repeated key — the REJECTED/CHOSEN argument above would
need revisiting against that capability. If it does not, this section's
reasoning stands unchanged.

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

**Coupled to the roster-exclusion design, stated explicitly (round 4).**
Both NOT NULLs above are not a context-free guarantee — they are
downstream of a specific upstream design choice. `messaging_blocked`,
`attendance='site_holiday'`, and already-submitted engineers are excluded
from the roster query itself (plan §5) BEFORE any claim attempt, not
filtered after one. An engineer this table never claims for never reaches
an INSERT at all, so there is no "claimed but nothing to send" case for
these two columns to be null for. **If a future pass ever records these
skips IN THIS LEDGER** instead of upstream in the roster query (e.g. to
give item F's coverage check visibility into WHY a roster member has no
row), **that change breaks this NOT NULL pair on that day** — a skip row
would have no template or destination to record, by definition. Not
hypothetical: this is exactly the shape PR #69's own now-superseded C2
formula assumed (`skipped_*` ledger rows) — see the C2 supersession below.

## 6a. C2 supersession — a dated correction, not left to be discovered as drift

PR #69's own unreachability derivation
(`docs/outbound-send-primitive-plan.md` §"C2", that branch's own round-4
design review, `git show 6de815a:...`) specifies its threshold as "3
consecutive terminal failures... with no `'sent'`/`'skipped_*'` row
anywhere among them" — written against a ledger design where a
roster-excluded engineer got its OWN row, tagged `skipped_*`. **That is
not this table's shape.** `status` here is exactly `'sending'`/`'sent'`/
`'failed'` — there is no skip status, because roster exclusion happens
upstream, in the send primitive's own roster query, before any claim
INSERT is ever attempted (see the "coupled to the roster-exclusion design"
note above). A roster-excluded engineer produces ZERO rows in this table,
not a `skipped_*` one. Under this shape, C2's own consecutive-failure logic
SIMPLIFIES: "no `'sent'`/`'skipped_*'` row among the last 3" collapses to
"no `'sent'` row among the last 3 `'failed'` rows" — correct, not broken,
since there is nothing left for the skip clause to exclude. Recorded here,
at the point where the status shape that supersedes C2's assumption is
actually decided, so a future Pass 2 implementer reads the correction
before writing C2's query, not after debugging why it finds skip rows that
were never there.

## 7. Grants and RLS evidence

```sql
ALTER TABLE outbound_sends ENABLE ROW LEVEL SECURITY;  -- zero policies, default-deny
REVOKE ALL ON outbound_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON outbound_sends TO service_role;
```
`service_role` is now explicitly named in the REVOKE — see the grant-bug
finding immediately below for why that word changed this round.

**"Backend-only" is true today, dated (round 4).** This RLS audience claim
is not permanent by default — the known future reader is the PM-facing
unreachability surface (C2/DASH-03, plan Pass 2 scope), which would need
`authenticated` read access (through an RPC or a scoped view, not a bare
table grant) the moment it's built. When that surface ships, this
zero-policy stance must be revisited as part of THAT migration's own
review, not silently outlived by a comment that stops being accurate.

**Retention (round 4, "027 convention").** Presumed INDEFINITE —
billing-record class, per this project's own three-way retention taxonomy
(`docs/build-status.md`'s DATA RETENTION POSTURE register): shaped like
`daily_logs`/`daily_log_edits` (compliance record), not
`processed_messages` (prunable hygiene) — a business record of every
billed WhatsApp send this project has ever made. No DELETE granted to any
role is the mechanical consequence; this states the reasoning explicitly
rather than leaving it implied by the grant alone. Full dated entry in
`docs/build-status.md`'s register, added alongside this round.

**A real grant bug, found by this migration's own rehearsal, not by
reading the SQL — third instance of a known finding class (round 4).**
The first draft of the REVOKE statement above listed only `PUBLIC, anon,
authenticated` — never `service_role` itself. Supabase's own default
per-role ACL had already granted `service_role` the full default privilege
set on table creation (the same mechanism migrations 020 and 029 already
found and fixed for FUNCTIONS — CLAUDE.md §6's standing rule extends it to
tables), so the `GRANT SELECT, INSERT, UPDATE ... TO service_role` two
lines below was purely ADDITIVE on top of whatever Supabase had already
given it, never a replacement. Caught live against test-db, S3 of §11a's
own rehearsal:
```sql
SELECT has_table_privilege('service_role', 'public.outbound_sends', 'DELETE'),
       has_table_privilege('service_role', 'public.outbound_sends', 'TRUNCATE'),
       has_table_privilege('service_role', 'public.outbound_sends', 'REFERENCES'),
       has_table_privilege('service_role', 'public.outbound_sends', 'TRIGGER');
```
```
 delete_priv | truncate_priv | references_priv | trigger_priv
-------------+---------------+------------------+---------------
 true        | true          | true             | true
```
All four `true` — directly contradicting the migration's own "No DELETE
granted to anyone" comment, before this fix. Not caught by §8's disposable
dry-run scaffold, because a hand-stubbed local Postgres has no Supabase
default ACLs to reproduce this against — this is exactly the class of
defect §7's own dry-run-discipline entry (`CLAUDE.md`, EVERY NEW MIGRATION
GETS A DISPOSABLE DRY-RUN) names as a limit of that check, not a gap in
following it. **Fixed** by adding `service_role` to the REVOKE list, both
in the migration file and directly against the already-applied test-db
table, then re-probed clean:
```
 delete_priv | truncate_priv | references_priv | trigger_priv | service_role_select
-------------+---------------+------------------+---------------+---------------------
 false       | false         | false            | false        | true
```
Third instance of this project's own "default ACLs grant individually, a
bare REVOKE FROM PUBLIC (or, this time, an incomplete REVOKE list) is not
enough" finding — 020 (functions, caught by code review), 029 (functions,
caught by a post-apply PRODUCTION fingerprint — a live exposure), this one
(a table, caught by this migration's own pre-production dry-run/rehearsal
probe, before any real apply). Same class, progressively earlier catch
each time — the standing rule this finding reinforces (proactive anon/
grant probing as a required line in every future `SECURITY DEFINER`/new-
object review) is doing its job.

Behavioral proof, both the disposable scaffold (§8, T8-T10) and real
test-db (§11a, C10-C13): `anon` SELECT → `permission denied for table
outbound_sends`. `authenticated` INSERT → `permission denied for table
outbound_sends`. `service_role` DELETE → `permission denied for table
outbound_sends` (the exact probe that would have caught the grant bug
directly, run in-context this round). `service_role` SELECT/INSERT/UPDATE
→ succeed. No DELETE granted to any role — this table is a durable send
record, not a queue to be pruned.

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

## 11. PENDING — what still cannot exist yet, and what it will contain when it can

**No first-real-send observation.** §10's S5 has no analog to 030/033's
own "first real production observation" step, because nothing calls this
table yet — the send primitive (plan items B/D/F) is still unbuilt. **When
it can be produced:** the send primitive's own apply runbook, once items
B-F exist and `vercel.json`'s two cron entries are eventually added (still
withheld per Aravind's own pacing, unrelated to this migration's own
review).

**CI, not yet observed this round.** This round moved the file into
`supabase/migrations/` (§11a) and applied it directly via `supabase db
query --linked -f`, ahead of push — CI has not run against this exact
commit yet. **When it can be produced:** the push at the end of this
round; expect CI's migration-lint/test-db suite to exercise 031 the same
shape as migration 033's own PR #111. Per the standing rule ("a green CI
check certifies a SHA, not a branch"), confirm the passing run's `headSha`
matches this PR's HEAD before ever merging.

## 11a. Test-db rehearsal — EXECUTED this round (round 4), superseding §11's prior framing

**Correction, recorded first (reviewer's own, verbatim in spirit).** The
prior version of this package framed the missing rehearsal as "nothing
calls it yet," treating rehearsal-possibility as blocked on the send
primitive's existence. That conflated two different things: a
schema-level rehearsal — constraints, indexes, grants, RLS, and
raw-SQL-simulated claim/status-transition queries — exercises the SCHEMA,
not the caller, and is runnable against a real database today, with no
TypeScript code required. Migration 029 was applied "inert" against
production on exactly this basis. Only the TRUE end-to-end artifact — a
real send through the actual application code path — waits on the send
primitive; that piece remains genuinely PENDING (§11 above). This section
is the schema-level rehearsal, run for real, not the end-to-end one.

**F0 — file relocated for apply, per the migration-file-lifecycle rule.**
```
git mv docs/reviews/031_outbound_send_ledger.sql supabase/migrations/031_outbound_send_ledger.sql
```
Executed at the start of this round, immediately before the real apply —
matching the standing rule that a migration file enters
`supabase/migrations/` only when it is being applied, not when it is
written.

**F1 — apply (write), against test-db (`exfccwlrhoutkgrlikod`, breadcrumb
confirmed before this and every subsequent step in this section).**
```
supabase db query --linked -f supabase/migrations/031_outbound_send_ledger.sql
```
Clean, no errors — the full `BEGIN; CREATE TABLE; CREATE INDEX; CREATE
INDEX; ALTER TABLE ... ENABLE ROW LEVEL SECURITY; REVOKE; GRANT; COMMIT;`
body committed atomically.

**F2 — post-apply structural + FK probes.** Table present
(`'public.outbound_sends'::regclass` resolves), 4 indexes (PK, the UNIQUE
constraint's own index, `idx_outbound_sends_event_key`,
`idx_outbound_sends_stuck`), 8 constraints, 3 of them FKs — all three
`confdeltype = 'r'` (RESTRICT), matching §4a's dry-run proof exactly (full
probe and output already quoted there, not repeated here).

**F3 — the grant bug, found and fixed live.** §7 above has the full
account (the missing `service_role` in the REVOKE list, the `has_table_
privilege` probe that caught it, the fix applied both to the migration
file and directly against the already-applied test-db table, and the
clean re-probe). Not repeated here in full; this is where in the sequence
it happened — between F2 and the claim-path exercises below, before any
of C1-C13 ran, so every claim-path exercise from here on ran against the
CORRECTED grants.

**Claim-path exercises, C0-C13, each its own `supabase db query --linked
-f` call (per this round's own confirmed limitation: `supabase db query
-f` does not support psql meta-commands `\set`/`\echo`, so a single
combined file with per-case labels fails outright — one plain-SQL
statement-set per file, run separately, is the only working shape).**
Fixture tenants/projects/engineers seeded with a `ZZ 031 Rehearsal`-
prefixed, fixed-UUID naming scheme (`00000000-0000-4000-a000-00000000
31{a,b}{1,2,3}`) for easy identification and cleanup.

- **C0 — seed fixtures.** Two tenants, two projects, two engineer users
  (tenant A: `...31a1`/`...31a2`/`...31a3`, `+19995550311`; tenant B:
  `...31b1`/`...31b2`/`...31b3`, `+19995550312`). Clean insert, no errors.
- **C1 — well-formed claim INSERT (tenant A).** Clean insert, no errors.
- **C2 — duplicate claim, identical `(tenant_id, recipient_user_id,
  event_key)`.**
  ```
  ERROR:  23505: duplicate key value violates unique constraint
  "outbound_sends_tenant_id_recipient_user_id_event_key_key"
  DETAIL:  Key (tenant_id, recipient_user_id, event_key)=
  (00000000-0000-4000-a000-0000000031a1, 00000000-0000-4000-a000-0000000031a3,
  morning_send:2026-08-26) already exists.
  ```
  The idempotency gate itself, exercised against a real duplicate cron-retry
  shape.
- **C3 — cross-tenant `recipient_user_id`** (tenant A's claim, tenant B's
  engineer).
  ```
  ERROR:  23503: insert or update on table "outbound_sends" violates foreign
  key constraint "outbound_sends_recipient_user_id_tenant_id_fkey"
  DETAIL:  Key (recipient_user_id, tenant_id)=
  (00000000-0000-4000-a000-0000000031b3, 00000000-0000-4000-a000-0000000031a1)
  is not present in table "users".
  ```
  B1's own fix, exercised as a real cross-tenant write attempt, not just a
  catalog read.
- **C4 — cross-tenant `project_id`** (tenant A's claim, tenant B's project).
  ```
  ERROR:  23503: insert or update on table "outbound_sends" violates foreign
  key constraint "outbound_sends_project_id_tenant_id_fkey"
  DETAIL:  Key (project_id, tenant_id)=
  (00000000-0000-4000-a000-0000000031b2, 00000000-0000-4000-a000-0000000031a1)
  is not present in table "projects".
  ```
  The second half of B1's fix, both composite FKs now behaviorally proven,
  matching the reviewer's own explicit instruction to exercise both.
- **C5 — status transition, `'sending' → 'sent'`** on C1's row (plus
  `twilio_sid`). Clean update, no errors.
- **C6 — item F's coverage query** (`status = 'sent'` only, not a bare row
  count — see §5's own fix (a)). `sent_count: 1`. Correct — C2/C3/C4 never
  produced a row, C1/C5 together produced exactly one `'sent'` row.
- **C7 — seed a genuinely stuck row** (tenant B's engineer,
  `evening_send:2026-08-26`, `updated_at` backdated 20 minutes). Clean
  insert.
- **C8 — seed a fresh, still-in-flight row** (tenant B's engineer, a
  DIFFERENT checkpoint — `morning_nudge:2026-08-26` — `updated_at`
  backdated only 30 seconds). Clean insert. Deliberately a different
  `event_key` from C7 so C9's scan has two live `'sending'` rows to
  discriminate between, not one.
- **C9 — the stuck-scan itself**, `EXPLAIN` then the real query.
  ```
  Index Scan using idx_outbound_sends_stuck on outbound_sends
    Index Cond: (updated_at < (now() - '00:10:00'::interval))
  ```
  Partial index used, as designed (§8's disposable-scaffold plan predicted
  this; test-db confirms it against the real query planner). Result:
  exactly the C7 row —
  ```
  content_sid: HXbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  event_key:   evening_send:2026-08-26
  tenant_id:   00000000-0000-4000-a000-0000000031b1
  to_phone_number: +19995550312
  ```
  C8's 30-second-old row correctly excluded — the scan discriminates by
  age, not just status, exactly as STUCK-CLAIM RECONCILIATION's design
  requires.
- **C10 — `anon` SELECT, expect denied.**
  ```
  ERROR:  42501: permission denied for table outbound_sends
  HINT:  Grant the required privileges to the current role with:
  GRANT SELECT ON public.outbound_sends TO anon;
  ```
- **C11 — `authenticated` INSERT, expect denied.**
  ```
  ERROR:  42501: permission denied for table outbound_sends
  HINT:  Grant the required privileges to the current role with:
  GRANT INSERT ON public.outbound_sends TO authenticated;
  ```
- **C12 — `service_role` DELETE, expect denied — the exact probe that
  would have caught F3's grant bug directly, in-context, without needing
  the separate `has_table_privilege` catalog probe.**
  ```
  ERROR:  42501: permission denied for table outbound_sends
  HINT:  Grant the required privileges to the current role with:
  GRANT DELETE ON public.outbound_sends TO service_role;
  ```
  Attempted against C7's row specifically; the row survived (confirmed by
  C13 below), proving the denial was real, not a no-op on an
  already-absent row.
- **C13 — final row count.** `total_rows: 3` — C1/C5's now-`'sent'` row,
  C7's stuck row, C8's fresh row. C11's rejected INSERT and C12's rejected
  DELETE both correctly contributed zero net change.

**Rollback — executed against test-db for real, not asserted (per
CLAUDE.md §0's own "verified by observation" standard).**

R1 (pre-drop): `table_present: outbound_sends`, `index_count: 4`,
`constraint_count: 8`.

R2 (write): `DROP TABLE outbound_sends;` — clean.

R2a (confirmed gone, two independent ways): `SELECT count(*) FROM pg_class
WHERE relname = 'outbound_sends'` → `0`. `SELECT
'public.outbound_sends'::regclass` →
```
ERROR:  42P01: relation "public.outbound_sends" does not exist
```
The regclass-cast failure is the stronger of the two — the catalog lookup
itself fails, before any row scan is even attempted.

R3 (re-apply): the full, grant-bug-fixed migration file, re-run in full —
clean, no errors.

R3a (confirmed fully restored): `table_present: outbound_sends`,
`index_count: 4` (matches R1), `row_count: 0` (correct — a fresh table,
not a restore of the dropped rows, which were disposable), `fk_count: 3`,
`fk_delete_actions: outbound_sends_project_id_tenant_id_fkey:r,
outbound_sends_recipient_user_id_tenant_id_fkey:r,
outbound_sends_tenant_id_fkey:r` (all RESTRICT, matching §4a), `rls_
enabled: true`, `service_role_delete: false` (the F3 fix survived the
drop/re-apply cycle), `service_role_select: true`, `anon_select: false`,
`authenticated_insert: false`.

**Left applied, per explicit instruction — "it is shipping."** No further
drop after R3.

**Ledgered.**
```
supabase migration repair --status applied 031 --linked
→ {"versions":["031"],"status":"applied","repairAll":false,
   "message":"Migration history repaired"}
```
Confirmed via `supabase migration list --linked`: local/remote now agree
through `001-033` with no gaps, `031` present on both sides.

**Fixture cleanup.** All `ZZ 031 Rehearsal`-prefixed tenants/projects/
users, plus every `outbound_sends` row this rehearsal produced (C1-C9's
rows, since R3's re-apply already cleared everything from before R2's
drop), deleted — children before parents (`outbound_sends` → `users`/
`projects` → `tenants`), respecting the RESTRICT FKs this same rehearsal
just proved. Final state, verified: all four counts (`tenants`,
`projects`, `users`, `outbound_sends`) at `0`. Test-db is left with 031
applied, ledgered, structurally and behaviorally proven, and empty — the
correct state to hand to CI and, eventually, a prod apply.
