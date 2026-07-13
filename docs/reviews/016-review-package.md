# Migration 016 (corrections) — reviewer package addendum

Branch: `feat/migration-016-corrections` (off `main @ 8a875b8`)
Commits: `236fb0a` (migration + tests), `4997ee3` (this package), `e5b3abe` (Section 1 comment fix)
Files: `supabase/migrations/016_corrections.sql`, `test/migration-016.test.ts`
Status: **applied to the test-db branch and fully verified** — see §6.
Prod apply held pending owner sign-off + external reviewer.

This addendum exists because GitHub has previously served a stale branch cache to
the reviewer (see the 015 package). Everything needed to review 016 is inline here.

---

## 1. What 016 is

The corrections migration **evicted from 007** per checkpoint-1 review §1b: the
trivial column/type fixes and the `client`→`owner` role rename that were pulled
out of the identity-surgery migration so a bug in a rename could never force
rollback pressure on the irreversible auth change. Plus the §11b
`complete_onboarding` zero-row guard. 007 stayed identity-only; 016 carries the
rest it originally bundled.

Single `BEGIN…COMMIT`, fully reversible (no identity surgery). Down-path is at the
foot of the SQL file; the real safety net is observed PITR (enabled +
observation-verified on prod 2026-07-12, 2-min granularity) — capture a restore
point immediately before apply.

### Items (all verified against LIVE schema, none already applied)

| # | Item | Live state (evidence) | Action |
|---|---|---|---|
| 1 | `users.role` `client`→`owner` | `001:43` inline CHECK, `'owner'` absent | drop-constraint → update-data → add `users_role_check` |
| 2 | `tenants.stripe_customer_id`→`payment_customer_id` + `paid_until`, `last_payment_ref` | `001:25` still `stripe_customer_id`; rename never happened | RENAME + 2 ADD |
| 3 | `projects.owner_user_id` | absent | ADD … REFERENCES users(id) ON DELETE RESTRICT |
| 4 | `daily_logs` holiday + JSONB + evening consolidation | `001:110-121` TEXT + two evening cols | ADD is_holiday/holiday_reason; drop `_tomorrow`; rename `_structured`→`evening_dependencies`; morning cols TEXT→JSONB |
| 5 | `invoices.amount` (10,2)→(12,2) | `001:162` = (10,2) | ALTER TYPE |
| 6 | `safety_incidents.submitted_via` CHECK | `001:148` no CHECK, default `'whatsapp'` | realign default→`whatsapp_scheduled`, backfill, add CHECK |
| 7 | `hindrances.dpr_included` drop DEFAULT | `001:192` DEFAULT true | DROP DEFAULT |
| 8 | `complete_onboarding` zero-row guard | 007:175-199 no guard | CREATE OR REPLACE + GET DIAGNOSTICS/RAISE |

