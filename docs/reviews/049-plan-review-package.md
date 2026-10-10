# 049 plan review package — PR-A (capture slice 1a tables)

Written 11 Oct 2026. Tier: LIGHT (docs only). This file contains no SQL and no new decisions. It records decisions Aravind made on 11 Oct 2026 and asks the reviewer questions.

## 1. Repo-state header

- `main` @ `58a455ed8cc9bbc247b65f132b274afe98cd31d1` (fetched 11 Oct; `git merge-base --is-ancestor 58a455e origin/main` exit 0).
- `supabase migration list` on prod: 44 rows, local = remote on all 44, last row 048. Source: `049-plan-evidence/prod-probe-1011.txt`, probe P13 (extraction at the end of that file).
- Last runbook executed: 048 prod apply, 2026-09-21 (`scripts/migration-number-reservations.json`, 048 entry).
- Proposed migration number: 049. It is not in `supabase/migrations/`, not in the reservations file, and not under `docs/reviews/` on `origin/main` (plan §1).
- Plan file sha256 (`pra-plan-v1.md`): `10d0e4fa78762b90344476b90246d52bf70c4aa9cec430125f7a4f38b8a4d51f`.

## 2. What is under review

The PR-A plan, `049-plan-evidence/pra-plan-v1.md`, as amended by section 3 below. Where section 3 and the plan disagree, section 3 wins.

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
- **D-15** Q-TDB: Option X. A fourth entry goes into `scripts/test-db-only-grants.sql`. CI cannot prove the `service_role` DELETE denial. The rehearsal as `postgres`, plus the prod readback, prove it. A separate docs PR will bring CLAUDE.md's named-exception paragraph in line. Overrides plan §12.
- **D-16** Q-TYPES: follow the 043/044 precedent. The precedent, from `git log` on `origin/main` (the raw git output is in the session log, `/tmp/quoco/049-pkg-log.txt`, not in this repo):
  - 043: the migration PR was #270 (`b246b32`, "test-db only"). `types/database.ts` changed later, in the post-apply PR #273 (`ab124c6`, 64 insertions). Its message says the types were regenerated "while linked to test-db, not prod", and that this is equivalent because generated types do not include grants.
  - 044: the migration PR was #275 (`6285dca`, "test-db only"). `types/database.ts` changed later, in the post-apply PR #276 (`8cf25f3`, 54 insertions). Its message says the same: linked to test-db, not prod, output equivalent.
  - 048 followed the same pattern: `fd96199`, 2026-09-20, "regenerate types/database.ts from test-db after the 048 apply".
  - So the precedent is: a later commit, after the prod apply, in the post-apply PR; source test-db, stated in the message. Overrides plan §14.
- **D-17** Prod probes P1–P13 ran on 11 Oct (`prod-probe-1011.txt`). P10 as run through the CLI is ambiguous: the four columns share one name, so the result collapsed to one null value. Aravind re-ran P10 in the SQL Editor with one row per name: 0 rows, per Aravind. The project selector was not confirmed. A plain `CREATE TABLE` aborts on a name collision. Overrides plan §13.
- **D-18** R-1 change. `dc_doc_kind` and `inv_doc_kind` are fixed-value columns, not generated columns: `text NOT NULL DEFAULT 'dc' CHECK (dc_doc_kind = 'dc')`, and likewise `'invoice'`. The foreign key still skips the check when the document id is NULL (MATCH SIMPLE). Only `self_invoice_id` stays a generated column used in a foreign key. It stays rehearsal item R-1. Overrides plan §2.1.

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
- PR-A's tests use the new tables. The 043/044 precedent (D-16) regenerates types after the prod apply. This file does not say how PR-A's tests type-check before that. The reviewer is not asked to decide it.

## 8. Evidence files

All four are verbatim copies, made with `cp`. sha256 was checked against the sources and against the values Aravind gave.

| File | sha256 |
|---|---|
| `049-plan-evidence/pra-plan-v1.md` | `10d0e4fa78762b90344476b90246d52bf70c4aa9cec430125f7a4f38b8a4d51f` |
| `049-plan-evidence/pra-plan-log.txt` | `25661fe23a90ab0e22c1cc2976517aca80e05b0c54d4f231ce20b65b3588c922` |
| `049-plan-evidence/test-db-probe-1010.txt` | `0c2e1b224b6d86322dddecebe68787b3286a57fb9f01586c521ff02c364a5bce` |
| `049-plan-evidence/prod-probe-1011.txt` | `dabb27bfb18f25f811f32a9f95c9704d9f8c8de95ecaece4408d3f52852292f5` |

- `test-db-probe-1010.txt` was recovered from a chat upload of 10 Oct 23:51 IST. The Desktop original was deleted.
- Secret scan on all four: 0 matches for each pattern (counts only).
