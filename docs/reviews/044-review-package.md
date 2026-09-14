# 044_hindrance_photos.sql — external review package (2026-09-14)

STATUS: HELD in `docs/reviews/`, NOT promoted to `supabase/migrations/`.
Applied to **TEST-DB ONLY** (`exfccwlrhoutkgrlikod`) this pass, per
Aravind's explicit instruction. **NOT applied to prod** (`jvxwqignooseazzmwhvl`).
Trips CLAUDE.md §0's external review gate on two independent grounds — see
"Why this trips the gate" below — and needs the full review before it is
ever applied beyond test-db.

Companion plan (all design decisions, both the original plan-only pass and
Aravind's 2026-09-14 resolutions): `docs/plans/stage2-hindrance-photos-plan.md`.

---

## Repo-state header (per this project's own standing rule)

- `main` (fetched fresh, `git fetch origin`, this pass): `49e2c8b` — "fix(item-12): a caption is never an answer -- reversed after real prod incident (#274)".
- Working branch: `worktree-evening-q5-caption-reversal`, based on `ab124c6` (one commit behind `origin/main`'s `49e2c8b`, but the item-12 fix that commit carries is already present on this branch as local commit `402b450` — same content, pre-merge). Diff against `origin/main` for anything this branch touches: none of media-capture-design.md's own files were touched by the two commits `origin/main` has that this branch doesn't (`82630f3`, `4eb4fcf` — both docs-only, unrelated).
- `supabase migration list` (local/remote, both prod and test-db project refs): highest applied/present migration on both is **043** (`daily_log_photos`), confirmed both via `ls supabase/migrations/` (tops out at `043_daily_log_photos.sql`) and `scripts/migration-number-reservations.json`'s own last entry (`043`).
- Last runbook executed: 043's own apply (`docs/reviews/043-apply-record.md`, 2026-09-14) — prod apply, both external review rounds complete.
- This migration (044) is a **first submission**, not an iterative round — no prior review round exists for it.

---

## Why this trips the gate (CLAUDE.md §0)

- **Condition (b) — new table, RLS/grants from day one:** `hindrance_photos`.
- **Condition (a) — modifies a live function's logic:** `apply_hindrance_flow_turn` (038's live function) gains a third step, moves its completion point, and adds a return field.
- Not (c)/(d)/(e): no auth/identity surface change; nothing irreversible beyond the same append-only/tombstone posture 043 already established; no money.

---

## §0 — The finding that shaped this migration's design

Read directly against 038's live SQL (`supabase/migrations/038_hindrance_flow_and_collision_fix.sql:357-368`) before writing any new code: **the `hindrances` row is inserted exactly once, atomically, at Q2's resolution** — there is no natural key to attach a photo to before that point (unlike `daily_logs`, which `resolveOrCreateDailyLogId` can upsert against at any time via `(project_id, engineer_id, log_date)`).

Three options for a pre-row photo were evaluated in the plan-only pass (buffer-and-flush via session context; create the row early with a placeholder state; resolve via a "most recent hindrance" lookup at enqueue time) and all three were **rejected by Aravind, 2026-09-14**, in favor of a fourth, simpler option: **a photo before the row exists is not stored at all** — the engineer is told (`HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY`) and the question re-asks. Full reasoning: `docs/plans/stage2-hindrance-photos-plan.md` §0 and its "DECISIONS, 2026-09-14" item 1.

**A second, real bug was found and fixed while building the TS wrapper, before this migration ever ran anywhere** (documented in the migration file's own `DECLARE` block comment, `docs/reviews/044_hindrance_photos.sql`): the existing `wasExhausted` flag (whether Q2's timing resolved cleanly or was recorded `'unspecified'`) used to be computable client-side by re-classifying the CURRENT turn's message, because under 038 the resolving turn and the completing turn were the same call. They no longer are — completion now happens on Q3's own turn, whose message ("none" or free text) is never a timing answer. Re-classifying it via `classifyHindranceTiming` would have silently reported **every** completion as exhausted. Fixed by carrying the fact across the Q2→Q3 gap in `whatsapp_sessions.context` (`hindrance_unspecified` key, set at Q2's resolution, read and cleared at Q3's completion) and returning it from the RPC as a new `was_unspecified` field. **Verified live, both branches, before this package was written** — see §7 below.

---

## §1 — The migration file

Full text, pinned: `git show 1ef9b0de2b62ad2eaca7557ded06c73244d04594:docs/reviews/044_hindrance_photos.sql` — confirmed byte-identical to the working-tree copy this package was written against before committing.

**COMMIT SHA:** `1ef9b0de2b62ad2eaca7557ded06c73244d04594` (branch `worktree-evening-q5-caption-reversal`, pushed to `origin`).

Structural summary (full reasoning is in the file's own comments, not restated in prose here per this project's own no-duplication convention):

1. `ALTER TABLE hindrances ADD COLUMN photos_status` — mirrors `daily_logs.{phase}_photos_status` (043).
2. `CREATE TABLE hindrance_photos` — per-parent shape (item 7), deviating from 043 where stated in the file's own header (no `phase` column; simpler single-interval `expires_at`; one-hop-shorter RLS join since `hindrances` carries `project_id` directly; reuses the `daily-log-photos` bucket under an extended path convention).
3. `CREATE OR REPLACE FUNCTION apply_hindrance_flow_turn` — the mechanical diff against 038, itemized in `docs/plans/stage2-hindrance-photos-plan.md` §1:
   - Q2's resolution now sets `current_step := 3` (was: completes to `0`) and stamps `context.hindrance_unspecified` for the was_unspecified fix above.
   - New `current_step = 3` branch: any non-empty text completes the flow.
   - Return value gains `hindrance_id` (non-null only at the Q2→Q3 transition) and `was_unspecified` (meaningful only at genuine completion).
   - Argument list is **byte-identical** to 038's (10 args) — `CREATE OR REPLACE`, no `DROP FUNCTION`, no overload hazard. Grants re-asserted explicitly regardless (defense against a future editor assuming they persist automatically).
4. `REVOKE`/`GRANT` re-assertion for the function, unchanged shape from 038.
5. DOWN block (inert, commented) — reverts the table/column and restores 038's function body **byte-for-byte**, pasted directly from `038_hindrance_flow_and_collision_fix.sql:225-388`, not retyped from memory. **A transcription error in an earlier draft of this DOWN block was caught and fixed before this package was written** — see §7's "DOWN rehearsal" subsection for the full incident (a paraphrased comment produced a body-hash mismatch; the corrected version was re-verified to match exactly).

---

## §2 — The RLS policy

`hindrance_photos_select`: `SELECT` only, `TO authenticated`, `tenant_id = get_user_tenant_id() AND EXISTS (... hindrances h JOIN project_members pm ... pm.role = 'pm')` — one join shorter than `daily_log_photos_select` (043) since `hindrances.project_id` is a direct column, not reached via a further join.

**No signed-URL reader exists for this table this stage** (`getSignedHindrancePhotoUrl` is not built — that's stage 5, a PM dashboard surface). Consequence, stated in `docs/plans/stage2-hindrance-photos-plan.md` §7: the boundary-agreement dual-test shape (`test/photo-access-boundary-agreement.test.ts`'s own pattern) does not apply here, since there is only one boundary (the RLS policy itself) to test, not two independently-encoded ones that could drift apart. The RLS policy is instead tested directly via a real authenticated session (`test/hindrance-photos-rls.test.ts`, §8 below) — the same fixture shape `test/storage-photo-access.test.ts` established, adapted to query the table directly rather than through a TS access function.

---

## §3 — Grants and revokes

`REVOKE ALL ... FROM authenticated, anon, service_role;` first (043's own standard — nothing leaks by omission), then:
- `authenticated`: `SELECT` only.
- `anon`: nothing.
- `service_role`: `SELECT, INSERT, UPDATE` — **not** `DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`, matching this table's tombstone-only design (item 9) and closing the exact gap this project has now found twice (`dpr_versions`; `outbound_sends` round 1).

**Verified by direct observation against test-db**, not assumed from reading the file — raw probe output, §7 below.

---

## §4 — Storage bucket decision and path convention

**Reuses `daily-log-photos`** (stage 0's bucket) — Aravind's decision, 2026-09-14: a second bucket would duplicate `lib/storage/photo-access.ts`'s own access-barrier risk (service_role only, no Storage RLS) rather than share it, for no isolation benefit (both buckets would carry the identical posture either way).

**Path convention, stated explicitly:** `{tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext}` — four segments, the literal string `"hindrance"` disambiguating from `daily_log_photos`' own three-segment `{tenant_id}/{daily_log_id}/{photo_id}.{ext}` convention. Nothing in this stage parses this path with `photo-access.ts`'s `extractDailyLogId` (a strict 3-segment parser) — the email attachment path (`lib/hindrance/pm-notify.ts`) fetches bytes directly via `service_role`, never through `getSignedPhotoUrl`, and no signed-URL reader for hindrance photos exists yet (§2). **Verified live** — `test/hindrance-media-ingest.test.ts`'s own regex assertion against a real uploaded object's path.

---

## §5 — The Q1/Q2 photo-rejection design (Aravind's "no buffering" decision)

`lib/whatsapp/inbound-start.ts`'s `handleHindrancePhoto`:
- `current_step` 1 or 2 → `HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY` ("Photo not saved yet. Answer the question, and I'll ask for photos at the end."), no storage, no RPC call, question unchanged.
- `current_step` 3 → resolves `hindrance_id` via `resolveMostRecentHindranceId` (extracted from `lib/hindrance/pm-notify.ts`'s own `enqueueHindrancePmNotify` lookup), enqueues `hindrance_media_ingest`, sets `photos_status='pending'`, reasks (with `PHOTO_SAVED_REASK_PREFIX` if captioned) — same "a photo never answers a question" mechanism already live for morning/evening (item 23), reused, not reinvented.

**Why the "most recent hindrance" lookup is safe here but was rejected for the async job-handler case** (option C in the plan's own §0): this call runs **synchronously**, in the same request, while `current_step` is confirmed to still be 3 for this exact phone number's session — no second hindrance report from the same engineer can exist yet, since the session hasn't reached idle to allow a new "1" to start one. The rejected option ran the identical query **asynchronously**, at an unbounded later time, where an abandoned report could make it resolve to a different, unrelated hindrance. Documented in both `resolveMostRecentHindranceId`'s own doc comment and `handleHindrancePhoto`'s own doc comment, so the distinction isn't lost to a future editor.

---

## §6 — `sendEmail` attachments and the hindrance email

**Resend's attachments API shape — verified live, 2026-09-14** (WebFetch against `resend.com/docs/api-reference/emails/send-email` and `resend.com/docs/dashboard/emails/attachments`, not recalled from training): `attachments: [{ content, filename, path?, content_type? }]`, `content` a Base64 string, `content_type` snake_case and optional, `path` (a remote URL) deliberately never used by this codebase (stage0-storage-setup-plan.md §5's own already-decided split: email attachments are bytes fetched via `service_role`, never a URL). 40 MB per email after Base64 encoding, documented directly.

`lib/hindrance/pm-notify.ts` changes:
- `fetchHindrancePhotoAttachments` — downloads each non-tombstoned `hindrance_photos.photo_url` directly via `service_role` Storage, never a signed URL.
- **The async race, real, not hypothetical:** `enqueueHindrancePmNotify` fires synchronously at flow completion (now Q3's turn); `hindrance_media_ingest` runs async and may not have finished. **Fix:** `handleHindrancePmNotifyJob` throws a retryable error while `photos_status='pending'`, reusing the existing job queue's exponential backoff (NFR-17) as the wait mechanism — no new hold-timer built. **On exhaustion** (`app/api/jobs/tick/route.ts`'s dead-letter branch), the job is called once more with `forceSendWithoutPhotos: true` — Aravind's decision: **the email is never withheld.** If that forced send also fails, only then does the original "PM never notified" Sentry alert fire.
- Email copy — **approved, verbatim** (Aravind, 2026-09-14): `"N photo(s) attached."` (singular "1 photo attached.") when photos are attached; `"Photos are still uploading — they'll be in the dashboard shortly."` on the forced-exhaustion path; no line at all when no photos were ever sent. Tamil pairs owed, not invented, per standing instruction.

**Verified end to end against real test-db, real Storage downloads, mocked `sendEmail`** — `test/hindrance-pm-notify-photos.test.ts`, §8 below. **NOT verified**: an actual Resend API call — see §9.

---

## §7 — Test-db apply evidence, pinned (raw, not paraphrased)

**Pre-apply probe** (`to_regclass`/`to_regproc`, confirming clean slate before applying):
```json
{
  "apply_hindrance_flow_turn_exists": "apply_hindrance_flow_turn",
  "daily_log_photos_exists": "daily_log_photos",
  "hindrance_photos_exists": null
}
```

**Pre-044 function body capture** (`pg_get_functiondef`, before any change — this is what the DOWN block must restore byte-for-byte):
```
body_md5 (pre-044): abdac08cd997bb2e3d8d73773d807a24 (body_len: 6496)
```

**Apply**: `supabase db query --linked -f docs/reviews/044_hindrance_photos.sql`, project ref `exfccwlrhoutkgrlikod` — no error.

**Post-apply structure/RLS probe**:
```json
{
  "expires_at_expr": "timezone('UTC'::text, (timezone('UTC'::text, received_at) + '60 days'::interval))",
  "photos_status_col_count": 1,
  "policy_count": 1,
  "rls_enabled": true,
  "table_exists": "hindrance_photos"
}
```

**Post-apply four-way negative grants matrix** (`has_table_privilege`, direct):
```json
{
  "anon_select": false,
  "authenticated_insert": false,
  "authenticated_select": true,
  "service_role_delete": false,
  "service_role_insert": true,
  "service_role_references": false,
  "service_role_select": true,
  "service_role_trigger": false,
  "service_role_truncate": false,
  "service_role_update": true
}
```

**RPC live verification, Q1→Q2→Q3→completion, resolved-timing path** (each `SELECT apply_hindrance_flow_turn(...)` run individually against real fixture ids):
```json
start:  {"current_flow":"hindrance","current_step":1,"hindrance_id":null,"outcome":"start","was_unspecified":false}
q1:     {"current_flow":"hindrance","current_step":2,"hindrance_id":null,"outcome":"advance","was_unspecified":false}
q2:     {"current_flow":"hindrance","current_step":3,"hindrance_id":"13a1d42a-4d6a-4e58-97cd-04ccdfc13ebf","outcome":"advance","was_unspecified":false}
q3:     {"current_flow":null,"current_step":0,"hindrance_id":null,"outcome":"advance","was_unspecified":false}
```

**RPC live verification, unspecified-timing path** (Q2 reask budget exhausted — this is the exact case the `was_unspecified` bug would have broken):
```json
q2_exhaust:   {"current_flow":"hindrance","current_step":3,"hindrance_id":"da1c5900-9233-4846-b11a-9527960cf77d","outcome":"advance","was_unspecified":false}
q3_complete:  {"current_flow":null,"current_step":0,"hindrance_id":null,"outcome":"advance","was_unspecified":true}
```
Row readback confirms `timing='unspecified'`, `timing_raw='depends on the crane'` for this report, and `timing='active'`, `timing_raw=null` for the resolved one above — both correct.

**DOWN rehearsal, against a live in-flight session at step 3 — first attempt found a real bug in this package's own DOWN block:**

1. Seeded a session at hindrance step 3 (real Q1→Q2 turns, confirmed `current_flow=hindrance, current_step=3`).
2. Ran the DOWN block for real. No SQL error.
3. Post-DOWN probe: table gone, column gone — but **`body_md5_after_down` was `7e06e55d102b31dc0b8bf522ed454aee`, NOT matching the pre-044 capture (`abdac08c...`)**. Root cause: the DOWN block's function body had been **paraphrased** (shortened comments) rather than pasted verbatim from 038's real source — a real instance of the exact mistake CLAUDE.md's Rule 10 (`function-redefinition-requires-capture`) and 041's own external-review precedent exist to catch, caught here by re-verifying the hash rather than trusting "looks right."
4. **Fixed**: replaced the DOWN block's function text with 038's exact literal source (`sed -n '225,388p' 038_hindrance_flow_and_collision_fix.sql`), comment-for-comment.
5. **Re-applied 044 forward, re-seeded a fresh step-3 session, re-ran the corrected DOWN.** Post-DOWN probe this time:
```json
{"body_md5_after_down": "abdac08cd997bb2e3d8d73773d807a24", "photos_status_col_count_after_down": 0, "table_exists_after_down": null}
```
**Exact match to the pre-044 capture.** The DOWN genuinely restores 038's body byte-for-byte.
6. **In-flight session behavior under the reverted function**: a subsequent turn against the still-step-3 session returned:
```json
{"current_flow": "hindrance", "current_step": 3, "outcome": "reask"}
```
038's own IF/ELSIF chain has no branch for `current_step=3` (038 only ever writes/expects steps 1–2), so its trailing `ELSE v_outcome := 'reask'` fires — the session re-asks indefinitely rather than crashing or calling something nonexistent. This is "safely reset" in the weaker sense CLAUDE.md's DOWN-rehearsal rule asks for (never left calling a function that no longer exists), **not** "resets to idle" — a session stuck this way stays stuck until BOT-07's own next-day reset clears it. Named plainly, not glossed over.
7. Migration 044 **re-applied forward** afterward (for the rest of this pass's work) and reconfirmed clean via the same structure/RLS probe as step 3 above.

All scratch fixture rows (`whatsapp_sessions`, `hindrances`) created during this manual rehearsal were deleted before this package was written; none are live on test-db as leftover state.

---

## §8 — Raw test-suite results against test-db (post-apply)

**`scripts/lint-migrations.mjs`**: `migration-lint: clean. 97 known violation(s), all exempted.` (run after both the `body_md5 (pre-044)` capture line and the `044` reservation entry were added — both required to pass the `function-redefinition-requires-capture` and `held-migration-reservation-required` rules respectively).

**New test files, individually confirmed green before the full-suite run:**
- `test/hindrance-photos-flow.test.ts` — 6/6 passed (Q1/Q2 photo rejection, Q3 storage captioned/uncaptioned, full flow resolved + unspecified completion, `was_unspecified` regression guard).
- `test/hindrance-photos-rls.test.ts` — 6/6 passed (cross-tenant RLS isolation via real authenticated sessions; static grant-shape guards).
- `test/hindrance-media-ingest.test.ts` — 4/4 passed (real Storage upload/path convention, real 60-day `expires_at`, Twilio-failure/dead-letter paths).
- `test/unit/email-send.test.ts` (extended) — 12/12 passed (4 new attachment-serialization cases).
- `test/hindrance-pm-notify-photos.test.ts` — 6/6 passed (retry-on-pending, real attachment fetch + count line, no-photos case, forced-exhaustion "still uploading" copy for both `pending` and `failed`, idempotency guard).
- `test/unit/hindrance-flow.test.ts` (extended) — existing 11 + 2 new step-3 cases, all passed.

**Full suite (`npx vitest run`), run TWICE, deliberately — once pre-commit
(functional check, dirty tree, not citable as provenance) and once
post-commit at the pinned SHA with a clean tree (the citable evidence,
per this project's own "SHA echo + empty `git status --porcelain`" rule):**

**Run 1 (pre-commit, functional check only):** 101/102 files, 1184/1186
tests passed, 1 todo. Duration 1188.6s.

**Run 2 — commit `1ef9b0de2b62ad2eaca7557ded06c73244d04594`, `git status
--porcelain` empty at the moment this run started (confirmed immediately
before invoking `npx vitest run`, same shell pipeline, no edit in
between). Raw output, top and bottom:**
```
1ef9b0de2b62ad2eaca7557ded06c73244d04594
PORCELAIN-EMPTY-CONFIRMED
...
 Test Files  1 failed | 101 passed (102)
      Tests  1 failed | 1184 passed | 1 todo (1186)
   Start at  21:58:35
   Duration  1162.08s (transform 645ms, setup 0ms, collect 3.84s, tests 1149.17s, environment 5ms, prepare 1.80s)
```
**Identical result to Run 1** (same 101/102 files, 1184/1186 tests, same
single failure below) — reproducible, not a one-off fluke of either run.

**The one failure, both runs — pre-existing, unrelated, documented:**
`test/session-transition.test.ts` — "B: caller 2 blocks on the row lock
until caller 1 commits" — `acquire_and_transition_session`/
`drain_next_pending_flow` (migrations 012/013), the morning/evening
session-locking state machine. **Confirmed by reading this test file's own
import list**: zero imports from any file this package touches
(`lib/whatsapp/flows/hindrance.ts`, `lib/whatsapp/inbound-start.ts`,
`lib/hindrance/pm-notify.ts`, `lib/media/hindrance-ingest.ts`,
`lib/queue/jobs.ts`, `lib/email/send.ts`, `app/api/jobs/tick/route.ts` —
none appear). This is the exact failure class CLAUDE.md's own standing
rule already names as CI-only and sandbox-unreliable
(`docs/reviews/sandbox-cannot-test-concurrency.md`,
`docs/reviews/session-transition-lock-wait-flake.md`): "caller 1's row
lock was never observed within 3000ms... caller 1 never appeared to reach
Postgres at all in that window" is a sandbox concurrency-dispatch timing
artifact, not an assertion failure on the mechanism under test. **Not
caused by this migration or this stage's own code**, and not something
this package's own build can fix — it predates this stage's work and is
tracked separately.

**`no-app-delete-invariant.test.ts`** — this guard reads its table list dynamically from `scripts/test-db-only-grants.sql` (extended this pass with a third entry, `hindrance_photos`, for the identical reason `daily_log_photos` needed one: `service_role` has no `DELETE` on this table by design, and this project's own test cleanup needs it — found live when `test/hindrance-photos-rls.test.ts`'s own `afterAll` failed with `hindrance_photos_hindrance_id_fkey` blocking a shared-fixture teardown). Coverage extends automatically; no edit to that test file itself was needed.

---

## §9 — What is NOT covered

1. **The real Resend send/deliverability gate — STILL NOT RUN, and its own generator was recorded as "ready" before ever being executed once, which was wrong.** Original record (previous round of this package): `scripts/verify-hindrance-email-attachments.ts` was described as "written and ready," modeled on `scripts/verify-email-delivery.ts`, blocked only by missing credentials. **That description was never tested and turned out to be false in a more basic way than "no credentials" — the script itself was broken and had never been run at all, in any mode.**

   **First real execution, 2026-09-14 (a `--dry-run` invocation, no send attempted): crashed immediately.**
   ```
   RangeError [ERR_OUT_OF_RANGE]: value must be >= 0 and <= 65535. Received 227322
     at Buffer.writeUInt16BE
     at fakeJpegOfSize (scripts/verify-hindrance-email-attachments.ts:59:17)
   ```
   **Root cause:** a JPEG segment's length field is a 16-bit big-endian integer (max 65535, counting itself — real max payload 65533). The original `fakeJpegOfSize` tried to write a single COM segment sized for an entire 222 KB (227,328-byte) photo directly into that 2-byte field. **This is the exact same failure class already named elsewhere in this project's own history** — a test or script that passes/appears-ready only because it was never actually exercised (this project's own "a test file's own summary line can be missing" and "sandbox cannot test concurrency" entries are siblings of this shape, not this exact bug, but the same root failure mode: an unexecuted artifact's own claims about itself are unverified by construction).

   **Fixed:** `fakeJpegOfSize` now chains multiple bounded COM segments (each ≤ 65000-byte payload, comfortably inside the 65533 real ceiling, with headroom reserved to fold any remainder into the last segment) instead of one oversized one. **Also corrected an overclaim in the original comment** — "opens in any image viewer" was asserted without ever having been checked and has been retracted; the generator produces a syntactically valid JPEG byte *stream* (correct markers, in-range length fields, exact target size), not a decodable photo (no real frame/scan data) — stated plainly in the script's own header now, not implied.

   **A second bug was found while proving the fix**, the same way — by actually running it, not by re-reading it: the first corrected version's argument parsing swallowed the `photo-count` argument as the (unused, in dry-run) `to` address, so `--dry-run 1` and `--dry-run 10` both silently reported the default count of 3. Caught by running both side by side and noticing neither varied. Fixed; re-verified below.

   **Dry-run mode added, per instruction, to prove the generator without sending anything.** `--dry-run` generates every attachment buffer, prints each one's exact size, and exits before `readCredentials()` or `sendEmail` is ever reached. **Real, pasted output — 3 separate invocations, proving the fix, the size arithmetic, and that photo-count is no longer ignored:**
   ```
   $ npx tsx scripts/verify-hindrance-email-attachments.ts --dry-run 1
   Mode:         DRY RUN -- no send, no credentials read
   Photo count:  1
     Attachment 1: hindrance-photo-1.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
   Total raw bytes:    227328 (222.0 KB)
   Total base64 bytes: 303104 (296.0 KB) -- this is what actually counts against Resend's 40 MB post-encoding limit

   DRY RUN complete -- exiting before reading any credentials or calling Resend. No email was sent.

   $ npx tsx scripts/verify-hindrance-email-attachments.ts --dry-run 10
   Mode:         DRY RUN -- no send, no credentials read
   Photo count:  10
     Attachment 1: hindrance-photo-1.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
     [... attachments 2-9 identical shape ...]
     Attachment 10: hindrance-photo-10.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
   Total raw bytes:    2273280 (2220.0 KB)
   Total base64 bytes: 3031040 (2960.0 KB) -- this is what actually counts against Resend's 40 MB post-encoding limit

   DRY RUN complete -- exiting before reading any credentials or calling Resend. No email was sent.

   $ npx tsx scripts/verify-hindrance-email-attachments.ts --dry-run
   Mode:         DRY RUN -- no send, no credentials read
   Photo count:  3
     Attachment 1: hindrance-photo-1.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
     Attachment 2: hindrance-photo-2.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
     Attachment 3: hindrance-photo-3.jpg -- 227328 raw bytes (222.0 KB), 303104 base64 bytes (296.0 KB)
   Total raw bytes:    681984 (666.0 KB)
   Total base64 bytes: 909312 (888.0 KB) -- this is what actually counts against Resend's 40 MB post-encoding limit

   DRY RUN complete -- exiting before reading any credentials or calling Resend. No email was sent.
   ```
   This **proves** (not asserts) the generator produces exactly the requested byte count at any photo-count, that the 16-bit overflow is gone, and that dry-run mode genuinely never sends — but it is still **arithmetic on a synthetic buffer, not a real Resend send**. The task's own required measurement (a real send's actual behavior — acceptance, delivery, any provider-side clipping) is still not obtained.

   **CORRECTION to the environment claim, same discipline as CLAUDE.md's own "a local git ref is not current until fetched" family of rules — checked fresh, not assumed from the prior round:** a `.env.local` file now exists in this worktree (`1,483 bytes, modified 2026-09-14 22:34`), where the prior round of this package correctly found none. **Not read, not inspected, no value printed or used** — every dry-run invocation above exits before `readCredentials()` is ever called, and no non-dry-run invocation was attempted. Whether it carries real Resend credentials is unknown and was not checked; per this task's own explicit instruction, no send was attempted regardless of what may or may not be available. **The real send remains Aravind's to run**, with a real, already-confirmed recipient address — this package's own generator is now proven ready for that; the send itself is still not done.

2. **Tamil translations** for all three new/changed user-facing strings (`HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY`, the Q3 question, the two email photo-lines) — not drafted, per standing instruction not to invent them.
3. **A PM dashboard signed-URL reader** for hindrance photos (stage 5) — out of this stage's scope; `hindrance_photos`' RLS ships correct from day one regardless, per this project's own posture.
4. **Cross-project-same-tenant RLS isolation** for `hindrance_photos` — the cross-tenant case is tested (§8); a PM who is a member of a *different* project in the *same* tenant was not independently probed with a live fixture this pass (same open item 043's own review package carried forward, §9 item 4 there — not newly introduced here).
5. **Real concurrent-call behavior** for the session row lock at the Q2→Q3 transition — per CLAUDE.md's own standing finding (`docs/reviews/sandbox-cannot-test-concurrency.md`), this sandbox cannot sustain genuinely concurrent RPC calls; nothing in this package claims to have tested that, and nothing here depends on it either (every new test in this package runs turns strictly sequentially, matching real WhatsApp traffic for one engineer).
6. **Cron placement** for `hindrance_media_ingest` (its own cron vs. `jobs/tick`'s shared budget) — deferred, same open flag item 4 already carries for `media_ingest`.

---

## §10 — Reviewer's own checklist — what to look at hardest

1. **The DOWN-block transcription bug (§7)** — confirm the fix (byte-for-byte paste from 038, hash-verified) is itself correct, not just that a bug was found. This is exactly the failure class CLAUDE.md's Rule 10 exists to prevent; verify the rule's own text (`scripts/lint-migrations.mjs`) still catches a similar mistake in a future migration, not just this one.
2. **The Q1/Q2 "no buffering" decision's downstream consequence**: an engineer who sends a photo before Q1/Q2 resolve loses that photo entirely (told, not stored) — confirm this reading of Aravind's decision is what was actually intended, not a narrower "just don't process it yet" reading.
3. **`resolveMostRecentHindranceId`'s safety argument (§5)** — confirm the synchronous-adjacency reasoning holds under every real call site, now and in any future one; this is a "most recent row" lookup, a pattern this project has already rejected once for a different case in the same design pass.
4. **The `photos_status` retry-then-force-send design (§6)** — confirm reusing the job queue's own backoff (rather than a dedicated timer, unlike DPR-24's own hold) is an acceptable trade given the two failure classes (a slow photo upload vs. a repeatedly-failing PM email send) share one retry budget.
5. **Whether `retention_class` being kept as a fixed-value column (rather than omitted, since there is only one value) on `hindrance_photos` is the right call** — a judgment call made in the plan-only pass, not one of Aravind's own explicit decisions, carried forward unchanged into the build.
