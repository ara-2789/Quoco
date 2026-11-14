# 052 MI-KIND-REMOVAL: code review package (build blocks 2b and 2c: app code and tests)

**Tier FULL. Status: local commits, one push at the end of the block, PR #355 stays DRAFT, not merged. Block 2a (test-db rehearsal) is in `052-test-db-apply-record.md`. Prod is untouched and has no 052; no prod GO exists.** Block 2c (14 Nov, section at the end) adds `makeDocWithCaption`, the route check, T-K/T-P tests and control re-runs; its evidence is in `docs/reviews/052-code-evidence/b2c/`. Raw evidence: `docs/reviews/052-code-evidence/` (every run file starts with timestamp, HEAD, `git status --porcelain` and the project ref).

## Pins
- Block start `20bd085301b4a9b5d301788f5d8d7345e3f8fcae`; `origin/main` `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93`. The PR head is printed in the PR; the last CODE commit is `1940690` (types); later commits add only docs and evidence.
- **Block 2c pin: `test/helpers/pm-fixtures.ts` IS changed, `makeDocWithCaption` only (plus one import); every other path below is re-proven untouched against `39289b2`: `b2c/step7-untouched-proof.txt`.** Held file `2c4ee3bc…6357e`, `052-down-testdb.sql` `bb21dfe0…907f`, `052-down-prod.sql` `344f4b2e…c43a`: unchanged since the rehearsal. `git diff --stat 20bd085 --` over those three files, `supabase/migrations`, the two lint JSONs, `lint-migrations.mjs`, `.github/workflows`, `pm-fixtures.ts`, six `pm-*` tests, `lib/capture`, `capture-switch.ts` and `app` is EMPTY: `step1c-untouched-proof.txt`.
- Plan `kind-removal-plan.md` rev 8.1 sha256 `0cb3bc14…83ed` (P5 reads with sha256: `p5-reads.txt`). The plan is the specification; differences are listed at the end.
- test-db at the start (P4): ledger tail 052, md5s `e32797b6…`, `4f83a28f…`, `cfcd5925…`, wrapper and helper present: `p4-testdb-state.txt`.

## What changed in app code (commit `99e594d`, then `1940690`)
- `lib/whatsapp/flows/material-inward.ts`: `readKind` deleted; steps 1 and 2 ask `MI_ASK_FILE`, step 3 asks `MI_ACK_QUESTION`; the `start` replies are `MI_ASK_FILE`; the step-1 re-ask is removed; `phoneNumber` leaves `ReplyContext` (its only user was `readKind`).
- `lib/whatsapp/flows/material-inward-strings.ts`: six constants retired (`MI_ASK_KIND`, `MI_KIND_REASK`, `MI_ASK_FILE_DC`, `MI_ASK_FILE_INVOICE`, `MI_ACK_QUESTION_DC`, `MI_ACK_QUESTION_INVOICE`), two added. Exports: **21 before, 17 after**.
- `types/database.ts`: regenerated from test-db; the diff is exactly the 052 hunks (26 insertions, 3 deletions: `types-diff.txt`). `tsc --noEmit` clean with it.
- **delivery_id (SQL review answer 2): no app read of it exists in `lib/` or `app/`.** `applyMaterialInwardTurn` never returned it and no other file reads the RPC result (grep, `step1b-delivery-id-grep.txt`). Removed reads: 0. The only readers were test helpers, now reading it from the classify result.
- The digit-4 allowlist is untouched: `lib/whatsapp/capture-switch.ts` has an empty diff (lines in `step1c-untouched-proof.txt`).

## Strings: two NOT approved (Tamil owed)
`MI_ASK_FILE` = "Send one DC or invoice. A PDF, or photos of all its pages together." `MI_ACK_QUESTION` = the plan's text with its three `\n`. Both carry the comment "Tamil owed, NOT approved". The block text for the second differed from the plan (one line with " / "); Aravind ruled the plan text authoritative. Exact-value test: `test/unit/material-inward-strings.test.ts:52` (asserts the three `\n` and that the one-line form fails). T-STR-1 (`test/capture-handler.test.ts:172`) pins the 15 kept texts and the 2 new; T-STR-2 (`:183`) asserts 17 exports and the six retired names gone. Final approval at PR review.

