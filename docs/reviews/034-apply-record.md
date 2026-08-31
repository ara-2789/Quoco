# Migration 034 — production apply record (2026-08-31)

Companion to `docs/reviews/034-owner-email-review-package.md` (the full review
package — spec, security fix, delivery_status transition table, disposable
scaffold, written-AND-executed rollback, test-db rehearsal, apply runbook).
This file is the apply record, same shape as `docs/reviews/030-apply-record.md`
and `docs/reviews/033-apply-record.md`. **Applied by Aravind, SQL Editor, by
hand — this record documents the apply, it did not perform it.**

## SHA provenance

- PR #71 (`pr/030-owner-email-held`) head at apply time: `d894f27df118ac6373038a3296691b34002850ef`
  — all 7 CI checks confirmed green at commit-level granularity (`gh api
  repos/ara-2789/Quoco/commits/pr/030-owner-email-held/check-runs` →
  `head_sha` equal to the same SHA), not a stale PR-rollup status.
- Pasted SQL: `git show d894f27...:docs/reviews/034_owner_email_delivery.sql`
  → `/tmp/034-to-paste.sql`, 560 lines, sha256
  `13dfff1f3580f62b68db92722b4a12d891591c8092670dfade71e02f07188065`.
- **Hash re-verified immediately before the ledger-repair step, same value**
  — the file used for the SQL Editor paste and the file copied in for
  `migration repair` are byte-identical, confirmed twice, not assumed once.
- Aravind's own apply result: `"Success. No rows returned."` — DDL-only file,
  consistent with the SQL (three `ALTER TABLE`, one `CREATE TABLE`, grants,
  comments — no `SELECT`).

## PITR observation (runbook step A)

**Observed live, by Aravind, before any write step** — 7-day restore window,
latest restore point **31 Aug 2026 19:02:00 IST**. Per CLAUDE.md §0: verified
by direct observation, not a checklist line.

## Pre/post fingerprint, side by side

Both captured via SQL probe against `jvxwqignooseazzmwhvl`, breadcrumb
(`supabase/.temp/project-ref`, plus a live `SELECT current_database(), now()`)
confirmed immediately before each round, link switched back to test-db
(`exfccwlrhoutkgrlikod`) immediately after each round — never left pointed at
prod. Pre-apply captured pre-emptively (before Aravind's own apply, this same
session); post-apply captured immediately after his confirmation.

| Probe | Pre-apply (`/tmp/034-prod-preapply-fingerprint.txt`) | Post-apply (`/tmp/034-prod-postapply-fingerprint.txt`) |
|---|---|---|
| `delivery_status` CHECK | `pending, delivered, paused, skipped_no_data, failed` (5, bare 023) | `pending, pm_notified, delivered, paused, skipped_no_data, skipped_no_template, skipped_unverified, failed, no_report_sent, owner_send_failed, no_report_failed` (11, exact match) |
| `owner_email_verifications` present | `0` | `1` table, 6 constraints |
| `users` new columns | `0` | `3` — `notification_email`, `notification_email_verified_at`, `whatsapp_declined_at`, all `is_nullable: YES` |
| `owner_email_verifications` FKs | — | `_tenant_id_fkey` (direct, `REFERENCES tenants(id) ... RESTRICT`), `_user_id_fkey` (composite, `REFERENCES users(id, tenant_id) ... CASCADE`) |
| Lifecycle CHECKs | — | `_expires_after_created` (`expires_at > created_at`), `_used_after_created` (`used_at IS NULL OR used_at >= created_at`) |
| RLS | — | `rls_enabled: true`, `policy_count: 0` |
| `service_role` DELETE/TRUNCATE/REFERENCES/TRIGGER | — | all `false` |
| `service_role` SELECT/INSERT/UPDATE | — | all `true` |
| `anon`/`authenticated` SELECT | — | both `false` |
| `schema_migrations` count | `28` (`034` absent) | `29` (`034` present, pre-repair snapshot showed `ledger_row: null` — expected, ledger repair is its own step, below) |

**Every check matches the runbook's own stated expected value (§11 step D)
exactly. No anomaly on any of the eleven CHECK values, three columns, six
constraints, RLS state, or nine privilege probes.**

### Per-check verdict, stated individually per direct instruction

