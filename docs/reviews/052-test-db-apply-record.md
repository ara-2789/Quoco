# 052 test-db apply record: PARTIAL (apply, read-back, API matrix and race done; DOWN rehearsal waits for the ledger row)

Date 13 Nov 2026. Target **test-db, ref `exfccwlrhoutkgrlikod` ONLY**, printed before every remote call (read from `supabase/.temp/project-ref` of the `--workdir` main checkout; the worktree has none, as in the 051 record). **Prod (`jvxwqignooseazzmwhvl`) was never connected to in this block. 052 is NOT applied to prod; no prod GO exists.** FULL tier. Branch `feat/052-mi-kind-removal`, draft PR #355, head at the start of the block `1901be540add25ebe1898f57ad00dd1eb573999c`.

Marks: **[O]** observed by Claude Code in this block, raw output in the named file (all under `docs/reviews/052-sql-evidence/`, prefix `rehearsal-`; sources in `rehearsal-src/`, sha256 list in `rehearsal-src/SHA256.txt`). Nothing here is reported-by-Aravind except the authorisation quoted in "Pre-apply cleanup".

SQL pins, each verified before use: `052_mi_kind_deferred.sql` sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`; `052-down-testdb.sql` sha256 `bb21dfe0b7c358c1c36a95a3cc17d457526e9d3dd0e7580da915182cb530907f`. Neither file was edited. Raw originals with full timestamps, HEAD and an empty `git status --porcelain` line at the top of each: `~/quoco-records/052-build/b2a/` (outside the repo).

## State of test-db at the end of this record (exact)

- **052 is APPLIED** (file `2c4ee3bc…`, apply exit 0). **Ledger row NOT written** (`schema_migrations` tail is still 051, 050, 049; `ledger_052 = 0`). main's capture tests will fail on test-db until PR #355 merges.
- The DOWN was run once and **refused**; the refusal changed nothing: three function md5s, object checks, row counts, fingerprint and comments hash identical before and after ([O] `rehearsal-step6a-down-refused.txt`).
- Left in place on purpose, for the steps that resume: one run-scoped fixture set (tenants `zz-test-capture-b2a-{a,b}-<run tag>`, 5 auth users, 2 projects, about 45 documents, 44 `invoice`-flow sessions, one unclassified document `d2`). The teardown (step 6e) has not run, so the #349 before/after check is not done.

## Pre-apply cleanup (authorised per Aravind, 13 Nov 2026)

- **Found.** The first run of step 1 stopped at 1d: 50 `whatsapp_sessions` rows with `current_flow = 'invoice'` ([O] `rehearsal-step1-preapply-FIRST-RUN-stopped.txt`, `rehearsal-step1d-invoice-sessions.txt`). The migration's A0 aborts on any such row whatever `expires_at` says, so it could not have applied.
- **Scope rule (read-only re-count first, `rehearsal-stepA-precheck.txt`).** Proceed only if: count = 50; every row in one of the two `zz-test-capture-capture-ingest-a-*` tenants found earlier (44 in `…-c3639688-…`, 6 in `…-c9392cc5-…`); none with `expires_at` in the future (0); newest `whatsapp_sessions.updated_at` and newest `capture_documents.created_at` both older than 10 minutes (5 h 56 min and 14 days). All held.
- **Backup.** 50 rows, all columns, JSON, outside the repo: sha256 `e96a6e54289c467bec879616949c4a7d317559fbae154a72827646133725a670`.
- **Delete** (`rehearsal-stepB-delete.txt`): one transaction, a `DO` block with `DELETE FROM public.whatsapp_sessions WHERE current_flow = 'invoice' AND tenant_id IN (<the two ids>) AND expires_at <= now()`, aborting unless the row count is exactly 50. Exit 0. Total sessions 654 -> 604 (difference exactly 50); invoice sessions 50 -> 0. [O]
- **What the rows were.** Leaked test fixtures in run-scoped test tenants (`zz-test-capture-capture-ingest-a-*`), all `current_step` 3, all `updated_at = 2026-10-30 06:30:00+00`, every one with an `mi_kind` key in its context. The same two runs also left their tenants (4 incl. the `-b-` ones), 1 user each, and 51 documents (45 and 6): `rehearsal-stepC3-leftover-tenants.txt`. Those 51 documents are the 51 documents the apply backfilled.

## Findings for block 2 (read-only; NOT fixed here)

Tests leak `whatsapp_sessions` rows with `current_flow = 'invoice'` (50 rows, all `updated_at 2026-10-30 06:30:00+00`, the fixed test clock `noonIst()`, `test/helpers/capture-fixtures.ts:284-290`).
- **Creator:** `test/capture-ingest.test.ts:86-92`, `seed()`: `const phone = kit.phone(label)` (line 87) then the engineer turns through the real `apply_material_inward_turn` (line 88 onward). The RPC leaves the session in the `invoice` flow, and `kit.phone` (`capture-fixtures.ts:209-211`) registers the phone for teardown.
- **Teardown that missed them:** `test/helpers/capture-fixtures.ts:243` deletes sessions by `kit.phones`, but only AFTER `quoco_test_capture_cleanup` (lines 232-233, which throws on error) inside `teardownCaptureKit` (line 229), called from the `afterAll` at `test/capture-ingest.test.ts:278-287`. If the run is killed or any earlier step throws, line 243 is never reached.
- **Observed, not explained:** in both leaked runs the teardown did not complete at all (tenants, users, 51 documents and the sessions all remained). Why it stopped is not known from test-db; no CI log was read in this block.
- **Consequence for 052:** after 052 an engineer turn still leaves the session in `current_flow = 'invoice'` (observed: `rehearsal-step4-setup-and-4k.txt`, `current_flow":"invoice","current_step":2`), so any leaked capture session blocks the next apply on any database until cleared. Prod needs its own count before any apply.

