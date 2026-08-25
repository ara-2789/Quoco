# Migration 030 — production apply record (2026-08-25)

Morning flow migration (attendance-first renumbering + `morning_manpower` rename)
applied to production by hand via the Supabase SQL Editor, per the review
package's own LOCKSTEP CLAUSE (`docs/reviews/morning-flow-migration-review-
package.md` §11.3, S4). This document is the post-apply record: the S1 session
probe, the PITR observation, pre/post fingerprints side by side, the ledger
state, the JSONB transform check, and GATE 1's live confirmation — the first
real WhatsApp exchange to run against the new RPC in production.

## SHA provenance

- **`dd64aee`** — the SHA the external reviewer gave GO on
  (`morning-flow-migration-review-package.md` §11, round 2). The reviewed
  artifacts: `supabase/migrations/030_morning_flow_attendance.sql` and
  `docs/reviews/030-rollback.sql`.
- **`a65618b`** — `dd64aee` plus one merge commit resolving two purely-additive
  conflicts against `main` (`CLAUDE.md`, `docs/design-decisions-beta-
  feedback.md`) that accumulated while the branch was held for review. The
  reviewed migration and rollback files are byte-identical at this SHA —
  verified by sha256 (`d1772041e9806081ad8413be259ad2a872870f8562ff072aabc9
  65c8873f62d7`) and an empty diff, respectively, both checked before this
  SHA was pushed. **CI-certified**: PR #107, run `32800922186`, all 7 checks
  `SUCCESS`, `headRefOid` confirmed matching throughout.
- **`d305e4c`** — the squash-merge commit PR #107 actually landed on `main`
  as. Independently CI-confirmed on its own push-triggered run (`ci.yml`
  triggers on push to `main`, not only on the PR): run `32804946445`,
  `headSha` confirmed `d305e4c`, conclusion `success`, 8m26s. Both the PR-head
  SHA and the SHA that actually reached `main` have their own green CI run —
  neither certification is inferred from the other.

## S1 session probe — PRE-APPLY, confirmed `count = 0`

Run against production (`jvxwqignooseazzmwhvl`, breadcrumb confirmed via SQL
probe, never a key listing) immediately before the apply, per the runbook's
S1/S2 discipline:

```sql
SELECT count(*), array_agg(phone_number) FROM whatsapp_sessions WHERE current_flow IS NOT NULL;
-- count: 0, array_agg: null
```

No parked mid-flow sessions at apply time — the renumbering-hazard PROCEED
condition was met.

## S0 — PITR window, observed

Dashboard → Database → Backups → Point in Time (observed by Aravind directly,
per CLAUDE.md §0's "verified by observation, never by checklist status"
rule): **7-day retention window, latest restore point 2026-08-25 07:41:09
IST.** Confirmed active before the apply proceeded.

## Pre/post fingerprint, side by side

| Check | Pre-apply | Post-apply |
|---|---|---|
| `apply_morning_flow_turn` args | `p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_manpower jsonb, p_manpower_ok boolean, p_equipment jsonb, p_equipment_ok boolean, p_now timestamp with time zone, p_test_sleep_ms integer` | **Byte-identical** |
| `apply_morning_flow_turn` row count in `pg_proc` | 1 | **1** (no orphaned overload — the §10 permanent check, CLAUDE.md §0's `CREATE OR REPLACE FUNCTION` grants rule) |
| `daily_logs.attendance` | absent | **present** |
| `daily_logs.attendance_defaulted` | absent | **present** |
| `daily_logs.attendance_raw` | absent | **present** |
| `daily_logs.morning_manpower` | absent | **present** |
| `daily_logs.morning_manpower_planned` | present | **absent** |
| `schema_migrations` version list | 001–007, 011–025, 027–029 (25 rows) | see **Ledger state** below — not simply "026 rows" |

Both captures pinned: pre-apply written to `/tmp/030-prod-preapply-fingerprint.txt`
before the apply; post-apply run against production directly, same session,
after Aravind confirmed the SQL Editor apply and the PR #107 merge.

## Ledger state — DISCREPANCY, flagged, not fixed

```sql
SELECT version, name, array_length(statements, 1)
FROM supabase_migrations.schema_migrations WHERE version = '030';
-- 0 rows
```

**No ledger row for `030` exists on production.** The SQL Editor apply ran the
migration's DDL/DML directly; it does not itself write to
`supabase_migrations.schema_migrations` (the migration file contains no such
statement, matching this project's own established pattern — apply and
ledger are separate steps, same as the discipline used for `030` on test-db
via `supabase migration repair --status applied 030 --linked`). That repair
step was run against test-db (`docs/build-status.md`'s 2026-08-24 entry) but
was **not** run against production as part of this apply. Left unresolved
here, deliberately — this is a read-only report; the fix (`supabase
migration repair --status applied 030 --linked` against
`jvxwqignooseazzmwhvl`) touches production and needs Aravind's explicit
go-ahead before it runs, consistent with "do not fix production without
telling me first."

## JSONB transform — ran cleanly over all pre-existing rows

```sql
-- top-level stale keys
SELECT count(*) FILTER (WHERE morning_manpower ? 'planned_total'),
       count(*) FILTER (WHERE morning_manpower ? 'planned_count'),
       count(*) AS total_non_null_rows
