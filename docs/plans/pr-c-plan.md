# PR-C plan — material inward: router, handler, PDF, ingest

Rev 1, written 2026-10-26 (background job). PLAN ONLY: no code, no tests, no migration, no database access, no supabase command. Branch `plan/pr-c` from `origin/main` `115070527d1d423a966a9157a6ba896a32b88a76` (fetched, printed, matched the expected `11507052…`). Raw log of every command: `/tmp/quoco/pr-c-plan-block.txt` on Aravind's machine (not committed). Files read with the Read tool (not shell commands, so not in that log) are listed in the Appendix.

**Marks.** `[read]` = I saw it in a file at the cited path:line on this SHA. `[inferred]` = my reasoning, not read anywhere. Nothing is unmarked. A claim marked `[read]` about a document that quotes another document is read as the quote, not as a check of the original.

**Legend (path abbreviations).** IS `lib/whatsapp/inbound-start.ts`; SS `lib/whatsapp/session.ts`; DP `lib/whatsapp/dispatch.ts`; RT `app/api/whatsapp/webhook/route.ts`; MR `lib/whatsapp/media-reply.ts`; TK `app/api/jobs/tick/route.ts`; FX `test/helpers/capture-fixtures.ts`; S050 `supabase/migrations/050_material_inward_functions.sql`; S049 `supabase/migrations/049_capture_tables.sql`; V3 `docs/plans/slice-1a-plan-v3.md`; PB `docs/plans/pr-b-050-plan.md` (rev 6); CF `docs/plans/pr-c-carry-forward.md`; CO `docs/reviews/050-closeout-record.md`; CED `docs/plans/capture-engine-design.md`; P49 `docs/reviews/049-plan-review-package.md`; R49 `docs/reviews/049-review-package.md`; CM `CLAUDE.md`.

**Decisions carried, not reopened (Aravind, 2026-10-26, from the brief).**
- **D1 = option (d), A27 amended.** When `expire_stale_material_inward` returns true for an inbound message, OR an `'invoice'` session comes back idle from the IST-day reset on that message, the router answers that ONE message with `MI_SESSION_ENDED_REPLY` instead of the idle menu, and does not process it. No SQL change.
- `MI_SESSION_ENDED_REPLY`, English APPROVED: "That delivery question has ended. Your answer was not recorded. Reply 4 to start again." Code comment: "Tamil owed".
- PITR is off until launch. Any prod migration in PR-C records "PITR substituted" (prod-captured state + a DOWN), like 050 [read CO:150-152; CF:14].
- Overload rule: no second function with any of the seven 050 names, or update both 050 DOWN files in the same PR [read CF:5-7].

Two sources are **not** in the repo and so are `[inferred]`/unverifiable here: the v2 plan (`/tmp/quoco/slice1a-plan-v2.md`, cited by V3:57, V3:203) and all probe captures `/tmp/quoco/pr-b-*.txt` (cited by PB:17-18). Where PR-C depends on them I say so.

---

## 1. Scope

### 1.1 What an engineer sees on WhatsApp (once digit 4 is on; until then see section 4)

Wording is never written here; each reply is a named slot (section 7).

| Step | Engineer sends | Bot replies | What now exists |
|---|---|---|---|
| Idle | `4` | `MI_ASK_KIND` (the idle menu gains `MI_MENU_LINE`) | session `current_flow='invoice'`, step 1 [read S050:164-170]. Nothing else. |
| S1 | `1` (DC) or `2` (invoice); also `dc`/`challan`, `invoice`/`bill` [read S050:195-202] | `MI_ASK_FILE_DC` or `MI_ASK_FILE_INVOICE` | step 2, `mi_kind` in context |
| S2 | photo(s) or PDF | `MI_FILE_RECEIVED` then the ack question (`MI_ACK_QUESTION_DC` / `_INVOICE`) | in one transaction: `capture_documents`, `deliveries` (status `incomplete`), `capture_files` rows (`pending`), a `capture_ingest` job; for an invoice also the automatic delivery's self-link [read S050:322-394] |
| S3 | `1` / `2` / `3` | `1`: `MI_DONE`, flow closes. `2`/`3`: `MI_ASK_NOTE_NO` / `MI_ASK_NOTE_PARTIAL` | ack stored on the document; delivery moves to `awaiting_pm` only if it was `incomplete` [read S050:243-259] |
| S3 | more photos/PDF | a file reply (see OQ5); session stays at step 3 | new `capture_files` rows on the SAME document (D-11) [read S050:227-231, 348-360] |
| S3 | anything else | `MI_ACK_REASK` once, then ack `unclear`, raw text kept as note, flow closes | [read S050:232-242, 265-270] |
| S4 | free-text note | `MI_DONE` | note stored, flow closes [read S050:275-292] |
| any step | silence 30 min, or the IST date changes, then any message | `MI_SESSION_ENDED_REPLY` once; that message is not processed; the next message goes to the normal idle path | D1(d) — section 3f |
| S1/S2 | garbage twice | `MI_KIND_REASK`/`MI_FILE_REASK` once, then `MI_NOTHING_RECORDED_CLOSE` | nothing recorded [read S050:203-211, 217-225] |

The file itself is stored later by the `capture_ingest` job (PDF/image byte checks, original bytes kept, private bucket `capture-documents` created by 049) [read S049:1021; S050:378-385; V3:203].

### 1.2 What a PM sees

Nothing until PR-D [read V3:237]. The PM page, approve/reject/link/unlink UI and the `capture` photo-access kind's only consumer are PR-D. (PR-C's v3 row lists the photo-access kind [read V3:236]; I propose moving it to PR-D — section 2 and OQ9.)

### 1.3 In scope (the PR-C list from V3:236 and PB:34, 362-364)

Router/dispatch exhaustive flow mapping (N1); the A27 router read and expire-first order; D1(d); the `'invoice'` handler; PDF acceptance and byte checks; the `capture_ingest` job; S-F; S-3; D-8 (`capture_files` immutability + column UPDATE grant); D-30 real-phone test; wiring the `capture_deferred` key to a reply (PB:266, 306); the fixed-clock fixture fix (CF:8-9); digit 4 kept dark and then switched on.

### 1.4 Out of scope

PM page and all `pm_*` UI (PR-D); machine reading, money, owner email, automatic matching (slice 1b, V3:361-380); any change to the seven 050 functions or the two N2 hunks (CF:5-7); `capture_documents`/`deliveries`/`delivery_invoice_links` changes; retention; new user-facing wording (every string comes to Aravind first, V3:219); Tamil (owed on all).

---

## 2. Split and tiers

CM §0 says one feature per session [read CM §0, "HOW WE WORK"] and the database change must be its own FULL-tier PR separate from app code (brief). V3 lists PR-C as one FULL PR [read V3:236]; I argue that is too large for one review and propose six. Letters A/B/C below are NOT used for the sub-PRs, because "rollback order C, then B, then A" already means PR-C, PR-B (050), PR-A (049) [read PB:333].

