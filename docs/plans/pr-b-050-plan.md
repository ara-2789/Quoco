# PR-B plan — migration 050: material-inward functions and the N2 branches

Written 2026-10-12; revision 2 the same night after Aravind's 23:15 decisions (all recommended options accepted). Branch `feat/050-material-inward-fns`, from `origin/main` 4b419f6.
Status: PLAN ONLY. No SQL, no app code, no user-facing wording is in this
document or this branch. Wording is written as `STRING OWED — Aravind to supply`.

Marks used on every claim: `[observed: <source>]` (read in a file or a
database in this session), `[per Aravind]` (a stated decision), `[inferred]`
(my reasoning, not read anywhere). Where the brief for this plan and an
existing source disagree, the disagreement is written out as a `CONFLICT` and
left as a `DECISION OWED`. It is not resolved here (CLAUDE.md section 0).

Sources, all read from `origin/main` 4b419f6 unless marked otherwise:
`docs/plans/slice-1a-plan-v3.md` (v3), `supabase/migrations/049_capture_tables.sql`
(049), `docs/reviews/049-review-package.md` (049 package), migrations 038 and
040 and 030, `lib/whatsapp/*`, and the probe captures
`/tmp/quoco/pr-b-probe-1.txt`, `/tmp/quoco/pr-b-probe-2.txt`,
`/tmp/quoco/pr-b-block-2.txt`, `/tmp/quoco/pr-b-probe-3.txt`, `/tmp/quoco/pr-b-block-3.txt` (none in the repo).

---

## 1. Scope

- ONE migration, number 050 [observed: reserved in `scripts/migration-number-reservations.json`, commit d6788c2 on this branch]. Held in `docs/reviews/` until it is applied; it enters `supabase/migrations/` only in the apply commit [observed: CLAUDE.md section 6].
- Contents [observed: v3 section 8, PR-B row]: `apply_material_inward_turn`; `pm_set_delivery_details`, `pm_approve_delivery`, `pm_reject_delivery`, `pm_link_invoice`, `pm_unlink_invoice`; `expire_stale_material_inward`; and the N2 branches in the live `apply_morning_flow_turn` (038) and `apply_evening_flow_turn` (040).
- NO change to the `whatsapp_sessions.current_flow` CHECK [per Aravind, 12 Oct; observed: test-db has `whatsapp_sessions_current_flow_check` allowing morning, evening, safety, invoice, hindrance, probe 2 step 3b]. v3 section 8 lists the CHECK under PR-A and v3 lines 132 and 207 list it under PR-B; both are now struck in v3 (commit 38a48a8). 049 contains no `current_flow` text [observed: probe 1 step 9].
- No app code. No tests are written in this PR-B planning block.
- Tier FULL [observed: v3 section 8; external-review triggers (a) logic of live and new functions, (b) grants and SECURITY DEFINER].

Owned elsewhere [observed: v3 section 8; `[inferred]` where noted]:

| PR | Owns |
|---|---|
| PR-C | Router and dispatch mapping (N1), A27 router read, the `invoice`-session handler, PDF handling, `capture_ingest`, photo-access kind, digit 4 live. Also the `capture_files` immutability condition [observed: 049 package line 141]. Also any change to `lib/whatsapp/outbound/trigger.ts` or the TS outcome unions that a new RPC outcome needs [inferred, section 6]. |
| PR-D | PM page: lists, detail, approve, reject, type, link, unlink. Must be merged and live before engineers are switched on [observed: v3 section 8]. |
| PR-E | String constants (LIGHT) [observed]. |
| PR-F | Docs corrections owed to the design record [observed]. |

---

## 2. Decisions

- **D-1 [per Aravind, 12 Oct]:** the stored `current_flow` value for the material-inward flow is `'invoice'`. It is already allowed by 001:92 [observed: `001_core_schema.sql:92`; test-db constraint, probe 2]. The user-facing label stays "Material inward" (the label text itself is a string already owned by v3 section 7: `MI_MENU_LINE`; no new wording here).
- **D-2 [per Aravind]:** the `ensure_rls` event trigger is mirrored onto test-db by `scripts/test-db-only-ensure-rls.sql` (commit ae7e0db; sha256 e58571540da2c2fe93a74e01dd631c696ad47886ddfbe64e09c21ed8f975ce52 [observed: shasum before and after the copy]). test-db has the event trigger `ensure_rls` calling `rls_auto_enable`, enabled, owner postgres [observed: probe 2 step 3a]. This is the second named test-db/prod divergence after `outbound_sends` DELETE [observed: CLAUDE.md section 0]; whether CLAUDE.md should name it is an open item (section 14).
- **D-3 [per Aravind, 12 Oct 23:15]:** N13 is fixed in PR-B, by a guard inside the two live functions (section 7). It is not accepted as a residual risk and not deferred to PR-C.
- **D-4 [per Aravind, 12 Oct 23:15]:** the five `pm_*` functions are granted to `authenticated` only, following the 048 pattern (048:381-384). `service_role` and `anon` are refused. This supersedes the session handover line "all definer functions service_role only" for the five `pm_*` functions. That line still holds for `apply_material_inward_turn` and `expire_stale_material_inward` (section 5).
- **D-5 [per Aravind, 12 Oct 23:15]:** S-F (049 package section 10, PR-B condition 1) is split between PR-B and PR-C. PR-B makes `apply_material_inward_turn` safe to repeat for one SID. PR-C closes the webhook ordering and the record-and-alert failure path. The dated note is in `docs/reviews/049-review-package.md`, commit e96e116. S-F stays BLOCKING for PR-C.
- **D-6 [per Aravind, 12 Oct 23:15]:** PITR is substituted by captured prod bodies. Before the apply, `pg_get_functiondef` of the two live functions is captured from prod with its sha256, and the DOWN restores from that text (section 12). The apply record says "substituted", not "skipped".
- Also decided the same hour, recorded where each applies: the N2 branch returns `'start'` (or `'already_complete'`) plus a new return key `capture_discarded` (section 6); the five `pm_*` functions share one refusal shape (section 4); every 23505 other than `uq_dil_active_per_delivery` is re-raised unchanged (section 4.5).

### Name-mapping table: every v3 `material_inward` identifier to its PR-B name

Rule [per Aravind]: function names may keep `material_inward`; the stored value uses `'invoice'`.

| v3 line | v3 text | PR-B name | Why |
|---|---|---|---|
| 132 | CHECK gains `'material_inward'` | NONE. No CHECK change. | D-1 |
| 132, 208 | `SessionFlow` gains the value | NONE in PR-B. `session.ts:6` already lists `'invoice'` [observed]. | D-1; app code anyway |
| 140 | session `material_inward`, step 1 | `current_flow = 'invoice'`, `current_step = 1` | stored value |
| 140 and many | RPC `apply_material_inward_turn` | `apply_material_inward_turn` (unchanged) | function name |
| 207 | `new material_inward start-branch in apply_morning_flow_turn and apply_evening_flow_turn` | a new branch keyed on `current_flow = 'invoice'` | stored value |
| 207, 233, 282, 335 | `expire_stale_material_inward` | `expire_stale_material_inward` (unchanged); it clears a row only if `current_flow = 'invoice'` and expired | function name; stored value inside |
| 210, 211 | router branch "for `material_inward`" | router branch for `'invoice'` (PR-C) | stored value |
| 422 | `'material_inward'` as the flow name | `'invoice'` | stored value |
| 29, 44, 55, 61-66, 85, 249-268, 333-349 | "a `material_inward` session/flow" in tests and findings | read as "a session with `current_flow='invoice'`". NOT edited in v3 (narrative and test descriptions). | stored value, left as prose [inferred: judgement call, section 14] |
| context keys | "MI context keys" (v3 line 334) | names not set in v3. `[inferred]` they live under `whatsapp_sessions.context`. Names OWED at design of the RPC. | |

---

## 3. State machine

Source: v3 section 3, line 140 and the path table [observed]; step numbering S0 to S4 is v3's. Everything about outcome codes is `[inferred]`, except `start`, `reask` and `expired`, which v3 names (Q5, line 334; T-A27-3).

Every turn the RPC processes, including `reask`, writes `expires_at = p_now + 30 minutes` and `updated_at = p_now` [observed: N8, v3 line 61; same write in 040 lines 880-885]. The 30-minute figure lives only in SQL (v3 line 336).

The RPC takes the session row `FOR UPDATE` first [observed: v3 line 140; CLAUDE.md section 6].

