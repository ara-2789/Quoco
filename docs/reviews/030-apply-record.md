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

## Ledger state — DISCREPANCY found, then REPAIRED (approved, 2026-08-25)

Immediately post-apply:

```sql
SELECT version, name, array_length(statements, 1)
FROM supabase_migrations.schema_migrations WHERE version = '030';
-- 0 rows
```

**No ledger row for `030` existed on production.** The SQL Editor apply ran
the migration's DDL/DML directly; it does not itself write to
`supabase_migrations.schema_migrations` (the migration file contains no such
statement) — apply and ledger are genuinely separate steps in this project's
own tooling, same as the discipline used for `030` on test-db via `supabase
migration repair --status applied 030 --linked` (`docs/build-status.md`'s
2026-08-24 entry). That repair step ran against test-db but was not run
against production as part of the apply itself.

**Repaired, with explicit go-ahead, same session:**

```
$ supabase migration repair --status applied 030 --linked   # jvxwqignooseazzmwhvl, breadcrumb confirmed first
Repaired migration history: [030] => applied
```

Full post-repair ledger, raw:

```
001, 002, 003, 004, 005, 006, 007, 011, 012, 013, 014, 015, 016, 017,
018, 019, 020, 021, 022, 023, 024, 025, 027, 028, 029, 030
```

`count(*) = 26`. `030`'s row: `name='morning_flow_attendance'`,
`statement_count=12` — identical to test-db's own repaired row. Metadata
only, as scoped: no schema or data change, confirmed by re-running the
Post-apply fingerprint's column/function checks after the repair (unchanged
from the values recorded above).

### Root cause — corrected, not the precedent originally suspected

The instinct was to cite "the 026 gap" (the permanent `025→027` skip in the
ledger's version list) as precedent for what happens when ledgering is
skipped. **Checked against the actual record and refuted, not asserted**:
migration 026 itself was never applied to any database — per
`docs/reviews/024-025-review-package.md` §6, it is "unrelated, uncommitted,
paused pending a real end-to-end latency measurement before it ships." The
`025→027` gap is an abandoned migration NUMBER, not an applied-but-
unledgered migration — a different shape entirely, and citing it as this
incident's precedent would have been a fabricated match. (The real incident
that happened *during* 026's rehearsal — a stray `db push` briefly reverting
an unrelated function on test-db — is itself already fully recorded in
`CLAUDE.md` §0's `db push` rule and is not this incident either.)

**The actual root cause, found by reading the runbook `030` itself
followed**: `docs/migration-runbook-template.md` — the CANONICAL apply
skeleton every migration's own runbook instantiates — already has a
mandatory ledger step, **step E**: "Ledger INSERT (write) + verify... then
`SELECT count(*)` to confirm the expected row total." `030`'s own runbook
(`morning-flow-migration-review-package.md` §11.3, S0–S5) explicitly states
it "Instantiates `docs/migration-runbook-template.md`'s canonical A–E
skeleton, widened with the two concerns this migration specifically has" —
but the widened S0–S5 sequence has no step corresponding to E at all. The
ledger step was silently dropped in the act of widening, not because no
canonical step existed to widen from. **This is the real, on-point
precedent**: a review package can instantiate a canonical runbook, add its
own concerns, and still lose a step the template already covered, with
nothing catching the omission until the post-apply fingerprint surfaced it.

**Also stale, corrected while here**: the canonical template's own step E
comment claims "The CLI `migration repair` is 28P01-blocked for this
project and has never been executed — the manual INSERT is the real
method." This is no longer true — `migration repair` ran cleanly against
both test-db and production this session, twice, no auth error. Fixed
below, not left as a landmine for the next runbook author.

### Runbook fixes, both made mandatory

1. **`docs/migration-runbook-template.md`** — step E's text corrected (the
   28P01 claim removed; `supabase migration repair --status applied <nnn>
   --linked` is the working, preferred method — the manual `INSERT` stays
   documented as a fallback only), and a line added stating explicitly that
   any runbook instance widening this skeleton MUST carry step E forward
   under its own numbering — it is not optional scaffolding to drop when
   restructuring.
2. **`morning-flow-migration-review-package.md` §11.3** — a new **S6.
   Ledger repair (write) + verify** step added, after S5 (live + mirror
   confirm) rather than before S4 (merge/lockstep), deliberately: ledger
   metadata is not part of the lockstep-timing hazard S4 exists to close,
   and placing it last means it never competes with "merge immediately, no
   gap" for urgency. Documented as retroactively added, in the same style
   `morning-flow-migration-review-package.md` §11.3 already uses for its
   B2 apply-runbook section ("was missing entirely").

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
in this pass; fixing the parser is out of scope for an apply record. Full
mechanism, a second live incident, and the precise consequence:
`docs/reviews/equipment-parser-count-gap.md`.

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

## Open items — status

**Ledger gap: CLOSED (2026-08-25).** See "Ledger state" above — repaired
with explicit go-ahead, both runbooks fixed so the next apply doesn't
repeat it.

**Equipment parser count gap: OPEN, recorded separately, not fixed.**
`daily_hire_cost=1` (§b above) is a live instance of a broader defect —
there is no way to record a machine count at all, and any answer with a
count before a rate silently stores the count as the rate. Full record,
evidence, and mechanism: `docs/reviews/equipment-parser-count-gap.md`.