### Explicitly deferred (recorded decisions, not omissions)
- `complete_onboarding` double-call second-tenant minting (§11b "known pre-existing
  behaviour") → invitations work.
- `owner_user_id` same-tenant enforcement (a plain FK lets a project point at an
  owner row in another tenant; composite-FK/trigger territory) → **backlog item-9**
  systemic tenant-scoping audit.

---

## 2. Probe evidence (prod, read-only, service-role, 2026-07-12)

Prod ref confirmed `jvxwqignooseazzmwhvl` (NOT the test-db `exfccwlrhoutkgrlikod`)
before any probe ran. All decisions with a data dependency were gated on these.

**F3-1** — source + spec authority for the evening-dependency consolidation:
```
001:120  evening_dependencies_tomorrow    TEXT,     (no inline comment)
001:121  evening_dependencies_structured  JSONB,    (no inline comment)
docs/bot-flows.md:106  → evening_dependencies [{item, responsible_party, required_by_time}].
```
→ canonical shape is a single JSONB; the two 001 columns are superseded draft
leftovers → rename `_structured`→`evening_dependencies`, drop `_tomorrow`.

**F3-2 + F4-1** — one combined query over `daily_logs`:
```
daily_logs total rows: 0
tomorrow_rows   : 0
structured_rows : 0
dep_rows(morning_dependencies): 0
hin_rows(morning_hindrances)  : 0
```
→ every rename/drop/TYPE change is data-free; `NULLIF(col,'')::jsonb` cast is
belt-and-braces.

**F5-1** — `safety_incidents`:
```
total rows: 0
submitted_via distribution: {}
```
→ CHECK needs no backfill; default realignment touches no rows.

---

## 3. The gating bug this review caught (told straight)

The first draft of Section 1 ordered the role rename as **data-before-constraint**:
```sql
UPDATE public.users SET role = 'owner' WHERE role = 'client';   -- WRONG ORDER
-- ...then drop old CHECK, add new CHECK
```
That is latently broken. The old `001` CHECK **excludes `'owner'`**, so an
`UPDATE … = 'owner'` is rejected by that constraint (SQLSTATE **23514**,
check_violation) *while it still stands*. The draft only "worked" because there
are **zero `client` rows on prod today** (F3-2 sibling fact) — the UPDATE matched
nothing, so the constraint was never tested. The moment a real `client` row
existed, the migration would have aborted mid-apply with a confusing 23514.

**Fix:** this is a rename INTO a previously-forbidden value, so **constraint-drop
must precede data**. Reordered to: dynamic DROP old constraint → UPDATE data →
ADD `users_role_check`. The down-path reference had the mirrored bug (its
`owner`→`client` revert would hit the *new* constraint) and was fixed the same way.

This is recorded here deliberately. A review that caught a latent 23514 before it
reached prod is the process working as designed — the same discipline (§0:
"verify by observation, not checklist") that caught the false "PITR — DONE" in
007. Hiding it would defeat the point of the second pair of eyes.

### Other review fixes (minor)
- `owner_user_id` FK → explicit `ON DELETE RESTRICT` (house convention).
- Dynamic constraint lookup → `SELECT … INTO STRICT` with an `EXCEPTION` block
  handling `NO_DATA_FOUND` (found none) and `TOO_MANY_ROWS` (found several)
  explicitly — fails loud rather than silently no-op'ing or dropping the wrong
  constraint (the 007 INTO-STRICT pattern).
- T-016-05 default assertion tightened from "member of allowed set" to exact
  `toBe('whatsapp_scheduled')`.
- Header deferred-section gained the `owner_user_id` cross-tenant note.

---

## 4. Tests — T-016-01..07

Schema-shape/constraint tests run through the SERVICE-ROLE client (CHECK/FK/type/
DEFAULT are DB-enforced regardless of RLS); the one RLS-sensitive path
(`complete_onboarding` happy path) uses a real JWT, mirroring 015 T-015-05.

- **T-016-01** role CHECK: `owner` accepted, `client` rejected (23514)
- **T-016-02** zero-row guard RAISEs (P0002 no_data_found) AND the tenant INSERT
  rolls back — asserts no leaked tenant by slug
- **T-016-03** happy-path regression: guarded RPC still writes role/tenant/full_name
- **T-016-04** `invoices.amount` accepts 1e8 (overflows (10,2), fits (12,2))
- **T-016-05** `submitted_via`: `web_app` ok, `whatsapp`/junk rejected (23514),
  omitted default is exactly `whatsapp_scheduled`
- **T-016-06** `daily_logs`: JSON arrays round-trip on the 3 JSONB cols, `is_holiday`
  defaults false, dropped `evening_dependencies_tomorrow` errors (42703)
- **T-016-07** `owner_user_id` FK: dangling id rejected (23503), real id accepted

One assertion to confirm empirically on the branch run: T-016-02's `P0002`
(no_data_found → PostgREST surfacing). The rest are standard 23514/23503/42703.
Expected suite result after test-db apply: **49/49** (42 existing + 7 new).

`tsc --noEmit`: clean, no `any`. Vitest `fileParallelism: false` (files serial),
so the shared-fixture cleanup in T-016-06's afterEach cannot race the morning-flow
suite.

---

## 5. Apply plan

test-db branch (`exfccwlrhoutkgrlikod`) first → run suite (expect 49/49) → then
prod via SQL Editor → manual ledger INSERT into
supabase_migrations.schema_migrations (→ 13 rows) → probes → schema.md 016 entry
folding the F1/F2/F7 doc-drift fixes (stripe-rename lie, stale "007 owns these
items" block, stale 013-repair-pending note).

**Ledger method (reconciled).** Both 015 and 016 record their ledger row via a
**manual `INSERT` into `supabase_migrations.schema_migrations` in the SQL
Editor**. The `supabase migration repair --status applied` phrasing used for 015
was the **CLI-equivalent label** for what that INSERT accomplishes, not the method
actually executed — the CLI stays **28P01-blocked** for this project (auth), so no
`repair`/`db push` ran for either migration. 016 uses the same manual INSERT; the
ledger goes from 12 → 13 rows.

**Pre-apply gate (prod) — definition probe, replaces the row-count probe.**
Before pasting the migration, run the role-constraint definition check and read
the pre-state, not just its cardinality:

```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%role%';
```

- **Clean pre-state → proceed:** exactly **one** row whose `def` **contains
  `'client'` and does NOT contain `'owner'`** (the untouched 001 constraint).
- **Anything else → STOP:** zero rows, more than one row, or a `def` already
  mentioning `'owner'` means the migration is partially applied or in an
  unexpected state (this is exactly what the 42710 partial-selection would have
  left behind, had it not rolled back). Do not paste; investigate first.

Then: capture PITR restore point → fresh tab, full paste, **deselect before
Run** → re-run the same probe (now: one row, `'owner'` present, `'client'`
absent) → P2–P5 → manual ledger INSERT.

The test-db half is **done and verified** (§6). The prod half is held pending
owner sign-off + external reviewer.

---

## 6. Branch verification (test-db `exfccwlrhoutkgrlikod`, 2026-07-12)

**Applied.** The full `BEGIN…COMMIT` block ran clean on a fresh full-paste.

### The 42710 story (mechanism now fully closed)
The first apply attempt surfaced `42710` (duplicate_object). This was **not a
migration defect** — it was a SQL-Editor partial-selection artifact, and the exact
mechanism is now understood end to end:

1. The highlighted selection **started after the Section 1 DO block** — so the
   dynamic `DROP CONSTRAINT` never ran. The selection began at the `ADD
   CONSTRAINT users_role_check` statement.
2. That `ADD` therefore ran **without the preceding DROP**, and collided with the
   **original 001 constraint** — which is itself convention-named
   `users_role_check` (Postgres's `<table>_<column>_check`). Same name already
   present → `42710 duplicate_object`. (This is incidental confirmation that the
   corrected auto-naming premise below is right: the collision *was* with the
   identically-named original.)
3. A multi-statement selection run in the SQL Editor **without an explicit
   `BEGIN`** executes as **one implicit transaction**. So the `42710` failure
   **rolled back everything in the selection**, including the `UPDATE … SET
   role='owner'`. Nothing was half-applied.
4. Confirmed by re-probing: the **pre-state was unchanged** — the original single
   `users_role_check` still present, no data mutated. A **full re-run** (whole
   file, fresh tab, nothing selected) applied the complete `BEGIN…COMMIT`
   atomically and cleanly.

→ Runbook rule for the prod apply: **fresh tab, full paste, deselect before Run**
(a stray highlight is silently treated as "run only this"). The pre-apply
definition probe below is the belt to that braces — it refuses to proceed unless
the pre-state is exactly the one original `client`-bearing constraint.

### Corrected premise (Section 1 comment)
During verification the Section 1 header comment's premise was corrected (commit
`e5b3abe`): the 001 inline `role` CHECK is **auto-named `users_role_check` by
Postgres's `<table>_<column>_check` convention**, not server-random. The DO-block
dynamic `INTO STRICT` lookup stays as insurance (fails loud on mis-count), but the
"server-named" justification was wrong and is now accurate.

### Catalog probes — all five green
- **P1** `users_role_check` def = `CHECK ((role = ANY (ARRAY['pm','qs','engineer','owner','subcontractor','admin'])))` — `owner` in, `client` out.
- **P2** `tenants`: `payment_customer_id` (text), `paid_until` (timestamptz), `last_payment_ref` (text) present; **no** `stripe_customer_id`.
- **P3** `projects.owner_user_id` FK present, `confdeltype = r` (ON DELETE RESTRICT).
- **P4** `daily_logs`: `is_holiday` (boolean), `holiday_reason` (text), `evening_dependencies` (jsonb), `morning_dependencies` (jsonb), `morning_hindrances` (jsonb) present; **no** `evening_dependencies_tomorrow` / `_structured`.
- **P5** `safety_incidents.submitted_via` default = `'whatsapp_scheduled'::text`; CHECK = `CHECK ((submitted_via = ANY (ARRAY['whatsapp_scheduled','whatsapp_adhoc','web_app'])))`.

### Suite — 49/49
`npm test` against the migrated test-db branch: **7 files, 49 tests passed,
EXIT=0** (7 new T-016 + 42 existing: 007×9, 015×6, morning-flow×8,
session-transition×5, unit×14). `tsc --noEmit` clean, no `any`. `pretest`
profile-lookup guard passed; the allowlist guard confirmed the run targeted the
test-db branch.

**Pre-registered watch item — RESOLVED as expected.** T-016-02 passed: the
`no_data_found` RAISE surfaced through PostgREST as SQLSTATE **`P0002`** exactly as
the assertion pre-registered, and the tenant-rollback leg confirmed no orphaned
tenant. No fix required.

---

# Round 2/3 — consolidated reviewer package (2026-07-13)

This section folds the round-2/3 exchange into the repo file itself, so it
survives the GitHub branch-cache problem — the file on the branch is the source
of truth. It carries the full raw migration, the full raw test suite, the raw
49/49 run, and the three resolved findings (F2 mechanism, F3 ledger
reconciliation, F1 executed). Everything needed to sign off is inline below; no
need to trust a possibly-stale rendered diff.

## F2 — the 42710, answering the commit-or-rollback question precisely

Your question was whether the first (partial) apply left anything committed that
the re-run then had to contend with. **Answer: nothing was committed; the re-run
collided with nothing.** Precisely:

- The SQL Editor ran a **highlighted sub-selection that began after the Section 1
  `DO` block** — so the dynamic `DROP CONSTRAINT` never executed. Execution
  started at `ADD CONSTRAINT users_role_check`.
- That `ADD` collided with the **original 001 constraint**, which is itself
  convention-named `users_role_check` (`<table>_<column>_check`). Duplicate name →
  `42710 duplicate_object`.
- A multi-statement selection with **no explicit `BEGIN`** runs as **one implicit
  transaction**. The `42710` aborted that implicit transaction, so **every
  statement in the selection rolled back — including the `UPDATE … SET
  role='owner'`**. Nothing was committed. There was no half-applied state.
- I confirmed this by re-probing the constraint definition **before** re-running:
  the pre-state still held **only the original single `client`-bearing
  constraint**, unchanged. So the full re-run (fresh tab, whole file, nothing
  selected) **collided with nothing** — the `DROP` found the one original
  constraint, dropped it, the `UPDATE` ran, the new `ADD` had a clear name. Clean
  atomic `BEGIN…COMMIT`.

**Probe correction accepted and applied.** The prod runbook now uses the
**definition** probe only (read `pg_get_constraintdef`, require exactly one row
containing `'client'` and not `'owner'` to proceed; anything else STOP). The
earlier zero-rows/row-count version appears in **no** 016 runbook — verified by
grep across `docs/` (the only `count(*)` hits are unrelated 007/015 invariants).

## F3 — ledger method reconciled

Both **015 and 016** record their ledger row via a **manual `INSERT` into
`supabase_migrations.schema_migrations` in the SQL Editor**. The `supabase
migration repair --status applied` phrasing around 015 was the **CLI-equivalent
label** for what that INSERT accomplishes — **never the executed method for any
migration**. The CLI is 28P01-blocked for this project, so no `repair`/`db push`
ran for 013/014/015/016. 016 uses the same manual INSERT (ledger 12 → 13).

## F1 — path (b) executed (not proposed)

Path **(a)** (stand up / regenerate generated types now) is unavailable here:
type generation needs the Supabase CLI (28P01-blocked, no access token in the
environment), and adopting `<Database>` across the three clients is feature-sized
regardless. So path **(b)** was executed to spec — a dated CLAUDE.md correction,
committed and pushed on `main` (`99d70e2`, a repo-wide docs correction, same class
as the PITR one):

- **§9** — struck the phantom `types/database.ts` file-tree entry with a dated
  correction (the file never existed; `git log --all -- types/database.ts` empty).
- **§6** — amended the "generate DB types" rule with a dated note recording the
  actual interim practice (untyped clients + inline `.single<{...}>()` generics in
  tests) and **deferring generated-types adoption to a named milestone: a
  dedicated PR immediately after 016 merges, before Morning Flow Pass 2 merges.**
  It carries a standing runbook-template line — **"regenerate types after every
  schema migration"** — inert today, active the day the pipeline exists.

Net: 016's shape change cannot break a types file that does not exist; `tsc
--noEmit` clean on the branch as-is; the drift concern is now owned by a named,
sequenced milestone.

---

## Raw artifact 1 — `supabase/migrations/016_corrections.sql` (verbatim)

```sql
-- ============================================================================
-- 016_corrections.sql
-- ----------------------------------------------------------------------------
-- The corrections migration: the trivial column/type fixes and the role rename
-- that were EVICTED from 007 (the identity-surgery migration) per the
-- checkpoint-1 review §1b, so a bug in a rename could never force rollback
-- pressure on the irreversible auth change. 007 = identity only; this is
-- everything else that 007 originally carried, plus the §11b RPC zero-row guard.
--
-- Fully reversible (no identity surgery here). Down-path at the foot of the file.
-- Rollback safety net is OBSERVED PITR (enabled + observation-verified on prod
-- 2026-07-12, 2-minute granularity, per CLAUDE.md §0) — capture a restore point
-- immediately before apply. A down-script is the convenience, PITR is the net.
--
-- Apply mechanics: SQL Editor is the deliberate fallback (CLI auth-blocked at
-- 28P01, as with 013/014/015). Verify on the test-db branch (exfccwlrhoutkgrlikod)
-- first, then prod, then a manual INSERT into supabase_migrations.schema_migrations
-- (SQL-Editor equivalent of `supabase migration repair --status applied 016`).
--
-- Pre-apply probe evidence (prod, service-role, read-only, 2026-07-12):
--   daily_logs        = 0 rows  -> all TYPE/rename/drop below are data-free
--   safety_incidents  = 0 rows  -> submitted_via CHECK needs no backfill
--   evening_dependencies_tomorrow / _structured : 0 / 0 non-null
--   morning_dependencies / morning_hindrances    : 0 / 0 non-null
--
-- EXPLICITLY DEFERRED (recorded decision, NOT an omission):
--   * complete_onboarding's double-call second-tenant minting (review §11b,
--     "known pre-existing behaviour") is a behavioural redesign entangled with
--     the invitations attach-flow, not a schema correction. Deferred to the
--     invitations work by decision on 2026-07-12. This migration adds only the
--     zero-row GUARD.
--   * projects.owner_user_id has NO same-tenant enforcement — the plain FK lets
--     a project point at an owner row in ANOTHER tenant. Enforcing that is
--     composite-FK / trigger territory; recorded for the backlog item-9 audit
--     (systemic tenant-scoping pass), not fixed here.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. users.role : 'client' -> 'owner'. This is a value rename INTO a value the
--    old 001 CHECK forbids, so CONSTRAINT-DROP PRECEDES DATA: the old CHECK
--    excludes 'owner', so any UPDATE ... = 'owner' would be rejected while it
--    stands (it "passes" today only because zero 'client' rows exist — not a
--    guarantee to build on). Order: drop old constraint -> update data -> add
--    new constraint. The 001 inline CHECK is auto-named users_role_check by
--    Postgres's <table>_<column>_check convention; we still find it dynamically
--    (INTO STRICT, 007 pattern) as insurance so a mis-count fails loud rather
--    than dropping the wrong constraint if that convention ever didn't hold.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO STRICT v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', v_conname);
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'migration 016: expected exactly one role CHECK on public.users, found none';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'migration 016: expected exactly one role CHECK on public.users, found several';
END $$;

