git status --porcelain at the run: (empty line, clean tree), captured in `docs/reviews/c5-evidence/test-run-f7702a6.txt` lines 1-6.

# C5 review package — `capture_ingest` job handler (PR-C slice C5, FULL tier, dark)

**Repo state.** `main @ a84f6e53a68d44e22b34601a575c9346eafe3dd4` (parents `f55431c8…`, `41e8db66…`; fetched, printed, matched at the start of the build). Branch `feat/pr-c-c5-ingest`. No migration in this PR, so `supabase migration list` was not run and nothing was applied; last runbook executed: 051 prod apply, 28 Oct 2026 (`docs/reviews/051-prod-apply-record.md`). Design review: GO, `docs/reviews/c5-plan-review-round-1.md` (review of the plan, not of this code). **This package is what the external review of the CODE needs; merge waits for that review (CLAUDE.md section 0, FULL tier).**

**Pinned artifacts.** Tests, tsc and eslint ran at commit **`f7702a6c91e5a08b37d5ad443cdfac688b7797c5`** with an empty `git status --porcelain` (symlinked `node_modules` and `.env.test` are gitignored). Every commit after it changes only files under `docs/reviews/c5-evidence/` and this package (checked at the end: `git diff --stat f7702a6..HEAD` lists only those paths). Raw output: `docs/reviews/c5-evidence/test-run-f7702a6.txt`. Controls transcript: `docs/reviews/c5-evidence/controls.txt`. Build log (not committed): `/tmp/quoco/c5-build.txt`.

**Rebuild note (2026-10-28).** The first push was refused by GitHub push protection: the test files carried a dummy Twilio account SID shaped like a real one (`AC` + 32 hex). Nothing had been pushed, so the local branch was rebuilt: commits `570764f` and `a7f7f23` (the green characterization and the red capture_ingest assertions) are unchanged; the later commits were replayed with a non-hex dummy SID (`test/unit/capture-ingest-support.ts`, the leak scanner now also flags that literal). The earlier pinned SHA (`05f3fd3`) no longer exists on the branch. Everything in this package was therefore re-run at `f7702a6`, and the two controls that depend on the dummy SID (URL guard, C6 leak scan) were re-run red (marked RE-RUN in `controls.txt`). The other controls ran before the rebuild; the production code they mutate is byte-identical, only test constants changed.

**Plan and decisions.** `docs/plans/pr-c-c5-plan.md`, section "Decisions and review amendments, 2026-10-28" (Q1-Q16, S1-S5, N1, N2). Where a sentence above it differs, that section wins.

## 1. What is in the PR

| File | Change |
|---|---|
| `lib/media/capture-ingest.ts` | new: the handler, byte checks, streaming download, dead letter |
| `app/api/jobs/tick/route.ts` | `case 'capture_ingest'` (line 81) and the wrapped dead-letter branch (lines 262-277) |
| `lib/queue/jobs.ts` | one union member, line 23 |
| `test/capture-ingest.test.ts` | new, 53 tests against real test-db rows and real Storage |
| `test/unit/capture-ingest-bytes.test.ts`, `test/unit/capture-ingest-support.ts` | new: 60 no-DB tests; shared builders |
| `test/unit/jobs-tick-dispatch.test.ts` | new, 20 tests; 16 of them green against the UNEDITED route (commit 570764f) |
| `docs/plans/pr-c-c5-plan.md`, `docs/reviews/c5-plan-review-round-1.md`, `docs/reviews/c5-review-package.md`, `docs/reviews/c5-evidence/*` | records |
| `docs/plans/pr-c-plan.md` (Rev 5 note), `CLAUDE.md` (one line: "60s function timeout" struck, 300 s observed) | records |

