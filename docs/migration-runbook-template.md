# Migration prod-apply runbook — canonical template

> Created 2026-07-13 from the 016 sign-off round. The per-migration runbook in
> each reviewer package is an instance of this skeleton. Governing rules:
> CLAUDE.md §0 (rollback verified by observation; **artifact provenance is
> pinned, not paraphrased**).

## Provenance rule (mandatory from migration 017 onward)

Every reviewer-package artifact is pinned to its exact source — never retyped,
never summarised:

- **File contents** via `git show <sha>:path`. The SHA is the thing pasted to
  prod; capture the terminal frame with the commands visible for the PR record.
- **Probe captures** with the query text shown directly above its result.
- **Suite output** with the commit SHA echoed at the top of the run.

Paraphrase drifts, and GitHub can serve a stale branch cache to the reviewer; a
pinned `git show` / probe frame is verifiable and cache-proof.

## Strict-alternation apply checklist (wait for owner confirm at each SQL step)

Point the SQL Editor at **prod** (confirm the project ref, not the test-db
branch) before any write step.

- **A. PITR window observation (no SQL).** Dashboard → Database → Backups →
  Point in Time. Observe an active restore window ending ~now. Record the
  timestamp. (§0: verified by observation.) → confirm before B.
- **B. Pre-apply state probe (read-only).** A definition/invariant probe that
  reads the *actual* pre-state (not a bare count), with an explicit PROCEED
  condition and an explicit STOP-on-anything-else. Paste raw output. → confirm
  before C.
- **C. Apply (write).** Fresh tab, full paste of the **pinned** SQL (`git show`
  body, `BEGIN;`…`COMMIT;`), **deselect** (a stray highlight runs "only this"),
  Run. Paste result. → confirm before D.
- **D. Post-apply probes (read-only).** One probe per changed object, query
  visible, expected value stated. Paste each. → confirm before E.
- **E. Ledger repair (write) + verify.** `supabase migration repair --status
  applied <nnn> --linked`, breadcrumb confirmed first — CORRECTED
  2026-08-25: this is the working, preferred method. (An earlier version of
  this line claimed the CLI command was 28P01-blocked and had never been
  executed for this project; that was true once but is stale — `migration
  repair` ran cleanly against both test-db and production during 030's
  apply, no auth error. The manual `INSERT INTO
  supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('<nnn>', '<name>', ARRAY[]::text[]);` stays documented as a fallback
  only, for whichever future session hits a real block on the CLI path.)
  Either way, follow with `SELECT count(*)` to confirm the expected row
  total, and print the full version list.

**Step E is not optional scaffolding.** A reviewer package that widens or
renumbers this skeleton (e.g. into its own S0–S5-style sequence) MUST carry
this step forward under its own numbering, explicitly — dropping it while
restructuring is exactly how migration 030's own apply shipped with no
ledger row on production for a real stretch, caught only by a post-apply
fingerprint someone thought to run, not by the runbook itself. Full
incident: `docs/reviews/030-apply-record.md`'s "Ledger state" section.

- **F. Apply to test-db (write) + ledger repair — a REAL permanent apply,
  NOT a rehearsal apply+DOWN cycle.** Same file, same method (`supabase db
  query --linked -f <file>`, this time against test-db's own project ref),
  immediately after E confirms on prod — not deferred, not left for CI to
  discover. Post-apply readback (same probes as D, re-pointed at test-db)
  + `supabase migration repair --status applied <nnn> --linked` against
  test-db, same as E. **This is not the rehearsal pass** (§0's REHEARSE
  rules, run earlier, against the same test-db, ending in a DOWN that
  restores baseline) — F is what makes the schema change permanent there,
  the same way C makes it permanent on prod.

**Step F is not optional scaffolding, same as E — this is not a new
concern, it is the SAME concern recurring.** A migration rehearsed against
test-db (apply, verify, DOWN — by design, to leave test-db clean for a
review that might reject the file) and then applied to prod ONLY leaves
test-db permanently missing the change, because rehearsal is deliberately
reversible and prod alone is not. CI's `Test (real test-db)` job runs
against this exact persistent, shared project
(`test/setup/guard.ts`'s `ALLOWED_TEST_REF`) with no migration-apply step
of its own (`.github/workflows/ci.yml`'s `test` job never runs one) — it
simply assumes test-db's live schema is current. Skipping F ships a prod
apply that CI cannot see coming: every suite whose shared-fixture teardown
touches the changed table breaks on the next PR, for a reason that has
nothing to do with that PR's own changes. **This has now happened twice.**
First, named but not fixed forward: migration 038's own review package
(`docs/reviews/038-hindrance-flow-review-package.md` lines 159–162) —
"migration 038 isn't applied to test-db, so a live vitest file calling
`apply_hindrance_flow_turn` there would fail CI on every future PR until
it is... Moves into `test/` in the same session that applies 038 to
test-db" — the fix that time was to hold the dependent test file back,
not to add this step to the runbook itself, so the underlying gap
survived. Second, migration 039 (PR #243, 2026-09-08): applied to prod,
promoted, ledgered — test-db never got the same real apply, only its own
earlier rehearsal-and-DOWN — and 16 unrelated CI suites broke on the very
next PR run, all failing identically in shared-fixture teardown
(`sweepSharedFixtureReferences`), none of them touching the migration's
own subject matter. Full incident: this PR's own thread, and
`docs/reviews/039-apply-record.md`. Step F exists so a third instance
does not happen.

## After apply

- schema.md `<nnn>` entry — written **only after E AND F confirm**, so no
  "applied" line is asserted before it is true on BOTH databases (§0). Fold
  any doc-drift fixes the migration touched.
- Record the applied SHA + probe frame in the reviewer package's apply-record.