## Pre-apply probes (step 1, re-run after the cleanup; `rehearsal-step1-preapply.txt`) [O]

| Probe | Result |
|---|---|
| 1a md5s | `cecc170b…` / `b5467b20…` / `4a7f4703…`, one row each: match |
| 1b N-2 | `private` schema absent, wrapper absent, helper absent, 0 functions of those names in any schema |
| 1c N-2 / A3b | 51 documents (all `dc`), 51 deliveries (all `incomplete`), 0 links; every document has exactly 1 delivery; 0 offenders: **PROCEED** |
| 1d A0 | 0 invoice sessions (after the cleanup) |
| 1e baseline | fingerprint `fa50d7fd831aea1eb8f4271e3f25bac6`, comments hash `9b773b739dc533485331dd0dc2c56134` (my own 052-scoped queries: functions, ACLs, triggers, table and column ACLs, constraints, columns of `capture_documents`, schemas `private`/`public` ACLs; the 051 queries cover `capture_files` only) |
| 1f ledger | 051, 050, 049 |
| 1g #349 baseline | 12 `@quoco.test` auth users, 18 auth users, 4 `ZZTestCapture-` users, 4 `zz-test-capture-` tenants (pre-existing leftovers, before this block's fixtures) |

## Apply and measured lock hold (step 2; `rehearsal-step2-apply.txt`, `rehearsal-step2-lock-monitor.txt`) [O]