UPDATE public.users SET role = 'owner' WHERE role = 'client';

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('pm', 'qs', 'engineer', 'owner', 'subcontractor', 'admin'));

-- ----------------------------------------------------------------------------
-- 2. tenants : rename the Stripe-era column (Razorpay is the actual processor,
--    Stripe paused India onboarding) + add the billing-state columns.
--    NOTE: schema.md L68 wrongly claimed this was "renamed in 006" — it was
--    never renamed in any migration; stripe_customer_id is still live at 001:25.
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenants RENAME COLUMN stripe_customer_id TO payment_customer_id;
ALTER TABLE public.tenants ADD COLUMN paid_until      TIMESTAMPTZ;
ALTER TABLE public.tenants ADD COLUMN last_payment_ref TEXT;

-- ----------------------------------------------------------------------------
-- 3. projects.owner_user_id : links a project to its owner (role='owner') row.
--    FK to users(id) — the standalone id post-007.
-- ----------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN owner_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 4. daily_logs :
--    (a) holiday flag/reason
--    (b) evening_dependencies -> single JSONB per bot-flows.md:106 Q6 spec
--        [{item, responsible_party, required_by_time}]. The 001 draft carried
--        TWO leftover columns (evening_dependencies_tomorrow TEXT +
--        evening_dependencies_structured JSONB); both 0 rows. Rename the JSONB
--        one to the canonical name, drop the superseded TEXT one.
--    (c) morning_dependencies / morning_hindrances TEXT -> JSONB (0 rows; the
--        NULLIF guard is belt-and-braces since the tables are empty).
-- ----------------------------------------------------------------------------
ALTER TABLE public.daily_logs ADD COLUMN is_holiday    BOOLEAN DEFAULT false;
ALTER TABLE public.daily_logs ADD COLUMN holiday_reason TEXT;

