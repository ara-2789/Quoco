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
- **E. Ledger INSERT (write) + verify.** Manual
  `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('<nnn>', '<name>', ARRAY[]::text[]);` then `SELECT count(*)` to confirm
  the expected row total. (The CLI `migration repair` is 28P01-blocked for this
  project and has never been executed — the manual INSERT is the real method.)

## After apply

- schema.md `<nnn>` entry — written **only after E confirms**, so no "applied"
  line is asserted before it is true (§0). Fold any doc-drift fixes the migration
  touched.
- Record the applied SHA + probe frame in the reviewer package's apply-record.
