# C5 plan — `capture_ingest` job (PR-C slice C5)

PLAN ONLY. No code, no commit, no push, no database call, no supabase command, no network call (the one `git fetch` was explicitly ordered). Proposed branch (not created): `feat/pr-c-c5-ingest`. Tier: **FULL** (`docs/plans/pr-c-plan.md` section 2, row C5, line 65; retier note line 68).

**Base (printed, matched).** `git fetch origin && git log -1 --format='%H %P' origin/main` printed `a84f6e53a68d44e22b34601a575c9346eafe3dd4 f55431c8c846ff35a48d3f5c972219fc03b16b3d 41e8db66d9450ab94bb3d68269e98b70c72750db`. Expected `a84f6e53…` / `f55431c8…` / `41e8db66…`: match. The local checkout is at `2c4cf74` and is behind; every file below was read as `git show origin/main:<path>` (numbered copies in `/tmp/quoco/src/`), never from the working tree.

**Logs.** Every shell command and its raw output: `/tmp/quoco/c5-plan-probes.txt`. Files read with the Read tool (not shell, so not in that log) are listed in the Appendix.

**Marks.** `[read]` = I saw it at the cited path:line on `a84f6e53`. `[inferred]` = my reasoning, not seen in any file. Nothing is unmarked. A `[read]` on a document that quotes another document means I read the quote, not the original.

**Legend.** PC `docs/plans/pr-c-plan.md`; CF `docs/plans/pr-c-carry-forward.md`; V3 `docs/plans/slice-1a-plan-v3.md`; CED `docs/plans/capture-engine-design.md`; S049 `supabase/migrations/049_capture_tables.sql`; S050 `…/050_material_inward_functions.sql`; S051 `…/051_capture_files_immutability.sql`; R1/R2/R3 `docs/reviews/051-external-review-round-{1,2,3}.md`; REC `docs/reviews/051-prod-apply-record.md`; RB `docs/reviews/051-apply-runbook.md`; JB `lib/queue/jobs.ts`; TK `app/api/jobs/tick/route.ts`; IG `lib/media/ingest.ts`; HIG `lib/media/hindrance-ingest.ts`; FX `test/helpers/capture-fixtures.ts`; SND `lib/whatsapp/outbound/send.ts`; CS `lib/whatsapp/capture-switch.ts`; CM `CLAUDE.md`.

---

## 0. What C5 is, in plain words

050's engineer RPC already creates, in one transaction, the document, the delivery, one `capture_files` row per file (status `pending`, blank) and one `jobs` row of type `capture_ingest` whose payload carries `tenant_id, project_id, document_id, source_message_sid` and `files[] = {file_id, file_no, media_index, claimed_content_type, url}` [read S050:362-385]. Nothing consumes that job: today an unknown type hits `default: throw new Error('Unknown job type')` [read TK:84-85], so a `capture_ingest` job would burn its 5 attempts and die. C5 is the consumer: for each file it downloads the bytes from Twilio, checks the bytes themselves, stores the original in the private bucket `capture-documents` [read S049:1021-1024], and writes the result into the row once, using the seven-column UPDATE grant 051 gave `service_role` [read S051:288-289]. The engineer is told nothing at job time (R5/A11, section 3.7). The PM page that shows the result is PR-D.

Why FULL: it writes tenant files to storage and tenant rows with a column grant (PC:68).

---

## 1. The C5 contract (051 review) — source quoted, then mapped to code and tests

The C-numbers are the brief's. The reviewer's own text is below each.

| # | Contract item | Source text (file:line) | Code (new `lib/media/capture-ingest.ts`, "CI") | Test (new `test/capture-ingest.test.ts`, "T", DB; `test/unit/…`, "U", no DB) |
|---|---|---|---|---|
| C1 | upload `upsert:false` to a row-owned path `<tenant>/<project>/<document>/<file_id>`~~`.<ext>`~~ (DATED CORRECTION 2026-10-28, Q3 and review ruling: NO extension; see "Decisions and review amendments"), satisfying `capture_files_storage_path_prefix_chk` | R1:78 "upload with upsert: false to the row-owned path from B2" [read]; CF:19 [read]; the check itself S049:337 (document folder) and S051:174 (adds `/<id>`) [read] | one `uploadOnce()` is the only storage write; `{ upsert: false }` literal; path built from the ROW's verified `tenant_id/project_id/document_id/id` (not the payload's) + ext from detected type | `T-C1-1` every `upload` call spied: `upsert === false`, path matches both CHECK regexes; `U-C1-static` source has no `upsert: true`. Control: a raw `upsert:true` over a scratch object changes the bytes read back (proves the spy/readback can see an overwrite) |
| C2 | never overwrite or delete an object under a stored row | R1:79 "no code path in C5 overwrites or deletes an object under a stored row" [read]; S051:25-29 dated correction [read] | the module imports/uses no `remove`, `move`, `copy`, `createSignedUploadUrl`, `update` on storage | `U-C2-static`: the source text of `capture-ingest.ts` contains none of `.remove(`, `.move(`, `.copy(`, `upsert: true`, `createSignedUploadUrl`, `.storage.from(…).update`. Control: a planted `.remove(` in a temp copy fails the scanner |
| C3 | all terminal details in ONE UPDATE | R2:34 "Every terminal detail must now arrive in the SAME UPDATE" (S1) [read, via S051:8-14]; CF:39-40 [read]; CHECK `capture_files_details_terminal_only_chk` S051:183-184 [read] | one function `finishFile()` builds the whole SET object per outcome and issues exactly one `.update()` | `T-C3-1` per outcome (stored/rejected/failed) exactly one `update` call on the table, SET keys exactly as in section 2. Control: a two-step mutant (status first, details second) is refused by the DB with 23514, test red |
| C4 | every UPDATE filters `id AND tenant_id AND document_id AND ingest_status IN ('pending','failed')` | R1:104 "filter its UPDATE on ingest_status IN ('pending','failed'), so a retry touches 0 rows" [read]; the brief extends it with `id, tenant_id, document_id` | one helper `guardedUpdate(set, ids)` is the only caller of `.update()` on `capture_files` (also used by the dead letter); chain ends `.select('id')` so affected-row count is known | `T-C4-1` on test-db: wrong `document_id` → 0 rows; wrong `tenant_id` → 0 rows; row `stored` → 0 rows and **no error** (not QE011). Control: the same UPDATE through a raw client WITHOUT the status filter on the stored row → `error.code === 'QE011'`. This shows the filter is what prevents QE011 |
| C5 | QE011 = Sentry alert, NOT retry (job completes, no loop) | R1:106 "C5 must treat QE011 as an alert, never as a retry" [read]; CF:22 | `classifyDbError(err)`: codes `QE011, QE009, QE014, 23514, 42501` → **alert, non-retryable**; anything else → retryable (Q5) | `U-C5-1` stub client returns `{error:{code:'QE011'}}`: exactly one Sentry event, handler returns normally (no throw), exactly one UPDATE attempted (no loop). `T-C5-2` real test-db: raw UPDATE of a stored row yields `error.code === 'QE011'` (this also settles U7, PostgREST pass-through). Control: a code outside the set (`'08006'`) makes the handler throw (retry path) |
| C6 | logs and Sentry name the table; never URL, phone, Twilio SID or account SID, body, tenant id, user id | R1:122 "logs carry the table name, since E11 now means two tables" [read]; the exclusion list is the brief's (V3:233 [read] allows "ids" for P0 events; the brief is stricter, see conflicts) | `capEvent(kind, counts)` is the only Sentry caller: level `error`, `fingerprint:['capture-ingest',kind]`, `tags:{feature:'capture-ingest'}`, `extra:{table:'capture_files', jobId, …counts, errorCode}` where `errorCode` passes the C4a filter `/^[A-Z0-9]{5}$/` else `'unknown'` [read the filter: `lib/whatsapp/flows/material-inward.ts:86-89`]. Thrown messages are fixed strings plus counts, prefixed `capture_files ingest:`. No `console.*` | `U-C6-1` leak scanner over EVERY captured event and every thrown message: fails on `https?://`, `\+\d{8,}`, `\b(SM\|MM\|AC\|ME)[0-9a-f]{32}\b`, and the test's own known tenant id, project id, user id, Twilio token, caption/body literals. `extra.table === 'capture_files'` asserted on every event. Control: a planted event containing a URL fails the scanner. `U-C6-static`: no `console.` in the module |
| C7 | diff C5's UPDATE column list against the 7-column grant, BEFORE designing the UPDATE | R1:120 "C5's plan must enumerate its UPDATE column list and diff it against this grant before any C5 code exists" [read]; CF:25 [read] | exported `CAPTURE_FILES_UPDATE_COLUMNS` constant | **Diff pasted in section 2.** `U-C7-1` records every key of every `update()` payload across all outcomes and asserts ⊆ the literal 7 names. Control: adding `ingested_at` to a payload fails the test |
| C8 | if C5 misbehaves in prod: stop C5, never run 051's DOWN; state rollback order | R3:37 "If C5 misbehaves, you stop C5 and leave 051 in place" [read]; RB:119 [read]; CF:53 [read]; REC:49 [read] | none (an operations rule) | none (cannot be tested; stated in section 5) |

