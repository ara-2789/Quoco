# Add-engineer screen — build plan (rev5)

> PLAN ONLY. rev1 `c86c5b6` (2026-09-18 23:06 IST), rev2 `e67e297` (2026-09-18 23:41 IST), rev3 `9b9187c` (2026-09-19 00:15 IST),
> rev4 `dba9cfc` — each pinned (`git show <sha>:docs/plans/add-engineer-plan.md`). rev5 written 2026-09-19 (IST) on `feat/add-engineer-plan`,
> base `origin/main` @ `0744110` (re-fetched; unchanged). No application code, no migration file, no SQL intended to ship. Tier: FULL.
>
> **Evidence rule.** Every claim cites source printed in `~/Desktop/add-engineer-plan-rev5.txt` ("the log"). Citations are `path:line`; database claims
> cite `probe <letter>`; throwaway scripts (not in the repo, not shipping) are printed with their output. Anything not printed is **ASSUMED** or under UNKNOWNS.
> **Correction discipline.** Retracted claims stay visible as ~~strikethrough~~ with a dated correction.
>
> **Settled by Aravind, applied without re-raising:** D1 `status='active'` + attribution; D2/D5 SECURITY DEFINER function; D3 India-mobile only (TypeScript);
> D4 caps (100-char names, 50 lines); D6 role-gate intersection; D7 dry-run flag; D8 CHECK on `project_members.role` in the same migration; D9 consent
> attestation recorded, not enforced; D10 record who deactivated and when; **D11 (rev5): the CHECK mirrors `users_role_check`.**
>
> ## ⚠ BLOCKING — read §4.7 before anything else
> The partial index breaks **7 existing test files (59 tests)**, including the entire webhook suite. rev4's plan, log and report never mentioned them.
> This is a decision for Aravind (**D12**); nothing in the build slice may start until it is answered.

## Scope

**In scope:** paste → preview (dry-run) → confirm → apply for adding site engineers to ONE project; a **deactivate** control; attribution columns (`registered_by`, `registered_at`,
`consent_attested`, `deactivated_by`, `deactivated_at`); the partial unique index; the CHECK on `project_members.role`.
**Deferred, named:** file upload/extraction; reassigning an existing number; **removing** an engineer or **freeing a number** (deactivate does neither, §2.9); editing an engineer;
duplicate-name detection; reactivating from the dashboard; the ENG-01 opt-in flow; rate limiting across calls; the `<>` tenant comparison at `019:230`; role-scoping the unfiltered
membership counts (**two sites**, §4.5); the sweep and Daily Logs board not consulting `users.status` (F1, F4, §2.9).

## Dated corrections, 19 Sep 2026 (rev5) — every change in this pass

| # | Earlier text (retracted) | rev5 result | Where |
|---|---|---|---|
| 1 | ~~rev4 §4.5 item 1, §6, §7 T19, §12, D11: CHECK set `('pm','engineer')`, and "NEW CONFLICT: three test sites write `role: 'qs'`"~~ | **D11 settled.** The CHECK mirrors `users_role_check`: `('pm','qs','engineer','owner','subcontractor','admin')`. Rationale in §4.5. **No fixture is reshaped to fit this CHECK**, so the three `'qs'` fixtures are untouched and the "conflict" is gone. Verified applying cleanly (probe x2). | §4.5, §6, §7, §12 |
| 2 | ~~rev4 §7 T19: "`'owner'` is rejected"~~ | `'owner'` is now a **valid** membership role. T19 rejects case/space variants and a value outside the six. | T19 |
| 3 | ~~rev4 silent on existing fixtures~~ (plan, log and report) | **Blocking finding.** 7 files / 59 tests construct two `engineer` memberships for one user as ordinary setup (§4.7, D12). My rev4 scan counted write sites by role but never grouped them by user, so it **could not see** this; the rev5 scans group by user and by the shared fixture engineer (log). | §4.7 |
| 4 | ~~rev4 §2.9 F1: "yields a `daily_logs` write attributed to a deactivated engineer the same day"; "either stamps … or inserts"~~ | **Blast radius stated precisely** from `033`: acts only on an existing morning session; steps 2–4 only UPDATE an existing row; **only step 5 writes attendance** — an INSERT, or (rare) an `ON CONFLICT DO UPDATE` overwrite of that day's attendance fields (`033:277-282`, a nuance rev4 and the instruction both omitted). One log, one day. **Recorded as a known accepted limit** with reasoning. | §2.9 |
| 5 | ~~rev4 UNKNOWNS #5 "whether the Daily Logs view shows the swept row"~~ | **Answered from source: yes.** The board's roster is built from membership `role='engineer'` with **no `users.status` filter** (`lib/daily-logs/query.ts:159-163,226-260`). New finding **F4:** deactivated engineers stay on the board, "not checked in" every day. Named, not fixed. | §2.9 |
| 6 | ~~rev4 §4.5 item 3: one unfiltered-count site (`resolveEngineerProject`)~~ | **Two count-shaped sites:** `project-resolution.ts:37` and `033:220-222`, named together so the eventual fix covers both. Ten other unfiltered per-user reads are a different shape (scope/existence) and are listed. | §4.5 |
| 7 | ~~rev4 T4: "`pm` on P1 + `engineer` on P2 allowed"~~ (stated without consequence at T4) | Consequence now stated **at T4**: allowed by the index, but that user gets `MULTIPLE_MEMBERSHIPS_REPLY` on WhatsApp. **Allowed is not works.** | T4 |
| 8 | ~~rev4 §4.5 item 1 evidence "write-site scan: 24 `pm`, 20 `engineer`"~~ | Whole-suite scan: 55 parsed write sites — 28 `pm`, 24 `engineer`, 3 `qs` (+21 unparsed, read by hand). | §4.5 |
| 9 | (new) | Added: **D12**; F4; strings for R7a already in rev4 (no new wording this pass); T22 acceptance for the affected files; §11 prod verification for the wider CHECK. | throughout |

## Dated corrections, 19 Sep 2026 (rev4) — kept

| # | Earlier text (retracted) | rev4 result |
|---|---|---|
| 1 | ~~rev3 heading "Dated corrections, 18 Sep 2026 (rev3)"~~ | Wrong date: rev3's log starts `Sat Sep 19 00:01:34 IST 2026`, commit `2026-09-19 00:15:46 +0530`; 18 Sep only in UTC. Corrected. |
| 2 | ~~rev3 §3.6 "India-only in SQL rejected because DB fixtures are `+1…`"~~ | Reason retracted: test-fixture shape must never decide a production constraint (six sites set fixture `users.role='pm'` while real PMs are `admin`); decision stands, recorded as an ACCEPTED LIMIT (§3.6). |
| 3 | ~~rev3 D8 "open"~~ | Settled (CHECK); RLS insert policy places no restriction on the inserted row's `role` (§4.5). *(The set was widened in rev5 #1.)* |
| 4 | ~~rev3 D9 "open"; "the action refuses if attestation absent"; three-parameter signature~~ | Record, do not enforce: `consent_attested`, fourth parameter (§2.1). |
| 5 | ~~rev3 D10 "not added"~~ | `deactivated_by`, `deactivated_at`. |
| 6 | ~~rev3 T12 "the repo already uses `it.fails`"~~ | **Wrong**: no executable `it.fails` in `test/`; hits are comments. Behaviour **verified by running it** on vitest 3.2.7 (scratch dir; re-run in the rev5 log). |
| 7 | ~~rev3 "session cleanup not traced"~~ | Traced: F1, F2, F3. |
| 8 | ~~rev3 `pg_temp` unresolved~~ | All 15 existing definer functions: `search_path=public`; new ones follow. |
| 9 | ~~rev3 §7.3 "no cron runs against real Twilio (ASSUMED)"~~ | Shown/not-shown breakdown; literal `+919176861156` supplied (§7.3). |
| 10 | ~~rev3 R7 "same-tenant no membership → generic"~~ | Own status `registered_no_project` (in-tenant only). |
| 11 | ~~rev3 §7.2 all matrix rows equally real~~ | Rows 3–8 are fixture-only shapes (no `users.role='pm'` in test-db, probe t). |
| 12–14 | ~~rev3 §6 CHECK "optional"; §3 digit strings in prose~~; new items | CHECK definite; digit strings removed; residual-risk statement (§4.6); T19–T21. |

## Dated corrections, ~~18 Sep 2026~~ **19 Sep 2026** (rev3) — kept (date corrected in rev4)

| # | rev2 said (retracted) | rev3 result |
|---|---|---|
| 1 | ~~§9 "`// Tamil owed, NOT approved`" citing `lib/photos/copy.ts:13-20`~~ | Mis-citation: that comment marks *approved English awaiting Tamil* (`copy.ts:3-6`). Unapproved wording uses `// Wording owed, NOT approved` (exists nowhere yet, grep s2). |
| 2 | ~~§2.3 step 1 explicit NULL-tenant refusal; T1 fixture a NULL-role stub~~ | One null-safe comparison; T1 fixture `role='admin'`, `tenant_id` NULL (the stub could never have gone red). |
| 3–6 | ~~§1 `isProjectPm` unused; §1/§2.3 rule wording; India-shape re-assert; `whatsapp:` accepted~~ | Advisory TS gate reusing `isProjectPm`; D6 intersection; India rule in TypeScript only; `whatsapp:` rejected by V1. |
| 7–14 | rev2 rejected list; fixture claim; §9 plain constants; UNKNOWN #1; §6 scope; §12 file list; new dry-run/deactivate/attribution/validator/strings/tests | `git show 9b9187c:docs/plans/add-engineer-plan.md`. |

