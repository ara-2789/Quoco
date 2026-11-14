# 052 SQL review round 1: status of every item (2026-11-13)

Source: `docs/reviews/052-sql-review-round-1.md` (verbatim; verdict: SQL review GO (conditional) to the test-db rehearsal, not an apply GO).
"Held file" = `docs/reviews/052_mi_kind_deferred.sql`. Evidence names are files in this folder.

| Item | Status | Where / what |
|---|---|---|
| Answer 1, N-C wording replaced by the ruled tripwire | OWED in block 2, before merge | Specification recorded in the package addendum; the tripwire is not written. |
| Answer 2, `delivery_id` kept (always NULL) | DONE (rider) + OWED in block 2 | Header rider in the held file. Block 2: T-E-1 asserts the key is present and NULL after a file turn; remove every app read of `delivery_id`. |
| Answer 2, `mi_kind` clearing lists, corrected reason | DONE | Sentence beside `c_mi_keys` and at the stray step-1 read in the held file. |
| Answer 3, FK-coverage entry outside plan H | DONE | Dated line in the package addendum. |
| S-1 lint entry guard | DONE | `scripts/lint-migrations.mjs` (realpath both sides), rule10 test (symlink case), `.github/workflows/ci.yml` (step fails without a verdict line). `s1-entry-guard-red.txt`, `s1-entry-guard-green.txt`, `s1-ci-step-both-ways.txt`. |
| S-2 N-C tripwire with its seven controls | OWED in block 2, before merge | See the package addendum. |
| S-3 A6 table-grant pins | DONE | Held file A6 block (2b). Local run with the real grants passes; positive control flips one expectation: `dryrun-r1-41-positive-control-table-grant.txt`. |
| S-4 helper function-level REVOKE firing | OWED at the test-db rehearsal | GRANT USAGE on schema private in a rolled-back transaction, expect "permission denied for function". |
| S-5 engineer and admin-without-membership refusals | DONE locally; OWED on test-db | `dryrun-r1-13-main-exercise.txt` (M3b): both QE015, document stays unclassified. |
| S-6 DOWN refusal procedure and PR-D2 revert | DONE | Both DOWN headers; new sha256s in the package; `s5-down-header-proof.txt` (executable lines identical). |
| S-7 isolated lint RED evidence | DONE | `s7-isolated-controls.txt` (Rule 10 only, exactly one violation); `s7-attempt1-superseded.txt` (wrong control design, lint was right). |
| N-1 LIKE markers | DONE | Held file A6 section (4), all three markers now `strpos`. |
| N-2 pre-apply probes (`to_regnamespace('private')`; test-db A3/A3b extension) | OWED at the test-db rehearsal | Both probes. |
| N-3 cross-reference drifts | DONE | Package addendum (plan H names `052-review-package.md`; the file is `052-sql-review-package.md`; FK JSON outside plan H). |
| N-4 no index on `(kind_set_by, tenant_id)` | RECORDED, not fixed | Offboarding is deactivation-only. |
| N-5 lock-mode half of FOR UPDATE | DONE locally; two-caller race OWED at test-db | `dryrun-r1-13b-main-lock-test.txt`. |
| Known limits, prod helper probe | OWED at the test-db rehearsal and before apply | `to_regprocedure('public.quoco_test_capture_insert(text,jsonb)') IS NULL` on prod, and the same for `quoco_test_capture_update`; add to the external probe and the post-apply record. |
| Apply GO list (round 3), unchanged | OWED | Privilege matrix through the API (anon 42501, no-`Content-Profile` 404); measured lock hold; FOR UPDATE two-caller race; S5 dark-control record; external probe straight before apply. |