---

## 2. C7 first: the UPDATE column list, diffed against the grant

**The grant** [read S051:288-289]: `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) ON public.capture_files TO service_role;` Observed live on prod after the apply: exactly these seven, 17 columns walked [read REC:17].

**C5's SET lists** (each is ONE UPDATE; designed after this diff, not before):

| Outcome | SET columns |
|---|---|
| stored | `ingest_status='stored'`, `content_type`, `byte_size`, `sha256`, `storage_path`, `preview_state` |
| rejected | `ingest_status='rejected'`, `reject_reason` (`'wrong_type'` or `'too_large'`) |
| failed (anomaly quarantine and dead letter) | `ingest_status='failed'` |

```diff
  grant (S051:288)                         C5 union of SET columns
  ----------------                         -----------------------
  ingest_status                          = ingest_status        (all three outcomes)
  content_type                           = content_type         (stored)
  byte_size                              = byte_size            (stored)
  sha256                                 = sha256               (stored)
  storage_path                           = storage_path         (stored)
  reject_reason                          = reject_reason        (rejected)
  preview_state                          = preview_state        (stored)
+ (nothing in C5's list is outside the grant)
- (nothing in the grant is unused by C5)
  NOT in the grant and NOT written by C5:
    ingested_at     database-stamped by the trigger on the move to stored/rejected [read S051:254-256]; a caller change raises QE009 [read S051:233-235]
    the nine identity columns id, created_at, tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type [read S051:219-229]
```

**Outside the grant: none. Proceed.** (If the build ever needs a column outside it, the build stops, per the brief.)

Shape rules the three SET lists satisfy [read]: stored needs `storage_path, content_type, byte_size, sha256` [S049:332]; `byte_size <= 16777216` [S049:334]; `content_type` in the four types [S049:335]; `sha256` is 64 lowercase hex [S049:336]; `storage_path` starts with `tenant/project/document/<id>` [S051:174]; `storage_path, sha256, preview_state` only when stored [S051:168-169]; `reject_reason` iff rejected [S051:167]; `content_type` and `byte_size` only on stored/rejected [S051:183-184]. Consequences, stated so nobody is surprised:

