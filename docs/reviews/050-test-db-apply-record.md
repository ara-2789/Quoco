# 050 test-db apply record -- INCOMPLETE (stopped at the ledger step)

Date 19 Oct 2026. Target: test-db, ref `exfccwlrhoutkgrlikod` ONLY (printed before every database command; prod `jvxwqignooseazzmwhvl` never touched). FULL tier. Branch `feat/050-material-inward-fns` at `ed7852f` plus this block's uncommitted-at-the-time edits.
Raw log of every command and its output: `docs/reviews/050-test-db-apply/block-13-raw-log.txt` (copied from `/tmp/quoco/pr-b-block-13.txt`); the queries and the anon script are beside it.

## State in one line

**050 IS APPLIED TO TEST-DB (objects present, assertion block passed) BUT ITS LEDGER ROW WAS NOT WRITTEN.** `supabase migration list` still ends at 049. The DOWN rehearsal (step 6), the re-apply (step 7) and the final readbacks are NOT done. See "Stop" below.

## Observed vs reported

| Step | Result | Source |
|---|---|---|
| 0. review r2 | `~/Downloads/050-sql-review-r2.txt` sha256 `24651560c93f96108f91be01f2fbc816f7a98a7dcf17622c81a778a9c57fd890` = expected; copied verbatim to `docs/reviews/050-sql-review-round-2.md` | observed |
| 1. ref | `exfccwlrhoutkgrlikod` printed before every database command | observed |
| 2. S-4 probe (reviewer's exact query) | **0 rows** (`"rows": []`) -> proceed | observed, raw log |
| 3. pre-apply | live md5 morning `707c10fe09dfd5a7cd065f7826eacd46`, evening `d19d07507abccdaf7d54ee1d74419af7` (both as expected); ACL of both `{postgres=X/postgres,service_role=X/postgres}`, `proconfig {search_path=public}`, owner postgres, anon false / authenticated false / service_role true; the seven new names absent; `current_flow='invoice'` sessions 0; CHECK `whatsapp_sessions_current_flow_check` allows `invoice`; ledger 049 present (59 statements), no 050; `migration list`: 45 entries, last `049 / 049` | observed |
| 4. apply | sha256 of the file checked in the same frame = `1e09730d26aec0dcd46fefd09601651bad149138326c351556b8405acec0fade`; `supabase db query --linked -f docs/reviews/050_material_inward_functions.sql`, foreground, one run, 08:48:14Z to 08:48:20Z, **exit 0**, `"rows": []`. The file is one `BEGIN ... COMMIT` whose last block is the ACL/fingerprint assertion for all nine functions, so exit 0 means it passed. | observed |
| 4. ledger | **NOT DONE** -- see Stop | observed |
| 5. catalog readback | all nine functions: one `pg_proc` row each, `prosecdef` true, owner postgres; the seven new: `proconfig {"search_path=\"\""}`; two engineer-side service_role only (`{postgres=X, service_role=X}`), five `pm_*` authenticated only (`{postgres=X, authenticated=X}`); the two replaced: `{search_path=public}` and ACL **identical to the pre-apply reading**; new md5 morning `cf2e78881f03d4e03a0dc51fd9b6008e`, evening `9987ab905a5563f94f9226445fbcef8b` (differ from the old, as they must) | observed |
| 5. anon-key PostgREST | host `exfccwlrhoutkgrlikod.supabase.co`, anon key ref claim = test-db, role claim anon (keys never printed): `pm_approve_delivery`, `apply_material_inward_turn`, `expire_stale_material_inward` each **HTTP 401, code 42501, "permission denied for function ..."** | observed |
| 5. 050 ledger row present | **NO** (ledger query returns only `049 capture_tables 59`) | observed |
| 6. DOWN rehearsal | NOT RUN (it needs the 050 ledger row to test S-2) | -- |
| 7. re-apply | NOT RUN | -- |
| 8. vitest S-4 + label | done in the repo (not run): `test/capture-engineer-flow.test.ts` case "S-4", fixture user `engQs`; S1 scaffold label fixed; the case the old label described is `docs/reviews/050-sql-evidence/src/S1b-s4.sql` -- **NOT YET RUN** (the scaffold was destroyed and a dump of test-db now already contains the 050 functions) | not run |

## Stop

Step 4 says to write the ledger row "exactly the way the 049 test-db apply did". That method is `supabase migration repair --status applied <version> --linked`, which reads the statements from `supabase/migrations/<file>` in the CLI workdir (049 prod record sections 4-5). Two constraints collide here:
1. the 050 file is in `docs/reviews/` (held, as 049's was on test-db until its prod apply) and the main tree (the linked one) must not be changed;
2. `repair` only fills `statements` from a local file.

I tried to satisfy both with a throwaway workdir (`/tmp/quoco/cli-wd` holding a sha-identical COPY of the file and a COPY of `project-ref`, `supabase --workdir ... migration repair --status applied 050 --linked`). **The Claude Code permission classifier denied that command ("Modify Shared Resources"). Nothing in it ran** (no directory was created, the ledger is unchanged). I did not work around the denial.

Options for Aravind (his call):
- (a) approve the throwaway-workdir `repair` as described (ledger row with the statements from the sha-identical file);
- (b) `git mv docs/reviews/050_material_inward_functions.sql supabase/migrations/` in the worktree and run `repair` with `--workdir` on a linked directory (the 049 prod flow; moves the file earlier than 049's test-db apply did);
- (c) hand-insert the row with `statements` NULL as 049's first test-db apply did (the record calls that row the odd one out; the later re-alignment replaced it).
After the ledger row exists: the DOWN rehearsal (step 6, which then also proves S-2 against a real row), the re-apply and its ledger row, and the final readbacks.

## Current state of test-db (observed)

050's seven functions present with the intended grants; the two check-in functions replaced (new md5s above); **no 050 ledger row**; `migration list` last = 049. If left this way, `migration list` and the catalog disagree (objects without a row) -- the same shape as 032's ledger/reality mismatch.
