# Supabase support — bug report draft (fresh-branch replay drops a cross-schema-FK column)

> DRAFT for the user to file with Supabase support. Not yet submitted.
> Fill in the project ref / branch ids and paste the literal terminal frames where noted.

## Summary
On a freshly-provisioned Supabase branch, a migration that `ADD COLUMN IF NOT EXISTS`
with a **foreign key into the `auth` schema** is recorded as **applied** in
`supabase_migrations.schema_migrations`, but the column is **never created**. The
`IF NOT EXISTS` clause degrades the replay failure to a NOTICE, so the migration
"succeeds" while its schema effect is silently lost. This makes fresh branches an
unfaithful clone of prod for any project whose migration history includes a
cross-schema FK added this way.

## Environment
- Project ref (parent): `jvxwqignooseazzmwhvl` (prod) / `exfccwlrhoutkgrlikod` (test-db)
- Fresh branch(es) exhibiting the bug: `xonkuhnguknfmliimdop` and one other
  (both reproduced independently)
- Migration involved: `007` — `ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID REFERENCES auth.users(id) ...`

## Steps to reproduce
1. Have a migration that adds a column with an FK to `auth.users`, using
   `ADD COLUMN IF NOT EXISTS`.
2. Provision a fresh branch (which replays the migration history linearly).
3. Query the ledger and the schema:

```sql
-- ledger says the migration ran:
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '007';
-- -> returns 007

-- but the column it adds is absent:
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users' AND column_name='auth_id';
-- -> 0 rows
```

**[PASTE the literal terminal capture of both queries from the fresh branch here.]**

## Expected
Either the branch replay creates `users.auth_id` (as a standard linear `psql`
replay does), OR the migration is recorded as **failed** so the drift is visible —
not recorded as applied while the column is missing.

## Actual
Migration recorded as applied; column missing; no error surfaced (NOTICE only,
because of `IF NOT EXISTS`). Downstream code / tests that assume the column exists
fail on the branch with `column users.auth_id does not exist`.

## Impact
Fresh branches cannot be trusted as prod clones for migration rehearsals when the
history contains a cross-schema FK column added via `IF NOT EXISTS`. We have had to
work around this by rehearsing on a torn-down-and-reused schema-complete database
instead of fresh branches.

## Question for Supabase
1. Is cross-schema FK resolution to `auth.users` expected to fail during fresh-branch
   replay? If so, why is the statement not surfaced as an error given the recorded
   "applied" status?
2. Recommended pattern for adding an `auth.users` FK so it survives fresh-branch
   replay (e.g. defer the FK, or a specific ordering)?
