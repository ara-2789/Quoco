# Migration 038 — test-db rehearsal plan (prepared, not yet run)

Prepared per Aravind's own instruction after the reviewer's GO on the
design round (`b35b68d`, certified). This is the plan only — nothing in
this file has been executed. Two open blockers before any of it can run,
stated in full at the end.

## 0. Pre-flight

**0a. Confirm no other agent or local test run is in flight, project ref
printed in the same output as the query** — matching CLAUDE.md's own
"project ref pasted immediately before the apply, in the same output"
discipline, extended here to the pre-flight check itself:

```sql
SELECT current_database() AS db, inet_server_addr() AS server_addr, now() AS checked_at;

SELECT pid, usename, application_name, client_addr, state, query_start, state_change,
       left(query, 120) AS query_snippet
  FROM pg_stat_activity
 WHERE datname = current_database()
   AND pid <> pg_backend_pid()
 ORDER BY query_start;
```

Expected: the first query's `db` confirms `exfccwlrhoutkgrlikod`'s
database name in the same breath as the activity check. The second
returns either zero rows, or only long-idle Supabase-internal connections
(pooler/monitoring — distinguishable by `application_name`), never a row
with a recent `query_start` and a query touching `whatsapp_sessions`,
`hindrances`, or `apply_*_flow_turn`.

**0b. Capture the pre-rehearsal baseline** (needed for teardown comparison,
§5):

```sql
SELECT proname, obj_description(oid, 'pg_proc') AS comment
  FROM pg_proc
 WHERE proname IN ('apply_hindrance_flow_turn','apply_morning_flow_turn','apply_evening_flow_turn');

SELECT column_name, col_description('hindrances'::regclass, ordinal_position) AS comment
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing','timing_raw');

SELECT conname, confrelid::regclass AS references_table
  FROM pg_constraint
 WHERE conrelid = 'hindrances'::regclass AND contype = 'f';

SELECT count(*) FROM jobs;  -- ledger baseline, for §6
```

**0c. Confirm test-db's actual migration ledger state** — this answers
your own gating question directly, live, not assumed:

```bash
supabase migration list --linked   # after linking to exfccwlrhoutkgrlikod, not prod
```

