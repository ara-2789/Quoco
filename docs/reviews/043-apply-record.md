# Migration 043 — production apply record (2026-09-14)

Companion to `docs/reviews/043-review-package.md` (the full external review
package — two rounds, all raw evidence) and
`supabase/migrations/043_daily_log_photos.sql` (the applied file itself,
carrying its own dated correction inline). **Applied by hand, outside this
session** — this document is the post-apply paperwork, written from the
facts reported after the fact, not re-derived or independently re-run. The
CLI link was back on test-db (`exfccwlrhoutkgrlikod`) by the time this
record was written; **no database connection of any kind was made while
writing it** — every fact below is pasted verbatim from what was reported,
not re-probed.

## First Storage-backed table in this product's history

`daily_log_photos` is the first `public`-schema table whose rows point at
real Supabase Storage objects. The bucket it depends on
(`daily-log-photos`) is migration 042's own, applied and merged first,
specifically so this table would have somewhere to point — see
`docs/reviews/042-apply-record.md` for that apply's own sequence. Two
independent access-control layers exist as a result, not to be conflated
(full reasoning: `043-review-package.md` §2): the Storage object itself has
no Storage RLS at all (`service_role` + `lib/storage/photo-access.ts`'s own
membership check is that boundary); this table's own rows get real Postgres
RLS, per CLAUDE.md §4's standing multi-tenancy rule.

## External review — two rounds, both closed before this apply

- **Round 1 — STOP, fold-and-return, six items** (five findings plus one
  required test addition): the grants form left `REFERENCES`/`TRIGGER`
  untouched; `expires_at` was job-supplied, not schema-enforced;
  `daily_log_id`'s FK was `ON DELETE CASCADE` (would silently orphan a
  photo's Storage bytes); the `tenant_id`/`daily_log_id` pairing had no
  composite-FK cross-check; the header's own "not rehearsed / not
  reviewed" attestation had gone stale; and the RLS policy (SQL) /
  `getSignedPhotoUrl` (TS) boundaries needed a shared test proving they
  agree. All six fixed, re-verified live on test-db (fresh teardown +
  re-apply), landed in PR #270.
- **Round 2 — GO, conditional on the no-app-DELETE invariant test.** The
  test-db-only grant divergence this fold-and-return introduced
  (`service_role` DELETE on `daily_log_photos`, test-db only, mirroring
  the existing `outbound_sends` precedent) is safe only because
  application code never exercises that privilege — nothing enforced that
  boundary mechanically until this round. `test/unit/no-app-delete-
  invariant.test.ts` closed it: a static source guard over `lib/`/`app/`,
  table list read from `scripts/test-db-only-grants.sql` rather than
  hardcoded, proven RED (a hand-injected violation correctly failed it)
  then GREEN. Landed in PR #270 before merge, per the reviewer's own
  condition.

Both rounds' full raw evidence — probe output, `pg_proc.provolatile`
lookups for the generated-column immutability finding, the RED/GREEN test
runs — lives in `docs/reviews/043-review-package.md`; not repeated here.

## Sequence followed, in order

1. **PITR observed live**, before applying. Restore window **07 Sep 2026
   22:02:59 to 14 Sep 2026 10:33:02 IST** — confirmed directly in the
   Supabase dashboard, not assumed from a checklist line, per CLAUDE.md
   §0's own "rollback mechanisms are verified by observation" rule.
2. **Pre-apply probe on prod** (`jvxwqignooseazzmwhvl`):
   ```
   table_exists = NULL
   status_cols = 0
   ```
   Confirms the table and both `daily_logs` status columns genuinely did
   not exist yet — the apply was not re-running something already there.
3. **Applied.** `supabase db query --linked -f
   supabase/migrations/043_daily_log_photos.sql` — no error.
4. **Post-apply readback on prod**:
   ```
   table_exists = daily_log_photos | status_cols = 2 | rls_enabled = true | policy_count = 1
   ```
