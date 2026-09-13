# `whatsapp_sessions.user_id` — dangling references found on test-db, unresolved

**Recorded 2026-09-12.** Found incidentally while investigating the
fixture-contamination incident behind Part A's first local test-suite run
(`docs/plans/dpr-owner-pass-regeneration.md`'s Part A PR). Not caused by
Part A, not fixed here — recorded so it has somewhere to live and doesn't
have to be rediscovered from scratch.

## What's confirmed, checked live against test-db (`exfccwlrhoutkgrlikod`), read-only

- **98 of 352 `whatsapp_sessions` rows have a non-null `user_id` that does
  not match any row currently in `users`.**
- **A real foreign key exists on this column**, confirmed by reading
  `001_core_schema.sql:90` directly, not assumed:
  ```sql
  user_id UUID REFERENCES users(id),
  ```
  No `ON DELETE` clause — Postgres default is `NO ACTION`/effectively
  `RESTRICT`: deleting a `users` row while any `whatsapp_sessions` row still
  references it via `user_id` should fail outright.
- **The coverage list this project maintains for exactly this class of
  problem already names this column** — `scripts/shared-fixture-fk-
  coverage.json`'s `whatsapp_sessions.user_id` entry, action `"null"` (null
  it out before deleting the referenced user, rather than deleting the
  session row). Its own note currently reads *"not currently populated by
  any test fixture."* **That note is stale, contradicted directly by the
  code**: `acquire_and_transition_session` and every migration that
  redefines it (012 through 040) writes this column on every real turn —
  `user_id = COALESCE(whatsapp_sessions.user_id, p_user_id)` — so it is
  populated, routinely, by the real application path every test that
  exercises a check-in flow goes through.

## What's genuinely open — not resolved here

Given the FK's `NO ACTION` semantics, a dangling reference should be
structurally impossible under normal operation — the referenced `users`
row's deletion should have been blocked while any session still pointed at
it. 98 real rows exist anyway. Candidate mechanisms, none confirmed:

- A session row created in one test file's run survives (its own
  `cleanupTestSessions()` — matched by `phone_number` prefix, not
  `user_id` — didn't reach it, e.g. a crashed run), and a LATER run's
  `acquire_and_transition_session` call for the **same phone number**
  hits the `COALESCE(whatsapp_sessions.user_id, p_user_id)` branch — which
  only sets `user_id` when it's currently `NULL`, so it would *preserve* a
  stale, non-null value from an earlier run rather than refreshing it.
  This does not, on its own, explain how the *original* referenced user
  was ever successfully deleted while that same session row still pointed
  at it — the coverage-list sweep should have nulled it first. Whether
  `sweepSharedFixtureReferences`'s null-action for this column is actually
  reached, in what order, relative to session creation across files, is
  not traced here.
- Whether the stale-comment ("not currently populated") caused
  `sweepSharedFixtureReferences` to be trusted without ever being verified
  against a real populated row is also untraced.

## Why this wasn't investigated further here

Out of scope for Part A (`docs/plans/dpr-owner-pass-regeneration.md`) —
this column has no relationship to `dprs`/`dpr_versions`/DPR generation at
all. It was not blocking the full-suite re-run that motivated finding it
(0 test failures traced to it in that run). Recorded as a real, live data
hygiene gap for whoever next needs to reason about `whatsapp_sessions`
test fixtures, or about `sweepSharedFixtureReferences`'s actual coverage
versus its own stale documentation.