| State | Accepted input | Rows written | Next | Outcome |
|---|---|---|---|---|
| S0 idle | digit `4` from the idle menu (menu is PR-C) | `whatsapp_sessions`: `current_flow='invoice'`, `current_step=1`, context keys cleared. No document yet. | S1 | `start` `[inferred]` |
| S1 kind | DC or invoice. Whether numbered or typed is NOT DECIDED [observed: v3 line 140]. Slot `MI_ASK_KIND`; wording STRING OWED. | context: chosen kind. One re-ask on garbage, then close with nothing recorded `[GUESS]` in v3 table. | S2 | `advance` or `reask`; close `[inferred]` |
| S2 file(s) | a file (photo or PDF) | `capture_documents` row (kind, `sent_by`, `source_message_sid`, `received_at` read inside the RPC from `processed_messages.created_at` for that SID [observed: 049 header Q2-6]); `capture_files` row(s) in `pending`. For an invoice: the automatic `deliveries` row (`incomplete`) and its self-link row, same transaction [observed: v3 T-A28-1]. For a DC: a `deliveries` row (`incomplete`), no link. A job to ingest the bytes is inserted in the same RPC call (atomic ingest-job insert) [observed: v3 line 422]. | S3 | `advance` |
| S3 ack | `1`, `2`, `3` (yes, no, partial) | `capture_documents.engineer_ack` and `engineer_ack_at`. `unclear` after one re-ask on garbage [observed: v3 T-FLOW-2]. Delivery becomes `awaiting_pm` inside this call [observed: v3 line 105]. | S4 after `2` or `3`; close after `1` | `advance`, `reask`, close `[inferred]` |
| S4 note | free text | `capture_documents.engineer_ack_note` (only legal after `no`, `partial`, `unclear` [observed: 049 `capture_documents_ack_note_scope_chk`]) | close | close `[inferred]` |
| any | the session is expired (`expires_at <= p_now`) | clears the session (flow NULL, step 0, flow context keys removed); nothing else | idle | `expired` [observed: v3 line 334] |
| any | duplicate message SID | no rows, no reply | unchanged | duplicate outcome name OWED [observed: v3 T-FLOW-3 requires the behaviour] |

Facts that bound the table:
- Every reply after a file says "received", never "saved" [observed: v3 T-R1-1]. Wording STRING OWED.
- `capture_documents` has `UNIQUE (source_message_sid)`, `capture_files` has `UNIQUE (source_message_sid, media_index)` [observed: 049 lines 281-340]. A second file in the same message, or a retry, collides there (see E8 in section 4).
- The ack digit is the only digit-bearing field stored from engineer text [observed: v3 T-A18-1].
- Order of the 049 stamps: `received_at` is the one caller-influenced time; every other system time is stamped by the database [observed: 049 header TIME RULE].
- Delivery rows exist from S2, so a session that goes silent leaves a delivery that shows "not acknowledged" [observed: v3 lines 85 and 167].
- 049 insert guards: a `deliveries` INSERT must be `incomplete` with no attribution, stamp or reason values (QE012, `trg_deliveries_before_insert`); a `capture_documents` INSERT must carry no ack values (QE012, `trg_capture_documents_before_insert`) [observed: 049 lines 821-876]. So the S2 RPC cannot insert the ack in the same statement as the document; S3 is a separate UPDATE (TR5).

---

## 4. Functions

Common to all seven [observed unless marked]:
- `SECURITY DEFINER`. `SET search_path = ''` with every relation `public.`-qualified, as 049's trigger functions do (049 lines 455, 468). This differs from 038/040, which use `SET search_path = public` [observed]. The N2 edit to 038/040 keeps their existing setting (section 6). `[inferred]` new functions follow 049's stricter form.
- RAISE with code only: `ERRCODE = 'QE0nn'`, `MESSAGE = 'En'`, no prose, no row data [observed: 049 lines 143-168]. The app maps code to a named string; the strings are STRING OWED.
- Writes to the four 049 tables happen ONLY inside these functions: `service_role` and `authenticated` hold SELECT only [observed: 049 lines 965-985].
- Every invariant trigger refuses a non-READ-COMMITTED writer (QE014) [observed: 049 line 166]. No function here may change isolation level.
- Function identity includes the parameter type list. A new function in 050 has no old signature to orphan. The two live functions keep their signatures byte-identical (morning 12 parameters, evening 10) so `CREATE OR REPLACE` really replaces [observed: 038:404-417; 040:432-443; CLAUDE.md section 0 on signature change].

Lock order for any path touching more than one table [observed: 049 header lines 170-228, "THE SIX PR-B LOCK PATHS"]: (1) the invoice `capture_documents` row `FOR NO KEY UPDATE`; (2) `deliveries` rows in ascending id, a DC delivery `FOR SHARE` on every link and unlink path, an automatic delivery `FOR NO KEY UPDATE`; (3) `delivery_invoice_links` rows. TR3 never locks the delivery. The 049 file states the six PM paths step by step; those steps ARE the contract and the plan does not restate them beyond the table below.

The engineer path starts one level above that list: the session row `FOR UPDATE` first, then level 1 onward `[inferred]`. No PM path takes the session row, so no inversion exists `[inferred]`; the T-B3 two-session rehearsal is the evidence required, and it is CI-only to be claimed (CLAUDE.md section 0).

049 triggers each function must respect (mapped from 049 lines 463-890):

| Label | Trigger function (049) | Fires | Raises |
|---|---|---|---|
| TR1 | `trg_dil_before_insert` | INSERT on links | QE001, QE002 (XOR self-link vs PM link), QE010 (INSERT carrying unlink or snapshot values), QE014 |
| TR2 | `trg_dil_before_insert` (same function) | INSERT on links | QE003 internal transfer, QE004 automatic delivery, QE005 rejected or cancelled target; locks the DC delivery `FOR SHARE` |
| TR3 | `trg_dil_before_update` | UPDATE on links | QE010 on any refused edit; snapshots the automatic delivery's state on supersession |
| TR4a/b/c | `trg_deliveries_before_update` | UPDATE on deliveries | QE009 immutable column, QE007 retype of an automatic delivery, QE006 retype with an active link, QE011 transition or locked content, QE013 move to rejected or cancelled while a link is active |
| TR5 | `trg_capture_documents_before_update` | UPDATE on documents | QE009, QE011 (second ack, second note) |
| F4-2 | `trg_deliveries_before_insert`, `trg_capture_documents_before_insert` | INSERT | QE012 |

Note: 049 labels TR1 and TR2 as two checks inside one function; the brief's "TR1-TR5" are 049's labels, not five function names [observed].

### One refusal shape for the five `pm_*` functions [per Aravind, 12 Oct 23:15]

Three cases must be indistinguishable to the caller: (1) the id does not exist, (2) the id belongs to another tenant, (3) the id belongs to another project in the caller's own tenant. Same SQLSTATE, same absence of detail: no message text that names the case, no id, no row data, no differing timing path that the function controls `[inferred]`. This is the "refusal is identical for a nonexistent id and an unauthorised one" rule in v3 T-F5-1..3 [observed: v3 section 9].

What 048 does today, quoted from `048_engineer_registration.sql:156-189` [observed]:
- no profile for `auth.uid()`: `ERRCODE = 'insufficient_privilege'`, message `engineer_admin_gate: no profile for caller` (lines 160-163);
- project missing OR project in another tenant: `ERRCODE = 'no_data_found'`, message `engineer_admin_gate: project not found` (lines 171-174);
- role not admin or pm: `insufficient_privilege`, message `engineer_admin_gate: role may not manage engineers` (lines 177-180);
- a pm who is not a pm on this project: `insufficient_privilege`, message `engineer_admin_gate: pm is not a pm on this project` (lines 181-189).

Consequence, observed from those lines: 048's shape is NOT identical across the three cases. Missing and other-tenant both give `no_data_found` (P0002), but "another project, same tenant" gives `insufficient_privilege` (42501) with a different message. A caller can tell "this id exists in my tenant but I am not on its project" from "this id does not exist for me". The 048 shape therefore cannot be copied as is for the `pm_*` functions. What is copied from 048 is the grant pattern (section 5) and the caller resolution (`users.auth_id = auth.uid()`, tenant bound by one NULL-safe comparison, lines 154-174).

