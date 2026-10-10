# 049 plan review package — PR-A (capture slice 1a tables)

Written 11 Oct 2026. ~~Tier: LIGHT (docs only).~~ Corrected 11 Oct: PR tier LIGHT (docs only); migration 049 tier FULL. This file contains no SQL and no new decisions. It records decisions Aravind made on 11 Oct 2026 and asks the reviewer questions.

## 1. Repo-state header

- `main` @ `58a455ed8cc9bbc247b65f132b274afe98cd31d1` (fetched 11 Oct; `git merge-base --is-ancestor 58a455e origin/main` exit 0).
- `supabase migration list` on prod: 44 rows, local = remote on all 44, last row 048. Source: `049-plan-evidence/prod-probe-1011.txt`, probe P13 (extraction at the end of that file).
- Last runbook executed: 048 prod apply, 2026-09-21 (`scripts/migration-number-reservations.json`, 048 entry).
- Proposed migration number: 049. It is not in `supabase/migrations/`, not in the reservations file, and not under `docs/reviews/` on `origin/main` (plan §1).
- Plan file sha256 (`pra-plan-v1.md`): `10d0e4fa78762b90344476b90246d52bf70c4aa9cec430125f7a4f38b8a4d51f`.

## 2. What is under review

~~The PR-A plan, `049-plan-evidence/pra-plan-v1.md`, as amended by section 3 below. Where section 3 and the plan disagree, section 3 wins.~~ Corrected 11 Oct, after review round 1 (section 9): now under review is `049-plan-evidence/pra-plan-v2.md`, as amended by section 3 below. Where section 3 and the plan disagree, section 3 wins. `pra-plan-v1.md` is kept unchanged as history.

No SQL exists yet. The reviewer's output decides the SQL.

## 3. Decisions recorded 11 Oct 2026, per Aravind

Each decision overrides the plan section named after it. "Plan §" means a section of `pra-plan-v1.md`.