## Dated corrections, 18 Sep 2026 (rev2) — kept (dates verified correct)

| # | rev1 said (retracted) | rev2 result |
|---|---|---|
| 1–12 | ~~§1 "tighter than the policy"; §0 service-client claim; §2 two-client design; §3 "prod unread"; §4 quoted labels; R6 "index enforces"; §5 partial apply; §6 "048 reserved, 049 next"; §7 T8/T10; §8 residual; §9 three per-row strings; §12 `classify.ts`~~ | Gate in the function; no service client; one transaction; drafted wording removed; R6 a lookup; all-or-nothing; 048 is free ("RELEASED, NEVER USED … 048 is free"); folded into `ERROR_BATCH_NOT_APPLIED`. `git show e67e297:docs/plans/add-engineer-plan.md`. |

## 0. Findings that shape the plan — read first

1. **`status='active'` (D1) departs from ENG-01** (`docs/bot-flows.md:303-308`). Nothing implements that flow (greps g1–g3; c1/c3: none of `registered_by`, `registered_at`, `consent_attest*`, `deactivated_by`, `deactivated_at` exists in
   `app lib supabase scripts test types`; probe s: none on any table). A non-`active` user is dropped by the webhook (`reactivation.ts:29-33`) and every roster.
2. **The partial index cannot fire from this screen's own inserts** — every pasted row is a new `users.id`. T3 inserts directly.
3. **`users.status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`); the gate is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users`**: no INSERT (probe k, `015:114`), UPDATE only on `full_name, avatar_url` (`015:105`), only UPDATE policy is own-row (probe j). Add and deactivate both need definer functions; no service client (g4).
5. **Phone chain: no mismatch, but no validator exists** (§3).
6. **Migration number 048** is free (`origin/main` migrations end at 047; reservations end at 048, "RELEASED, NEVER USED … 048 is free").
7. **Deactivation propagates through `users.status`** (§2.9); findings F1, F2, F3, F4.
8. **A test/production shape gap decides real bugs here** (§3.6): six test sites `update({ role: 'pm' })` on a fixture profile while real PMs are `admin`.
9. ~~Conflict with D8's set: three test sites write `role: 'qs'`~~ — **resolved by D11 (rev5 #1).**
10. **NEW, BLOCKING — the partial index breaks 7 existing test files / 59 tests** (§4.7, D12).
11. **NEW — the Daily Logs board keeps listing deactivated engineers** (F4, §2.9).

## 1. Authorisation

**The rule (D6).** With the caller resolved as the `users` row where `auth_id = auth.uid()`: `users.role IN ('admin','pm')` **AND** the project exists **in the caller's tenant** **AND**
(`users.role = 'admin'` **OR** a `project_members` row with `role = 'pm'` for this `(user, project)`). Identical outcomes to rev3's "admin, or pm + membership" (T6 matrix). It is the intersection of the DB policy's role list
(`project_members_insert`, probe j) and per-project membership; `qs`/`engineer`/NULL-role users never pass, even with a `pm` membership.

**Where each role column is written.** `users.role='admin'` for a self-serve account: `005:76-80`, `016:177-181`. `project_members.role='pm'` for a project's creator: `app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM is
`users.role='admin'` + `project_members.role='pm'`. grep g8: nothing writes `users.role='pm'` outside tests; probe t: test-db has 10 admins, 3 NULL-role stubs, 1,872 engineers, **no `pm` user**.

**Two implementations, one authority.** SQL (authoritative): the internal helper (§2.7). TypeScript (advisory only): pure `decideEngineerAdminAccess`, reusing `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`). If they disagree, SQL wins; T6 catches drift.

## 2. The add function — SECURITY DEFINER (`add_engineers_to_project`)

### 2.1 Contract (signature and behaviour; no body is written here)
`(p_project_id uuid, p_engineers jsonb, p_dry_run boolean, p_consent_attested boolean) → jsonb`. No parameter defaults (`CLAUDE.md:361-372`). `p_engineers` is an array of `{ name, whatsapp_number }`, the number **already validated and normalised by TypeScript** (§3);
the function asserts only the generic stored shape (§3.6). In dry-run, `p_consent_attested` is ignored; in apply it is recorded as `coalesce(p_consent_attested, false)`.

Return `{ applied: boolean, rows: [ { idx, status, … } ] }`. Status values are machine identifiers, not wording. **Allowed fields per status — the whole payload:**
| status | fields | note |
|---|---|---|
| `ok` (dry-run: would be added) | `idx, status` | |
| `added` (apply) | `idx, status, user_id` | |
| `already_on_this_project` | `idx, status` | no name, no id |
| `on_another_project` | `idx, status, other_project_name` | **the caller's own tenant only** |
| `registered_no_project` | `idx, status` | **same-tenant engineer with no membership only** |
| `number_registered` | `idx, status` — **exactly these two keys** | generic; never a project id, project name, or full name |