ALTER TABLE public.daily_logs DROP COLUMN evening_dependencies_tomorrow;
ALTER TABLE public.daily_logs
  RENAME COLUMN evening_dependencies_structured TO evening_dependencies;

ALTER TABLE public.daily_logs
  ALTER COLUMN morning_dependencies TYPE JSONB USING NULLIF(morning_dependencies, '')::jsonb;
ALTER TABLE public.daily_logs
  ALTER COLUMN morning_hindrances   TYPE JSONB USING NULLIF(morning_hindrances, '')::jsonb;

-- ----------------------------------------------------------------------------
-- 5. invoices.amount : (10,2) -> (12,2). Money is DECIMAL(12,2), no exceptions.
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ALTER COLUMN amount TYPE DECIMAL(12,2);

-- ----------------------------------------------------------------------------
-- 6. safety_incidents.submitted_via : align the default to a value that is IN
--    the CHECK (001 default was 'whatsapp', which is NOT in the allowed set),
--    backfill any legacy 'whatsapp' rows (0 today), THEN add the CHECK.
--    Data before constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE public.safety_incidents
  ALTER COLUMN submitted_via SET DEFAULT 'whatsapp_scheduled';
UPDATE public.safety_incidents
  SET submitted_via = 'whatsapp_scheduled' WHERE submitted_via = 'whatsapp';