| PR | Contents | Tier | One-line reason |
|---|---|---|---|
| **C1** | `test/helpers/capture-fixtures.ts` fixed clock (3g); one new unit test | LIGHT | Test-only; nothing in prod changes; CM §0 two-tier rule: only Aravind's own test data at stake [read CM §0, 2026-09-19 correction]. |
| **C2** | Migration 051 (held in `docs/reviews/` until applied): `capture_files` immutability trigger + column UPDATE grant (D-8); review package; DOWN files; DB tests. **No app code.** | **FULL** | A grant plus a trigger on a tenant-scoped table: external-review trigger (b) [read CM §0, EXTERNAL REVIEW GATE]. |
| **C3** | Router safety, all dormant: exhaustive flow mapping (N1), routing-state read, expire-first, D1(d) one-shot reply, S-3 guard, `capture_deferred` reply wiring, the digit-4 switch module (default off) | **FULL** | Changes how EVERY inbound message is routed; a misroute reaches a real engineer's phone. |
| **C4** | The `'invoice'` handler (wrapper + reply builder), S-F failure path, webhook media gate for PDFs (only inside an `'invoice'` session) | **FULL** | Handles third-party bytes and extends what the webhook accepts [read V3:236 reason]. |
| **C5** | `capture_ingest` job handler, byte checks, tick dispatch + dead-letter | **FULL** | Writes tenant-scoped rows and a private bucket using the C2 grant. Deploys only after C2 is applied on prod. |
| **C6** | Switch digit 4 on: flip the switch, add `MI_MENU_LINE` to the idle menu, rewrite T-WH-17/21/25 to the idle nudge, spec-sync edit | **FULL** | Real engineers' phones start receiving the new flow; one-line diff but the highest-consequence change. |

Order: **C1 → C3 → C2 (review → test-db apply → DOWN rehearsal → CI → merge → prod apply) → C4 → C5 → D-30 test → PR-D live → C6.** C1 and C3 do not need the DB change. C5 needs C2 on prod (its UPDATE needs the grant) `[inferred]`. C6 needs PR-D merged and applied [read V3:241] and the D-30 test passed [read R49:138, P49:71].

**Why not fewer:** C3 alone touches the router for every message and is independently reviewable and, being dark, independently mergeable. Folding C3 into C4 would make the reviewer read routing, handler, S-F and PDF byte checks as one change `[inferred]`. **Why the photo-access `capture` kind is not in this table:** its only consumer is the PM page (PR-D), so in PR-C it would be an unused access-control extension; V3:236 puts it in PR-C, so this is a deviation for Aravind to approve (OQ9).

**Overload rule applied to the split.** C2 adds ONE new function, `trg_capture_files_before_update`, which is not one of the seven names the 050 DOWN counts [read CF:5-6; S050 DOWN guard quoted at CO:108-122]. C3-C6 add no SQL. So neither 050 DOWN file needs editing; a CI static test enforces it (3d, 8).

---

## 3. Blockers

### 3a. S-F — record inbound media, or record and alert on failure

**The problem [read].** The webhook consumes the SID at `RT:224` (`isNewMessage` inserts into `processed_messages`, `idempotency.ts:24-38`; a repeat returns `duplicate_ignored`, `RT:225-228`) before project resolution (`RT:244`), media classification (`RT:256`) and routing (`RT:338`). There is no try/catch around any of that in `handleWebhookPost` (`RT:85-349` read in full) `[read]`. So an exception after `RT:224` returns 500, Twilio retries, the retry is dropped as a duplicate, and the capture is silently lost. R49:134 states the same hazard; PB:355 and R49:143 say PR-C owns the fix.

**The ordering constraint [read].** `received_at` is read inside the RPC from `processed_messages.created_at` for the message SID; a missing row or NULL `created_at` is refused with QE012 (S050:313-320). So the SID row must exist before the RPC runs, and PR-C cannot move SID consumption to after processing unless 050 changes (PB:47-48, 355). The RPC is idempotent per SID as a second line of defence (S050:132-144). Because the row is created at webhook arrival, `received_at` = arrival time, not RPC time `[inferred from S050:315-317 and RT:224; `processed_messages.created_at` default not read — migration 011 not opened]`.

**Options.**
- **S-F-1 (recommended): record and alert, keep the SID consumed.** In the C4 handler wrap the RPC call (and the session read) in try/catch. On failure: (i) Sentry error, fingerprint `['capture-inbound','rpc_failed']`, extra = counts and content types only — no URL, phone, body, tenant or user id (the P0 rule: counts, content types, ids only [read V3:233]; same shape as the unsupported-media event, `RT:266-271`); (ii) reply `MI_CAPTURE_FAILED_REPLY` (NEEDED, no wording) telling the engineer to resend; (iii) return 200 so Twilio does not retry. Nothing is created because the RPC is one transaction `[inferred]`; a resend carries a new SID and succeeds. **Residual risk, stated:** a process crash or function timeout between `RT:224` and the catch still loses the capture silently — the window is one request, and the only record is whatever Sentry caught before dying.
- **S-F-2: un-consume on failure.** Delete the `processed_messages` row and return 500 so Twilio's retry reprocesses; the RPC's SID check makes this safe. Costs: `received_at` shifts to the retry time `[inferred]`; needs `service_role` DELETE on `processed_messages` — 047 revoked DELETE only from anon/authenticated (047:201) and the default ACL gives `service_role` everything (CM §6, per-role rule), so likely held `[inferred]`, unverified (no DB access).
- **S-F-3: durable pre-record.** Before `RT:224`, for any message carrying media, insert a `jobs` row keyed by the SID holding the content types and media indexes (precedent: the ingest job payload already carries the media URL, S050:366-369) and have a reconciler replay any SID with no `capture_files` row. Closes the crash window. Cost: a new job type, a reconciler, and a decision to persist a Twilio URL beyond the file reference (CM §6 allows it only transiently; the same URL is already in the 050 job payload, S050:369) `[inferred]`.

**Recommendation:** S-F-1 now, S-F-3 only if Aravind will not accept the crash window (OQ4). This satisfies the S-F wording "or add a failure path that records and alerts" [read R49:134].

**Tests.**
- `T-SF-1` (C4): inject an RPC failure on a media message in an `'invoice'` session after the SID is consumed. Assert: one Sentry event with that fingerprint; the event contains no URL/phone/body (assert on the captured extra); reply is `MI_CAPTURE_FAILED_REPLY`; the `processed_messages` row remains; the HTTP result is 200; a resend with a NEW SID creates exactly one document. **Positive control:** remove the try/catch → the call throws, no Sentry event, test red.
- `T-SF-2` (C4, static/ordering): `RT` consumes the SID before the router call and the RPC still refuses a missing row (reuse the Q2-6 test in `test/capture-engineer-flow.test.ts` `[read: header comment line 6]`). Control: a call with `skipProcessed` (FX:291-292) gives QE012.
- `T-SF-3` (C4): the handler does not catch QE-coded refusals as network failures — a QE012 refusal still produces the failure reply AND the Sentry event (it is a bug signal) `[inferred]`.
- Crash-window test: **cannot be written**; I say so (CM §7: say when a test cannot be written). The residual risk is accepted or S-F-3 is built.

### 3b. S-3 — while `invoice_reset_guard` is set, a media message must not become a check-in photo

**The problem [read].** N2 discards a live `'invoice'` session when a check-in starts and sets `invoice_reset_guard` = `'morning'` or `'evening'` (S050:1142-1150, 1473-1482); the first non-empty step-1 text is deferred and clears it (S050:1169-1175, 1501-1507). Text is handled in SQL. A PHOTO takes the router's media branch for an active morning/evening session: it resolves/creates the `daily_logs` row, enqueues `media_ingest`, sets `*_photos_status='pending'`, and re-asks (IS:786-888, enqueue at IS:837, status update IS:839-843). So a delivery photo sent right after the reset is stored as a check-in photo (PB:256, 363). The most likely moment is S2/S3 at 08:30/18:30.

