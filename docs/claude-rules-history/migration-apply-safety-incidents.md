# Migration Apply Safety — Incident History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Rollback mechanisms verified by observation — 007 apply PITR incident

Origin: the 007 apply (2026-07-10), where "PITR provisioned
  — DONE" had been false for weeks and was caught only by direct dashboard
  inspection on apply day.

## Prod applies condition (d) — migrations 028/029 ledger-drift origin

Origin: migrations 028 and
       029 were both applied to prod and correctly ledgered while their own
       files sat unmerged on a feature branch for an extended stretch — the
       repo on `main` described a database that no longer existed, and 030
       was simultaneously sitting unapplied inside the scanned
       `supabase/migrations/` directory on that same unmerged branch (the
       exact hazard this file's own migration-file-lifecycle rule now
       guards against).

## db push never used — migration-026 rehearsal incident detail

On test-db here, that meant re-running 022
  (`CREATE OR REPLACE FUNCTION apply_evening_flow_turn`) over a body that
  already had 024 AND 025 correctly applied, silently reverting the
  productive/idle inversion fix — the exact bug 025 exists to prevent,
  restored by the tool meant to apply migrations safely. Caught only because
  a body-hash re-probe happened to run for an unrelated reason (a migration
  026 stale-detection mechanism being rehearsed at the time); the CI suite
  (T-024) would have failed on the very next run against test-db, with
  nothing connecting that failure to "someone ran db push" for whoever saw
  it. FIX APPLIED same-session: `025_evening_productivity_reconciliation.sql`
  re-applied directly (`supabase db query --linked -f <path>`), re-probed
  (`body_md5` back to `9bd64d28c9cbf0056c7fd63a83c12d3b`, `body_len` 35150,
  matching the reference recorded at prod's own 025 apply), T-024 confirmed
  31/31 green against test-db afterward.

## CLI target-ref rule — 045 test-db apply incident

DATED NOTE (2026-09-15): this follows the 045 test-db apply, where a
  `.env.test`-based credential was named/expected, was found missing, and
  the instruction was to stop — instead, a machine-level `supabase` CLI
  login (Keychain-cached, not scoped to this environment's own files) was
  discovered and used to reach `exfccwlrhoutkgrlikod` anyway. The apply
  itself landed on the correct, intended target and did no harm, but the
  PROCESS was wrong regardless of the outcome: an instruction to stop on a
  missing credential was not followed, because a different, unnamed
  credential happened to be reachable. This rule closes that gap going
  forward — a credential's mere presence and technical reachability is not
  authorization to use it in place of the one actually named.

## CREATE OR REPLACE FUNCTION grants qualifier — migration 030 overload incident

Evidence: migration 030's first draft appended
  `p_yesno_met`/`p_yesno_ok` to `apply_morning_flow_turn`, confirmed live
  against a real Postgres 17 instance to leave two simultaneously-callable
  functions (`pg_proc` returned two rows for one name) — caught by the
  project's own pre-apply dry-run discipline (§7's disposable-dry-run rule)
  before this ever touched test-db or prod. Full incident + the fix
  actually chosen: `docs/reviews/morning-flow-migration-review-package.md`
  §10 (the finding, kept in full) and §10.1 (the fix and its verification).

## Table-level revoke names service_role — dpr_versions probe evidence

CONFIRMED LIVE (2026-08-26, read-only
  probe against prod, breadcrumb-disciplined): `dpr_versions` (migration
  029) — `has_table_privilege('service_role', 'public.dpr_versions',
  'DELETE'/'TRUNCATE'/'REFERENCES'/'TRIGGER')` all return `true`, against
  6 real rows, while that table's own `COMMENT ON TABLE` calls it
  "Append-only DPR generation history." `031_outbound_send_ledger.sql`
  shipped with the identical gap in its first draft (caught and fixed
  pre-apply this round, by its own test-db rehearsal — see the REHEARSAL
  REQUIREMENT entry, CLAUDE.md §7). `daily_log_edits` (019), `dprs`
  (023), and `checkin_escalations` (027) are suspected to carry the same
  gap — textually identical REVOKE shape, unverified against a live probe
  — named, not yet checked; do not assume clean until probed. **This is
  the first instance CAUGHT, not the first that exists** — `dpr_versions`
  had this gap first, live since 029 shipped, undetected until now. The
  difference was never carefulness: 031 got a test-db rehearsal that
  probed `service_role`'s negative capabilities; 029 did not, because
  nothing before this round's own dry-run/rehearsal discipline ever asked
  a migration's own suite to test what a role should NOT be able to do,
  only that the intended operations succeed. FIX, WHEN IT SHIPS: its own
  migration, trips §0's own external review gate condition (b) — grants
  on an existing object — same condition 020 and 029's fixes both
  tripped. Not started by this entry; recorded so it has somewhere
  durable to live, per `docs/reviews/service-role-table-grants-gap.md`'s
  own SCOPE OF THE FIX section.

## outbound_sends grants differ — row-count growth backstory

`outbound_sends` grew from 78
  rows (2026-08-28) to 3,716 (2026-09-05) with no deletion path at all,
  which is what let an unbounded/unordered scan silently truncate under
  PostgREST's 1000-row cap (fixed separately in PR #188).

## One-time migration statement pin — 023/028 destructive precedent examples

Precedent: 023's
      `35a2f41c` DELETE. Concrete case where the pin itself had to move:
      028's own DELETE was pinned to one id, then had to be WIDENED when a
      second marker row (`3c14243f`) appeared before apply — re-pinned
      immediately pre-apply, not left as the original single-id list (full
      record: `docs/reviews/028-dpr-engineer-report-review-package.md`
      §21.6; `028_dprs_engineer_id_option_a.sql:211`).

## One-time migration statement pin — 029 additive precedent

Precedent: migration 029's `dpr_versions` backfill
      (`docs/reviews/029-dpr-versioning-review-package.md` §12, B3).

## Per-role function revoke — migration 020/029 incident

Origin: migration 020 (2026-07-25) found and fixed this EXACT behaviour
  for seven pre-existing functions, explicitly naming `anon` as a separate
  revoke target in its own text (`020_function_execute_hardening.sql:94`:
  `REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC,
  anon;`). That fix was never generalised into a standing rule for functions
  created AFTERWARD — a point fix, not a rule — so the first new SECURITY
  DEFINER function to ship since 020 (`write_dpr_version`, migration 029)
  silently reintroduced the identical hole: `anon` held live EXECUTE on a
  function whose one caller-trusting branch (`p_generated_by='system'`)
  keys its only guard on `auth.uid() IS NOT NULL` — and an anon PostgREST
  call carries no JWT, so it satisfies that guard exactly like the
  legitimate `service_role` caller does. The anon key is public by design
  (ships in client code), so this was a live, internet-facing exposure on
  production, caught only by the post-apply ACL fingerprint below, not by
  anything earlier in the pipeline — the dry-run scaffold has no Supabase
  default ACLs to reproduce this, the test-db rehearsal never tested an
  anon caller, and §12-style behavioural evidence authenticated as real
  users throughout, never as anon. Full incident record:
  `docs/reviews/029-dpr-versioning-review-package.md`'s U1-U5 section.

## Migration file enters supabase/migrations at apply time — 030 BB2 incident

Origin: migration 028's own file genuinely followed this
  pattern already (moved into `supabase/migrations/` at apply time, not
  before) without it ever being written down as a rule — 030 sat in the
  scanned directory, unapplied, for the length of an entire review-and-hold
  cycle before this was named and fixed.

## Why the db-push/backgrounding incident happened — root-cause retrospective (whole bullet)

- WHY THIS HAPPENED, RECORDED ALONGSIDE THE TWO RULES ABOVE BECAUSE IT IS WHAT
  CREATED THE OPENING FOR THEM TO FIRE (2026-08-11, same incident). A
  stale-detection mechanism for `dprs.generation_status` had correctly been
  brought back as a proposal and confirmed before any code was written — the
  PLAN FIRST rule at the top of this section was followed for that part.
  What wasn't separated out: once building started, writing the migration
  file and REHEARSING it against a real database ran as an undifferentiated
  continuation of "build," not as its own, separately-flagged, higher-risk
  step. Application code and a database-touching rehearsal are not the same
  risk tier and should never be collapsed into one uninterrupted stretch of
  execution — the pause that a separate checkpoint before the rehearsal step
  would have forced is exactly the pause in which the `db push` choice and
  the backgrounding choice would have been visible before either one ran, not
  after.

