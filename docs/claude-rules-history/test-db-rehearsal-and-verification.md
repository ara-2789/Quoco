# Test-DB Rehearsal & Verification — Incident History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Rehearse on cleaned branch — auth_id mechanism investigation

MECHANISM UNCONFIRMED — do not assert one: an earlier
  note guessed "`IF NOT EXISTS` degrades to a NOTICE," which is WRONG (`IF NOT EXISTS`
  only skips when the column already exists, so it can't explain a genuinely-absent
  column) and has been retracted. What IS established: standard linear `psql` replay
  DOES add the column (not a 007 logic bug), and it involves a cross-schema FK into
  `auth.users`; the real failure mode is an open question filed with Supabase
  (docs/reviews/supabase-fresh-branch-auth-id-bug.md). Prod never hit it because 007
  was applied out-of-order (after 011-014) via the SQL editor, not a clean linear
  replay. Evidence pinned in
  docs/reviews/019-review-package.md Appendix B2.

## Concurrency/lock/race CI-only — acquire_and_transition_session origin

Origin: `acquire_and_transition_
  session` (migrations 012/013) exists specifically to serialize
  concurrent callers on one phone number — BOT-21's queueing depends on
  it, and Pass 1's cron (once the #69/031 outbound-send primitive ships,
  CLAUDE.md §3) will exercise this exact path twice daily, at scale. CI
  is the only environment that has ever genuinely tested it; a session
  discovered this only while root-causing `test/session-transition.
  test.ts` Test B's own lock-wait incident (docs/reviews/session-
  transition-lock-wait-flake.md) — an earlier "30/30 clean, zero
  negatives" local capture in that same incident is retracted as evidence
  on these grounds, though it does not change what CI itself already
  showed (three independent real failures).

## Disposable dry-run rule — 029/030/031 origin incident

Origin: 029, 030, and 031
were written, packaged, and declared review-ready in the same session, by
the same process, and none of them had ever been executed against a real
Postgres. 029 turned out to have a real ordering defect (an inline FK
referencing a parent unique constraint the file didn't create until 15 lines
later — Postgres 42830) that a careful read — including a correct, thorough
§0 security/atomicity read that had no reason to catch this class of bug —
did not surface, and that only running the file against Postgres did. The
systemic finding was never the ordering bug itself; it was that a review
package whose SQL has never been past a parser is a proposal, not a package.

## Rehearsal requirement — service_role negative capability incident

Round 1's own dry-run suite for migration 031
tested exactly one thing about `service_role`: that it could SELECT (T10).
It never tested whether `service_role` could ALSO still DELETE, TRUNCATE,
REFERENCES, or TRIGGER — and the bug this round found (`dpr_versions`,
CLAUDE.md §0) lived in exactly that untested space. **The bug was in a
test never written, not a test that ran and returned wrong** — worth
stating precisely, because the fix is not "distrust the dry-run scaffold
more," it's "test the negative space too." And this specific negative
space cannot be verified by the disposable local scaffold above at
all — see this rule's own "this is NOT the test-db rehearsal" paragraph
and the NAMED STUBS list: vanilla Postgres has no analog to Supabase's
project-level default ACL, so a `service_role DELETE, expect denied` test
would pass CLEANLY on the local stub regardless of whether the real
REVOKE statement is complete, a false negative on exactly this class of
bug. This is real evidence for the scaffold's stated limit, not evidence
against the scaffold's value elsewhere — the scaffold remains fully
authoritative for constraint/index mechanics (CHECK, UNIQUE, NOT NULL,
FK behavior, partial-index usage), none of which depend on Supabase's own
account-level configuration.

## Teardown verifies comments too — stale-comment incident

Found live, not assumed:
test-db's `hindrances.submitted_via` carried a stale comment from an
EARLIER rehearsal round whose schema-level DOWN had run correctly (the
DEFAULT was back, the column was nullable again) while its own comment
text was never reset alongside it — a teardown that reported clean while
leaving real residue behind.

## DOWN block rehearsed and verified — migration 036/038 incidents

