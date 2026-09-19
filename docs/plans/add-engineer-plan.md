# Add-engineer screen — build plan (rev6)

> PLAN ONLY. rev1 `c86c5b6` (2026-09-18 23:06 IST), rev2 `e67e297` (2026-09-18 23:41 IST), rev3 `9b9187c` (2026-09-19 00:15 IST), rev4 `dba9cfc`, rev5 `fad98e3` — each pinned
> (`git show <sha>:docs/plans/add-engineer-plan.md`). rev6 written 2026-09-19 (IST) on `feat/add-engineer-plan`, base `origin/main` @ `0744110` (re-fetched; unchanged).
> No application code, no migration file, no SQL intended to ship. Tier: FULL.
>
> **Evidence rule.** Every claim cites source printed in `~/Desktop/add-engineer-plan-rev6.txt` ("the log"). Citations are `path:line`; database claims cite `probe <letter>`; throwaway scripts
> (not in the repo, not shipping) are printed with their output. Anything not printed is **ASSUMED** or under UNKNOWNS. **Correction discipline.** Retracted claims stay visible as ~~strikethrough~~.
>
> **Settled by Aravind, applied without re-raising:** D1 `status='active'` + attribution; D2/D5 SECURITY DEFINER function; D3 India-mobile only (TypeScript); D4 caps; D6 role-gate intersection;
> D7 dry-run flag; D8 CHECK on `project_members.role`; D9 consent attestation recorded, not enforced; D10 record who deactivated and when; D11 the CHECK mirrors `users_role_check`;
> **D12 (rev6): Option D — the partial unique index leaves this slice; no test fixture is reshaped.**
>
> ## Open decision that affects the product — D13 (§2.9 F4)
> Deactivate stops the messaging but leaves the engineer **visible on the PM's own screens**, which is the one place a PM would look to confirm it worked. Options and costs in §4.8. Nothing here is blocking the build.

## Scope

**In scope:** paste → preview (dry-run) → confirm → apply for adding site engineers to ONE project; a **deactivate** control; attribution columns (`registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at`);
the CHECK on `project_members.role`. ~~the partial unique index~~ — **removed from this slice (D12, rev6).**
**Deferred, named:** file upload/extraction; reassigning an existing number; **removing** an engineer or **freeing a number** (deactivate does neither, §2.9); editing an engineer; duplicate-name detection; reactivating from the dashboard; the ENG-01 opt-in flow;
rate limiting across calls; the `<>` tenant comparison at `019:230`; the sweep and Daily Logs board not consulting `users.status` (F1, F4); and **the one-project-per-engineer slice** (§4.8): the partial unique index, role-scoping of **both** unfiltered membership-count sites, and the fixture rework for the 7 affected test files — done once, together.

## Dated corrections, 19 Sep 2026 (rev6) — every change in this pass