- **D-1** Q-D6: approved. A delivery points at its document. `capture_documents` has no `delivery_id`. Overrides plan §5 and §2.2.
- **D-2** Q-GAPA: Option 2. The history is a snapshot on the soft-unlinked self-link row. Overrides plan §3.
- **D-3** Q-REJ: rejecting an automatic delivery soft-unlinks its self-link, with a new `unlink_reason` of `'delivery_rejected'`. The rule "every invoice has an active link" becomes "every invoice has an active link, unless its automatic delivery was rejected". Overrides plan §2.4 and §6.
- **D-4** Q-SID: add `capture_files.source_message_sid text` and `media_index int`, with `UNIQUE (source_message_sid, media_index)`. Overrides plan §2.3.
- **D-5** Q-FK: `tenant_id` references `tenants` with `ON DELETE RESTRICT`. Overrides plan §2.1.
- **D-6** Q-X: add TR4c (status transition guard) and TR5 (`capture_documents` immutability, ack settable once). Overrides plan §6.
- **D-7** Q-DEF: trigger functions are `SECURITY DEFINER` with `SET search_path = ''`. Overrides plan §6.
- **D-8** Q-GRANT: the `capture_files` column UPDATE grant is removed from PR-A. It moves to PR-C. PR-A grants `service_role` SELECT only. Overrides plan §8.
- **D-9** MIME list: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`. HEIC and HEIF are excluded. Overrides plan §9.
- **D-10** Size: 16 MiB = 16777216 bytes. Overrides plan §9 and the N-e note in plan §0.
- **D-11** P14: the project-wide Storage upload limit is 50 MB, per Aravind (read in the dashboard, not probed). 16 MiB is under it. Overrides plan §9 and §13.
- **D-12** Q-CLOCK: for an unacknowledged delivery, the day count starts at `received_at`. This is an app rule in PR-D. There is no PR-A schema change. Overrides plan §4.
- **D-13** Q-ACK: any recorded reply (yes, no, partial, unclear) starts the clock. Overrides plan §4.
- **D-14** Q-30: a delivery is overdue when the day count is 30 or more. Display only. Overrides plan §4.
- ~~**D-15** Q-TDB: Option X. A fourth entry goes into `scripts/test-db-only-grants.sql`. CI cannot prove the `service_role` DELETE denial. The rehearsal as `postgres`, plus the prod readback, prove it. A separate docs PR will bring CLAUDE.md's named-exception paragraph in line. Overrides plan §12.~~ Superseded 11 Oct by D-21 (review round 1, R6).
- **D-16** Q-TYPES: follow the 043/044 precedent. The precedent, from `git log` on `origin/main` (the raw git output is in the session log, `/tmp/quoco/049-pkg-log.txt`, not in this repo):
  - 043: the migration PR was #270 (`b246b32`, "test-db only"). `types/database.ts` changed later, in the post-apply PR #273 (`ab124c6`, 64 insertions). Its message says the types were regenerated "while linked to test-db, not prod", and that this is equivalent because generated types do not include grants.
  - 044: the migration PR was #275 (`6285dca`, "test-db only"). `types/database.ts` changed later, in the post-apply PR #276 (`8cf25f3`, 54 insertions). Its message says the same: linked to test-db, not prod, output equivalent.
  - 048 followed the same pattern: `fd96199`, 2026-09-20, "regenerate types/database.ts from test-db after the 048 apply".
  - So the precedent is: a later commit, after the prod apply, in the post-apply PR; source test-db, stated in the message. Overrides plan §14.
  - Updated 11 Oct: see D-24 (S5).
- **D-17** Prod probes P1–P13 ran on 11 Oct (`prod-probe-1011.txt`). P10 as run through the CLI is ambiguous: the four columns share one name, so the result collapsed to one null value. Aravind re-ran P10 in the SQL Editor with one row per name: 0 rows, per Aravind. The project selector was not confirmed. A plain `CREATE TABLE` aborts on a name collision. Overrides plan §13.
- **D-18** R-1 change. `dc_doc_kind` and `inv_doc_kind` are fixed-value columns, not generated columns: `text NOT NULL DEFAULT 'dc' CHECK (dc_doc_kind = 'dc')`, and likewise `'invoice'`. The foreign key still skips the check when the document id is NULL (MATCH SIMPLE). Only `self_invoice_id` stays a generated column used in a foreign key. It stays rehearsal item R-1. Overrides plan §2.1.

### Added after review round 1 (per Aravind, 11 Oct, after review round 1)

These apply to `pra-plan-v2.md`. "v2 §" means a section of that file.

- **D-19** (R1) One document per delivery, for life. A later page or photo of the same document attaches as another `capture_files` row on that document. This is consistent with `capture-engine-design.md`, approved 10 Oct: "further photos of the same document attach to that document" (line 289). It is a PR-B flow requirement. Add an orphan probe to the rehearsal and to the PR-B tests: DC documents with no delivery; invoice documents with neither a delivery nor an active link. Lands in v2 §2.2, §5, §12.3.
- **D-20** (R7) Read audience: the PMs of the row's project only. QS is excluded in 1a (a Phase 2 role). Admin sees rows only if a PM member of that project. Deactivated users read nothing: the policies check `users.status = 'active'`. The column exists (`supabase/migrations/012_whatsapp_session_transition.sql:45-46`, values pending, active, deactivated). Lands in v2 §7.
- **D-21** (R6) Option Y replaces Option X. No new entry in `scripts/test-db-only-grants.sql`. Test-only `SECURITY DEFINER` helper functions (seed and cleanup) go in a new `scripts/test-db-only-*.sql` file. `EXECUTE` is for `service_role` only. They are applied by hand to test-db with an explicit target, and are never a migration. Test-db table grants on the four tables then equal prod, so CI can prove `service_role` restrictions. Supersedes D-15. CLAUDE.md's named-exception paragraph already lags the script (three entries, one named): a pre-existing drift, not widened by PR-A. A separate docs PR handles it. Lands in v2 §8, §12.
- **D-22** (S1) `received_at` has no DEFAULT. It is NOT NULL and supplied by the RPC from the inbound receipt time. The exact value, found in lookup L2, is the `created_at` of the `processed_messages` row for the inbound `MessageSid` (v2 §4). Twilio's own timestamp is not read anywhere in this codebase. Lands in v2 §2.1, §4. The value itself is question Q-recv in v2 §16.
- **D-23** (S6) Approved means locked. While status is `approved` or `cancelled`, `delivery_type`, `vehicle_number`, `dc_number` and `dc_date` are immutable (TR4c). Lands in v2 §6.
- **D-24** (S5) Recorded from the 11 Oct fold instruction, with evidence from lookup L4. PR-A's tests use untyped clients for the four tables, with row types given at the call, as 043's tests do: `test/daily-log-photos.test.ts:106-107` and `test/media-ingest.test.ts:289,323` (`testClient()` and `jwtClient()` return a plain `SupabaseClient`, `test/helpers/db.ts:203,952`). CI therefore does not need `types/database.ts` to contain the tables. Lands in v2 §12.4, §14.

### Decided by Aravind, 11 Oct, answering pra-plan-v2.md §16

- **D-25** (Q-recv) `received_at` = `processed_messages.created_at` for the inbound `MessageSid` (the webhook's receipt time). Overrides the v2 §4 open question.
- **D-26** (Q2-2) When a PM rejects a DC delivery and that removes the invoice's last active PM link, the invoice's automatic delivery is restored as pending (`incomplete` or `awaiting_pm`, re-derived from the ack), exactly as in the unlink path (v2 §6 path 2), unless the automatic delivery was rejected. Consistent with A34. Overrides the v2 §6 "reject DC" open note.
- **D-27** (Q2-4) C-36 accepted: unlink the self-link first, then cancel; a move to `cancelled` is refused while an active link exists. Overrides v2 §16 item 3.
- **D-28** (Q-E13) E13 reuses E6's approved string, no new string: "This delivery has a linked invoice. Unlink it first." Only reject can reach it (a PM never cancels directly).
- **D-29** (retention) The four tables and the bucket objects are a business record (GST evidence for supplier invoices and DCs): kept indefinitely, never pruned. Overrides the [GUESS] in v2 §15.

## 4. Approved user-facing strings

English approved by Aravind on 11 Oct 2026. Tamil owed, NOT approved. These replace "wording owed" in plan §10.

- **E3** Can't link. Internal transfers don't have invoices.
- **E5** Can't link. This delivery was rejected or cancelled.
- **E6** This delivery has a linked invoice. Unlink it first.
- **E7** Deliveries created from an invoice can't be internal transfers.
- **E8** This DC already has an invoice. Unlink it first.
- **E11** This delivery has changed. Refresh to see the latest.
- **E1, E2, E4, E9, E10, E12:** reuse the existing string "Something went wrong — please try again." No new string.

The PR-D button label must be "Unlink", to match E6 and E8.

E13 = E6 (D-28). No new string.

~~Added 11 Oct, in `pra-plan-v2.md` §10: **E13** (a move to rejected or cancelled while an active link exists) is new. Its wording is owed from Aravind. No string was written for it.~~ Superseded 11 Oct by D-28.

Each string ships as a named constant with the comment "Tamil owed, NOT approved" (Tamil only).

## 5. Facts observed on both databases

Test-db facts are labelled "test-db, 10 Oct". Prod facts are labelled "prod, 11 Oct". A fact is listed on one database only when the probe file shows it on that one only.

- **PostgreSQL 17.6.** Prod, 11 Oct: `prod-probe-1011.txt`, P1.
- **Volatility (F1).** `timezone(text, timestamptz)` is immutable; `date(timestamp)` is immutable; `date(timestamptz)` is stable.
  - Test-db, 10 Oct: `test-db-probe-1010.txt`, steps s1 and "STEP 1".
  - Prod, 11 Oct: `prod-probe-1011.txt`, P6.
- **`whatsapp_sessions_current_flow_check` allows five flows:** morning, evening, safety, invoice, hindrance.
  - Test-db, 10 Oct: `test-db-probe-1010.txt`, step s2.
  - Prod, 11 Oct: `prod-probe-1011.txt`, P2.
- **0 sessions with `current_flow = 'invoice'`.** Prod, 11 Oct: `prod-probe-1011.txt`, P3.
- **`btree_gist` is available (1.7) and not installed.**
  - Test-db, 10 Oct: `test-db-probe-1010.txt`, step s3.
  - Prod, 11 Oct: `prod-probe-1011.txt`, P5.
- **One bucket, `daily-log-photos`:** private, no size limit, no MIME limit.
  - Test-db, 10 Oct: `test-db-probe-1010.txt`, step s4a.
  - Prod, 11 Oct: `prod-probe-1011.txt`, P4.
- **RLS is on for `storage.objects`, with 0 policies in schema `storage`.** Prod, 11 Oct: `prod-probe-1011.txt`, P7a (`relrowsecurity` true, `relforcerowsecurity` false) and P7b (count 0). The plan's P7 gate (plan §9, §13) is passed. Test-db, 10 Oct: 0 policies in schema `storage` (`test-db-probe-1010.txt`, step s4b). RLS state on test-db is not in that file.
- **The composite-FK targets exist.** `projects_id_tenant_id_key` and `users_id_tenant_id_key`. Prod, 11 Oct: `prod-probe-1011.txt`, P8.
- **`project_members.role` CHECK** allows pm, qs, engineer, owner, subcontractor, admin. Prod, 11 Oct: `prod-probe-1011.txt`, P11.
- **`get_user_tenant_id()`** is `LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'`, body `SELECT tenant_id FROM users WHERE auth_id = auth.uid()`. Prod, 11 Oct: `prod-probe-1011.txt`, P12.
- **Prod default ACL on new `public` tables** (owner `postgres`) is `anon=arw`, `authenticated=arw`: SELECT, INSERT and UPDATE are granted by default. Prod, 11 Oct: `prod-probe-1011.txt`, P9. So the explicit `REVOKE` by role name is mandatory.
- **The four new table names:** see D-17 for P10.

