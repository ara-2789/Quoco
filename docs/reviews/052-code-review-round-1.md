# 052 MI-KIND-REMOVAL: code review, PR #355

## Verdict

**GO with conditions, for merge only.** Nothing in the app code blocks it. This is not an Apply GO.

## Pins and scope

- Head `6634da338e90f2bdb5a3f5d7701525870c39d2ff` on `feat/052-mi-kind-removal`; base `main` at `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93`.
- The zip did not reach me again, so I reviewed from the branch tree at the head SHA.
- I could not open Actions run 43552630965 from here, so "CI green on that head" is unverified by me.
- **Read in full:** the app diff (`material-inward.ts`, strings, `types/database.ts`), the lint and CI-step diff, the tripwire, T-C-4, the T-K/T-P-1 file, the fixture and teardown diff, the leak test, the package, and rehearsal steps 5.0 and 5.
- **SQL:** unchanged since the rehearsal (`20bd085..HEAD` is empty over the three files). It is not unchanged since round 1: I reviewed `cb5ca257…`, and the current file is `2c4ee3bc…`. The delta is `beb0d21`, the edits I asked for (A6 table grants, `strpos`, comments, DOWN headers). I read it, and no executable line of the RPC changed.

## Answers

**1. Option A is sufficient. Option B is not a blocker.**
- **The callers are symmetric.** Both run the same function, so the reverse order is not a separate code path.
- **Integrity does not rest on the lock.** Without `FOR UPDATE`, the loser still fails: the trigger refuses a change to a set kind (QE009), or the UNIQUE delivery pointers refuse the second delivery (23505, `049:371-372`). The lock only decides which answer the loser gets.
- **The wait is already proven on test-db.** In rehearsal 5.0a a PostgREST classify call waited 6.6 s behind a held row lock and then completed. 5.0b showed the lock mode, and 40 of 40 race runs overlapped and ended with one delivery.
- **Condition:** finding 2.

**2. The frozen-row argument is accepted, for a different reason.** The freeze branch (`052:402-408` at round-1 numbering) fires when any OLD kind column is set. It never reads `kind_source`, so the QE009 loop in T-K-2 on a `pm` row runs the same lines an `engineer_declared` row would. Two conditions:
- One recorded call on test-db against one of the 51 leaked rows before they are cleaned: `quoco_test_capture_update` setting `kind_set_by`, expecting QE009. This is one-off evidence, not a CI test.
- Finding 5.

**3. Rule-based marks are accepted; no row-by-row pass is needed.** "Text unchanged and passes" proves there was no edit, not that the meaning held, so I sampled the 26 rows.
- I read T-A27-8, N8 and T-D1-1. Each asserts something that does not depend on the kind step.
- I searched the capture family for two ways a test could go vacuous. No test still seeds `mi_kind` or a step-1 invoice session as a live premise. One test uses "0 deliveries" as proof that nothing was written (`capture-router.test.ts:304`), and it sits beside a zero-documents count.
- Record these two patterns in the inventory as the basis for the marks.

**4. Enough, if named correctly.** These controls prove the assertion can fail. They are not mutation controls on the database, and the package should not call them that. The database-side fault is covered by the dry-run positive control and A6.

**5. Finding 1 is the one merge gate.**

## Findings

1. **S, merge gate: the dark-control record is owed before the merge, not before the apply.**
   - Package line 87 lists it under "owed before prod apply". Plan R step 1 puts it before the merge, because merge is deploy.
   - If the allowlist is still on, the new app runs against the 050 body. A "4" lands on step 1, the app asks for the file, 050 does not accept a file at step 1, and the flow re-asks and closes.
   - Nothing is written, but digit 4 is dead on that phone until apply.
   - Fix: attach the Vercel listing, the deployment id and the "4" reply to the PR before merging.

2. **S: T-C-4 races one PM against itself.**
   - Both callers use the same `pm1` client, so the test cannot see whose attribution was stored.
   - Fix: use `admMem` (a PM member of P1) as the second caller, and assert `kind_set_by` equals the caller who got `already_classified=false`.

3. **S: the T-K-4 refusal code is not pinned.**
   - `capture-kind-trigger.test.ts` asserts `not.toBeNull()` and logs the code, so any error passes, including a network failure.
   - Fix: assert `QE015`, the code you observed.

4. **S: the "before" half of T-P-1 proves nothing about 052.**
   - A random UUID returns QE015 with or without the migration.
   - Fix: assert the unclassified document has 0 deliveries before the calls, and keep the rest.

5. **S, rider on PR-D2: no fixture produces an `engineer_declared` row any more.**
   - `makeDoc` and `makeDocWithCaption` now classify as the PM, so `pm-d30-shapes` only renders `pm` rows.
   - Prod's 5 real rows are `engineer_declared` with NULL `kind_set_by` and `kind_set_at`.
   - Fix: PR-D2 carries a render test on a literal row of that shape.

6. **N: a stray step-1 re-ask replies `MI_ASK_FILE`, not `MI_FILE_REASK`.** Accepted as recorded (your difference 5). It is only reachable after a DOWN then re-UP.

7. **N: the tripwire does not watch grants.** A later migration that grants INSERT or UPDATE on `capture_documents` opens a second path, and A6 only runs at the 052 apply. Add a `GRANT … ON … capture_documents` matcher next time the file is touched.

8. **N: package corrections, as dated lines.**
   - "Unchanged since SQL review round 1" should read "unchanged since the rehearsal; changed once after round 1 by `beb0d21`".
   - The string comments still say "NOT approved". Update them with the 14 Nov approval; Tamil is still owed.

## Credit

- The tripwire picks its forward set by membership, and control 7 proves the DOWN files would fail it if they were forward.
- The private-helper test asserts 404 and 406 through the raw path, then proves the same call shape works on the public wrapper.
- The teardown now deletes sessions first and runs every step. The leak test fails the cleanup RPC on purpose and still finds zero sessions.
- T-E-1 asserts the `delivery_id` key is present and NULL, as ruled.

## Conditions

**Before merge:**
- Findings 1, 2, 3, 4 and 8.
- The T-C-4 `[race-diag]` lines from the CI run on the final head, added to the evidence folder with the `headSha`.
- No new round is needed. Send the new head SHA and I will confirm the diff.

**Before prod apply (your list, unchanged, plus two):**
- The one-off frozen-row call on test-db (answer 2).
- A verification pass on the 13 Nov rehearsal record, which I have not done here.
