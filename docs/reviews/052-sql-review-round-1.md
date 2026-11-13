# 052 MI-KIND-REMOVAL: SQL review, round 1

## Pins and scope

- `feat/052-mi-kind-removal` resolves to `105bf67a056a23d14f4968219e85199d28db6eec`. `main` resolves to `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93`, and the merge-base equals main.
- These hashes at that head match the package:
  - held file `cb5ca257…ae5d`
  - DOWN files `378d533c…2584` (test-db) and `003c0fbf…4910` (prod)
  - plan `0cb3bc14…83ed`
  - FK coverage `22de09ec…fefab`
- The held file and both DOWNs are byte-unchanged since `a122d30`. The two DOWNs differ in their 3 header lines only.
- The zip did not reach me. I reviewed from the branch tree at the head SHA, so I did not check zip sha256 `21f256ff…c2fe6cc56`.
- Read in full: the held file, both DOWN headers, preconditions, drops and closing assertions, plan rev 8.1, the package, the lint diff, the reservation and FK-coverage diffs, the lint evidence, and `dryrun-13`.
- I diffed the RPC body myself, the DOWN's embedded 050 body against `052:506-804`. The changes match `rpc-body-diff.txt` and nothing else changed.

## Answers to your three questions

**1. N-C wording: replace it.** A4b declined an in-database check on `received_at` in favour of this tripwire (plan A4b, round 3 note 2). So the tripwire is now the only guard on the one-insert-path invariant, and it has to be stronger than the proposal. Four gaps:

- **A second insert path exists today.** `scripts/test-db-only-capture-helpers.sql:80-110`, `quoco_test_capture_insert`, does `EXECUTE format('INSERT INTO public.%1$I …')`. `capture_documents` is on its allow-list at `:91`, and service_role can execute it on test-db. A literal regex over `supabase/migrations/` and `docs/reviews/` cannot see it, because it is in `scripts/` and the SQL is dynamic. On test-db, the sentence at `052:448-450` ("the only insert path … no role holds INSERT") is false.
- **`MERGE INTO`.** PG15+ can insert through `MERGE … WHEN NOT MATCHED THEN INSERT`.
- **Other spellings:** unqualified `insert into capture_documents`, quoted identifiers, `AS d` aliases, and a top-level INSERT outside any function, such as a future backfill.
- **"Excluding DOWN files" by name pattern is a hope.** "Latest definition" also has to honour a later `DROP FUNCTION`.

The tripwire to write in block 2:

- **Forward set.** `supabase/migrations/*.sql` plus every `claimedBy` path in `scripts/migration-number-reservations.json`. DOWNs fall out because they are not forward files, not because of their names.
- **Latest definition.** One per `schema.name`, in apply order. A later DROP removes the function from the set.
- **Matcher.** Case-insensitive on comment-stripped text: `(INSERT|MERGE)\s+INTO\s+("?public"?\s*\.\s*)?"?capture_documents"?\b`. Any `EXECUTE` whose text names `capture_documents` together with INSERT or MERGE is also a hit.
- **Assertions.** Across latest definitions plus top-level statements:
  - exactly one hit, and it is inside `public.apply_material_inward_turn`;
  - its column list contains `received_at`;
  - the same function contains the `processed_messages` lookup keyed on `p_message_sid`.
- **`scripts/test-db-only-*.sql`.** Scan these too, with one named allow-list entry for `quoco_test_capture_insert`. Reason: test-db only. Its absence from prod is probed (see Known limits).
- **RED controls, one each, then GREEN:**
  - a second inserting function in a planted held file;
  - the forward INSERT without `received_at`;
  - a planted `MERGE`;
  - a lowercase unqualified INSERT;
  - a dynamic `EXECUTE` naming the table;
  - a planted later `DROP` of the inserting function, which should give zero sites and be RED;
  - a final run with the DOWN files still present, which should be GREEN.

**2. Choices where the plan is silent: accepted, with one corrected reason.**
- **`delivery_id` kept, always NULL: accepted.** The result contract stays stable for the deployed caller while block 2 rewrites it. Conditions:
  - T-E-1 asserts the key is present and NULL after a file turn.
  - Block 2 removes every app read of it.
  - Record a rider: drop the key and the dead `v_delivery_id` (`052:513`) in the next migration that touches this RPC.