ALTER TABLE public.safety_incidents
  ADD CONSTRAINT safety_incidents_submitted_via_check
  CHECK (submitted_via IN ('whatsapp_scheduled', 'whatsapp_adhoc', 'web_app'));

-- ----------------------------------------------------------------------------
-- 7. hindrances.dpr_included : drop the default (001 had DEFAULT true). It is
--    set by the DPR generation job, not defaulted at insert.
-- ----------------------------------------------------------------------------
ALTER TABLE public.hindrances
  ALTER COLUMN dpr_included DROP DEFAULT;

-- ----------------------------------------------------------------------------
-- 8. complete_onboarding : add the §11b zero-row guard. Body otherwise verbatim
--    from 007:175-199. SECURITY DEFINER preserved (015 T-015-05 proves the
--    DEFINER write path survives the 015 grants); the EXECUTE grant from 005
--    persists across CREATE OR REPLACE. Without the guard a zero-row UPDATE
--    silently returns the fresh tenant_id, orphaning a tenant with no admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_company_name TEXT,
  p_slug         TEXT,
  p_full_name    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_rows      INTEGER;
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (p_company_name, p_slug)
  RETURNING id INTO v_tenant_id;

  UPDATE public.users
  SET tenant_id = v_tenant_id,
      full_name = p_full_name,
      role      = 'admin'
  WHERE auth_id = auth.uid();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'complete_onboarding: no users row for auth.uid()=% — refusing to orphan tenant %', auth.uid(), v_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_tenant_id;
