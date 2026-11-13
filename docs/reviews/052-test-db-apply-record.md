# 052 test-db apply record: COMPLETE (test-db only; prod untouched, no prod GO)

Date 13 Nov 2026 (UTC 16:59 to 18:25; IST 22:29 to 23:55). Target **test-db, ref `exfccwlrhoutkgrlikod` ONLY**, printed before every remote call (read from `supabase/.temp/project-ref` of the `--workdir` main checkout; the worktree has none, as in the 051 record). **Prod (`jvxwqignooseazzmwhvl`) was never connected to in this block. 052 is NOT applied to prod; no prod GO exists.** FULL tier. Branch `feat/052-mi-kind-removal`, draft PR #355, head at the start of the block `1901be540add25ebe1898f57ad00dd1eb573999c`.

Marks: **[O]** observed by Claude Code in this block, raw output in the named file (all under `docs/reviews/052-sql-evidence/`, prefix `rehearsal-`; sources in `rehearsal-src/`, sha256 list in `rehearsal-src/SHA256.txt`; copies are path-sanitised). **[R]** reported by Aravind: he ran the two ledger writes in his own terminal; the resulting ledger rows were then observed by query.

SQL pins, each verified before every use: `052_mi_kind_deferred.sql` sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`; `052-down-testdb.sql` sha256 `bb21dfe0b7c358c1c36a95a3cc17d457526e9d3dd0e7580da915182cb530907f`. Neither file was edited. Raw originals (timestamp, HEAD and an empty `git status --porcelain` line at the top of each, until the commit of this record) are in `~/quoco-records/052-build/b2a/`, outside the repo.

## State of test-db at the end of this record (exact) [O] `rehearsal-step7-after-teardown.txt`

- **052 APPLIED** (re-applied after the DOWN; file `2c4ee3bc…`), post-052 bodies: `apply_material_inward_turn` `e32797b6…`, `trg_capture_documents_before_insert` `4f83a28f…`, `trg_capture_documents_before_update` `cfcd5925…`; fingerprint `6c69c545704f5d72dc776a55863feca9`. Both new functions exist, `kind` nullable, 4 new columns, 4 constraints.
- **Ledger ends `052 mi_kind_deferred`, 34 statements**, then 051, 050 (written by Aravind, second write).
- **No rehearsal fixture left:** tenants, public users, auth users, documents, jobs, processed messages and sessions of this run: all 0. 0 invoice-flow sessions. 51 documents, 51 deliveries, 0 links remain (the earlier leaked `capture-ingest` runs' 51 documents, untouched), 605 sessions in total.
- main's capture tests will fail on test-db until PR #355 merges.

## Ordering correction, 2026-11-13

The block ran the DOWN rehearsal before the ledger row; the DOWN refused with `DOWN_PRECONDITION_052: ledger_052=f helper_found=1 wrapper_found=1 columns_found=4 constraints_found=4`, state unchanged (`rehearsal-step6a-down-refused.txt`). Cause, `052-down-testdb.sql:41-62`: the DOWN's first check requires the `052` ledger row; the unclassified-document check comes after it. Ledger row written per Aravind, then the sequence resumed. **A second consequence, observed: the DOWN deletes the `052` ledger row** (`ledger_052` 1 -> 0, tail back to 051), so the row had to be written a second time after the re-apply. Both are properties of the DOWN as written and were not edited.

## Pre-apply cleanup (authorised per Aravind, 13 Nov 2026)

- **Found.** The first run of step 1 stopped at 1d: 50 `whatsapp_sessions` rows with `current_flow = 'invoice'` ([O] `rehearsal-step1-preapply-FIRST-RUN-stopped.txt`, `rehearsal-step1d-invoice-sessions.txt`). The migration's A0 aborts on any such row whatever `expires_at` says, so it could not have applied.
- **Scope rule (read-only re-count first, `rehearsal-stepA-precheck.txt`).** Proceed only if: count = 50; every row in one of the two `zz-test-capture-capture-ingest-a-*` tenants found earlier (44 in `…-c3639688-…`, 6 in `…-c9392cc5-…`); none with `expires_at` in the future (0); newest `whatsapp_sessions.updated_at` and newest `capture_documents.created_at` both older than 10 minutes (5 h 56 min and 14 days). All held.
- **Backup.** 50 rows, all columns, JSON, outside the repo: sha256 `e96a6e54289c467bec879616949c4a7d317559fbae154a72827646133725a670`.
- **Delete** (`rehearsal-stepB-delete.txt`): one transaction, a `DO` block with `DELETE FROM public.whatsapp_sessions WHERE current_flow = 'invoice' AND tenant_id IN (<the two ids>) AND expires_at <= now()`, aborting unless the row count is exactly 50. Exit 0. Sessions 654 -> 604 (difference exactly 50); invoice sessions 50 -> 0. [O]
- **What the rows were.** Leaked test fixtures in run-scoped test tenants (`zz-test-capture-capture-ingest-a-*`), all `current_step` 3, all `updated_at = 2026-10-30 06:30:00+00`, every one with an `mi_kind` key in its context. The same two runs also left their tenants (4 incl. the `-b-` ones), 1 user each, and 51 documents (45 and 6): `rehearsal-stepC3-leftover-tenants.txt`. Those 51 documents are the 51 documents the first apply backfilled.
- **Second, pre-authorised cleanup (for sessions left by the CI run):** prepared and **not needed**: the re-probe before the re-apply found 0 invoice-flow sessions in any tenant (`rehearsal-step6d-pre-reprobe.txt`). Nothing was deleted.

## Findings for block 2 (read-only; NOT fixed here)

Tests leak `whatsapp_sessions` rows with `current_flow = 'invoice'` (50 rows, all `updated_at 2026-10-30 06:30:00+00`, the fixed test clock `noonIst()`, `test/helpers/capture-fixtures.ts:284-290`).
- **Creator:** `test/capture-ingest.test.ts:86-92`, `seed()`: `const phone = kit.phone(label)` (line 87) then the engineer turns through the real `apply_material_inward_turn` (line 88 onward). The RPC leaves the session in the `invoice` flow, and `kit.phone` (`capture-fixtures.ts:209-211`) registers the phone for teardown.
- **Teardown that missed them:** `test/helpers/capture-fixtures.ts:243` (session delete by `kit.phones`) runs AFTER `quoco_test_capture_cleanup` (lines 232-233, which throws on error) inside `teardownCaptureKit` (line 229), called from the `afterAll` at `test/capture-ingest.test.ts:278-287`. If the run is killed or any earlier step throws, line 243 is never reached.
- **Observed, not explained:** in both leaked runs the teardown did not complete at all (tenants, users, 51 documents and the sessions all remained). Why it stopped is not known from test-db; no CI log was read.
- **Consequence for 052:** after 052 an engineer turn still leaves the session in `current_flow = 'invoice'` (observed: `rehearsal-step4-setup-and-4k.txt`, `current_flow":"invoice","current_step":2`), so any leaked capture session blocks the next apply on any database until cleared. Prod needs its own count immediately before apply (Apply GO list).
- **Race limit (block 2 owes CI verification):** in 40 of 40 runs the first-issued caller won; a symmetric interleaving is not shown. CLAUDE.md section 0 requires concurrency verification in CI; owed in block 2.
- Also seen: the outbound-send suite leaves `ZZ Test Engineer (outbound…)` users behind in tenant `zz-outbound-send` (4 created during the CI run, below); about 30 `zz-test-session-transition-*` tenants and 12 `zz-007-*` auth users from September also remain. None is from this block and none was touched.