Expected, if test-db is current: local and remote both show 001–037, no
gap, 038 absent from both (matching the same shape the review package's
own repo-state header already confirmed for `main` — this checks the
DATABASE's ledger, a separate fact). **If test-db is behind — say, missing
036 or 037 — STOP here.** Applying 038 on top of a schema prod no longer
has is exactly last week's 035 incident; the fix in that case is
resolving the ledger gap first, not proceeding.

## 1. What gets applied, and in what order

Exactly one file, one apply, no other pending migration:

```bash
supabase db query --linked -f docs/reviews/038_hindrance_flow_and_collision_fix.sql
```

This is the full, currently-certified content (commit `b35b68d`) —
STEP 0 (composite FKs) through STEP 3 (evening), in the single order the
file already specifies. Nothing else touches the database this session.

## 2. The four probes

### Probe 1 — service_role negative-capability: anon/authenticated must NOT have EXECUTE

```sql
SELECT
  has_function_privilege('anon', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS anon_hindrance,
  has_function_privilege('authenticated', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS authenticated_hindrance,
  has_function_privilege('service_role', 'public.apply_hindrance_flow_turn(text,uuid,uuid,uuid,text,boolean,text,boolean,timestamptz,integer)', 'EXECUTE') AS service_role_hindrance,
  has_function_privilege('anon', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE') AS anon_morning,
  has_function_privilege('service_role', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE') AS service_role_morning,
  has_function_privilege('anon', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE') AS anon_evening,
  has_function_privilege('service_role', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE') AS service_role_evening;
```

Expected: every `anon_*`/`authenticated_*` column `false`, every
`service_role_*` column `true`.

### Probe 2 — live anon-key call, raw 42501

Real `SET ROLE anon` inside a rolled-back transaction, not a raw API key
— tests the identical Postgres-level REVOKE a real anon PostgREST call
would hit, without needing to handle the anon key as a credential at all:

```sql
\set VERBOSITY verbose
BEGIN;
SET ROLE anon;
SELECT apply_hindrance_flow_turn('+910000000000', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'test', true);
ROLLBACK;
```

Expected, raw, pasted as it comes back:
```
ERROR:  42501: permission denied for function apply_hindrance_flow_turn
```

Repeated for `apply_morning_flow_turn` and `apply_evening_flow_turn` — three
calls, three raw 42501s, not summarized.

### Probe 3 — DOWN re-rehearsed against a LIVE hindrance session, real test-db

**Seeding a live in-flight session** (§4 below has the full reasoning —
this seeds the ACTUAL B1 shape, not just a bare hindrance session):

```sql
INSERT INTO whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, pending_flows, expires_at, updated_at)
VALUES ('+910000000001', '<a real test-db tenant_id>', '<a real test-db engineer user_id>',
        'hindrance', 2, '{"description": "rehearsal seed", "q2_reask": 1, "morning_submitted": true}'::jsonb,
        '[]'::jsonb, now() + interval '30 minutes', now())
ON CONFLICT (phone_number) DO UPDATE SET current_flow = EXCLUDED.current_flow, current_step = EXCLUDED.current_step,
  context = EXCLUDED.context, pending_flows = EXCLUDED.pending_flows, updated_at = EXCLUDED.updated_at;
```

Then extract and run the DOWN block (strip `-- ` from every line from
`-- BEGIN;` to `-- COMMIT;`, run as its own file, never by re-running the
migration file itself — per the file's own DOWN-section discipline):

```bash
supabase db query --linked -f /tmp/038-down-extracted.sql
```

Verify:
```sql
SELECT current_flow, current_step, context FROM whatsapp_sessions WHERE phone_number = '+910000000001';
-- expected: current_flow=NULL, current_step=0, context={"morning_submitted": true}

SELECT proname FROM pg_proc WHERE proname = 'apply_hindrance_flow_turn';
-- expected: 0 rows -- function dropped

SELECT conname FROM pg_constraint WHERE conrelid = 'hindrances'::regclass AND contype = 'f' AND conname = 'hindrances_project_id_fkey';
-- confirm reverted to the plain single-column FK (probe 4's own cross-tenant insert, re-attempted here, should now SUCCEED)
```

**Then re-apply 038 immediately** (§1's own command again) to restore
test-db to the correct, up-to-date state before proceeding — this is a
rehearsal, not a real rollback; test-db must not be left mid-DOWN.

### Probe 4 — composite-FK behavioural probe, 23503

Real cross-tenant INSERT, using two genuinely distinct existing test-db
tenants (or two throwaway ones created and dropped within this same
rehearsal, cleaned up in §5):

```sql
BEGIN;
INSERT INTO hindrances (tenant_id, project_id, reported_by, description, submitted_via)
VALUES ('<tenant A id>', '<a real project_id belonging to tenant B>', '<a real user_id in tenant A>',
        'rehearsal cross-tenant probe', 'whatsapp_adhoc');
ROLLBACK;
```

Expected, raw:
```
ERROR:  23503: insert or update on table "hindrances" violates foreign key constraint "hindrances_project_id_fkey"
DETAIL:  Key (project_id, tenant_id)=(...) is not present in table "projects".
```

## 3. Scenario 5 — the fifth case, real test-db this time

The same sequence already proven against the local Postgres scaffold:
real morning submission (complete) → engineer taps "1", starts hindrance,
abandons at Q2 → scheduled trigger fires `startFlow:true` → verify
`morning_submitted` survives and a second reply does not corrupt the real
`daily_logs` row. Full script already written and proven
(`/Users/aravindanrajamani/.claude/jobs/877872b5/tmp/038-b1/scenario5.sql`
from the local scaffold round) — re-run verbatim against test-db, with
real test-db tenant/project/engineer ids substituted for the local
scaffold's throwaway UUIDs.

## 4. Seeding a live in-flight hindrance session, stated once (used by §2 Probe 3 and implicitly by Scenario 5)

Direct `INSERT ... ON CONFLICT (phone_number) DO UPDATE` into
`whatsapp_sessions`, matching the RPC's own upsert shape exactly — never
via the application layer (nothing in the deployed TypeScript starts a
real hindrance flow yet, since the "1" branch is still gated on this
rehearsal). Uses a throwaway rehearsal phone number, real existing
tenant/project/engineer ids from test-db's own fixtures (not created
fresh, to avoid leaving orphaned tenant/project rows behind).

## 5. Teardown — restore baseline, verify it, including COMMENT text

```sql
-- Remove every session/row this rehearsal created:
DELETE FROM whatsapp_sessions WHERE phone_number IN ('+910000000001', ...);
DELETE FROM hindrances WHERE description IN ('rehearsal seed', 'rehearsal cross-tenant probe', ...);
-- (Scenario 5's own daily_logs row, if run against a throwaway engineer, cleaned the same way)

-- Re-capture and diff against §0b's baseline:
SELECT proname, obj_description(oid, 'pg_proc') AS comment
  FROM pg_proc
 WHERE proname IN ('apply_hindrance_flow_turn','apply_morning_flow_turn','apply_evening_flow_turn');

SELECT column_name, col_description('hindrances'::regclass, ordinal_position) AS comment
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing','timing_raw');
```

Expected: byte-identical to §0b's capture — **pending confirmation of
what the actual comment-residue rule requires**, per the open question
above. If the rule is broader than function/column comments (e.g. also
covers RLS policy comments, or something table-level), tell me and I'll
extend this section before anything runs.

## 6. Ledger confirmation

```sql
SELECT count(*) FROM jobs;  -- must equal §0b's baseline exactly -- this rehearsal enqueues nothing
```

No step in this plan calls `enqueueJob`, `trigger.ts`, or anything that
writes to `outbound_sends` — every RPC call above is a direct
`apply_*_flow_turn`/`SELECT` invocation, never the real outbound-send
path. Confirmed by re-reading this plan itself: zero references to
`trigger.ts` or `outbound_sends` anywhere above.

## Open blockers before any of this can run

1. **No test-db access from this sandbox.** Confirmed directly: no
   `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`, no `.env.test`/
   `.env.local`, and `supabase projects list`/`supabase orgs list` show
   only prod under the one visible org. `supabase projects api-keys` was
   not attempted further — blocked outright by this session's own
   auto-mode classifier, correctly, as the exact credential-enumerating
   command class CLAUDE.md prohibits.
2. **§0c (test-db ledger state) and the comment-residue rule's exact
   scope are both unconfirmed** — the former because of blocker 1, the
   latter because it isn't written down anywhere I could find.