| # | Earlier text (retracted) | rev6 result | Where |
|---|---|---|---|
| 1 | ~~rev5 banner, §0 #2/#10, §4.7 "D12 open — BLOCKING", D12 table, T22, and every part of the plan that assumed the partial index ships in this slice~~ | **D12 settled: Option D.** The index leaves this slice, together with the deferred role-scoping of the count sites, into one named future slice (§4.8). **No fixture is reshaped.** Reasoning recorded in §4.7. | §4.7, §4.8 |
| 2 | ~~rev5 §6 item (2) "the partial index `uq_project_members_one_engineer_project…`" and its "sequencing constraint"; "if prod has violating rows: the index fails (query `e`)"~~ | Struck. The migration **still contains** the CHECK on `project_members.role`, and the five attribution columns with their pairing CHECKs and composite same-tenant FKs (plus the helper, two functions and ACLs, which never depended on the index). **`UNIQUE (project_id, user_id)` at `001:79` is unchanged — membership uniqueness was not dropped.** | §6 |
| 3 | ~~rev5 T3 (second `engineer` membership rejected `23505`)~~ and ~~T4 ("`pm` on P1 + `engineer` on P2 allowed by the index")~~ and ~~T22 (existing-fixture acceptance)~~ | Struck: each tested or depended on the index. T4's **consequence** ("allowed is not works") is kept as a fact, moved to §4.8 as design input for the future slice. T19 loses its "still caught by T3" clause. | §7 |
| 4 | ~~rev5 "59 tests" stated as a headline fact (banner, §0, §4.7)~~ | **Derived, never observed.** 59 = 7 + 1 + 16 + 5 + 4 + 6 + 20, counted from reading the setup calls of 7 named files; I did **not** run the suite, and a red run needs the index, which exists nowhere. Recorded as derived, with the 7 files named. | §4.7 |
| 5 | ~~rev4/rev5 D8/D11 rationale: "the CHECK exists to stop `'Engineer'` and typo variants escaping the partial index"~~ | **That rationale depended on the index and no longer stands as written.** The CHECK stays (decided). Its purpose now: every exact-string role reader — the Daily Logs roster `.eq('role','engineer')` (`query.ts:163`), `isProjectPm` (`is-project-pm.ts:30`), `resolveProjectManagerName` (`project-manager.ts:36`), the hindrance queue's PM scope (`queue.ts:172,291`) — silently misses a variant like `'Engineer'`; and it is the prerequisite the future index slice needs. Flagged, **not re-litigated**. | §4.5 |
| 6 | ~~rev5 §2.9 "the membership keeps the partial-index slot"~~ | Struck: there is no index. The membership row simply stays. | §2.9 |
| 7 | ~~rev5 §4.5 item 3 (unfiltered-count sites) as a free-standing deferral~~ | Folded into the named future slice with the index (§4.8); the sweep site `033:220-222` is named alongside `project-resolution.ts:37`. | §4.5, §4.8 |
| 8 | ~~rev5 `docs/schema.md:127-130` "both become stale"~~ | Only the `role TEXT NOT NULL` part goes stale (now a CHECK). "One active project per engineer — enforced at insert in app logic, NOT a DB constraint" **stays exactly as true as it was** — and no app code enforces it today (grep g5: no engineer write path exists). | §4.8 |
| 9 | ~~rev5 §2.9 F1 (step 5 described as "an INSERT … or overwrite")~~ | Extended (Part C): what the overwrite means for an already-recorded attendance, from the printed writers. | §2.9 |
| 10 | ~~rev5 F4 "the fix is in `lib/daily-logs/`… Deferred"~~ | Traced surface by surface; three surfaces affected; **D13** with costs. | §2.9, §4.8 |
| 11 | ~~rev5 §4.7 wording "Option A provably breaks `dpr-stage1-plumbing.test.ts:207-217`"~~ (as I had it, rev5 scoped Option A to the 3 multiplicity tests only) | Made precise: mixed roles **applied to the incidental sites** (the only way they could cover #4–#7) inverts that test; Option A as scoped in rev5 did not cover those 35 call sites at all. | §4.7 |
| 12 | (checked) | Strings: **no constant existed only for the dropped index** — checked every rejection case R1–R8 and every constant; R5/R6/R7a/R7 exist because the *number* already exists (`001:44`), independent of any index. Nothing removed. | §9 |

## Dated corrections, 19 Sep 2026 (rev5) — kept

| # | Earlier text (retracted) | rev5 result |
|---|---|---|
| 1 | ~~rev4 CHECK set `('pm','engineer')` and "NEW CONFLICT: three test sites write `role: 'qs'`"~~ | D11: the CHECK mirrors `users_role_check` (six roles); no fixture reshaped; applies cleanly (probe x2). |
| 2 | ~~rev4 T19 "`'owner'` rejected"~~ | `'owner'` valid. |
| 3 | ~~rev4 silent on existing fixtures~~ | Found 7 files / 59 tests (derived, see rev6 #4); root cause: the shared morning engineer enrolled twice by construction. Now moot for this slice (rev6 #1). |
| 4 | ~~rev4 §2.9 F1 "yields a `daily_logs` write attributed to a deactivated engineer"~~ | Precise blast radius; accepted limit; `ON CONFLICT DO UPDATE` nuance. |
| 5 | ~~rev4 UNKNOWN #5 "Daily Logs view"~~ | Answered: the board shows it; F4. |
| 6–9 | ~~rev4 §4.5 one count site; T4 wording; "24 pm, 20 engineer"; §12~~ | Two count-shaped sites; T4 consequence; 55-site scan (28 pm, 24 engineer, 3 qs); file list. |

## Dated corrections, 19 Sep 2026 (rev4) — kept

| # | Earlier text (retracted) | rev4 result |
|---|---|---|
| 1 | ~~rev3 heading "Dated corrections, 18 Sep 2026 (rev3)"~~ | Wrong date: rev3's log starts `Sat Sep 19 00:01:34 IST 2026`, commit `2026-09-19 00:15:46 +0530`; 18 Sep only in UTC. |
| 2 | ~~rev3 §3.6 "India-only in SQL rejected because DB fixtures are `+1…`"~~ | Reason retracted: test-fixture shape must never decide a production constraint; decision stands as an ACCEPTED LIMIT (§3.6). |
| 3–5 | ~~rev3 D8/D9/D10 "open"; "the action refuses if attestation absent"; three-parameter signature~~ | CHECK settled (RLS insert policy places no restriction on the inserted row's `role`); D9 record-not-enforce (`consent_attested`, fourth parameter); D10 `deactivated_by/at`. |
| 6 | ~~rev3 T12 "the repo already uses `it.fails`"~~ | **Wrong**: no executable `it.fails` in `test/`; behaviour **verified by running it** on vitest 3.2.7 (re-run in the rev6 log). |
| 7–14 | session cleanup untraced; `pg_temp`; §7.3 "assumed no cron"; R7 split; matrix rows fixture-only; CHECK optional; digit strings; new items | Traced (F1–F3); `search_path=public` only; shown/not-shown breakdown; `registered_no_project`; rows 3–8 fixture-only; CHECK definite; residual-risk statement (§4.6). |

## Dated corrections, ~~18 Sep 2026~~ **19 Sep 2026** (rev3) and 18 Sep 2026 (rev2) — kept (dates verified)

| # | Earlier text (retracted) | Result |
|---|---|---|
| rev3 1 | ~~rev2 §9 "`// Tamil owed, NOT approved`" citing `lib/photos/copy.ts:13-20`~~ | Mis-citation: that comment marks *approved English awaiting Tamil* (`copy.ts:3-6`); unapproved wording uses `// Wording owed, NOT approved`. |
| rev3 2 | ~~rev2 §2.3 explicit NULL-tenant refusal; T1 fixture a NULL-role stub~~ | One null-safe comparison; T1 fixture `role='admin'`, `tenant_id` NULL. |
| rev3 3–14 | ~~isProjectPm unused; rule wording; India re-assert; `whatsapp:` accepted; …~~ | `git show 9b9187c:docs/plans/add-engineer-plan.md`. |
| rev2 1–12 | ~~rev1 "tighter than the policy"; service-client claim; two-client design; "prod unread"; quoted labels; R6 "index enforces"; partial apply; "048 reserved, 049 next"; §7 T8/T10; §8 residual; per-row strings; `classify.ts`~~ | `git show e67e297:docs/plans/add-engineer-plan.md`. |

## 0. Findings that shape the plan — read first

1. **`status='active'` (D1) departs from ENG-01** (`docs/bot-flows.md:303-308`). Nothing implements that flow (greps g1–g3; c1/c3: none of `registered_by`, `registered_at`, `consent_attest*`, `deactivated_by`, `deactivated_at` exists in `app lib supabase scripts test types`; probe s). A non-`active` user is dropped by the webhook (`reactivation.ts:29-33`) and every roster.
2. **Every pasted row is a fresh `users.id`, so the add screen can never create a second membership** — which is why the partial index is not needed by this slice (§4.7).
3. **`users.status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`); the gate is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users`**: no INSERT (probe k, `015:114`), UPDATE only on `full_name, avatar_url` (`015:105`), only UPDATE policy is own-row (probe j). Add and deactivate both need definer functions; no service client (g4).
5. **Phone chain: no mismatch, but no validator exists** (§3).
6. **Migration number 048** is free (`origin/main` migrations end at 047; reservations end at 048, "RELEASED, NEVER USED … 048 is free").
7. **Deactivation propagates through `users.status`** (§2.9); findings F1–F4.
8. **A test/production shape gap decides real bugs here** (§3.6): six test sites `update({ role: 'pm' })` on a fixture profile while real PMs are `admin`.
9. **This slice ships with NO database enforcement of one-project-per-engineer** (§4.8).
10. **The Daily Logs board and the Today page keep showing a deactivated engineer as failing, every day** (F4, D13).

## 1. Authorisation
**The rule (D6).** With the caller resolved as the `users` row where `auth_id = auth.uid()`: `users.role IN ('admin','pm')` **AND** the project exists **in the caller's tenant** **AND** (`users.role = 'admin'` **OR** a `project_members` row with `role = 'pm'` for this `(user, project)`). It is the intersection of the DB policy's role list
(`project_members_insert`, probe j) and per-project membership; `qs`/`engineer`/NULL-role users never pass, even with a `pm` membership.
**Where each role column is written.** `users.role='admin'` for a self-serve account: `005:76-80`, `016:177-181`. `project_members.role='pm'` for a project's creator: `app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM is `users.role='admin'` + `project_members.role='pm'`; grep g8: nothing writes `users.role='pm'` outside tests; probe t: test-db has 10 admins, 3 NULL-role stubs, 1,872 engineers, **no `pm` user**.
**Two implementations, one authority.** SQL (authoritative): the internal helper (§2.7). TypeScript (advisory only): pure `decideEngineerAdminAccess`, reusing `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`). If they disagree, SQL wins; T6 catches drift.

## 2. The add function — SECURITY DEFINER (`add_engineers_to_project`)

### 2.1 Contract (signature and behaviour; no body is written here)
`(p_project_id uuid, p_engineers jsonb, p_dry_run boolean, p_consent_attested boolean) → jsonb`. No parameter defaults (`CLAUDE.md:361-372`). `p_engineers` is an array of `{ name, whatsapp_number }`, the number **already validated and normalised by TypeScript** (§3); the function asserts only the generic stored shape (§3.6).
In dry-run, `p_consent_attested` is ignored; in apply it is recorded as `coalesce(p_consent_attested, false)`.
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
`p_dry_run = true`: authorisation, tenant binding, argument validation and **full classification**; returns the payload apply would; **writes nothing**. **Why it exists, plainly:** without it a cross-tenant collision is invisible at preview (under RLS a preview reads only its own tenant's `users`, probe j `users_select`) and **aborts the whole all-or-nothing batch at apply**; with it, preview and apply run the *same code path* and the collision is caught at preview, generically.
1. **Authorisation runs BEFORE any number lookup, in both modes.** 2. **Cross-tenant collisions are `number_registered`**: exactly `{idx, status}` (T5). 3. **Apply re-runs every check** and never trusts the preview's verdicts. 4. Dry-run writes nothing (T7).

### 2.3 Order of operations (one transaction)
1. **Resolve the caller:** `users` where `auth_id = auth.uid()` (`019:170-171`; probe p); none → `insufficient_privilege` (`019:172-175`). `auth.uid()` is never compared to `users.id` (`007:127`, `007:60-67`, `007:76-78`); engineers/owners have `auth_id` NULL (`CLAUDE.md:833-840`).
2. **Load the project; tenant-bind NULL-safe.** Missing, **or** `project.tenant_id IS DISTINCT FROM caller.tenant_id` → `no_data_found`, one indistinguishable error (`019:219-222`); `projects.tenant_id` is NOT NULL (`001:55`). **This single comparison is the only tenant-binding mechanism** (T1).
3. **Role/authority gate (§1)**, else `insufficient_privilege`. 4. **Validate the argument:** 1..50 rows (`program_limit_exceeded`, `019:208-212`); non-empty `name` ≤ 100; generic-shape number; duplicates → `invalid_parameter_value`.
5. **Classify every row** (R5–R7, §4). 6. If `p_dry_run`, or **any** row is not `ok` → write nothing. 7. Otherwise insert per row (§2.6); any exception rolls back everything; a concurrent add of the same number loses on `UNIQUE (whatsapp_number)` (`001:44`, probe h; `23505`).
**The NULL trap in the precedent (deferred):** `019:230` is `IF v_tenant_id <> get_user_tenant_id()`; a NULL tenant makes it NULL and the guard passes (masked by `019:224-229`). The new function does not copy it.

### 2.4 `tenant_id` is derived from the project row, never a parameter
(a) A parameter is caller-controlled; a missed validation writes a user into the wrong tenant. (b) The function bypasses RLS; the composite FKs (`017:94-106`, probe h) validate the *membership* but not the `users.tenant_id` *value*. (c) It removes a class of test cases.

### 2.5 Ownership and grants
Precedent printed in full: `019:149-297` (`SECURITY DEFINER SET search_path = public` `:156`; `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` `:294-295`). Live (probe n): all 15 definer functions owned by `postgres`; `correct_daily_log` still holds `service_role:EXECUTE` (hence `CLAUDE.md:910-918`). Tables owned by `postgres`, RLS on, **not forced** (probe o).

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

**`project_members` row:** `id`/`created_at` defaults; `tenant_id` = derived tenant; `project_id` = `p_project_id`; `user_id` = the new id; `role` = literal `'engineer'` (exact string — constrained by the new CHECK, §4.5). **Existing `UNIQUE (project_id, user_id)` (`001:79`) still applies.**

### 2.7 Shared internal helper; search_path; grants
Steps 1–3 live in one **internal helper**; both public functions call it. Not callable from outside: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`. Public functions: `REVOKE EXECUTE … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`.
**`search_path`:** all **15** existing definer functions have `config = {search_path=public}` and nothing else (probe n; `019:156`, `012:85-87`, `033:170-171`; the 71-line `SECURITY DEFINER` grep is in the log). **The new functions follow exactly that: `SET search_path = public`, no `pg_temp`, every object schema-qualified, no dynamic SQL.** **Alternative:** duplicate steps 1–3 inline (no helper ACL, but two copies that can drift).

### 2.8 Attribution — `registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at`
**Confirmed absent** (grep c1/c3; probe s; probe r). **Cannot be reconstructed later:** after apply nothing on either row records who created or deactivated it; the only other trace is request logging outside the database, which this repo does not read.
**D9:** a direct caller can pass any value, so a refusal buys nothing, while the recorded claim plus `registered_by`/`registered_at` answers "who confirmed this, and when" later. It records **the caller's claim**, not proof of consent; the screen's apply control is disabled until ticked (UI only).
**D10:** `deactivate_engineer` writes `deactivated_by` and `deactivated_at` in the same UPDATE as `status='deactivated'`. **Limit:** one slot per row; no history.
**Design (recommended, reviewer-flagged):** five nullable columns; pairing CHECKs `(registered_by IS NULL) = (registered_at IS NULL) AND (registered_by IS NULL) = (consent_attested IS NULL)` and `(deactivated_by IS NULL) = (deactivated_at IS NULL)` (precedent `036…:232-244`); composite same-tenant FKs to `users (id, tenant_id)` (`017:94-106`; `users_id_tenant_id_key`, probe h); default `ON DELETE` (**ASSUMED**). Departure from ENG-06 (`bot-flows.md:308`): columns on the user row.

### 2.9 Deactivate — the SECOND SECURITY DEFINER function (`deactivate_engineer`)
**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb` `{ status: 'deactivated' | 'already_deactivated' }`. Same helper, gate, tenant binding and grants. Target: `users u JOIN project_members pm` with `u.id = p_user_id`, `u.role='engineer'`, `u.tenant_id` = derived tenant, `pm.project_id = p_project_id`, `pm.role='engineer'`; **not found → `no_data_found`**. One UPDATE: `status='deactivated'`, `deactivated_by`, `deactivated_at`;
already deactivated → no write, no overwrite. `'deactivated'` is permitted by `users_status_check` (probe h). **Does NOT:** delete; touch `whatsapp_number`, `messaging_blocked`, `project_members`, or `whatsapp_sessions`; send; reactivate; use dynamic SQL.
**KNOWN LIMIT — the number stays held** (`UNIQUE (whatsapp_number)`, `001:44`, probe h). ~~and the membership keeps the partial-index slot~~ (rev6 #6: no index). **A mistyped number cannot be corrected from the dashboard; the only repair is manual SQL.**
**Deactivation takes effect with no further change — printed source.** Webhook: `decideInboundGate` returns `gated_noop` for `status !== 'active'` (`reactivation.ts:29-33`), header forbids silent reactivation (`:11-14`), clear-half re-asserts `status='active'` (`:64`); `route.ts:159`, `twimlEmpty()` at `:161-163`. Outbound: `fetchActiveEngineers` filters `.eq('users.status','active')` (`roster.ts:168`), used by both exported rosters (`:203`, `:248`). Also filtering: `checkin-escalations/roster.ts:65`, `dpr-generate/route.ts:80`, `accountability.ts:159`, `dpr/dispatch.ts:417-418`. Why `status`, not `messaging_blocked`: the flag would make the gate return `reactivate` (`:36-38`).

### Session trace and PM-visible findings — named, not fixed (except D13 pending)
- **Inbound from a deactivated engineer:** `route.ts:159-163` returns `twimlEmpty()` before idempotency, project resolution and any session call.
- **F1 — the morning sweep never reads `users` — RECORDED, NOT FIXED, ACCEPTED LIMIT.** Verified from `033`: the sweep loops `SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning'` (`033:198-200`); the printed body reads only `whatsapp_sessions`, `project_members`, `daily_logs` — grep `u1`: zero non-comment lines mention `users`; `u2`: the only targets.
  **Blast radius, precisely.** (1) It acts **only on an existing session**; a deactivated engineer gets **no new morning trigger** (`roster.ts:168`). (2) Only an engineer with **exactly one** membership is processed (`033:220-233`). (3) Steps 2–4 only **UPDATE `morning_submitted_at` on a row that already exists** (`033:235-245`). (4) **Only step 5 writes attendance** (`033:265-283`). (5) The session then closes (`033:306-316`), so it cannot repeat.
  **The nuance rev4 missed — step 5 can OVERWRITE.** It is `INSERT … ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE SET attendance = EXCLUDED.attendance, attendance_defaulted = …, attendance_raw = …, is_holiday = …, morning_submitted_at = …` (`033:273-282`). So if a row already exists for that `(project, engineer, day)`, its attendance fields are **replaced** by `'absent'`, `attendance_defaulted = true`, `attendance_raw = NULL`, `is_holiday = false`, and the submission time.
  **What that means for a real engineer's already-recorded attendance on the day of deactivation** (from the printed writers): attendance is written only by `apply_morning_flow_turn` (`030:550-557,565-570`, redefined `035:226-495`, upserts at `035:383-395`) and by this sweep — grep `a1`: no `app`/`lib` code writes it and the evening RPC has no attendance write. (a) An engineer who **answered YES** has `'present'` recorded and a session at steps 2–4 or complete: steps 2–4 **never touch attendance** (`033:235-245`; the sweep test `:209-224` asserts "already present is preserved untouched"), so **their recorded attendance is preserved.** (b) Step 5 means the morning answer was **NO**, and the header says a NO "advances straight to step 5 with no write" (`033:61-65`), so **no attendance row exists to lose** — the sweep creates one. (c) The only route to overwriting a *real recorded value* is a row **and** a step-5 session on the same log day; the header names one route (evening wrote the row first, `033:65-67`), but the evening RPC writes no attendance, so that row would hold NULL attendance. I found **no path** that puts a recorded `'present'`/`'site_holiday'` beside a step-5 session and did **not prove none exists** (UNKNOWNS).
  **If it did happen, the loss is silent:** the sweep writes no audit row (targets in `u2` exclude `daily_log_edits`, which only the PM-correction RPC writes, `019`), so a real attendance would be replaced by "absent (defaulted)" with no record, on the day the engineer left. **Exposure: one phantom log — or, in the unproven case, one overwritten attendance — on one day, for an engineer deactivated while parked at step 5.**
  **Why not fixed:** fixing it means a new migration **replacing a shipped, externally-reviewed SECURITY DEFINER function** (`033:113-114` "external review round 1, B1 — BLOCKING"; grants `033:333-334`), which trips review-gate (a) (`CLAUDE.md:192-205`) — a full package and rehearsal — out of proportion to that exposure. **Accepted limit.**
- **F2 — evening and hindrance sessions are parked indefinitely.** The sweep covers `'morning'` only (`033:199`); `expires_at` is read by nothing (grep s3; `033:32-34` calls it dead); nothing deletes session rows (grep s4); the only reset is BOT-07's next-day wipe inside `acquire_and_transition_session` (`012:115-121`), reachable only by an inbound past the gate or a cron send — neither can happen for a deactivated engineer.
- **F3 — the engineer with no membership.** Cannot be deactivated from the dashboard (the function needs an engineer-role membership; the list is membership-based, `projects/[id]/page.tsx:56-58`), so **the admin sees nothing to click**. If `active`, that engineer texts in and gets `ZERO_MEMBERSHIPS_REPLY` (`route.ts:244-247`, `project-resolution.ts:71-72`: ask your Project Manager to add you) — but the PM cannot add them (R7a) or deactivate them: a dead end until the reassign slice or manual SQL. Test-db holds **1,870** such engineers (probe z; fixtures); prod unread (§11 `w`).
- **F4 — DEACTIVATE IS INCOMPLETE ON THE PM'S OWN SCREENS (decision D13, §4.8).** *Product consequence, in plain words:* **deactivate stops the messaging but leaves the engineer visible on the PM's own screens — the one place a PM would look to confirm it worked.** Traced surface by surface (all printed in the log):
  | Surface | Roster source | Reads `users.status`? | What the PM sees the day after |
  |---|---|---|---|
  | **Daily Logs** (`daily-logs/page.tsx:50` → `getDailyLogsBoard`, `lib/daily-logs/query.ts:159-163`) | `project_members` where **membership `role='engineer'`**; selects `users(id, full_name, messaging_blocked, whatsapp_number)` | **No** | The engineer's **card stays** (`engineer-card.tsx:120`). Morning chip "Awaiting morning" (muted) until **15:00 IST**, then **"Not checked in" in amber**; evening chip "Awaiting evening" until **19:15 IST**, then amber (`status.ts:125-153`, cutoffs `cutoffs.ts:64,89-90`). **No deactivation marker exists** — the card only knows `messaging_blocked` (`status.ts:116-123`), which deactivate does not set. Every past date without a log shows amber "Not checked in" (`status.ts:130-137`). Same every day, indefinitely. |
  | **Today** (`dashboard/page.tsx:116` → same board; loop `:140-174`) | the same board | **No** | From **10:30 IST** (morning escalation, `cutoffs.ts:53`) and **19:15 IST**, a **"Needs your attention"** card: "‹name› hasn't sent a morning/evening check-in" with an amber chip (`dashboard/page.tsx:151-172,299-301`), which also feeds the page heading's count of "things that need you" (`:176-201`). Every day, indefinitely. |
  | **Project detail → Team Members** (`projects/[id]/page.tsx:56-58,129-133`) | `project_members` (all roles) with `users(id, full_name, role)` | **No** | The engineer's row is **identical** to an active member's — name, user role, project role; no marker. |
  | DPR archive (`dprs/page.tsx:61-81`) | the `dprs` table (project scope from the PM's memberships, `:32`) | n/a | Past DPRs stay; **no new ones** (roster filters status, `dpr-generate/route.ts:80`). Not roster-driven. |
  | Hindrances (`hindrances/page.tsx:45` → `hindrance/queue.ts:169-172,288-291`) | the `hindrances` table; PM scope `role='pm'` | n/a | Past reports stay; none new. Not roster-driven. |
  | Needed tomorrow (`query.ts:549+`) | `daily_logs` in a two-day window | n/a | The engineer's last dependency text shows for its window, then disappears. Not roster-driven. |
  | Check-in escalations | roster with `.eq('users.status','active')` (`checkin-escalations/roster.ts:65`) | **Yes** | Excluded — no escalation for them. |
  **The inconsistency:** the system's own escalation, DPR and messaging logic treat the engineer as out, while the two screens a PM actually reads (Daily Logs, Today) keep counting them as failing. This is not new to deactivation — `messaging_blocked` engineers get a dedicated chip because the same problem was met there (`status.ts:103-123`) — but `deactivated` has no equivalent.

## 3. Phone numbers and the validator

### 3.1 The chain
`route.ts:111`: `fromNumber = normalisePhoneNumber(params.From ?? '')`; `route.ts:130-133` looks up `.eq('whatsapp_number', fromNumber)`. Inbound form: `+` + digits, no `whatsapp:` prefix, no separators (`normalise.ts:13-15,18,21-23`); downstream passes it through verbatim (`dispatch.ts:180,199,217`; `inbound-start.ts:463,852`; `session.ts:58,91`). **No mismatch with the prod stored form** (`+` + 12 digits) provided the screen stores `normalisePhoneNumber(raw)` output only. That real Twilio sends `whatsapp:` + E.164 rests on a comment (`normalise.ts:4`) and fixtures (`test/webhook.test.ts:263`).

### 3.2 Status of the validator — the consequence, stated explicitly
`normalise.ts` **never rejects anything** (`normalise.ts:40-42`), and **no validator exists anywhere in the repo** (the phone `git grep`; the one schema CHECK is `outbound_sends_to_phone_number_check`, `031:478-479`, probe q). `links.ts:10-11` and `reactivate-copy.ts:48-52` say the guarantee "lives upstream at the write paths"; grep g5: no engineer write path exists, so this screen is the first.
**Consequence:** without a validator, a mistyped line stores a well-formed-looking row that can never match an inbound message (the webhook compares the *normalised inbound* number, `route.ts:133`) and **permanently holds that value under the global unique** (`001:44`), with no removal path in this slice (§2.9). The executed probe shows what `normalisePhoneNumber` alone would have stored for the rejected classes: letters gain a `+`, the empty string becomes `"+"`, a too-short value gains one, trailing text is kept, a `00`-prefixed form keeps its zeros.

### 3.3 Validation happens BEFORE normalisation — the exact rule
On each raw pasted token: **V1 charset** — only ASCII digits, `+`, whitespace, `-`, `(`, `)` (`normalise.ts:18`'s separators); anything else rejects. **V2** remove whitespace, `-`, `(`, `)` → `t`. **V3** `t` must match exactly one of `S1 ^\+91[6-9][0-9]{9}$`, `S2 ^91[6-9][0-9]{9}$`, `S3 ^0[6-9][0-9]{9}$`, `S4 ^[6-9][0-9]{9}$`. Then call `normalisePhoneNumber(raw)` and **assert** the result matches the single stored form **`^\+91[6-9][0-9]{9}$`** (13 characters) and is a fixed point.
**Reuse, not reimplementation:** import `lib/whatsapp/normalise.ts:9`; never edit or copy it. **Evidence (throwaway probe, re-run in this log):** 34 inputs (14 accepted, 20 rejected), **0 violations**.
### 3.4 On failure the preview shows the row exactly as pasted and `REJECT_BAD_NUMBER`; nothing is written; other rows still preview.
### 3.5 Line format (D4): one engineer per line; number = trailing run of digits, `+`, spaces, hyphens, parentheses; name = the rest, trimmed. Blank lines ignored. Name ≤ 100 characters; paste ≤ 50 lines.
### 3.6 The function's shape check is generic — ACCEPTED LIMIT, with the corrected reason
The function asserts `^\+[1-9][0-9]{1,14}$`, the shape of `outbound_sends_to_phone_number_check` (`031:478-479`, probe q). The India-only rule lives **in TypeScript only**.
~~**Struck reason (rev3):** "India-only in SQL is rejected because every DB fixture is `+1…`, so it would make every DB test impossible."~~ **Retracted 19 Sep 2026.** Test-fixture shape must never decide a production constraint: six test sites set a fixture profile's `users.role` to `'pm'` (`test/migration-019.test.ts:123,222`, `daily-log-detail-query.test.ts:69`, `dpr-detail.test.ts:97`, `migration-023.test.ts:121`, `daily-log-correction-rpc.test.ts:87`) while a real PM's `users.role` is `'admin'` on prod (`is-project-pm.ts:11-16`, `016:177-181`) — the gate passed on fixtures and failed a real PM on 2026-09-17.
**Replacement reason (ACCEPTED LIMIT):** (1) **the screen is the only intended caller** (a direct caller must be an authenticated tenant admin/PM, bounded by the 50-row cap); (2) **the residual risk is a stored row that never matches an inbound message, which is recoverable** (manual SQL); (3) **minting Indian test numbers is unsafe**: every `+91[6-9]…` value is a routable live handset. **Accepted, not closed:** an authorised caller bypassing the screen can store any well-formed E.164 number.

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
| R8 | Concurrent add between steps 5 and 7 | `23505` on `users_whatsapp_number_key`, rollback | **no** | **yes**, whole batch | `ERROR_BATCH_NOT_APPLIED` |
**Reachable at preview:** R1–R7. **Only at apply:** R8. **R5–R7a are lookups on the *number*, not on any index** — each exists because the number is already registered (`001:44`); none depends on the dropped index (rev6 #12). Whole-request refusals: unauthenticated (redirect); `no_data_found` → `ERROR_PROJECT_NOT_FOUND`; `insufficient_privilege` → `ERROR_NOT_ALLOWED`; empty → `ERROR_PASTE_EMPTY`; over the cap → `formatErrorPasteTooLong`.
**Number-existence oracle, bounded not closed:** authorisation first, generic payload, 50 rows per call; **no rate limit across calls** (UNKNOWNS).

### 4.5 Findings, decisions and deferred items
1. **`project_members.role` CHECK — D8 settled; D11 settled: the CHECK mirrors `users_role_check`.**
   **Underlying finding.** The RLS insert policy places **no restriction on the `role` value of the row being inserted.** Live (probe j): `with_check = ((tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE users.auth_id = auth.uid()) = ANY (ARRAY['pm','admin'])))` — the `users.role` it tests is the **caller's**, not the new row's. Probe k: `authenticated` holds INSERT. Probe h: no CHECK on `project_members.role`. **So any tenant admin or pm can write an arbitrary role string today.** (Shown from catalog and grants; I ran no write.)
   **Allowed set: `('pm','qs','engineer','owner','subcontractor','admin')`** — exactly the live `users_role_check` (probe h). **Rationale (Aravind):** the CHECK is **not** to redefine which roles may hold a project membership; narrowing is a separate product decision; **no test fixture is reshaped to fit a constraint** (§3.6). ~~Purpose: stop `'Engineer'` escaping the partial index~~ — **struck (rev6 #5):** no index in this slice; the CHECK's purpose is now the exact-string role readers (`query.ts:163`, `is-project-pm.ts:30`, `project-manager.ts:36`, `queue.ts:172,291`) and the future index slice. **Applies cleanly (probe x2):** 0 rows outside the set, 0 case/space variants, of 2 rows — weak evidence alone. Whole-suite scan: 55 parsed write sites — 28 `pm`, 24 `engineer`, 3 `qs`. Aravind reports prod holds `pm` and `engineer` only (not in this log): §11 `n2`. `docs/schema.md:127` (`role TEXT NOT NULL`) becomes stale.
2. **Deferred — the `<>` tenant comparison at `019:230`.** Changes the logic of a live SECURITY DEFINER function (review-gate (a), `CLAUDE.md:192-205`); needs its own migration and package; masked today by `019:237-243` (`019:224-229`).
3. **Deferred — the unfiltered membership count: TWO count-shaped sites, in the future slice (§4.8).** **(a) `lib/whatsapp/project-resolution.ts:37`** — `supabase.from('project_members').select('project_id').eq('user_id', userId)`, then 0 / 1 / 2+ (`:39-63`). **(b) `supabase/migrations/033_sweep_stale_morning_sessions.sql:220-222`** — `SELECT count(*), (array_agg(project_id))[1] … FROM project_members WHERE user_id = v_row.user_id`, then `IF v_project_count != 1` (`:224-233`). Scoping (a) changes bot behaviour in `lib/whatsapp/` (barred to this slice); scoping (b) replaces a shipped function (F1). Ten other unfiltered per-user reads are a *different shape* (scope/existence lookups), found by a throwaway scan (`scan_unfiltered.py`, **not in the repo**, printed in the log): `app/(dashboard)/dprs/page.tsx:32`, `app/(dashboard)/projects/page.tsx:35`, `lib/daily-logs/query.ts:142,384,558`, `lib/dpr/dispatch.ts:411`, `019:133`, `019:238`, `023:175`, `040:353`.
4. **Prod phone-format evidence is a single row.** Reported by Aravind (not in this log): `+` + 12 digits, prefix `+91`, **n=1 — the whole population observed**, consistent with `normalisePhoneNumber`'s output for an Indian mobile. One row cannot show any other stored value shares that form. Test-db holds no `+91` (probe g). §11 `g`, `r`.

### 4.6 Residual risk — known and accepted, NOT closed
**The validator catches malformed numbers, not wrong ones.** A correctly formatted number with one digit wrong is **a stranger's live handset**; that person will receive a check-in from the production sender with **no opt-in**, at the next scheduled send (`vercel.json:12-19`; `roster.ts:165-168`, `checkpoint-trigger.ts:226-233`). The confirm step (§5), the attestation (§2.8) and deactivate (§2.9) are **mitigations, not a solution**; deactivation does not free the number. **A known and accepted risk, not a closed one.**

### 4.7 D12 SETTLED (rev6) — Option D: the partial unique index leaves this slice; no fixture is reshaped
**Decision (Aravind, 19 Sep 2026):** remove the partial unique index on `project_members(user_id) WHERE role='engineer'` from this slice entirely. Do not reshape any test fixture. Move the index, together with the deferred role-scoping of the count sites, into one named future slice (§4.8).
**Reasoning, recorded in Aravind's terms:**
1. **The add screen can never trip the index:** every pasted row is a fresh `users.id`, so the screen never creates a second membership; existing numbers are rejected (R5–R7a).
2. **A second engineer membership already fails LOUDLY today:** the engineer is sent `MULTIPLE_MEMBERSHIPS_REPLY` (`project-resolution.ts:60-63,74-75`; `route.ts:244-247`), `resolveEngineerProject` captures a Sentry warning (`project-resolution.ts:55-59`), and the sweep **skips** the session (`033:224-233`) and reports it to Sentry with a per-session fingerprint (`lib/daily-logs/morning-cutoff-sweep.ts:141-144`). It is a visible state, not a silent one — visible to the engineer and to Sentry; **the PM is not told** (recorded, not disputed).
3. **The index enforces only half the rule:** `pm` on P1 + `engineer` on P2 passes it and **still bricks the engineer**, because both count sites are role-blind (`project-resolution.ts:37`; `033:220-222`). The other half is the role-scoping already deferred. Splitting them means doing the same fixture rework **twice** against half a rule.
4. **Every other D12 option reshapes fixtures to fit a constraint** — the pattern that let the correction-gate bug hide behind `users.role='pm'` fixtures (§3.6). Mixed roles **applied to the incidental sites** (the only way they could cover #4–#7 below) provably inverts `dpr-stage1-plumbing.test.ts:207-217`, whose point is that a non-PM member is **not** picked up as the project manager (`project-manager.ts:31-36` selects `role = 'pm'`). (As scoped in rev5, Option A covered only the three multiplicity tests, so on its own it would not have unblocked those 35 call sites at all.)

**The finding this rests on (kept as input to the future slice).** `ensureMorningFixtures()` upserts the shared morning engineer (`testEngineerId()`, `test/helpers/db.ts:193-198,445`) as an `engineer` member of `TEST_PROJECT_ID` (`db.ts:490-498`); several files then add that same engineer to a fresh per-test project, and three files build a deliberate two-project engineer. Seven files construct "one user, two `engineer` memberships" as ordinary setup:
| # | File : lines | Setup | Tests hit (derived) | Failure mode with an index |
|---|---|---|---|---|
| 1 | `test/unit/project-resolution.test.ts:77-81` | `userMany` on `projectA` + `projectB`, one bulk insert | 7 of 7 (`beforeAll` throws `:82`) | loud, whole file |
| 2 | `test/unit/morning-cutoff-sweep.test.ts:516-517` | two separate `upsert`s, `error` never read | 1 of 15 (`:507-543`; the file header's "13" is stale) — the only test of the sweep's skip path | **silent**: fails later at `:522-528` for the wrong reason |
| 3 | `test/webhook.test.ts:239-246` (`ensureGateUser` `:181-185` + `secondProjectId`) | `multiUserId` on two projects | 16 of 16 (`beforeAll` throws `:246`) — incl. T-WH-01, required by `CLAUDE.md:1002-1006` | loud, whole file |
| 4 | `test/dpr-generate-job.test.ts:72-76`; calls `:112,206,297,328,378` | shared engineer on a fresh project | 5 of 7 | loud, per test |
| 5 | `test/dpr-generate-trigger.test.ts:40-44`; calls `:136,155,175,197` | same | 4 of 6 | loud, per test |
| 6 | `test/dpr-stage1-plumbing.test.ts:27-31`; calls `:54,71,95,127,153,212` | same | 6 of 9 | loud, per test |
| 7 | `test/owner-deliver-job.test.ts:121-127`; 20 calls `:430`–`:1046` | same | 20 of 21 | loud, per test |
**"59 tests" is DERIVED, not observed** (rev6 #4): 7 + 1 + 16 + 5 + 4 + 6 + 20, from reading the setup calls of these 7 named files; I did **not** run the suite, and a red run needs the index, which exists nowhere. **These 7 files are untouched by this slice.** Not affected (checked): `checkin-escalations-sweep` and the sweep's loop at `:144` (distinct users), `rehearse-038.ts:355` (one pair), `TEST_PROJECT_A_ID` tests (distinct users).
~~**Options A/B/C/D (rev5)**~~ — superseded by Option D. Full option table, coverage analysis and costs: `git show fad98e3:docs/plans/add-engineer-plan.md` (§4.7).

### 4.8 What this slice ships without — and the future slice; D13 (F4) options
**This slice ships with NO database enforcement of one-project-per-engineer, and the add screen is the only place the rule exists.** Stated precisely: the screen never creates a second membership (§4.7 #1) — that is the whole of the rule as this slice delivers it. **Nothing else prevents one:** the RLS insert policy lets any tenant admin or `pm` insert a `project_members` row for any tenant user with any allowed role (probes j, k), and the service role and SQL can too.
**`UNIQUE (project_id, user_id)` at `001:79` stays exactly as it is** — the same user twice on the *same* project is still prevented; membership uniqueness was **not** dropped. `docs/schema.md:129-130` ("One active project per engineer — enforced at insert in app logic, NOT a DB constraint") remains as true as it was — and no app code enforces it today (grep g5).
**The named future slice — "the one-project-per-engineer slice" — contains, together:** (i) the partial unique index (definition kept for it: `CREATE UNIQUE INDEX uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`; not `CONCURRENTLY`, `docs/migration-runbook-template.md:34`; pre-check = query `e` from rev5, plus the prod queries then); (ii) role-scoping of `resolveEngineerProject` (`project-resolution.ts:37`); (iii) role-scoping of the sweep's count (`033:220-222`) — added to the slice because the third bullet of §4.7 makes it the same half-rule; (iv) the rework of the 7 files in §4.7, done once against the whole rule; (v) the CHECK from this slice as its prerequisite.
**Design input for that slice (kept from rev5 T4):** `pm` on P1 + `engineer` on P2 **passes** the index, and that user, if they text the bot, still gets `MULTIPLE_MEMBERSHIPS_REPLY` while the sweep parks their morning session — **allowed is not works** — until (ii) and (iii) land.

**D13 — F4: excluding deactivated engineers from the PM's screens (OPEN; not chosen).** Is it a predicate change in app code, or something larger? **Both, depending on what "excluded" means:**
- **The predicate itself is small.** The board roster (`query.ts:159-163`) would join `users!inner(…)` and add `.eq('users.status','active')`, the pattern already used at `roster.ts:164-168` and `checkin-escalations/roster.ts:62-65`. It sits in **one file** that feeds **two of the three affected surfaces** (Daily Logs and Today). The third surface — the project-detail team list — is a separate query (`projects/[id]/page.tsx:56-58`).
- **But it is larger than a predicate, for two reasons.** (1) **It is in `lib/daily-logs/`,** a directory this slice was told not to touch, so it is a scope-boundary decision before it is a technical one. (2) **`users.status` is a current-state flag, not a per-day fact,** and the board is per-date and roster-driven: a log with no roster entry is **not displayed at all** (`query.ts:226-260` iterates the roster and attaches logs by key). Filtering on current status would therefore **erase the engineer's card, and every day they *did* check in, from the board for all past dates.** The code already documents this exact limitation for `messaging_blocked` and scopes that branch to today (`status.ts:103-115`). D10's `deactivated_at` (this migration) is the per-day fact that would allow a date-aware version, for engineers deactivated after this ships.
| | Option | What it changes | Cost / risk |
|---|---|---|---|
| **1** | **Do nothing in this slice** | nothing; the consequence above stands | Zero code. A PM sees a deactivated engineer as failing every day, indefinitely, on Daily Logs and Today, and inflates the "things that need you" count; the team list shows nothing. The one place a PM would look to confirm it worked contradicts it. |
| **2** | **Hide by `users.status`** (predicate in `query.ts:159-163`; optional marker/hide in the team list) | one file for two surfaces (+ one more for the team list) | Small change; **erases past days' cards** for that engineer (data remains in DB, DPRs and `daily_logs`, but not viewable on the board); needs a `lib/daily-logs/` edit (boundary); board tests (`test/dash-03-board*.test.ts`) use active engineers (**not read**, UNKNOWNS). |
| **3** | **Hide date-aware using `deactivated_at`**: show the card for dates before the deactivation day (IST), hide from that day on | board query + IST date comparison (`lib/daily-logs/date.ts`) + Today loop | Larger: depends on this migration's column; **legacy deactivated rows have NULL** (none on test-db, probe t; prod unread — their meaning is undefined); more tests; still the `lib/daily-logs/` boundary. Keeps history. |
| **4** | **Show an explicit "Deactivated" state** instead of "Not checked in" (new state in `status.ts`, the card, and excluded from Today's needs-attention and its count) | `status.ts`, `engineer-card.tsx`, `daily-logs/page.tsx`, `dashboard/page.tsx` | Largest; adds a state and one new **blank** string constant; gives the PM the visible confirmation the current design lacks; stays forever unless combined with 3. |
(Related, pre-existing, same root cause: because the roster is current-state, a **newly added** engineer also shows "Not checked in" on past dates before they joined — relevant to how the add screen will look; `status.ts:130-137`.)

## 5. The flow, and atomicity
**Flow:** paste → **Preview** (dry-run) → **Confirm** — a step naming the count of rows about to be created (`formatAddConfirm({ count })`) plus the admin-facing consent attestation (`ADD_CONSENT_ATTESTATION`), with the apply control **disabled until ticked** (UI only) → **Apply**. The action re-parses the raw text server-side, refuses if the re-parsed accepted count differs from the confirmed count, and passes the tick state to the function as `p_consent_attested`, recorded not enforced (D9). **Atomicity:** all-or-nothing per apply call; if any row is not `ok` at apply, or a concurrent add wins, nothing is written and the admin sees `ERROR_BATCH_NOT_APPLIED` and re-previews. Concurrency (T15) is **not verifiable locally** (`CLAUDE.md:478-486`).

## 6. The migration
- **File:** `048_engineer_registration.sql` (name **ASSUMED**). **Number 048** (`origin/main` ends at 047; reservations end at 048 "RELEASED, NEVER USED … free"); **ASSUMED still free at write time** (`CLAUDE.md:869-872`). Held in `docs/reviews/` until applied (`CLAUDE.md:947-952`).
- **What it still contains, stated plainly:** (1) **the CHECK `role IN ('pm','qs','engineer','owner','subcontractor','admin')` on `project_members.role`** (D8/D11); (2) **the five attribution columns** on `users` (`registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at`) **with their pairing CHECKs and composite same-tenant FKs**; and, unchanged because they never depended on the index, (3) the internal helper, (4) `add_engineers_to_project`, (5) `deactivate_engineer`, (6) their ACLs (§2.7).
- ~~(2) the partial index `uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`, "not `CONCURRENTLY`", and "sequencing constraint (D12): the fixture change must land before the migration is applied to test-db"~~ — **struck (rev6 #2):** the index is in the future slice (§4.8); there is no fixture change.
- **`UNIQUE (project_id, user_id)` (`001:79`) is unchanged.** ~~"`UNIQUE (project_id, user_id)` is insufficient… Partial, because PMs hold `pm` memberships on many projects"~~ — that argument was for the index and moves with it.
- **If prod has rows the CHECK would reject** (a role outside the six, or a case/space variant): it fails and the whole file aborts with no change (query `n2`). ~~"the index fails `23505` (query `e`)"~~ struck. Test-db: probe x2 — 0 rows.
- **Review gate (`CLAUDE.md:192-205`) clearly tripped** (a, b, c; a `DROP COLUMN` in the DOWN is destructive (d)). Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`); `service_role` denial on the **real** database; ACL / `proowner` / `proconfig` for **all three** functions; disposable local dry-run first (`CLAUDE.md:1020-1030`); rehearsal on the cleaned test-db (`CLAUDE.md:74-78`).
- **DOWN:** drop the functions, the CHECK, the five columns (~~and the index~~); commented per `down-section-must-be-commented` (`CLAUDE.md:1135-1139`, `scripts/lint-migrations.mjs:547-552`) and **rehearsed** (`CLAUDE.md:1120-1128`); dropping the columns destroys attribution data.
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`, foreground, never `db push` (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it (`CLAUDE.md:142-146`).

## 7. Positive controls
"Shown to fail" = a captured red run, then the fix, then green. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`), never on test-db or prod.

### 7.1 Tests
| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T1** | A caller with `users.tenant_id` **NULL** is refused, nothing written, both modes. **Fixture: `role='admin'`, `tenant_id` NULL, real `auth_id`** (constructed; test-db's 3 NULL-role stubs would not exercise it). Expected `no_data_found`. | **Red against a `<>` comparison first:** scaffold variant `IF project.tenant_id <> caller.tenant_id` — `NULL <> uuid` is NULL, the guard does not fire, the engineer is written into the **project's** tenant → fails. Then `IS DISTINCT FROM` → green. |
| T2 | *(folded into T6)* | |
| ~~T3~~ | ~~A second `role='engineer'` membership for the same user on another project is rejected `23505` naming `uq_project_members_one_engineer_project`~~ — **struck (rev6 #3): tests the dropped index.** Moves to the future slice. | |
| ~~T4~~ | ~~`admin` with `pm` memberships on P1 and P2 unaffected; `pm` on P1 + `engineer` on P2 allowed by the index~~ — **struck (rev6 #3): depended on the index.** Its consequence ("allowed is not works") is kept in §4.8. | |
| **T5** | A **tenant-B engineer's number** classified by a **tenant-A admin** (dry-run) returns `number_registered`; the row has **exactly the keys `idx, status`**; the serialised payload contains **no** tenant-B project id, project name, or full name — asserted **on the payload**. A tenant-B engineer with **no membership** also returns `number_registered`, never `registered_no_project`. In-tenant: `on_another_project` (`other_project_name`, no id/full name), `registered_no_project` (`idx, status`). | Mutations: (i) leak name/full_name/project id cross-tenant → fails; (ii) classify only within the caller's tenant → cross-tenant number returns `ok` → fails; (iii) return `registered_no_project` cross-tenant → fails. |
| **T6** | **One shared fixture matrix (§7.2), run twice:** against the **TypeScript gate** and the **SQL function**; both return the expected verdict on every row and agree. | Mutate each side separately (membership-only rule) → the `qs`-with-`pm`-membership row fails on that side; mutate one side → the agreement assertion fails. |
| **T7** | **Dry-run writes nothing.** After a dry-run that returns `ok` verdicts, row counts of `users` and `project_members` are unchanged; asserts ≥1 `ok`. | Mutation: let dry-run fall through to step 7 → counts change → fails. |
| **T8** | An unauthorised caller's dry-run gets an error, **not** statuses. | Mutation: move step 5 before step 3 → statuses leak → fails. |
| **T9** | **Shape and round-trip.** The validator over the §3.3 corpus **generated from `TEST_BOUNDARY_PHONE_LITERAL` by formatting and mutation only**; accepted → the stored form, fixed point under `normalisePhoneNumber`; the function accepts the generic shape, rejects malformed. | Red: pin `normalisePhoneNumber('abc')` → `'+abc'` (`normalise.ts:42`), assert the validator rejects. Mutation: store raw input → round trip fails. |
| **T10** | **Explicit columns, attribution, consent.** (a) Read-back: `tenant_id`, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = caller's `users.id`, `registered_at` non-null and equal across a call's rows, `consent_attested` = the value passed**; membership `role='engineer'`, same tenant. (b) **Source guard**: the `INSERT INTO public.users` column list contains all of them. | Mutations: drop `registered_by` → (a),(b) fail; write `auth.uid()` → (a) fails; drop `status` → (b) fails. |
| **T11** | **Deactivate.** (i) Tenant-A admin cannot deactivate a tenant-B user (`no_data_found`), zero writes. (ii) `pm` without membership, and `qs`/NULL role with a membership: `insufficient_privilege`. (iii) Positive control: the engineer **is** in `fetchMorningRoster`, gate `proceed`; after deactivation **excluded** (`roster.ts:150,203`) and `gated_noop` (`reactivation.ts:29-33`); number and membership untouched. (iv) `deactivated_by`/`deactivated_at` set; a **second call returns `already_deactivated` and does not overwrite**. | (i) drop tenant binding → fails; (iii) function absent → fails; set `messaging_blocked` instead → gate returns `reactivate` → fails; (iv) always-write mutation → timestamp changes → fails. |
| **T12** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty. | **Expected-fail at commit** (`it.fails`): blank → assertion fails → test passes; when the copy PR fills them the wrapper goes red. **Verified** on vitest 3.2.7 (scratch dir, re-run in this log): blank → PASS, filled → FAIL, control PASS. No live `it.fails` exists in `test/` (grep f2). |
| **T13** | **Boundary test** (§7.3): one literal through the function in apply mode; read back; cleaned up. | Function absent → fails. |
| **T14** | End state: after adding one engineer, `resolveEngineerProject` returns `resolved` and the morning roster includes them. | Function absent → `zero_memberships`. |
| **T15** | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md:478-486`). |
| **T16** | **ACL evidence** on the real test-db for all three functions: anon → `42501`; `service_role` denied; `authenticated` may call the two public functions and **not** the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` = `search_path=public`. | Before the REVOKEs, `service_role`/PUBLIC hold EXECUTE (probe n, `correct_daily_log`). |
| **T17** | Tenant-A admin with a tenant-B `p_project_id` gets `no_data_found` **identical** to a nonexistent id, zero writes. | Mutation raising `insufficient_privilege` for foreign ids → fails. |
| **T18** | **Atomicity.** Row K fails after step 5 → **zero** new rows. | Mutation: per-row `EXCEPTION` sub-blocks → earlier rows persist → fails. |
| **T19** | **The CHECK.** On test-db, inserting a `project_members` row with role `'Engineer'`, `'engineer '`, `'ENGINEER'` or a value outside the six is rejected `23514`; each of the six valid roles succeeds. ~~"a second `'engineer'` membership is still caught by T3"~~ struck. | Natural red: **before** the migration those inserts succeed (probe h; probes j/k) → fails. |
| **T20** | **Consent is recorded, not enforced.** `p_consent_attested = false` (and NULL) does not block apply; stores `false`; `true` stores `true`. | Mutation: raise on false → fails; skip writing the column → read-back fails. |
| **T21** | **Boundary-literal source guard.** In `test/`, `+91` followed by a digit appears **only** in `test/helpers/boundary-phone.ts`; the boundary test imports `test/helpers/db.ts`, imports **no** module under `lib/whatsapp/outbound/` or `app/api/cron/`, and creates its fixture project with `status <> 'active'`. | Mutation: second `+91` literal / import `send.ts` / `active` project → fails. |
| ~~T22~~ | ~~Existing-fixture acceptance (D12): the 7 files pass on a DB carrying the index~~ — **struck (rev6 #3):** no index in this slice, no fixture change; moves to the future slice. | |

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
**Fixture gap (limit):** DB fixtures are `+1…` (`test/helpers/db.ts:43,112,132-134,233`): 1,868 × 14 digits and 2 × 11 digits (probe g), none `+91`; the **one** boundary test drives the literal directly.
**The three confirmations, from printed output:**
1. **Test-db only — SHOWN at the harness level:** `test/setup/guard.ts:9-61` aborts the run unless the ref is `exfccwlrhoutkgrlikod`, wired as `globalSetup` (`vitest.config.ts:31`); `vitest.config.ts:9` loads only `.env.test`; `db.ts:205-207,953-955` build clients from `SUPABASE_TEST_*`, and `db.ts:26-28` says tests avoid the app env names because they "could resolve to production". The boundary test does not exist yet; T21 guards it uses `db.ts`.
2. **No row with this number exists on test-db — SHOWN** (probe v): 0 in `users`, `whatsapp_sessions`, `outbound_sends`, `processed_messages`.
3. **No real Twilio send — SHOWN for every path in the repo and database; NOT shown for deployed-environment configuration; neutralised structurally.** *Shown:* probe w — no triggers on `users`/`project_members`/`projects`, no `pg_net`/`pg_cron`/`http` (only `supabase_vault`); only two modules send (`trigger.ts:206`, `owner-deliver-dispatch.ts:503`); the engineer path is reached only via `runCheckpointTrigger` → `fetchActiveProjects` → roster (`checkpoint-trigger.ts:226-233`, `roster.ts:285-288`) started by `CRON_SECRET`-authorised cron routes (`morning-trigger/route.ts:29-36`); `readCredentials` throws unless all three `TWILIO_*` are set (`send.ts:154-176`); the real `.env.test` holds the **name** `TWILIO_AUTH_TOKEN` only (names, never values) and outbound tests stub fake credentials and mock `fetch` (`outbound-trigger.test.ts:173-181`); Vercel's documentation (re-fetched into this log, page last updated 2026-09-16): "…makes an HTTP GET request to your project's production deployment URL…". **Structural neutraliser (T21):** the boundary test's fixture project has `status <> 'active'` (probe z: the CHECK allows `on_hold`), so the roster never loads it.
   *Not shown:* that the deployed Production environment's variables do not point at test-db, and that no other scheduler calls the cron routes with the secret (Vercel dashboard, unreadable from here). Not blocking, because the non-active-project rule removes the path regardless; **if Aravind disagrees, treat (3) as blocking.** Limit: concurrent CI runs collide on `UNIQUE (whatsapp_number)`; surfaces as R7 (**ASSUMED** tolerable).

## 8. RLS
Live (probes j, k, o): `users` — `users_select` (own or same tenant), `users_update` (own row; column grant `full_name, avatar_url`, `015:105`); no INSERT/DELETE policy, `authenticated` lacks both (`015:114`). `project_members` — select tenant-scoped; insert/update require tenant match AND `users.role IN ('pm','admin')` **with no condition on the inserted row's `role`** (§4.5); no DELETE policy (`047:230`). Both tables owned by `postgres`, RLS on, **not forced**. **The three functions bypass RLS**; the gate is re-stated inside (§1). Still enforced regardless of RLS: composite FKs (`017:94-106`), `UNIQUE (whatsapp_number)`, `UNIQUE (project_id, user_id)` (`001:79`), `users_role_check`, `users_status_check`, the new CHECK, the pairing CHECKs. Cross-tenant: tenant is never an input (§2.4).

## 9. Strings — every value blank; Aravind writes all wording
No wording is drafted anywhere in this document. **Every value is blank and carries `// Wording owed, NOT approved`** (`Tamil owed, NOT approved` means approved English awaiting Tamil, `lib/photos/copy.ts:3-6`; not these). Home: `lib/engineers/copy.ts` (new). **rev6 removes none and adds none:** I checked every rejection case R1–R8 and every constant against the dropped index — **none existed only because of it** (R5–R7a are lookups on the number, `001:44`); the only index-dependent text was in prose. D13's Option 4 would add **one blank constant** (a "Deactivated" state label) *if chosen* — not added now.
**Formatters, after `formatKeptUntilLine`** (`lib/photos/copy.ts:23-46`: exported function, **named positional parameters**; **ASSUMED positional**): `PREVIEW_SUMMARY` → `formatPreviewSummary(accepted, rejected)`; `RESULT_SUMMARY` → `formatResultSummary(added)`; `REJECT_NAME_TOO_LONG` → `formatRejectNameTooLong(max)`; `ERROR_PASTE_TOO_LONG` → `formatErrorPasteTooLong(max)`; `ADD_CONFIRM` → `formatAddConfirm(count)`; `REJECT_ON_ANOTHER_PROJECT` → `formatRejectOnAnotherProject(projectName)` (in-tenant only); `formatRegisteredLine(registeredByName, registeredAt, consentAttested)`; `formatDeactivatedLine(deactivatedByName, deactivatedAt)`.
**Constants (blank):** `ADD_ENGINEERS_PAGE_TITLE`, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_ENGINEERS_TEXTAREA_LABEL`, `ADD_ENGINEERS_PREVIEW_BUTTON`, `ADD_ENGINEERS_APPLY_BUTTON`, `ADD_ENGINEERS_EDIT_BUTTON`, `PREVIEW_ROW_ACCEPTED`, `PREVIEW_ROW_REJECTED`, `REJECT_NO_NAME`, `REJECT_BAD_NUMBER`, `REJECT_DUPLICATE_IN_PASTE`, `REJECT_ALREADY_ON_THIS_PROJECT`, `REJECT_NUMBER_REGISTERED` (generic; the only rejection ever used cross-tenant), `REJECT_REGISTERED_NO_PROJECT`, `PREVIEW_NOTHING_TO_APPLY`, `RESULT_ROW_ADDED`, `ERROR_BATCH_NOT_APPLIED`, `ERROR_PROJECT_NOT_FOUND`, `ERROR_NOT_ALLOWED`, `ERROR_PASTE_EMPTY`, `ERROR_GENERIC_SAVE`, `PROJECT_PAGE_ADD_ENGINEERS_LINK`, `ENGINEERS_LIST_TITLE`, `DEACTIVATE_CONTROL`, `DEACTIVATE_CONFIRM`, `DEACTIVATE_RESULT`, `DEACTIVATE_ERROR_NOT_FOUND`, `ADD_CONSENT_ATTESTATION`, `ENGINEER_STATUS_ACTIVE`, `ENGINEER_STATUS_DEACTIVATED`. **Removed earlier (kept):** ~~`RESULT_ROW_RACE`~~, ~~`RESULT_ROW_FAILED`~~, ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~. **Existing approved strings (reference, do not copy):** `route.ts:55-62`; `project-resolution.ts:71-72`, `:74-75`; `hindrances/actions.ts:24` (not exported, not reusable). **T12** asserts every export is non-empty (expected-fail at commit).

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)
The log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.
| Probe | Result |
|---|---|
| ~~(a) users with >1 `project_members` row~~ | 0 rows — **no longer gating** (was for the index) |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers missing tenant or whatsapp | **2** (whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| ~~(e) index-predicate violations~~ | 0 rows — **no longer gating** |
| (f) `project_members` | 2 rows, both `engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits, zero `+91` |
| (h) live constraints | `users_role_check` = the six-role set; no CHECK on `project_members.role`; `UNIQUE (project_id, user_id)` present |
| (i–l) indexes, policies, grants, nullability | as cited |
| (n) definer inventory | 15 functions, owner `postgres`, all `search_path=public` |
| (o) owner / RLS forced | `postgres`, on, not forced |
| (p) `get_user_tenant_id()` | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` |
| (r, s) columns | no actor column; only `tenants.registered_address` |
| (t) role distributions | `project_members`: 2 × `engineer`; `users`: 10 admin, 3 NULL-role, 1,872 engineer, all `active`, no `pm` |
| (v) boundary literal presence | **0** in all four tables |
| (w) triggers / extensions | none on the three tables; only `supabase_vault` |
| **(x2) six-role-set violations / case-space variants / total** | **0 / 0 / 2** |
| (z) orphans; projects | **1,870** engineers with no membership vs 2 with; 14 projects, all `active` |
**Would the six-role CHECK apply cleanly on test-db? YES** (x2).

## 11. For Aravind — run against PROD (not run by me)
Read-only; confirm the project ref first.
```sql
-- (g) stored phone SHAPES, digits masked
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (n) DISTINCT project_members.role values, exact
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (n2) would the six-role CHECK apply on prod? any row here blocks it
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
~~(a) users with more than one `project_members` row~~ and ~~(e) the exact index predicate~~ — struck (rev6 #2): they gated the index. They return with the future slice (§4.8).

## 12. File list
**Created (later build slice, not by this plan):** `docs/reviews/048_engineer_registration.sql` (moves to `supabase/migrations/` only at apply), `docs/reviews/048-review-package.md`; `app/(dashboard)/projects/[id]/engineers/new/page.tsx` and `actions.ts`; `app/(dashboard)/projects/[id]/engineers/page.tsx` and `actions.ts` (routes **ASSUMED**); `lib/engineers/parse-roster.ts`, `gate.ts`, `add-engineers.ts`, `deactivate.ts`, `copy.ts`; tests per §7, `test/helpers/engineer-gate-matrix.ts`, **`test/helpers/boundary-phone.ts`**, `test/migration-048.test.ts`.
**Modified (build slice):** `scripts/migration-number-reservations.json`; `docs/build-status.md`; `docs/schema.md` (only the `role TEXT NOT NULL` line goes stale, `:127`); `types/database.ts` (regenerated); `app/(dashboard)/projects/[id]/page.tsx` — one optional link. **No existing test file is modified** (D12 = Option D) — ~~the 7 files in §4.7~~ stay as they are. **Pending D13:** if Option 2, 3 or 4 is chosen, `lib/daily-logs/query.ts` (a directory this slice was told not to touch) and possibly `lib/daily-logs/status.ts`, the card, and the two pages.
**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`, or any existing migration; `is-project-pm.ts` and `normalise.ts` are imported, not edited. **This revision's diff:** exactly `docs/plans/add-engineer-plan.md`.

## Decisions
| | Status |
|---|---|
| D1, D2/D5, D3, D4, D6, D7, D8, D9, D10, D11 | **settled** |
| **D12** the partial unique index and the 7 broken test files | **settled (rev6): Option D — the index leaves this slice; no fixture reshaped; named future slice (§4.8)** |
| **D13** F4: deactivated engineers stay visible on Daily Logs, Today and the team list (§2.9, §4.8): Option 1 do nothing / 2 hide by status / 3 hide date-aware / 4 explicit "Deactivated" state | **OPEN — product decision; not blocking the build** |

## UNKNOWNS
**Not determinable from printed source or the test database:**
1. **Prod state.** Queries n/n2 (roles; CHECK violations); prod phone shapes (Aravind reports one row, `+91`, n=1 — not in this log, unverified by me); users by role; orphans (w); deactivated-user sessions (y); whether prod already has the new columns (u).
2. **What Twilio actually sends in `From`.** Only `normalise.ts:4` and fixtures (`test/webhook.test.ts:263`).
3. **Prod/test-db parity for 048's target.** Probes ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** None designed.
5. **Whether an already-recorded attendance can coexist with a step-5 session on the same log day** (F1). I found no path (writers grep `a1`; `033:61-67`) but did not prove none exists.
6. **Deployed Production environment variables and any other scheduler** — not readable from here; neutralised, not proven (§7.3).
7. **Rate limiting across calls.**
8. **Which tests cover `getDailyLogsBoard`** and whether D13 Options 2–4 would break any: `test/dash-03-board*.test.ts` exist and use active engineers; **not read**.
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
10. **Whether any path creates `users.role='pm'`.** g8 found none; a pattern search cannot see live data.
11. **Whether `DEACTIVATE_CONFIRM` must name the engineer** (would become a formatter).
12. **My reading of "parsing"** (rev3 instruction A): validating jsonb elements in the function; raw-text parsing stays in TypeScript.
13. **"In the payload" (T10)** read as the insert payload.
14. **Attribution design details** (composite FKs, `ON DELETE`, pairing CHECKs, visibility) — recommendations, not rehearsed.
15. **`photo-access-route.test.ts:41` / `db.ts:27-28`** — I read only the comment lines.
16. **`it.fails` after a vitest upgrade** — verified on 3.2.7 only.
17. **Whether `consent_attested` as a boolean matches intent.**
18. **Exact digits of the T9 corpus** (derived from the literal) — designed, not built.
19. **Whether my whole-suite scan of `project_members` writes is exhaustive** (§4.7): it reads `.from('project_members').insert/upsert`, SQL `INSERT INTO project_members`, four wrapper helpers and loops; a differently-named helper could hide another site. The future slice must re-scan.
20. **The "59 tests" figure is derived from reading, not observed** (§4.7, rev6 #4); the future slice's first step is a real red run against an index-carrying scaffold.
21. **The PM's actual reaction and whether any PM screen outside those printed lists engineers** (D13): I traced every route file under `app/(dashboard)` and every `project_members` reader in `app`/`lib`; a component I did not open (e.g. shared UI under `components/`) could too.
22. **Legacy deactivated rows** (D13 Option 3): none on test-db (probe t); prod unread — their `deactivated_at` would be NULL.
**Assumed:** migration number 048 still free and the file name; routes `projects/[id]/engineers[/new]`; TypeScript gate and SQL function stay in agreement (T6 tests, does not prove); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`; T15 un-testable here; no in-flight bot session depends on the new functions; colliding CI runs on the boundary literal are tolerable; the default `ON DELETE` on attribution FKs is right.
**Decisions still open:** **D13** (product; not blocking).
