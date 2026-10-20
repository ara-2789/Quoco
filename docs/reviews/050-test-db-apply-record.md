# 050 test-db apply record -- COMPLETE

Date 19 Oct 2026 (blocks 13 and 14). Target: test-db, ref `exfccwlrhoutkgrlikod` ONLY (printed before every database command; prod `jvxwqignooseazzmwhvl` never touched). FULL tier. Branch `feat/050-material-inward-fns`.
Raw log of every command and its output: `docs/reviews/050-test-db-apply/block-13-raw-log.txt` (copied from `/tmp/quoco/pr-b-block-13.txt`). The queries (`q-*.sql`) and the two node scripts (`anon-refusals.mjs`, `down-seed.mjs`: host and key claims checked before any call, keys never printed) are beside it.

## Final state (observed 19 Oct, after the re-apply)

- 050 is applied to test-db; the in-file assertion block passed twice (first apply, re-apply), each time with exit 0.
- Nine functions, one `pg_proc` row each, `prosecdef` true, owner postgres. Seven new: `proconfig {"search_path=\"\""}`; `apply_material_inward_turn` and `expire_stale_material_inward` ACL `{postgres=X/postgres,service_role=X/postgres}`; the five `pm_*` ACL `{postgres=X/postgres,authenticated=X/postgres}`.
- Replaced `apply_morning_flow_turn` md5 **`cf2e78881f03d4e03a0dc51fd9b6008e`** and `apply_evening_flow_turn` md5 **`9987ab905a5563f94f9226445fbcef8b`** (the same values after the first apply and after the re-apply: reproducible). `proconfig {search_path=public}`, ACL `{postgres=X/postgres,service_role=X/postgres}`, equal to the pre-apply reading.
- Ledger: `049 capture_tables 59` and `050 material_inward_functions 31`. `supabase migration list`: 46 entries, the last `{"local":"","remote":"050"}` (local empty because the main tree, which must not change, has no 050 file; the 050 SQL stays in `docs/reviews/` until the prod apply, as 049's did).
- `current_flow='invoice'` sessions: 0. Seed rows: none left.

## Observed vs reported

| Step | Result | Source |
|---|---|---|
| 0. review r2 | sha256 `24651560c93f96108f91be01f2fbc816f7a98a7dcf17622c81a778a9c57fd890` = expected; copied verbatim to `docs/reviews/050-sql-review-round-2.md` | observed |
| 1. ref | `exfccwlrhoutkgrlikod` printed before every database command | observed |
| 2. **S-4 probe** (reviewer's exact query: engineers whose membership role is not `engineer`) | **0 rows** | observed, raw log |
| 3. pre-apply | live md5 morning `707c10fe09dfd5a7cd065f7826eacd46`, evening `d19d07507abccdaf7d54ee1d74419af7` (as expected); ACL `{postgres=X/postgres,service_role=X/postgres}`, `proconfig {search_path=public}`, owner postgres, anon/authenticated false, service_role true; the seven new names absent; `invoice` sessions 0; CHECK allows `invoice`; ledger 049 present (59), no 050; `migration list` 45 entries, last 049 | observed |
| 4. apply | SQL sha256 `1e09730d26aec0dcd46fefd09601651bad149138326c351556b8405acec0fade` checked in the same frame; `supabase db query --linked -f docs/reviews/050_material_inward_functions.sql`, foreground, one run, 08:48:14Z to 08:48:20Z, **exit 0** | observed |
| 4. ledger (first) | the classifier denied my attempt (throwaway workdir `repair`); nothing ran. **Run by Aravind** in his own terminal, option (a): `supabase --workdir /tmp/quoco/cli-wd migration repair --status applied 050 --linked` (workdir = sha-identical copy of the file + a copy of `project-ref`, not `supabase link`). His paste: ref `exfccwlrhoutkgrlikod`, sha256 `1e09730d...0fade`, `Repaired migration history: [050] => applied`. Verified by query: `050 material_inward_functions`, **31 statements** (filled from the file); `migration list` last `remote 050` | observed (the repair itself: reported by Aravind) |
| 5. catalog fingerprint, all nine | as in "Final state"; for the two replaced functions the ACL equals the pre-apply reading | observed |
| 5. real anon-key PostgREST | host `exfccwlrhoutkgrlikod.supabase.co`, anon key ref claim = test-db, role claim anon: `pm_approve_delivery`, `apply_material_inward_turn`, `expire_stale_material_inward` each **HTTP 401, code 42501, "permission denied for function ..."** (run after the first apply and again after the re-apply) | observed |
| 6. **DOWN rehearsal**, 14:27 IST (outside 08:25-08:40 and 18:25-18:40) | see below | observed |
| 7. re-apply | same file, same frame checks (ref, sha), foreground, one run, 08:58:10Z, **exit 0** (assertion block passed). Ledger row (second): **run by Aravind** (same command and same pasted output as above). Verified: 050 row present (31 statements), `migration list` last `remote 050`, readbacks identical to the first apply, anon refusals 42501 again | observed (repair: reported by Aravind) |
| 8. S-4 vitest + S1 label | `test/capture-engineer-flow.test.ts` case "S-4" (fixture user `engQs`, engineer role with only a `qs` membership); the S1 scaffold label corrected; the other-role-membership scaffold case is `docs/reviews/050-sql-evidence/src/S1b-s4.sql`. **Both are NOT RUN**: the vitest case waits for CI; S1b needs a pre-apply dump (a dump of test-db now already contains the 050 functions) | not run |

## DOWN rehearsal on test-db (step 6)

Seed (under tenant `zz-test-capture-down-<run id>`, via PostgREST as service_role; engineer user with an `engineer` membership):
- engineer mid-capture: `apply_material_inward_turn` start -> `start`; kind -> `advance`; file -> `advance` at step 3; a further file at S3 -> `file_attached` (**"a turn works"**), session `invoice/3` with `mi_document_id`, `mi_kind`, `mi_last_sid`, `mi_reask` in its context;
- a check-in session `morning/1` with context `{"invoice_reset_guard": "morning"}`.

DOWN: `docs/reviews/050-down-testdb.sql`, sha256 checked first = `c7f13299441ce26c2fa7f63a396a6dfa2c571bbd3d64b0c6ab7451e6ecc83bd6`; `supabase db query --linked -f`, foreground, one run, **exit 0** (08:57:33Z). Its own closing assertion (md5s, no `invoice` rows, no flags or keys, seven functions gone, ACL, ledger row gone) passed, because a failure aborts the transaction.

Independent readback after the DOWN:
- both sessions cleared subtract-only: the in-flight one `null/0 {}`, the flag one `morning/1 {}` (flag stripped);
- `apply_morning_flow_turn` md5 `707c10fe09dfd5a7cd065f7826eacd46`, `apply_evening_flow_turn` md5 `d19d07507abccdaf7d54ee1d74419af7`; both ACLs `{postgres=X/postgres,service_role=X/postgres}`;
- the seven functions gone (`[]`); `invoice` sessions 0; rows carrying the flag or a `mi_*` key 0;
- **ledger: only `049`; the 050 row is gone** (S-2 proved on a real row);
- 049 data untouched (the seed tenant's capture document still there until the cleanup);
- `apply_morning_flow_turn` start for the seeded engineer -> `{"outcome":"start", ... "current_flow":"morning","current_step":1}`;
- `apply_material_inward_turn` after the DOWN -> PGRST202 (function not found).

Cleanup of the seed: `quoco_test_capture_cleanup` -> `{"deliveries":1,"capture_files":2,"capture_documents":1,"delivery_invoice_links":0}`, then jobs, daily_logs, processed_messages, sessions, members, project, users, tenant deleted; rows left: 0 tenants, 0 users, 0 sessions.

## Not verified here

- The vitest suite (`test/capture-*.test.ts`, including S-4 and the CI-only race tests, N-7) has never run; its first CI run is the next evidence. Nothing in this record claims it.
- The concurrent-turn-versus-DOWN race was exercised only on the local scaffold (`transcripts/S5-down.txt`), not on test-db; the test-db rehearsal above was sequential.
- Prod: no GO, no read, no write. The prod pre-checks (plan section 13, with the S-4 probe added), `050-down-prod.sql` and the prod-captured bodies are still to do, and the reviewer wants `050-down-prod.sql` before the prod apply.
- `types/database.ts` is not regenerated by this block.
- The throwaway workdir `/tmp/quoco/cli-wd` has been deleted.

## CI runs during the apply (added 19 Oct, block 15)

- **CI run 843 is VOID.** It overlapped the apply and the DOWN rehearsal (the database was changing under it), so nothing from it counts.
- **Rule: no CI run on test-db during an apply or a rehearsal.** Start CI only after the last ledger row is written and the readbacks are done.
- **CI run 845** (`39226968754`, head `a878de7`, test job 09:25:28Z to 09:55:52Z, started after the re-apply at 08:58:10Z) is the first valid run. Result: every capture suite passed (`capture-pm-functions` 74 with 1 skip, `capture-engineer-flow` 40, `capture-races` 11 with 1 skip, `capture-static-guards` 11, `capture-tables` 15) except ONE assertion, `test/capture-checkin-n2-n13.test.ts:241` (T-A27-3). Cause (proved from code, `044:604-614` and `044:482-485`): the hindrance call that returned `reask` refreshed the stale invoice row's `expires_at`, so `expire_stale_material_inward` at the same instant correctly returned false. A test defect, not an SQL defect; fixed in the test (block 15), SQL unchanged (sha256 `1e09730d...0fade`).


## CI pin (added 20 Oct, block 18)

- **Run:** https://github.com/ara-2789/Quoco/actions/runs/39372883356 (`CI`, event `pull_request`, created 2026-10-20T05:03:57Z).
- **headSha:** `5534d50cc8bf4fd79ed268db1b86390578afd81a` = PR #333 `headRefOid` at the time of reading. **conclusion: success** (observed with `gh run list` and `gh run view --json`).
- **Jobs:** Migration Lint, Fixture Literal Lint, Detect docs-only change, Typecheck, File Size Lint, Lint, `Test (real test-db)` (job 118464479052, 43m33s) all success. **Skipped: `Detect already-green PR head`.** Reason, from `.github/workflows/ci.yml:235-237`: the job carries `if: github.event_name == 'push'`; this run's event is `pull_request`, so the job is skipped by design. It is not a failure and no test was skipped by it.
- **Test job (log read):** 140 files passed (140); 1867 passed, 2 skipped, 1 todo (1870).
- **`test/daily-log-correction-rpc.test.ts`: passed** (4 tests, 18235 ms).
- **050 suites in the same run:** `capture-pm-functions` 74 (1 skipped), `capture-engineer-flow` 40, `capture-races` 11 (1 skipped), `capture-checkin-n2-n13` 21, `capture-static-guards` 11, `capture-tables` 15, all passed. T-A27-3 (the earlier CI 845 failure) is inside `capture-checkin-n2-n13`.
- Race tests ran in CI only, per CLAUDE.md section 0; this run is their first valid evidence. The run started after the last ledger row and readbacks (no overlap with an apply or rehearsal).

## Prod pre-checks and prod DOWN (added 20 Oct, block 18)

Read-only prod pre-checks are done and recorded in `docs/plans/pr-b-050-plan.md` section 13.1 (verbatim: `docs/reviews/050-prod-precheck-transcript.txt`). Prod live bodies match test-db pre-050 by md5 (morning `707c10fe...`, evening `d19d07507...`); S-4 probe 0 rows; 0 `invoice` sessions; ledger ends 049. The prod DOWN, `docs/reviews/050-down-prod.sql` (sha256 `2e3747d4...b44c`), differs from the test-db DOWN in header comments only. No write to prod was made.

## Dated correction: DOWN precondition (20 Oct, block 19) [observed]

Reviewer's pre-merge fix: a DO block right after the LOCK in both DOWN artifacts raises `DOWN_PRECONDITION_050` unless the 050 ledger row exists AND all seven functions exist, so a second run refuses and changes nothing. The same text is noted in the SQL file's commented DOWN block.

- `050-down-testdb.sql` sha256 **`8990092b04f2603134e5ea4da61961e0e4345074e4d91c808f8af7b108f438bd`** (was `c7f13299...83bd6`, the file rehearsed on test-db on 19 Oct; the rehearsed file did not have the precondition block).
- `050-down-prod.sql` sha256 **`868a68f19304b546570445e627606f1f9b1e4ae9749d45a4112dee0cd1443a36`** (was `2e3747d4...b44c`). The two files differ in header comment lines 1-6 only.
- `050_material_inward_functions.sql` sha256 **`657b9f9413c07ff8ea20fe9feb9374311cc58d9bc816031fbca691d0871d157a`** (was `1e09730d...0fade`, the file APPLIED to test-db). The change is two comment lines in the commented DOWN block; no executable statement changed, so the applied objects and the 31-statement ledger count are unaffected. **The applied-bytes hash and the committed-file hash now differ; the prod apply must pin the new hash.**
- Proof: `docs/reviews/050-down-precondition-transcript.txt` (local scaffold from a fresh read-only test-db dump, HEAD `bf91095`, clean tree): each DOWN passes once; the second run fails with `DOWN_PRECONDITION_050: ledger_050=f functions_found=0`; the state after run 2 is identical to the state after run 1. Scaffold destroyed. The new DOWN text has therefore NOT been rehearsed on test-db itself (the test-db is at 050 applied, so a real rehearsal would need a re-apply; not done in this block).