## 6. Questions for the reviewer

Ask. Do not answer.

- **R1** Is the reversed pointer (delivery → document, D-1) sound?
- **R2** Is Option 2 (D-2) enough history for 1a, and safe for 1b?
- **R3** Is the TR1/TR2 lock order free of deadlock with reject and link (plan §6)?
- **R4** Definer triggers with `search_path` set to `''` (D-7): any risk?
- **R5** Is a generated column inside an FK (`self_invoice_id`) acceptable, or should a trigger replace it?
- **R6** Is the test-db grant divergence (D-15) acceptable?
- **R7** Is the RLS predicate (plan §7) complete for tenant and project isolation?
- **R8** Is anything missing from the DOWN plan (plan §11)?

## 7. Still open, not blocking this review

- Cofounder confirmation of A10 and A18 is still not recorded (`docs/plans/capture-engine-design.md`, "Open items after 10 Oct").
- ~~PR-A's tests use the new tables. The 043/044 precedent (D-16) regenerates types after the prod apply. This file does not say how PR-A's tests type-check before that. The reviewer is not asked to decide it.~~ Resolved 11 Oct by D-24: untyped test clients, per lookup L4.

## 8. Evidence files

The first four are verbatim copies, made with `cp`; sha256 was checked against the sources and against the values Aravind gave. Three files were added on 11 Oct, after review round 1 (rows 5–7); `review-round-1.txt` and `prod-P13-raw.json` are verbatim copies, `pra-plan-v2.md` is written new.