### 2.2 The dry-run flag (D7)
`p_dry_run = true`: authorisation, tenant binding, argument validation and **full classification**; returns the payload apply would; **writes nothing**. **Why it exists, plainly:** without it a cross-tenant collision is invisible at preview (a preview under RLS reads
only its own tenant's `users`, probe j `users_select`) and **aborts the whole all-or-nothing batch at apply**; with it, preview and apply run the *same code path* and the collision is caught at preview, generically.
1. **Authorisation runs BEFORE any number lookup, in both modes** (§2.3 steps 1–3 precede step 5): an unauthorised caller learns nothing about which numbers exist.
2. **Cross-tenant collisions are `number_registered`**: payload exactly `{idx, status}` — no project id, name, or full name (T5 asserts on the payload's key set).
3. **Apply re-runs every check** in its own transaction and never trusts the preview's verdicts. 4. Dry-run performs no writes (T7).

### 2.3 Order of operations (one transaction)
1. **Resolve the caller:** `users` where `auth_id = auth.uid()` (`019:170-171`; probe p). None → `insufficient_privilege` (`019:172-175`). `auth.uid()` is never compared to `users.id` (`007:127`, `007:60-67`, `007:76-78`); engineers/owners have `auth_id` NULL (`CLAUDE.md:833-840`).
2. **Load the project; tenant-bind NULL-safe.** Missing, **or** `project.tenant_id IS DISTINCT FROM caller.tenant_id` → `no_data_found`, one indistinguishable error (`019:219-222`). `projects.tenant_id` is NOT NULL (`001:55`). **This single comparison is the only tenant-binding mechanism** (T1).
3. **Role/authority gate (§1)**, else `insufficient_privilege`.
4. **Validate the argument:** 1..50 rows (`program_limit_exceeded`, `019:208-212`); non-empty `name` ≤ 100; generic-shape `whatsapp_number`; duplicate numbers → `invalid_parameter_value` (caller bugs).
5. **Classify every row** (R5–R7, §4). 6. If `p_dry_run`, or **any** row is not `ok` → write nothing, return `applied: false`.
7. Otherwise insert per row (§2.6). Any exception rolls back everything; a concurrent add of the same number loses on `UNIQUE (whatsapp_number)` (`001:44`, probe h; `23505`).
**The NULL trap in the precedent (deferred):** `019:230` is `IF v_tenant_id <> get_user_tenant_id()`; a NULL tenant makes it NULL and the guard passes (masked by `019:224-229`). The new function does not copy it.

### 2.4 `tenant_id` is derived from the project row, never a parameter
(a) A parameter is caller-controlled; a missed validation writes a user into the wrong tenant. (b) The function bypasses RLS; the composite FKs (`017:94-106`, probe h) validate the *membership* but not the `users.tenant_id` *value*. (c) It removes a class of test cases.

### 2.5 Ownership and grants
Precedent printed in full: `019:149-297` (`SECURITY DEFINER SET search_path = public` `:156`; `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` `:294-295`). Live (probe n): all 15 definer functions owned by `postgres`; `correct_daily_log` still holds `service_role:EXECUTE`
(hence `CLAUDE.md:910-918`). Tables owned by `postgres`, RLS on, **not forced** (probe o): an owner-run function bypasses RLS.

### 2.6 Columns written (explicit wherever a default or NULL would hide a bug)
**`users` row** (probes r, l):
| column | value | source |
|---|---|---|
| `id` | DB default, via `RETURNING` | `007:127` |
| `tenant_id` | the **project row's** tenant — explicit | §2.4 |
| `role` | `'engineer'` — explicit | `users_role_check`, probe h |
| `status` | `'active'` — explicit (D1) | probe d |
| `full_name` | trimmed `name` | argument |
| `whatsapp_number` | already-normalised number | argument |
| `messaging_blocked` | `false` — explicit | probe l |
| `auth_id` | `NULL` — explicit | `CLAUDE.md:833-840` |
| **`registered_by`** | the **resolved caller's `users.id`** — never `auth.uid()`, never a parameter | new (§2.8) |
| **`registered_at`** | `now()` in the function | new |
| **`consent_attested`** | `coalesce(p_consent_attested, false)` — recorded, not enforced (D9) | new; the **claim as passed** |
| not set | `avatar_url, hierarchy_level, reporting_manager_id, delegation_active, employee_id, notification_email, notification_email_verified_at, whatsapp_declined_at, deactivated_by, deactivated_at` | nullable |

**`project_members` row:** `id`/`created_at` defaults; `tenant_id` = derived tenant; `project_id` = `p_project_id`; `user_id` = the new id; `role` = literal `'engineer'` (exact string — now constrained, §4.5).

### 2.7 Shared internal helper; search_path; grants
Steps 1–3 live in one **internal helper** returning `(caller id, caller tenant)` or raising; both public functions call it. Not callable from outside: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`. Public functions: `REVOKE EXECUTE … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`.
**`search_path`:** all **15** existing definer functions have `config = {search_path=public}` and nothing else (probe n; `019:156`, `012:85-87`, `033:170-171`; the 71-line `SECURITY DEFINER` grep is in the log). **The new functions follow exactly that: `SET search_path = public`, no `pg_temp`, every object
schema-qualified, no dynamic SQL.** I did not evaluate whether the house style is itself best. **Alternative:** duplicate steps 1–3 inline (no helper ACL, but two copies that can drift).

### 2.8 Attribution — `registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at`
**Confirmed absent** (grep c1/c3; probe s; probe r: `users` has no actor column; `project_members` has only `created_at, id, project_id, role, tenant_id, user_id`). **Cannot be reconstructed later:** after apply nothing on either row records who created or deactivated it; the only other trace is request logging outside the database, which this repo does not read.
**D9 — recorded, not enforced:** a direct caller can pass any value, so a refusal buys nothing, while the recorded claim plus `registered_by`/`registered_at` answers "who confirmed this, and when". It records **the caller's claim**, not proof of consent. The screen's apply control is disabled until ticked (UI only).
**D10:** `deactivate_engineer` writes `deactivated_by` and `deactivated_at` in the same UPDATE as `status='deactivated'`. **Limit:** one slot per row; no history.
**Design (recommended, reviewer-flagged):** five nullable columns; pairing CHECKs `(registered_by IS NULL) = (registered_at IS NULL) AND (registered_by IS NULL) = (consent_attested IS NULL)` and `(deactivated_by IS NULL) = (deactivated_at IS NULL)` (precedent `036…:232-244`); composite same-tenant FKs to
`users (id, tenant_id)` (`017:94-106`; `users_id_tenant_id_key`, probe h); default `ON DELETE` (**ASSUMED**). Departure from ENG-06 (`bot-flows.md:308`, an audit row): columns on the user row.

### 2.9 Deactivate — the SECOND SECURITY DEFINER function (`deactivate_engineer`)
**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb` `{ status: 'deactivated' | 'already_deactivated' }`. Same helper, gate, tenant binding and grants. Target: `users u JOIN project_members pm` with `u.id = p_user_id`, `u.role='engineer'`, `u.tenant_id` = derived tenant, `pm.project_id = p_project_id`, `pm.role='engineer'`;
**not found → `no_data_found`**. One UPDATE: `status='deactivated'`, `deactivated_by`, `deactivated_at`; already deactivated → no write, no overwrite. `'deactivated'` is permitted by `users_status_check` (probe h). **Does NOT:** delete; touch `whatsapp_number`, `messaging_blocked`, `project_members`, or `whatsapp_sessions`; send; reactivate; use dynamic SQL.
**KNOWN LIMIT — the number stays held** (`UNIQUE (whatsapp_number)`, `001:44`, probe h; the membership keeps the partial-index slot). **A mistyped number cannot be corrected from the dashboard; the only repair is manual SQL.**

**Deactivation takes effect with no further change — printed source.** Webhook: `decideInboundGate` returns `gated_noop` for `status !== 'active'` (`reactivation.ts:29-33`), header forbids silent reactivation (`:11-14`), clear-half re-asserts `status='active'` (`:64`); `route.ts:159`, `twimlEmpty()` at `:161-163`. Outbound: `fetchActiveEngineers` filters
`.eq('users.status','active')` (`roster.ts:168`), used by both exported rosters (`:203`, `:248`; private at `:150`). Also filtering: `checkin-escalations/roster.ts:65`, `dpr-generate/route.ts:80`, `accountability.ts:159`, `dpr/dispatch.ts:417-418`. Why `status`, not `messaging_blocked`: the flag would make the gate return `reactivate` (`:36-38`).

### Session trace — findings, named, not fixed
- **Inbound from a deactivated engineer:** `route.ts:159-163` returns `twimlEmpty()` before idempotency, project resolution and any session call.
- **F1 — the morning sweep never reads `users` — RECORDED, NOT FIXED, ACCEPTED LIMIT.** Verified from `033`: `sweep_stale_morning_sessions` loops `SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning'` (`033:198-200`); the printed function body reads only `whatsapp_sessions`, `project_members` and `daily_logs` — grep `u1`: zero non-comment lines mention `users`; `u2`: the only FROM/UPDATE/INSERT targets.
  **Blast radius, precisely.** (1) It acts **only on an existing session** with `current_flow='morning'`; a deactivated engineer receives **no new morning trigger** (`fetchActiveEngineers` filters `status='active'`, `roster.ts:168`), so only a session already in flight at the moment of deactivation is exposed. (2) Only an engineer with **exactly one** membership is processed (`033:220-233`).
  (3) Steps 2–4 only **UPDATE `morning_submitted_at` on a row that already exists** (`033:235-245`). (4) **Only step 5 writes attendance** (`033:265-283`): an INSERT of `attendance='absent'`, `attendance_defaulted=true`, or — nuance — if a row already exists for that `(project, engineer, log_date)`, an `ON CONFLICT … DO UPDATE` that overwrites its attendance fields
  (`033:277-282`; the header says this covers "the rare case evening already wrote a row", `033:65-67`). (5) The session is then closed (`current_flow := NULL`, `033:306-316`), so it cannot repeat. **Exposure: one phantom log (or one overwritten attendance) on one day, for an engineer deactivated while parked at step 5.**
  **Why not fixed:** fixing it means a new migration **replacing a shipped, externally-reviewed SECURITY DEFINER function** (`033:113-114` records "external review round 1, B1 — BLOCKING"; grants `033:333-334`), which trips review-gate (a) (`CLAUDE.md:192-205`) — a full package and rehearsal — out of proportion to one phantom row on one day. **Accepted.**
  **Would the PM's Daily Logs view show that row? Yes** — traced (F4 below).
- **F2 — evening and hindrance sessions are parked indefinitely.** The sweep covers `'morning'` only (`033:199`); `expires_at` is written and read by nothing (grep s3; `033:32-34` calls it dead); nothing deletes session rows (grep s4); the only reset is BOT-07's next-day wipe inside `acquire_and_transition_session` (`012:115-121`), reachable only by an inbound past the gate or a cron send — neither can happen for a deactivated engineer.
- **F3 — the engineer with no membership.** Cannot be deactivated from the dashboard (the function needs an engineer-role membership; the list is membership-based, `projects/[id]/page.tsx:49-65`), so **the admin sees nothing to click**. If `active`, that engineer texts in, passes the gate, and gets `ZERO_MEMBERSHIPS_REPLY` (`route.ts:244-247`, `project-resolution.ts:71-72`: ask your Project Manager to add you)
  — but the PM cannot add them (R7a) or deactivate them: a dead end until the reassign slice or manual SQL. Test-db holds **1,870** such engineers (probe z; fixtures); prod unread (§11 `w`). rev4 added R7a and `REJECT_REGISTERED_NO_PROJECT`; the dead end is not fixed.
- **F4 (new, rev5) — the Daily Logs board keeps listing deactivated engineers.** `getDailyLogsBoard` builds its roster from `project_members` filtered on membership `role = 'engineer'` (`lib/daily-logs/query.ts:159-163`) and never on `users.status`; logs merge by `(project, engineer)` (`:180-181,229`). Consequences: (a) the swept F1 row **is displayed** on that engineer's card; (b) a deactivated
  engineer stays on the board and reads "not checked in" every day. Deferred: the fix is in `lib/daily-logs/`, which this slice may not touch. **Observed:** *engineer* — silence; *PM* — a deactivated marker in the new list, but the board still shows them; escalation, DPR roster and accountability skip them (`checkin-escalations/roster.ts:65`, `dpr-generate/route.ts:80`, `accountability.ts:159`).

## 3. Phone numbers and the validator

### 3.1 The chain
`route.ts:111`: `fromNumber = normalisePhoneNumber(params.From ?? '')`; `route.ts:130-133` looks up `.eq('whatsapp_number', fromNumber)`. Inbound form: `+` + digits, no `whatsapp:` prefix, no separators (`normalise.ts:13-15,18,21-23`); downstream passes it through verbatim (`dispatch.ts:180,199,217`; `inbound-start.ts:463,852`; `session.ts:58,91`). **No mismatch with the
prod stored form** (`+` + 12 digits) provided the screen stores `normalisePhoneNumber(raw)` output only. That real Twilio sends `whatsapp:` + E.164 rests on a comment (`normalise.ts:4`) and fixtures (`test/webhook.test.ts:263`).

### 3.2 Status of the validator — the consequence, stated explicitly
`normalise.ts` **never rejects anything** (`normalise.ts:40-42`), and **no validator exists anywhere in the repo** (the phone `git grep`; the one schema CHECK is `outbound_sends_to_phone_number_check`, `031:478-479`, probe q). `links.ts:10-11` and `reactivate-copy.ts:48-52` say the guarantee "lives upstream at the write paths"; grep g5: no engineer write path exists, so this screen is the first.
**Consequence:** without a validator, a mistyped line stores a well-formed-looking row that can never match an inbound message (the webhook compares the *normalised inbound* number, `route.ts:133`) and **permanently holds that value under the global unique** (`001:44`), with no removal path in this slice (§2.9). The executed probe shows what `normalisePhoneNumber` alone would have stored for
the rejected classes: letters gain a `+`, the empty string becomes `"+"`, a too-short value gains one, trailing text is kept, a `00`-prefixed form keeps its zeros.

### 3.3 Validation happens BEFORE normalisation — the exact rule
On each raw pasted token: **V1 charset** — only ASCII digits, `+`, whitespace, `-`, `(`, `)` (`normalise.ts:18`'s separators); anything else rejects. **V2** remove whitespace, `-`, `(`, `)` → `t`. **V3** `t` must match exactly one of `S1 ^\+91[6-9][0-9]{9}$`, `S2 ^91[6-9][0-9]{9}$`, `S3 ^0[6-9][0-9]{9}$`, `S4 ^[6-9][0-9]{9}$`.
Then call `normalisePhoneNumber(raw)` and **assert** the result matches the single stored form **`^\+91[6-9][0-9]{9}$`** (13 characters) and is a fixed point. **Reuse, not reimplementation:** import `lib/whatsapp/normalise.ts:9`; never edit or copy it.
**Evidence (throwaway probe, re-run in this log):** 34 inputs (14 accepted, 20 rejected), **0 violations**.

### 3.4 On failure the preview shows the row exactly as pasted and `REJECT_BAD_NUMBER`; nothing is written; other rows still preview.
### 3.5 Line format (D4): one engineer per line; number = trailing run of digits, `+`, spaces, hyphens, parentheses; name = the rest, trimmed. Blank lines ignored. Name ≤ 100 characters; paste ≤ 50 lines.

### 3.6 The function's shape check is generic — ACCEPTED LIMIT, with the corrected reason
The function asserts `^\+[1-9][0-9]{1,14}$`, the shape of `outbound_sends_to_phone_number_check` (`031:478-479`, probe q). The India-only rule lives **in TypeScript only**.
~~**Struck reason (rev3):** "India-only in SQL is rejected because every DB fixture is `+1…`, so it would make every DB test impossible."~~ **Retracted 19 Sep 2026.** Test-fixture shape must never decide a production constraint: six test sites set a fixture profile's `users.role` to `'pm'` (`test/migration-019.test.ts:123,222`,
`daily-log-detail-query.test.ts:69`, `dpr-detail.test.ts:97`, `migration-023.test.ts:121`, `daily-log-correction-rpc.test.ts:87`) while a real PM's `users.role` is `'admin'` on prod (`is-project-pm.ts:11-16`, `016:177-181`) — the gate passed on fixtures and failed a real PM on 2026-09-17.
**Replacement reason (ACCEPTED LIMIT):** (1) **the screen is the only intended caller** (no code calls the function yet; a direct caller must be an authenticated tenant admin/PM, bounded by the 50-row cap); (2) **the residual risk is a stored row that never matches an inbound message, which is recoverable** (manual SQL); (3) **minting Indian test numbers is unsafe**: every `+91[6-9]…` value is a routable live handset.
**Stated plainly:** an authorised caller bypassing the screen can store any well-formed E.164 number. **Accepted, not closed.**

## 4. Rejection cases — which are reachable where
Preview = TypeScript parse (R1–R4) then the function with `p_dry_run = true` (R5–R7). Apply = parse again, then `p_dry_run = false`, re-running R5–R7.
| # | Reason | Detected by | Preview? | Apply? | Shown by |
|---|---|---|---|---|---|
| R1 | Empty name | TypeScript | yes | re-run | `REJECT_NO_NAME` |
| R2 | Name over 100 | TypeScript | yes | re-run | `formatRejectNameTooLong` |
| R3 | Bad number (§3.3) | TypeScript | yes | re-run | `REJECT_BAD_NUMBER` |
| R4 | Same number twice in the paste | TypeScript | yes | re-run | `REJECT_DUPLICATE_IN_PASTE` |
| R5 | Engineer already on **this** project | `already_on_this_project` | yes | yes | `REJECT_ALREADY_ON_THIS_PROJECT` |
| R6 | Engineer on **another project in the caller's tenant** | `on_another_project` + name | **yes** | yes | `formatRejectOnAnotherProject` |
| R7a | **Same-tenant engineer with no membership** | `registered_no_project` | yes | yes | `REJECT_REGISTERED_NO_PROJECT` |
| R7 | Any other existing number: **another tenant**, or same tenant but not an engineer | `number_registered`; `001:44` | yes (dry-run) | yes | `REJECT_NUMBER_REGISTERED` |
| R8 | Concurrent add between steps 5 and 7 | `23505`, rollback | **no** | **yes**, whole batch | `ERROR_BATCH_NOT_APPLIED` |

**Reachable at preview:** R1–R7. **Only at apply:** R8. **R6 is never an insert failure** (every pasted row is a new `users.id`); it is a lookup result, in-tenant only. Whole-request refusals: unauthenticated (redirect); `no_data_found` → `ERROR_PROJECT_NOT_FOUND`; `insufficient_privilege` → `ERROR_NOT_ALLOWED`; empty → `ERROR_PASTE_EMPTY`; over the cap → `formatErrorPasteTooLong`.
**Number-existence oracle, bounded not closed:** authorisation first, generic payload, 50 rows per call; **no rate limit across calls** (UNKNOWNS).

### 4.5 Findings, decisions and deferred items
1. **`project_members.role` CHECK — D8 settled; D11 settled (rev5): the CHECK mirrors `users_role_check`.**
   **Underlying finding.** The RLS insert policy places **no restriction on the `role` value of the row being inserted.** Live (probe j): `with_check = ((tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE users.auth_id = auth.uid()) = ANY (ARRAY['pm','admin'])))` — the `users.role` it tests is the **caller's**, not the new row's. Probe k: `authenticated` holds INSERT.
   Probe h: no CHECK on `project_members.role`. **So any tenant admin or pm can write an arbitrary role string today**, and `'Engineer'`, `'engineer '` or `'ENGINEER'` would **silently escape the partial index** (predicate `role = 'engineer'`). (Shown from catalog and grants; I ran no write.)
   **Allowed set: `('pm','qs','engineer','owner','subcontractor','admin')`** — exactly the live `users_role_check` (probe h: `CHECK ((role = ANY (ARRAY['pm','qs','engineer','owner','subcontractor','admin'])))`).
   **Rationale (Aravind, recorded):** the CHECK exists to stop `'Engineer'` and typo variants escaping the partial index, **not to redefine which roles may hold a project membership**. Narrowing that set is a separate product decision. **No test fixture is reshaped to fit a constraint** — that is the pattern that let the correction-gate bug hide behind `users.role='pm'` fixtures (§3.6).
   **Applies cleanly (probe x2, test-db):** 0 rows outside the six-role set, 0 case/space variants, of 2 rows total — weak evidence on its own; the three `role: 'qs'` fixture sites (`test/dash-03-board-photo-gate.test.ts:69-70`, `test/photo-access-route.test.ts:147-148`, `test/photo-access-boundary-agreement.test.ts:137`) now sit inside the set.
   Evidence for the roles in use: whole-suite scan (log): 55 parsed write sites — 28 `pm`, 24 `engineer`, 3 `qs`; `app`, `lib`, `scripts` write only `pm` and `engineer`. Aravind reports prod holds `pm` and `engineer` only (not in this log): §11 has the prod verification. `docs/schema.md:127-130` becomes stale (`role TEXT NOT NULL`; "One active project per engineer — enforced at insert in app logic, NOT a DB constraint").
2. **Deferred — the `<>` tenant comparison at `019:230`.** Changes the logic of a live SECURITY DEFINER function (review-gate (a), `CLAUDE.md:192-205`); needs its own migration, package and rehearsal; masked today by `019:237-243` (`019:224-229`).
3. **Deferred — the unfiltered membership count: TWO count-shaped sites, named together so the eventual fix covers both.** Both count or pick a user's `project_members` rows with **no role filter** to decide "the engineer's one project":
   **(a) `lib/whatsapp/project-resolution.ts:37`** — `supabase.from('project_members').select('project_id').eq('user_id', userId)`, then 0 / 1 / 2+ (`:39-63`). **(b) `supabase/migrations/033_sweep_stale_morning_sessions.sql:220-222`** — `SELECT count(*), (array_agg(project_id))[1] … FROM project_members WHERE user_id = v_row.user_id`, then `IF v_project_count != 1` (`:224-233`).
   Scoping (a) changes bot behaviour in `lib/whatsapp/` (barred to this slice); scoping (b) is a new migration replacing a shipped function (F1). **Neither is fixed here.** A throwaway scan (`scan_unfiltered.py`, **not in the repo**; printed with its output in the log) also found **ten other** unfiltered per-user reads that are a *different shape* (PM project-scope or single-membership existence lookups, not counts):
   `app/(dashboard)/dprs/page.tsx:32`, `app/(dashboard)/projects/page.tsx:35`, `lib/daily-logs/query.ts:142,384,558`, `lib/dpr/dispatch.ts:411`, `019:133`, `019:238`, `023:175`, `040:353`. Listed so the fix decides about them deliberately.
4. **Prod phone-format evidence is a single row.** Reported by Aravind (not in this log): `+` + 12 digits, prefix `+91`, **n=1 — the whole population observed**, consistent with `normalisePhoneNumber`'s output for an Indian mobile. One row cannot show any other stored value shares that form. Test-db holds no `+91` (probe g). §11 `g`, `r`.

### 4.6 Residual risk — known and accepted, NOT closed
**The validator catches malformed numbers, not wrong ones.** A correctly formatted number with one digit wrong is **a stranger's live handset**; that person will receive a check-in from the production sender with **no opt-in**, at the next scheduled send (`vercel.json:12-19`; `roster.ts:165-168`, `checkpoint-trigger.ts:226-233`). The confirm step (§5), the attestation (§2.8) and deactivate (§2.9) are
**mitigations, not a solution**; deactivation does not free the number. **A known and accepted risk, not a closed one.**

### 4.7 BLOCKING — existing fixtures the partial index would break (D12, open)
**What I found.** Ordinary test setup, in **7 files**, builds the exact state the index forbids: one user with two `role='engineer'` memberships. Two were named by Aravind; **five more** were found by a whole-suite sweep (log: `scan_two_eng`, `scan_loops`, `scan_shared_eng`, `scan_callers`). Each affected setup call throws (a `beforeAll` failure takes down its whole file), except one that fails silently.
**Why the second membership exists (root cause, most files).** `ensureMorningFixtures()` upserts the **shared morning engineer** (`testEngineerId()`, `test/helpers/db.ts:193-198,445`) as an `engineer` member of `TEST_PROJECT_ID` (`db.ts:490-498`); files then add that **same engineer** to a fresh per-test project for isolation. The fixture enrols the engineer twice by construction.

| # | File : lines | Setup that trips the index | Tests hit | Failure mode |
|---|---|---|---|---|
| 1 | `test/unit/project-resolution.test.ts:77-81` (`userMany` on `projectA` + `projectB`, one bulk insert) | 2 × `engineer` for `userMany` | **7 of 7** (`beforeAll` throws at `:82`) | loud, whole file |
| 2 | `test/unit/morning-cutoff-sweep.test.ts:516-517` (`PROJECT_ID`, `PROJECT_ID_2`) | 2 × `engineer` for one user; **two separate `upsert`s whose `error` is never read** | **1 of 15** (`:507-543`; the file's own header says 13, `:9-11`, stale — counted 15 `it(`), the only test of the sweep's skip path (`:24-27`) | **SILENT**: the second upsert fails unseen; the test then fails at `:522-528` for the wrong reason |
| 3 | `test/webhook.test.ts:239-246` (`multiUserId` on `TEST_PROJECT_ID` via `ensureGateUser` `:181-185` + `secondProjectId`) | 2 × `engineer` | **16 of 16** (`beforeAll` throws at `:246`) — **including T-WH-01 (forged signature)**, a test `CLAUDE.md:1002-1006` requires for any webhook change | loud, whole file |
| 4 | `test/dpr-generate-job.test.ts:72-76`; calls `:112,206,297,328,378` | shared engineer on a fresh project | **5 of 7** | loud, per test (`:75`) |
| 5 | `test/dpr-generate-trigger.test.ts:40-44`; calls `:136,155,175,197` (`:137,176` use a distinct second engineer — fine) | shared engineer on a fresh project | **4 of 6** | loud, per test (`:43`) |
| 6 | `test/dpr-stage1-plumbing.test.ts:27-31`; calls `:54,71,95,127,153,212` | shared engineer on a fresh project | **6 of 9** | loud, per test (`:30`) |
| 7 | `test/owner-deliver-job.test.ts:121-127`; 20 calls from `:430` to `:1046` (`:642,679` add a distinct `extraEngineerId` — fine) | shared engineer on a fresh project | **20 of 21** | loud, per test (`:126`) |
Total **59 tests in 7 files.** Persistent test-db data is not the problem (probes a, e: 0 rows); these are transient fixtures. **Not affected** (checked): `checkin-escalations-sweep` and the sweep's loop at `:144` (distinct users, one project); `rehearse-038.ts:355` (one pair); tests using `TEST_PROJECT_A_ID` (distinct users).
**What each proves today, and does that survive "mixed roles" (one `pm`, one `engineer` — allowed by the index, still counted by the unfiltered counts, §4.5 item 3):**
- **#1 project-resolution:** proves `resolveEngineerProject` returns `multiple_memberships` with the real count (`:102-105`) plus the zero/one cases and copy mapping. **Survives** — the count ignores role (`project-resolution.ts:37`). *Coupling cost:* the fixture would pin the current **unfiltered** behaviour; the deferred role-scoping fix would flip that user to `resolved` and break the test.
- **#2 sweep skip path:** proves `033:220-233` skips, writes nothing in either project, leaves the session untouched (`:507-543`). **Survives** — the sweep count ignores role (`033:220-222`); same coupling cost for the deferred fix. The unchecked `upsert` `error` needs fixing under any option.
- **#3 webhook:** T-WH-16 proves the end-to-end multiple-memberships reply, SID consumed, no session (`:331-342`). The other 15 tests need the file to load. **T-WH-16 survives** (same unfiltered count via `route.ts:244-247`); **the file's beforeAll is the blast radius.**
- **#4–#7 (35 call sites) are not multiplicity tests at all** — the second membership is *incidental*, for per-test project isolation. Mixed roles **would make the shared engineer a `pm` member** of that project, so `resolveProjectManagerName` (`lib/dpr/project-manager.ts:31-36`, selects `role = 'pm'`) would return that engineer. Rosters key on `users.role`, not membership role (`roster.ts:168`,
  `dpr-generate/route.ts:79-80`, `accountability.ts:158-159`), and `dpr/dispatch.ts:410-415` has no role filter, so roster/enqueue/DPR-content assertions are likely unaffected — **but I did not trace every path the 35 tests exercise (UNKNOWNS)**. **One test provably does not survive:** `dpr-stage1-plumbing.test.ts:207-217` ("does not pick up a non-PM member") needs the engineer membership to stay `engineer`; the other PM-related lines are in that file's own PM block (`:176-240`).
**Options — a decision for Aravind (not chosen here):**
| | Option | What it changes | Cost / risk |
|---|---|---|---|
| **A** | **Mixed roles** for the multiplicity fixtures (#1, #2, #3): second membership becomes `pm` (or another non-`engineer` role the CHECK allows) | 3 fixture edits (+ the unchecked-`upsert` fix in #2) | Small. Coverage survives (above). Pins unfiltered counting → the later role-scoping fix must update these three tests. The state under test changes from an *unreachable-after-index* one (2 × engineer) to the *reachable* one (engineer + other). |
| **B** | **A distinct engineer per project** for the incidental sites (#4–#7): give each per-test project its own fresh `users` row instead of `testEngineerId()` | the 4 local helpers, plus every assertion that names the shared engineer | Larger. Keeps membership roles truthful (the shared engineer stays `engineer`, the stage1 non-PM test stays valid) but rewrites identity assertions — e.g. `dpr-generate-trigger.test.ts:104,145,156,177` assert `testEngineerId()`, and the job/DPR tests key `daily_logs`/`dprs` on `engineerId`. |
| **C** | **A + B together** (mixed roles only where the test *is* about multiplicity; distinct engineers where it is incidental) | all 7 files | Combines both; the most faithful, the most edits. |
| **D** | **Reverse the settled index** (not a fixture option) | nothing in tests | Listed for completeness only: contradicts a settled decision and the ENG-model ("one active project per engineer", `docs/schema.md:129-130`). |
**Two facts that bear on the choice.** (1) **Sequencing:** mixed-role and distinct-engineer fixtures pass with **or without** the index, so the fixture fix can land **before** the migration is applied to test-db; applying the index first makes CI red on all 7 files (and `CLAUDE.md:142-146` requires test-db to carry the migration). (2) **A tension to name, not resolve:** D11's principle is "no fixture is reshaped to fit a constraint", yet every option here reshapes fixtures to fit the *index*. The distinction is whether the state is
*legitimately reachable*. The index makes "one engineer on two projects" invalid, and #1–#3 were written to prove the bot copes with exactly that state (`project-resolution.ts` "skip-and-surface", `033:203-215`, `route.ts:230-247`). After the index those code paths are reachable only through non-`engineer` memberships. Whether "one engineer, two projects" is truly forbidden is the product question underneath D12.
**Acceptance (T22, option-independent):** on a DB that has the index (disposable scaffold, then test-db), the 7 files are **red with today's fixtures** (captured) and **green after the fixture change**; a fixture change must not change what any other assertion in those files proves.

## 5. The flow, and atomicity
**Flow:** paste → **Preview** (dry-run) → **Confirm** — a step naming the count of rows about to be created (`formatAddConfirm({ count })`) plus the admin-facing consent attestation (`ADD_CONSENT_ATTESTATION`), with the apply control **disabled until ticked** (UI only) → **Apply**. The action re-parses the raw text server-side, refuses if the re-parsed accepted count differs from the confirmed count, and passes the tick
state to the function as `p_consent_attested`, recorded not enforced (D9). **Atomicity:** all-or-nothing per apply call; if any row is not `ok` at apply, or a concurrent add wins, nothing is written and the admin sees `ERROR_BATCH_NOT_APPLIED` and re-previews. Concurrency (T15) is **not verifiable locally** (`CLAUDE.md:478-486`).

## 6. The migration
- **File:** `048_engineer_registration.sql` (name **ASSUMED**). **Number 048** (log: `origin/main` ends at 047; reservations end at 048 "RELEASED, NEVER USED … free"); **ASSUMED still free at write time** (`CLAUDE.md:869-872`). Held in `docs/reviews/` until applied (`CLAUDE.md:947-952`).
- **Contents:** (1) five nullable columns on `users` with pairing CHECKs and composite FKs; (2) the partial index `uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'` (name clear of live `pg_indexes`, probe i; not `CONCURRENTLY`, `docs/migration-runbook-template.md:34`); (3) **the CHECK `role IN ('pm','qs','engineer','owner','subcontractor','admin')` on `project_members`**
  (D8/D11, definite; ~~gated on D11~~ **no longer gated**); (4) the internal helper; (5) `add_engineers_to_project`; (6) `deactivate_engineer`; (7) ACLs (§2.7). **Sequencing constraint (D12):** the fixture change must land before the migration is applied to test-db.
- **`UNIQUE (project_id, user_id)` (`001:79`) is insufficient** (`(P1,U)`,`(P2,U)` are distinct pairs). **Partial, because** PMs hold `pm` memberships on many projects (`projects/new/page.tsx:49-54`).
- **If prod has violating rows:** the index fails `23505` (query `e`); the CHECK fails if prod holds a role outside the six or a case variant (query `n2`); either aborts the whole file with no change; no auto-dedupe. Test-db: probes a, e, x2 — 0 rows.
- **Review gate (`CLAUDE.md:192-205`) clearly tripped** (a, b, c; a `DROP COLUMN` in the DOWN is destructive (d)). Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`); `service_role` denial on the **real** database; ACL / `proowner` / `proconfig` for **all three** functions; disposable local dry-run first (`CLAUDE.md:1020-1030`); rehearsal on the cleaned test-db (`CLAUDE.md:74-78`).
- **DOWN:** drop the functions, the CHECK, the index, the five columns; commented per `down-section-must-be-commented` (`CLAUDE.md:1135-1139`, `scripts/lint-migrations.mjs:547-552`) and **rehearsed** (`CLAUDE.md:1120-1128`); dropping the columns destroys attribution data.
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`, foreground, never `db push` (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it (`CLAUDE.md:142-146`).

## 7. Positive controls
"Shown to fail" = a captured red run, then the fix, then green. Non-regression controls get a mutation or negative control. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`), never on test-db or prod.

### 7.1 Tests
| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T1** | A caller with `users.tenant_id` **NULL** is refused, nothing written, both modes. **Fixture: `role='admin'`, `tenant_id` NULL, real `auth_id`** (constructed; test-db's 3 NULL-role stubs would not exercise it). Expected `no_data_found`. | **Red against a `<>` comparison first:** scaffold variant `IF project.tenant_id <> caller.tenant_id` — `NULL <> uuid` is NULL, the guard does not fire, the admin gate passes, the engineer is written into the **project's** tenant → fails. Then `IS DISTINCT FROM` → green. |
| T2 | *(folded into T6)* | |
| **T3** | A second `role='engineer'` membership for the same user on another project is rejected `23505` naming `uq_project_members_one_engineer_project` (**direct insert**). | Natural red: run on test-db **before** the migration → succeeds → fails. |
| **T4** | `admin` with `pm` memberships on P1 **and** P2 is unaffected; `pm` on P1 + `engineer` on P2 **is allowed by the index**. **ALLOWED IS NOT WORKS:** that user, if they text the bot, still gets `MULTIPLE_MEMBERSHIPS_REPLY` (`project-resolution.ts:74-75`) — `resolveEngineerProject` counts memberships **across all roles** (`project-resolution.ts:37,60-63`; webhook `route.ts:244-247`) — and the sweep **parks** their morning session (`033:220-233`). The index guarantees no two `engineer` memberships; it does **not** guarantee one usable membership. Asserting "allowed" here proves only the index predicate. | Negative control on the scaffold: wrong index `UNIQUE (user_id)` (no predicate) → the `admin` case fails; real index → green. |
| **T5** | A **tenant-B engineer's number** classified by a **tenant-A admin** (dry-run) returns `number_registered`; the row has **exactly the keys `idx, status`**; the serialised payload contains **no** tenant-B project id, project name, or full name — asserted **on the payload**, not the rendered string. A tenant-B engineer with **no membership** also returns `number_registered`, never `registered_no_project`. In-tenant: `on_another_project` (`other_project_name`, no id/full name) and `registered_no_project` (`idx, status`). | Mutations: (i) leak name/full_name/project id cross-tenant → fails; (ii) classify only within the caller's tenant → cross-tenant number returns `ok` → fails; (iii) return `registered_no_project` cross-tenant → fails. |
| **T6** | **One shared fixture matrix (§7.2), run twice:** against the **TypeScript gate** and the **SQL function**; both return the expected verdict on every row and agree. | Mutate each side separately (membership-only rule) → the `qs`-with-`pm`-membership row fails on that side; mutate one side → the agreement assertion fails. |
| **T7** | **Dry-run writes nothing.** After a dry-run that returns `ok` verdicts, row counts of `users` and `project_members` are unchanged; asserts ≥1 `ok`. | Mutation: let dry-run fall through to step 7 → counts change → fails. |
| **T8** | An unauthorised caller's dry-run gets an error, **not** statuses. | Mutation: move step 5 before step 3 → statuses leak → fails. |
| **T9** | **Shape and round-trip.** The validator over the §3.3 corpus **generated from `TEST_BOUNDARY_PHONE_LITERAL` by formatting and mutation only**; accepted → the stored form, fixed point under `normalisePhoneNumber`; the function accepts the generic shape, rejects malformed. | Red: pin `normalisePhoneNumber('abc')` → `'+abc'` (`normalise.ts:42`), assert the validator rejects. Mutation: store raw input → round trip fails. |
| **T10** | **Explicit columns, attribution, consent.** (a) Read-back: `tenant_id`, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = caller's `users.id`, `registered_at` non-null and equal across a call's rows, `consent_attested` = the value passed**; membership `role='engineer'`, same tenant. (b) **Source guard**: the `INSERT INTO public.users` column list contains all of them. | Mutations: drop `registered_by` → (a),(b) fail; write `auth.uid()` → (a) fails; drop `status` → (b) fails. |
| **T11** | **Deactivate.** (i) Tenant-A admin cannot deactivate a tenant-B user (`no_data_found`), zero writes. (ii) `pm` without membership, and `qs`/NULL role with a membership: `insufficient_privilege`. (iii) Positive control: the engineer **is** in `fetchMorningRoster`, gate `proceed`; after deactivation **excluded** (`roster.ts:150,203`) and `gated_noop` (`reactivation.ts:29-33`); number and membership untouched. (iv) `deactivated_by`/`deactivated_at` set; a **second call returns `already_deactivated` and does not overwrite**. | (i) drop tenant binding → fails; (iii) function absent → fails; set `messaging_blocked` instead → gate returns `reactivate` → fails; (iv) always-write mutation → timestamp changes → fails. |
| **T12** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty (constants `!== ''`; formatters return non-empty). | **Expected-fail at commit** (`it.fails`): blank → assertion fails → test passes; when the copy PR fills them the wrapper goes red — the flip is the signal. **Verified** on vitest 3.2.7 (scratch dir, re-run in this log): blank → PASS, filled → FAIL, control PASS. No live `it.fails` exists in `test/` today (grep f2), so this is its first executable use. |
| **T13** | **Boundary test** (§7.3): one literal through the function in apply mode; read back; cleaned up. | Function absent → fails. |
| **T14** | End state: after adding one engineer, `resolveEngineerProject` returns `resolved` and the morning roster includes them. | Function absent → `zero_memberships`. |
| **T15** | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md:478-486`). |
| **T16** | **ACL evidence** on the real test-db for all three functions: anon → `42501`; `service_role` denied; `authenticated` may call the two public functions and **not** the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` = `search_path=public`. | Before the REVOKEs, `service_role`/PUBLIC hold EXECUTE (probe n, `correct_daily_log`). |
| **T17** | Tenant-A admin with a tenant-B `p_project_id` gets `no_data_found` **identical** to a nonexistent id, zero writes. | Mutation raising `insufficient_privilege` for foreign ids → fails. |
| **T18** | **Atomicity.** Row K fails after step 5 → **zero** new rows. | Mutation: per-row `EXCEPTION` sub-blocks → earlier rows persist → fails. |
| **T19** | **The CHECK.** On test-db, inserting a `project_members` row with role `'Engineer'`, `'engineer '`, `'ENGINEER'` or a value outside the six is rejected `23514`; each of the six valid roles (incl. `'qs'`, `'owner'`) succeeds; a second `'engineer'` membership is still caught by T3. ~~rev4: `'owner'` rejected~~ | Natural red: **before** the migration those inserts succeed (probe h; probes j/k) → fails. |
| **T20** | **Consent is recorded, not enforced.** `p_consent_attested = false` (and NULL) does not block apply; the row stores `false`; `true` stores `true`. | Mutation: raise on false → fails; skip writing the column → read-back fails. |
| **T21** | **Boundary-literal source guard.** In `test/`, `+91` followed by a digit appears **only** in `test/helpers/boundary-phone.ts`; the boundary test imports `test/helpers/db.ts`, imports **no** module under `lib/whatsapp/outbound/` or `app/api/cron/`, and creates its fixture project with `status <> 'active'`. | Mutation: second `+91` literal / import `send.ts` / `active` project → fails. |
| **T22 (new)** | **Existing-fixture acceptance (D12, option-independent).** On a database carrying the partial index, the 7 files in §4.7 pass; and each changed fixture leaves the file's other assertions meaning what they meant. | **Red first:** with today's fixtures and the index applied (scaffold, then test-db) the 7 files fail — 59 tests (§4.7); capture. Green after the D12 fixture change. |

### 7.2 The shared T6 matrix (one data table, two runners)
| # | role | tenant | membership | expected | shape exists in prod? |
|---|---|---|---|---|---|
| 1 | admin | same | none | allow | yes |
| 2 | admin | same | pm | allow | **yes — the real PM shape** |
| 3 | pm | same | pm | allow | **no — fixture-only** (no `users.role='pm'`, probe t) |
| 4 | pm | same | none | not_permitted | fixture-only |
| 5 | pm | same | engineer only | not_permitted | fixture-only |
| 6 | qs | same | pm | not_permitted | fixture-only |
| 7 | engineer | same | pm | not_permitted | fixture-only |
| 8 | NULL | same | pm | not_permitted | pre-onboarding stub shape |
| 9 | admin | other tenant's project | none | not_found | yes |
| 10 | admin | caller tenant NULL | none | not_found | constructed |
| 11 | admin | project id nonexistent | — | not_found | yes |
**No conclusion may rest on rows 3–8 alone; rows 1, 2, 9, 11 exist for real.**

### 7.3 The boundary literal, and the fixture gap
**`TEST_BOUNDARY_PHONE_LITERAL = '+919176861156'`** — one named constant in one file, `test/helpers/boundary-phone.ts`, swappable in one edit. **No other `+91` value is minted anywhere.** Checked in the log: 13 characters; matches the India stored form and the generic shape; a fixed point of `normalisePhoneNumber`; equals what the webhook would compute from `whatsapp:` + the literal.
**Fixture gap (limit):** DB fixtures are `+1…` (`test/helpers/db.ts:43,112,132-134,233`): 1,868 × 14 digits and 2 × 11 digits (probe g), none `+91`; end-to-end tests run on a shape this screen can never produce; the **one** boundary test drives the literal directly.
**The three confirmations, from printed output:**
1. **Test-db only — SHOWN at the harness level:** `test/setup/guard.ts:9-61` aborts the run unless the ref is `exfccwlrhoutkgrlikod`, wired as `globalSetup` (`vitest.config.ts:31`); `vitest.config.ts:9` loads only `.env.test`; `db.ts:205-207,953-955` build clients from `SUPABASE_TEST_*`, and `db.ts:26-28` says tests avoid the app env names because they "could resolve to production". The boundary test does not exist yet; T21 guards it uses `db.ts`.
2. **No row with this number exists on test-db — SHOWN** (probe v): 0 in `users`, `whatsapp_sessions`, `outbound_sends`, `processed_messages`.
3. **No real Twilio send — SHOWN for every path in the repo and database; NOT shown for deployed-environment configuration; neutralised structurally.** *Shown:* probe w — no triggers on `users`/`project_members`/`projects`, no `pg_net`/`pg_cron`/`http` (only `supabase_vault`); only two modules send (`trigger.ts:206`, `owner-deliver-dispatch.ts:503`); the engineer path is reached only via
   `runCheckpointTrigger` → `fetchActiveProjects` → roster (`checkpoint-trigger.ts:226-233`, `roster.ts:285-288`) started by `CRON_SECRET`-authorised cron routes (`morning-trigger/route.ts:29-36`); `readCredentials` throws unless all three `TWILIO_*` are set (`send.ts:154-176`); the real `.env.test` holds the **name** `TWILIO_AUTH_TOKEN` only (names, never values; log) and outbound tests stub fake credentials and mock `fetch`
   (`outbound-trigger.test.ts:173-181`); Vercel's documentation (re-fetched into this log, page last updated 2026-09-16): "…makes an HTTP GET request to your project's production deployment URL…". **Structural neutraliser (T21):** the boundary test's fixture project has `status <> 'active'` (probe z: the CHECK allows `on_hold`), so the roster never loads it; the row lives only between apply and cleanup (`afterAll` + `finally` + pre-run cleanup by exact number).
   *Not shown:* that the deployed Production environment's variables do not point at test-db, and that no other scheduler calls the cron routes with the secret (Vercel dashboard, unreadable from here). Not blocking, because the non-active-project rule removes the path regardless; **if Aravind disagrees, treat (3) as blocking.** Limit: concurrent CI runs collide on `UNIQUE (whatsapp_number)`; surfaces as R7 (**ASSUMED** tolerable).

## 8. RLS
Live (probes j, k, o): `users` — `users_select` (own or same tenant), `users_update` (own row; column grant `full_name, avatar_url`, `015:105`); no INSERT/DELETE policy, `authenticated` lacks both (`015:114`). `project_members` — select tenant-scoped; insert/update require tenant match AND `users.role IN ('pm','admin')` **with no condition on the inserted row's `role`** (§4.5); no DELETE policy (`047:230`).
Both tables owned by `postgres`, RLS on, **not forced**. **The three functions bypass RLS**; the gate is re-stated inside (§1). Still enforced regardless of RLS: composite FKs (`017:94-106`), `UNIQUE (whatsapp_number)`, `users_role_check`, `users_status_check`, the new CHECK, the new index, the pairing CHECKs. Cross-tenant: tenant is never an input (§2.4).

## 9. Strings — every value blank; Aravind writes all wording
No wording is drafted anywhere in this document. **Every value is blank and carries `// Wording owed, NOT approved`** (`Tamil owed, NOT approved` means approved English awaiting Tamil, `lib/photos/copy.ts:3-6`; not these). Home: `lib/engineers/copy.ts` (new). **rev5 adds no new string**: D11, D12, F1/F4, T4 and T22 are all internal/plan-level, and the deactivate-scope / dead-end case already has `REJECT_REGISTERED_NO_PROJECT` and `DEACTIVATE_ERROR_NOT_FOUND` (rev4).
**Formatters, after `formatKeptUntilLine`** (`lib/photos/copy.ts:23-46`: exported function, **named positional parameters**; **ASSUMED positional**): `PREVIEW_SUMMARY` → `formatPreviewSummary(accepted, rejected)`; `RESULT_SUMMARY` → `formatResultSummary(added)`; `REJECT_NAME_TOO_LONG` → `formatRejectNameTooLong(max)`; `ERROR_PASTE_TOO_LONG` → `formatErrorPasteTooLong(max)`;
`ADD_CONFIRM` → `formatAddConfirm(count)`; `REJECT_ON_ANOTHER_PROJECT` → `formatRejectOnAnotherProject(projectName)` (in-tenant only); `formatRegisteredLine(registeredByName, registeredAt, consentAttested)`; `formatDeactivatedLine(deactivatedByName, deactivatedAt)`.
**Constants (blank):** `ADD_ENGINEERS_PAGE_TITLE`, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_ENGINEERS_TEXTAREA_LABEL`, `ADD_ENGINEERS_PREVIEW_BUTTON`, `ADD_ENGINEERS_APPLY_BUTTON`, `ADD_ENGINEERS_EDIT_BUTTON`, `PREVIEW_ROW_ACCEPTED`, `PREVIEW_ROW_REJECTED`, `REJECT_NO_NAME`, `REJECT_BAD_NUMBER`, `REJECT_DUPLICATE_IN_PASTE`, `REJECT_ALREADY_ON_THIS_PROJECT`,
`REJECT_NUMBER_REGISTERED` (generic; the only rejection ever used cross-tenant), `REJECT_REGISTERED_NO_PROJECT`, `PREVIEW_NOTHING_TO_APPLY`, `RESULT_ROW_ADDED`, `ERROR_BATCH_NOT_APPLIED`, `ERROR_PROJECT_NOT_FOUND`, `ERROR_NOT_ALLOWED`, `ERROR_PASTE_EMPTY`, `ERROR_GENERIC_SAVE`, `PROJECT_PAGE_ADD_ENGINEERS_LINK`, `ENGINEERS_LIST_TITLE`, `DEACTIVATE_CONTROL`, `DEACTIVATE_CONFIRM`,
`DEACTIVATE_RESULT`, `DEACTIVATE_ERROR_NOT_FOUND`, `ADD_CONSENT_ATTESTATION`, `ENGINEER_STATUS_ACTIVE`, `ENGINEER_STATUS_DEACTIVATED`. **Removed earlier (kept):** ~~`RESULT_ROW_RACE`~~, ~~`RESULT_ROW_FAILED`~~, ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~. **Existing approved strings (reference, do not copy):** `route.ts:55-62`; `project-resolution.ts:71-72`, `:74-75`; `hindrances/actions.ts:24` (not exported, not reusable). **T12** asserts every export is non-empty (expected-fail at commit).

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)
The log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.
| Probe | Result |
|---|---|
| (a) users with >1 `project_members` row | **0 rows** |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers missing tenant or whatsapp | **2** (whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| (e) index-predicate violations | **0 rows** |
| (f) `project_members` | 2 rows, both `engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits, zero `+91` |
| (h) live constraints | `users_role_check` = the six-role set; no CHECK on `project_members.role` |
| (i–l) indexes, policies, grants, nullability | as cited |
| (n) definer inventory | 15 functions, owner `postgres`, all `search_path=public` |
| (o) owner / RLS forced | `postgres`, on, not forced |
| (p) `get_user_tenant_id()` | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` |
| (r, s) columns | no actor column; only `tenants.registered_address` |
| (t) role distributions | `project_members`: 2 × `engineer`; `users`: 10 admin, 3 NULL-role, 1,872 engineer, all `active`, no `pm` |
| (v) boundary literal presence | **0** in all four tables |
| (w) triggers / extensions | none on the three tables; only `supabase_vault` |
| (x) narrow-set violations (rev4) | 0 |
| **(x2) six-role-set violations / case-space variants / total** | **0 / 0 / 2** |
| (z) orphans; projects | **1,870** engineers with no membership vs 2 with; 14 projects, all `active` |
**Would the partial unique index apply cleanly on test-db today? YES** (a, e) — **but it breaks 7 test files (§4.7).** **Would the six-role CHECK? YES** on data (x2).

## 11. For Aravind — run against PROD (not run by me)
Read-only; confirm the project ref first.
```sql
-- (a) users with more than one project_members row
SELECT pm.user_id, u.role AS users_role, array_agg(pm.role ORDER BY pm.project_id) AS project_members_roles,
       array_agg(pm.project_id ORDER BY pm.project_id) AS project_ids, count(*) AS membership_count
FROM project_members pm JOIN users u ON u.id = pm.user_id
GROUP BY pm.user_id, u.role HAVING count(*) > 1 ORDER BY membership_count DESC;

-- (e) the exact index predicate: any row blocks CREATE UNIQUE INDEX
SELECT user_id, count(*) AS engineer_memberships, array_agg(project_id) AS project_ids
FROM project_members WHERE role = 'engineer' GROUP BY user_id HAVING count(*) > 1;

-- (g) stored phone SHAPES, digits masked
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (n) DISTINCT project_members.role values, exact
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (n2) NEW (rev5, D11): would the six-role CHECK apply on prod? any row here blocks it
SELECT role, count(*) AS n FROM project_members
WHERE role IS NULL OR role NOT IN ('pm','qs','engineer','owner','subcontractor','admin')
   OR role <> lower(btrim(role))
GROUP BY role ORDER BY role;

-- (r) country-code prefix and length only
SELECT left(whatsapp_number, 3) AS prefix, length(whatsapp_number) AS len, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (u) do registered_* / consent_attest* / deactivat* columns already exist on prod?
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE 'registered%' OR column_name ILIKE 'consent_attest%' OR column_name ILIKE 'deactivat%');

-- (v) users by role and status
SELECT coalesce(role, '<NULL>') AS role, status, count(*) AS n FROM users GROUP BY 1, 2 ORDER BY 1, 2;

-- (w) engineers on prod with NO project membership (the F3 dead-end population)
SELECT count(*) AS orphan_engineers FROM users u
WHERE u.role = 'engineer' AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id);

-- (y) in-flight sessions belonging to deactivated users on prod (F1/F2 population)
SELECT s.current_flow, count(*) AS n FROM whatsapp_sessions s JOIN users u ON u.id = s.user_id
WHERE u.status = 'deactivated' GROUP BY 1 ORDER BY 1;
```

## 12. File list
**Created (later build slice, not by this plan):** `docs/reviews/048_engineer_registration.sql` (moves to `supabase/migrations/` only at apply), `docs/reviews/048-review-package.md`; `app/(dashboard)/projects/[id]/engineers/new/page.tsx` and `actions.ts`; `app/(dashboard)/projects/[id]/engineers/page.tsx` and `actions.ts` (routes **ASSUMED**);
`lib/engineers/parse-roster.ts`, `gate.ts`, `add-engineers.ts`, `deactivate.ts`, `copy.ts`; tests per §7, `test/helpers/engineer-gate-matrix.ts`, **`test/helpers/boundary-phone.ts`**, `test/migration-048.test.ts`.
**Modified (build slice):** `scripts/migration-number-reservations.json`; `docs/build-status.md`; `docs/schema.md` (stale at `:127-130`); `types/database.ts` (regenerated); `app/(dashboard)/projects/[id]/page.tsx` — one optional link. ~~The three test files that write `role: 'qs'`~~ — **not modified** (D11). **Pending D12:** some or all of the **7 test files** in §4.7 — which, and how, is the decision; **not** listed as modified until it is made.
**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`, or any existing migration; `is-project-pm.ts` and `normalise.ts` are imported, not edited. **This revision's diff:** exactly `docs/plans/add-engineer-plan.md`.

## Decisions
| | Status |
|---|---|
| D1, D2/D5, D3, D4, D6, D7 | **settled** |
| D8 CHECK on `project_members.role` | **settled** |
| D9 attestation recorded, not enforced | **settled** |
| D10 record who deactivated and when | **settled** |
| D11 the CHECK mirrors `users_role_check` (six roles); no fixture reshaped to fit it | **settled (rev5)** |
| **D12** the 7 existing test files the partial index breaks (§4.7): Option A (mixed roles for multiplicity tests), B (distinct engineer per project for incidental sites), C (both), or D (reverse the index). Not chosen here. **Blocks the build slice.** | **OPEN — BLOCKING** |

## UNKNOWNS
**Not determinable from printed source or the test database:**
1. **Prod state.** Queries a/e/n/n2 (roles, violations); prod phone shapes (Aravind reports one row, `+91`, n=1 — not in this log, unverified by me); users by role; orphans (w); deactivated-user sessions (y); whether prod already has the new columns (u).
2. **What Twilio actually sends in `From`.** Only `normalise.ts:4` and fixtures (`test/webhook.test.ts:263`).
3. **Prod/test-db parity for 048's target.** Probes ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** None designed.
5. **Whether `checkin-escalations/reachability.ts`'s join of `users.whatsapp_number` to `whatsapp_sessions` (`:24-43`) sees a parked session** — not traced. (rev4's other half of this item — the Daily Logs view — is **answered**, F4.)
6. **Deployed Production environment variables and any other scheduler** — not readable from here; neutralised, not proven (§7.3).
7. **Rate limiting across calls.**
8. **Membership-role reads in the 35 incidental DPR/owner-deliver call sites (§4.7 #4–#7):** I read the PM lookup, the rosters and `dispatch.ts:410-415`, but did **not** trace every code path those tests exercise for a membership-role dependency; that bears on whether Option A would be safe there.
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
10. **Whether any path creates `users.role='pm'`.** g8 found none; a pattern search cannot see live data.
11. **Whether `DEACTIVATE_CONFIRM` must name the engineer** (would become a formatter).
12. **My reading of "parsing"** (instruction A, rev3): validating jsonb elements in the function; raw-text parsing stays in TypeScript.
13. **"In the payload" (T10)** read as the insert payload.
14. **Attribution design details** (composite FKs, `ON DELETE`, pairing CHECKs, visibility) — recommendations, not rehearsed.
15. **`photo-access-route.test.ts:41` / `db.ts:27-28`** — I read only the comment lines.
16. **`it.fails` after a vitest upgrade** — verified on 3.2.7 only.
17. **Whether `consent_attested` as a boolean matches intent** (a timestamp or text would also fit).
18. **Exact digits of the T9 corpus** (derived from the literal) — designed, not built.
19. **Whether my whole-suite scan is exhaustive.** It reads `.from('project_members').insert/upsert`, SQL `INSERT INTO project_members`, four wrapper helpers and loops; memberships created through a differently-named helper or a non-literal `role` I did not resolve could be missed. 21 unparsed sites were read by hand or judged reads (`app`/`lib`).
20. **Whether the seven files pass today.** I read them; I did not run the suite. "59 tests hit" is derived from reading the setup calls, not from a red run — T22's first step is that red run.
**Assumed:** migration number 048 still free and the file name; routes `projects/[id]/engineers[/new]`; TypeScript gate and SQL function stay in agreement (T6 tests, does not prove); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`; T15 un-testable here; no in-flight bot session depends on the new functions; colliding CI runs on the boundary literal are tolerable; the default `ON DELETE` on attribution FKs is right.
**Decisions still open:** **D12 (blocking).**
