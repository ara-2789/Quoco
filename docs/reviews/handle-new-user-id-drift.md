# `handle_new_user()`'s live body has drifted from every migration file that documents it — untracked, on the auth/identity path (opened 2026-09-08)

**Status: OPEN, not fixed here.** Found incidentally while rehearsing
migration 039 (DASH-07 Phase 2, `docs/reviews/039_hindrance_acknowledgement.sql`),
unrelated to that migration's own subject matter. Filed separately per
Aravind's explicit instruction — this is an auth/identity-subsystem finding
and does not get folded into DASH-07's own tracking.

## The finding

`public.handle_new_user()` is the `AFTER INSERT ON auth.users` trigger
function that provisions a `public.users` row for every new Supabase Auth
signup (migration 005, redefined by migration 007's "auth surgery"). Two
migration files document its body:

- **005** (`005_auth_trigger.sql`): `INSERT INTO public.users (id) VALUES (NEW.id)`.
- **007** (`007_auth_surgery.sql`): `INSERT INTO public.users (id, auth_id) VALUES (NEW.id, NEW.id)`
  — both `id` and the new `auth_id` column set to the auth user's own id.

Checked live against test-db (`exfccwlrhoutkgrlikod`), 2026-09-08, via
`pg_get_functiondef('public.handle_new_user()'::regprocedure)` — not assumed
from either file's text:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (id, auth_id)
  VALUES (gen_random_uuid(), NEW.id);
  RETURN NEW;
END;
$function$
```

**`id` is a FRESH random uuid, not `NEW.id`.** Only `auth_id` still equals
`NEW.id`. This is a real, live difference from 007's own documented body —
not a formatting/whitespace difference, a different VALUES expression
entirely.

## Neither migration that touches this function changed its body

Two migration files mention `handle_new_user` after 007: **015**
(`015_users_update_column_grant.sql`) and **020**
(`020_function_execute_hardening.sql`). Checked both directly, not assumed:

- **015** only discusses it in prose (its own blast-radius audit, "handle_new_user()
  trigger INSERTs (not UPDATE) and is DEFINER-owned") — no `CREATE OR REPLACE
  FUNCTION` for it anywhere in the file.
- **020** only touches its GRANT/REVOKE (`REVOKE EXECUTE ... FROM PUBLIC, anon,
  authenticated; GRANT EXECUTE ... TO supabase_auth_admin`) — and its own header
  explicitly lists `get_user_tenant_id / handle_new_user — 007` as the version
  of record it verified for its orphan-overload audit, meaning **020 itself
  believed the live body still matched 007's** at the time it ran. No
  `CREATE OR REPLACE FUNCTION public.handle_new_user` appears in this file
  either.

**Conclusion: no migration file in this repository ever changed this
function's body away from 007's version.** The live function was altered
out-of-band — the same failure shape `docs/build-status.md`'s own
"OUT-OF-BAND DB OBJECTS" registry exists to catalogue (that registry
currently lists `rls_auto_enable()` and the `jobs`/`processed_messages`
RLS-enabled state, added there when each was found; this is a new entry of
the same kind, for a function BODY rather than a whole undocumented object).

## Why this matters more than an ordinary drift

This is the `AFTER INSERT ON auth.users` trigger — the one function that
runs, unconditionally, SECURITY DEFINER, for every single account signup on
this product. Three concrete consequences of the repo's account of it being
wrong:

1. **Anyone reading 007 to understand how `users.id` relates to a signup is
   reading something false about the live system.** 007's own header
   ("Adds a nullable users.auth_id... policies that referenced auth.uid()
   against users.id onto auth_id") documents an identity model where a
   fresh signup's `users.id` and `auth_id` start equal, diverging only
   later (re-links, engineer provisioning). Live behavior never lets them
   start equal for a NEW signup.
2. **A rehearsal or test fixture built by reading 007's migration text
   instead of the live function will get the wrong id relationship and
   produce a confusing failure with no obvious cause** — this is exactly
   what happened building migration 039's own rehearsal fixtures: a
   `project_members_user_id_fkey` violation that made no sense until the
   live function definition was queried directly (`039_hindrance_
   acknowledgement.sql`'s own header carries the blow-by-blow).
3. **Nothing currently tests or asserts this trigger's actual insert
   shape.** Grepped: no test file asserts `handle_new_user`'s output
   columns/values directly — every existing test that depends on a real
   signup's `users` row either provisions engineers manually (auth_id=NULL,
   bypassing this trigger entirely) or signs up via `jwtClient` and reads
   back whatever the trigger happened to produce, without asserting the
   `id`/`auth_id` relationship specifically.

## What is NOT yet known

- **When** the drift happened, and **who/what** made it (dashboard SQL
  editor, a `supabase db query` one-off, or something else) — not
  investigated here, no audit log checked.
- **Whether prod matches test-db.** This was checked on test-db only
  (`exfccwlrhoutkgrlikod`); prod (`jvxwqignooseazzmwhvl`) has not been
  queried. Given both are expected to be schema-identical post-016 (per
  CLAUDE.md §6), an out-of-band edit to one does NOT imply the other also
  received it — this needs its own live check before assuming either way.
- **Whether any application code or RLS policy currently depends on the
  OLD (007-documented) `id = auth_id` relationship for a fresh signup** and
  would misbehave under the actual (`id` random, `auth_id = NEW.id`)
  behavior. Not audited here — flagged as the next step, not resolved.

## Suggested next step (not started)

1. Query the live function definition on **prod** the same way this was
   checked on test-db, to confirm whether the drift is test-db-only or
   both.
2. Grep application code for any place that assumes a fresh signup's
   `users.id` equals its `auth_id` (as opposed to correctly deriving one
   from the other via a lookup) — the ENG-01/onboarding path is the most
   likely place such an assumption could hide.
3. Once the current live behavior is confirmed intentional (or decided to
   be reverted), land it as a REAL migration with a `CREATE OR REPLACE
   FUNCTION public.handle_new_user()` and its own header explaining the
   `id`-is-random design — closing the out-of-band gap per this project's
   own "bring it under version control the next time it's touched" rule
   (`docs/build-status.md`'s OUT-OF-BAND DB OBJECTS registry).