PROPOSED (not yet named by Aravind): one new code in 049's family, `ERRCODE = 'QE015'`, `MESSAGE = 'E15'`, code only, raised for all three cases and for "caller has no profile" and "caller is not a pm on the project's project_members" as well, so the caller learns nothing beyond "refused". 049 uses QE001-QE014 with QE008 reserved [observed: 049 lines 143-168], so QE015 is the next free code `[inferred]`; the number and its app string (STRING OWED — Aravind to supply) are OWED. Alternative, not recommended: reuse `insufficient_privilege`, which would make a function refusal indistinguishable from a grant-level refusal in T-F5-3's anon case; that is not wrong, but it removes the ability to tell, in a test, which layer refused.

Two things this does not cover: the `qs` role and a same-tenant non-PM are refused by the same code (also required by T-F5-3); and `anon` and `service_role` never reach the function (42501 from the grant layer, section 5).

### 4.1 `apply_material_inward_turn`
- Caller: `service_role` only [observed: v3 T-F5-4]. Called by the webhook handler (PR-C).
- Parameters `[inferred]`, by analogy with 038/040: phone number, tenant, user (the engineer), project, message text, the single message SID, the media list (type, index), a parsed-kind or ack input if parsing stays outside, `p_now`, and the test-only sleep parameter 038/040 carry. Final list OWED at design.
- Uses ONE SID for both the `received_at` lookup and `source_message_sid`; refuses a missing `processed_messages` row or NULL `created_at` [observed: 049 lines 242-253, Q2-6]. This closes Q2-6 inside PR-B.
- **SID idempotency [per Aravind, 12 Oct 23:15]; this is PR-B's half of S-F (D-5).** A second call carrying an already-recorded SID writes nothing and returns a named duplicate outcome (name OWED). "Already recorded" means a `capture_documents` row with that `source_message_sid`, or a `capture_files` row with that `source_message_sid`, exists `[inferred: the two UNIQUE constraints in 049 are the source of truth, 049 lines 281-340]`. The check runs under the session lock, before any write, so two calls for one phone are serialised by the lock and the later one sees the first one's rows. It does not rely on catching the unique violation, which would roll the call back and (per 4.5) must never be swallowed. What it does NOT do: it does not stop the webhook from consuming the SID before processing, which is the PR-C half (D-5, S-F stays BLOCKING for PR-C). T-FLOW-3 (a duplicate SID creates no duplicate rows or reply) is the existing v3 test for this behaviour [observed: v3 section 9].
- Checks `expires_at <= p_now` before doing anything; if expired, clears and returns `expired` with no other write [observed: v3 line 334]. Order between the duplicate check and the expiry check is OWED `[inferred]`: a duplicate of a SID already handled should not re-expire or re-clear a session.
- Checks the IST-day rule exactly as 038/040 do (`quoco_same_ist_day`) [observed: 038:455; 040:490]; the IST date rule is applied first [observed: v3 line 342].
- Reads the session under the lock; any `current_flow` other than `'invoice'` returns `wrong_flow`, matching the other flow functions [observed: 038:610-611]. It never creates a session over a live other-flow session: that case is `reask` in the start branches today [observed: 038:518-519; 040:538-539], and the idle menu start for digit 4 must follow the same rule `[inferred]`.
- Raises: QE for any 049 trigger refusal bubbles up unchanged. `unique_violation` handling: see 4.4 and section 10.

### 4.2 `pm_set_delivery_details`
- Caller: an authenticated PM (D-4, section 5). Authorisation inside the function: caller is a PM of the delivery's project, via `auth.uid()` joined to `users` and `project_members`, as 048 does (`auth_id = auth.uid()`) [observed: 048 line 159]. `[inferred]` same helper shape.
- Fields: type (supplier or internal transfer), vehicle number, DC number, DC date. These columns exist [observed: 049 lines 347-373]. No money column: A24 forbids it [observed: v3 T-A17-1/T-R7-1].
- Path 6: DC delivery updates the DC row only; automatic delivery locks the invoice first, then the delivery [observed: 049 lines 223-228].
- Refusals from the triggers: QE006 (retype with active link), QE007 (automatic delivery to internal transfer), QE009, QE011 (locked content while approved or cancelled; D-23 [observed: 049 header on `dc_date`]).
- Refusal shape: see "One refusal shape for the five `pm_*` functions" below. It applies to every `pm_*` function, not only this one.

### 4.3 `pm_approve_delivery`
- Caller: authenticated PM. Path 5: DC delivery, update only; automatic delivery, read `created_from_invoice_id` unlocked, lock the invoice, update [observed: 049 lines 219-222].
- Allowed from `awaiting_pm`; PM may also approve `incomplete` [observed: v3 line 422 and D9 `[ASSUMED yes]`; D9 is an OPEN decision in v3 line 396, section 14].
- Constraint backstops: `deliveries_approved_requires_chk` needs `approved_by` and a non-NULL `delivery_type` [observed: 049 lines 347-400]. So approving a delivery with no type must be refused by the function with a clean code `[inferred]`, not by the CHECK.
- `approved_by` and `approved_at` are stamped by the database/function, not caller supplied [observed: TIME RULE].

### 4.4 `pm_reject_delivery`
- Caller: authenticated PM. Needs a reason (CHECK `deliveries_rejected_requires_chk`: non-blank `reject_reason`) [observed: 049].
- Path 3 (automatic delivery) and Path 4 (DC delivery with restore), with the S-C re-read rule: re-read under the locks; if the DC's active link no longer points at the invoice read earlier, RAISE QE011 and stop [observed: 049 lines 207-219].
- Soft-unlinks the link with `unlink_reason = 'delivery_rejected'`; TR3 forces the snapshot NULL [observed: 049 lines 213-217].
- Q-2 probe 4: any link unlinked as `delivery_rejected` whose delivery is not `rejected` must count 0 after every path [observed: 049 package line 137].

### 4.5 `pm_link_invoice`
- Caller: authenticated PM. Takes one invoice id and an array of DC delivery ids [observed: v3 T-F5-1..3 "the invoice id and each delivery id in the array"].
- Path 1, exactly as 049 states (lock invoice; validate caller and every target; lock DC deliveries `FOR SHARE` in ascending id and the automatic delivery `FOR NO KEY UPDATE` in the same pass; soft-unlink the self-link as `superseded_by_link`; cancel the automatic delivery; insert the `pm_manual` rows) [observed: 049 lines 183-196].
- Refuses when the automatic delivery is `approved` (X6) [observed: v3 T-A28-5]; nothing changes.
- The whole call is one transaction; a failing target leaves the automatic delivery uncancelled [observed: v3 T-A28-2 control].
- **Q-5 / E8 translation (BLOCKING in 049 package, item 2):** a 23505 can come from four unique constraints (`source_message_sid`, `(source_message_sid, media_index)`, `uq_dil_active_self_per_invoice`, `uq_dil_active_per_delivery`) and its detail text carries key values. The function catches `unique_violation`, reads the constraint name with `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`, and re-raises as QE008 ONLY for `uq_dil_active_per_delivery`; the app never maps on 23505 alone [observed: 049 package line 135; E8 reserved but "not raised" in 049 line 156]. QE008 is the one E-number 049 left unused for exactly this [observed: 049 line 156].
- **Every other 23505 is re-raised unchanged [per Aravind, 12 Oct 23:15].** Inside the exception handler, a `unique_violation` whose constraint name is not `uq_dil_active_per_delivery` is re-raised with a bare `RAISE;` (the original error, SQLSTATE and constraint intact). It is never swallowed and never translated. A handler that does not re-raise lets the call continue and COMMIT: in plpgsql an `EXCEPTION` block that handles an error and falls through to the end of the function returns normally, and the surrounding transaction commits whatever the function wrote before the error. Here that would mean a link call that hit `uq_dil_active_self_per_invoice` or a SID unique violation reports success with partial writes, and the automatic delivery could be left cancelled without the PM links. The re-raise is therefore a correctness requirement, not style. The test is T-E8-RERAISE (section 11).

### 4.6 `pm_unlink_invoice`
- Caller: authenticated PM. Path 2 (unlink with restore) [observed: 049 lines 197-206]: read the link's invoice unlocked (safe, TR3 makes it immutable), lock the invoice, re-read the link under the lock and refuse if no longer active, lock the DC delivery `FOR SHARE` and, if restore is possible, the automatic delivery; soft-unlink as `pm_unlinked`; if the invoice now has zero active PM links and the automatic delivery is `cancelled` with `superseded_by_link`, update the automatic delivery FIRST to `incomplete` or `awaiting_pm` (from whether the invoice document has an ack), clearing `cancelled_*` and `approved_*`, THEN insert the new self-link. Never the self-link first.
- A `rejected` automatic delivery is not restored [observed: 049 line 205; v3 Q4].