- **`mi_kind` in the clearing lists: accepted, but not because of pre-052 sessions.** A0 guarantees no `invoice` session exists at apply. The real source is the restored 050 body after a DOWN, which writes `mi_kind` at S1. A DOWN then re-UP cycle is the case that leaves the key behind. Put that sentence beside `052:525`. The stray step-1 read (`052:611`) has the same reason and is accepted.

**3. FK-coverage entry outside plan H: accepted.** I checked the order myself. `teardownCaptureKit` (`test/helpers/capture-fixtures.ts:229-258`) runs `quoco_test_capture_cleanup` first, which deletes `capture_documents` by tenant (`test-db-only-capture-helpers.sql:164`). The users delete comes after it. Condition: a dated line in the package that names this file as outside plan H. The note in your request is not the record.

## Findings

**S-1. The lint's new entry guard can skip the lint and exit 0.**
- **What breaks.** `lint-migrations.mjs` now runs `main()` only if `fileURLToPath(import.meta.url) === process.argv[1]`. Node realpaths the module URL but not `argv[1]`. I reproduced it on Node 22.23.4: through a symlinked directory the check fails, `main()` is skipped, nothing is printed, and the exit code is 0.
- **Why it matters.** On macOS, `/tmp` is a symlink to `/private/tmp`, and the plan works under `/tmp/quoco`. CI is unaffected today only because the runner path has no symlink. A gate that can be green without running is the "a guard that has never fired is a hope" class, inverted.
- **Fix.** Compare `realpathSync()` of both paths. Make the CI step fail when the terminal `migration-lint:` line is missing.
- **Test.** A rule10 case that runs the script through a symlinked directory and expects the output line. RED before the fix, GREEN after.

**S-2. The N-C scope gap.** Ruled in answer 1. It is graded here so it is tracked: the tripwire is not written, and it must close those four gaps before block 2 merges.

**S-3. A6 does not pin the table grants that the invariants rest on.**
- **What breaks.** "One insert path" and "only definer functions can UPDATE" both depend on `capture_documents` grants (`049:973-979`). A6 checks function ACLs only. `dryrun-13:299` checks service_role only, and only against stub roles.
- **Fix.** Add to A6:
  - `has_any_column_privilege` / `has_table_privilege` for INSERT, UPDATE, DELETE and TRUNCATE false for anon, authenticated and service_role;
  - SELECT true for authenticated and service_role.
- **Why in the file.** A6 runs on prod at apply time, where the platform default ACLs actually exist.
- **Test.** Positive control: flip one table-privilege expectation and expect `ACL_ASSERT_052`.

**S-4. The helper's function-level REVOKE has never been shown to refuse.**
- **What breaks.** Both helper refusals in `dryrun-13` read "permission denied for **schema** private". The schema denial fires first, so the function REVOKE at `052:309-310` has never fired. The A6 check is a catalog reading, not a firing.
- **Fix, at rehearsal.** In a transaction that is rolled back: `GRANT USAGE ON SCHEMA private TO authenticated`, call the helper, expect "permission denied for **function** capture_apply_classification", then `ROLLBACK`.

**S-5. Two refusals named in T-C-3 are missing from the exercise.** Plan T-C-3 lists "engineer" and "admin without PM membership". `dryrun-13` has neither. The engineer case matters most: the sender of the document is the most likely caller and is in the same tenant and the same project. Add both to the rehearsal exercise.

**S-6. The DOWN has no named way out of its refusal, and no app lockstep.**
- **Who resolves the refusal.** Once digit 4 is live, unclassified documents are the normal state, so the refusal is correct and will happen. Nothing names who resolves it. Before PR-D2, the only classifier is the wrapper with a PM JWT, or the helper as postgres.
- **Fix for (a).** Write the procedure into the DOWN header: Aravind opens each unclassified document and calls the helper as postgres with his own PM `users.id`. Each call is recorded in the apply record as a human decision, not a guess.
- **App lockstep.** After PR-D2 deploys, the DOWN drops columns and a function the PM page reads, and the page breaks. Merge is deploy.
- **Fix for (b).** The rollback-order line must start with "revert the PR-D2 deploy". At the moment it names only database files.

