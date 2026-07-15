# Migration 017 — PROD run sheet

> ## ⛔ GATED — DO NOT EXECUTE UNTIL REVIEWER FINAL SIGN-OFF ⛔
>
> This is the production apply procedure for migration 017, staged behind the
> reviewer's final sign-off on the pinned step-1 rehearsal evidence
> (`docs/reviews/017-review-package.md` §10.4). Do not run any write step until
> that sign-off is recorded. Read-only observation (step a) is also gated here so
> the whole sequence stays together. Target: **prod `jvxwqignooseazzmwhvl`**.
>
> Body pinned: `69dac1a`, sha256 `7b06ed81c9f0ca8602c0a694c600593d20b2a04c1bc68e7be2997f168b5255a5`.
> Prod "before" side already pinned (§10.4, 2026-07-15): plain single-col FKs,
> `a/a/a` + `c/c/r`, anon write-grants = 69.

---

## a. PITR observation (CLAUDE.md §0 — verified by OBSERVATION, not a checkbox)

Do this BEFORE any write. The rule (§0): confirm the restore mechanism exists by
directly observing its live state, never by trusting a settings toggle.

1. Supabase dashboard → **Database → Backups → Point in Time**.
2. **Observe** the restore-window UI actually rendering an **active window** — a
   start timestamp through ~now, at the expected 2-minute granularity. (Seeing the
   restore-point slider/range populated is the observation; a "PITR: enabled"
   settings line is NOT.)
3. **Record** verbatim, into the apply record: (i) the window's earliest restore
   point, (ii) the window's latest restore point (~now), (iii) the wall-clock time
   you observed it. These three lines are the pinned PITR evidence.
4. If the window is NOT rendered / not active → **STOP** (no recovery path; do not
   apply).

---

## b. Pre-apply shasum re-verification (guard against a touched staged file)

At execution time, re-hash the body in the staged file and confirm it still matches
the pin (guards against `/tmp/017-pinned-prod-apply.txt` having been edited since
2026-07-15):

```
awk '/^-- supabase\/migrations\/017_rls_column_bounding.sql/{p=1} p' /tmp/017-pinned-prod-apply.txt | shasum -a 256
# EXPECT: 7b06ed81c9f0ca8602c0a694c600593d20b2a04c1bc68e7be2997f168b5255a5
```
If it does NOT match → **STOP**. Regenerate a clean body from git and apply from that
instead:
```
git show 69dac1a:supabase/migrations/017_rls_column_bounding.sql | shasum -a 256   # must print the pin
git show 69dac1a:supabase/migrations/017_rls_column_bounding.sql > /tmp/017-body.sql
```

---

## c. Apply (write)

1. Prod SQL Editor — **confirm the project ref is `jvxwqignooseazzmwhvl`** (not the
   test-db branch).
2. Fresh query tab. Paste the **body only** — from the leading
   `-- supabase/migrations/017_rls_column_bounding.sql` comment through `COMMIT;`
   (the trailing commented `DOWN` block is inert). Source: the hash-verified staged
   file (b) or `git show 69dac1a:…`.
3. **Deselect** (a stray highlight runs "only this"). Run.
4. **Success looks like:** `Success. No rows returned.` (all statements are
   DDL/GRANT/REVOKE, single `BEGIN…COMMIT`). Paste the result into the apply record.
5. **Prod pre-state is pre-017** (verified §10.4), so Step 1 `ADD … UNIQUE` and Step 2
   `DROP CONSTRAINT <plain fk>` will not collide. If Step 1 errors "already exists" or
   Step 2 errors "does not exist" → **STOP** (prod state drifted from the pinned
   before-capture; paste the error).

---

## d. Prod "after" probes A1/A2/B/C/D (read-only) — the "after" side of the pair

Run all five; paste each result. Expected values are identical to the branch
rehearsal (§10.4) and pair against the pinned prod "before" capture.

```sql
-- A1) composite FK definitions
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('projects_owner_user_id_fkey','project_members_user_id_fkey','project_members_project_id_fkey')
ORDER BY conname;
-- EXPECT: (owner_user_id, tenant_id)->users(id,tenant_id) RESTRICT;
--         (user_id, tenant_id)->users(id,tenant_id) CASCADE;
--         (project_id, tenant_id)->projects(id,tenant_id) CASCADE.
--   PAIR: prod "before" was plain single-column (§10.4).

-- A2) UNIQUE parents
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('users_id_tenant_id_key','projects_id_tenant_id_key')
ORDER BY conname;
-- EXPECT: both UNIQUE (id, tenant_id).  PAIR: "before" = absent (0 rows).

-- B) narrowed grants
SELECT string_agg(format('%s | %s', table_name, column_name), E'\n' ORDER BY table_name, column_name) AS granted
FROM information_schema.role_column_grants
WHERE table_schema='public' AND grantee='authenticated' AND privilege_type='UPDATE'
  AND table_name IN ('projects','daily_logs');
-- EXPECT: 29 rows = 17 daily_logs + 12 projects (excluded cols absent).

-- C) anon write-strip
SELECT count(*) AS anon_write_grants
FROM information_schema.table_privileges
WHERE table_schema='public' AND grantee='anon' AND privilege_type IN ('INSERT','UPDATE','DELETE');
-- EXPECT: 0.  PAIR: prod "before" = 69 (this is Step 5's first REAL execution — see anon-gap note).

-- D) FK action semantics
SELECT conname, confupdtype, confdeltype
FROM pg_constraint
WHERE conname IN ('projects_owner_user_id_fkey','project_members_user_id_fkey','project_members_project_id_fkey')
ORDER BY conname;
-- EXPECT: confupdtype='a' all; confdeltype 'r'/'c'/'c' (owner/members/members).
```

---

## e. Close-out (step 6)

**Ledger INSERT (manual — the CLI `migration repair` is 28P01-blocked for this project;
manual INSERT is the real method):**
```sql
-- confirm the pre-insert count first (expected 14 post-018), then insert:
SELECT count(*) FROM supabase_migrations.schema_migrations;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('017', 'rls_column_bounding', ARRAY[]::text[]);
SELECT count(*) FROM supabase_migrations.schema_migrations;   -- EXPECT prior + 1 (15)
```
Paste both counts.

**Type regen (after ledger confirms):**
```
npx supabase gen types typescript --project-id jvxwqignooseazzmwhvl --schema public > types/database.ts
git diff types/database.ts
```
NOTE: column grants do NOT affect generated types, but the three FKs changed
single→composite — the `Relationships` metadata for `projects.owner_user_id`,
`project_members.user_id`, `project_members.project_id` MAY change. Review and commit
whatever the diff produces (do not assume empty). If non-empty, that is expected.

**schema.md 017 entry:** written **only after** the ledger `SELECT count(*)` confirms
the row landed (§0 — no "applied" line asserted before it is true). Fold the applied
SHA (`69dac1a`), sha256, PITR observation timestamps, and the before/after probe pair.

---

## f. STOP rule

Any output deviating from the stated expected value at ANY step → **halt, paste the raw
output back, do not improvise in the SQL Editor.** No ad-hoc `ALTER`/`DROP`/`GRANT` to
"fix forward." A deviation means the pinned pre-state assumption is wrong and the plan
must be re-checked, not patched live.