Migration
036's own DOWN failed on first rehearsal for a cascade-ordering reason (an
early draft's `DROP CONSTRAINT` for the pairing CHECK failed because an
earlier `DROP COLUMN` in the same statement had already cascaded it away)
— caught by actually running the DOWN against real Postgres, not by
inspection. Migration 038's DOWN was worse, and "did the schema revert
cleanly" would not have caught it: a first draft dropped the new
`apply_hindrance_flow_turn` and reverted the two modified functions with
zero SQL errors — but rehearsed against a session actively in-flight in
the very flow being removed, it left that session PERMANENTLY STUCK. No
remaining RPC could process it, and the reverted functions no longer
force-reset it either (their own force-reset branch is exactly what the
DOWN just removed). Worse than merely stuck: if the TypeScript routing
layer that dispatches to the now-gone function is still deployed when the
DOWN runs on the database — a real possibility, since a DB rollback and an
app rollback are not the same operation, not a contrived edge case — every
future inbound for that session's phone number hits a hard, uncaught
`function does not exist` error, not a graceful reply, not silence, an
actual crash for that specific phone number.

## Uncommented DOWN block incident — migration 038

migration 038's
first DOWN draft was also left as LIVE, UNCOMMENTED SQL rather than the
inert reference text 036/037 already used — applying the file via
`psql -f` ran the forward migration AND immediately reverted it in the
same batch, caught only by re-running the whole file and noticing the new
function was gone afterward.

## Vitest basename collision investigation

(found 2026-09-02, building the
owner_deliver handler; corrected same day after the first write-up's own
leading theory was tested and disconfirmed). `test/owner-deliver-
dispatch.test.ts` (integration, ~45s) and `test/unit/owner-deliver-
dispatch.test.ts` (unit, ~1ms) shared an identical basename — the
integration file's own line was absent from two consecutive full-suite
runs (not failed, not errored, simply not printed), both landing on an
identical total test count. **The first write-up here asserted the shared
basename as the cause — tested directly with two trivial same-named
scratch files (one deliberately failing) added to the same 75-file suite,
and the collision did NOT reproduce: both lines printed correctly, the
failure was reported.** So basename alone is disconfirmed, not confirmed.
The identical totals across all three real runs (including the one where
the line printed) suggest the tests were likely counted throughout regardless
of whether the line printed — a reporter-display quirk, not a
non-execution one, most likely correlated with the file's own long
runtime, but that specific confound was never isolated either. Full
account: `docs/reviews/vitest-basename-collision.md`.

## Test-db is not confidently rebuildable (2026-08-20 risk finding, whole bullet)

- TEST-DB IS NOT CONFIDENTLY REBUILDABLE — RECORDED ALONGSIDE THE RULE ABOVE, SAME
  FAILURE FAMILY (2026-08-20, migration 029's rehearsal round, checked by direct
  observation, not assumed). Three facts, checked live against test-db
  (`exfccwlrhoutkgrlikod`), not inferred from the account's general tier:
    a. `pitr_enabled: false` — `supabase backups list --project-ref
       exfccwlrhoutkgrlikod` returned it explicitly. No continuous restore window
       exists for test-db, unlike prod's.
    b. Branching is not accessible — `supabase branches list` returned a `403`
       ("account does not have the necessary privileges").
    c. What test-db actually has: nightly physical backups only (`walg_enabled:
       true`), most recent observed ~24h old at any given moment — a snapshot, not
       a point-in-time window.
  Combined with the rule immediately above (a from-scratch replay is ALREADY
  documented as coming up missing `users.auth_id`, root cause still unconfirmed),
  the honest statement is: **test-db today has no reliable recovery path** — not
  "restore to just before the mistake" (no PITR), not "clean rebuild" (the known
  fresh-replay defect), only a stale nightly snapshot. Migration 029's own rehearsal
  survived this only because `dprs`/`daily_log_edits` both happened to be empty at
  the time — a real mistake against populated test-db tables would have had no clean
  way back. Recorded as an input to the open test-db reliability workstream, not
  resolved here — this is a statement of current risk, not a fix.