**S-7. The lint RED evidence does not isolate Rule 10.**
- **What is wrong.** This goes beyond the "1 violation" limit you already flagged:
  - The "both planted" run in `s1c-red-control-1` has no count line, and `exit=` is blank.
  - 998 and 999 are unreserved, so Rule 8 fires in the same run. The lint is red with or without Rule 10.
  - The 998 file hashes differ between the two transcripts (`88fefe…` vs `0cdb6b…`) with no explanation.
- **Fix.** Re-run with scratch reservation entries for 998 and 999, so Rule 10 is the only possible violation. Capture stdout and stderr, put `echo exit=$?` straight after the run, and record the sha of each planted file. Do this before block 2 merges.

**N-1. LIKE wildcards in the A6 body markers.** In LIKE, `_` matches any character. Positive markers such as `'%NEW.kind_set_by IS NOT NULL%'` (`052:924`) are looser than they read. Use `strpos(v_src, '…') > 0`. Do it in the same edit as S-3.

**N-2. Two gaps in the pre-apply probes.**
- Add `to_regnamespace('private') IS NULL` on both databases. `CREATE SCHEMA private` would abort cleanly, but it spends the apply window.
- Pin test-db's expected extension for A3/A3b before the rehearsal (PROCEED/STOP). The plan pins prod's 5 rows only.

**N-3. Two cross-reference drifts.** Plan H names `052-review-package.md`, but the file is `052-sql-review-package.md`. The FK-coverage JSON is outside plan H. Record both as a dated addendum in the package. Plan rev 8.1 is merged, so do not edit it silently.

**N-4. No index on `(kind_set_by, tenant_id)`.** A RESTRICT check on a user delete scans `capture_documents`. Offboarding is deactivation-only, so record this and do not fix it now.

**N-5. The lock-mode half of the FOR UPDATE claim can be proven locally.** It is Postgres semantics, not environment. While classify holds the row lock, a second session's `FOR KEY SHARE` on the same document should block. Only the two-caller race through PostgREST needs test-db.

## Known limits

I agree with all three. Add one item to the external probe and the post-apply record: `to_regprocedure('public.quoco_test_capture_insert(text,jsonb)') IS NULL` on prod, and the same for `quoco_test_capture_update`.

On prod, `quoco_test_capture_update` would let service_role use the A4 carve-out to write `kind_source='pm'` with any same-tenant `kind_set_by`. That is fabricated PM attribution with no PM gate. The 051 prod types diff (`051-prod-apply-record.md:43`) shows the helpers absent as of 28 Oct. That is indirect evidence, not a probe.

## Credit

- **Assert before copy.** The A3b assertion (`052:137-149`) runs before the `received_at` copy. A document with zero or two deliveries cannot be partly masked by the UPDATE.
- **`received_at` immutability** joins the identity-column IF (`052:393`), not a separate branch, so no ordering can let it change.
- **No raw uid passed on.** The wrapper hands the helper a `users.id`, never `auth.uid()` (`052:361`). Not-found and not-authorised share QE015.
- **Insert-trigger refusal** now covers all four kind columns (`052:465`). Even the test-db dynamic insert helper cannot create an attributed kind.
- **DOWN preconditions check structure before data** (down `:33-60`). A second run, or a run on a database that never had 052, reports what is missing instead of succeeding on nothing.
- **The RPC body diff is exact.** Every non-052 line is the captured text.

## Verdict

**SQL review GO (conditional) to the test-db rehearsal.** No blocking findings. This is not an apply GO.

Before the rehearsal:
1. S-3 and N-1 land in the held file.
2. Record the new sha256.
3. Re-run the local dry-run: apply, the exercise, and a positive control that flips one table-privilege expectation.

The rehearsal must contain:
- S-4, S-5 and N-2;
- the test-helper prod probe above;
- your unchanged Apply GO list: the privilege matrix through the API (anon 42501, the no-`Content-Profile` 404), the measured lock hold, the FOR UPDATE proof and the two-caller race, the S5 dark-control record, and the external probe straight before apply.

Before block 2 merges:
- S-1, S-2 (the tripwire as ruled), and S-7.

Before prod apply:
- S-6 is written into both DOWN headers, which means new DOWN sha256s.