| File | sha256 |
|---|---|
| `049-plan-evidence/pra-plan-v1.md` | `10d0e4fa78762b90344476b90246d52bf70c4aa9cec430125f7a4f38b8a4d51f` |
| `049-plan-evidence/pra-plan-log.txt` | `25661fe23a90ab0e22c1cc2976517aca80e05b0c54d4f231ce20b65b3588c922` |
| `049-plan-evidence/test-db-probe-1010.txt` | `0c2e1b224b6d86322dddecebe68787b3286a57fb9f01586c521ff02c364a5bce` |
| `049-plan-evidence/prod-probe-1011.txt` | `dabb27bfb18f25f811f32a9f95c9704d9f8c8de95ecaece4408d3f52852292f5` |
| `049-plan-evidence/pra-plan-v2.md` (new 11 Oct, written, not a copy) | `8a90f68751dc43a4bc3c3926c4ead71aa9b349a0c0727d30d21789327ce0aa5b` |
| `049-plan-evidence/review-round-1.txt` (new 11 Oct, verbatim copy) | `64469f7dcd8c008a601fafd59a91d24de6aa3d00832d9e98b2db073a07647ffb` |
| `049-plan-evidence/prod-P13-raw.json` (new 11 Oct, verbatim copy of the raw `supabase migration list` output; two text lines, then one JSON line, so the file is not valid JSON as a whole) | `846f1cfa374ff6d13589cc553e426ffdc46d653856bf93f32ca1c66628120fe8` |