END;
$$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (reference — prefer PITR restore point taken pre-apply)
-- ----------------------------------------------------------------------------
-- BEGIN;
--   -- 8. restore prior complete_onboarding (007 body, no guard)
--   --    (re-run 007:175-199 verbatim)
--   -- 7. ALTER TABLE public.hindrances ALTER COLUMN dpr_included SET DEFAULT true;
--   -- 6. ALTER TABLE public.safety_incidents DROP CONSTRAINT safety_incidents_submitted_via_check;
--   --    ALTER TABLE public.safety_incidents ALTER COLUMN submitted_via SET DEFAULT 'whatsapp';
--   -- 5. ALTER TABLE public.invoices ALTER COLUMN amount TYPE DECIMAL(10,2);
--   -- 4. ALTER TABLE public.daily_logs
--   --      ALTER COLUMN morning_hindrances   TYPE TEXT USING morning_hindrances::text;
--   --    ALTER TABLE public.daily_logs
--   --      ALTER COLUMN morning_dependencies TYPE TEXT USING morning_dependencies::text;
--   --    ALTER TABLE public.daily_logs RENAME COLUMN evening_dependencies TO evening_dependencies_structured;
--   --    ALTER TABLE public.daily_logs ADD COLUMN evening_dependencies_tomorrow TEXT;
--   --    ALTER TABLE public.daily_logs DROP COLUMN holiday_reason;
--   --    ALTER TABLE public.daily_logs DROP COLUMN is_holiday;
--   -- 3. ALTER TABLE public.projects DROP COLUMN owner_user_id;
--   -- 2. ALTER TABLE public.tenants DROP COLUMN last_payment_ref;
--   --    ALTER TABLE public.tenants DROP COLUMN paid_until;
--   --    ALTER TABLE public.tenants RENAME COLUMN payment_customer_id TO stripe_customer_id;
--   -- 1. (mirror of the up-path: constraint-drop precedes the data revert, since
--   --     'client' is forbidden by users_role_check while it stands)
--   --    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
--   --    UPDATE public.users SET role='client' WHERE role='owner';  -- only if reverting the rename
--   --    ALTER TABLE public.users ADD CONSTRAINT users_role_check
--   --      CHECK (role IN ('pm','qs','engineer','subcontractor','client','admin'));
-- COMMIT;
-- ============================================================================
```

---

## Raw artifact 2 — `test/migration-016.test.ts` (verbatim)

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  testEngineerId,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  TEST_007_PASSWORD,
} from './helpers/db'

// Migration 016 (corrections) verification suite. Covers the column/type fixes
// and the role rename evicted from 007 (review §1b) plus the §11b RPC guard.
//
//   T-016-01  users.role CHECK: 'owner' now accepted, 'client' now rejected
//   T-016-02  complete_onboarding zero-row guard: RAISE (no_data_found), tenant
//             mint rolled back — no orphan
//   T-016-03  complete_onboarding happy path still writes (regression on the
//             CREATE OR REPLACE; DEFINER path, real JWT)
//   T-016-04  invoices.amount is DECIMAL(12,2): accepts a value beyond (10,2)
//   T-016-05  safety_incidents.submitted_via CHECK: allowed set accepted, junk /
//             legacy 'whatsapp' rejected; default aligned to a legal value
//   T-016-06  daily_logs: is_holiday defaults false; morning_dependencies /
//             morning_hindrances / evening_dependencies are JSONB; the superseded
//             evening_dependencies_tomorrow column is gone
//   T-016-07  projects.owner_user_id FK: rejects a dangling id, accepts a real one
//
// Schema-shape and constraint tests run through the SERVICE-ROLE client — they
// assert CHECK / FK / type / DEFAULT, which the DB enforces regardless of RLS.
// The one RLS-sensitive path (complete_onboarding happy path) uses a real JWT,
// mirroring 015 T-015-05. Runs against the test-db branch (test/setup/guard.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A syntactically valid UUID that is NOT any real users.id — for the FK-reject leg.
const DANGLING_UUID = '00000000-0000-4000-a000-0000000160ff'
const TODAY = '2026-07-12'

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

// Purge anything a test inserted into the correction-target tables under the
// fixture tenant/project, so re-runs stay clean and independent.
afterEach(async () => {
  const db = testClient()
  await db.from('invoices').delete().eq('project_id', TEST_PROJECT_ID)
  await db.from('safety_incidents').delete().eq('project_id', TEST_PROJECT_ID)
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_ID)
  // Undo any owner_user_id we set on the fixture project.
  await db.from('projects').update({ owner_user_id: null }).eq('id', TEST_PROJECT_ID)
})

describe('migration 016 — corrections', () => {
  // -------------------------------------------------------------------------
  // T-016-01 — the role rename lands in the CHECK: 'owner' is now a legal role
  // (it was NOT in the 001 constraint), and the retired 'client' value is now
  // rejected. Insert both via the service role (auth_id NULL — the ENG/owner
  // shape) and assert accept/reject.
  // -------------------------------------------------------------------------
  it('T-016-01: users.role CHECK accepts owner, rejects client', async () => {
    const db = testClient()

    const { data: ok, error: okErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_ID,
        full_name: 'ZZ 016 Owner',
        role: 'owner',
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    expect(okErr).toBeNull()
    expect(ok?.id).toMatch(UUID_RE)
    if (ok) await db.from('users').delete().eq('id', ok.id)

    const { error: badErr } = await db.from('users').insert({
      tenant_id: TEST_TENANT_ID,
      full_name: 'ZZ 016 Client',
      role: 'client',
      auth_id: null,
    })
    expect(badErr).not.toBeNull()
    // 23514 = check_violation: 'client' is no longer in users_role_check.
    expect(badErr?.code).toBe('23514')
  })

  // -------------------------------------------------------------------------
  // T-016-02 — §11b zero-row guard. Called through the service-role client there
  // is no session, so auth.uid() is NULL and the UPDATE matches no users row.
  // Pre-016 this silently returned the fresh tenant_id (orphaning a tenant);
  // post-016 it must RAISE, and the tenant INSERT must roll back with it.
  // -------------------------------------------------------------------------
  it('T-016-02: complete_onboarding raises and rolls back the tenant on zero-row', async () => {
    const db = testClient()
    const slug = `zz-016-orphan-${Date.now()}`

    const { data, error } = await db.rpc('complete_onboarding', {
      p_company_name: 'ZZ 016 Orphan Co',
      p_slug: slug,
      p_full_name: 'ZZ 016 Nobody',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    // no_data_found is raised with SQLSTATE P0002.
    expect(error?.code).toBe('P0002')

    // The tenant the RPC INSERTed before the UPDATE must NOT survive — the RAISE
    // aborts the whole function call (one transaction), rolling the INSERT back.
    const { data: leaked } = await db.from('tenants').select('id').eq('slug', slug)
    expect(leaked ?? []).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // T-016-03 — regression: the guarded CREATE OR REPLACE still writes on the
  // happy path. Real JWT (the production onboarding call path), mirrors 015
  // T-015-05. A matched row means v_rows > 0, so the guard does not fire.
  // -------------------------------------------------------------------------
  it('T-016-03: complete_onboarding still writes role/tenant_id/full_name (happy path)', async () => {
    const db = testClient()
    const email = 'zz-016-onboarding@quoco.test'
    const slug = `zz-016-onboard-${Date.now()}`

    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const stale = pre?.users.find((u) => u.email === email)
    if (stale) {
      await db.from('users').delete().eq('auth_id', stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password: TEST_007_PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    const authId = created!.user!.id

    let client: SupabaseClient | null = null
    let createdTenantId: string | null = null
    try {
      client = await jwtClient(email, TEST_007_PASSWORD)
      const { data: tenantId, error: rpcErr } = await client.rpc('complete_onboarding', {
        p_company_name: 'ZZ 016 Onboard Co',
        p_slug: slug,
        p_full_name: 'ZZ 016 Onboarded Admin',
      })
      expect(rpcErr).toBeNull()
      expect(tenantId).toMatch(UUID_RE)
      createdTenantId = tenantId as string

      const { data: row } = await db
        .from('users')
        .select('tenant_id, full_name, role')
        .eq('auth_id', authId)
        .single<{ tenant_id: string; full_name: string; role: string }>()
      expect(row?.tenant_id).toBe(createdTenantId)
      expect(row?.full_name).toBe('ZZ 016 Onboarded Admin')
      expect(row?.role).toBe('admin')
    } finally {
      if (client) await client.auth.signOut()
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
      if (createdTenantId) await db.from('tenants').delete().eq('id', createdTenantId)
    }
  })

  // -------------------------------------------------------------------------
  // T-016-04 — invoices.amount widened to DECIMAL(12,2). A value of
  // 100,000,000.00 overflows (10,2) (max 99,999,999.99) but fits (12,2). Insert
  // succeeds and the value round-trips exactly.
  // -------------------------------------------------------------------------
  it('T-016-04: invoices.amount accepts a value beyond DECIMAL(10,2)', async () => {
    const db = testClient()
    const { data, error } = await db
      .from('invoices')
      .insert({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        submitted_by: testEngineerId(),
        amount: 100000000.0, // 1e8 — rejected by (10,2), fine for (12,2)
      })
      .select('amount')
      .single<{ amount: number }>()
    expect(error).toBeNull()
    expect(Number(data?.amount)).toBe(100000000.0)
  })

  // -------------------------------------------------------------------------
  // T-016-05 — safety_incidents.submitted_via CHECK. The allowed set inserts
  // cleanly; the retired default value 'whatsapp' (and any junk) is rejected.
  // Also proves the default was realigned to a legal value: an insert omitting
  // submitted_via must NOT trip the new constraint.
  // -------------------------------------------------------------------------
  it('T-016-05: safety_incidents.submitted_via enforces the allowed set', async () => {
    const db = testClient()
    const base = {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      reported_by: testEngineerId(),
    }

    const { error: okErr } = await db
      .from('safety_incidents')
      .insert({ ...base, submitted_via: 'web_app' })
    expect(okErr).toBeNull()

    const { error: badErr } = await db
      .from('safety_incidents')
      .insert({ ...base, submitted_via: 'whatsapp' }) // retired default value
    expect(badErr?.code).toBe('23514')

    // Default omitted -> realigned to exactly 'whatsapp_scheduled' (was the
    // now-illegal 'whatsapp' in 001).
    const { data: def, error: defErr } = await db
      .from('safety_incidents')
      .insert({ ...base })
      .select('submitted_via')
      .single<{ submitted_via: string }>()
    expect(defErr).toBeNull()
    expect(def?.submitted_via).toBe('whatsapp_scheduled')
  })

  // -------------------------------------------------------------------------
  // T-016-06 — daily_logs corrections. is_holiday defaults false; the three
  // dependency/hindrance columns accept JSON arrays (they are JSONB now); the
  // superseded evening_dependencies_tomorrow column no longer exists.
  // -------------------------------------------------------------------------
  it('T-016-06: daily_logs holiday + JSONB columns behave, tomorrow column dropped', async () => {
    const db = testClient()
    const { data, error } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        engineer_id: testEngineerId(),
        log_date: TODAY,
        morning_dependencies: [{ item: 'steel', responsible_party: 'PM' }],
        morning_hindrances: [{ description: 'rain', responsible_party: 'nature' }],
        evening_dependencies: [{ item: 'crane', responsible_party: 'PM', required_by_time: '09:00' }],
      })
      .select('is_holiday, morning_dependencies, morning_hindrances, evening_dependencies')
      .single<{
        is_holiday: boolean
        morning_dependencies: { item: string; responsible_party: string }[]
        morning_hindrances: { description: string }[]
        evening_dependencies: { item: string; required_by_time: string }[]
      }>()
    expect(error).toBeNull()
    expect(data?.is_holiday).toBe(false) // DEFAULT false
    expect(data?.morning_dependencies?.[0]?.item).toBe('steel')
    expect(data?.morning_hindrances?.[0]?.description).toBe('rain')
    expect(data?.evening_dependencies?.[0]?.required_by_time).toBe('09:00')

    // The retired column is gone: selecting it errors (undefined column, 42703).
    const { error: goneErr } = await db
      .from('daily_logs')
      .select('evening_dependencies_tomorrow')
      .limit(1)
    expect(goneErr).not.toBeNull()
    expect(goneErr?.code).toBe('42703')
  })

  // -------------------------------------------------------------------------
  // T-016-07 — projects.owner_user_id FK to users(id). A dangling id is rejected
  // (foreign_key_violation); a real users id is accepted.
  // -------------------------------------------------------------------------
  it('T-016-07: projects.owner_user_id FK rejects a dangling id, accepts a real one', async () => {
    const db = testClient()

    const { error: badErr } = await db
      .from('projects')
      .update({ owner_user_id: DANGLING_UUID })
      .eq('id', TEST_PROJECT_ID)
    expect(badErr).not.toBeNull()
    expect(badErr?.code).toBe('23503') // foreign_key_violation

    const { data, error: okErr } = await db
      .from('projects')
      .update({ owner_user_id: testEngineerId() })
      .eq('id', TEST_PROJECT_ID)
      .select('owner_user_id')
      .single<{ owner_user_id: string }>()
    expect(okErr).toBeNull()
    expect(data?.owner_user_id).toBe(testEngineerId())
    // afterEach nulls owner_user_id back out.
  })
})
```