- A **rejected** row carries ONLY `reject_reason` in C5 (the brief's C3 shape). `content_type` stays NULL for `wrong_type` because the CHECK only admits the four accepted types, so an observed foreign type could not be recorded anyway. `byte_size` also stays NULL on `too_large`: the download is aborted mid-stream, so the true size is not known (Q7).
- A **failed** row carries nothing but the status, because `content_type`/`byte_size` must be NULL on non-terminal rows [read S051:183-184].
- Rows C5 writes as terminal are **immutable afterwards** [read S051:239-244]. A C5 bug that writes a wrong `content_type` or `sha256` cannot be repaired by C5 or by `service_role`; it needs the owner with triggers disabled and its own reviewed artifact (CF:42-43, CF:50-51 [read]). This is the reason the detection code gets the heaviest tests and the D-30 real-phone test (PC:179-199) runs before any engineer is switched on.

---

## 3. The thirteen answers

Common structure of the handler, so each answer can point at it (`[inferred]` design, decided here):

```
handleCaptureIngestJob(payload, deps{ supabaseClient?, fetchFn?, now?, fetchTimeoutMs?, startGateMs? }) -> counts
  1 validate payload shape by hand (no zod, see Q9)          -> invalid: event 'payload_invalid', RETURN (job completes)
  2 read rows:  select id,tenant_id,project_id,document_id,source_message_sid,media_index,file_no,ingest_status
                from capture_files where id in (payload file ids) and tenant_id = payload.tenant_id
  3 verify identity of EVERY file (3.1)                      -> any mismatch: event 'identity_mismatch', RETURN (job completes), no download, no write
  4 for each row in file_no order, ONE AT A TIME:
       stored|rejected -> skip (3.5)
       pending|failed  -> processOneFile(row) -> {stored|rejected|failed|retryable|anomaly}
  5 if any file is 'retryable' (incl. deferred by the time budget) -> throw CaptureIngestIncompleteError(counts only)
    else return counts   (job completes)
markCaptureIngestFailed(supabase, payload, lastError, jobId)   // dead letter, called by the tick only when retries are exhausted
```

### 3.1 Payload trust (answer 1)

- **Design.** The payload is untrusted input: it is job JSON, and `service_role` can insert `jobs` rows [inferred: `enqueueJob` does it, JB:60-82 read]. Before any download:
  1. Read the rows `WHERE id IN (payload file ids) AND tenant_id = payload.tenant_id`. The tenant filter is in the WHERE because CM section 4 forbids a DB query without `tenant_id` [read CM §4]; a payload whose `tenant_id` differs from a row's therefore returns no row for that id, and **a missing row is treated as a mismatch** (conflict 3 below: the brief says "load by file_id and verify tenant_id", the outcome is identical, the query stays tenant-scoped).
  2. For every file, compare the row to the payload: `project_id`, `document_id`, `source_message_sid` against the payload's top-level fields, and `file_no`, `media_index` against that file entry. Any difference, or a row count different from the payload's file count, is a mismatch.
  3. **Any** mismatch fails the whole job closed: no download, no storage call, no UPDATE, one counts-only event `identity_mismatch` (`extra:{table:'capture_files', fileCount, mismatchCount, jobId}`), job completes (no retry loop). Rationale: 050 produces the payload in one transaction, so a payload that is partly wrong is not what 050 produced; the matching remainder is not worth trusting (Q1 offers per-file instead).
  4. After step 3 the storage path is built from the **row's** values, never the payload's.
  5. The one payload field the DB cannot verify is `url` (not stored in the table). It gets its own guard, section 3.8.
- **Tests (DB, real 050 payload).** Seed with the real flow (`makeDoc`, FX:340) so the payload is the one 050 wrote [read FX:340-351]; read it back from `jobs` by `payload.tenant_id` (FX:235 pattern).
  - `T-ID-1` cross-tenant: tenant A's file ids with `payload.tenant_id = tenant B` → no fetch call, no storage call, no UPDATE, rows unchanged, one event, handler returns.
  - `T-ID-2` (`it.each`) payload `project_id` swapped for A's other project / `document_id` swapped for another document / `source_message_sid` altered / a `file_id` that does not exist → same assertions.
  - `T-ID-3` one of three files mismatched → the other two are NOT processed (documents Q1's default).
  - **Positive control `T-OK-1`:** the unmodified payload processes (rows `stored`). Same fixture, one field changed, opposite outcome: the check is what changed the result.

### 3.2 Byte checks (answer 2)

- **Magic bytes** (on the first bytes only; `claimed_content_type` and the HTTP `Content-Type` header are never read for the decision) [inferred design from V3:203 "byte-level PDF checks only: `%PDF-` at byte 0" and the brief]:
  - PDF: bytes 0-4 = `25 50 44 46 2D` (`%PDF-`).
  - JPEG: bytes 0-2 = `FF D8 FF`.
  - PNG: bytes 0-7 = `89 50 4E 47 0D 0A 1A 0A`.
  - WebP: bytes 0-3 = `52 49 46 46` (`RIFF`) AND bytes 8-11 = `57 45 42 50` (`WEBP`) (so a RIFF/WAVE file is wrong type).
  - Anything else, or fewer than 12 bytes available when needed, or an empty body → `rejected / wrong_type`.
  - Stored `content_type` is the detected type: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`; ~~object extension `.pdf .jpg .png .webp`~~ (struck 2026-10-28, Q3: the object path has no extension; the type is stored in the row and in the object's metadata).
- **Size cap `CAPTURE_MAX_BYTES = 16 * 1024 * 1024 = 16777216`** (V3:203 name; equals the CHECK, S049:334, and the bucket's `file_size_limit`, S049:1022 [read]). Boundary: exactly 16777216 is accepted; 16777217 is `too_large`.
- **Enforced while downloading (how).** `fetchFn(url, {headers, signal})` returns a `Response`. The module never calls `res.arrayBuffer()` or `res.blob()` (IG:118 does, and CED:213 records that as open item O20 [read]). Instead it reads `res.body.getReader()` chunk by chunk:
  1. buffer chunks until at least 12 bytes are available, run `detectType`; no match → `reader.cancel()` and the controller aborts → `wrong_type`;
  2. after the magic passes, if a `Content-Length` header is present and `> MAX` → cancel, `too_large` (an early-out only, never trusted as the limit);
  3. keep a running byte total; the moment `total > MAX`, `reader.cancel()` + `controller.abort()` → `too_large`. At most `MAX + one chunk` bytes are ever held. A lying or absent `Content-Length` is therefore harmless.
  - Precedence is fixed so the same file always gets the same reason: **wrong_type beats too_large**, because the magic check happens on the first chunk before any size decision.
  - Peak memory per file ≈ 2 × 16 MiB (chunks plus the concatenated Buffer) [inferred]; files are processed one at a time per job.
- **Tests (U, no DB: a fake `fetchFn` returning `new Response(new ReadableStream(…))`).**
  - `U-PDF-1` for each of the four types, bytes with the right magic → detected type returned; a claimed type that lies (claims `image/jpeg`, bytes are `%PDF-`) → stored as `application/pdf`. Wrong magic cases: HTML bytes claiming `application/pdf`, empty body, 2-byte body, RIFF+WAVE, `FF D8` (two bytes), PNG with a corrupted 8th byte → all `wrong_type`. **Control:** a mutant that trusts `claimed_content_type` stores the HTML as PDF and the test goes red.
  - `U-SIZE-1` boundary: a stream of exactly 16777216 valid-JPEG bytes → stored path; 16777217 → `too_large`. `U-SIZE-2` an endless generator (chunks of 1 MiB, counter of pulled chunks, `cancel()` flag): handler returns `too_large` with pulled bytes `<= 17 MiB`, `cancel` was called, upload never called. `U-SIZE-3` `Content-Length: 100` with a 20 MiB body → still `too_large`; `Content-Length: 99999999999` with a small valid body and valid magic → `too_large` via the early-out. **Positive control:** the same stream through a deliberately naive `await res.arrayBuffer()` reader pulls the whole body, proving the pulled-bytes counter can tell the two designs apart.
  - `T-SIZE-4` (DB) a too-large file ends `rejected/too_large` with `byte_size` NULL, `sha256`/`storage_path` NULL, and **no object under the row's prefix** (list = 0).

### 3.3 `preview_state` (answer 3)

- **Method (byte-level, no PDF parser, no new dependency; A12 "PDF checks stay byte-level in 1a (no PDF parser)" [read CED:246]; V3:203 names the two tokens `/Encrypt` and `%%EOF` [read]):**
  - Encrypted: the byte sequence `/Encrypt` appears anywhere in the file. Why this works [inferred from the PDF structure, not read here]: an encryption dictionary is referenced from the file trailer or the cross-reference-stream dictionary, both stored unencrypted, so a plain byte search finds the key. Known limits, accepted: a hex-escaped name (`/Encr#79pt`) would be missed (the PM then sees "previewable" for a PDF the browser cannot render: the original bytes are kept either way); the literal text `/Encrypt` inside a compressed-free content stream would false-positive to `not_previewable` (safe direction).
  - Unparseable (CED:237 A6 "an encrypted or unparseable PDF is stored and marked not previewable" [read]): no `%%EOF` within the last 1024 bytes → `not_previewable`.
  - Otherwise a PDF is `previewable`. JPEG/PNG/WebP are always `previewable`.
  - Result: row `stored` with `preview_state='not_previewable'` for an encrypted PDF. It is not rejected: bytes are kept unchanged [read CED:237].
- **Tests.** `U-PDF-2` a minimal PDF with a `trailer << /Encrypt 5 0 R >>` → `not_previewable`; the same PDF without it → `previewable`; a PDF with no `%%EOF` in the last 1024 bytes → `not_previewable`; `%%EOF` earlier than the last 1024 bytes only → `not_previewable`; images → `previewable`. **Control:** the encrypted and plain PDFs differ by exactly the `/Encrypt` token, so the token alone flipped the result. `T-PDF-3` (DB) the stored object's bytes are byte-identical to the downloaded bytes and `row.sha256` equals an independent `sha256` of the fixture (original bytes unchanged, V3:261 "original bytes" [read]).

### 3.4 Retry after a partial job (answer 4)

Case: the object is at the path but the row is still `pending` or `failed` (upload succeeded, UPDATE did not).

- **Rule chosen: upload with `upsert:false`; on a duplicate-object error, DOWNLOAD the existing object, hash it, compare with the fresh bytes' sha256.**
  - equal → the object is byte-identical to what would have been uploaded; do NOT upload again; proceed straight to the one UPDATE (`stored`, with the already-computed details). Nothing was written to storage.
  - different → Sentry event `object_conflict` (counts only), `guardedUpdate({ingest_status:'failed'})`, **no overwrite, no delete**; this file is non-retryable (a human decides). A later replay re-alerts, which is intended.
  - download of the existing object fails → retryable (`storage_failed`).
- **Why this rule.** (A) "skip the upload and trust the existing object" would certify bytes C5 never verified, the exact hole R1:72-74 describes (the bytes are not locked). (B) `upsert:true` is forbidden (C1/C2). (C) compare-by-hash (chosen) verifies equality without writing. (D) a listing before every upload costs a call on the happy path. Storage metadata has an etag but no SHA-256, so the hash needs the bytes [inferred].
- **How a duplicate is recognised** [inferred, to be observed on test-db]: the supabase-js `upload` error is a `StorageApiError` with numeric `status` and string `statusCode`; its JSDoc names the storage error `Duplicate` [read `node_modules/@supabase/storage-js/dist/index.d.mts:868-869`, v2.108.2]. The module treats `status === 409 || statusCode === '409'` as duplicate. The 409 itself is not read anywhere; `T-RETRY-1` observes the real error shape on test-db (unknown U2).
- ~~**Residual, stated.** If the retry's fresh bytes detect as a DIFFERENT type, the extension, hence the path, differs: no duplicate error fires and the first object is orphaned (unreferenced; C2 forbids deleting it).~~ STRUCK 2026-10-28 (Q3): the storage path has no extension, so every retry of a file lands on the same path and the duplicate -> hash-compare rule applies to every retry; this residual no longer exists. This needs Twilio to serve different bytes for the same media URL [inferred: not expected]. Q3 asks whether to remove the extension from the path to make the path independent of the detected type.
- **Tests (DB + real Storage).**
  - `T-RETRY-1` equal: pre-upload the same bytes at the row's path (as the earlier half-finished attempt would have), run the handler → row `stored`, `sha256` correct, **exactly one object** under the prefix, object bytes unchanged.
  - `T-RETRY-2` different: pre-upload bytes X, handler fetches bytes Y → row `failed`, object bytes **still X** (read back and compared), one `object_conflict` event, no throw, no retry.
  - `T-RETRY-3` the existing-object download errors (injected storage wrapper) → handler throws the retryable error, row still `pending`, object untouched.
  - `T-RETRY-4` full cycle: attempt 1 uploads, the UPDATE fails (client wrapper returns a network error on the first `update`) → throws; attempt 2 → `stored`; one object, one row. Every `upload` options object in all of these has `upsert:false`.
  - **Control (T-RETRY-2):** a mutant that uses `upsert:true` makes the object bytes become Y; the test's byte-readback assertion is red, which shows the assertion can fire.

### 3.5 A row already `stored` or `rejected` (answer 5)

- Rows are read in step 2 (3.1). A row with `ingest_status IN ('stored','rejected')` is **skipped**: no fetch, no storage call, no UPDATE. (The 051 trigger would refuse a change anyway: QE011 unless nothing changes [read S051:239-244]; C5 never reaches it.) `pending` and `failed` rows are processed: `failed → stored/rejected` is the sanctioned replay path [read S051:96-97; PC:401-402 Q10 "Accepted"].
- **Tests.** `T-SKIP-1` run the handler once (rows stored), snapshot `ingested_at` and the object, run it again with a `fetchFn` that throws if called and a spied storage client → 0 fetch calls, 0 storage calls, `ingested_at` unchanged (an UPDATE, even a no-op, would not change it either, so the spy on `.update` is the real assertion: 0 calls). `T-SKIP-2` same for a `rejected` row. **Control:** the same fixture with the row `pending` → fetch IS called.

### 3.6 Multi-file jobs and what job success/failure means (answer 6)

- **Per-file independence.** Files are processed in `file_no` order, one at a time. A failure in one file never stops the loop: its outcome is recorded and the next file runs. Memory is bounded to one file at a time.
- **Outcome per file** and what it does to the job:

  | File outcome | Row | Job effect |
  |---|---|---|
  | stored / rejected | terminal | none |
  | skipped (already terminal) | unchanged | none |
  | download failed / timeout / non-2xx / storage error / UPDATE network error / not started because the time budget ran out | stays `pending` or `failed` | **retryable**: job throws after the loop |
  | identity mismatch, invalid payload, URL guard, object conflict, QE011/QE009/QE014/23514/42501 | alert sent; `failed` where it is our row | **non-retryable**: counted, job does not throw because of it |

- **Job outcome.** The job throws `CaptureIngestIncompleteError` (message: `capture_files ingest: N of M files not completed (download:a storage:b update:c deferred:d)`, counts only, which becomes `jobs.last_error`) iff at least one file is retryable. Otherwise it returns and the tick marks it `succeeded` [read TK:159-161]. On retry the terminal rows are skipped (3.5), so only unfinished files cost anything again.
- **Retry budget** [read JB:36-41, 154-191]: `MAX_ATTEMPTS = 5`; `failJob` sets `attempt_count+1`, `next_retry_at = now + 60·2^n s` for n = new count, so the waits are 2, 4, 8, 16 min (the comment at JB:38 says "1min…16min"; the arithmetic gives 2…16: noted in conflicts), about 30 minutes from the first failure to exhaustion; the 5th failure makes `willRetry=false` and leaves status `failed` permanently [read JB:172, 190]; `claimJobs` stops selecting at `attempt_count >= 5` [read JB:98].
- **Time budget (needed because the tick runs everything inside one invocation and up to 3 jobs concurrently [read TK:154-157]).** Per-file fetch timeout `15 s` (headers+body, via `AbortSignal.timeout`, injectable); a new file is only STARTED while `elapsed < 20 s`; otherwise it is "deferred" (retryable, stays pending). Worst case about 35 s per job. The real function limit is unknown: CM §3 says "60s function timeout" [read], `vercel.json` sets only cron schedules and there is no `maxDuration` export anywhere (git grep returned nothing) [read], so the configured limit must be checked in the Vercel console (unknown U1; Q4). The three sweeps at the top of the tick (TK:104-152) also spend time before jobs are claimed [read].
- **Known gap, stated (not C5's to fix, but it shapes the alerts).** A function killed at the platform timeout leaves its jobs `running` forever: `claimJobs` only selects `pending`/`failed` [read JB:96] and no reaper exists in `app/` or `lib/` (git grep for `'running'` shows none for `jobs`) [read]. Such rows would stay `pending` with no alert. The PM page's rule "a pending file older than 15 minutes shows as failed" [read V3:119] is the only surface. Unknown U5.
- **Tests (DB).** `T-MULTI-1` three files: file 1's fetch returns 500, file 2 valid, file 3 wrong magic → after attempt 1: file 2 `stored`, file 3 `rejected`, file 1 `pending`, handler throws the count message. `T-MULTI-2` attempt 2 with file 1 healthy → file 1 `stored`, files 2/3 untouched (`fetch` called only for file 1), handler returns. `T-MULTI-3` budget: injected clock jumps past 20 s after file 1 → files 2-3 deferred, still `pending`, handler throws. **Control (T-MULTI-1):** a fail-fast mutant (throw on the first error) leaves files 2 and 3 `pending`; the assertions on files 2 and 3 are the ones that go red.

### 3.7 Dead letter (answer 7)

- **Where.** The existing pattern: `if (!willRetry && job.type === '…') await markXFailed(client, payload, message)` in the tick's catch [read TK:235-248]. New branch for `capture_ingest`: `markCaptureIngestFailed(client, payload, message, job.id)`.
- **What.** After the last attempt, every file of the payload still not terminal is moved to `failed` in **one** statement: `guardedUpdate({ingest_status:'failed'})` with `id IN (payload file ids) AND tenant_id AND document_id AND ingest_status IN ('pending','failed')` plus an extra `ingest_status = 'pending'` so the returned count means "moved just now" (Q6). `RETURNING` count = `failedCount`. Allowed by 051: `pending → failed` is an enumerated move [read S051:248]; the row shape holds (a `failed` row has no details [read S051:183-184], no `ingested_at` [read S051:179, 254-256]).
- **One Sentry error, counts only,** and only if `failedCount > 0` (nothing was lost otherwise): `captureMessage('capture_ingest: job exhausted all retries -- files not ingested', {level:'error', fingerprint:['capture-ingest','dead_letter'], tags:{feature:'capture-ingest'}, extra:{table:'capture_files', jobId, fileCount, failedCount, lastError}})`. `lastError` is the scrubbed count message above.
- **R5/A11: the engineer receives NOTHING at job time.** Sources: V3:185 "a job-time rejection shown here only (… R5; the engineer is told nothing, A11)" and V3:223 "No string for oversize or job-time rejection reaches the engineer (A11, R5)" [read]; CED:245 A11 "An oversize file shows to the PM only; the engineer gets no message" [read]. (Two different things are called R5 in V3: V3:185 and V3:261 `T-R5-1` mean the no-message rule; V3:408 "R5 (N13)" is a check-in risk. Noted in conflicts.) The engineer was already told "received" when the file arrived (`MI_FILE_RECEIVED`); that reply is unconditional.
- **Tests.** `T-DL-1` (DB) job payload with 3 pending rows + 1 stored row: dead letter → the 3 become `failed`, the stored row untouched, exactly **one** `update` call on `capture_files`, exactly one Sentry event with `failedCount = 3`, scanner-clean. `T-DL-2` a payload with another tenant's file ids → that tenant's rows untouched (C4 filters). `T-DL-3` (U, tick) dead letter is called only when `willRetry` is false; on attempts 1-4 it is not. `T-R5-1` (U, static + runtime): the module imports nothing from `lib/whatsapp/outbound/*` except `readCredentials` (type of import checked), contains no `Messages.json` / `sendWhatsApp`; every `fetchFn` call in every test is a GET to a media URL, none to a send endpoint. **Controls:** `T-DL-1` with the dead-letter call removed leaves rows `pending` (red); a planted `import { sendWhatsAppTemplate }` fails `T-R5-1` static.

### 3.8 Twilio download (answer 8)

- **Auth, same as IG:** `readCredentials()` from `lib/whatsapp/outbound/send` (imported, not edited) [read SND:154-172, IG:5,102-103], then `Authorization: Basic base64(accountSid:authToken)` [read IG:103,110-112]. `fetchFn` injectable, default global `fetch` [read IG:101].
- **Timeouts.** IG has none [read IG:110-112]. C5 adds a per-file `AbortSignal.timeout(fetchTimeoutMs)` (default 15 s) combined with the cap controller; a timeout is retryable.
- **Non-2xx handling.** `!res.ok` (IG:113 test) → retryable `download_failed` for every status including 401, 403, 404, 410, 429, 5xx: simplest, and the 5-attempt budget is cheap; the error message carries only the numeric status (`download:401`), never the URL (IG:114-116 interpolates a daily-log id, C5 does not). A 2xx with an empty or non-magic body is `wrong_type`, not an error.
- **URL use.** Used once, in memory, as the argument to `fetchFn`; never logged, stored, interpolated into an error message, a Sentry field or `last_error`. (The URL already sits in the 050 job payload [read S050:369]; C5 adds no second copy.) Fetch errors are caught and mapped to codes (`timeout`, `network`), the original `message` is discarded because undici errors can name the host.
- **Credential-leak guard (addition, Q2).** The payload URL is attacker-controllable by anyone who can write `jobs`, and C5 would attach the Twilio Basic credentials to it. IG and HIG do the same today [read IG:110, HIG:101-102]. Proposed: before the fetch, require `new URL(url)`: `protocol === 'https:'`, `hostname === 'api.twilio.com'`, `pathname.startsWith('/2010-04-01/Accounts/' + accountSid + '/')`. Failure → no fetch; `guardedUpdate({ingest_status:'failed'})`; event `url_guard` (counts only); non-retryable. Redirects: default `follow`, as IG; Authorization is dropped by the fetch standard on a cross-origin redirect [inferred: Fetch spec, not read here] (unknown U4). Side effect for tests: FX's `jpegMedia` uses `https://example.invalid/m/N` [read FX:275-277], which the guard rejects, so C5 tests pass their own Twilio-shaped URLs through `miTurn`'s `media` option (a shape-compatible array, no FX edit).
- **Tests.** `T-TW-1` the request seen by the fake `fetchFn` is a GET with exactly `Authorization: Basic base64(sid:token)`; the token string appears in no Sentry event and no thrown message. `T-TW-2` `it.each([401,404,410,429,500,503])` → no UPDATE, no storage call, row still `pending`, handler throws count message containing the status digits only. `T-TW-3` a `fetchFn` that honours `signal` and never resolves → aborted at the injected timeout → retryable. `T-TW-4` the scanner (C6) over all events and errors in all `T-TW` tests finds no URL. `T-TW-5` guard: `http://`, other host, `api.twilio.com.evil.example`, another account's path → no fetch ever made, row `failed`. **Controls:** `T-TW-1` with the header removed → the assertion on the header goes red; `T-TW-5` with a legit URL → fetch IS made.

### 3.9 Tick dispatch (answer 9)

- **Edits.** `lib/queue/jobs.ts`: add `'capture_ingest'` to the `JobType` union (JB:5-20). Required: `dispatchJob` switches on `job.type: JobType` [read TK:41-42] and a case outside the union does not compile. `app/api/jobs/tick/route.ts`: import; `case 'capture_ingest': await handleCaptureIngestJob(job.payload as unknown as CaptureIngestJobPayload, { supabaseClient: client }); return` placed with the other ingest cases (TK:60-75); a dead-letter branch after TK:245-248 in the same style. Nothing else in the file changes.
- **Existing job types unchanged: which tests prove it?** None today. `git grep` for `runJobsTick|dispatchJob|claimJobs(` in `test/` finds only comments and one unrelated sweep test [read]; `dispatchJob` is not exported [read TK:41]. The handler-level suites (`test/media-ingest.test.ts`, `hindrance-media-ingest.test.ts`, `dpr-generate-job.test.ts`, `owner-deliver-job.test.ts`) test handlers, not the switch [read file list; contents not opened]. So C5 adds the proof, written **first, against the unedited route**:
  - new `test/unit/jobs-tick-dispatch.test.ts`: `vi.mock` the five existing handler modules (`lib/dpr/dispatch`, `lib/dpr/owner-deliver-dispatch`, `lib/hindrance/pm-notify`, `lib/media/ingest`, `lib/media/hindrance-ingest`), the three sweeps, and `@/lib/queue/jobs` (`claimJobs` returns one job, `completeJob`/`failJob` spies). It never touches a database and never runs an unscoped claim (the CM/V3:247 rule against unscoped `runJobsTick` on test-db is respected [read V3:247, FX:9-10]). Cases: each of `dpr_generate, owner_deliver, hindrance_pm_notify, media_ingest, hindrance_media_ingest` reaches its own handler with its own arguments; `template_send, morning_trigger, evening_trigger, nudge` throw "No handler implemented yet" [read TK:79-83]; an unknown string throws "Unknown job type" [read TK:84-85]; the `media_ingest`, `hindrance_media_ingest`, `hindrance_pm_notify`, `owner_deliver`, `dpr_generate` dead-letter branches fire only when `willRetry` is false.
  - Order of work: this file is committed green against the unedited route, **then** the `capture_ingest` assertions are added (red: today `capture_ingest` throws "Unknown job type"; this is also PC:366's "a `capture_ingest` job with no handler fails (documents the current state)" test), then the route is edited. The unedited assertions stay unedited and green: that is the proof for "existing types unchanged".
  - `T-TICK-CI-1` capture_ingest reaches `handleCaptureIngestJob` with the payload and `{supabaseClient}`; `T-TICK-CI-2` its dead letter runs only when `willRetry` is false and receives `job.id`; **control:** the pre-edit characterization run shows the same job throwing "Unknown job type".

### 3.10 Dark state (answer 10)

- **Nothing creates a `capture_ingest` job in prod while digit 4 is dark.** Evidence, all read at `a84f6e53`:
  1. The only `INSERT INTO public.jobs … 'capture_ingest'` in the repository is S050:378-379. `git grep 'capture_ingest'` over `app lib test scripts supabase vercel.json` finds only that INSERT, two comments in S050 and test/fixture references; no TypeScript enqueues it (the `enqueueJob(` call sites are `dpr_generate`, `hindrance_pm_notify`, `hindrance_media_ingest`, `media_ingest`) [read].
  2. That INSERT is inside `apply_material_inward_turn`, and its only TypeScript caller is `lib/whatsapp/flows/material-inward.ts:114`; no other migration calls the function (only its definition, ACL and assertion appear) [read].
  3. The flow starts only through `inbound-start.ts:808` and `:1137`, both guarded by `isCaptureDigit4Live(phone)` [read], which is `CAPTURE_DIGIT_4_LIVE` (a constant, `false`, CS:6) OR the phone being on `CAPTURE_DIGIT4_TEST_PHONES` (CS:24-27) [read]. The env value is Vercel state and is **not** visible in the repo (unknown U10): it must be checked in the Vercel console, which is the source of truth for provider state (CM §0).
  4. The scheduled check-in start RPCs do not create `'invoice'` sessions [read PC:256].
  - `U-DARK-1` (lock it in): a static test scans `app/` and `lib/` for any `capture_ingest` string used as an enqueue/insert type; expected: none (the handler file mentions the string only in its own type guard/comments, whitelisted by path). **Control:** a planted `enqueueJob('capture_ingest', …)` in a temp copy fails it.
- **Read-only prod checks for Aravind (SQL text only; I run nothing).** Run before and after the deploy; with digit 4 dark all three must match.
  ```sql
  -- 1. sessions in the material-inward flow
  select count(*) as invoice_sessions from public.whatsapp_sessions where current_flow = 'invoice';
  -- 2. capture_ingest jobs, by status
  select status, count(*) from public.jobs where type = 'capture_ingest' group by status order by status;
  -- 3. capture_files, by status
  select ingest_status, count(*) from public.capture_files group by ingest_status order by ingest_status;
  ```
  Expected before: `invoice_sessions = 0`; query 2 empty; query 3 empty (REC:18 observed `capture_files` = 0 rows on 28 Oct, PC:256 recorded 0 `'invoice'` sessions on 20 Oct) [read]. Expected after: the same. A non-zero value is not necessarily a fault if `CAPTURE_DIGIT4_TEST_PHONES` holds Aravind's own phone and a test has run; then the rows must be his. Also confirm in Vercel: the deployment's commit SHA equals the merge SHA, and `/api/jobs/tick` keeps returning 200 each minute after deploy.

### 3.11 Test-db and storage hygiene (answer 11)

- **No network.** Every test passes `fetchFn` (a fake returning `Response` objects); Twilio is never contacted; Sentry is `vi.mock`ed; credentials come from `vi.stubEnv` dummy strings, never real ones. `T-NET-1` the recorded calls contain only GETs to the stubbed media URLs.
- **Phones.** None are created by the ingest tests themselves. Seeding through `makeDoc` uses `kit.phone()` → `+19995552NNNNNN` run-scoped [read FX:209-213, `run-scoped-fixtures.ts:62-69`]. The `+199955503XX` range is reserved to the outbound-send suite and is not used [read `test/helpers/db.ts:96`].
- **Rows.** Teardown deletes through `quoco_test_capture_cleanup(tenant)` (SECURITY DEFINER helper; `service_role` has no DELETE on `capture_files`) [read scripts/test-db-only-capture-helpers.sql:143-166, FX:228-233]. Jobs: `delete … type='capture_ingest' contains payload.tenant_id` [read FX:235]. Tenants/projects/users via `teardownCaptureKit` [read FX:229-261].
- **Storage objects: can teardown delete them?** Yes, from **test** code. `service_role` can `storage.from(bucket).remove([...])` on this project's other private bucket today [read `test/media-ingest.test.ts:257`, `hindrance-media-ingest.test.ts:41`]; there is no per-bucket policy for `capture-documents` either (S049:1016-1018 "No storage.objects policy, same as 042") [read], so the same call should work [inferred, observed in the first test run]. C2 constrains **C5's code**, not test teardown; the static guard `U-C2-static` scans only `lib/media/capture-ingest.ts`. The test file records every path it uploads (including via the handler) and removes them in `afterAll`.
- **Deltas only.** All counts are scoped to the test's own run-scoped tenant: `capture_files` rows by `tenant_id`, jobs by `payload.tenant_id`, objects by listing the prefix `<tenantId>/` in `capture-documents`. Each test records `before`, acts, asserts `after - before`; the file ends with `T-HYG-1`: after teardown, rows for both tenants = 0, objects under both prefixes = 0, jobs = 0. The shared bucket's global object count is never asserted (other CI runs write to it).
- **Preflight.** `T-PRE-1` fails loudly if `storage.getBucket('capture-documents')` is missing or its settings differ from 049's (unknown U3: the test-db bucket is expected from the "test-db carries the same migration" rule (CM §0 rule e) [read], not observed here).
- **Concurrency/race tests** (two workers on one job, row finished mid-job) cannot be proven locally; any such test is labelled CI-only "not verified locally" (CM §0 [read]).

### 3.12 FULL-tier sequence for C5 with no migration (answer 12)

Order (CM §0 two-tier text, FULL; no migration so no test-db apply, DOWN rehearsal, ledger row or types regen):

1. **External review** of a review package `docs/reviews/c5-review-package.md`: this plan's contract table made current, test list, the C7 diff, raw test output pinned with the commit SHA and an empty `git status --porcelain` line at the top (CM §0 ARTIFACT PROVENANCE), a repo-state header (`main @ <sha>`; migration list local/remote; last runbook run) per CM §0, and an asserted-vs-existing audit of every cited artifact.
2. **CI green** with the passing run's `headSha` equal to the PR head, pinned by run URL (CM §0 "A GREEN CI CHECK CERTIFIES A SHA").
3. **Merge** by regular merge commit (Aravind merges by hand).
4. **Deploy**: confirm the deployed commit in the Vercel console equals the merge SHA (deploy mechanism not read; unknown U10).
5. **Prod verification by observation**: the three read-only counts before and after (3.10), `/api/jobs/tick` still 200. **Limit, stated:** with digit 4 dark nothing exercises the new handler on prod, so its first live run is the D-30 real-phone test (PC:179-199) on Aravind's own allowlisted phone. That run is the real prod observation of ingest and belongs in the record.
6. **Written record** `docs/reviews/c5-deploy-record.md` (own docs commit) with the observed counts, SHAs and run URL.

**PITR snapshot?** PITR is OFF until launch [read CF:14, REC:30, PC:14]. Facts, not a decision (Q11):

- There is no schema change in C5, so nothing a PITR restore would undo structurally. The only writes C5 can make are the seven `capture_files` columns, Storage objects, and `jobs` status. Prod `capture_files` had 0 rows on 28 Oct [read REC:18] and stays 0 while dark.
- Terminal rows are immutable; a snapshot would not let `service_role` fix a wrong row. Storage objects are not part of database PITR [inferred; verify in Supabase docs], so PITR would not restore objects in any case.
- Options: (a) no snapshot at merge/deploy, rely on revert: lowest cost, valid while nothing writes; (b) a "PITR substituted" readback like 051's (counts of `capture_files` by status, `jobs` by type/status, the object count under the bucket, hashed) taken just before the D-30 test, when the first real rows could appear: small cost, gives a hashed before-state for the first real writes; (c) a full dump before D-30: heavy for a handful of test rows, and a restore of a dump over live triggers needs triggers disabled (CF:50-51 [read]).
- The word "substituted" must be recorded if (b) or (c) is chosen, as in 051 (CF:14).

### 3.13 Strings (answer 13)

**C5 sends no engineer message, owner message or PM message, and adds no user-facing string.** I looked for a path that seems to need one and found none:

- rejection (`wrong_type`, `too_large`): PM page only (PR-D labels `PM_LABEL_FILE_REJECTED_TYPE/_SIZE/_PENDING/_FAILED`, V3:224) [read];
- dead letter / failed: PM page + Sentry only;
- QE011 and trigger refusals: Sentry only.

Sentry message texts and fingerprints are developer-facing, not user-facing strings. Stop-list: **empty.** If the build discovers a path that wants an engineer message, it stops and lists it. One thing for awareness, not a string need: after a file is "received" the engineer may later be shown nothing while the PM sees "rejected"; that is the accepted R5/A11 behaviour.

---

## 4. Module shape (for review; no code written)

New `lib/media/capture-ingest.ts` (exports): `CAPTURE_BUCKET = 'capture-documents'` (no constant exists in TS for it today; `PHOTO_BUCKET` is the other bucket [read `lib/storage/photo-access.ts:25`]; I do not edit that file because the `capture` access kind moved to PR-D (PC:399-400)); `CAPTURE_MAX_BYTES`; `CAPTURE_FILES_UPDATE_COLUMNS` (the 7 names); `CaptureIngestJobPayload` (shape from S050:378-385); pure helpers `detectContentType(head)`, `analysePdf(bytes)`, `readCappedBody(res, max, controller)` (all unit-tested without a DB); `handleCaptureIngestJob`; `markCaptureIngestFailed`; `CaptureIngestIncompleteError`. Private: `guardedUpdate`, `finishFile`, `capEvent`, `classifyDbError`, `uploadOnce`. Dependency injection as IG does (`supabaseClient`, `fetchFn` [read IG:93-101]) plus `now`, `fetchTimeoutMs`, `startGateMs`.

**Reuse from IG/HIG: nothing imported.** `extensionForContentType` is private and defaults unknown types to `.jpg` [read IG:68-78], wrong for a byte-checked store; the auth pattern is three lines and `readCredentials` comes from SND. So no helper has to move out of IG/HIG, and neither file is touched.

---

## 5. C8: rollback (never 051's DOWN)

- **If C5 misbehaves in prod:** stop C5 and leave 051 in place [read R3:37, RB:119, CF:53, REC:49].
  1. Stop new work first if live: if C6 (digit 4 on) has shipped, revert C6 so no new `capture_ingest` jobs are created.
  2. Revert C5 and redeploy (git revert of the merge commit; or the Vercel console's rollback to the previous deployment, available as a provider feature [inferred]). The tick then treats `capture_ingest` as unknown again [read TK:84-85]: in-flight jobs burn attempts and die with no data change; their files stay `pending` and the PM page shows them as failed after 15 minutes [read V3:119]. Replaying them later needs the job rows' `attempt_count` reset (a prod write, FULL tier, Aravind's go).
  3. Do not delete objects or edit terminal rows: C2 and 051 forbid it, and a repair of terminal rows is its own reviewed artifact with its own decision on `ingested_at` (CF:42-43, CF:50-51, R3:36-38).
  4. 051's DOWN is not a step in this list. It refuses while terminal rows exist (`DOWN_PRECONDITION_051 … terminal_rows=N`) [read CF:42-43].
- **Full order for the wider rollback** [read PC:375]: C6 → **C5** → C4 → C3 → 051 DOWN → C1 stays; then, outside PR-C, C, then B, then A. C5 must be gone before 051's DOWN because the ingest needs the grant [read PC:375]. 051's DOWN is only ever reached through its own reviewed artifact, never as an incident response.
- A C5 bug that writes a wrong terminal row is **not** reversible by rollback (section 2). That is a risk to review, not a rollback step.

---

## 6. Files

### Files to change (the eventual build)

| File | Why |
|---|---|
| `lib/media/capture-ingest.ts` (new) | the handler, dead letter, byte checks |
| `test/capture-ingest.test.ts` (new) | DB + Storage tests (T-ID, T-OK, T-C1/C3/C4/C5, T-RETRY, T-SKIP, T-MULTI, T-DL, T-TW, T-HYG, T-PRE) |
| `app/api/jobs/tick/route.ts` (edit) | dispatch case + dead-letter branch (TK:60-75, after TK:245-248) |
| `lib/queue/jobs.ts` (edit, **not in the expected list**) | add `'capture_ingest'` to `JobType` (JB:5-20); without it `dispatchJob` does not compile. Not on the MUST-NOT list |
| `test/unit/capture-ingest-bytes.test.ts` (new, **not in the expected list**) | the no-DB tests U-PDF, U-SIZE, U-C2-static, U-C6, U-C7, U-DARK so they run without test-db |
| `test/unit/jobs-tick-dispatch.test.ts` (new, **not in the expected list**) | the characterization proof for existing job types plus the capture_ingest cases (3.9) |
| `docs/reviews/c5-review-package.md` (new, **not in the expected list**) | FULL tier external review package |
| `docs/reviews/c5-deploy-record.md` (new, after deploy) | written record, own docs commit |
| `docs/build-status.md` (edit, optional) | CM §10 says build history lives there [read CM §10]; one dated entry |

No change needed to `package.json` (no new dependency), `vercel.json`, CI workflow (tests stub env), `types/database.ts` (forbidden; and it already carries `capture_files` incl. `ingested_at` at `origin/main` [read `types/database.ts:263-313`]).

### Files checked that stay untouched

`supabase/**` (049, 050, 051 read only); `lib/whatsapp/**` (only `readCredentials` imported from `outbound/send.ts`; `capture-switch.ts`, `inbound-start.ts`, `flows/material-inward.ts` read); `test/webhook.test.ts`; `lib/media/ingest.ts`, `lib/media/hindrance-ingest.ts` (read, nothing imported); `lib/observability/**`; `types/database.ts`; `lib/whatsapp/capture-switch.ts`; `test/helpers/capture-fixtures.ts` (read; no edit needed, C5 tests pass their own media array to `miTurn`); `lib/storage/photo-access.ts` (read); `vercel.json` (read); `scripts/test-db-only-capture-helpers.sql` (read); the 051 evidence directory (only the review files and the apply record were read).

---

## 7. Conflicts (this block vs plan docs vs the 051 contract vs the code)

1. **V3:203 vs the 051 contract.** V3:203 says "job `capture_ingest` with a path derived from the file id **so retries overwrite**" [read]. The 051 contract (R1:78-79, CF:19, the brief's C1/C2) forbids overwrite. The contract wins; V3:203's clause is superseded and needs a dated correction in PR-F (not in C5).
2. **Brief C4 vs R1:104.** The reviewer asked only for `ingest_status IN ('pending','failed')`; the brief adds `id, tenant_id, document_id`. The brief is a superset; I follow the brief. The dead letter adds a narrower `= 'pending'` on top (Q6).
3. **Brief item 1 ("load by file_id") vs CM §4 ("NEVER query the DB without filtering by tenant_id").** Resolved by reading with `id IN (…) AND tenant_id = payload.tenant_id`; missing row = mismatch. Same outcome, tenant-scoped query. Flagged because the literal brief wording differs.
4. **Brief C6 vs V3:233.** V3:233 allows "counts, content types, ids only" for Sentry; the brief also forbids tenant and user ids. IG/HIG events include `dailyLogId` / `hindranceId` [read IG:164-166, 204-209; HIG:156, 189]. C5 follows the brief (stricter). Existing events are not touched.
5. **CM §6 "Validate ALL inputs with Zod" vs the repo.** `zod` is not in `package.json` and no file imports it (git grep + package.json grep, empty) [read]. C5 validates the payload by hand (Q9).
6. **V3:261 test IDs vs the repo.** V3:261 defines `T-PDF-1..4, T-SIZE-1, T-R5-1` as "As v2 §11"; the v2 plan is not in the repo (PC:17 [read]). My IDs map to the parenthetical on V3:261 ("byte checks, encrypted → not previewable, original bytes, download type, cap, no outbound message on job-time rejection"). "Download type" (content type of a download) is a PM-page behaviour (PR-D); C5 covers only the stored `content_type` it feeds. Unverifiable against v2.
7. **"R5" is used for two things in V3** (V3:185/V3:261 = no message to the engineer on job-time rejection; V3:408 = the N13 check-in risk). The brief's "R5/A11" is the first.
8. **JB:38 comment vs JB:39-41 arithmetic.** Comment: "1min, 2min, 4min, 8min, 16min". `failJob` passes the new attempt count (1…4) to `backoffSeconds`, giving 2, 4, 8, 16 minutes [read JB:171-181]. Not C5's to change; matters for the "about 30 minutes" retry window.
9. **PC:366 row C5 vs this plan.** PC lists only `T-PDF-1..4, T-SIZE-1, T-R5-1` and the "no handler fails" test; this plan adds the contract tests and the dispatch characterization file. PC:70 puts C5 after C4 (which Rev 4 splits into C4a, merged as `f55431c8`, and C4b, the PDF webhook gate): C5 has no technical dependency on C4b, because it processes whatever `capture_files` rows exist; PDFs only start arriving once C4b ships [inferred].
10. **Working-tree staleness.** The local checkout (`2c4cf74`) predates `origin/main` (`a84f6e53`); nothing here was read from it.

---

## 8. Unknowns

- **U1** Configured function duration of `/api/jobs/tick` on Vercel: CM §3 says 60 s; no code sets it. Check the Vercel console. Drives Q4's numbers.
- **U2** The exact duplicate-upload error shape (`status 409`?) in supabase-js 2.108.2 against test-db Storage; only the name "Duplicate" is documented in the type file. `T-RETRY-1` observes it.
- **U3** That test-db has the `capture-documents` bucket with 049's settings (expected, not observed). `T-PRE-1`.
- **U4** That Authorization is dropped on the Twilio → CDN cross-origin redirect (Fetch standard; not read, not observed).
- **U5** Jobs left `running` after a platform timeout kill, with no reaper; the files would stay `pending` with no alert.
- **U6** Twilio's real inbound size limit and whether Twilio can send types outside the four (V3:423 [read]).
- **U7** That PostgREST surfaces `QE011` as `error.code` (PB:503 per PC:426 [read as a listed unknown]); 051's prod GO required it observed in CI (CF:45 [read]); `T-C5-2` re-observes it.
- **U8** v2 §11 text of `T-PDF-1..4` (not in the repo).
- **U9** Maximum files per payload (WhatsApp allows several photos; the cap used for payload validation is a design number, proposed 20).
- **U10** How `main` becomes a deployment, and the Vercel env value of `CAPTURE_DIGIT4_TEST_PHONES` (provider state, not in the repo).
- **U11** Whether more than one orphan-object scenario exists beyond the extension case in 3.4.
- **U12** Peak memory per invocation with three concurrent jobs (about 100 MiB estimated) against the Vercel memory setting.

---

## 9. Questions for Aravind (★ = the answer changes what gets built)

1. ★ **Identity mismatch scope.** One mismatched file: fail the whole job closed (recommended; 3.1) or skip only that file?
2. ★ **URL guard.** Add the `https` + `api.twilio.com` + own-account-path check before attaching the Twilio credentials to a payload URL (recommended; 3.8)? It also means C5 tests need Twilio-shaped URLs.
3. ★ **Object path extension.** Keep `<file_id>.<ext>` as the brief's C1 says (residual: a changed detected type on retry leaves one unreferenced object) or drop the extension so the path never varies (CHECK still holds: `starts_with(…/<id>)`, S051:174)? Recommendation: keep `.ext` as written.
4. ★ **Time numbers.** Per-file timeout 15 s, new-file start gate 20 s, assuming a 60 s limit that nobody has observed (U1). Please check the Vercel setting or accept these.
5. ★ **Alert-not-retry set.** `QE011, QE009, QE014, 23514, 42501` → alert and do not retry; everything else retries. 42501 (permission denied, e.g. the grant gone) is my addition beyond QE011: agree?
6. ★ **Dead letter.** Sentry error only when at least one row actually moved to `failed`, and the UPDATE additionally filters `= 'pending'` so the count is exact (a narrowing of C4's `IN ('pending','failed')`). OK?
7. ★ **Rejected rows** carry only `reject_reason` (`content_type`, `byte_size` NULL), so the PM page cannot show the size of a too-large file. OK, or should a completed too-large download record the size?
8. **Sentry ids.** `jobId` only (no file/document/tenant/user id, no SID). May the events also carry `file_id`/`document_id`? Default: no.
9. ★ **No zod.** Hand-validate the payload (UUID shapes, 1-20 files, string URL) instead of adding a dependency. OK?
10. ★ **Two edits outside the expected list:** `lib/queue/jobs.ts` (one union member) and the new dispatch characterization test file. OK?
11. **PITR** (not decided here): (a) none, (b) a hashed "substituted" readback before the D-30 test, or (c) a dump. Facts in 3.12.
12. ★ **Kill switch.** None (rollback = revert/redeploy) as the plan assumes, or an env-var disable? A constant-over-env choice was already made for digit 4 (PC:252).
13. ★ **%%EOF rule.** A PDF with no `%%EOF` in its last 1024 bytes is `stored` + `not_previewable` (reading "unparseable", CED:237). And `/Encrypt` is searched in the whole file, not only the trailer. Agree?
14. **Order.** C5 does not depend on C4b (PDF webhook gate). Do you want it merged before C4b, or after?
15. **PR-F.** May a dated correction to V3:203 ("retries overwrite") be queued for PR-F?
16. **Rows left `pending` after a non-retryable alert** (identity mismatch, QE011, 42501, URL guard on a payload we could not trust) are never dead-lettered; they rely on the alert and the PM page's 15-minute rule (V3:119). Accept?

---

## Appendix — what was read

**Shell (in the probes log):** `git fetch`, `git log`, `git show origin/main:<path>` exports, `git grep` for `capture_ingest`, `enqueueJob`, `INSERT INTO public.jobs`, `apply_material_inward_turn`, `isCaptureDigit4Live`, `runJobsTick|claimJobs`, `JobType`, `maxDuration`, `'running'`, `zod`, `lib/media/…` importers; `vercel.json`; `package.json` greps; storage-js type/dist greps; `types/database.ts` greps; phone-prefix greps.

**Read tool (not in the log):** PC 1-427 (sections 1-9, Rev 1-4); CF 1-63; V3 95-295 (+ greps of the rest); CED (greps + lines 237, 245, 246); S049 300-340, 960-990, 1010-1035; S050 355-395; S051 1-300 (post-condition block and DOWN, 300-454, skimmed only via the prod record); R1 70-124; R2 greps; R3 30-45; REC 1-63; RB greps; IG 1-333; HIG (grep lines only); JB 1-190; TK 1-273; FX 1-270 + signature greps of 270-466; `lib/whatsapp/flows/material-inward.ts:85-100,330-352`; `lib/whatsapp/capture-switch.ts` 1-27.

**Not read:** `docs/plans/slice-1a-plan-v2.md` (not in repo); 051 SQL evidence files; `test/media-ingest.test.ts` contents (only the `remove` lines); S050 beyond 355-395 for this plan.

---

## Decisions and review amendments, 2026-10-28

Everything above is the plan as submitted for external design review (rev 1, 2026-10-28). The review is `docs/reviews/c5-plan-review-round-1.md` (verdict: plan GO, no blocking finding). Where this section differs from the text above, **this section wins**; the changed sentences above carry a dated strike-through or pointer. Decisions are Aravind's, 2026-10-28.

### Answers to the questions (section 9 above)

| Q | Decision |
|---|---|
| Q1 | Any identity mismatch fails the whole job closed (no download, no write, one `identity_mismatch` event, the job completes). |
| Q2 | URL guard ON: `https`, hostname `api.twilio.com`, path starts `/2010-04-01/Accounts/<own accountSid>/`. |
| Q3 | The storage path has NO extension: `<tenant_id>/<project_id>/<document_id>/<file_id>`, from the verified ROW. **Dated correction of the brief's C1 path: ~~`<file_id>.<ext>`~~.** Every retry hits the same path, so the duplicate -> hash-compare rule (3.4) applies to every retry. The 3.4 orphan residual is struck through above. Test: the path equals the row-derived path and has no `.`-suffix (T-OK-1). |
| Q4 | Superseded by S3: per-file fetch timeout 15 s; upload timeout 30 s; existing-object download 15 s; each DB call 10 s; no new file started after 20 s; hard per-job deadline 90 s. U1 observed: the Vercel project default is 300 s (per Aravind, console screenshot), so the worst case stays well under it. The "assumed 60 s" in 3.6 and the unknown U1 are closed. |
| Q5 | Alert-not-retry: `QE011, QE009, QE014, 23514, 42501`, plus (review S2) any deterministic storage 4xx other than duplicate (mime type, size; 408 and 429 still retry). A storage 4xx ends the file as `failed` + one counts-only event. |
| Q6 | Dead letter: Sentry only if at least one row moved; its UPDATE adds `ingest_status = 'pending'`. (Review N2) the tick wraps the dead-letter call; its own failure sends one counts-only event. |
| Q7 | Amended by S5: `rejected/wrong_type` writes `reject_reason` only. `rejected/too_large` writes `reject_reason` + `content_type` = the type detected on the first chunk. `byte_size` stays NULL on every rejected row. |
| Q8 | Sentry ids: `jobId` only (no file, document, tenant or user id, no SID). |
| Q9 | Payload hand-validated, 1 to 20 files (review N1), no new dependency (no zod). |
| Q10 | The `JobType` union edit in `lib/queue/jobs.ts` and the dispatch characterization test: both done. |
| Q11 | PITR for C5 = option (b): a hashed "substituted" readback just before the D-30 test (also recorded in `pr-c-plan.md` Rev 5). |
| Q12 | No kill switch. The stop levers are digit 4 (a constant) and a revert. |
| Q13 | `%%EOF` / `/Encrypt` rules as in 3.3, with the header window amended by S4. |
| Q14 | Overtaken: C4b merged as `a84f6e53` before the review. |
| Q15 | A dated correction to V3:203 ("retries overwrite") is queued for PR-F (review ruling). |
| Q16 | Rows left `pending` after a non-retryable alert are accepted while digit 4 is dark; before C6, a stuck-`running` scan (or reaper) covering these rows, or PR-D's 15-minute rule live (recorded in `pr-c-plan.md` Rev 5). |

### Review findings folded in

- **S1 (0-row UPDATE).** After any `guardedUpdate` that returns 0 rows, the row is re-read (`id` AND `tenant_id`). Terminal with the same `sha256` AND `storage_path` (or, for a reject, the same `reject_reason`) counts as "already done", not a fresh store. Anything else is an `update_noop` event, non-retryable. Tests T-S1-1/2; control: a mutant that treats 0 rows as success goes red.
- **S2 (contentType).** `uploadOnce` passes `{ upsert: false, contentType: <detected type> }`; T-C1-1 asserts both options on every upload call. Observed on test-db: the bucket refuses a non-allowed type with `status 400, statusCode '415'` (T-S2-REAL). A deterministic storage 4xx other than duplicate is alert-and-do-not-retry (Q5).
- **S3 (one deadline).** One per-job deadline covers every network call (Twilio fetch, upload, existing-object download, UPDATE, re-read) and is checked before each. Past it: stop, the remaining files are deferred (retryable). Tests T-MULTI-3, T-S3-1, T-S3-2.
- **S4 (PDF header).** `%PDF-` is accepted anywhere in the first 1024 bytes; the bytes are stored untouched. This replaces the byte-0 rule in V3:203 and in 3.2 above. Tests: header at byte 0, after a 200-byte prefix (stored as `application/pdf`, identical bytes), only after 1024 bytes (`wrong_type`). The D-30 test includes one PDF from a scanner app.
- **S5 (too_large keeps the type).** See Q7.
- **N1** at most 20 files per payload (a longer payload is `payload_invalid`). **N2** see Q6.

### C7 diff re-run with the amended SET lists (S5)

Grant (`supabase/migrations/051_capture_files_immutability.sql:288`): `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`.

| Outcome | SET columns |
|---|---|
| stored | `ingest_status`, `content_type`, `byte_size`, `sha256`, `storage_path`, `preview_state` |
| rejected / wrong_type | `ingest_status`, `reject_reason` |
| rejected / too_large | `ingest_status`, `reject_reason`, `content_type` |
| failed (quarantine and dead letter) | `ingest_status` |

```diff
  grant (S051:288)                  C5 union of SET columns
  ingest_status                   = ingest_status
  content_type                    = content_type          (stored; rejected/too_large)
  byte_size                       = byte_size             (stored only; NULL on every rejected row)
  sha256                          = sha256                (stored)
  storage_path                    = storage_path          (stored)
  reject_reason                   = reject_reason         (rejected)
  preview_state                   = preview_state         (stored)
+ (nothing in C5's lists is outside the grant)
- (nothing in the grant is unused)
  NOT in the grant, NOT written by C5: ingested_at (database-stamped by the trigger) and the nine identity columns.
```

`content_type` is in the grant, so the S5 change adds no column. Row-shape CHECKs (051): `content_type` may be set on `rejected` rows (`capture_files_details_terminal_only_chk`); `reject_reason` iff rejected. Test U-C7-1 compares `CAPTURE_FILES_UPDATE_COLUMNS` with the GRANT text in the migration file; T-OK-1 and T-PDF assert that every update's keys are inside it; control: a mutant adding `ingested_at` goes red.

### Build notes (what the code does where the plan left a choice)

- The handler receives `jobId` from the tick (`{ supabaseClient, jobId }`) so its events can carry it (Q8).
- A database refusal (`db_refused`: `QE011, QE009, QE014, 23514, 42501`) raises one event and leaves the row as it was (the UPDATE that was refused is not retried or replaced by a second write). Rows left `pending` this way fall under Q16.
- Duplicate-upload error observed on test-db (U2): `StorageApiError`, `status 400`, `statusCode '409'`, message "The resource already exists". The classifier checks `status`, `statusCode` and the message, not only `status`.
- A `Content-Length` header larger than 16 MiB is an early-out only after the magic check; the streaming count is the limit.
