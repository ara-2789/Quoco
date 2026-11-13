# 052 MI-KIND-REMOVAL: SQL review package (build block 1 of 2)

**Status: HELD. NOT applied to any database. No database was contacted while writing it. SQL review pending. Tier FULL.**
The SQL has never been executed or parsed by a database. No PG17 dry-run was run in this block (Open questions, item 6).

## Repo-state header
`origin/main` = `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93` (PR #352 and #354 merged, both ancestors). `supabase/migrations/` and the reservations file end at 051; 052 was free. No migration was applied in this block; last runbook executed: 051 prod apply, 28 Oct 2026.

## Pins
| Item | Value |
|---|---|
| Branch | `feat/052-mi-kind-removal` |
| Held-file commit | `a122d30ae836b1da274f742bca57e0d6d7e73d9f` (lint commit before it: `2ca8c33`). The PR head is in the PR body; this file is in the commit after `a122d30`. |
| `docs/reviews/052_mi_kind_deferred.sql` | sha256 `cb5ca25780ddd33be3e23fdea84f6164dbdd480d2f990a3a6c4383eac412ae5d`, 965 lines |
| `docs/reviews/052-down-testdb.sql` | sha256 `378d533c5e8ad800bfed967a28bf5cc4c823d063acd696b92af25376a33e2584`, 573 lines |
| `docs/reviews/052-down-prod.sql` | sha256 `003c0fbf49e081f8f8f7d013d977288b995bef0a3916c92cb9c364a673544910`, 573 lines (differs from the test-db file in 3 header lines only) |
| Plan | `docs/reviews/052-design/kind-removal-plan.md` rev 8.1, sha256 `0cb3bc14afc70e3052d98c7dd75badc510019a4c3e2ae32a0fb9e52c0eeb83ed` |
| Review state | design round 3 = Design GO (conditional); verification pass = GO stands. This SQL has had no review. |
Verify any file with `git show a122d30:<path> | shasum -a 256`.

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
- `s2d-lint-with-held.txt`: with 052 present, Rule 10, Rule 1 (orphan definer), Rule 8 (reservation), the DOWN-commented rule and the 107 exempted are clean. **One finding remains: Open questions, item 2.**

## Pre-052 body provenance (labels as the block specified)
The `body_md5 (pre-052)` lines are in the held file header: `cecc170b26208d4b820402879e020271` apply_material_inward_turn, `b5467b20392b7e26449602acb9da2d00` trg_capture_documents_before_insert, `4a7f470362e0bc7b7687737860d112f4` trg_capture_documents_before_update, "captured with pg_get_functiondef". Label: *prod, per Aravind's SQL editor run 13 Nov 2026 (project identity not observed); equal to test-db `exfccwlrhoutkgrlikod`, observed.* **Precisely:** the body text was read from test-db; the prod paste supplied the md5 only, and that it came from prod is not established. `s2c-down-body-md5.txt`: each of the 3 bodies embedded in each DOWN file hashes to its baseline (6 of 6 EQUAL).

## Open questions (reviewer decision needed)
1. **N-C tripwire wording does not hold as written (stopped on this item, no reading picked).** The plan says "exactly one `INSERT INTO public.capture_documents`" across `supabase/migrations/` and `docs/reviews/*.sql`, column list including `received_at`. Today it sees 4 hits (`3c-tripwire-preview.txt`): 050 (applied; has `kind`, no `received_at`), 052 (held; has `received_at`), and the old 050 INSERT inside each DOWN file (no `received_at`). After promotion it sees 050 + 052 + the two DOWN files. A reading is needed, e.g. "exactly one non-DOWN file whose INSERT carries `received_at`, 050 excepted", or comment-stripped per-file counts with DOWN files excluded. Not written; the test is block 2.
2. **`scripts/shared-fixture-fk-coverage.json` needs one `not-applicable` entry** for `capture_documents.kind_set_by -> users` (a rule with no exceptions mechanism; it hard-fails the lint). That file is outside this block's scope and plan section H does not list it (plan gap). Entry drafted in `fk-coverage-entry-proposed.json`, mirroring `capture_documents.sent_by`. A temporary edit proved lint goes clean with it (`s2d-fk-coverage-finding.txt`; restored afterwards). **Not applied: lint on this branch is red on exactly this one finding until approved.**
3. `apply_material_inward_turn` still returns a `delivery_id` key, now always NULL, so the result contract is unchanged (plan silent). `makeDocWithCaption` throws without it today (block 2 rebuilds it).
4. `mi_kind` stays in `c_mi_keys` and the close clauses (plan silent): it only subtracts a stale key from sessions, harmless, and keeps the diff small.
5. Step 1 is retired as "step IN (1, 2) is read as step 2". A text turn at step 1 now gets the S2 one-re-ask, then close.
6. **No dry-run was possible.** The plan's sequence has a PG17 dry-run from a structure-only dump before SQL review. The block forbade any database connection, and the dump needs the linked project. The SQL is statically reviewed and lint-clean only; a syntax or catalog error would first show at the dry-run.
7. One `v_norm` comment inside the RPC was edited because it named the retired S1 parser (first hunk of the diff).

## Apply GO list (round 3), all OWED AT REHEARSAL, none done
PG17 dry-run from a structure-only dump; privilege matrix incl. anon 42501 and the no-`Content-Profile` 404; measured lock hold (`LOCK TABLE` to `COMMIT`); executed DOWN incl. the seeded unclassified refusal; S5 dark-control record; external probe output immediately before apply; test-db proof of the `FOR UPDATE` key-update claim.