- `test-db-probe-1010.txt` was recovered from a chat upload of 10 Oct 23:51 IST. The Desktop original was deleted.
- Secret scan on the first four: 0 matches for each pattern (counts only).
- Secret scan on `review-round-1.txt` and `prod-P13-raw.json` (11 Oct, same regex, counts only): 0 and 0.

## 9. Review round 1 (anonymous external reviewer, 11 Oct)

**Verdict: STOP at plan stage, one round short.** Evidence: `049-plan-evidence/review-round-1.txt`, sha256 `64469f7dcd8c008a601fafd59a91d24de6aa3d00832d9e98b2db073a07647ffb`. The reviewer stays anonymous.

Every item below has a row. "v2 §x" is a section of `049-plan-evidence/pra-plan-v2.md`. "D-n" is a decision in section 3 above.

| Item | Disposition | Where |
|---|---|---|
| R1 (delivery → document) | LANDED in v2 §2.1, §2.2, §5: `ON UPDATE RESTRICT` and `ON DELETE RESTRICT` written on every FK; orphan probes added. DECIDED D-19 (one document per delivery, for life). | v2 §2.1, §2.2, §5, §12.3 |
| R2 (Option 2 history) | LANDED: `superseded_from_status` added, filled by TR3, with CHECKs. The CHECK is my NULL-safe form of the reviewer's, because the reviewer's form passes when the status is NULL. Round 2 is asked to confirm (Q2-5). | v2 §2.4, §3 |
| R3 (lock order) | LANDED: lock modes named at each level; TR4 takes the invoice lock itself; six numbered lock paths. One tension with B1 kept visible (Q2-3). | v2 §6 |
| R4 (definer triggers) | LANDED: corrected reason; `public.`-qualified; codes-only RAISE; fingerprint pins `proconfig`, `prosecdef`, owner; plain `CREATE FUNCTION`. | v2 §6, §8 |
| R5 (generated column in an FK) | LANDED: `self_invoice_id` kept; rerun on PG 17 in the rehearsal; `RESTRICT` written explicitly. | v2 §2.4, §12.1 |
| R6 (test-db grant divergence) | DECIDED D-21: Option Y replaces Option X; supersedes D-15. The reviewer's four conditions on X are moot (no divergence). The CLAUDE.md paragraph is not made newly stale by PR-A; the existing drift goes to a separate docs PR. Asked of round 2 as Q2-1. | v2 §0 S-b, §8, §12 |
| R7 (RLS audience) | DECIDED D-20 (PMs of the project only; QS excluded; admin only as PM member; deactivated users read nothing; lookup L1 confirmed `users.status`). LANDED: `(select auth.uid())`. | v2 §7 |
| R8 (DOWN) | LANDED: intensional guard; DOWN deletes the 049 ledger row; one `BEGIN … COMMIT`; bucket INSERT and DELETE executed on test-db with output captured. | v2 §11 |
| B1 (reject leaves an active link) | LANDED: TR4c refuses a move to `rejected` while any active link exists, DC and automatic; reject path order fixed; tests T-B1-1. Open follow-on: restore on DC reject (Q2-2). | v2 §6, §12.3 |
| B2 (forgeable snapshot) | LANDED: TR1 refuses an INSERT carrying unlink or snapshot values; TR3 overwrites the snapshot from the delivery; tests T-B2-1..3. | v2 §3, §6, §12.3 |
| B3 (isolation level) | LANDED: first line of every invariant trigger refuses non-READ-COMMITTED; the link-vs-retype race is a PG 17 rehearsal item under both levels; RR must refuse (T-B3-1, T-B3-2). | v2 §6, §12.1, §12.3 |
| S1 (`received_at` default) | DECIDED D-22; LANDED: no DEFAULT, NOT NULL; value stated in v2 §4. | v2 §2.1, §4 |
| S2 (idempotency key on the leaf) | LANDED: `source_message_sid NOT NULL UNIQUE` on `capture_documents`; `media_index NOT NULL`, `CHECK (media_index >= 0)`. `file_no` and `media_index` are different facts under D-19, so both stay. | v2 §2.2, §2.3 |
| S3 (`storage_path` prefix) | LANDED: the CHECK pins `tenant_id/project_id/document_id/`. | v2 §2.3 |
| S4 (ordering CHECKs, retention line) | LANDED: timestamp-ordering CHECKs on all five columns named. Retention: lookup L3 found no standalone ledger; the register is a section, and v2 §15 carries the retention lines. | v2 §2, §15 |
| S5 (circular gate order for tests) | DECIDED D-24: untyped test clients (lookup L4). | v2 §12.4, §14 |
| S6 (approval is final for status only) | DECIDED D-23; LANDED in TR4c. | v2 §6 |
| N1 (partial index) | LANDED: index on `delivery_invoice_links (invoice_document_id) WHERE unlinked_at IS NULL`. | v2 §2.4 |
| Drift 1: tier label | LANDED: line 3 corrected (PR tier LIGHT; migration 049 tier FULL). | this file, line 3 |
| Drift 2: P13 was an extraction | LANDED: raw output added as `prod-P13-raw.json`. | section 8; v2 §13 |
| Drift 3: P10 re-run and P14 "per Aravind" | DEFERRED to the SQL and apply package, where both are pinned with their date. Neither blocks: `CREATE TABLE` aborts on a name collision, and T-BKT exercises the size limit. | D-11, D-17; v2 §13 |