FROM daily_logs WHERE morning_manpower IS NOT NULL;
-- 0, 0, 5

-- by_trade element stale keys
SELECT count(*) FROM daily_logs,
  jsonb_array_elements(COALESCE(morning_manpower->'by_trade', '[]'::jsonb)) AS trade_elem
WHERE trade_elem ? 'planned_count';
-- 0

-- untouched NULL rows
SELECT count(*) FROM daily_logs WHERE morning_manpower IS NULL;
-- 1
```

Zero rows anywhere retain `planned_count`/`planned_total` (top-level or
inside `by_trade`); the one row that was `NULL` before the migration is
still `NULL` — matches the migration's own `WHERE morning_manpower IS NOT
NULL` scoping exactly.

## Column-level grant — migration 017's authenticated UPDATE grant, re-declared correctly

```sql
SELECT column_name FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='daily_logs'
  AND grantee='authenticated' AND privilege_type='UPDATE';
```

`morning_manpower` and `morning_plan` are both present in the grant list.
`attendance` is **not** — confirmed absent, matching the migration's own
header comment: PM correction of attendance is explicitly out of this
migration's scope (review package §4, "The PM edit UI").

## GATE 1 — first real production exchange, confirmed live

The sandbox WhatsApp handset replied to the new RPC in production:

> **Bot:** Are you on site today? Reply yes or no.

Yes path ran the full renumbered flow — plan → workers → equipment,
completing in four questions (attendance being Q1) — exactly the shape
`030`'s own header describes (§ "WHAT CHANGES", item 3: "Q1 attendance / Q2
plan / Q3 workers-by-trade / Q4 equipment").

**Today's row** (`daily_logs`, `log_date = 2026-08-25`), read in full:

```json
{
  "attendance": "present",
  "attendance_defaulted": false,
  "attendance_raw": "Yes",
  "morning_plan": "Brickwork in factory area",
  "morning_manpower": {
    "total": 18,
    "by_trade": [
      {"trade": "mason", "count": 10},
      {"trade": "helper", "count": 6},
      {"trade": "bar_bender", "count": 2}
    ],
    "raw_text": "10 mason 6 helper 2 barbender"
  },
  "morning_equipment": {
    "items": [
      {
        "type": "concrete_mixer",
        "count": null,
        "owned_or_hired": null,
        "daily_hire_cost": 1,
        "raw": "Cement mixer - 1 1000"
      }
    ],
    "none": false,
    "raw_text": "Cement mixer - 1 1000"
  }
}
```

### a. Attendance — clean, not defaulted

`attendance='present'`, `attendance_defaulted=false`, `attendance_raw='Yes'`
— a genuine classified "yes", not an exhausted-reask default. Matches
expectation exactly.

### b. Equipment — PARSER DEBT confirmed live, not refuted

**`daily_hire_cost` is `1`, not `1000`, confirmed.** `parseChunk`
(`lib/whatsapp/flows/parsers/equipment.ts:40-73`) takes only the FIRST
numeric token in a chunk as the rate (`if (cost === null) cost =
parseInt(t, 10)`) and hardcodes `count: null` unconditionally. For
`"Cement mixer - 1 1000"`, token order is `cement, mixer, -, 1, 1000`; the
first digit encountered is `1`, so `daily_hire_cost=1` — a stored Rs 1/day
mixer, not the Rs 1000/day the engineer meant. This is a live instance of
the standing PARSER DEBT (`design-decisions-beta-feedback.md` §32(c),
`design-principles.md:31` Rule 3.5) — recorded here as evidence, not fixed
in this pass; fixing the parser is out of scope for an apply record.

`type` resolved to `"concrete_mixer"` via the lexicon match on the token
`mixer` (`lib/whatsapp/flows/parsers/lexicon.ts:63`, `mixer:
'concrete_mixer'`), not a positional fallback — `cement` has no lexicon
entry, so `mixer` is the first (and only) keyword match.

### c. Manpower — new keys confirmed, `barbender` resolved correctly

`morning_manpower` uses the migration's new shape (`total`/`count`, not
`planned_total`/`planned_count`) — confirmed. `"barbender"` matched a real
canonical trade, **not** a silent drop that still counted toward the total:

```
lib/whatsapp/flows/parsers/lexicon.ts:37:  barbender: 'bar_bender',
lib/whatsapp/flows/parsers/lexicon.ts:38:  bender: 'bar_bender',
lib/whatsapp/flows/parsers/lexicon.ts:39:  steel: 'bar_bender',
```

`total: 18` = 10 (mason) + 6 (helper) + 2 (bar_bender) — the sum is correct
because the trade resolved, not despite a drop.

## Open item carried forward

**Migration 030 is not ledgered on production.** `supabase migration repair
--status applied 030 --linked` (against `jvxwqignooseazzmwhvl`) closes this,
but was deliberately not run as part of this read-only record — needs
Aravind's explicit go-ahead first.