**Design (C3).** The routing-state read (3c) also returns `context.invoice_reset_guard` for morning/evening sessions. In the morning/evening media branch, BEFORE `resolveDailyLogId` (IS:790) add: if `guard === firstFlow` (the same scoping rule the SQL uses, S050:1169, 1501) → do not resolve or create a `daily_logs` row, do not enqueue `media_ingest`, do not touch `*_photos_status`; reply with `MI_CHECKIN_PHOTO_NOT_SAVED_REPLY` (NEEDED, no wording — name proposed here) followed by the current step's question. The guard is NOT cleared by a photo (only the first non-empty text clears it, S050:1169-1175). A guard for the other check-in is inert. Everything is gated behind sessions that can only exist after digit 4 is on, so it is dormant in C3 `[inferred]`.

**Tests (C3), against test-db with the real 050 functions:**
- `T-S3-1`: seed morning step-1 with `invoice_reset_guard='morning'`; send a photo through `routeInboundMessage`. Assert `daily_log_photos` row count unchanged, no `media_ingest` job for that engineer's daily log, `morning_photos_status` unchanged, guard still `'morning'`, reply starts with the new string constant.
- `T-S3-2` evening mirror with `'evening'`.
- `T-S3-3` inert: guard `'morning'` on an EVENING session → photo handled as today.
- `T-S3-4` after the first text clears the guard, the next photo is a normal check-in photo. **This is the positive control** (the guard is what changed the outcome).
- `T-S3-5`: a PDF while the guard is set still gets `UNSUPPORTED_MEDIA_REPLY` and stores nothing (unchanged route, RT:261-273).
- `T-S3-6`: `isPhoto` true with zero extractable items while the guard is set — not dispatched as an answer `[inferred: IS:749 falls such a message to dispatch with the caption as `message`]`.

### 3c. Expire first

**Requirement [read].** `expire_stale_material_inward` must run before ANY flow function sees the row, because any other flow's turn over an `'invoice'` row persists `expires_at = p_now + 30 min`, even on `reask` (044:604-614 as quoted at PB:320; PB:364). Today `routeInboundMessage` reads `readActiveFlowForRouting` first (IS:708), which selects only `current_flow, updated_at` (SS:91) and returns null on a different IST date (SS:100). It never selects `expires_at` or `context`.

**Design (C3).**
1. New `readRoutingState(phone, now)` in SS (replaces the single caller at IS:708): one select of `current_flow, updated_at, expires_at, context`.
2. If `current_flow === 'invoice'`: call `expire_stale_material_inward(phone, asOf)` via `service_role` BEFORE anything else. `asOf = now`, except in the IST-day-stale case (3f) where it is `max(now, expires_at)`.
3. Only after step 2 does routing continue: `invoice` and still live → the C4 handler; otherwise the existing branches.
4. Callers that bypass the router and are unaffected: the scheduled check-in start RPCs (they discard `'invoice'` via N2, S050:1142-1150) and the env-gated test sentinel (RT:310-325) `[inferred]`. `dispatchInboundTurn`'s own `readCurrentFlow` fallback (DP:258-266) is not used in production because `firstFlow` is always passed (DP:259-265) `[read]`.
5. Replace both flow collapses with one exhaustive function ending in a TypeScript `never` check: IS:723-724 and DP:266 map anything not evening/hindrance to `'morning'` `[read]`; `SessionFlow` has five values (SS:6). `Flow` at DP:47 stays three-valued (V3:211). `'safety'` is never written (IS:719 comment) so it maps to "idle path + Sentry warning, no write" `[inferred]` (OQ8).

**Tests (C3).**
- `T-C3-1` order, real DB: seed `'invoice'` row with `expires_at` 1 minute past, idle `1`. Assert the hindrance flow STARTS (outcome `start`) and the row's invoice keys are gone. **Positive control:** a test-only router variant that calls the hindrance function first gets `reask`, and the row's `expires_at` is refreshed (this is the CI-run-845 failure, PB:320).
- `T-C3-2` order, spy: the first service RPC after the select is `expire_stale_material_inward`; no morning/evening/hindrance RPC precedes it. Control: swap the order → red.
- `T-C3-3` exhaustive: every `SessionFlow` value through the mapping; a fake sixth value fails `tsc` (a `// @ts-expect-error` test) `[inferred]`.
- `T-C3-4` morning/evening/hindrance rows idle 31 minutes are NOT expired (V3 T-A27-7 at V3:269).
- Pre-existing test that goes RED: `test/unit/sentry-call-sites-no-phone.test.ts:26` mocks `readActiveFlowForRouting`; the mock must follow the new name `[read]`.

### 3d. D-8 — `capture_files` immutability and the column UPDATE grant (FULL tier, PR C2)

**Sources [read].** P49:33 (D-8: the column UPDATE grant moved from PR-A to PR-C; 049 grants `service_role` SELECT only, S049:974-981). R49:145 (PR-C BLOCKING: once stored, `storage_path`, `sha256`, `byte_size`, `content_type` immutable; `stored` and `rejected` terminal; identity columns immutable; "proven open on the reviewer's stub — a stored file's `sha256` was rewritten"). V3:103 (grantee `service_role`, column-scoped UPDATE on `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`, precedent 039). PB:362 repeats it. The table's CHECKs already tie `stored` to non-null path/type/size/hash, cap size at 16777216 bytes, pin the content types and the path prefix (S049:332-337); `ingest_status` allows `pending|stored|rejected|failed` (S049:326).