## Process findings

- **The push of `bfb6d94` during the rehearsal started CI on the shared test-db.** Run <https://github.com/ara-2789/Quoco/actions/runs/43471377792> (event `pull_request`, head `bfb6d94f…`): started **2026-11-13 17:17:49Z**, job "Test (real test-db)" 17:18:03Z to 18:11:33Z, run ended **18:11:34Z**, conclusion `failure`. **Conclusion not meaningful: test-db state changed during the run** (it overlapped the first DOWN, 17:35Z, and the 6b classification). I did not cancel, re-run or act on it. The re-apply waited for it to finish (gate: in progress 0, queued 0 at 18:12:01Z). **Rule for later blocks: no push while test-db work is in flight.** From the correction onward this block made no push until after the teardown.
- The CI run left no tenant, auth user or stub that the 1g baseline counts; it created 4 public users in `zz-outbound-send` (`rehearsal-step7-extra-public-users.txt`, 17:29:53Z, 17:54:36Z twice, 18:03:54Z), which is why `public_users_total` ended at 2387 against a baseline of 2383. Not removed (not this block's rows).

## Pre-apply probes (step 1, re-run after the cleanup; `rehearsal-step1-preapply.txt`) [O]

| Probe | Result |
|---|---|
| 1a md5s | `cecc170b…` / `b5467b20…` / `4a7f4703…`, one row each: match |
| 1b N-2 | `private` schema absent, wrapper absent, helper absent, 0 functions of those names in any schema |
| 1c N-2 / A3b | 51 documents (all `dc`), 51 deliveries (all `incomplete`), 0 links; every document has exactly 1 delivery; 0 offenders: **PROCEED** |
| 1d A0 | 0 invoice sessions (after the cleanup) |
| 1e baseline | fingerprint `fa50d7fd831aea1eb8f4271e3f25bac6`, comments hash `9b773b739dc533485331dd0dc2c56134` (my own 052-scoped queries: functions, ACLs, triggers, table and column ACLs, constraints, columns of `capture_documents`, ACLs of schemas `private`/`public`; the 051 queries cover `capture_files` only) |
| 1f ledger | 051, 050, 049 |
| 1g #349 baseline | 12 `@quoco.test` auth users, 18 auth users, 2383 public users, 4 `ZZTestCapture-` users, 4 `zz-test-capture-` tenants |

## Apply and measured lock hold (step 2; `rehearsal-step2-apply.txt`, `rehearsal-step2-lock-monitor.txt`) [O]

- Gates: IST 22:36 (outside 08:25-08:40 and 18:25-18:40), CI in progress 0 and queued 0, sha256 verified, md5s and invoice sessions re-read in the same frame.
- `supabase --workdir <main checkout> db query --linked -f docs/reviews/052_mi_kind_deferred.sql`, foreground, one run. CLI call **17:06:30.207Z to 17:06:34.011Z, exit 0** (includes the CLI's own login and round trip). The in-file A6 assertion and post-condition block raise on any failure; none was raised. The CLI printed no notice text.
- **Lock monitor:** a second connection (read-only `DO` loop) sampled `pg_locks` for an `ExclusiveLock` on `public.whatsapp_sessions` held by another backend, 445 samples in 45.06 s (about 101 ms apart). Seen in **exactly one sample, 17:06:33.345Z**.
- **Measured lock hold, first apply: at most about 200 ms** (neighbouring samples did not see it), at least 0. **Re-apply (step 6d, `rehearsal-step6d-lock-monitor.txt`): 445 samples, the lock was seen in 0 of them, so the hold was shorter than one sampling interval, under about 101 ms.** Error bound for both: the sampling interval. These are sampled bounds, not timed values; the plan's "LOCK TABLE to COMMIT" interval cannot be timed more finely without editing the file.

## Read-back (step 3; `rehearsal-step3-readback.txt`) [O]

| Item | Observed | Reference |
|---|---|---|
| `apply_material_inward_turn` md5 | `e32797b63fee8fceca1934be700609c3` | post-052 `dryrun-r1-12`: same |
| `trg_capture_documents_before_insert` md5 | `4f83a28f16956ebae830361c4f898899` | same |
| `trg_capture_documents_before_update` md5 | `cfcd59258a5039acc395dd8136328ca5` | same |
| pre-052 md5s (step 1a) | `cecc170b…`, `b5467b20…`, `4a7f4703…` | |
| `private.capture_apply_classification` | owner postgres, SECURITY DEFINER, `search_path=""`, ACL `{postgres=X/postgres}` | |
| `public.pm_classify_document` | owner postgres, SECURITY DEFINER, `search_path=""`, ACL `{postgres=X/postgres,authenticated=X/postgres}` | |
| EXECUTE (anon / authenticated / service_role) | wrapper f/t/f; helper f/f/f; RPC f/f/t; both trigger functions f/f/f | |
| schema `private` | `{postgres=UC/postgres}`; USAGE and CREATE false for all three roles | |
| columns | `kind` nullable; `kind_source`, `kind_set_at`, `kind_set_by` nullable; `received_at` NOT NULL | |
| constraints | `kind_provenance_chk`, `kind_set_order_chk`, `received_order_chk`, `kind_set_by_fk` present, validated | |
| `capture_documents` table grants | anon none; authenticated SELECT; service_role SELECT (relacl `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}`) | |
| after-apply fingerprint / comments hash | `6c69c545704f5d72dc776a55863feca9` / `7505c3a44984815b55b2566919106502` | |

## Privilege matrix through PostgREST, real JWTs (step 4; `rehearsal-step4-matrix.txt`, `rehearsal-step4-setup-and-4k.txt`, script `rehearsal-src/b2a.cjs.txt`) [O]

Run-scoped fixture: tenants `zz-test-capture-b2a-{a,b}-<run tag>`; users: an engineer who sends (with a login), two PMs of P1, an admin with no membership, a PM of the other tenant. The throwaway password is the fixed one already in `test/helpers/capture-fixtures.ts`.

| Row | Caller -> call | HTTP | Code / message | DB after |
|---|---|---|---|---|
| a | anon -> `pm_classify_document` | 401 | `42501` permission denied for function pm_classify_document | unclassified |
| b | anon, authenticated, service_role -> helper, no `Content-Profile` | 404 | `PGRST202` function `public.capture_apply_classification` not in schema cache | unclassified |
| c | authenticated and service_role -> helper, `Content-Profile: private` | 406 | `PGRST106` "Invalid schema: private", hint "Only the following schemas are exposed: public, graphql_public" | unclassified |
| d | PM of P1 -> classify (positive control) | 200 | keys `kind,delivery_id,document_id,self_link_id,already_classified`; `already_classified` false | kind dc, source pm, set_by and set_at set, 1 delivery (`incomplete`) |
| e | same call again | 200 | `already_classified` true | unchanged, still 1 delivery |
| f | same document, kind `invoice` | 400 | `QE011` | unchanged |
| g | the engineer who sent it (S-5) | 400 | `QE015` | unclassified, 0 deliveries |
| h | admin without PM membership (S-5) | 400 | `QE015` | unclassified |
| i | PM of another tenant | 400 | `QE015` (unknown id as pm1: same `QE015`) | unclassified |
| j | service_role INSERT / UPDATE / DELETE on `capture_documents` | 403 each | `42501` permission denied for table capture_documents | row intact, unclassified |
| j+ | service_role -> wrapper | 403 | `42501` | unclassified |
| k | engineer turn, service_role, real RPC | 200 | document created with `received_at` set, kind NULL, 0 deliveries; result keys `outcome,delivery_id,document_id,current_flow,current_step`, `delivery_id` present and null | |

**4z (S-4, `rehearsal-step4z-helper-revoke.txt`):** in one transaction, `GRANT USAGE ON SCHEMA private TO authenticated; SET LOCAL ROLE authenticated;` then the helper: `ERROR: 42501: permission denied for function capture_apply_classification`; the transaction was not committed. Schema ACL afterwards unchanged (`{postgres=UC/postgres}`, no USAGE for authenticated) and the fingerprint equals the step 3 value. [O]

## Concurrency and the two-caller race (step 5)

- **5.0a positive control for the harness** (`rehearsal-step5-0-concurrency-and-for-update.txt`): session 1 held `FOR UPDATE` on a document for 12 s; a PostgREST classify call on that document issued meanwhile returned only after session 1 committed (**latency 6,609 ms**) and then succeeded. So a PostgREST call on this path does observe a lock held by another session; the sandbox serialisation described in CLAUDE.md section 0 was not seen between a CLI session and PostgREST. [O]
- **5.0b FOR UPDATE proof on test-db**, two separate sessions: control, session 1 `FOR NO KEY UPDATE`, session 2 `FOR KEY SHARE` acquired at once; test, session 1 runs `pm_classify_document` as the PM (JWT claims set) and holds the transaction open, session 2 `FOR KEY SHARE` with `lock_timeout 2s` fails with **`55P03` canceling statement due to lock timeout, while locking tuple in relation "capture_documents"**; after session 1 committed, session 2 acquired it. [O]
- **Race** (`rehearsal-step5-race.txt`): two concurrent `pm_classify_document` calls from two PMs of the same project on the same fresh unclassified document. (i) same kind: 20 runs, 20 OK (one `already_classified:false`, one `true`); (ii) different kinds: 20 runs, 20 OK (one success, one `QE011`). **Totals: 40 runs, 40 OK, every document ended with exactly 1 delivery; no run had 0 or 2.** [O]
- **Race limit:** in 40 of 40 runs the first-issued caller (about 1 ms earlier, always the same PM) won; the loser's call finished about 300 ms later. A symmetric interleaving is not shown. Both requests overlapped client-side (233-337 ms), which does not show that the calls overlapped inside Postgres; what supports "the path can see contention" is 5.0a, and what supports the lock mode is 5.0b. CLAUDE.md section 0 requires concurrency verification in CI; **owed in block 2.**

## DOWN and re-apply (step 6) [O]

| Step | Observed | Evidence |
|---|---|---|
| 6a (first, before the ledger row) | exit 1, `DOWN_PRECONDITION_052: ledger_052=f …`; state unchanged. See "Ordering correction" | `rehearsal-step6a-down-refused.txt` |
| 6a (after the ledger row), 17:34:10Z to 17:34:13Z | **exit 1, `DOWN_PRECONDITION_052_UNCLASSIFIED: 1 document(s) have no kind; a kind is never guessed`.** State identical before and after: md5s `e32797b6…`/`4f83a28f…`/`cfcd5925…`, 95 documents (1 unclassified), 94 deliveries, 10 links, 649 sessions, 44 invoice-flow sessions, fingerprint `6c69c545…`, comments hash `7505c3a4…`, ledger tail 052, 051, 050 | `rehearsal-step6a2-down-refused-unclassified.txt` |
| 6b | the rehearsal's one unclassified document `f0fd7e63-d7c5-42f0-8c11-86197e64f863` (tenant `zz-test-capture-b2a-a-<run tag>`) classified as `dc` by `private.capture_apply_classification` called as postgres with the run's PM `users.id`: result `kind dc`, delivery `cb30218c-f834-4206-8f0d-28bc645caa78`, `already_classified false`. **Test row in a run-scoped tenant; the kind is a rehearsal choice, not a real decision.** 0 unclassified after | `rehearsal-step6b-classify.txt` |
| 6c, 17:35:16.506Z to 17:35:19.885Z | **exit 0.** Invoice-flow sessions before: 44; per the DOWN header they are cleared subtract-only (`current_flow` NULL, `current_step` 0, the four `mi_*` keys removed); after: 0 invoice-flow sessions, 0 sessions with an `mi_*` key, 649 sessions kept. md5s back to `cecc170b…`, `b5467b20…`, `4a7f4703…`; no 052 object (schema `private`, wrapper, helper, 4 columns, 4 constraints all gone); `kind` NOT NULL again; fingerprint `fa50d7fd831aea1eb8f4271e3f25bac6` and comments hash `9b773b739dc533485331dd0dc2c56134`, both equal to the step 1e baseline; 95 documents kept. **The DOWN removed the 052 ledger row** (tail 051, 050, 049). CI was in progress at this moment (the run above) | `rehearsal-step6c-down.txt` |
| 6d pre-re-apply re-probe, 18:12Z, after CI idle | md5s pre-052, 052 objects absent, ledger tail 051, A3b PROCEED (95 documents, each exactly one delivery, no offenders), 0 invoice-flow sessions, fingerprint and comments hash equal to baseline, #349 listing (tenants, auth users, stubs: the b2a set plus the pre-existing leftovers; nothing new from CI beyond the 4 outbound users) | `rehearsal-step6d-pre-reprobe.txt` |
| 6d re-apply, 18:13:32.440Z to 18:13:35.898Z | **exit 0**, file sha256 `2c4ee3bc…` verified. Read-back equal to step 3 on all 115 value lines (md5s `e32797b6…`/`4f83a28f…`/`cfcd5925…`, ACLs, constraints, grants, fingerprint `6c69c545…`, comments hash `7505c3a4…`); lock seen in 0 of 445 samples (hold under about 101 ms) | `rehearsal-step6d-reapply.txt`, `rehearsal-step6d-lock-monitor.txt`, `rehearsal-step6d-readback.txt` |
| 6d ledger (second write) | tail was 051 after the re-apply; Aravind wrote the row [R]; observed by query: `052 mi_kind_deferred`, 34 statements, then 051, 050 | `rehearsal-step6e-ledger-second-write.txt` |
| 6e teardown | the normal teardown (same steps as `teardownCaptureKit`, `rehearsal-src/b2a.cjs.txt`, subcommand `teardown`) completed; **#349 counts after: 12 `@quoco.test` auth users, 18 auth users, 4 `ZZTestCapture-` users, 4 `zz-test-capture-` tenants: equal to the 1g baseline.** Leftovers of this run: tenants 0, public users 0, auth users 0, documents 0, jobs 0, processed messages 0, sessions 0. Invoice-flow sessions 0. **One count differs from the 1g baseline's neighbours: `public_users_total` 2387 vs 2383, +4, the CI run's `zz-outbound-send` users (see Process findings), not this run's** | `rehearsal-step7-teardown.txt`, `rehearsal-step7-after-teardown.txt`, `rehearsal-step7-extra-public-users.txt` |

The DOWN's named consequence (PM attribution lost for rows it re-keyed) was not re-queried here.

## Ledger writes (Aravind's step) [R], verified [O]

Workdir `/tmp/quoco/cli-wd-052` (a sha-identical copy of the held file plus a copy of `project-ref`, no `supabase link`), command `supabase --workdir /tmp/quoco/cli-wd-052 migration repair --status applied 052 --linked`, run by Aravind in his own terminal, **twice** (before the DOWN rehearsal, and again after the DOWN deleted the row). Observed after each: `052 mi_kind_deferred`, 34 statements, on top of 051 and 050. The first observation (23:03 IST) was printed in the session, but its file was overwritten by the second check (the script reused its output name); the surviving file `rehearsal-stepR1-ledger.txt` and its copy `rehearsal-step6e-ledger-second-write.txt` are the second observation (23:53 IST). The in-between state (ledger 052 present before the DOWN, `ledger_052` 1 in the 6a and 6c "before" blocks) is in those step files. The workdir should be deleted when the prod decision is made.

## Apply GO list

| Item | Status |
|---|---|
| PG17 dry-run, executed DOWN incl. seeded unclassified refusal (local) | DONE (earlier blocks) |
| Privilege matrix through the API incl. anon 42501 and the no-`Content-Profile` 404 | DONE (`rehearsal-step4-matrix.txt`) |
| S-4 helper function-level REVOKE firing | DONE (`rehearsal-step4z-helper-revoke.txt`) |
| S-5 engineer and admin-without-membership refusals on test-db | DONE (rows g, h) |
| N-2 `private` absent and A3/A3b extension probes on test-db | DONE (`rehearsal-step1-preapply.txt`, `rehearsal-step6d-pre-reprobe.txt`) |
| Measured lock hold | DONE as sampled bounds: at most about 200 ms (apply), under about 101 ms (re-apply) |
| `FOR UPDATE` proof on test-db | DONE (5.0b) |
| Two-caller race on test-db | DONE with the limits stated above; **concurrency verification in CI OWED in block 2** |
| DOWN on test-db: unclassified refusal, resolve, DOWN, restore to baseline, re-apply, read-back equal | DONE (step 6) |
| Teardown and #349 counts equal to baseline | DONE (6e), with the +4 `zz-outbound-send` users from the CI run noted |
| S5 dark-control record | STILL OWED |
| External probe immediately before prod apply | STILL OWED |
| Prod helper probe (`to_regprocedure('public.quoco_test_capture_insert(text,jsonb)')` and `quoco_test_capture_update` IS NULL on prod) | STILL OWED |
| Prod md5 re-read with the prod ref printed | STILL OWED |
| **Count of invoice-flow sessions on prod immediately before apply (A0 aborts on any; must be 0 or explicitly cleared)** | STILL OWED (new) |
| Note for the prod DOWN rehearsal-equivalent: the DOWN deletes the ledger row and requires it to exist | recorded; no action |

## Unknowns and mismatches

- Why the two leaked runs' teardown did not complete (see findings).
- Expectation mismatches: (1) the first 6a refused on the ledger precondition, not the unclassified one (ordering); (2) the DOWN deletes the ledger row, so a second write was needed; (3) the CI run overlapped the first DOWN and the 6b classification, so its result means nothing; (4) `public_users_total` +4 from the CI run, not from this block.
- The race winner was the first-issued caller in all 40 runs; whether a symmetric interleaving occurs is not shown.
- Lock hold is a sampled bound, not a timed value; the two applies gave different samples (1 hit, 0 hits), consistent with a hold near or under one interval.
- The pre-052 bodies tie to prod only by the md5 Aravind pasted (unchanged caveat from the package).