---

## Raw artifact 3 — full suite run, 49/49 (verbatim)

```

> quocoai@0.1.0 pretest
> npm run check:profile-lookups


> quocoai@0.1.0 check:profile-lookups
> node scripts/check-profile-lookups.mjs

✓ profile-lookup guard: no from('users') + .eq('id', ...) in app/ or lib/

> quocoai@0.1.0 test
> vitest run

◇ injected env (4) from .env.test // tip: ⌘ multiple files { path: ['.env.local', '.env'] }

 RUN  v3.2.7 /Users/aravindanrajamani/Desktop/quocoai

 ✓ test/migration-007.test.ts (9 tests) 13475ms
   ✓ migration 007 — auth surgery > T-007-01: inserts an engineer row with auth_id NULL and a standalone id  324ms
   ✓ migration 007 — auth surgery > T-007-02: get_user_tenant_id() resolves the signed-in user tenant via auth_id  725ms
   ✓ migration 007 — auth surgery > T-007-03: tenant A cannot read tenant B rows (and vice versa)  1520ms
   ✓ migration 007 — auth surgery > T-007-04: handle_new_user makes one row with generated id and auth_id = NEW.id  996ms
   ✓ migration 007 — auth surgery > T-007-06: users_select shows only same-tenant rows (A sees A, not B; mirrored)  1572ms
   ✓ migration 007 — auth surgery > T-007-07: A cannot insert a project_members row scoped to tenant B  601ms
   ✓ migration 007 — auth surgery > T-007-08: A cannot insert a daily_logs row with another tenant engineer_id  742ms
   ✓ migration 007 — auth surgery > T-007-09: deleting an auth user with a linked profile fails (RESTRICT)  1110ms
   ✓ migration 007 — auth surgery > T-007-10: a fresh signup can self-read its pre-onboarding row (tenant_id NULL)  1716ms
 ✓ test/migration-016.test.ts (7 tests) 10199ms
   ✓ migration 016 — corrections > T-016-01: users.role CHECK accepts owner, rejects client  1094ms
   ✓ migration 016 — corrections > T-016-02: complete_onboarding raises and rolls back the tenant on zero-row  942ms
   ✓ migration 016 — corrections > T-016-03: complete_onboarding still writes role/tenant_id/full_name (happy path)  2426ms
   ✓ migration 016 — corrections > T-016-04: invoices.amount accepts a value beyond DECIMAL(10,2)  784ms
   ✓ migration 016 — corrections > T-016-05: safety_incidents.submitted_via enforces the allowed set  1114ms
   ✓ migration 016 — corrections > T-016-06: daily_logs holiday + JSONB columns behave, tomorrow column dropped  953ms
   ✓ migration 016 — corrections > T-016-07: projects.owner_user_id FK rejects a dangling id, accepts a real one  972ms
 ✓ test/migration-015.test.ts (6 tests) 10032ms
   ✓ migration 015 — users_update column grant > T-015-01: authenticated UPDATE of role is rejected at the privilege layer  925ms
   ✓ migration 015 — users_update column grant > T-015-02: authenticated UPDATE of tenant_id is rejected (tenant hop denied)  944ms
   ✓ migration 015 — users_update column grant > T-015-03: mixed granted+ungranted UPDATE is rejected atomically  925ms
   ✓ migration 015 — users_update column grant > T-015-04: authenticated UPDATE of full_name/avatar_url is allowed  827ms
   ✓ migration 015 — users_update column grant > T-015-05: complete_onboarding still writes role/tenant_id/full_name  1913ms
   ✓ migration 015 — users_update column grant > T-015-06: A cannot write B's row even on a granted column (RLS row-bounds it)  947ms
 ✓ test/morning-flow.test.ts (8 tests) 10092ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > start: asks Q1, no daily_logs row materialised yet  637ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q1: writes morning_plan and advances to Q4  762ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q4: completes — both fields + submitted_at, session current_flow reset  1076ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > already_complete: post-completion inbound, no daily_logs write  1234ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > resume: same IST day resumes at Q4, does not restart at Q1  944ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > reask: whitespace answer re-asks the current question, no write  937ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > concurrency: two simultaneous turns are serialised by the row lock  1764ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > startFlow:false on idle session -> idle, no flow started, no write  612ms
 ✓ test/session-transition.test.ts (5 tests) 3755ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > A: queues a different flow behind the active one, keeps current_flow  484ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits  1168ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: same IST day → resume (flow/step/context preserved)  463ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: previous IST day → fresh start (flow/step/context wiped)  467ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > D: draining an empty queue is a safe no-op  459ms
 ✓ test/unit/morning-dispatch.test.ts (8 tests) 10ms
 ✓ test/unit/test-trigger.test.ts (6 tests) 5ms

 Test Files  7 passed (7)
      Tests  49 passed (49)
   Start at  22:19:54
   Duration  52.14s (transform 324ms, setup 0ms, collect 845ms, tests 47.57s, environment 2ms, prepare 871ms)

EXIT=0
```

