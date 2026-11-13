# 052 MI-KIND-REMOVAL: SQL review package (build blocks 1 and 1b of 2)

**Status: HELD. NOT applied to any database (test-db or prod). SQL review pending. Tier FULL.**
The SQL was executed only on a LOCAL throwaway PG17 built from a structure-only dump of test-db (section "Local dry-run"). The only remote action in block 1b was that read-only dump.

## Repo-state header
`origin/main` = `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93` (PR #352 and #354 merged, both ancestors). `supabase/migrations/` and the reservations file end at 051; 052 was free. No migration was applied in this block; last runbook executed: 051 prod apply, 28 Oct 2026.

## Pins
| Item | Value |
|---|---|
| Branch | `feat/052-mi-kind-removal` |
| Commits | lint `2ca8c33`; held files `a122d30ae836b1da274f742bca57e0d6d7e73d9f` (unchanged since); test fix `a63370e`; FK coverage entry `75facad`. This package and the dry-run evidence are in the commit after those; the PR head is in the PR body. |
| `docs/reviews/052_mi_kind_deferred.sql` | sha256 `cb5ca25780ddd33be3e23fdea84f6164dbdd480d2f990a3a6c4383eac412ae5d`, 965 lines |
| `docs/reviews/052-down-testdb.sql` | sha256 `378d533c5e8ad800bfed967a28bf5cc4c823d063acd696b92af25376a33e2584`, 573 lines |
| `docs/reviews/052-down-prod.sql` | sha256 `003c0fbf49e081f8f8f7d013d977288b995bef0a3916c92cb9c364a673544910`, 573 lines (differs from the test-db file in 3 header lines only) |
| Plan | `docs/reviews/052-design/kind-removal-plan.md` rev 8.1, sha256 `0cb3bc14afc70e3052d98c7dd75badc510019a4c3e2ae32a0fb9e52c0eeb83ed` |
| Review state | design round 3 = Design GO (conditional); verification pass = GO stands. This SQL has had no review. |
| `scripts/shared-fixture-fk-coverage.json` | sha256 `22de09ec744f5fa30a7b44702df190bd98c6b79f9ffe0d9cf8207a69d1bfefab` (one entry added, block 1b) |
| test-db structure dump (not committed) | sha256 `04da3bd4fb2dcfba903d60b29d92e006d9a97d852d9c9fef71a6f7d6c0c73fd4`, 6890 lines |
Verify the held files with `git show a122d30:<path> | shasum -a 256`.

## What the migration does, in order (one transaction)
1. **A0** lock `whatsapp_sessions` EXCLUSIVE (3 s timeout); abort if any `invoice` session exists. 2. **A1/A3** `kind` nullable; add `kind_source`, `kind_set_at`, `kind_set_by`, `received_at`. 3. Backfill `kind_source = 'engineer_declared'` (assertion: none left). 4. **A3b** assert every document has exactly one delivery, copy `received_at` from that delivery, assert none NULL. 5. `received_at` NOT NULL; three CHECKs and the same-tenant FK to `users`. 6. **C** schema `private` (no role privileges); `private.capture_apply_classification` (postgres only); `public.pm_classify_document` (authenticated; PM of the document's project, QE015 otherwise). 7. **A4/A4b** replace the two trigger functions. 8. **B** replace `apply_material_inward_turn` (same signature; the engineer turn makes no kind, no delivery, no self-link). 9. **A6** assertion block. The RPC change, line by line: `052-sql-evidence/rpc-body-diff.txt` (every unchanged line is the captured text).

## Plan rule -> line in the held file (`052_mi_kind_deferred.sql`)
| Plan rule | Lines | Plan rule | Lines |
|---|---|---|---|
| A0 lock + invoice abort | 74-87 | C wrapper, authorise before lock, QE015 both cases | 316-368 |
| A1 `kind` nullable | 96 | C helper, FOR UPDATE, derive from locked row | 199-309 |
| A2 FKs unchanged | comment 90-94, no SQL | C step 2 `already_classified` / QE011 | 235-259 |
| A3 columns | 98-102 | C result: 5 keys on both paths | 255-259, 300-306 |
| A3 `kind_source` backfill + assertion | 110-127 | C never reads `processed_messages` | comment 267-269; none in SQL |
| A3b one-delivery assertion, copy, no-NULL | 137-166 | S status from the ack, under the lock | 292-297 |
| A3 CHECKs (provenance, order, received) | 171-180 | A4 trigger, carve-out, `received_at` immutable | 377-440 |
| A3 FK `kind_set_by`, RESTRICT both | 184-188 | A4b insert refuses the four columns | 452-476 |
| A5 the 5 D-30 rows stay `engineer_declared` | 110-112 + 399-414 | B start at 2, step 1 retired | 587, 611-613 |
| `private` schema, no role privilege | 195-196 | B create block: `received_at`, no delivery | 716-727 |
| Grants: helper, wrapper, 2 triggers, RPC | 309-311, 365-367, 440-442, 476-478, 807-809 | B lookup + QE012 refusal unchanged | 710-721 |
| A6 per-name counts, all non-system schemas | 833-851 | A6 ACL matrix, schema USAGE, constraints, body markers | 852-927 |
| DOWN refuses over unclassified | `052-down-*.sql:57` | DOWN restores 3 bodies, md5 re-read | `052-down-*.sql:69-481`, `538-548` |
Not in this file, by design: **D** app/strings/types, **F** tests (incl. T-D8-11 and the N-C tripwire), fixtures, **H** test files: block 2. **R** rollout and **4a-4d** policy: apply-time and PR-D. Private-schema non-exposure (404 / 42501 through PostgREST) and the `FOR UPDATE` key-update claim: owed at the test-db rehearsal.

## Lint proofs (Rule 10 schema-aware, S-B/S-D), in `052-sql-evidence/`
- `s1a-baseline.txt`: the untouched tree prints `107 known violation(s), all exempted.`
- `s1c-proofs-1-2.txt`: `git diff --stat origin/main -- scripts/migration-lint-exceptions.json` is empty; lint still 107.
- `s1c-red-control-1-private.txt`: a planted later file redefining `private.capture_apply_classification` with no `body_md5` line is flagged, key `uncaptured-redefinition-private.capture_apply_classification`; the first-definition file alone is not a Rule 10 hit.
- `s1c-red-control-2-public.txt`: a planted `public.apply_material_inward_turn` redefinition is flagged with the BARE key (old behaviour intact). Planted files removed, tree clean.
- `s1c-lint-test.txt`: `test/unit/lint-migrations-rule10.test.ts`, 11 tests pass.
- `s2d-lint-with-held.txt` (block 1): with 052 present, one finding, the FK coverage entry. `s1-lint-after-fk-entry.txt` (block 1b): after that entry, `migration-lint: clean. 107 known violation(s), all exempted.`

## Pre-052 body provenance (labels as the block specified)
The `body_md5 (pre-052)` lines are in the held file header: `cecc170b26208d4b820402879e020271` apply_material_inward_turn, `b5467b20392b7e26449602acb9da2d00` trg_capture_documents_before_insert, `4a7f470362e0bc7b7687737860d112f4` trg_capture_documents_before_update, "captured with pg_get_functiondef". Label: *prod, per Aravind's SQL editor run 13 Nov 2026 (project identity not observed); equal to test-db `exfccwlrhoutkgrlikod`, observed.* **Precisely:** the body text was read from test-db; the prod paste supplied the md5 only, and that it came from prod is not established. `s2c-down-body-md5.txt`: each of the 3 bodies embedded in each DOWN file hashes to its baseline (6 of 6 EQUAL).

## FK coverage entry (resolved, block 1b)
`capture_documents.kind_set_by -> users` got one `not-applicable` entry in `scripts/shared-fixture-fk-coverage.json` (commit `75facad`, 7 inserted lines). Basis, read from the code: the lint has no definition of `not-applicable`; the only consumer is `sweepSharedFixtureReferences` skipping it (`test/helpers/db.ts:359`). PM test users exist only in `zz-test-capture-` tenants (`buildCaptureKit`); `teardownCaptureKit` (`test/helpers/capture-fixtures.ts:229-258`) runs `quoco_test_capture_cleanup` (deletes `capture_documents`) before it deletes `project_members`, `projects` and `users`, so a `kind_set_by` RESTRICT pointer cannot block a PM user's delete. Shared-tenant users never classify a document (the wrapper needs a PM member of the document's project).

## Local dry-run (block 1b). LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST
Method as 050/051: read-only `supabase db dump --linked --schema public --dry-run` script, run read-only (`3b-dump-record.txt`: project ref `exfccwlrhoutkgrlikod`, credential scan 0, the dump carries 051's objects and no 052 object), loaded into a fresh PG17.11 cluster with named stubs (roles, `auth.users`/`auth.uid()`, pgvector, a ledger table). 0 load errors. Raw output: `dryrun-*.txt`; SQL and runner: `dryrun-src/`.
- **Baseline:** the loaded scaffold's three function bodies hash to `cecc170b…`, `b5467b20…`, `4a7f4703…` (an independent check of the baselines).
- **Apply (main db):** one transaction, exit 0, post-condition block passed. Read-back: owner postgres, SECURITY DEFINER, `search_path=""` on both new functions; helper callable by no role, wrapper by `authenticated` only, RPC by `service_role` only; schema `private` closed to all three roles; 4 columns, 4 constraints, `kind` nullable, `received_at` NOT NULL.
- **Exercise (22 PASS, 0 FAIL, `dryrun-13`):** engineer turn: start at step 2, file creates a document with `received_at` = the SID's `processed_messages.created_at`, kind NULL, 0 deliveries, 0 links, 1 ingest job; stray step-1 session read as step 2; text at step 2 re-asks once then closes. Classify: refused with QE015 for other-project PM, qs, deactivated PM, other-tenant PM, no auth uid, unknown id, NULL id; QE012 for a bad or NULL kind; 42501 for anon and service_role on the wrapper and for authenticated and service_role on the helper; success creates 1 delivery (`reported_by` = engineer, `received_at` = the document's, `awaiting_pm` when the ack came first), an invoice also 1 active self-link; second call `already_classified: true` with both ids, other kind QE011; classify-then-ack moves the delivery to `awaiting_pm`; no jobs and no outbound sends from classify. Owner-level triggers: QE009 on a kind, `kind_set_by` or `received_at` change, on `engineer_declared` by UPDATE, on a kind without `kind_set_by`; QE012 on an INSERT carrying a kind; 23502 / 23514 on a missing / future `received_at`; 23503 for a delivery on an unclassified document; a caller-supplied `kind_set_at` is overwritten.
- **DOWN:** with an unclassified document present: `DOWN_PRECONDITION_052_UNCLASSIFIED`, state unchanged (`dryrun-15`). After a PM classified it: DOWN exit 0; md5s equal `cecc170b…` / `b5467b20…` / `4a7f4703…`; all 052 objects gone, `kind` NOT NULL again; the invoice session cleared and an unrelated context key kept; rows kept.
- **Re-apply:** exit 0; read-back identical to the first. (The 3 classified documents became `engineer_declared`: the DOWN's named consequence, attribution is lost.)
- **Legacy data (`dryrun-20`):** 2 seeded pre-052 rows (a DC and an invoice with delivery and self-link): backfills ran on real rows (`engineer_declared`, `received_at` equals each delivery's), classify returns `already_classified` with both ids, DOWN over them clean.
- **Aborts, nothing left behind:** an invoice session -> `APPLY_ABORT_052` (applies once removed); a document with no delivery -> `BACKFILL_ASSERT_052` (`dryrun-30`, `-31`).
- **Positive control (`dryrun-40`):** a scratch copy with one expected value flipped (the wrapper's `authenticated` EXECUTE true -> false) aborts with `ACL_ASSERT_052: pm_classify_document:authenticated` at the final block and leaves no 052 object (md5s back to baseline).
- **Defects found in the held migration or DOWN: none.** The held files are unchanged (sha256 above).
- **Still OWED at the test-db rehearsal (not shown here):** the privilege matrix through the API incl. anon 42501 and the no-`Content-Profile` 404 (roles here are stubs, no PostgREST); the measured lock hold; the `FOR UPDATE` key-update claim and any two-caller race (a local run is not evidence for these); the S5 dark-control record; the external probe before apply; the apply against real prod-shaped data; the ledger row.

## Open questions (reviewer decision needed)
1. **N-C wording.** "Exactly one `INSERT INTO public.capture_documents` across `supabase/migrations/` and `docs/reviews/*.sql`" sees 4 hits: `supabase/migrations/050_material_inward_functions.sql:322` (the applied 050 forward definition: has `kind`, no `received_at`); `docs/reviews/052_mi_kind_deferred.sql:724` (the held 052 forward definition: has `received_at`); `docs/reviews/052-down-testdb.sql:314` and `docs/reviews/052-down-prod.sql:314` (the old 050 body restored by each DOWN: has `kind`, no `received_at`). Proposed reading, for the reviewer to confirm or replace: the tripwire reads the LATEST forward definition of every function (highest-numbered migration or held file that defines it; DOWN files and superseded definitions excluded) and asserts (a) exactly one function inserts into `public.capture_documents`, (b) that function contains exactly one such INSERT, (c) its column list includes `received_at`. The tripwire is written in block 2 after the reviewer answers.

## Choices made where the plan is silent
- The RPC keeps the `delivery_id` result key (always NULL after 052), so the result contract is unchanged; `makeDocWithCaption` throws without it today (block 2 rebuilds it).
- `mi_kind` stays in `c_mi_keys` and the close clauses: it only subtracts a stale key from sessions.
- A session at step 1 is read as step 2; a text turn there gets the S2 one re-ask, then close.
- One `v_norm` comment in the RPC was edited because it named the retired S1 parser (first hunk of `rpc-body-diff.txt`).
- The pre-052 body text was read from test-db; only its md5 ties it to the prod paste, and that the paste came from prod is not established.

## Apply GO list (round 3)
Done LOCALLY only (see "Local dry-run"; the test-db rehearsal repeats them): the PG17 dry-run from a structure-only dump; the executed DOWN incl. the seeded unclassified refusal.
OWED AT THE TEST-DB REHEARSAL, none done: privilege matrix through the API incl. anon 42501 and the no-`Content-Profile` 404; measured lock hold (`LOCK TABLE` to `COMMIT`); S5 dark-control record; external probe output immediately before apply; test-db proof of the `FOR UPDATE` key-update claim.