## Test map (plan id -> file:line)
| Plan id | Where |
|---|---|
| T-E-1 (0 deliveries, 0 links, kind NULL, `delivery_id` key PRESENT and NULL) | `test/capture-engineer-flow.test.ts:47` |
| T-E-1 QE012 on a missing processed_messages row, with a passing control | `capture-engineer-flow.test.ts:87` |
| T-E-2 stray step-1 row read as step 2 (observed: it reports step 1, handled as 2) | `capture-engineer-flow.test.ts:100` |
| S1/N-1/dup/expiry rows rewritten (inventory) | `capture-engineer-flow.test.ts:191, 228, 240` and the N-1, T-A27, T-DATE-1 rows |
| T-C-1, T-C-1b | `test/capture-classify.test.ts:84, 112, 125` |
| T-C-2 | `capture-classify.test.ts:146` |
| T-C-3 (the struck QE012-on-missing-row row is NOT written), incl. 404/406 for the helper | `capture-classify.test.ts:167, 188, 198, 208` |
| S-5 (sender engineer and admin without membership: QE015) | `capture-classify.test.ts:231` |
| T-C-5, T-C-6, T-C-7 | `capture-classify.test.ts:250, 264, 273` |
| T-C-8, T-C-9 (as written: the dedup row deleted, classify succeeds) | `capture-classify.test.ts:288, 304` |
| T-C-4 (CI-only, two callers; NOT a forced interleaving) | `test/capture-races.test.ts:311` |
| T-D8-11 rewritten (pinned normalised headers, alias table, every schema, 4 controls) | `test/capture-files-immutability.test.ts:378-504` |
| S-2 tripwire and its in-test controls | `test/capture-kind-deferred.test.ts:217-290` |
| Session-leak regression | `test/capture-teardown-leak.test.ts:56` |
| T-K-1..4, T-P-1 (plan F lines 105-106; 12 tests, 11 planted-fault controls) | `test/capture-kind-trigger.test.ts` (2c) |
| File route, unclassified PDF (raw 302) and classified control | `test/capture-file-route-unclassified.test.ts` (2c) |
| makeDoc rebuilt (start -> file -> classify as the PM), `classifyAsPm`, `makeUnclassifiedDoc` | `test/helpers/capture-fixtures.ts` |
Every refusal test is paired with a passing call in the same file (task 2e). ~~Not written: T-K-*, T-M-*, T-P-1 (plan F) and the D-30-shaped "engineer_declared" cases~~ [14 Nov: T-K-1..4 and T-P-1 written in 2c]. Still not written, stopped with the plan quoted (section 2c): T-M-1, T-M-2 and the D-30-shaped clause of T-K-2.

## S-2 tripwire: seven controls, each RED then restored (`step3-tripwire-controls.txt`)
Planted file `supabase/migrations/999_planted_control.sql`, never committed; each run prints HEAD and the planted file's sha256 and `git status --porcelain` (empty) after removal. Controls 1 second inserting function, 2 forward INSERT without `received_at` (a later redefinition), 3 MERGE, 4 lowercase unqualified INSERT, 5 dynamic EXECUTE, 6 later DROP (zero sites): each exit 1, RED at the row "THE TRIPWIRE". Control 7 (DOWN files present, nothing planted): GREEN. The reason text per control is asserted by the in-test controls (always on in CI). Limit: the on-disk runs record the failing row, not its message.

## Concurrency test (step 4): option A chosen
Option A chosen by Aravind, 14 Nov. T-C-4 proves one delivery per document under real CI concurrency; it does not force the reverse order. Option C rejected (direct DB credential in CI). **Reviewer question: is A sufficient? If not, B becomes a blocker before the first beta tester.** Background, unchanged: CI has only the Supabase URL and keys, so no second connection can hold a document row lock; the one existing seam, `p_test_sleep_ms`, sleeps while holding the SESSION row lock (`052_mi_kind_deferred.sql:555-557`), not the document row. Option B (not built) would be a test-db-only SQL helper in `scripts/` that locks a fixture document row and sleeps: forces both orders, costs a new database object, a hand apply and an absence-on-prod probe. The rehearsal's 40 runs never showed the second-issued caller winning.

