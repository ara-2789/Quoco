# 052 MI-KIND-REMOVAL: Apply GO ruling

## Verdict

**Apply GO (conditional)**, prod `jvxwqignooseazzmwhvl`, file `docs/reviews/052_mi_kind_deferred.sql` sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`.

The zip did not reach me, for the third time. I have not seen `apply-go-request.md`, `p0-probes.txt`, `p0-capture-documents.txt` or `d-frozen-row-testdb.txt`. The conditions below are written so the apply stops if those raw values are not what you reported. Commit the package to the repo with the apply record, since the repo is what I can read.

## Pins

- `main` is `8e90cb5a357f1a41074874203a6f8c4a8d4f0448`, parents `f007f61…` and `a077bd0…`. Its tree equals the tree of `a077bd0` (`cbd99d72…`), so the merged code is the code I confirmed.
- I could not open CI run 43565517165.
- `052-down-prod.sql` is `344f4b2e…`. It differs from the rehearsed `052-down-testdb.sql` (`bb21dfe0…`) in the three header lines only.
- `supabase/migrations/` tops out at 051. The number 052 is still free.

## Your questions

**Pre-052 md5s.** The apply file header (lines 26-28) and the prod DOWN header both carry:
- `cecc170b26208d4b820402879e020271` apply_material_inward_turn
- `b5467b20392b7e26449602acb9da2d00` trg_capture_documents_before_insert
- `4a7f470362e0bc7b7687737860d112f4` trg_capture_documents_before_update

Your three values match on the first 8 and last 4 characters. The middle 20 I cannot check without the probe file; condition 2 closes that.

**T-M-1 abort half: the scaffold evidence is enough.**
- A0 sits at lines 79-88 of the file, before the first DDL at line 100. An abort there has nothing to undo.
- It is a count and a RAISE. It does not depend on roles, grants or the API, which are the things a local scaffold cannot show.
- `dryrun-r1-30` shows it: exit 3 with `APPLY_ABORT_052: invoice sessions exist: 1`, the three md5s still pre-052, no 052 object, then exit 0 once the session is cleared.
- Proving it on prod would mean seeding a fake session there. That is worse than the gap.

**Dark-control waiver: accepted.** The dark reply at 12:31 IST on the merged deploy is the behaviour the gate exists for. The listing and deployment id were corroboration. Conditions 2 and 3 cover the remaining risk.

**Item 7: agreed, with one check.** `received_at` is copied from each document's delivery. The P0 file must therefore hold `deliveries.received_at` per document for the 5 rows. If it holds only `capture_documents` columns, re-take it before apply (condition 2).

## Verification pass on the 13 Nov rehearsal record

The record matches the raw files. I spot-checked these against the evidence:
- **Target:** every call printed `exfccwlrhoutkgrlikod`.
- **Privilege matrix:** anon 401 with 42501; helper 404 `PGRST202` without a profile and 406 `PGRST106` with `private`; engineer and admin-without-membership both `QE015`; service_role INSERT, UPDATE and DELETE each 403 with 42501.
- **S-4:** with schema USAGE granted inside a rolled-back transaction, the refusal reads "permission denied for function". The schema ACL and fingerprint were unchanged after.
- **S-3:** the flipped table-grant expectation aborts with `ACL_ASSERT_052` (`dryrun-r1-41`).
- **DOWN:** refused on one unclassified document with state identical; after the classify it restored the three pre-052 md5s and the baseline fingerprint. The re-apply read back equal.
- **Lock hold:** a sampled bound of about 200 ms at most. It is not a timed value, and the record says so.

Two properties the rehearsal found carry into the prod runbook: the DOWN requires the 052 ledger row, and it deletes that row.

## Conditions

1. **Window.** Outside 08:25-08:40, 18:25-18:40 and 23:15-00:15 IST. One foreground run, no retry on failure.

2. **External probe immediately before apply.** Print the prod ref. Stop on any miss:
   - the three md5s equal the header values on all 32 characters;
   - 0 sessions with `current_flow = 'invoice'`;
   - `to_regnamespace('private')` is NULL, and both 052 function names are absent in every schema;
   - `quoco_test_capture_insert` and `quoco_test_capture_update` are absent;
   - exactly 5 documents, each with exactly one delivery, matching plan A3's pinned rows;
   - the P0 file holds each document's delivery `received_at`;
   - sha256 of the file is `2c4ee3bc…357e`.

3. **No Vercel change** between the probe and the apply. `CAPTURE_DIGIT4_TEST_PHONES` stays absent until PR-D2 is live.

4. **If the apply exits non-zero:** stop and record the error text and the three md5s. Do not re-run and do not run the DOWN. An in-file abort leaves nothing behind.

5. **Ledger row straight after exit 0:** `migration repair --status applied 052`, then observe it by query. The DOWN refuses without it.

6. **Post-apply read-back, raw, with the prod ref printed:**
   - post-052 md5s `e32797b63fee8fceca1934be700609c3`, `4f83a28f16956ebae830361c4f898899` and `cfcd59258a5039acc395dd8136328ca5`, the test-db values;
   - `pg_proc` count is exactly 1 for each of the five function names;
   - the EXECUTE matrix, the `private` schema ACL and the `capture_documents` table grants equal the test-db read-back;
   - your item 7 check on the 5 rows, plus delivery and link counts unchanged from P0.

   If an md5 differs, stop and report. Do not DOWN on reflex.

7. **Two refused calls through the prod API.** Exposed schemas are a per-project setting, so test-db does not prove this for prod.
   - anon calling `pm_classify_document` gets 42501;
   - the helper gets 404 without a profile and 406 with `Content-Profile: private`.

8. **Promotion.** Move the file into `supabase/migrations/` as 052 with a dated header note. Re-check the number at that moment. Regenerate types and diff against the merged `types/database.ts`; the diff should be empty.

9. **Rollback order, if ever needed:** revert the PR-D2 deploy if live, then `052-down-prod.sql` (`344f4b2e…`). It needs the ledger row and removes it.

## Closes after apply

- The apply record with the raw output of conditions 2, 5, 6 and 7, plus the apply-go package files, for my confirmation pass.
- The first PM classification of a real unclassified document on prod after PR-D2. That is the first live observation and the closing artifact for 052.