| # | Check | Expected | Result | Verdict |
|---|---|---|---|---|
| 1 | `delivery_status` CHECK, full value list | 11 named values | exact match | **PASS** |
| 2 | Direct FK `_tenant_id_fkey` | `REFERENCES tenants(id) ... RESTRICT` | exact match | **PASS** |
| 3 | Composite FK `_user_id_fkey` | `REFERENCES users(id, tenant_id) ... CASCADE` | exact match | **PASS** |
| 4 | Lifecycle CHECK `_expires_after_created` | `expires_at > created_at` | exact match | **PASS** |
| 5 | Lifecycle CHECK `_used_after_created` | `used_at IS NULL OR used_at >= created_at` | exact match | **PASS** |
| 6 | `users` new columns present + nullable | 3 rows, all `YES` | exact match | **PASS** |
| 7 | RLS enabled, zero policies | `true`, `0` | exact match | **PASS** |
| 8 | `service_role` negative (DELETE/TRUNCATE/REFERENCES/TRIGGER) | all `false` | all `false` | **PASS** |
| 9 | `service_role` positive (SELECT/INSERT/UPDATE) | all `true` | all `true` | **PASS** |
| 10 | `anon`/`authenticated` denied | both `false` | both `false` | **PASS** |

**10/10 PASS. Nothing to report as a mismatch.**

