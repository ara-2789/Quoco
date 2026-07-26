# Supabase support — bug report draft (fresh branch: migration recorded applied, column absent)

> DRAFT for the user to file with Supabase support. Not yet submitted.
> Fill in the project ref / branch ids and paste the literal terminal frames where noted.

## Summary (observed, reproducible)
On a **freshly-provisioned Supabase branch**, migration `007` is recorded as **applied**
in `supabase_migrations.schema_migrations`, but the column that migration adds —
`public.users.auth_id` — **does not exist** on the branch. A migration recorded as
applied did not leave its schema effect. **Reproduced independently on two separate
fresh branches.** A standard linear `psql` replay of the same migration set DOES create
the column, so this is specific to branch provisioning, not the migration SQL.

**We are not asserting a mechanism** — we're reporting the contradiction and asking you
to diagnose it. (An internal note initially guessed "`ADD COLUMN IF NOT EXISTS` degraded
to a NOTICE"; we retracted that — `IF NOT EXISTS` only skips when the column already
exists, so it cannot explain a column that was never created. The real cause is unknown
to us.)

## Environment
- Parent project ref: `jvxwqignooseazzmwhvl` (prod) / `exfccwlrhoutkgrlikod` (test-db)
- Fresh branch(es) exhibiting it: `xonkuhnguknfmliimdop` and one other (both independent)
- Migration involved: `007` — `ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID REFERENCES auth.users(id) ...`
  (note: cross-schema FK into `auth.users`)

## Steps to reproduce
1. Have a migration history that adds `public.users.auth_id` with an FK to `auth.users`.
2. Provision a fresh branch (which replays the migration history).
3. Query the ledger and the schema:

```sql
-- ledger: is 007 recorded as applied?
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

-- schema: does users.auth_id exist?
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users' AND column_name='auth_id';
```

## Observed results (literal, from branch `xonkuhnguknfmliimdop`)

**Ledger — 007 `auth_surgery` present (applied):**
```json
[
  {"version": "001", "name": "core_schema"},
  {"version": "002", "name": "rls_policies"},
  {"version": "003", "name": "indexes"},
  {"version": "004", "name": "pgvector"},
  {"version": "005", "name": "auth_trigger"},
  {"version": "006", "name": "jobs_queue"},
  {"version": "007", "name": "auth_surgery"},
  {"version": "011", "name": "processed_messages"},
  {"version": "012", "name": "whatsapp_session_transition"},
  {"version": "013", "name": "session_transition_test_lock_probe"},
  {"version": "014", "name": "morning_flow_apply_turn"},
  {"version": "015", "name": "users_update_column_grant"},
  {"version": "016", "name": "corrections"},
  {"version": "017", "name": "rls_column_bounding"},
  {"version": "018", "name": "morning_flow_parsers"}
]
```

**Schema — `users` columns (`auth_id` absent):**
```
id, created_at, tenant_id, full_name, avatar_url, role, whatsapp_number,
hierarchy_level, reporting_manager_id, delegation_active, employee_id,
status, messaging_blocked
```

**[Optional: paste the raw terminal capture of both queries here if you re-run them.]**

## Second anomaly on the same branch (may or may not be related)
Migration `020` (applied on prod and on our test-db) is **absent from the fresh branch's
`schema_migrations` entirely** — the ledger ends at `018`. Flagging it because it's a
second way the fresh branch diverges from the real migration set from the same
provisioning; it may share a cause with the `auth_id` issue or be independent.

## Expected
Either the fresh branch creates `users.auth_id` (as a linear replay does), OR — if a
statement cannot be applied during branch provisioning — the migration is recorded as
**failed / not applied** so the drift is detectable, rather than recorded as applied
while its effect is silently missing.

## Actual
`007` recorded applied; `auth_id` missing; no surfaced error. Downstream code/tests that
assume the column exists then fail on the branch with `column users.auth_id does not
exist`.

## Impact
Fresh branches cannot be trusted as prod clones for migration rehearsals when this
occurs. We have worked around it by rehearsing on a torn-down-and-reused schema-complete
database instead of fresh branches.

## Questions for Supabase
1. Why is `007` recorded as applied on a fresh branch while `users.auth_id` is absent?
   What is the actual failure mode during branch provisioning?
2. Does cross-schema FK resolution to `auth.users` behave differently during fresh-branch
   replay than in a linear `psql` replay? If a statement is skipped/failed, why is the
   migration still marked applied?
3. Why is `020` missing from the fresh branch's ledger entirely?
4. Recommended pattern for adding an `auth.users` FK column so it survives fresh-branch
   provisioning.