5. **Step D-a — generated column expression, read back via `pg_get_expr`**
   (per the review package's own required-not-improvised runbook
   addition; the schema now IS the retention policy, so the fingerprint
   records the expression itself, not just the column's existence):
   ```
   attname = expires_at
   generated_expr = timezone('UTC'::text, (timezone('UTC'::text, received_at) +
     CASE retention_class
       WHEN 'attendance'::text THEN '7 days'::interval
       ELSE '60 days'::interval
     END))
   ```
   Matches exactly what round 1's immutability fix specified and round 2
   confirmed sound at the catalog level — no drift between what was
   reviewed and what prod actually computes.
6. **Step D-b — the four-way negative grants matrix, PROD, the SOLE
   authoritative grants record.** Named explicitly as such because
   test-db's own matrix no longer agrees by design:
   `scripts/test-db-only-grants.sql` deliberately grants `service_role`
   DELETE on this table, test-db only, so a test-db reading of this exact
   query would show `del = true` — that is the accepted divergence
   (round 2), not a discrepancy with the row below.
   ```
   rolname       | sel   | ins   | upd   | del   | trunc | refs  | trig
   authenticated | true  | false | false | false | false | false | false
   anon          | false | false | false | false | false | false | false
   service_role  | true  | true  | true  | false | false | false | false
   ```
7. **Ledger repaired.** `supabase migration repair --status applied 043
   --linked` succeeded ("Repaired migration history: [043] => applied").
   `supabase migration list --linked` shows Local and Remote matching
   through 043, no gaps.
8. **File promoted, this pass.** `git mv
   docs/reviews/043_daily_log_photos.sql
   supabase/migrations/043_daily_log_photos.sql`, per CLAUDE.md's "a
   migration file enters `supabase/migrations/` when it is being applied,
   not when it is written" rule — done now that the apply is real, not
   before. Header's own "held, not applied" / "not reviewed" / "not
   applied to PROD" attestations struck through, not rewritten, per the
   036/039/042 precedent; a dated correction records the apply in full
   inline.
9. **Types regenerated** — `npx supabase gen types typescript --schema
   public`, 64 insertions to `types/database.ts`, confirmed by grep to
   contain `daily_log_photos`, both its foreign keys, and
   `morning_photos_status`/`evening_photos_status`. **Run while linked to
   TEST-DB, not prod** — recorded explicitly rather than implied. This is
   sound because both databases now carry 043 identically at the schema
   level, and `supabase gen types` output does not encode grants (the one
   axis on which the two databases deliberately differ) — so which
   database was linked for this specific step does not change the
   generated output. Confirmed by comparison, not merely asserted: the
   table/column/FK shape 043 defines is identical on both, and neither
   database's grants leak into the generated TypeScript.
10. **Reservations file updated, same session as the apply — Rule B's
    first real application.** `scripts/migration-number-
    reservations.json`'s own `043` entry gains a dated correction
    recording the apply, matching every prior applied entry's own
    convention (026/034/035/039/040/041/042). **Worth recording plainly**:
    this specific update was nearly skipped on its own first outing —
    the standing intent that a reservation gets corrected AT APPLY TIME,
    not left stale for a future audit to catch (the exact drop pattern
    034/039/040's own entries already documented happening to THEM),
    almost repeated itself on the very first apply where the rule was
    actually live to be followed. Caught and closed within this same
    pass, not deferred.

## The recomputation consequence — for the next operator who touches retention

**`expires_at` is a `GENERATED ALWAYS AS (...) STORED` column, not a
stamped-at-insert value** (round 1's item 2, §5 of the review package in
full). This inverts a guarantee the original design intended: item 15
specified that changing the retention window later should be
**forward-only** — rows already stamped under an old window keep their
original expiry. That guarantee held automatically under a plain,
stamped-once column. It does **NOT** hold automatically now: Postgres has
no in-place edit of a generated column's formula, so a future change to
either duration (7 days for `attendance`, 60 for `evening_progress`) is a
migration that **DROPs and re-ADDs the expression — which recomputes
`expires_at` for EVERY EXISTING ROW, not just future ones.** This was
**accepted deliberately**, not overlooked: making a wrong stamp impossible
today was judged worth more than preserving a forward-only guarantee for a
retention-window change that may never happen — but the trade is real, and
a future author widening or narrowing either window must explicitly
re-decide whether the forward-only guarantee still matters, and build it
back in by hand (e.g., freezing old rows' `expires_at` into a plain column
before changing the expression) if it does. The migration file's own
column comment carries an inline warning directly on the two duration
literals for exactly this reason — this paragraph is the same warning,
placed where an operator reviewing the apply record will also see it.

## Owed, not done — the closing artifact of this record

**No automated test proves a real image was downloaded from Twilio and
landed in the `daily-log-photos` bucket, on prod or anywhere else.** Every
test in `test/media-ingest.test.ts` injects a mocked `fetchFn` — the
success paths use fixed local byte arrays standing in for a download, and
only the failure-path test exercises the download step at all, and only to
prove it fails correctly. This gap was named at build time
(`043-review-package.md` §8) and is **still open** after this apply — this
record does not close it, and must not be read as having done so.

**MARKED OWED, EXPLICITLY, NOT COMPLETE**: a manual, post-deploy check —
send one real photo mid-check-in, on a real handset, against production —
then confirm by direct observation that the object actually exists in the
`daily-log-photos` bucket and the corresponding `daily_log_photos` row
carries a real, non-fake `photo_url`. This is the last piece of end-to-end
proof this feature needs before the download path itself can be trusted on
prod, and it has NOT been performed. Whoever performs it should record the
result as a dated addendum to this file, in the same "struck through, not
rewritten" discipline the rest of this record follows.

## What this apply does NOT include

**No application code changed in this pass.** This is documentation and
JSON only — the migration file's header correction, the reservations
file's dated correction, and this record. No `lib/`, `app/`, or test
changes; no database contact of any kind was made while producing any of
it.

**Prod has not been re-verified a second time by this session.** Every
fact in the "Sequence followed" section above was reported from the apply
itself, run outside this session, and is pasted here verbatim — this
record did not re-run any probe against prod (or against test-db) to
confirm it.

**Not merged.** This record, the reservations correction, and the
migration-file promotion are committed to a branch and opened as a PR, per
this pass's own instructions — `main` does not carry them yet as of this
writing.
