# Migration 020 — function EXECUTE hardening — review package

Pinned rehearsal evidence for **PR #15** (`feat/020-function-execute-hardening`).
Artifacts follow the 017-review-package pattern: each probe shows its query text
directly above its raw result; the suite runs are pinned to a commit SHA.

- Migration: `supabase/migrations/020_function_execute_hardening.sql`
- Tests: `test/migration-020.test.ts`
- What/why + the two function classes + the three landmines: see the PR body.

## Provenance / pinning

- **Commit reviewed:** `115d14efd635eee8b46683d554260d0140686cc9`
- **`git status --porcelain` at that SHA:**
  ```
  A  supabase/migrations/019_daily_log_corrections.sql
  ```
  **Documented exception (NOT an empty tree):** the single working-tree delta is
  the *staged* 019 migration file — a local aid so `supabase migration list`
  reconciles (test-db already had 019 applied earlier). It is a migration SQL
  file, not code the suite loads, so it is **inert for the 020 test run**, and the
  020 artifacts at `115d14e` are exactly as committed. Per CLAUDE.md §0 we pin the
  real porcelain + this explanation rather than chase an artificially clean tree —
  transparency is the thing the rule protects.

## Environment matrix (what is pinned where)

`rls_auto_enable` is an **out-of-band, prod-only** object (absent on test-db), so
the evidence spans two environments:

| Evidence | Env | Covers |
|---|---|---|
| §1a prove-open | **PROD** | `rls_auto_enable` pre-state |
| §1b prove-open | **test-db** | the other 7 functions pre-state |
| §3a prove-closed | **test-db** | the 6 hardened functions post-apply (`rls_auto_enable` absent — expected) |
| §4a/§4b tests | **test-db** | ACL behaviour before/after apply |

