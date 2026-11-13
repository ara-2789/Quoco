# 052 MI-KIND-REMOVAL: SQL review package (build blocks 1 and 1b of 2)

**Status: HELD. NOT applied to any database (test-db or prod). SQL review round 1: GO (conditional) to the test-db rehearsal, NOT an apply GO. Tier FULL.**
The SQL was executed only on a LOCAL throwaway PG17 built from a structure-only dump of test-db (section "Local dry-run"). The only remote action in block 1b was that read-only dump.

## Repo-state header
`origin/main` = `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93` (PR #352 and #354 merged, both ancestors). `supabase/migrations/` and the reservations file end at 051; 052 was free. No migration was applied in this block; last runbook executed: 051 prod apply, 28 Oct 2026.

## Pins
| Item | Value |
|---|---|
| Branch | `feat/052-mi-kind-removal` |
| Commits | lint `2ca8c33`; held files first cut `a122d30` (= the file SQL review round 1 reviewed); FK entry `75facad`; review round 1 saved `b205e56`; lint entry guard `4e39627`; held-file and DOWN-header edits after the review `beb0d21`. This package, the evidence and the reservation update are in the commit after those; the PR head is in the PR body. |
| `docs/reviews/052_mi_kind_deferred.sql` | sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`, 1000 lines (round 1 reviewed `cb5ca257…ae5d`, 965 lines) |
| `docs/reviews/052-down-testdb.sql` | sha256 `bb21dfe0b7c358c1c36a95a3cc17d457526e9d3dd0e7580da915182cb530907f`, 578 lines (was `378d533c…2584`) |
| `docs/reviews/052-down-prod.sql` | sha256 `344f4b2e5a1fe42c0502a63a47feee9e3980e830adbc2d03a9288610991cc43a`, 578 lines (was `003c0fbf…4910`; differs from the test-db file in 3 header lines only) |
| Plan | `docs/reviews/052-design/kind-removal-plan.md` rev 8.1, sha256 `0cb3bc14afc70e3052d98c7dd75badc510019a4c3e2ae32a0fb9e52c0eeb83ed` |
| Review state | design round 3 = Design GO (conditional); verification pass = GO stands. SQL review round 1 (`docs/reviews/052-sql-review-round-1.md`, verbatim, sha256 `d6f38e7c6321d2f6dd9364037158c9ce17f850920c3111e2e5436802fe7ed915`): GO (conditional) to the test-db rehearsal. **Reviewed WITH CHANGES:** the current held file is the reviewed file plus the round 1 edits, so it is NOT byte-identical to what was reviewed and has not itself been approved. |
| `scripts/shared-fixture-fk-coverage.json` | sha256 `22de09ec744f5fa30a7b44702df190bd98c6b79f9ffe0d9cf8207a69d1bfefab` (one entry added, block 1b) |
| test-db structure dump (not committed) | sha256 `04da3bd4fb2dcfba903d60b29d92e006d9a97d852d9c9fef71a6f7d6c0c73fd4`, 6890 lines |
Verify the held files with `git show a122d30:<path> | shasum -a 256`.

## What the migration does, in order (one transaction)
1. **A0** lock `whatsapp_sessions` EXCLUSIVE (3 s timeout); abort if any `invoice` session exists. 2. **A1/A3** `kind` nullable; add `kind_source`, `kind_set_at`, `kind_set_by`, `received_at`. 3. Backfill `kind_source = 'engineer_declared'` (assertion: none left). 4. **A3b** assert every document has exactly one delivery, copy `received_at` from that delivery, assert none NULL. 5. `received_at` NOT NULL; three CHECKs and the same-tenant FK to `users`. 6. **C** schema `private` (no role privileges); `private.capture_apply_classification` (postgres only); `public.pm_classify_document` (authenticated; PM of the document's project, QE015 otherwise). 7. **A4/A4b** replace the two trigger functions. 8. **B** replace `apply_material_inward_turn` (same signature; the engineer turn makes no kind, no delivery, no self-link). 9. **A6** assertion block. The RPC change, line by line: `052-sql-evidence/rpc-body-diff.txt` (every unchanged line is the captured text).

## Plan rule -> line in the held file (`052_mi_kind_deferred.sql`)
Line numbers are for the first cut (`a122d30`, the file round 1 reviewed). Round 1 edits insert comment lines and an A6 block, so later rows shift by up to 35 lines; `git diff a122d30 beb0d21 -- docs/reviews/052_mi_kind_deferred.sql` shows every insertion.
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
- **Defects found in the held migration or DOWN: none** (block 1b, on `a122d30`).
- **Re-run after the round 1 edits (block 1c, on `beb0d21`, fresh cluster; `dryrun-r1-*.txt`):** every step above repeated with the revised files and passed: apply exit 0, exercise 23 PASS 0 FAIL, refused then executed DOWN (md5s back to `cecc170b…`/`b5467b20…`/`4a7f4703…`), re-apply read-back identical, legacy-data run, both aborts. New: S-5 (the engineer who sent the document, and an admin without PM membership, both QE015, document stays unclassified; an admin who is a PM member is allowed); N-5 lock mode (control: `FOR NO KEY UPDATE` held, session 2 `FOR KEY SHARE` acquired in 1 ms; test: classify uncommitted, session 2 times out; after commit acquired at once: `dryrun-r1-13b`; NOT a test of the two-caller race, which stays owed); S-3 positive control (`dryrun-r1-41`: one table-privilege expectation flipped, `ACL_ASSERT_052: table_grant:authenticated:SELECT table_grant:service_role:SELECT`, no 052 object left); the earlier function-ACL control repeated (`dryrun-r1-40`). The `capture_documents` grants in the dump are SELECT-only for authenticated and service_role, as the new expectations say.
- **Still OWED at the test-db rehearsal (not shown here):** the privilege matrix through the API incl. anon 42501 and the no-`Content-Profile` 404 (roles here are stubs, no PostgREST); the measured lock hold; the `FOR UPDATE` key-update claim and any two-caller race (a local run is not evidence for these); the S5 dark-control record; the external probe before apply; the apply against real prod-shaped data; the ledger row.

## Open questions (reviewer decision needed)
1. N-C wording: **ruled in SQL review round 1, answer 1** (replace it). The ruled specification is in the Addendum below; the tripwire is block 2, before merge.

## Choices made where the plan is silent (accepted in SQL review round 1, answer 2, with conditions in the Addendum)
- The RPC keeps the `delivery_id` result key (always NULL after 052), so the result contract is unchanged; `makeDocWithCaption` throws without it today (block 2 rebuilds it).
- `mi_kind` stays in `c_mi_keys` and the close clauses. Corrected reason (round 1): the source of a stale key is the restored 050 body after a DOWN (it writes `mi_kind` at S1), so a DOWN then re-UP cycle leaves one behind; A0 guarantees none exists at apply. Same for the stray step-1 read.
- A session at step 1 is read as step 2; a text turn there gets the S2 one re-ask, then close.
- One `v_norm` comment in the RPC was edited because it named the retired S1 parser (first hunk of `rpc-body-diff.txt`).
- The pre-052 body text was read from test-db; only its md5 ties it to the prod paste, and that the paste came from prod is not established.

## Apply GO list (round 3), unchanged by round 1
Done LOCALLY only (the test-db rehearsal repeats them): the PG17 dry-run, the executed DOWN incl. the seeded unclassified refusal, the lock-mode half of the FOR UPDATE claim.
OWED AT THE TEST-DB REHEARSAL, none done: privilege matrix through the API incl. anon 42501 and the no-`Content-Profile` 404; measured lock hold (`LOCK TABLE` to `COMMIT`); the two-caller race and the FOR UPDATE proof on test-db; S5 dark-control record; external probe output immediately before apply; plus round 1's S-4, S-5 on test-db, N-2 (both probes) and the prod helper probe (`to_regprocedure('public.quoco_test_capture_insert(text,jsonb)')` and `quoco_test_capture_update` IS NULL on prod).

## Addendum 2026-11-13, after SQL review round 1
Per-item status of every review item (S-1..S-7, N-1..N-5, answers 1-3, the prod helper probe): `052-sql-evidence/review-round-1-status.md`.
- **N-3, cross-references.** Plan rev 8.1 section H names `052-review-package.md`; the file is `052-sql-review-package.md`. `scripts/shared-fixture-fk-coverage.json` is outside plan H (one `not-applicable` entry for `capture_documents.kind_set_by -> users`, commit `75facad`); the reviewer checked the teardown order and accepted it (round 1, answer 3). Plan rev 8.1 is merged and is not edited.
- **N-4, recorded, not fixed.** No index on `capture_documents (kind_set_by, tenant_id)`: a RESTRICT check on a user delete scans the table. Offboarding is deactivation-only.
- **Rider on `delivery_id`.** Drop the key and the dead `v_delivery_id` in the next migration that touches this RPC (in the held file header). Block 2: T-E-1 asserts the key is present and NULL after a file turn, and every app read of it is removed.
- **N-C tripwire, as ruled (block 2, before merge).** Forward set: `supabase/migrations/*.sql` plus every `claimedBy` path in the reservations file (DOWNs fall out as non-forward files). One latest definition per `schema.name` in apply order; a later DROP removes it. Matcher, case-insensitive on comment-stripped text: `(INSERT|MERGE)\s+INTO\s+("?public"?\s*\.\s*)?"?capture_documents"?\b`, and any `EXECUTE` naming `capture_documents` with INSERT or MERGE. Asserts: exactly one hit, inside `public.apply_material_inward_turn`; its column list has `received_at`; the same function holds the `processed_messages` lookup keyed on `p_message_sid`. Also scan `scripts/test-db-only-*.sql` with one named allow-list entry, `quoco_test_capture_insert` (test-db only; absence from prod probed). Seven RED/GREEN controls: a second inserting function; the forward INSERT without `received_at`; a planted `MERGE`; a lowercase unqualified INSERT; a dynamic `EXECUTE`; a later `DROP` of the inserting function (zero sites, RED); a final run with the DOWN files present (GREEN).

## Dated section 2026-11-13: test-db rehearsal (block 2a), COMPLETE
Pins: the held file `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e` and `052-down-testdb.sql` `bb21dfe0b7c358c1c36a95a3cc17d457526e9d3dd0e7580da915182cb530907f` were applied and run unedited. The held file is APPLIED to test-db only (first apply 17:06:30Z to 17:06:34Z, re-apply 18:13:32Z to 18:13:35Z, both exit 0); ledger `052` written by Aravind; NOT applied to prod, no prod GO. Done on test-db: N-2 probes, apply, read-back (md5s equal the post-052 dry-run values), API privilege matrix incl. anon 42501 and the no-`Content-Profile` 404 (the private schema answers `PGRST106`), S-4, S-5, sampled lock hold (at most about 200 ms, then under about 101 ms), `FOR UPDATE` lock-mode proof, a 40-run two-caller race (40 OK, never 0 or 2 deliveries; first-issued caller won every run, so CI verification is owed in block 2), the DOWN (refused over an unclassified document, run after classification, pre-052 md5s, fingerprint and comments hash restored; the DOWN deletes the ledger row), re-apply with read-back equal, teardown with #349 counts equal to the baseline. A prior cleanup removed 50 leaked test `invoice` sessions (authorised by Aravind). Ordering correction: the first DOWN ran before the ledger row and refused on `ledger_052=f`. A push during the rehearsal started a CI run on the shared test-db; its conclusion is not meaningful. Full record and per-item status: `docs/reviews/052-test-db-apply-record.md`.