## Session leak (step 5): RED then GREEN (`step5a-leak-RED.txt`, `step5b-leak-GREEN.txt`)
RED on the old teardown: `leaked=1`. Fix in `test/helpers/capture-fixtures.ts` (`teardownCaptureKit`): sessions are deleted FIRST, by tenant and by phone, every later step runs even if one fails, failures are thrown together. GREEN: `leaked=0`. Read-only (5c): the 4 extra users in `zz-outbound-send` are 4 of 2,344 accreted by design: `mintOutboundEngineer` (`test/helpers/outbound-fixtures.ts`) mints per suite and `cleanupOutboundSends` (`:46-50`) deletes only `outbound_sends`, so no teardown owns the users. Unchanged by this block's runs (`c349-*.txt`).

## Runs (raw summaries in the evidence directory)
- Capture family, one process: **23 files, 533 passed, 7 skipped, 0 failed** (`step6a-familyA-capture.txt`). The 7 skips are the existing owner-only and CI-only skips.
- pm-* family: **11 of 12 files green (508 passed); `pm-d30-shapes.test.tsx` RED** because `makeDocWithCaption` in `pm-fixtures.ts` still sends the retired kind turn. Excluded from this block by instruction (do not touch `pm-fixtures.ts` or the pm-* tests); plan S-A says to rebuild it (`step6b-familyC-pm.txt`).
- Lint tests 42 passed. Static (`static-final.txt`): `tsc --noEmit` clean, eslint 0 errors (318 pre-existing warnings), file-size lint clean, fixture-literal lint clean, `lint:migrations` "clean. 107 known violation(s), all exempted."
- #349 counts before and after the runs: IDENTICAL (12 / 18 auth users, 4 `ZZTestCapture-` users, 38 `zz-test-` tenants, 0 invoice-flow sessions): `c349-before-6a.txt`, `c349-after-6a.txt`.
- PR-time mechanical control (S-A, `step6c-mechanical-control.txt`): 45 changed or removed test blocks, 37 FOUND, 8 MISSING; the 8 were added to the inventory with dated notes (T-D8-11 x3, T-STR-1/2, 3 setup-only edits); none is an unexpected meaning change. Inventory marks (131 rows): appended to `052-design/052-tests-changing-meaning.txt`. The marks on unchanged DIRECT rows are rule-based, not reviewed row by row.

## Review items, all rounds
| Item | Status | Evidence |
|---|---|---|
| Design r3 S-A (inventory, `makeDocWithCaption`) | DONE (2c): inventory regenerated and marked; `makeDocWithCaption` rebuilt on the real path; `pm-d30-shapes` RED then GREEN, 11 tests running | `b2c/step1-d30-RED.txt`, `b2c/step1-d30-GREEN.txt`, `b2c/step1-pm-fixtures.diff` |
| Plan F T-K-1..4, T-P-1 | DONE (2c) | `b2c/step3-kind-trigger-GREEN.txt`, `b2c/step3-kind-trigger-controls.txt` |
| Plan F T-M-1, T-M-2, T-K-2 "D-30-shaped row frozen" | STOPPED, plan quoted (section 2c) | none |
| S-B Rule 10 schema-aware, S-D bare names | done in block 1 (`2ca8c33`); 107 exempted | `static-final.txt` |
| S-C, N-A, N-B, N-D | plan edits, landed (verification pass) | plan rev 8.1 |
| N-C / SQL r1 S-2 tripwire | DONE | `step3-tripwire-controls.txt` |
| Verification N-E (`seed`, `fakeKit`) | DONE | `capture-ingest.test.ts`, `capture-fixtures-clock.test.ts` |
| SQL r1 S-1 lint entry guard, S-7 isolated controls | done in block 1 | `052-sql-evidence/` |
| S-3, N-1 (A6 grants, strpos) | landed in the held file | `052-sql-review-package.md` |
| S-4, S-5, N-2, N-5, lock hold, FOR UPDATE | done on test-db in 2a; S-5 also here as tests | `052-test-db-apply-record.md`, `capture-classify.test.ts:231` |
| S-6 (DOWN header, rollback order) | landed in both DOWN headers | held-file diff `a122d30..beb0d21` |
| N-3, N-4, rider on `delivery_id` | recorded | package addendum |
| Answers 1-3 | tripwire as ruled; `delivery_id` kept (T-E-1 asserts present and NULL; no app read exists); FK entry accepted | this package |
| Prod helper probe (`quoco_test_capture_insert` / `_update` IS NULL on prod) | OWED | none yet |