## 10. Questions for review round 2

Confirm each disposition in section 9. Then:

- **Q2-1** Is Option Y (D-21: test-only `SECURITY DEFINER` helper functions, table grants equal to prod) acceptable? Does it leave a gap that Option X's conditions were meant to close?
- **Q2-2** Rejecting a DC delivery that has an active PM link unlinks it with reason `delivery_rejected` (B1). If that was the invoice's last PM link, should the automatic delivery be restored, as when a PM unlinks it?
  - Aravind decided this as D-26 (restore). Reviewer: confirm the lock path for reject-DC-with-restore, written as numbered steps.
- **Q2-3** R3 says reject takes no other lock. B1 says the reject path locks the invoice first, then the delivery. v2 follows B1 with R3's ordering. Is that the intended reading?
- **Q2-4** v2 unlinks the self-link first and then cancels the delivery, so the snapshot sees the pre-cancel status, and TR4c also refuses a move to `cancelled` while an active link exists. Is that sound?
  - Accepted by Aravind as D-27. Reviewer: confirm soundness.
- **Q2-5** Is the NULL-safe form of the R2 CHECK (v2 §2.4, §3) correct?
- **Q2-6** D-25 reads `processed_messages.created_at` by `MessageSid` inside the RPC. `processed_messages` has no `tenant_id`. Is that read safe and sufficient, or should the webhook pass the time as an argument?