**Exact SQL objects (migration 051 — number `[inferred]`: reservations and the review directory end at 050, `scripts/migration-number-reservations.json:78-80` `[read]`; confirm with `ls supabase/migrations/` at apply, CM §6).**
1. `public.trg_capture_files_before_update()` — `RETURNS trigger`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`, same shape as `trg_capture_documents_before_update` (S049:770-815). Body: first statement the non-READ-COMMITTED refusal QE014 (S049:778-780); then
   - identity columns immutable → QE009: `id, created_at, tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type`;
   - `OLD.ingest_status IN ('stored','rejected')` → any change to any column → QE011 (terminal). An UPDATE that changes nothing is allowed so a retried job is a no-op `[inferred]`;
   - no move back to `pending`; `failed` may move only to `stored`/`rejected` `[inferred, OQ10]`.
   Existing codes are reused (QE009 "immutable column", QE011 "transition/locked", QE014 isolation — mapping at PB:129-131); no new code `[inferred]`.
2. `CREATE TRIGGER trg_capture_files_before_update BEFORE UPDATE ON public.capture_files FOR EACH ROW EXECUTE FUNCTION public.trg_capture_files_before_update();`
3. `REVOKE ALL ON FUNCTION public.trg_capture_files_before_update() FROM PUBLIC, anon, authenticated, service_role;` — all four roles by name, as 049 does for its trigger functions (S049:983-985; CM §6 per-role rule).
4. `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) ON public.capture_files TO service_role;` — column-scoped; no table-level UPDATE; nothing for `anon`/`authenticated`.
5. In-file post-condition block in the 049/050 pattern (S049:1051-1099 as cited at PB:242): exactly one `pg_proc` row for the new function; `prosecdef`; `proconfig` empty search_path; owner `postgres`; no role holds EXECUTE; trigger present and enabled; `has_column_privilege('service_role', …)` true for exactly the seven columns and false for every other column; `has_table_privilege(…,'UPDATE')` false for all three roles; `service_role` still holds no DELETE/TRUNCATE on the table.
6. A commented DOWN block plus `docs/reviews/051-down-testdb.sql` and `docs/reviews/051-down-prod.sql` (drop trigger, drop function, `REVOKE UPDATE (…) ON capture_files FROM service_role`), each with its sha256, and a DOWN precondition guard like 050's (CO:108-122). "PITR substituted" = a prod-captured pre-apply readback of the table's ACL (`proacl`/`relacl`, column ACLs) and trigger list, saved with its sha256, plus the DOWN `[inferred from CO:150-152, PB:438]`.
7. Same-PR extras: dry-run on a scaffold built from a real dump (CM §7); `scripts/migration-number-reservations.json` entry at apply (CM §0, Step H); regenerate `types/database.ts` after the apply (CM §6) — no type change expected `[inferred]`; teardown checks `obj_description` for any `COMMENT ON` the migration adds (CM §7).

**Tests (C2, test-db).**
- `T-D8-1` positive: `service_role` UPDATEs the seven columns on a `pending` row → ok. (RED before 051: 42501, no grant.)
- `T-D8-2` grant layer: `service_role` UPDATE of `file_no` or `claimed_content_type` → 42501 (column not granted). Trigger layer with the grant bypassed (table owner, rehearsal scaffold, as V3:275 requires for bypass tests): same UPDATE → QE009.
- `T-D8-3` the reviewer's stub case: on a `stored` row, rewrite `sha256` → QE011; also `storage_path`, `byte_size`, `content_type`.
- `T-D8-4` `rejected` terminal; `T-D8-5` `stored → pending` refused; `T-D8-6` no-op UPDATE on a stored row allowed (retry safety).
- `T-D8-7` `authenticated` (a PM) and `anon` UPDATE → 42501, including a real anon-key call (CM §6 required line for new objects).
- `T-D8-8` `service_role` DELETE and TRUNCATE on `capture_files` → 42501 (CM §7 rehearsal requirement; unchanged by 051).
- `T-D8-9` the function is not callable by any of the four roles.
- `T-D8-10` DOWN rehearsal executed (not just written; CM §7): after DOWN, `service_role` UPDATE → 42501, trigger and function gone, comments/ACLs match the pre-rehearsal values. Because app code (the C5 ingest) calls this UPDATE, DOWN is rehearsed with a `pending` file row seeded and a queued `capture_ingest` job present, and the order C5 rolled back first is stated in the package `[inferred from CM §7 DOWN rule]`.
- `T-D8-11` overload rule, static (also in C3-C6): scan `supabase/migrations/` and `docs/reviews/*.sql` for `CREATE [OR REPLACE] FUNCTION public.<name>` of each of the seven 050 names; exactly one definition each (050 itself). Control: a planted second definition fails.
- Race/lock tests: none new; QE014 isolation is single-session. Anything concurrent is CI-only "not verified locally" (CM §0).

### 3e. D-30 — real-phone multi-photo test (manual script for Aravind)

**Why it exists [read].** Confirm how WhatsApp/Twilio delivers several photos selected together (one message with N media, or N messages); the bot must ask 1/2/3 ONCE per document (R49:138; P49:71 "One document per capture flow … A different document needs a new flow"). The RPC creates the document from the first file message and attaches later files at S3/S4 (S050:227-231, 275-279, 348-360). What the bot replies to each ADDITIONAL file is undecided (D10 left to PR-C, PB:55; V3:387) — OQ5.

**Preconditions.** C1-C5 deployed; digit 4 reachable for Aravind's own test phone only (the allowlist in section 4, OQ3); every `MI_*` slot used below has approved wording (the script cannot run before then; only `MI_SESSION_ENDED_REPLY` is approved today); Aravind's test project has him as engineer; the three read-only checks use the Supabase dashboard run by Aravind (Claude Code does no DB access in this plan). Record in a table: step, what was sent, replies seen (constant name), pass/fail.

| # | Do | Expect (constant names) | Check afterwards (read-only) |
|---|---|---|---|
| 1 | Send `4` | the kind question (`MI_ASK_KIND`) | `whatsapp_sessions`: flow `invoice`, step 1 |
| 2 | Send `1` | `MI_ASK_FILE_DC` | step 2, `mi_kind='dc'` |
| 3 | In WhatsApp choose THREE photos at once and send | exactly ONE ack question (`MI_ACK_QUESTION_DC`) in total, whichever way delivery happens | see 4 |
| 4 | Note in the Twilio console how many inbound messages arrived (1 with NumMedia=3, or 3 with NumMedia=1). Write it down. | extra-file replies per the OQ5 decision | `capture_documents` = 1 row; `capture_files` = 3 rows, `file_no` 1..3; `deliveries` = 1 row `incomplete`; `jobs` of type `capture_ingest` = 1 or 3 matching the message count |
| 5 | Send `1` | `MI_DONE` | delivery `awaiting_pm`; document ack `yes`; files `stored` after the next tick |
| 6 | Send `4`, `2`, then ONE PDF | `MI_ASK_KIND`, `MI_ASK_FILE_INVOICE`, then the ack question for an invoice | an invoice document, an automatic delivery, one self-link; one file with `content_type` `application/pdf` |
| 7 | Reply `1` | `MI_DONE` | |
| 8 | Send one more photo (flow already closed) | the existing idle photo nudge (`MEDIA_NUDGE_REPLY` + `MEDIA_NUDGE_PROGRESS_LINE` + idle menu, MR:73,80; IS:692-694) | nothing new attached to the closed document |
| 9 | Send `4`, `1`, one photo, then wait 31 minutes and send `1` | `MI_SESSION_ENDED_REPLY` (approved text) and nothing else | the `1` created no ack; session cleared; delivery still `incomplete` |
| 10 | Send `hello` | the normal idle reply — NOT `MI_SESSION_ENDED_REPLY` again | |
| 11 | Optional: repeat 3 with a 2-page PDF plus a photo | one ack question | |

The IST-midnight case (23:59 session answered at 00:01) is not practical by hand; it is covered by the clock-controlled test in 3f `[inferred]`. Failure of any row blocks C6.

### 3f. D1(d) — where the one-shot reply fires, how the router detects it

**What the code does today [read].** `readActiveFlowForRouting` returns null for an `'invoice'` row whose `updated_at` is on another IST date without clearing it (SS:99-101); `expires_at` is not read at all (SS:91). `expire_stale_material_inward` returns `true` only when it cleared an `'invoice'` row with `expires_at <= p_now`, and `false` for any other row (S050:426-460). `apply_material_inward_turn`, called with `p_start_flow=false` on a stale-IST-day row, resets it in memory and returns `idle` WITHOUT writing (S050:146-152, 178-179; `v_touch` stays false), so the row stays `'invoice'` `[read]`.

**The defect this exposes (needs Aravind, OQ7).** If the router answers the day-stale case with the one-shot reply but nothing clears the row, the NEXT message sees the same stale row and gets the reply AGAIN, until some other path clears it. Worse, the midnight-crossing session (a turn at 23:50 has `expires_at` 00:20; a message at 00:05 is IST-day-stale but not yet expired) later becomes expired, and the first message after 00:20 would get `MI_SESSION_ENDED_REPLY` a second time `[inferred from S050:154-162, 407-408 and SS:100]`. D1 says "No SQL change", and no existing function clears an unexpired day-stale row.

**Design that needs no SQL change (recommended, `[inferred]`):** `expire_stale_material_inward` takes `p_now` as a parameter (S050:426-429) and re-checks `current_flow='invoice' AND expires_at <= p_now` under the row lock (S050:449). For a day-stale `'invoice'` row the router passes `p_now = max(now, expires_at)`, which makes the same locked, subtract-only clear apply, and a late turn that refreshed `expires_at` in between makes it return false (safe). It is a documented parameter used in a way its header does not describe; a test must prove it. Alternatives: (b) a direct `service_role` UPDATE from TypeScript — no TS file writes `whatsapp_sessions` today (grep: only reads at IS:464, IS:857, SS:57, SS:90, `lib/checkin-escalations/reachability.ts:41` `[read]`), and it would bypass CM §6's lock rule; (c) a small SQL change, which reopens D1's "no SQL change".

**Router flow (C3), inside `routeInboundMessage` before any flow dispatch:**
1. `row = readRoutingState(phone, now)`; `dayStale = istDate(now) !== istDate(row.updated_at)` (the SS:100 comparison).
2. If `row.current_flow === 'invoice'`: `cleared = expire_stale_material_inward(phone, dayStale ? max(now, row.expires_at) : now)`.
3. If `cleared` → return `{ reply: MI_SESSION_ENDED_REPLY, resolvedFlow: null }`. The inbound message — text, photo, PDF or a bare `4` — is NOT processed (OQ1, OQ11).
4. Detection of (i): `cleared` with `dayStale=false`. Detection of (ii): `cleared` with `dayStale=true`. Both use the same reply.
5. Race outcomes inside the handler (C4): RPC outcome `expired` (S050:154-162) → the same reply; RPC outcome `idle` from a day-stale in-memory reset (S050:178-179) → clear as in step 2, then the same reply `[inferred]`. These two are race paths: CI-only "not verified locally" (CM §0).
6. Morning, evening and hindrance rows that are day-stale keep today's behaviour: null → idle path, no ended reply (T-A27-7, V3:269).

**Tests (C3), real DB, explicit `now` on every call (never the real clock):**
- `T-D1-1` (i) expiry: `'invoice'` at step 3, `expires_at` = now − 1 min → reply is `MI_SESSION_ENDED_REPLY` exactly (approved text), row cleared, no hindrance/other RPC called, no ack written. Control: at now − 29:59 the same message is handled by the flow (V3 T-A27-2 avoids exactly 30:00, V3:264).
- `T-D1-2` (ii) IST-day: seed `updated_at` 23:50 IST day D−1, `expires_at` 00:20 IST day D (unexpired), `now` 00:05 IST day D → ended reply once, row cleared. (This is CF:11-12.) Control: the same seed for a `'morning'` row → idle reply, no ended reply.
- `T-D1-3` **the next message goes to the normal idle menu:** after T-D1-1 and after T-D1-2, send `hello` → `buildIdleReply('unrecognized', header)` (IS:368-370); send `1` → hindrance start; a third send never repeats the ended reply. **Control:** with the clear step deleted, T-D1-2's second message repeats the ended reply (this is the defect above).
- `T-D1-4` a photo and a PDF as the first message after expiry → ended reply, no `capture_*` row, no `media_ingest` job, no idle nudge claimed (`claim_media_nudge` not called, IS:668 path unreachable). (Amends V3 T-A27-9, V3:271, which expected the idle nudge.)
- `T-D1-5` a message at 29:59 after the last turn is processed by the flow; a turn every 25 minutes never expires (V3 T-A27-5, V3:267).
- Doc conflict to correct, not reopen: CED:284 (A29, 10 Oct) had a different rule — only a bare 1/2/3 on the same IST day got the closed-question reply "plus the menu", everything else the idle path. D1(d) of 26 Oct replaces it (any message, no menu, also the IST-day case). PR-F needs a dated correction (OQ12).

### 3g. Fixed clock — the fixture fix

**Cause [read/inferred].** `miTurnRaw` sends `p_now` only when `o.now` is set (FX:312), so with no `now` the RPC uses the database clock. `makeDoc` drives start → kind → file across separate calls with `base` empty when `o.now` is absent (FX:341-345). The RPC applies the IST-day rule against the previous turn's `updated_at` (S050:146-152). CO:41-57 shows run 40217915047 attempt 1 failing at `makeDoc(r11-dc3)` with `outcome:idle` when the gap spans 18:30Z. The IST-day reset mechanism matches that symptom; CO:57 itself says "fixture code not traced", so the link is `[inferred]`.

**Second defect in the proposed fix (found while reading).** `noonIst()` reads `new Date()` on every call (FX:280-285). A scenario that calls it once before midnight and once after gets two instants 24 hours apart — the same failure. So the fix is two parts: (1) memoise `noonIst()` per process (first call wins), (2) make `miTurnRaw` default `p_now` to it, so `makeDoc`, `miTurn` and `ack` all inherit.

**Existing tests that rely on the real clock [read: `grep -rln capture-fixtures test` = exactly four files; counts are by grep line, so multi-line calls may be undercounted].**

| File | Turn-call lines | Lines mentioning `now` | Real-clock spots |
|---|---|---|---|
| `test/capture-engineer-flow.test.ts` | 71 | 14 | `makeDoc`/`miTurn` calls without `now` rely on the DB clock; scenarios that move time already use `noonIst()` (10 uses) |
| `test/capture-pm-functions.test.ts` | 36 | 0 | every `makeDoc` uses the DB clock; also `Date.now()` for `received_at` inserts (lines 513, 525) and `new Date()` for `unlinked_at` (554, 601, 608) — these are timestamps, not session clocks, but `received_at` drives `delivery_date` |
| `test/capture-races.test.ts` | 19 | 3 | `makeDoc(r11-dc3)` is the failing call (CO:52); `Date.now()` at lines 44-61 is timing diagnostics only; `noonIst()` at 282 |
| `test/capture-checkin-n2-n13.test.ts` | 3 | 2 | its own `morning`/`evening` helpers pass `p_now` only if given (lines 51, 67, 81); `istToday()` at line 98 compares a `log_date` to the real date; 9 `noonIst()` uses |

Tests outside these four files do not import the fixtures `[read]`; whether other suites (`test/webhook.test.ts`, `test/inbound-start.test.ts`) cross midnight in the same way was NOT audited. Secondary spots to review in C1: `n2-n13:98` (`istToday()` vs a fixed noon — add an `istDateOfFixedNoon()` helper), and any test that seeds a session with a real-clock `updatedAt` via `seedSession` (FX:437-454) and then calls `miTurn` with the default.

**C1 tests.** `T-CLK-1` (unit, vitest fake timers): set the system time to 18:29:58Z, run `makeDoc`'s first step, advance to 18:30:02Z, run the rest → expect a document, not `idle`. RED against today's fixtures, green after. `T-CLK-2`: `noonIst()` returns the identical instant on two calls on either side of 18:30Z. Gate: all four capture files green in CI; any that go red are listed in the C1 PR description as "mixed seeded real-clock + default p_now" `[inferred]`.

---

## 4. Digit 4 stays dark until PR-D is live

**What "4" does today [read].** `classifyAdhocInput` maps digits 3-7 to `item_reserved` (IS:263); the reply is the correction line "That option isn't available yet. Nothing was recorded." plus the idle menu (IS:350, 368-370). No existing test sends `4`: the nearest are `typed "7"` at `test/inbound-start.test.ts:489-495` and the spec-sync combos for 3-7 at `test/unit/adhoc-menu-spec-sync.test.ts:106-109` `[read]`.

**Mechanism (recommended).** A new module `lib/whatsapp/capture-switch.ts` exporting `isCaptureDigit4Live(phone)`:
- `CAPTURE_DIGIT_4_LIVE = false`, a code constant — auditable in git, identical on Preview and Production. Reason for a constant over an env var: the repo already has env-var hazards (the `ENABLE_TEST_FLOW_TRIGGER` gate is the only flag-style env read, `lib/whatsapp/flows/test-trigger.ts:13` `[read]`; my memory notes a bad-paste env-var bug class `[inferred]`).
- Plus an optional strict allowlist `CAPTURE_DIGIT4_TEST_PHONES` (comma-separated E.164, parsed strictly, any malformed entry → empty list = fail closed) so Aravind's own phone can run the D-30 test on prod while everyone else stays dark. Without it the D-30 real-phone test cannot happen before engineers go live `[inferred]` (OQ3).
- The digit-4 branch in the router and the `MI_MENU_LINE` addition to `buildIdleMenu` (IS:363-366, which is currently phone-independent) both read the switch. While it is false for a phone, `4` falls through `classifyAdhocInput` exactly as today and the menu text is byte-identical.

**Everything else in C3-C5 is dormant while dark `[inferred]`:** no `'invoice'` row can be created except through `apply_material_inward_turn(p_start_flow=true)`, whose only caller is the new digit-4 branch (S050:164-170; the cron start RPCs do not create it). So the ended reply, S-3 guard, handler, ingest and PDF acceptance are unreachable. Prod held 0 `'invoice'` sessions at 20 Oct (PB:460) — re-check at deploy, read-only.

**PDFs stay as today while dark.** The webhook's media gate runs before routing knows the flow (RT:256-273). C4 makes it hand PDF/mixed image+PDF messages to the router only so the router can decide: inside an `'invoice'` session → handler; anywhere else → the same `UNSUPPORTED_MEDIA_REPLY` and the same Sentry event as today (RT:266-272). T-WH-17/21/25 (`test/webhook.test.ts:593,667,753` `[read]`) therefore stay green and unedited until C6.

**Acceptance test `AT-DARK-1` (C3, and re-run in C4/C5):** with no allowlist set, an engineer with no session sends `4` through `routeInboundMessage` (model: `inbound-start.test.ts:489-495`). Assert: `reply === buildIdleReply('item_reserved', header)`; `resolvedFlow === null`; no `whatsapp_sessions` row; `apply_material_inward_turn` never called (spy on `rpc`). **Control:** with the phone allowlisted the same call starts the flow and the reply differs. `AT-DARK-2`: `adhoc-menu-spec-sync` (IS menu text) stays green while dark. `AT-DARK-3`: an allowlist entry for phone X does not affect phone Y.

**Who turns it on and what must be true first.** Aravind, by merging C6 (one-line constant change, plus the menu line and test rewrites). Must be true first: PR-D merged and applied [read V3:241]; C1-C5 deployed and 051 on prod; D-30 script passed (3e); every `MI_*` slot has approved wording and the English text is in the repo; OQ1, OQ2, OQ5 answered; the cofounder confirmation of A10/A18 (open in V3:401, CED:324); not flipped inside 08:25-08:40 or 18:25-18:40 IST (section 6). Rollback is reverting C6 (instant); engineers mid-flow then hit the ended reply path at expiry `[inferred]`.

---

## 5. The three D1 checks

**5a. The noun in `MI_MENU_LINE`.** It does not exist anywhere in the repo. `MI_MENU_LINE` appears only as a slot name (V3:223, PB:43); a repo-wide search for the string "material inward" outside V3/PB found one hit: CED:173-175, "The PM page is labelled 'Material Inward' … The label applies to the page only. This record, the tables and the code keep the word 'delivery'" `[read]`. Nearby engineer-facing text uses other nouns: the approved `MI_SESSION_ENDED_REPLY` says "delivery question" (brief); the D-30 drafts say "DC or invoice" (P49:96-97). So the engineer-menu noun is undecided, and "Reply 4 to start again" in the approved reply points at a menu line whose wording does not exist yet. Rule 3.12 (same word for the same thing) applies [read V3:221] → OQ2.

**5b. Engineer replies `4` after a photo was already received — does the PM later see two deliveries?** Trace `[read S050]`:
- Session at S3 (document, delivery, files exist): the router sends `4` to the flow, not the menu, because the session is active. S050:227-273: `v_norm='4'` is not 1/2/3, so `v_ack` is NULL; first time `mi_reask` goes 0→1 and the outcome is `reask`; a second non-ack text sets ack `unclear` with note `4`, closes the flow. No new document, no new delivery. **One delivery.**
- Session at S1 or S2 (no file yet): `4` is not a kind/file → reask then close with nothing recorded (S050:195-211, 217-225). **Zero deliveries.**
- Flow already closed (`complete`/`unclear`): `4` at idle starts a NEW flow (S050:164-170), which writes only the session row. A second delivery appears ONLY if that second flow reaches S2 with a file: S050:322-345 creates a new document + delivery for every S2. **No cross-document de-duplication exists** — the only uniques are on SID and `(document_id, file_no)` (S049:329-330) `[read]`; no content hash uniqueness is declared `[read S049:312-338]`. So a re-sent photo is a second delivery and the PM would see two.
- After expiry or the IST-day reset: the first `4` is swallowed by D1(d) (OQ1); a second `4` starts a new flow. The first delivery stays `incomplete` ("not acknowledged"); if the engineer re-sends the same photo the PM sees two `[inferred]`.

**5c. What happens to a received file when the IST-day reset wipes a session at step 2 or 3.**
- **Step 2** (kind chosen, no file yet): no file exists. The session row is the only thing; clearing it loses `mi_kind` only. Nothing orphaned.
- **Step 3** (file received): the document, delivery and `capture_files` rows were committed at S2 (S050:322-360) and a `capture_ingest` job was inserted in the same transaction (S050:378-385). The clear touches only `whatsapp_sessions` (S050:157-161 for expiry; the day-stale reset is in memory, S050:146-152). So the file is **kept and linked**: its row points at the document (composite FK, S049:331) and the document at the delivery (`dc_document_id` / `created_from_invoice_id`, S050:329-340); the delivery stays `incomplete` and shows "not acknowledged" (V3:107, A27 at CED:280); the ingest job still runs because it does not read the session `[inferred: the payload carries no session reference, S050:378-385]`. The PM may approve it (D-10, PB:54). Not orphaned.
- **What IS lost:** a file sent AFTER the wipe. Under D1(d) that message is not processed, so its bytes are never fetched and Twilio's media URL expires (CM §6 notes Twilio URLs expire). The reply says the answer was not recorded; whether to also raise a counts-only Sentry event for it is OQ11.

---

## 6. Interactions with live 050 behaviour

| Case | What the engineer experiences | Source |
|---|---|---|
| **N2** — a scheduled check-in starts while a delivery session is live | The check-in template arrives (08:30 / 18:30). The delivery session is discarded; the start returns outcome `start` with `capture_discarded=true`; the delivery stays and shows "not acknowledged". The engineer is told nothing about the delivery. The next message is treated as the check-in's first message. | S050:1142-1150, 1473-1482; PB:265-266 `[read]`. No TS reads `capture_discarded` (grep over `lib app`: no hits) `[read]`; optional logging is PB:266's "optional PR-C work" (OQ15). |
| **N13** — the first step-1 message after a discard | A TEXT first message (a bare digit such as `1`, or a note typed after a `2`) is NOT taken as the answer: the RPC returns `reask` with `capture_deferred=true` and writes no attendance / `evening_output`; the flag clears; the second message is handled normally. Today the TS wrappers ignore `capture_deferred`, so the reply is just the plain step-1 question with no explanation (grep: no hits in `lib app`). C3 wires the key to the deferral explanation string (name `CHECKIN_RESET_EXPLAIN_REPLY` proposed; NEEDED, owed in PR-E per PB:305-306). A PHOTO first message: S-3 (3b). | S050:1169-1175, 1501-1507; test `test/capture-checkin-n2-n13.test.ts:160-176` `[read]` |
| **Hindrance flow** | While a delivery session is live every message, including `1`, goes to the delivery handler (it is an ack `yes`), never to hindrance — by design (V3 R1, V3:404). After expiry the first message gets the ended reply; the NEXT `1` starts hindrance (T-D1-3). A hindrance session in progress is never touched by delivery code: a start over a live other-flow session returns `reask` (S050:174-176), and digit 4 only fires at idle. Any hindrance turn over a stale delivery row would refresh its expiry — hence expire-first (3c). | S050:164-176; PB:320 `[read]` |
| **08:25–08:40 and 18:25–18:40 IST windows** | (1) An engineer mid-capture at 08:30/18:30 gets the N2 behaviour above — the most exposed moment (PB:308). (2) The 050 DOWN must not run in these windows because it holds EXCLUSIVE on `whatsapp_sessions` (PB:333). C2's migration locks only `capture_files` (a trigger/grant), not `whatsapp_sessions` `[inferred]`, so the lock analysis does not require the window; I keep the same window for the prod apply and for flipping C6 so there is one rule, not two (OQ13). (3) The trigger crons are 08:30 and 18:30 IST (`vercel.json`, PB:288 `[read]`). | PB:288, 308, 333 `[read]` |
| Scheduled sweeps | The 15:00 morning-cutoff sweep, the outbound coverage sweep and the escalation sweep run every tick (TK:104-152). Whether any of them touches an `'invoice'` row was NOT read; `reachability.ts:41` reads `whatsapp_sessions.updated_at` only for reachability `[read]`. Listed as an unknown. | TK:104-152 `[read]` |

---

## 7. Strings

No new wording is written here. A name marked "proposed" is only a constant name.

| Constant | Purpose | Status |
|---|---|---|
| `MI_SESSION_ENDED_REPLY` | D1(d) one-shot reply | **APPROVED** 2026-10-26 (Aravind, in the PR-C brief; not yet in the repo). English: "That delivery question has ended. Your answer was not recorded. Reply 4 to start again." Comment: "Tamil owed". |
| `MI_MENU_LINE` | idle menu line for digit 4 | NEEDED — no wording anywhere (5a) |
| `MI_ASK_KIND` | S1 | NEEDED (V3:223; PB:89) |
| `MI_ASK_FILE_DC`, `MI_ASK_FILE_INVOICE` | S2 prompts | NEEDED. A draft exists for the menu-4 prompt: "Send one DC or invoice. A PDF, or photos of all its pages together." — P49:94-96, "draft, approved in principle by Aravind 11 Oct; final wording checked in the 1a strings redraft; Tamil owed". NOT approved as a final constant. |
| `MI_FILE_RECEIVED` | reply after a file; "received", never "saved" | NEEDED (V3:223, R1 at V3:259) |
| `MI_ACK_QUESTION_DC`, `MI_ACK_QUESTION_INVOICE` | A18 numbered question; the invoice one must not ask whether goods arrived | NEEDED (V3:223, V3:355; CED:287 A32 "wording owed") |
| `MI_ASK_NOTE_NO`, `MI_ASK_NOTE_PARTIAL` | note prompts after `2`/`3` | NEEDED |
| `MI_ACK_REASK`, `MI_NOT_UNDERSTOOD_CLOSE` | one re-ask with one example, then close | NEEDED |
| `MI_DONE` | closing line | NEEDED. A draft exists: "Saved. To send another DC or invoice, choose 4 from the menu." — P49:97, same draft status. Flag: it contains "Saved." while V3:259 (T-R1-1) says every reply after a file says "received", never "saved" — OQ14. |
| `MI_KIND_REASK`, `MI_FILE_REASK`, `MI_NOTHING_RECORDED_CLOSE` | S1/S2 garbage | NEEDED (V3:223; marked `[GUESS]` in V3:91) |
| `MI_UNSUPPORTED_FILE_REPLY` | file type not accepted inside the flow (names PDF as accepted) | NEEDED (V3:223) |
| `MI_IDLE_DOCUMENT_NUDGE` | PDF at idle once digit 4 is live | NEEDED (V3:223). Until C6, PDF at idle keeps the approved `UNSUPPORTED_MEDIA_REPLY`. |
| `MI_CAPTURE_FAILED_REPLY` (proposed name) | S-F: capture failed, please resend | NEEDED — no wording; new in this plan |
| `MI_CHECKIN_PHOTO_NOT_SAVED_REPLY` (proposed name) | S-3: a photo arrived while the guard is set | NEEDED — no wording; new in this plan |
| `CHECKIN_RESET_EXPLAIN_REPLY` (proposed name) | N13 deferral: explanation + step-1 question | NEEDED — "STRING OWED — Aravind to supply", PB:305-306 (PR-E) |
| Progress line ("Question N of M") for these prompts | Rule 3.6 vs a flow of 3 or 4 steps | UNDECIDED — V3:49 (X10), V3:392 (D4); affects every prompt above |
| Existing, approved, reused unchanged | `UNSUPPORTED_MEDIA_REPLY` (MR:56, approved 2026-10-05); `MEDIA_NUDGE_REPLY` and `MEDIA_NUDGE_PROGRESS_LINE` (MR:73,80, stage 3); `PHOTO_SAVE_FAILED_REPLY` (IS:32, approved 2026-09-13); `FLOW_RACE_REPLY` (DP:44-45); `HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY` (IS:70-71, approved 2026-09-14) | APPROVED, existing. Not reused for S-F/S-3: their wording says "photo", "check-in" or hindrance-specific content `[inferred]`. |

Every new constant carries "Tamil owed, NOT approved" (V3:219). PM-page strings are PR-D.

---

## 8. Tests and rollout

Gate for every PR: CI "Test (real test-db)" green with the passing run's `headSha` equal to the PR HEAD, pinned by run URL (CM §0, GREEN CI CHECK). Concurrency/race tests are CI-only and labelled "not verified locally". Each PR runs `tsc --noEmit` and `npm test`; the three capture-fixture files and `test/webhook.test.ts` run in full. A single-file vitest summary line can go missing; use `--reporter=json` to settle it (CM §7).

| PR | Test files touched / new | Start RED, and why | Positive controls |
|---|---|---|---|
| **C1** | `test/helpers/capture-fixtures.ts`; new `test/unit/capture-fixtures-clock.test.ts` | `T-CLK-1` (crosses 18:30Z; today's fixture returns `idle`); `T-CLK-2` (`noonIst()` not memoised). No existing test should go red `[inferred]` — if any does, it is a mixed-clock test (3g). | `T-CLK-1` itself against the old fixture |
| **C2** | `docs/reviews/051-*` (migration, review package, two DOWN files), new `test/capture-files-immutability.test.ts` (T-D8-1…11), reservations JSON, `types/database.ts` regen | All `T-D8-*` red before apply (no grant → 42501; no trigger). No existing test asserts `capture_files` UPDATE is denied (grep over `test`: no hits) `[read]`, so none should go red. | T-D8-1 (grant works), T-D8-2 (owner bypass reaches the trigger), anon-key call. Tier FULL steps: external review → test-db apply → DOWN rehearsal with captured output → CI green with pinned URL → merge (regular merge commit; the branch continues, CM §0) → PITR substituted → prod apply (below) → verify by observation → ledger → apply record → file moves into `supabase/migrations/` only in the apply commit (CM §6). |
| **C3** | `lib/whatsapp/session.ts`, `inbound-start.ts`, `dispatch.ts`, new `capture-switch.ts`; `test/inbound-start.test.ts` (+), `test/dispatch.test.ts` (+), new `test/capture-router.test.ts`; fix mock in `test/unit/sentry-call-sites-no-phone.test.ts:26` | `T-C3-*`, `T-D1-*`, `T-S3-*`, `AT-DARK-*` (new behaviour). `sentry-call-sites-no-phone` goes red until its mock is renamed `[read]`. | T-C3-1 reversed order; T-D1-3 with the clear removed; T-S3-4; AT-DARK-1 allowlisted |
| **C4** | `lib/whatsapp/flows/material-inward.ts` (new), `inbound-start.ts`, `app/api/whatsapp/webhook/route.ts`, `media-reply.ts` (second classifier, `classifyMediaReply` unchanged so `test/unit/media-reply.test.ts:46` stays green `[read]`); new `test/capture-handler.test.ts` (T-FLOW-1..4, T-R1-1, T-A18-1 reply halves, V3:255-260; T-SF-1..3) | New tests red. `test/webhook.test.ts` T-WH-17/21/25/18-24 must stay GREEN and unedited (dark). | T-SF-1 without the try/catch; V3 T-PDF-5 control "a PDF inside an active session is accepted" (V3:262) |
| **C5** | new `lib/media/capture-ingest.ts`, `app/api/jobs/tick/route.ts` (dispatch case + dead-letter, today an unknown type throws at TK:84-85 `[read]`), tests `test/capture-ingest.test.ts`: T-PDF-1..4, T-SIZE-1, T-R5-1 (V3:261) | New tests red; also a test that a `capture_ingest` job with no handler fails (documents the current state) | Encrypted PDF stored `not_previewable`; a file already `stored` is skipped (not rewritten — the C2 trigger would refuse it); a job-time rejection sends the engineer nothing (R5/A11, V3:185) |
| **C6** | `capture-switch.ts`, `inbound-start.ts` (menu), `test/webhook.test.ts` T-WH-17/21/25 rewritten to the idle nudge (V3:262), `docs/plans/adhoc-menu-spec.md` reference copy, `test/unit/adhoc-menu-spec-sync.test.ts` | `adhoc-menu-spec-sync` goes RED the moment `MI_MENU_LINE` joins the menu until the spec doc is edited (IS:337-347 says the spec follows the code) `[read]`; the rewritten T-WH tests are red until the nudge is live | T-WH-18/19/20/22/23/24 stay unedited and green (V3:262) |

**Concurrency list (CI-only):** the RPC-returns-`expired`-after-router-said-live race (3f step 5), the engineer-S3-vs-PM-link race (PB:486), lock-order tests. None is claimed locally.

**Prod apply for C2, rules.** One file at a time with `supabase db query --linked -f <file>`, foreground, never `db push`, never backgrounded; the linked ref printed and pasted in the same frame and equal to the named ref; pre/post hashes of the affected objects compared with a live re-probed rehearsal reference; no apply without Aravind's explicit go-ahead in the same exchange (CM §0, rules (a)-(c) `[read]`). Outside 08:25-08:40 and 18:25-18:40 IST (6). **PITR substituted:** save the prod pre-apply ACL/trigger/column-grant readback for `capture_files` with sha256, write `051-down-prod.sql` from it, record the word "substituted" (CO:150-152). After apply: confirm the file is on `main` (CM §0, rule (d)), test-db carries the same migration for real (rule (e)), the reservations entry is made, types regenerated.

**DOWN for C2.** `051-down-*.sql`: `SET LOCAL lock_timeout`, drop trigger, drop function, `REVOKE UPDATE (…) ON capture_files FROM service_role`, precondition guard (ledger row + objects exist). DOWN is rehearsed (CM §7) and the prod file has not been run before the apply.

**Rollback order.** Sub-PRs in reverse: C6 → C5 → C4 → C3 → 051 DOWN (C2) → C1 is test-only and stays. Then, outside PR-C, the pre-existing order **C, then B, then A**: PR-C rolled back and live before 050's DOWN runs, then 050, then 049 (PB:333). `C5` must be rolled back before 051's DOWN because the ingest needs the grant `[inferred]`.

**What each PR waits on:** C1 waits on nothing; C3 on OQ3, OQ7, OQ8; C2's review package on OQ10; C4 on OQ4, OQ5, OQ6 and the strings; C6 on the list in section 4.

---

## 9. Open questions for Aravind

1. A bare `4` sent as the FIRST message after the session ended (expiry or midnight) is swallowed by D1(d) and gets `MI_SESSION_ENDED_REPLY`, so the engineer sends `4` again — keep that, or let a bare `4` start the flow right away?
2. What noun should `MI_MENU_LINE` use for this flow (the approved reply says "delivery"; the PM page says "Material Inward")?
3. Digit-4 switch: code constant only, or constant plus a strict phone allowlist (env var, fails closed) so your own phone can run the D-30 test on prod before C6?
4. S-F: accept S-F-1 (record in Sentry, ask the engineer to resend, with the crash-window residual risk), or require S-F-3 (durable pre-record job)?
5. When further photos arrive at step 3 or 4, does the bot reply to every file, once per message, or only to the first?
6. When a photo arrives while the check-in guard is set (S-3), is "not saved, here is the check-in question" the right behaviour, and will you supply that string?
7. For a midnight-crossing session that is not yet expired, may the router clear it by calling `expire_stale_material_inward` with `p_now` = the row's `expires_at` (no SQL change), or do you prefer a direct `service_role` UPDATE, or a small SQL change?
8. `current_flow='safety'` is never written; may the exhaustive mapping send it to the idle path with a Sentry warning?
9. May the `capture` kind in `photo-access.ts` and the photo route move from PR-C to PR-D, where its only consumer is?
10. Terminal states for `capture_files`: `stored` and `rejected` only, with `failed` allowed to move to `stored`/`rejected` on a replay — correct?
11. A photo or PDF that is the first message after the session ended is not stored; should that raise a counts-only Sentry event so a lost delivery document is visible to you?
12. May PR-F add a dated correction to A29 (CED:284) saying D1(d) replaces it (any message, no menu, IST-day case included)?
13. Is the 08:25-08:40 / 18:25-18:40 IST quiet window right for the 051 prod apply and for flipping C6, though the 051 lock analysis does not require it?
14. The D-30 draft "Saved. To send another DC or invoice, choose 4 from the menu." (P49:97) uses "Saved" while T-R1-1 bans it after a file — is it exempt because it follows the ack, or must it change?
15. Log `capture_discarded` from the N2 branch in `trigger.ts` (PB:266, optional), or drop it?
16. Do you accept the six-PR split (C1 LIGHT; C2-C6 FULL), or want C3 and C4 merged?

---

## Appendix — marks, reads, unknowns

**Read with the Read tool (not in the shell log):** V3 (1-431), PB (1-508), CF, CO, IS (1-976), SS, DP, RT (60-353), `idempotency.ts`, MR (30-175), TK, FX (265-360, 416-460), S050 (20-470), S049 (305-340, 764-826, 964-986), P49 (88-101), CED (166-177, 276-325), `test/inbound-start.test.ts` (474-496). Shell greps and listings are in the log.

**Decisions that rest on `[inferred]` (they decide the design):** (1) the day-stale clear via `expire_stale_material_inward(p_now = expires_at)` (3f); (2) migration number 051 and reuse of QE009/QE011/QE014 for the trigger (3d); (3) `received_at` = webhook arrival because `processed_messages.created_at` is set at insert (3a); (4) dormancy of C3-C5 while dark depends on `apply_material_inward_turn(p_start_flow=true)` having only the digit-4 caller (4); (5) `service_role` DELETE on `processed_messages` for S-F-2 (3a); (6) the C1 cause (IST-day reset) is attributed by timing and mechanism match, not traced (3g).

**Unknowns (not checkable offline):** prod/test-db live grants on `whatsapp_sessions` and `processed_messages`; whether `btree_gist`/anything else is installed (irrelevant here); the v2 PDF rules text (not in repo; V3:203 relies on it); whether the sweeps in TK:104-152 touch `'invoice'` rows; real Twilio inbound size limit (V3:423); how WhatsApp delivers multi-photo selections (the D-30 test's purpose); whether CI has an owner connection for the bypass tests (V3:420); PostgREST's pass-through of `QE0nn` codes to `error.code` (PB:503); whether other suites cross IST midnight (3g).