- Gates: IST 22:36 (outside 08:25-08:40 and 18:25-18:40), CI in progress 0 and queued 0, sha256 verified, md5s and invoice sessions re-read in the same frame.
- `supabase --workdir <main checkout> db query --linked -f docs/reviews/052_mi_kind_deferred.sql`, foreground, one run. CLI call **2026-11-13 17:06:30.207Z to 17:06:34.011Z, exit 0** (includes the CLI's own login and round trip). The in-file A6 assertion and post-condition block raise on any failure; none was raised. The CLI printed no notice text.
- **Lock monitor:** a second connection (read-only `DO` loop) sampled `pg_locks` for an `ExclusiveLock` on `public.whatsapp_sessions` held by another backend, 445 samples in 45.06 s (about 101 ms apart). The lock was seen in **exactly one sample, 17:06:33.345Z** (first seen = last seen).
- **Measured lock hold: at most about 200 ms** (the two neighbouring samples, about 101 ms either side, did not see it), at least 0. The error bound is the sampling interval, about 101 ms. This is a sampled bound, not a timed value; the plan's "LOCK TABLE to COMMIT" interval cannot be timed more finely without editing the file.

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
| ledger | tail still 051 (not written) | |

## Privilege matrix through PostgREST, real JWTs (step 4; `rehearsal-step4-matrix.txt`, `rehearsal-step4-setup-and-4k.txt`, script `rehearsal-src/b2a.cjs.txt`) [O]

Run-scoped fixture: tenants `zz-test-capture-b2a-{a,b}-<run tag>`; users: engineer who sends (with a login), two PMs of P1, an admin with no membership, a PM of the other tenant. Throwaway password is the fixed one already in `test/helpers/capture-fixtures.ts`.

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

- **5.0a positive control for the harness** (`rehearsal-step5-0-concurrency-and-for-update.txt`): session 1 held `FOR UPDATE` on a document for 12 s; a PostgREST classify call on that document issued meanwhile returned only after session 1 committed (**latency 6,609 ms**, issued 17:11:57.6Z, returned 17:12:04.2Z, session 1 ended 17:12:04.8Z) and then succeeded. So a PostgREST call on this path does observe a lock held by another session; the sandbox serialisation described in CLAUDE.md section 0 was not seen between a CLI session and PostgREST. [O]
- **5.0b FOR UPDATE proof on test-db**, two separate sessions: control, session 1 `FOR NO KEY UPDATE`, session 2 `FOR KEY SHARE` acquired at once; test, session 1 runs `pm_classify_document` as the PM (JWT claims set) and holds the transaction open, session 2 `FOR KEY SHARE` with `lock_timeout 2s` fails with **`55P03` canceling statement due to lock timeout, while locking tuple in relation "capture_documents"**; after session 1 committed, session 2 acquired it. [O]
- **Race** (`rehearsal-step5-race.txt`): two concurrent `pm_classify_document` calls from two PMs of the same project on the same fresh unclassified document. (i) same kind: 20 runs, 20 OK (one `already_classified:false`, one `true`); (ii) different kinds: 20 runs, 20 OK (one success, one `QE011`). **Totals: 40 runs, 40 OK, every document ended with exactly 1 delivery; no run had 0 or 2.** [O]
- **Honest limits.** In all 40 runs the caller issued first (about 1 ms earlier, always the same PM) won; the loser's call finished about 300 ms later. The two requests overlapped client-side in all 40 (233-337 ms), but a client-side overlap does not show that the two calls overlapped inside Postgres; what supports "the path can see contention" is 5.0a, and what supports the lock mode is 5.0b. This is evidence, not a proof of every interleaving. The test-class rule in CLAUDE.md section 0 (concurrency verification is CI-only) is not satisfied by this record alone.

## DOWN (step 6): ONLY 6a RUN; EXPECTATION DID NOT MATCH; 6b-6e NOT RUN

- 6a, `rehearsal-step6a-down-refused.txt`: with one unclassified document present, the DOWN (sha verified) ran once, foreground: **exit 1, `DOWN_PRECONDITION_052: ledger_052=f helper_found=1 wrapper_found=1 columns_found=4 constraints_found=4`**, not the expected `DOWN_PRECONDITION_052_UNCLASSIFIED`. Cause, read from `052-down-testdb.sql:41-62`: the DOWN's first check requires the `052` ledger row (`v_ledger`), and the unclassified-document check comes after it. The ledger row is Aravind's step 7, which this block may not write, so the unclassified refusal was never reached. State unchanged (see above). **This is an ordering mismatch between the block's step order and the DOWN's own precondition, not an edit to either file.** In the 051 record the ledger row was written before the DOWN rehearsal.
- To resume: Aravind writes the ledger row (step 7 below); then 6a (refusal, `UNCLASSIFIED`), 6b (classify `d2` and any other unclassified test document as postgres through the helper with the run's PM `users.id`: test rows in a run-scoped tenant), 6c (DOWN, md5s back to `cecc170b…`/`b5467b20…`/`4a7f4703…`, fingerprint `fa50d7fd…`, comments hash `9b773b73…`), 6d (re-apply, read-back equal to step 3; whether the DOWN touches the ledger row is to be read from its text and observed then, not assumed here), 6e (teardown and the #349 count).

## Step 7: ledger (Aravind's step; NOT run by me)

Workdir prepared (a sha-identical copy, no ledger write): `/tmp/quoco/cli-wd-052` holds `supabase/migrations/052_mi_kind_deferred.sql` (sha256 `2c4ee3bc…6357e`, equal to the held file) and `supabase/.temp/project-ref` (`exfccwlrhoutkgrlikod`). Command for his own terminal:

    cat /tmp/quoco/cli-wd-052/supabase/.temp/project-ref   # must print exfccwlrhoutkgrlikod
    shasum -a 256 /tmp/quoco/cli-wd-052/supabase/migrations/052_mi_kind_deferred.sql   # must print 2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e
    supabase --workdir /tmp/quoco/cli-wd-052 migration repair --status applied 052 --linked

Verify: `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;` ends `052 mi_kind_deferred`, and `supabase --workdir <main checkout> migration list --linked` shows 052 on both sides. Delete the workdir afterwards.

## Apply GO list

| Item | Status |
|---|---|
| PG17 dry-run, executed DOWN incl. seeded unclassified refusal (local) | DONE (dry-run evidence, earlier blocks) |
| Privilege matrix through the API incl. anon 42501 and no-`Content-Profile` 404 | DONE (`rehearsal-step4-matrix.txt`) |
| S-4 helper function-level REVOKE firing | DONE (`rehearsal-step4z-helper-revoke.txt`) |
| S-5 engineer and admin-without-membership refusals on test-db | DONE (rows g, h) |
| N-2 `private` absent and A3/A3b extension probes on test-db | DONE (`rehearsal-step1-preapply.txt`) |
| Measured lock hold | DONE, as a sampled bound of at most about 200 ms |
| `FOR UPDATE` proof on test-db | DONE (5.0b) |
| Two-caller race on test-db | DONE with the limits stated above |
| DOWN on test-db with the unclassified refusal, DOWN, re-apply, teardown | STILL OWED (waits for the ledger row; 6a refused on the ledger precondition) |
| S5 dark-control record | STILL OWED |
| External probe immediately before prod apply | STILL OWED |
| Prod helper probe (`to_regprocedure('public.quoco_test_capture_insert(text,jsonb)')` and `quoco_test_capture_update` IS NULL on prod) | STILL OWED |
| Prod md5 re-read with the prod ref printed | STILL OWED |
| A prod count of `invoice`-flow sessions (A0 aborts on any) | STILL OWED (new, from the leak above) |

## Unknowns and mismatches

- Why the two leaked runs' teardown did not complete (see findings).
- The step 6 expectation mismatch (ledger precondition), above.
- The race winner was the first-issued caller in all 40 runs; whether a genuinely symmetric interleaving occurred is not shown.
- `pg_get_functiondef`-based md5s of the pre-052 bodies tie to prod only by the md5 Aravind pasted (unchanged caveat from the package).
