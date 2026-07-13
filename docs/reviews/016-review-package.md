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