## Differences from the plan, and open points
1. `MI_ACK_QUESTION`: the block text differed from the plan; the plan text was ruled authoritative.
2. ~~S-A: the plan orders `makeDocWithCaption` rebuilt; this block forbids touching `pm-fixtures.ts`. Result: `pm-d30-shapes` is red.~~ [14 Nov: resolved in 2c. The ban was lifted for that one function; it is rebuilt; `pm-d30-shapes` is GREEN, 11 tests.]
3. The plan says "remove every app read of `delivery_id`": none existed.
4. ~~Plan F lists T-K-*, T-M-*, T-P-1: not written here.~~ [14 Nov: T-K-1..4 and T-P-1 written in 2c. T-M-1, T-M-2 and the D-30-shaped clause are stopped: they need the migration to run, or a row no role can create.]
5. A stray step-1 session re-asks with `MI_ASK_FILE` (the plan removes the step-1 re-ask; the RPC reports step 1), not `MI_FILE_REASK`.
6. The leak fix and the T-LEAK test are in the tests commit, not a separate one.

## Owed before prod apply
S5 dark-control record; the external probe immediately before apply; the prod helper probe; prod md5 re-read with the prod ref printed; `to_regnamespace('private')` IS NULL on prod; the count of invoice-flow sessions on prod; Aravind's console confirmation that schema `private` is not exposed; Apply GO; the reviewer's answer on step 4 option A; T-M-1 / T-M-2 (need the migration to run, so they belong to the prod apply rehearsal record); Tamil and final approval of the two strings.

## Block 2c (14 Nov): steps 1 to 6, with evidence (`docs/reviews/052-code-evidence/b2c/`)
1. **`makeDocWithCaption` rebuilt** (start -> file -> classify as the PM; only that function and one import changed; diff `step1-pm-fixtures.diff`). `pm-d30-shapes`: RED before (setup throws, 11 skipped: `step1-d30-RED.txt`), GREEN after (11 passed: `step1-d30-GREEN.txt`).
2. **Unclassified PDF in the file route: NOT a bug.** The route reads the kind at `lib/capture/pm-file-access.ts:222-229` and a NULL kind gives the neutral name `file-<n>.<ext>` (`:131-135`, `resolveDownloadName` `:139`). Plan rev 8.1: "not covered" (no rule on the download name for a NULL kind). Test `test/capture-file-route-unclassified.test.ts`: the unclassified PDF returns **302** with `download=file-1.pdf`; the classified control returns 302 with `download=dc-1.pdf`; after classification the same file downloads as `dc-1.pdf`. Raw status and headers (token masked): `step2-file-route-unclassified.txt`. Route unchanged.
3. **T-K-1..4 and T-P-1 written** (plan lines 105-106): 12 tests GREEN, then 11 planted-fault controls each turn exactly their own test RED (`step3-kind-trigger-controls.txt`; the database cannot be faulted from test code, so a control makes the guarded precondition legal). T-K-4 refusal observed as `QE015`. **Stopped:** T-M-1 ("seed a step-3 `invoice` session, apply: aborts with `APPLY_ABORT_052`") and T-M-2 ("backfill touches exactly the engineer-declared rows") need the migration to run, which a test cannot do on an applied database; the D-30-shaped clause of T-K-2 needs an `engineer_declared` row that no role can create after 052.
4. **Tripwire controls re-run** (`step4-tripwire-controls.txt`): benign control (a `COMMENT ON` an unrelated table) GREEN; the six RED controls each print the assertion message and each names its planted fault (found 2 sites; no `received_at`; found 0 and no live definition); final run GREEN. Unfiltered on the clean tree: 13 tests, 13 passed, 0 skipped (`step4c-tripwire-unfiltered.txt`).
5. **Leak control** (`step5-leak-control.txt`): RED with the old `teardownCaptureKit` from `0f87a02^` (helper sha256 `027230cd…`, `leaked=1`), GREEN with the current one (`91c33f5e…`, `leaked=0`); `git status` empty after the restore.
6. **Step 4 decision:** option A, recorded above.
Step 8 re-runs (capture family, pm-* family, lint tests, tsc, eslint, `lint:migrations`): `step8-*.txt`.