### 4.7 `expire_stale_material_inward`
- Caller: `service_role` only, called by the router once per inbound message [observed: v3 lines 211, 335; section 8].
- Parameters: phone number and `p_now` [observed: v3 line 211].
- Locks the session row `FOR UPDATE`; clears it ONLY if `current_flow = 'invoice'` AND `expires_at <= p_now`; writes nothing else; safe against a racing late turn [observed: v3 line 335].
- It must not touch morning, evening or hindrance rows [observed: v3 T-A27-7].
- Boundary: `>` versus `>=` at exactly 30:00 is `[GUESS] >` in v3 line 262; tests avoid exactly 30:00.

---

## 5. Grants

Rule [observed: CLAUDE.md section 6]: every new function in `public` needs an explicit per-role REVOKE; `FROM PUBLIC` alone is not enough, because Supabase default ACLs grant `anon`, `authenticated` and `service_role` individually. State the intended callers, then REVOKE BY NAME from every role not in that list, and read the ACL back (`has_function_privilege`) and make a real anon-key call.

049's tables stay SELECT-only for `authenticated` and `service_role`; no INSERT, UPDATE, DELETE or TRUNCATE for any role; `anon` holds nothing [observed: 049 lines 965-985].

**Final grant matrix [per Aravind, 12 Oct 23:15, D-4].** History, one line: the brief for the first plan said "service_role only" for all seven; v3 T-F5-1..3 needs the right PM to succeed and `service_role` to be refused, so the five `pm_*` functions are `authenticated` only, as `add_engineers_to_project` is (048:381-384, quoted in `/tmp/quoco/pr-b-probe-3.txt` step 3) [observed]. The handover line "all definer functions service_role only" is superseded for those five; it still holds for the other two.

| Function | anon | authenticated | service_role | Evidence |
|---|---|---|---|---|
| `apply_material_inward_turn` | no | no | YES | v3 T-F5-4 [observed] |
| `expire_stale_material_inward` | no | no | YES | v3 T-F5-4 [observed] |
| `pm_set_delivery_details` | no | YES (PM, checked inside) | no | v3 T-F5-1..3; 048:381-384 [observed]; D-4 |
| `pm_approve_delivery` | no | YES | no | same |
| `pm_reject_delivery` | no | YES | no | same |
| `pm_link_invoice` | no | YES | no | same |
| `pm_unlink_invoice` | no | YES | no | same |

For the five `pm_*` functions the statement shape is the 048 one: `REVOKE EXECUTE ... FROM PUBLIC, anon, service_role` then `GRANT EXECUTE ... TO authenticated` (048:381-384) [observed]. The ACL is defence in front of the body, not instead of it: the body re-derives the caller from `auth.uid()` and re-checks tenant and project membership (048 lines 154-189, "Class 2 in 020's convention", 048:379-380) [observed]. For the two service_role functions, REVOKE from PUBLIC, anon, authenticated and GRANT to service_role.

Mechanics `[inferred]`: for each function, REVOKE ALL from PUBLIC, anon, authenticated, service_role, then GRANT EXECUTE to only the intended roles (so `scripts/lint-migrations.mjs` Rule 1 is satisfied by a real grant rather than a to-postgres stub). The N2 `CREATE OR REPLACE` of 038/040 must re-assert their existing grants in the same file, since `CREATE OR REPLACE` with an unchanged signature preserves them but the lint rule requires the pair [observed: 038:712-715, 040:907-910].

Evidence shape, required by CLAUDE.md section 6 for every new SECURITY DEFINER function: an authenticated-as-PM, as-qs, member and non-member run, AND a real anon-key call through PostgREST showing the refusal (T-F5-4, T-F5-1..3).

---

## 6. N2 branches in morning (038) and evening (040)

What the live functions do today [observed, quoted in `/tmp/quoco/pr-b-block-2.txt` step 3a]:

- Start call (`p_start_flow = true`): morning 038:465-520. `current_flow` NULL, then start; `'hindrance'`, then the B1 force-reset; ELSE (line 518-519) returns `'reask'`. Evening 040:500-540, same shape, ELSE `'reask'` at 538-539.
- Turn call (`p_start_flow = false`): the final ELSE returns `'wrong_flow'` (038:610-611; 040:710-711).
- So with `current_flow = 'invoice'`: a scheduled check-in start returns `reask` and the session is untouched; any engineer text routed to morning or evening returns `wrong_flow` [observed].

What follows in the app today [observed: probes 1 and 2]:
- `inbound-start.ts:723-724` maps any non-evening, non-hindrance flow to `'morning'`. A text-only message with an `invoice` session goes morning RPC `wrong_flow`, then the evening RPC `wrong_flow`, then `FLOW_RACE_REPLY` (`dispatch.ts:286-292`), and the session stays until the IST day changes.
- A photo or PDF with an `invoice` session is NOT refused. `inbound-start.ts:749` skips (media present), and the path at 786-888 resolves or creates today's `daily_logs` row, enqueues a `media_ingest` job with `phase: 'morning'` (`:825-837`), sets `morning_photos_status = 'pending'` (`:839-843`), and replies with the morning re-ask for the session's `current_step` (`:876-888`). So a capture file sent into an `invoice` session today would be stored as a morning check-in photo. This is why PR-C's router branch (N1) must exist before any `'invoice'` row can be written. [observed]
- The scheduled trigger sends the template FIRST and only then calls the start RPC (`trigger.ts:347-370`). If the RPC returns anything but `start`, the ledger still records `sent` and a Sentry error is raised: `outbound-send: RPC did not return "start" on a startFlow:true call` (`trigger.ts:372-393`). With a live `invoice` session today that is the exact path taken (`reask`). Nothing fires the check-in again the same day (section 7). [observed]

The change [per Aravind / v3 Q6]: add one branch to the start section of each function, keyed on `current_flow = 'invoice'`, next to the hindrance branch. The partial delivery rows stay saved (they are not in `whatsapp_sessions`).

**Method [per Aravind, refined 12 Oct 23:15]:** the new body = the live body + exactly three named hunks, and nothing else: (1) the N2 branch; (2) the Q1 guard from section 7; (3) the new return key `capture_discarded`. Proof = a unified diff of the 050 function body against the live `pg_get_functiondef`, from test-db AND from prod, captured just before apply; the diff must show those three hunks and no other change, per function. The migration files 038 and 040 are NOT the baseline; the live text is, because `CREATE OR REPLACE` replaces whatever is live and out-of-band drift is documented on this project (CLAUDE.md section 0; handle_new_user drift).

Baseline captured so far [observed: `/tmp/quoco/pr-b-probe-3.txt` step 1, test-db ref `exfccwlrhoutkgrlikod`, SELECT only]: the full `pg_get_functiondef` of both live functions, saved outside the repo as `/tmp/quoco/live-apply_morning_flow_turn-testdb.sql` (294 lines) and `/tmp/quoco/live-apply_evening_flow_turn-testdb.sql` (460 lines). Their md5s equal probe 1's: morning `707c10fe09dfd5a7cd065f7826eacd46` MATCH, evening `d19d07507abccdaf7d54ee1d74419af7` MATCH. So test-db has not changed between probe 1 and probe 3. NOT done: a diff of these bodies against the 038 and 040 migration text, and anything on prod. No prod md5 exists yet (section 13).

**Decision [per Aravind, 12 Oct 23:15]: what the N2 branch returns.** The branch returns outcome `'start'` (or `'already_complete'` when that half is already submitted, as the hindrance branch does) and adds one return key, `capture_discarded` (boolean), mirroring `hindrance_discarded` [observed: 038:700-708 and 040:892-900 return `hindrance_discarded` and `hindrance_had_description` after the `jsonb_build_object` keys; both variables are declared `BOOLEAN := NULL`, 038:438-439, 040:473-474; the wrappers pass the keys through, `flows/morning.ts:557-568`, `flows/evening.ts:375-395`; `trigger.ts:413-425` reads only `hindranceDiscarded` and logs an info-level Sentry message]. `capture_discarded` is true when the branch discarded an `'invoice'` session, and NULL otherwise, as the hindrance key is.
- `trigger.ts` needs no change in PR-B. The outcome on this path is `start`, so the `turn.outcome !== 'start'` branch (`trigger.ts:372`) is not reached, and no new outcome value enters the TypeScript outcome unions. Logging `capture_discarded` is optional PR-C work (the wrappers cast the RPC result to a fixed shape and pick named fields, so the extra key is ignored until a wrapper reads it `[inferred]`).
- History, one line: the first plan had a CONFLICT block here (the brief wanted a distinct outcome `capture_reset`; v3 Q6 and `trigger.ts:372` expect `start`). The decision above is option (A) of that block; options (B) and (C) are dropped.