Raw post-apply probe output (single combined query, per §11 step D):
```json
{
  "delivery_status_check": "CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'pm_notified'::text, 'delivered'::text, 'paused'::text, 'skipped_no_data'::text, 'skipped_no_template'::text, 'skipped_unverified'::text, 'failed'::text, 'no_report_sent'::text, 'owner_send_failed'::text, 'no_report_failed'::text])))",
  "users_new_columns": [
    {"column_name": "notification_email", "data_type": "text", "is_nullable": "YES"},
    {"column_name": "notification_email_verified_at", "data_type": "timestamp with time zone", "is_nullable": "YES"},
    {"column_name": "whatsapp_declined_at", "data_type": "timestamp with time zone", "is_nullable": "YES"}
  ],
  "owner_email_verifications_constraints": [
    {"conname": "owner_email_verifications_expires_after_created", "contype": "c", "def": "CHECK ((expires_at > created_at))"},
    {"conname": "owner_email_verifications_pkey", "contype": "p", "def": "PRIMARY KEY (id)"},
    {"conname": "owner_email_verifications_tenant_id_fkey", "contype": "f", "def": "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT"},
    {"conname": "owner_email_verifications_token_hash_key", "contype": "u", "def": "UNIQUE (token_hash)"},
    {"conname": "owner_email_verifications_used_after_created", "contype": "c", "def": "CHECK (((used_at IS NULL) OR (used_at >= created_at)))"},
    {"conname": "owner_email_verifications_user_id_fkey", "contype": "f", "def": "FOREIGN KEY (user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE"}
  ],
  "rls_enabled": true, "policy_count": 0,
  "service_role_can_delete": false, "service_role_can_truncate": false,
  "service_role_can_references": false, "service_role_can_trigger": false,
  "service_role_can_select": true, "service_role_can_insert": true, "service_role_can_update": true,
  "anon_can_select": false, "anon_can_insert": false,
  "authenticated_can_select": false, "authenticated_can_insert": false,
  "ledger_row": null
}
```
(`ledger_row: null` here is the PRE-ledger-repair snapshot — repair is documented as its own step below, matching 030/031/033's own convention of separating the schema apply from the ledger write.)

## Ledger state

`supabase migration repair --status applied 034 --linked` run against
`jvxwqignooseazzmwhvl`. Post-repair, direct SQL confirms: `034` present,
`schema_migrations` count `28 → 29`, version list otherwise unchanged.

**KNOWN FRICTION, same as 031's and 033's own apply records — not
rediscovered, applied straight from the runbook's own documented workaround
(§11 step E):** `migration repair` globs the LOCAL `supabase/migrations/`
directory to resolve a bare version number to a filename. `034_owner_email_
delivery.sql` correctly lives in `docs/reviews/` (BB2), so the repair command
has nothing to resolve `034` against unless the file is present in
`supabase/migrations/`. Workaround, executed exactly as documented:
1. `cp /tmp/034-to-paste.sql supabase/migrations/034_owner_email_delivery.sql`
   — the same hash-verified file used for the SQL Editor paste, re-hashed
   immediately before copying (SHA provenance, above) to confirm it is still
   the exact reviewed content, not a stale local copy.
2. `supabase migration repair --status applied 034 --linked` —
   `Repaired migration history: [034] => applied`.
3. `rm supabase/migrations/034_owner_email_delivery.sql` **immediately**.
4. Confirmed clean: `git status --porcelain supabase/migrations/` returned
   nothing — no untracked file left in the scanned directory, the exact
   026-shaped hazard this workaround exists to avoid.

Full version list post-repair (29 rows):
```
001, 002, 003, 004, 005, 006, 007, 011, 012, 013, 014, 015, 016, 017, 018,
019, 020, 021, 022, 023, 024, 025, 027, 028, 029, 030, 031, 033, 034
```
(032 is not in this list — see its own section below; not a 034 concern.)

## Rollback verification, on record per direct instruction

**The reviewer's own closing artifact:** before this apply, the rollback's
GUARD branch — not just the clean path — was exercised for real, twice, on
two separate databases, not asserted from the SQL alone:

1. **Disposable local scaffold** (`docs/reviews/034-owner-email-review-package.md`
   §13b) — a seeded `no_report_sent` row triggered the guard, exit 0 at the
   `psql` level (psql's own convention) but the transaction genuinely
   aborted and rolled back; resolved and re-ran clean.
2. **Test-db** (`exfccwlrhoutkgrlikod`, review package §14) — the identical
   test, seeded on the real database: the guard fired, exit **1** this time
   (`supabase db query` surfaces a SQL error harder than local `psql`
   does), named the exact offending row, and the abort correctly unwound
   the whole transaction (confirmed by direct post-attempt query, not
   assumed). Resolved and re-ran clean a second time.

**Both branches, both environments, before this migration ever touched a
database this project cannot cheaply rebuild.** Full raw evidence in both
cases: review package §13b (scaffold) and §14 (test-db).

## Grants evidence

Covered in the pre/post fingerprint table above — `service_role` holds
exactly `SELECT`/`INSERT`/`UPDATE` (matching the confirm-route's own stated
need, §12d/§12g of the review package) and explicitly lacks
`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`; `anon`/`authenticated` hold
nothing. Matches the migration's own explicit `REVOKE ALL ... FROM PUBLIC,
anon, authenticated, service_role` / `GRANT SELECT, INSERT, UPDATE ...
TO service_role` (§3 of the SQL file) exactly — the same shape `031`
established and this file's own review round adopted (§12d).

## Separate finding, NOT this migration's concern — migration 032 ledger gap

**Found while fingerprinting prod for 034, recorded here as its own item per
direct instruction — NOT fixed, not run:** `032_session_transition_lock_
probe_nowait.sql` is applied and working on production (confirmed live,
functioning — this is not a "did it apply" question) but **absent from
`supabase_migrations.schema_migrations`**. Confirmed three separate times
this session, consistently: the combined pre-apply fingerprint query, a
second targeted query (`WHERE version LIKE '032%' OR version = '32'` →
zero rows), and the post-repair `supabase migration list --linked` output
(`{"local":"032","remote":"","time":"032"}` — `remote` empty, meaning no
real ledger row, only detected via the local file matching the version
prefix).

**This is the SECOND confirmed instance of "applied-but-unledgered" on
production**, after `033`'s own apply record documented the identical
friction class for `migration repair`'s directory-globbing behavior (though
033's OWN row did make it into the ledger correctly — this is a different,
NEW instance, not a restatement of that one). Worth naming as a pattern:
twice now, a real schema change has landed on prod without its own ledger
row following automatically.

**Not this migration's job to fix — named and left alone, per direct
instruction.** The repair command, for whenever this is addressed on its own
terms (same workaround shape as 034's own Ledger state section above, since
`032_session_transition_lock_probe_nowait.sql` also does not currently live
in `supabase/migrations/` — confirm its actual location before running this):
```
supabase link --project-ref jvxwqignooseazzmwhvl
# copy 032's own file into supabase/migrations/ temporarily, matching this
# file's own workaround shape, then:
supabase migration repair --status applied 032 --linked
# remove the temporary copy immediately, confirm git status clean
```
**Not run in this session.**

## Open items — status

**PENDING (item 5, this same session, next step):** merge PR #71 to `main`,
verified against `origin/main` directly post-merge — not this record's own
job, tracked separately.

Everything else in this record is CLOSED: SHA provenance pinned and
re-verified byte-identical at two separate points (paste, then repair),
PITR observed live pre-apply, pre/post fingerprint clean with 10/10 checks
passing exactly, ledger repaired and its already-known friction handled per
the documented workaround, grants confirmed matching the reviewed spec, and
both rollback branches proven exercised — on the scaffold and on test-db —
before this file ever touched a database without a cheap, reliable recovery
path.