`rls_auto_enable`'s **prove-closed is the PROD `proacl`, taken at the prod-apply
step** (gated before PR #14/019) — it cannot appear in the test-db post-state.

> ⚠️ **TRUNCATION CAVEAT (raised by the maintainer).** The `proacl` / signature
> strings in §1b and §3a were **column-truncated in the console export** (e.g.
> `…boole…`, `…supabase_auth_admin=X/po…`). The *leading* grantees are intact —
> enough to see PUBLIC (`=X/postgres`) / `anon` / `authenticated` present pre-020
> and **removed** post-020 — but the trailing bytes are cut. For a byte-exact
> sign-off, re-pull untruncated (e.g. psql `\a` unaligned, or
> `SELECT array_to_string(proacl, E'\n')`). Reproduced here verbatim as captured.

---

## 1. Prove-open — pinned PRE-020 state

### 1a. `rls_auto_enable` dedicated `proacl` (PROD)

```sql
SELECT p.oid::regprocedure AS signature, p.prosecdef AS is_definer,
       r.rolname AS owner, p.proacl
FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
WHERE p.proname = 'rls_auto_enable';
```

Result (1 row, PRODUCTION):
```
signature:  rls_auto_enable()
is_definer: true
owner:      postgres
proacl:     {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```
**Reading:** `=X/postgres` is the default **PUBLIC** EXECUTE grant; `anon` and
`authenticated` also hold `X`. Broad grant confirmed — the hole.

### 1b. Batch `proacl` across all 8 functions (test-db)

```sql
SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proacl
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('acquire_and_transition_session','apply_morning_flow_turn',
    'drain_next_pending_flow','complete_onboarding','get_user_tenant_id',
    'handle_new_user','rls_auto_enable','quoco_same_ist_day')
ORDER BY p.proname;
```

Result (7 rows — `rls_auto_enable` absent on test-db):
```
acquire_and_transition_session(text,uuid,uuid,text,text,timestamp with time zone,integer) | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boole...)                   | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
complete_onboarding(text,text,text)                                                        | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
drain_next_pending_flow(text,timestamp with time zone)                                     | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
get_user_tenant_id()                                                                       | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
handle_new_user()                                                                          | true  | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
quoco_same_ist_day(timestamp with time zone,timestamp with time zone)                      | false | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```
**Reading:** every function carries PUBLIC+anon+authenticated `X` pre-020.
`quoco_same_ist_day` is `is_definer=false` (a pure helper — deliberately not
hardened by 020). The three parameter-trusting fns being anon-callable here is
the exploitable surface.

---

## 2. `rls_auto_enable` classification evidence (PROD)

### 2a. Event-trigger + regular-trigger check

```sql
SELECT evtname, evtevent, evtfoid::regprocedure
FROM pg_event_trigger WHERE evtfoid = 'rls_auto_enable'::regproc;

SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgfoid = 'rls_auto_enable'::regproc;
```

Result:
```
-- event trigger: 1 row
evtname: ensure_rls | evtevent: ddl_command_end | evtfoid: rls_auto_enable()

-- regular trigger: 0 rows  ("Success. No rows returned")
```

### 2b. `pg_get_functiondef('rls_auto_enable')`

```sql
SELECT pg_get_functiondef('rls_auto_enable'::regproc);
```

Result:
```sql
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$
```
**Reading:** it `RETURNS event_trigger`, is fired by the `ensure_rls`
`ddl_command_end` trigger (2a), has no regular-trigger caller (2a), and its body
only auto-enables RLS on new `public` tables via DDL. Fired as owner=postgres,
**never caller-invoked** → row 1 of the classification tree (same shape as
`handle_new_user`): strip all caller grants, no re-grant.

---

## 3. Prove-closed — pinned POST-020 state (test-db)

Same batch query as §1b, re-run after `supabase db push` of 020:
```
acquire_and_transition_session(text,uuid,uuid,text,text,timestamp wi...  | true  | {postgres=X/postgres,service_role=X/postgres}
apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boole...  | true  | {postgres=X/postgres,service_role=X/postgres}
complete_onboarding(text,text,text)                                      | true  | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgre...}
drain_next_pending_flow(text,timestamp with time zone)                   | true  | {postgres=X/postgres,service_role=X/postgres}
get_user_tenant_id()                                                     | true  | {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgre...}
handle_new_user()                                                        | true  | {postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/po...}
quoco_same_ist_day(timestamp with time zone,timestamp with time zone...  | false | {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/pos...}
```
(7 rows; `rls_auto_enable` still absent from test-db as expected — its ACL change
occurs only on prod apply, verified there by the PROD `proacl`.)

**Reading — each row matches its 020 statement exactly:**

| Function | Post-020 grantees | Matches design? |
|---|---|---|
| `acquire_and_transition_session` | postgres, service_role | ✅ Class 1 (anon/authenticated/PUBLIC stripped) |
| `apply_morning_flow_turn` | postgres, service_role | ✅ Class 1 |
| `drain_next_pending_flow` | postgres, service_role | ✅ Class 1 |
| `complete_onboarding` | postgres, **authenticated**, service_role | ✅ Class 2 (anon/PUBLIC stripped, authenticated retained) |
| `get_user_tenant_id` | postgres, **authenticated**, service_role | ✅ Landmine 1 (authenticated retained — reads survive) |
| `handle_new_user` | postgres, service_role, **supabase_auth_admin** | ✅ Landmine 2 (callers stripped, auth-admin granted) |
| `quoco_same_ist_day` | PUBLIC, anon, authenticated, service_role | ✅ unchanged (out of 020 scope) |

PUBLIC (`=X/postgres`) and `anon` are gone from all six hardened functions;
`service_role` on the retained-grant rows was an explicit pre-existing grant 020
did not revoke (harmless — service_role is the elevated key). (Byte-exact tails
subject to the truncation caveat above.)

---

## 4. Test evidence (`test/migration-020.test.ts`, test-db)

### 4a. Prove-open (BEFORE 020 applied) — the door is open

```
❯ test/migration-020.test.ts (9 tests | 6 failed) 11082ms
   × T-020-01: anon → apply_morning_flow_turn is denied at the ACL (42501) — expected '23503' to be '42501'
   × T-020-02: anon → acquire_and_transition_session is denied (42501) — expected '23503' to be '42501'
   × T-020-03: anon → drain_next_pending_flow is denied (42501) — expected undefined to be '42501'
   × T-020-04: authenticated → all three parameter-trusting fns are denied — apply_morning_flow_turn expected '23503' to be '42501'
   ✓ T-020-05: CANARY — service_role still passes the ACL (fails deeper, not 42501)
   × T-020-06: anon → complete_onboarding is denied (42501) — expected 'P0002' to be '42501'
   ✓ T-020-07: LANDMINE 1 — an authenticated tenant-scoped read still returns rows
   × T-020-08: LANDMINE 1 — anon get_user_tenant_id denied; authenticated retained — expected undefined to be '42501'
   ✓ T-020-09: LANDMINE 2 — handle_new_user still fires (auth-user insert materialises the stub)

 Test Files  1 failed (1)
      Tests  6 failed | 3 passed (9)
```
**Reading:** the 6 "failures" are the proof — each anon/authenticated ACL check
got **past** the ACL and failed *deeper in the body* (`23503` FK on the dummy
tenant), *succeeded with no error* (`undefined` — the call ran), or hit the
function's own guard (`P0002`) — i.e. **not** `42501`. The door was open. The 3
passes (canary, landmine reads, trigger) are expected green in both states.

### 4b. Prove-closed (AFTER 020 applied) — the door is shut

```
✓ test/migration-020.test.ts (9 tests) 12428ms
   ✓ T-020-01: anon → apply_morning_flow_turn is denied at the ACL (42501)  307ms
   ✓ T-020-02: anon → acquire_and_transition_session is denied (42501)  305ms
   ✓ T-020-03: anon → drain_next_pending_flow is denied (42501)  307ms
   ✓ T-020-04: authenticated → all three parameter-trusting fns are denied (server-only)  947ms
   ✓ T-020-05: CANARY — service_role still passes the ACL (fails deeper, not 42501) 232ms
   ✓ T-020-06: anon → complete_onboarding is denied (42501) 228ms
   ✓ T-020-07: LANDMINE 1 — an authenticated tenant-scoped read still returns rows  331ms
   ✓ T-020-08: LANDMINE 1 — anon get_user_tenant_id denied; authenticated retained  614ms
   ✓ T-020-09: LANDMINE 2 — handle_new_user still fires (auth-user insert materialises the stub)  1537ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```
**Reading:** every anon/authenticated ACL check now returns `42501` (rejected at
the privilege layer, before the body); the canary and both landmine checks stay
green. Door shut, no collateral damage.

---

## Outstanding for the PROD apply (gated before PR #14 / 019)

1. Apply 020 to prod (observe the PITR window first, §0).
2. Re-run the §1a query on prod → confirm `rls_auto_enable`'s `proacl` no longer
   carries PUBLIC/anon/authenticated; pin that output here as §1a-closed.
3. Re-run §1b (or the dedicated queries) on prod → confirm the six hardened
   functions closed on prod too; pin.
4. Untruncated re-pull of any `proacl` needed for byte-exact sign-off (caveat above).