Other facts the branch must respect:
- Submitted-marker check first, as hindrance does (`morning_submitted` for morning, `evening_submitted` for evening), returning `already_complete` and clearing the session [observed: 038:505-509; 040:524-528; v3 line 349].
- Subtract-only context cleanup, never a bare replace: only the keys that the flow's own steps wrote are removed, so cross-flow markers survive by construction [observed: 038 B1 comment 484-502]. The exact flow-owned context keys are OWED (v3 line 334 says "MI context keys removed" and never names them).
- When the branch starts the check-in (not when it returns `already_complete`), it also sets the N13 context flag (section 7). The flag is a context key, so it is part of hunk (1) or (2) of the proof diff, not a fourth hunk `[inferred]`; the exact hunk boundary is decided when the body is written.
- Same-signature `CREATE OR REPLACE`; grants re-asserted in the same file (section 5).
- DOWN restores the live bodies (section 9).

---

## 7. N13: a check-in reset can swallow the engineer's reply

The problem [observed: v3 N13, line 66; R5, line 403]: if a scheduled check-in force-resets a live `invoice` session while the ack question is pending, the engineer's next `1`, `2` or `3` lands on the check-in's first question.

Step 3c findings, with quotes [observed]:
- **Morning check-in, first question (step 1):** `v_yesno := quoco_classify_yes_no(p_message)` (038:534). In `quoco_classify_yes_no` (030:267-318) the YES list is yes, y, yeah, yep, yup, ok, okay, done, completed, complete, finished, achieved, met, full, fully, aama, ama, aam, half, half-day, late, coming, come, reaching, reached, way; the NO list adds no, n, nope, not, notdone, incomplete, pending, partly, partial, partially, mostly, some, delayed, missed, short; the NONE list is no, none, nothing, nil, na, zero, `'0'`, `'-'`, illa, ille, illai, illae, kidaiyathu, kedaiyathu. The digits `1`, `2`, `3` are in none of them, so a bare `1`, `2` or `3` returns `{met:false, ok:false}`. Then 038:536-538: with `q1_reask` at 0 it re-asks once and writes only the reask counter. On the second non-parsing answer the else branch at 543-550 runs: step becomes 2, `v_attendance := 'present'`, `v_attendance_defaulted := NOT ok` (true), `v_attendance_raw := v_text`. So: the first stray digit is a re-ask, no attendance written; a second stray digit silently records the engineer present (defaulted). A bare `0` is the exception: it is in NONE, so `ok:true, met:false`, and the branch at 539-542 jumps to step 5 (the not-on-site route).
- **Evening check-in, first question (step 1):** 040:553-558, "Q1 (free text + enrichment) -> evening_output + quantities": `current_step := 2; v_outcome := 'advance'; v_col := 'output'`, with no validation. A bare `1`, `2` or `3` is accepted as the answer. The write at 040:721-728 inserts `evening_output = v_text` ("1") into `daily_logs` with `ON CONFLICT ... DO UPDATE SET evening_output = EXCLUDED.evening_output`. At 18:30 the evening output is normally empty, so a stray `1` BECOMES the day's work text (the upsert would also replace a value if one were already present; that is not the expected case). There is no digit or length check between the router and the RPC: `flows/evening.ts:339-340` sets `parseOk['1']: true // Q1 is never parse-gated`, `dispatch.ts:197-207` passes `message` through unchanged, and `classifyAdhocInput` is first called at `inbound-start.ts:939`, after the active-flow block [observed: `/tmp/quoco/pr-b-probe-3.txt` step 5].

Step 3d findings, with quotes [observed]:
- The two check-ins are fired by cron once a day: morning `0 3 * * *` UTC, evening `0 13 * * *` UTC (`vercel.json`: `/api/cron/morning-trigger`, `/api/cron/evening-trigger`).
- The retry budget is inside one invocation: "3 attempts, per engineer, per checkpoint, per IST day ... WHY THE THREE ATTEMPTS HAPPEN INSIDE ONE INVOCATION, NOT ACROSS SEPARATE CRON TICKS" (`checkpoint-trigger.ts:20-34`), `MAX_ATTEMPTS = 3`, `RETRY_BACKOFF_MS = 2000` (`:72-73`). It retries only a send that Twilio rate-limited (`rate_limited`); on exhaustion it leaves the ledger row and alerts (`:26-29`, `:177-179`).
- If the RPC does not return `start` after a successful send, there is NO retry: the row becomes `sent` and a Sentry error is raised (`trigger.ts:372-393`).
- `coverage-sweep.ts` compares the expected roster size with `outbound_sends` rows that reached `sent` and alerts; it does not send (`coverage-sweep.ts:10-20`). A row recorded `sent` counts as covered.
- Therefore: if a scheduled check-in does not start (for example, the RPC returns `reask` because of a live `invoice` session), nothing fires it again that day. The engineer receives the template and has no active session. [observed from the lines above; "nothing else fires it" is also an absence claim: I read `trigger.ts`, `checkpoint-trigger.ts` and the head of `coverage-sweep.ts`, not the whole of `jobs/tick`; `[inferred]` for the tick.]

### The D-3 design [per Aravind, 12 Oct 23:15]: N13 is fixed in PR-B

The brief's rule was: if a bare 1/2/3 parses as a first-question answer, a defer path is required before engineers go live. By the quotes above it does (evening: accepted at once; morning: accepted on the second attempt as defaulted attendance). D-3 decides the fix: a guard in the two live functions, so a stray ack digit right after a check-in start is not taken as the first answer.

1. **Flag.** The N2 branch sets a context flag whenever it discards an `'invoice'` session and starts the check-in. Flag name PROPOSED: `invoice_reset_guard` (boolean true in `whatsapp_sessions.context`); final name OWED. It is not set when the branch returns `already_complete` (no check-in starts, so there is no first question to protect) `[inferred]`.
2. **While the flag is set, at step 1,** a message that is exactly `1`, `2` or `3` after `btrim`:
   - morning (step 1, attendance): outcome `reask`; it does NOT count toward `q1_reask`; no attendance is written; the session stays at step 1;
   - evening (step 1, work completed): outcome `reask`; nothing is written to `daily_logs`; the session stays at step 1.
