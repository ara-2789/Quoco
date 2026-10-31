# D-30 record: real-phone test of digit 4 (material inward) on prod

Date: 31 Oct 2026. Tier: LIGHT (docs only). Evidence files are in `docs/reviews/d30-evidence/`.

Labels: **observed** = read from SQL output committed here. **reported** = told by Aravind, not captured in a
committed file. Last-4 phone digits are masked as `****` in every committed result file; no full phone number is
committed anywhere. The `.sql` files are the unfilled templates (placeholders `<<SNAPSHOT_TS>>`, `<<PROJECT_ID>>`,
`<<ARAVIND_PHONE>>`); the filled copies stay off the repo.

## 1. Scope

- D-30: a real-phone test of digit 4 (material inward) on prod, project Speed Mechatronics
  `acef67fe-e775-439d-82b8-5b8526868d6d`, 31 Oct 2026.
- Release `fe75d6c` (`main`).
- `CAPTURE_DIGIT4_TEST_PHONES` set to Aravind's number only. Reported: Vercel prod scope, redeployed after the change.
- Snapshot used by the after-checks: `2026-10-31 06:15:00+00` (observed in both result files).

## 2. Pre-run readback ("PITR substituted" for D-30)

Observed (SQL output pasted by Aravind; `d30-a1-prod.csv`, `d30-a3-prod.csv`, `d30-a1-diff.md`).

- **A1:** 0 rows DIFFERS. 18 MATCH, including all 9 `050` function md5s. The 4 "compare by eye" rows were checked.
- **A3:** J fingerprint and K comments hash both match the recorded 051 values (`d30-a3-prod.csv`).
  Observed: raw A3 output pasted by Aravind in the design-review chat on 30 Oct 2026; transcribed into
  `d30-a3-prod.csv`, not exported from the SQL editor.
- **Overall md5:** `7a9c61dcaac37375d1f92b22a5033a7d`.
- **A1 diff vs the repo scaffold** (`d30-a1-diff.md`): 7 of 28 objects differ (daily_logs, jobs, project_members,
  projects, tenants, users, whatsapp_sessions). All are explained: 13 Supabase default ACL rows, and `jobs` has RLS
  enabled out-of-band (in no migration). Every differing object differs only in its owner/RLS/ACL facets.

## 3. Cases run and bot replies

Reported by Aravind (screenshots in chat, not committed).

1. DC, 1 photo, ack 1.
2. Invoice, 3 photos, ack 1. Three separate "1 file received" replies.
3. A photo sent at the kind step, then "dC"; DC, 1 photo, ack 2 with a note.
4. Invoice, 1 scanner-app PDF, ack 1 (the scanner app is per Aravind).
5. A .pptx inside a live session got the generic `UNSUPPORTED_MEDIA_REPLY`.
6. JPEG sent as a document, DC, ack 3 with a note.
7. Control: the cofounder's phone sent "4" and got the dark reply.

## 4. Database results

Observed, `d30-after2-result.csv` (the query is `d30-after2.sql`):

- **A:** exactly 1 user matches the input phone (`users_matching_input_exact=1`).
- **B:** 0 flagged of 5 documents, 5 deliveries, 7 ingest jobs and 2 invoice links. All sent by the matching user.
- **C:** 2 sessions touched, both idle (`current_flow=NULL`, step 0): Aravind's, and one other engineer's (the cofounder).
- **D:** 2 new `daily_logs`, both morning check-ins: one by Aravind, one by the other engineer.
- **E:** the job `hindrance_pm_notify` points to a hindrance in this project, reported by the other engineer
  (`submitted_via=whatsapp_adhoc`). `pm_notified_at` is set.
- **F:** all five documents answered as expected:

| # | IST | kind | files | type | ack | note (len) | caption (len) | delivery |
|---|---|---|---|---|---|---|---|---|
| 1 | 11:48 | dc | 1 | image/jpeg | yes | none | none | awaiting_pm |
| 2 | 11:53 | invoice | 3 | image/jpeg x3 | yes | none | none | awaiting_pm, 1 self-link |
| 3 | 11:55 | dc | 1 | image/jpeg | no | 5 | none | awaiting_pm |
| 4 | 12:29 | invoice | 1 | application/pdf | yes | none | 13 | awaiting_pm, 1 self-link |
| 5 | 12:32 | dc | 1 | image/jpeg | partial | 15 | 46 | awaiting_pm |

- **G:** one duplicate sha256 (`bc1e16a4...`) across two documents (3411c2a8 and 90faaec0), both 215323 bytes.

Observed, `d30-after-result.csv`:

- Storage 7/7 present, 0 missing, 0 size differences.
- Jobs since the snapshot: `succeeded=8` (the 7 ingest jobs plus the `hindrance_pm_notify` job); all 8 rows show `attempt_count=0`.
- 0 files `failed`/quarantined.

**Label:** `d30-after-result.csv` was re-run on 31 Oct 2026 after D-30 with the 10-digit input; its section 9 is
invalid (phone sanity n=0); superseded by `d30-after2-result.csv`.

## 5. Verdict

**D-30 PASSED.** This satisfies the C6 entry-gate item "D-30 passed".

## 6. Findings

| # | Finding | Owner / next step |
|---|---|---|
| F1 | Multi-photo: one reply per inbound message (3 photos gave 3 replies, F row 2: 3 message SIDs). Q5 (pr-c decisions 2026-10-26 #5) is decided by D-30: change. | Strings owed (Aravind). |
| F2 | An unsupported file in a live invoice session gets `UNSUPPORTED_MEDIA_REPLY`: the webhook (`app/api/whatsapp/webhook/route.ts:288`) decides before reading session state. The approved `MI_UNSUPPORTED_FILE_REPLY` (#17) is unused for this case. | Bug, no new string. |
| F3 | A photo at the kind step is dropped (`050:203-205`, by design) with only the kind re-ask; the engineer is not told. | String owed (Aravind). |
| F4 | Document file names are stored as `capture_documents.caption` (lengths 13 and 46 match the file names). | PR-D must not present them as engineer text. |
| F5 | An identical photo is stored under two documents (same sha256); no de-dup. | Later. |
| F6 | `checkin-escalation-sweep` warning has `extra.message` "[object Object]" (plain-object PostgREST errors). | Fix planned as a FULL-tier PR `fix/error-summary` after D-30. |
| F7 | The other engineer's morning `daily_log` has `morning_submitted_at` but no plan, manpower or equipment (observed in D, second log). Cause unknown. | Open. |

Also recorded:

- `jobs` RLS is enabled out-of-band (see section 2). This is a FULL-tier item to resolve before the switch trigger.
- Kind-question UX: per Aravind's decision in chat, a neutral question after A10/A18; OCR comes in slice 1b, asynchronous
  and PM-confirmed.