Not touched (scope proof in `/tmp/quoco/c5-scope.txt`, section 8): `supabase/**`, `lib/whatsapp/**` (only `readCredentials` is imported), `lib/media/ingest.ts`, `lib/media/hindrance-ingest.ts`, `lib/observability/**`, `types/database.ts`, `test/webhook.test.ts`, `test/helpers/**`, `package.json`, `vercel.json`, CI workflows. No user-facing string. The module sends no message of any kind (R5/A11).

## 2. Contract table, current (C1-C8 and the review findings)

Line numbers are in `lib/media/capture-ingest.ts` ("CI") at `f7702a6`.

| # | Item | Code | Tests (all green at `f7702a6`) | Control (real mutation, red, reverted) |
|---|---|---|---|---|
| C1 / S2 | `upsert:false`, `contentType` = detected type, row-owned extensionless path (Q3) | CI:`processOneFile` upload call (about 590-600), `rowPath` 500 | T-OK-1 (options `{upsert:false,contentType:'image/jpeg'}`, path = `tenant/project/doc/fileId`, no `.`), T-PDF (every upload), T-C1-static, T-S2-REAL | C1 `upsert:true`; S2 `contentType` dropped; Q3 path gains `.jpg` |
| C2 | no overwrite or delete of storage objects | whole module | U-C2-static (scans code for `.remove(` `.move(` `.copy(` `upsert: true` `createSignedUploadUrl` storage-update), T-RETRY-2 (object bytes still X) | C2 planted `.remove(`; 3.4 hash compare removed; C1 `upsert:true` |
| C3 | all terminal details in ONE update | `finishFile` 513, `stored` SET in `processOneFile` | T-OK-1 (exactly 1 update, keys), T-PDF (keys per outcome) | C3 status-only update (the DB refuses it) |
| C4 | every UPDATE filters `id`, `tenant_id`, `document_id`, `ingest_status IN ('pending','failed')` | `guardedUpdate` 452 (the only writer) | T-OK-1 and T-DL-1 assert the recorded filters; T-C4-1 (stored row: 0 rows, no error; unfiltered raw update: `QE011`) | C4 status filter removed |
| C5 | `QE011` (and `QE009 QE014 23514 42501`) = alert, not retry | `NON_RETRY_DB_CODES` 386, `finishFile` 513-519 | T-C5-1 (each code: one event, one update attempt, job completes), control test with `08006` retries, T-C5-2 (real `QE011` code from test-db) | C5 `QE011` removed from the set |
| C6 | table named; no URL, phone, SID, token, body, tenant or user id | `captureEvent` 376; thrown messages are fixed strings plus counts | T-C6-1 scans every Sentry event and thrown message of the file (also `extra.table === 'capture_files'` and a key whitelist); U-C6-static (no `console.`); control scanner test | C6 an event carries a media URL |
| C7 | SET list inside the 051 grant | `CAPTURE_FILES_UPDATE_COLUMNS` 29 | U-C7-1 (compares with the GRANT text in the migration file), T-OK-1/T-PDF (every update's keys) | C7 `ingested_at` added (also refused by the DB) |
| C8 | stop C5, never run 051's DOWN | none (operations) | none | n/a, see section 7 |
| S1 | 0-row UPDATE: re-read, no fresh store | `finishFile` 526-551 | T-S1-1 (different sha: `update_noop`, not counted), T-S1-2 (same sha and path: `alreadyDone`) | S1 0 rows = success |
| S3 | one deadline over every network call (fetch 15 s, upload 30 s, existing download 15 s, DB 10 s, start gate 20 s, hard 90 s) | `Budget` 237, `guard()` before each call | T-MULTI-3, T-S3-1 (clock past the deadline before the upload: no upload, deferred, row pending), T-S3-2 (past it between upload and UPDATE: no UPDATE; the retry certifies the same object) | S3 guard before the upload removed |
| S4 | `%PDF-` anywhere in the first 1024 bytes | `detectContentType` 138 | unit: byte 0, 200-byte prefix, 1019, after 1100; DB: prefix-200 PDF stored as `application/pdf` with identical bytes, prefix-1100 rejected `wrong_type` | S4 byte-0-only |
| S5 | `too_large` keeps the detected type; `byte_size` NULL | `downloadChecked` 286, `processOneFile` | T-SIZE-4 (row `rejected/too_large`, `content_type image/jpeg`, `byte_size` NULL, update keys `ingest_status, reject_reason, content_type`, no object) | n/a (asserted) |
| N1 / N2 | 1-20 files; wrapped dead letter | `parsePayload` 197; route.ts 265-278 | unit parsePayload; T-TICK-CI-3 | N2 unwrapped dead letter |

Other plan items and their controls (all in `controls.txt`): identity (T-ID-1..4; control: verification disabled), type from bytes (control: magic check removed; control: claimed type trusted), size cap while streaming (unit tests incl. an endless 1 MiB-chunk generator and a "naive `arrayBuffer()` reader pulls all 40 MiB" counter test; control: cap raised 1000x), skip terminal rows (T-SKIP; control: skip removed), per-file independence (T-MULTI-1/2; control: fail-fast), dead letter (T-DL-1..4; control: no rows updated), Twilio auth header (control: header removed), URL guard (T-TW-5; control: guard disabled), planted send import (T-R5-1 static), dark state (U-DARK-1; control: planted `enqueueJob('capture_ingest'`), tick (T-TICK-CI-1..3; control: dead letter without `!willRetry`), hygiene (T-HYG-1; control: teardown not removing objects).

## 3. C7 diff, re-run with the final SET lists

Grant (`supabase/migrations/051_capture_files_immutability.sql:288`): `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`.

| Outcome | SET columns |
|---|---|
| stored | `ingest_status, content_type, byte_size, sha256, storage_path, preview_state` |
| rejected / wrong_type | `ingest_status, reject_reason` |
| rejected / too_large | `ingest_status, reject_reason, content_type` |
| failed (quarantine, dead letter) | `ingest_status` |

```diff
  grant                  C5 union
  ingest_status        = ingest_status
  content_type         = content_type      (stored; rejected/too_large)
  byte_size            = byte_size         (stored only)
  sha256               = sha256            (stored)
  storage_path         = storage_path      (stored)
  reject_reason        = reject_reason     (rejected)
  preview_state        = preview_state     (stored)
+ nothing in C5's lists is outside the grant
- nothing in the grant is unused
  not granted, not written: ingested_at (trigger-stamped), the nine identity columns
```

## 4. Raw observations that were unknowns in the plan

- **U1 (function limit).** The Vercel project default is **300 s**. Source: Aravind, console screenshot, 2026-10-28; **not observed by Claude Code**. The code's worst case is the 90 s job deadline plus the sweeps that run before jobs are claimed.
- **U2 (duplicate-upload error), observed on test-db** (`test-run-f7702a6.txt` lines 52 and 82):
  `U2 RAW duplicate-upload error object from test-db: {"name":"StorageApiError","status":400,"statusCode":"409","message":"The resource already exists"}`
  A duplicate arrives as HTTP 400 with `statusCode '409'`, not as `status 409`; the classifier checks `status`, `statusCode` and the message.
- **U3 (bucket), observed on test-db** (`test-run-f7702a6.txt` line 16), compared with 049 by T-PRE-1 (passes):
  `{"id":"capture-documents","name":"capture-documents","owner":"","public":false,"file_size_limit":16777216,"allowed_mime_types":["application/pdf","image/jpeg","image/png","image/webp"],...}`
- **Review S2, observed** (line 20): `T-S2-REAL RAW error: {"status":400,"statusCode":"415","message":"mime type text/plain is not supported"}`. The bucket does refuse an upload without the right `contentType`.
- **QE011 shape, observed** (line 38): `{"code":"QE011","message":"E11"}` as `error.code` through PostgREST (closes the plan's U7).
- **T-HYG-1** (line 81): `rows: start=0 peak=63 after=0; objects: start=0 peak=29 after=0; jobs after=0; tracked paths=64`. Counted with a real `list` call and a row count under this file's two run-scoped tenants.
- **Pre-edit red** (commit `a7f7f23`, run before any production code existed): `T-TICK-CI-1` failed with `failJob` called with `"job-1", "Unknown job type: capture_ingest"`; 3 of 20 tests red, 17 green (the 16 characterization tests plus the structurally passing `T-TICK-CI-1b`).

## 5. Test list (all green at `f7702a6`: 133 of 133 in the three C5 files; 78 files / 1146 tests in `test/unit`)

`T-PRE-1`, `T-S2-REAL`, `T-OK-1`, `T-PDF` (six files in one document), `T-SIZE-1` (exactly 16777216 bytes stored through the real bucket), `T-SIZE-4`, `T-ID-1..4`, `T-SKIP-1/2`, `T-C4-1`, `T-C5-1` (x5 codes), `T-C5-2`, `T-S1-1/2`, `T-S2`, `T-RETRY-1..4`, `T-MULTI-1/2/3`, `T-S3-1/2`, `T-DL-1..4`, `T-TW-2` (x6 statuses), `T-TW-3`, `T-TW-5` (x3), `T-C6-1`, `T-NET-1`, `T-HYG-1`; unit: detect/analyse/URL/storage-error/payload/streaming/static/dark-state; tick: `T-TICK-EXIST-1..3`, `T-TICK-CI-1..3`.

Tests that prove no concurrent property are none; **race and concurrency behaviour is "CI-only, not verified locally"**: two workers on one job, and the 0-row UPDATE where a second worker finishes the row mid-job are exercised only by an injected wrapper that moves the row (T-S1), not by real concurrency.

## 6. Decisions the code makes where the plan was silent (please check)

1. A database refusal (`QE011 QE009 QE014 23514 42501`) leaves the row as it was and raises one event; it does not try a second write to mark the row `failed` (that write would likely be refused for the same reason). The row then falls under accepted Q16.
2. Quarantine (`failed` + one event) covers: URL guard, deterministic storage 4xx, object conflict.
3. Events are aggregated per job and kind (counts), not per file.
4. `failed` rows are processed again if a job is replayed (051 allows `failed -> stored/rejected`); only `stored` and `rejected` are skipped.
5. Credentials missing -> the job throws a fixed retryable message before any row is touched.
6. Files are processed one at a time, in `file_no` order; peak memory about two copies of one file (about 32 MiB) per job.

## 7. Dark state, rollback, PITR

- **Dark.** Only migration 050 creates `capture_ingest` jobs (`050:378-379`); U-DARK-1 locks in that no TypeScript does. They are created only through `apply_material_inward_turn`, reached only behind `isCaptureDigit4Live` (constant `false`, `capture-switch.ts:6`, plus `CAPTURE_DIGIT4_TEST_PHONES`, a Vercel env value this package cannot see). **Do NOT set `CAPTURE_DIGIT4_TEST_PHONES` on prod until C5 is deployed and verified.**
- **Read-only prod checks (SQL text; Aravind runs, before and after deploy; all three must match while dark):**
  `select count(*) from public.whatsapp_sessions where current_flow = 'invoice';`
  `select status, count(*) from public.jobs where type = 'capture_ingest' group by status order by status;`
  `select ingest_status, count(*) from public.capture_files group by ingest_status order by ingest_status;`
  Expected: 0; empty; empty (prod `capture_files` had 0 rows on 28 Oct, `051-prod-apply-record.md`).
- **Rollback.** Revert C5 and redeploy; never 051's DOWN (it refuses over terminal rows; `051-apply-runbook.md` section e). After a revert, in-flight `capture_ingest` jobs burn their 5 attempts and die with no data change; their files stay `pending`. Rows C5 already made terminal are immutable (051), so a C5 bug that writes a wrong `content_type` or `sha256` is **not repairable by rollback**; this is why detection has the heaviest tests and why the D-30 test (with a scanner-app PDF) must precede C6.
- **PITR.** Off until launch. For C5: option (b), a hashed "substituted" readback just before the D-30 test (Rev 5 in `pr-c-plan.md`). No schema change here, so nothing for a restore to undo structurally.

## 7b. C6 entry gate additions (recorded in `pr-c-plan.md` Rev 5)

(1) A scan for jobs stuck in `running` with a deduplicated alert, or a reaper, also covering rows left `pending` after a non-retryable alert, unless PR-D's 15-minute rule is live. (2) The D-30 test includes one PDF from a scanner app.

## 8. Unknowns and open points

- Real Twilio redirect behaviour (Authorization dropped on the cross-origin hop) is not observed; the code mirrors `ingest.ts` (`redirect` default). An unauthorised redirect target would surface as `http401/403`, retryable then dead-lettered.
- Real Twilio media for a scanner-app PDF (prefix size) is untested until D-30.
- 300 s is Aravind's screenshot, not an observation by Claude Code.
- A mutant of the streaming cap with the endless-stream test would allocate without bound; that one case is covered by the finite-stream tests and the in-test naive-reader counter, not by a mutation (documented in `controls.txt`: the first cap-control run crashed the worker because a failed assertion tried to print a 16 MiB buffer; the test was fixed to compare a summary and the control was re-run red).
- The Q3 and hygiene mutants each left one storage object on test-db; both were found by T-HYG-1 or by a read-only listing and removed (note lines in `controls.txt`); the bucket had 0 orphans afterwards.

## 2026-10-29 CI fix-up (test-only)

- **Failing run.** https://github.com/ara-2789/Quoco/actions/runs/40696249241 (headSha `725576ff`, Test job failed).
- **Cause.** `test/capture-handler.test.ts` T-NOWRITE-1 ("no file under lib/ or app/ mentions capture_files") now found `lib/media/capture-ingest.ts` and `app/api/jobs/tick/route.ts`. C4a wrote that guard to hold until C5 (its own comment said so). C5 is the planned exception. I did not run `test/capture-handler.test.ts` before the first push (my regression run covered the C5 files and `test/unit` only); that was the gap.
- **Change (one test file, no production code).** T-NOWRITE-1 is narrowed, not removed: (a) the files under `lib/` and `app/` that mention `capture_files` are EXACTLY `app/api/jobs/tick/route.ts` and `lib/media/capture-ingest.ts`; (b) the handler contains no `.insert(`, `.upsert(` or `.delete(`; (c) the tick route contains no `.from('capture_files')`. The scanner helper and its control are kept. Commit `3a45052` (`test(c5): narrow T-NOWRITE-1 to the planned C5 exception`); the PR head is the docs commit after it, `git diff --name-only 725576ff..HEAD` lists only that test, this section and `c5-evidence/fix-controls.txt`.
- **Controls** (real mutations, HEAD and file sha256 printed, red, reverted, hashes equal): `c5-evidence/fix-controls.txt`. (1) `capture_files` planted in a comment in `lib/queue/jobs.ts` -> (a) red; (2) `.insert(` planted in a comment of `capture-ingest.ts` -> (b) red; (3) `.from('capture_files')` planted in a comment of the tick route -> (c) red.
- **Runs at `3a45052`** (project ref `exfccwlrhoutkgrlikod`): all 11 `test/capture-*.test.ts` files in one process: 11 files passed, 315 tests passed, 7 skipped (pre-existing rehearsal-only tests); `test/unit`: 78 files, 1146 tests passed; `tsc --noEmit` clean; eslint on the test file 0 warnings.
- **Reviewer's GO named `725576ff`.** The external reviewer needs to acknowledge this diff (one test file) on top of that SHA before merge.