3. **`0` keeps its current morning meaning.** A bare `0` is in `quoco_classify_yes_no`'s NONE list (030:290), so it routes to step 5 (not on site) as today (038:539-542). The guard covers only the digits `1`, `2` and `3`.
4. **Clearing.** The first step-1 answer that is not a bare `1`, `2` or `3` clears the flag (as part of that turn's own context write). The IST-day rule also clears it: when `quoco_same_ist_day` is false the RPC resets the whole context to `{}` (038:455-459, 040:490-495 [observed]).
5. **Unbounded re-asks, stated.** While the flag is set, an engineer who keeps sending only a bare `1`, `2` or `3` is re-asked each time and never progresses, with no budget consumed. This matches how an empty or whitespace answer already behaves at both step 1s (038:530-531, 040:550-551: reask, unlimited, no write) [observed]. The flag cannot outlive the IST day.
6. **Re-ask text.**
   - Morning: the step-1 re-ask is the question itself. `buildMorningReply('reask', 1)` returns `MORNING_QUESTIONS[currentStep]` (`flows/morning.ts:184-185`), and `MORNING_QUESTIONS[1]` is `'Good morning. Are you on site today? Reply yes or no.'` (`flows/morning.ts:92`) [observed: block 3 step 1]. No new string is created for morning.
   - Evening: no dedicated step-1 re-ask exists. `EVENING_REASK_MESSAGES` has keys 2, 3 and 4 only (`flows/evening.ts:121-125`); a step-1 re-ask falls back to `EVENING_QUESTIONS[1]` (`flows/evening.ts:227`; the text is at `flows/evening.ts:98`) [observed: block 3 step 1]. Per the brief: STRING OWED — Aravind to supply (constant carries 'Tamil owed, NOT approved'). Two notes: that marker is not in `flows/morning.ts` or `flows/evening.ts` (it is in `lib/photos/copy.ts`; a search of `lib` and `app` found no match in the flow files) [observed]; and the existing fallback already re-sends the approved question text, which is one option for Aravind to weigh, not a recommendation.
7. **Where it lives.** It is hunk (2) of the proof diff in section 6 (the Q1 guard), in both functions. The TypeScript layer is unchanged: the guard returns the ordinary outcome `reask`, which both reply builders already handle.
8. **What it does not fix** `[inferred]`: an engineer who is mid-capture and answers the ack question with a digit AFTER the check-in has started and the flag has been cleared by a real step-1 answer is not protected; that digit then belongs to a later question. The exposure window is the first answer only.
- Time window `[inferred]`: the ack question is pending for at most 30 minutes (A27); the evening trigger is 18:30 IST and the morning trigger 08:30 IST. An engineer mid-capture at those minutes is the exposed population; how many such engineers exist is unknown.

---

## 8. N9 and A27

- `expire_stale_material_inward` is called by the router once per inbound message: v3 line 211 ("if `expires_at <= now`, call `expire_stale_material_inward(phone, now)` (service_role) and return `null`") and line 335 ("called by the router before it returns `null`") [observed].
- No cron. v3 never mentions a scheduled sweep for it; the grep of v3 for `cron` shows no such item (probe 2 step 5) [observed].
- Consequence [observed from the above, stated as v3 leaves it]: a stale `invoice` row with no further inbound message from that engineer stays until a message arrives or a scheduled check-in runs. While it stays, a scheduled check-in start returns `reask` today (section 6); after N2 it does not. The N2 branch is therefore the only thing that clears a stale row for an engineer who stays silent, at the next 08:30 or 18:30 IST. `[inferred]`
- Also while it stays: the hindrance start over a stale row returns `reask` (N9, bug) [observed: v3 line 62]. The router's call clears it first for the engineer's own next message.
- The 30 minutes lives in SQL only; the router and the expire function compare `expires_at`, they do not hold a second constant [observed: v3 line 336].
- Open decision carried from v3: D1/X9, what `1`, `2`, `3` do after expiry (v3 line 384) [observed]. T-A27-10 is written after that decision, not before.

---

## 9. DOWN

Required content [per Aravind's brief]:
1. Restore the 038 morning and 040 evening bodies from the PROD text captured before apply (a file plus its sha256), NOT from the migration files.
2. Drop the seven new functions. Include their REVOKE state implicitly (dropped objects carry no grants).
3. Clear every `whatsapp_sessions` row with `current_flow = 'invoice'`. Reason [observed: probe 2 step 1; section 6 above]: after the restore, a start call over an `invoice` row returns `reask` and a turn call returns `wrong_flow`; the router would send it to the morning RPC and the engineer would see the flow-race reply until the IST day rolls over.
4. The 050 DOWN has no CHECK to restore. v3's T-DOWN-1 reasoning ("the CHECK removal would fail with a row present, so DOWN resets them first", v3 line 252) no longer applies; the reset is still required for the lockout reason in item 3. [observed / inferred]
5. The DOWN section is commented, inert text [observed: `down-section-must-be-commented` lint rule, CLAUDE.md section 7].

6. **Strip the N13 flag [per Aravind, 12 Oct 23:15, D-3]:** remove the guard key (PROPOSED name `invoice_reset_guard`) from `whatsapp_sessions.context` on EVERY row that carries it, not only `invoice` rows. A flag left behind would be inert once the restored bodies no longer read it, but the DOWN leaves no trace of the migration in session state, and T-DOWN-1 is extended to check that (section 11).

Order inside the DOWN [per Aravind, 12 Oct 23:15]: clear the `'invoice'` sessions; strip the N13 flag; restore the two bodies; drop the seven functions; all in one transaction.

Delivery data is not touched by DOWN: `capture_documents`, `capture_files`, `deliveries`, `delivery_invoice_links` are 049's tables and stay. Rows written between apply and DOWN remain and are readable; no function can then write them. `[inferred]`

Rehearsal (T-DOWN-1, CLAUDE.md section 7): on a disposable scaffold built from a real dump, and then on test-db: seed a session actively in `current_flow = 'invoice'`; confirm the same turn works before the DOWN; run the DOWN; confirm a subsequent morning or evening start works for that engineer and that no `invoice` row remains; confirm the session is safely reset to idle, not left calling a function that no longer exists [observed: CLAUDE.md section 7 DOWN rule]. Comments and ACLs are verified after teardown as well, for every function the migration creates or replaces (`obj_description`, the ACL fingerprint) [observed: CLAUDE.md section 7 on teardown and comments].

---

## 10. Blocking conditions

Source: 049 package section 10, lines 131-141, and line 267 [observed].

| # | Condition (verbatim substance) | Closed by | Which PR |
|---|---|---|---|
| PR-B 1 (S-F), SPLIT [per Aravind, 12 Oct 23:15, D-5] | S-F capture-loss window: the SID is consumed before processing, so a capture that fails after that point is lost when Twilio retries. Record the inbound media durably at or before SID consumption, or add a failure path that records and alerts. | **PR-B half:** `apply_material_inward_turn` is safe to repeat for one SID: a second call with the same SID writes nothing and returns a named duplicate outcome (section 4.1; test T-FLOW-3 plus a PR-B-side duplicate-outcome test, section 11). **PR-C half:** the webhook ordering of SID consumption (`app/api/whatsapp/webhook/route.ts:224`, `lib/whatsapp/idempotency.ts:24-38` [observed: 049 lines 235-239]) and the failure path that records and alerts. Recorded in `docs/reviews/049-review-package.md` by the dated note in commit e96e116. | PR-B closes its half only. **S-F stays BLOCKING for PR-C.** |
| PR-B 2 | Q-5, E8 translation: catch `unique_violation`, read the constraint name, re-raise as QE008 only for `uq_dil_active_per_delivery`; the app never maps on 23505 alone. | Design element: `pm_link_invoice` (section 4.5). Test: Q-5 E8 test below. | PR-B |
| PR-B 3 | Q-5, CI assertion that one QE code reaches supabase-js as `error.code` (PostgREST's handling of unknown SQLSTATEs is unverified). | CI-only assertion against the real PostgREST path. | PR-B tests; unverified until CI runs |
| PR-B 4 | Q-2 probe 4 in the PR-B tests: links unlinked as `delivery_rejected` whose delivery is not `rejected` must be 0 after every path. | `pm_reject_delivery` plus the probe as a test. | PR-B |
| PR-B 5 | D-30 multi-photo real-phone test: how WhatsApp/Twilio delivers several photos selected together; the bot must ask 1/2/3 once per document. | A real handset test of the live bot. | Needs the handler (PR-C); PR-B contributes one document per SID. `[inferred]` |
| PR-B 6 | The Q2-6 single-parameter `received_at` rule (SQL header 214-237) and the CI-only race tests for paths 1-6. | Rule: `apply_material_inward_turn` (section 4.1). Race tests: CI-only; "not verified locally" (CLAUDE.md section 0). | PR-B |
| line 267 | "Deferred to PR-B: vitest cases c, d, f (helper insert, tenant guard, N-4 E12 via the helper); fixture design belongs to PR-B." | Test design for the PR-B suite: the helper `scripts/test-db-only-capture-helpers.sql` (insert, tenant guard) is the test-only fixture surface; case c is the helper insert, d is the tenant guard (`quoco_test_capture_fixture_tenant_ok`, helper lines 68-78 [observed: 049 package line 73]), f is N-4 E12 through the helper. What cases a, b and e were is not in the package; see section 14. | PR-B |
| PR-C | `capture_files` immutability (reviewer S-1, second part): once stored, `storage_path`, `sha256`, `byte_size`, `content_type` immutable; `stored` and `rejected` terminal; identity columns immutable. The `capture_files` column UPDATE grant for `service_role` moved to PR-C by D-8 (`docs/reviews/049-plan-review-package.md:33`: "the `capture_files` column UPDATE grant is removed from PR-A. It moves to PR-C. PR-A grants `service_role` SELECT only") [observed: `/tmp/quoco/pr-b-probe-3.txt` step 4]. v3:101 names the grantee and columns (`service_role`, column-scoped UPDATE on `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`, precedent 039) [observed]. | PR-C | PR-C |

`capture_files` writes: 049 grants `service_role` SELECT only (049:978-981), and D-8 moved the column UPDATE grant to PR-C. PR-B writes no `capture_files` row after S2 other than the `pending` rows its RPC inserts; the ingest job's UPDATE of the ingest columns is PR-C's [observed: 049-plan-review-package.md:33; v3:101, 117].

---

## 11. Tests

Anchored on v3 section 9 [observed]. v3 does not assign tests to PRs. The PR-B versus PR-C split below is `[inferred]` throughout.

Rules for all of them: markers `ZZTestCapture-${RUN_TAG}-<scenario>` on every asserted identifier; tests never run an unscoped `claimJobs` or `runJobsTick`; concurrency, lock and race tests are CI-only and labelled "not verified locally" [observed: v3 section 9; CLAUDE.md section 0]. Test fixtures follow the 049 rule that capture tests write only under `zz-test-capture-*` tenants via the helpers, because `service_role` has no DELETE [observed: 049 package line 80].

Positive control = the case that must go RED.

| ID | PR-B or PR-C `[inferred]` | Behaviour | Positive control (RED) |
|---|---|---|---|
| T-SESS-1 (N2) | PR-B | Scheduled morning and evening start over a live `invoice` session: cleared, check-in per the section 6 decision, partial delivery rows survive; `already_complete` if that half is submitted. | The same call on the 038/040 SQL (no new branch) returns `reask`. |
| T-DOWN-1 (extended, D-3) | PR-B | DOWN leaves a live in-flight session safely reset (section 9). Extended: after the DOWN, no `whatsapp_sessions.context` on any row carries the N13 flag. | The same turn works before DOWN; a flag planted on a non-`invoice` row must be removed by the DOWN, and the check fails if it is left. |
| T-A27-3 | PR-B | Stale `invoice` row, then hindrance start: outcome `start`, not `reask`, because the row was cleared first. | Skip `expire_stale_material_inward`: outcome `reask`. |
| T-A27-4 | PR-B | Stale row plus scheduled morning or evening start: starts normally. | n/a in v3 (`—`) |
| T-A27-5 | PR-B | Every valid turn, including a re-ask, refreshes `expires_at` and `updated_at`; replying every 25 minutes never expires. | A 31-minute gap expires. |
| T-A27-6 | PR-B, CI-only | A turn reaching the RPC after expiry: under the lock the RPC returns `expired`, writes only the clear. | A live turn processes. |
| T-A27-1, 2, 7, 8, 9, 10 | mostly PR-C (router) `[inferred]`; the SQL halves are PR-B | Idle 31 minutes; 29:59/30:01 boundary; other flows untouched; IST midnight; PDF after expiry; characterisation of 1/2/3. T-A27-10 waits for D1. | per v3 |
| T-A28-1 | PR-B | Invoice send creates exactly one automatic delivery (`created_from_invoice_id` set, `incomplete`) and one active self-link in one transaction; a DC send creates a delivery and no link. | A DC send with an invoice-only assertion fails. |
| T-A28-2 | PR-B | `pm_link_invoice` to two DC deliveries: two `pm_manual` rows, automatic delivery `cancelled` with `superseded_by_link`, self-link soft-unlinked, all in one call. | A failed link (ineligible target) leaves the automatic delivery UNcancelled (rollback). |
| T-A28-3 | PR-B | The rule with the function bypassed, run as the table owner in the rehearsal scaffold, NOT as `service_role`. | Same inserts with the self-link first soft-unlinked succeed. Whether CI has a direct owner connection is UNVERIFIED [observed: v3]. |
| T-A28-4 | PR-B | Unlink restore (Q4): last PM link, then `awaiting_pm` again with a NEW self-link; unlink leaving another link restores nothing; a rejected automatic delivery is not restored. | Another PM link remaining means no restore. |
| T-A28-5 (X6) | PR-B | Linking while the automatic delivery is `approved` refused, nothing changes. | Same link on an `awaiting_pm` automatic delivery succeeds. |
| T-Q3-1 | PR-B | `pm_set_delivery_details(type=internal_transfer)` with an active link refused, and refused at the DB with the function bypassed. | Same call after unlink succeeds. |
| T-LINK-1 | PR-B | Link refused across projects, tenants, to a non-invoice document, to an internal transfer, to a rejected or cancelled delivery, to an automatic delivery, even with the function bypassed (owner). | Same-project, same-tenant link succeeds. |
| T-F5-1/2/3 | PR-B | For each of the five PM functions: PM of another project in the same tenant refused, row unchanged (-1); PM of another tenant refused (-2); refusal identical for a nonexistent and an unauthorised id; `anon`, a same-tenant `qs`, `service_role` refused (42501 via PostgREST where reachable, plus a real anon-key call) (-3). For `pm_link_invoice` the negative cases run on BOTH the invoice id and each delivery id in the array, and nothing is cancelled. | The right PM succeeds and the row changes. |
| T-F5-4 | PR-B | `apply_material_inward_turn` and `expire_stale_material_inward` refused for `anon` and `authenticated` (42501), succeed for `service_role`. | The `service_role` call succeeds. |
| T-F6-1 | PR-B | The anon-refusal test can fail: on a scaffold built per CLAUDE.md section 7, a planted `GRANT ... TO anon` turns it red. | The control itself. |
| Q-2 probe 4 | PR-B | `delivery_rejected` unlinks with a non-rejected delivery count 0 after every path. | A planted bad row makes it non-zero `[inferred]`. |
| Q-5 E8 | PR-B | A second active PM link on one delivery surfaces as QE008; each of the other three 23505 sources is NOT translated. | The un-translated sources return their native 23505. |
| Q-5 CI `error.code` | PR-B, CI-only | One QE code arrives in supabase-js as `error.code`. | A deliberately unknown SQLSTATE shows what PostgREST does with it. |
| Q2-6 / race tests, paths 1-6 | PR-B, CI-only | Lock-order and concurrency of the six paths. | Two real sessions; a single session proves nothing [observed: 049 header B3]. |
| T-FLOW-1..4, T-R1-1, T-A18-1 | PR-B (RPC halves) and PR-C (reply text) `[inferred]` | Save-as-you-go, ack paths, duplicate SID, "received" never "saved", same question path after a DC and an invoice. | per v3 |
| T-PDF-*, T-SIZE-1, T-ROUTE-*, T-PHOTO-1, T-SENTRY-1, T-RLS-1..3 (photo kind) | PR-C | Byte checks, router mapping, photo-access kind. | per v3 |
| T-DATE-1 | PR-B (generated column is 049; the RPC's `received_at` source is PR-B) | IST boundary for `delivery_date`. | A UTC implementation fails. |
| T-R7-1, T-A17-1, T-A24-1 | PR-B | No `confidence`, `paid` or money column or `amount`/`rate`/`total` in the migration. | A planted column fails. |
| vitest c, d, f | PR-B | Helper insert; tenant guard; N-4 E12 through the helper (section 10). | per 049 package |
| T-N13-1 (evening) [per Aravind, 12 Oct 23:15] | PR-B | Flag set: a bare `1` at evening step 1 re-asks and `daily_logs.evening_output` is unchanged. | Without the flag, the `1` is written. |
| T-N13-2 (morning) | PR-B | Flag set: two bare digits at morning step 1 write no attendance and consume no `q1_reask`. | Without the flag, the second digit records present (defaulted). |
| T-N13-3 | PR-B | The flag is cleared by a real step-1 answer; and `0` still routes to not-on-site with the flag set. | A guard that also swallowed `0` fails it. |
| T-N2-KEY | PR-B | A start over a live `'invoice'` session returns outcome `'start'` and `capture_discarded = true` (and `'already_complete'` with `capture_discarded = true` when that half is submitted). | The 038/040 live body returns `'reask'`. |
| T-E8-RERAISE | PR-B | The other three 23505 sources (`source_message_sid`, `(source_message_sid, media_index)`, `uq_dil_active_self_per_invoice`) reach the caller as 23505 and the call commits nothing. | A handler without `RAISE;` lets the call commit. |
| T-F5-SAME | PR-B | A nonexistent id, an id in another tenant and an id in another project (same tenant) give the identical error: same SQLSTATE, same absence of detail. | A planted different code in one case fails it. |
| T-SID-DUP | PR-B `[inferred]` | A second `apply_material_inward_turn` call with an already-recorded SID writes nothing and returns the named duplicate outcome (name OWED). This is the PR-B half of S-F (D-5). | A new SID creates its rows. |

The two rows the first plan listed as "new rows the N2 decision requires" are now T-N13-1..3 and T-N2-KEY above. The PR-B versus PR-C split in this table is `[inferred]` throughout; v3 does not assign tests to PRs.

---

## 12. Apply path

FULL tier [observed: CLAUDE.md section 0, the 2026-09-19 correction: a change touching tenant isolation, a third party's phone number or real customer data is FULL; PR-B's SECURITY DEFINER functions write the tenant-scoped capture tables]. Order for FULL tier [observed: CLAUDE.md section 0]: external review, test-db apply, DOWN rehearsal with captured output, CI green with the pinned run URL (the passing run's `headSha` equals the PR HEAD), merge (regular merge commit for a branch that continues), PITR observed, prod apply, verify by observation, ledger, apply record. Plus: the migration enters `supabase/migrations/` only in the apply commit; `scripts/migration-number-reservations.json` is updated as part of the apply (Step H); `types/database.ts` is regenerated after the apply; and a prod apply is not done until test-db carries the same migration for real [observed: CLAUDE.md sections 0 and 6].

Apply commands: `supabase db query --linked -f <file>`, foreground, one file at a time, never `db push`; the linked ref printed and pasted in the same frame; pre/post hashes compared with a live re-probed reference; no apply without Aravind's explicit go-ahead in the same exchange [observed: CLAUDE.md section 0, rules (a)-(c)].

**DECIDED [per Aravind, 12 Oct 23:15, D-6]: PITR substitution.** PITR is OFF on prod until beta launch [observed: `scripts/migration-number-reservations.json` 049 entry: "PITR disabled on prod until beta launch, applied without it per Aravind"]. CLAUDE.md section 0 requires the rollback mechanism to be verified by observation, never by checklist (rule on ROLLBACK MECHANISMS). Decision: the PITR step is substituted by a captured-body rollback: the `pg_get_functiondef` text of `apply_morning_flow_turn` (038 live) and `apply_evening_flow_turn` (040 live) from prod, plus their sha256, captured just before the apply, and the DOWN restores from that text. The apply record must say "substituted", not "skipped", and name the evidence. What this does NOT cover: it restores the two function bodies and clears `invoice` rows; it cannot restore any data written by the new functions afterward, so a rollback after engineers go live loses nothing only because engineers are enabled after PR-D `[inferred]`. The captured text is the one named in section 13 item 2 and the DOWN restores from it (section 9). It is also the baseline for the three-hunk proof diff in section 6, taken from prod as well as test-db.

Order relative to the other PRs [observed: v3 section 8]: A, B, C, D, F. PR-B alone does not let any `'invoice'` session be created: the idle menu digit 4 is PR-C. So between PR-B's apply and PR-C's merge, nothing writes an `invoice` row, and the N2 branch is dormant. That is the safe ordering for the problems in section 6; reversing it is not safe `[inferred]`.

---

## 13. Prod pre-checks before apply

Prod has NOT been contacted in any block or probe so far (probes 1 to 3, blocks 2 and 3). All of the following are to be read just before the apply, with the linked ref printed in the same frame, read-only:

1. Count of `whatsapp_sessions` rows with `current_flow = 'invoice'` on prod (expected 0). Test-db had 0: the distribution was evening 435, hindrance 1, NULL 106 [observed: probe 1 step 8].
2. The prod md5 AND the full `pg_get_functiondef` text, saved to a file with its sha256, of `apply_morning_flow_turn` and `apply_evening_flow_turn`. Compared to the test-db live text; any difference between prod and test-db is explained before the 050 body is built on either.
3. The CHECK constraint on `whatsapp_sessions` on prod: that its name is `whatsapp_sessions_current_flow_check` and that `'invoice'` is allowed (observed on test-db only).
4. Whether the event trigger `ensure_rls` and `rls_auto_enable` exist on prod as D-2 assumes (the script's own header is the only claim [observed: probe 2]).
5. `supabase migration list` local versus remote on both databases, and the highest ledger entry (049 on both per the 049 apply record [observed: reservations note]).
6. The seven function names do not already exist on prod (a same-name function would make a bare `CREATE` abort or an overload appear).
7. The ACL readback and a real anon-key refusal after the apply (section 5).

---

## 14. Open items and unknowns

DECIDED since the first plan, removed from this list [per Aravind, 12 Oct 23:15]: N13 (D-3), the N2 return value (section 6), the `pm_*` grants (D-4), PITR (D-6), and who writes `capture_files` (PR-C, by D-8, section 10).

DECISIONS OWED (Aravind):
1. **v3's own open decisions that touch PR-B** [observed: v3 section 12, 'Decisions I need from you']: D1 (what `1`, `2`, `3` do after expiry), D3 (refuse linking when the automatic delivery is approved; recommended refuse, and T-A28-5 assumes refuse), D6 (Q3 refuse, Q4 restore on unlink, self-link model, trigger versus extension), D8 (can a DC have more than one invoice), D9 (may the PM approve `incomplete`; assumed yes), D10 (further photos at S3/S4 attach to the same document, does the bot reply to each).
2. **Names, all PROPOSED or OWED:** the N13 context flag (PROPOSED `invoice_reset_guard`); the duplicate-SID outcome name (OWED); the `pm_*` refusal code (PROPOSED `QE015`, code only, with its app string STRING OWED — Aravind to supply); the order of the duplicate check against the expiry check in `apply_material_inward_turn`.
3. **Evening step-1 re-ask text:** STRING OWED — Aravind to supply (constant carries 'Tamil owed, NOT approved'). Morning needs no new string (section 7, item 6).
4. **The name `'invoice'` is now taken by this flow.** CLAUDE.md section 2 lists "Ad-hoc safety / invoice / hindrance flows" and "DASH-05 invoice queue" as Fast-Follow, not built [observed]. A future ad-hoc invoice flow cannot reuse `current_flow = 'invoice'`; and `inbound-start.ts:719` calls `safety` and `invoice` "pre-provisioned-never-built values" [observed]. A consequence of D-1, not a request to reverse it.
5. Whether CLAUDE.md should name the second test-db/prod divergence (D-2), as it names `outbound_sends` DELETE.

UNKNOWNS (could not be answered from raw evidence):
- Prod: nothing on prod has ever been read. The test-db live bodies were captured (probe 3, md5s MATCH probe 1, section 6), but they have not been diffed against the 038 and 040 migration text, and whether prod equals test-db is unknown. The 050 body does not exist yet; "live body + three hunks" is a method, not a result.
- Whether the live test-db and prod bodies equal 038 and 040 exactly (v3 itself lists this as unverified, line 417). Also whether `quoco_classify_yes_no` on prod equals 030:267-318, which is its only definer in the repo; the morning half of D-3 is built on that function's behaviour.
- The names of the flow-owned context keys of the `invoice` flow, and their cleanup list in the N2 branch.
- The exact parameter list and outcome codes of `apply_material_inward_turn` (named by analogy only).
- Where exactly hunk boundaries fall once the body is written: whether setting the N13 flag belongs to hunk (1) or (2) of the proof diff (section 6), and whether the existing `v_session.context` handling needs a fourth hunk. If it does, the three-hunk rule has to be restated before the apply.
- What the media path after `inbound-start.ts:900` does for the evening case with an `invoice` session. Lines 876-900 show the morning reply; the evening branch beyond was not read.
- Whether a stored `invoice` session survives anything other than the IST-day rule and the 30-minute rule (for instance the BOT-07 reset block): not read.
- How many engineers could be mid-capture at 08:30 or 18:30 IST. There is one active engineer on prod as of 19 Sep [observed: CLAUDE.md section 0 correction]; the production usage pattern of the capture flow is unknown because it has never run.
- Which vitest cases a, b and e in the 049 package line 267 refer to; only c, d and f are named.
- Whether CI has a direct owner Postgres connection (T-A28-3 in CI) [observed: v3].
- Whether `btree_gist` is installed (v3 Q4 alternative) [observed: v3].
- Whether PostgREST passes unknown SQLSTATEs (`QE0nn`) through as `error.code`. 049's package states it is unverified [observed].
- Whether anything outside the 56 worktrees on this machine reserves 050 (probe 3 step 6 found only this branch's own file; other clones and unmerged remote branches without a local ref are not covered).
- The v3 lines left unedited (29, 44, 55, 61-66, 85, 249-268, 333-349 in the pre-consolidation numbering) say "`material_inward` session" in narrative or test text. They are covered by the single note under the v3 title (commit 3c3c9e5), which says exactly that. Whether Aravind also wants them struck is a judgement call left open.

- Whether `QE015` is free: 049 uses QE001-QE014, but no later migration was searched for another `QE` code. The proposed refusal code is unchecked against `supabase/migrations/` beyond 049 and against test-db and prod.
- Whether a bare `RAISE;` inside the `unique_violation` handler preserves the original constraint name and SQLSTATE all the way to supabase-js as `error.code`: unverified, same class as the PostgREST QE-code question.