---

## Artifact provenance — the record, told straight (2026-07-13)

Requested by the reviewer for the PR record. Dated and honest, PITR-correction
style. **Git is the tiebreaker for every claim below.**

**The authoritative artifact** is `supabase/migrations/016_corrections.sql` at the
branch tip (SHA in the provenance frame, `/tmp/016-provenance-frame.txt`). Its
real git history is two commits: **`236fb0a`** (first commit of the file) and
**`e5b3abe`** (a comment-only fix). `git show e5b3abe` changed four lines of the
Section 1 header comment: an earlier draft justified the dynamic `INTO STRICT`
constraint lookup by calling the 001 inline CHECK **"server-named"** (implying a
random name). That premise was **wrong** — Postgres auto-names a single-column
inline CHECK deterministically as `<table>_<column>_check`, i.e.
`users_role_check`. The DO-block lookup was **retained** (it fails loud on a
mis-count, cheap insurance), but the comment now states the real reason. The
test-db `42710` on apply day independently confirmed the convention: the
collision was against the identically-named original constraint.

**Where "v1" came from, and the three contradictory artifacts.** During drafting,
three versions of this file surfaced in the review exchange, and they did *not*
agree — hence the reviewer's request to pin provenance:

1. **v1 (prose only, never committed):** the first drafted Section 1 ordered the
   role rename **data-before-constraint** — `UPDATE … SET role='owner'` *before*
   dropping the old CHECK. The reviewer caught it as a latent `23514` (the
   standing 001 CHECK forbids `'owner'`). It was corrected **before the first
   git commit**. Proof it never entered history: `git log -S "UPDATE public.users
   SET role = 'owner' WHERE role = 'client';" -- supabase/migrations/016_corrections.sql`
   returns exactly one commit (`236fb0a`), and at `236fb0a` the order is already
   DROP → UPDATE → ADD. The wrong order exists only in the pre-commit conversation.
2. **empty uploads:** when the files were re-shared to the reviewer mid-review,
   the uploads transmitted **empty** (a transport artifact, not a content
   change). For a moment the reviewer had zero-content attachments that
   contradicted both the prose and the committed file. Resolved by re-emitting
   the full file inline (and later by folding the raw file into the review
   package so the repo, not an attachment, is the source of truth).
3. **the committed file:** `236fb0a` (correct DROP→UPDATE→ADD order) then
   `e5b3abe` (comment premise corrected). This is the only artifact that was ever
   real in git, and its tip is what was pinned and applied to prod.

The lesson generalised into the standing rule (CLAUDE.md §0, 2026-07-13): pin
every artifact to `git show <sha>:path` rather than paraphrase or attachment, so
a three-way disagreement like this can never again turn on which copy someone
happened to be looking at. No history was rewritten to produce this account; it
is additive and verifiable from the log.
