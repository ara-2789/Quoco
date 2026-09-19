# Add-engineer screen — build plan (rev4)

> PLAN ONLY. rev1 `c86c5b6` (2026-09-18 23:06 IST), rev2 `e67e297` (2026-09-18 23:41 IST), rev3 `9b9187c`
> (2026-09-19 00:15 IST) — each pinned (`git show <sha>:docs/plans/add-engineer-plan.md`). rev4 written 2026-09-19 (IST)
> on `feat/add-engineer-plan`, base `origin/main` @ `0744110` (re-fetched; unchanged). No application code, no migration
> file, no SQL intended to ship. Tier: FULL (identity, tenant isolation, new migration).
>
> **Evidence rule.** Every claim cites source printed in `~/Desktop/add-engineer-plan-rev4.txt` ("the log"). Citations are
> `path:line`; database claims cite `probe <letter>`; four throwaway scripts (not in the repo, not shipping) are printed with
> their output. Anything not printed is **ASSUMED** or under UNKNOWNS. The log begins (Section 0) by restating four sentences of my
> rev3 report that reached Aravind truncated, with what each cut hid.
>
> **Correction discipline.** Retracted claims stay visible as ~~strikethrough~~ with a dated correction, in the blocks below and inline.
>
> **Settled by Aravind, applied without re-raising:** D1 `status='active'` plus attribution; D2/D5 SECURITY DEFINER function;
> D3 India-mobile only (TypeScript); D4 caps (100-char names, 50 lines); D6 role-gate intersection; D7 dry-run flag; **D8** CHECK on
> `project_members.role` in the same migration; **D9** consent attestation *recorded, not enforced*; **D10** record who deactivated and when.

## Scope

**In scope:** paste → preview (dry-run) → confirm → apply for adding site engineers to ONE project; a **deactivate** control; attribution
columns (`registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at`); the partial unique index; the CHECK on
`project_members.role`.
**Deferred, named:** file upload/extraction; reassigning an existing number to another project; **removing** an engineer or **freeing a number**
(deactivate does neither, §2.9); editing an engineer; duplicate-name detection; reactivating a deactivated engineer from the dashboard; the
ENG-01 opt-in flow; rate limiting across calls; the `<>` tenant comparison at `019:230`; scoping `resolveEngineerProject` to `role='engineer'`
(both named in §4.5); cleaning up session rows for deactivated engineers (finding F2, §2.9).

## Dated corrections, 19 Sep 2026 (rev4) — every change in this pass

| # | Earlier text (retracted) | rev4 result | Where |
|---|---|---|---|
| 1 | ~~rev3 heading "Dated corrections, 18 Sep 2026 (rev3)" and rev3's inline "CORRECTED 18 Sep 2026 (rev3)" in Scope~~ | **Wrong date.** The rev3 log's first line reads `started Sat Sep 19 00:01:34 IST 2026` and the rev3 commit is `2026-09-19 00:15:46 +0530` (log). rev3 was written on **19 Sep in IST**; it was still 18 Sep only in UTC (18:31–18:45 UTC). This project keeps IST (`CLAUDE.md`, cutoffs), so 19 Sep is the record. rev1 (22:55–23:06 IST) and rev2 (23:26–23:41 IST) headings, 18 Sep, are correct as written. My rev3 report even said the system date was 19 Sep and I kept 18 Sep anyway; that was the error. | rev3 block below |
| 2 | ~~rev3 §3.6 / rev3 correction #5: "India-only in SQL is rejected because the DB fixtures are all `+1…`, so every DB test would become impossible"~~ | **The reason was wrong**, though the decision stands (India rule in TypeScript, generic E.164 in SQL). Test-fixture shape must never decide a production constraint: that is the failure that let the correction-gate bug hide (evidence in §3.6). Replacement reason and the accepted limit recorded in §3.6. | §3.6 |
| 3 | ~~rev3 §4.5 item 1 / D8 "open — recommended"~~ | **Settled:** CHECK `role IN ('pm','engineer')` in the same migration. Underlying finding recorded (RLS policy places no restriction on the inserted row's `role`). **New conflict found and flagged:** three test sites write `role: 'qs'` into `project_members` and would fail at fixture setup (D11). | §4.5 |
| 4 | ~~rev3 D9 "open"; rev3 §5 "the apply action … refuses if the attestation is absent"; rev3 §2.1 three-parameter signature~~ | **Record, do not enforce.** New column `consent_attested`; the function takes a fourth parameter and records it; nothing inside the function refuses. The screen's apply control is disabled until the box is ticked (UI only). | §2.1, §2.6, §5 |
| 5 | ~~rev3 D10 "open — not specified, not added"~~ | **Settled:** `deactivated_by`, `deactivated_at`, written by `deactivate_engineer` in the same UPDATE. | §2.8, §2.9 |
| 6 | ~~rev3 T12 / §7.1: "wrapped in vitest `it.fails`; the repo already uses this, e.g. `test/evening-flow.test.ts:128`"~~ | **Wrong.** There is **no executable `it.fails` in `test/` today**; all hits are comments recording past use (grep f2: zero non-comment lines). The practice is documented and was used (`section-42-unmatched-capture.test.ts:16-22`). Its behaviour is now **verified by running it** on the installed vitest 3.2.7 in a scratch directory (log): blank assertion → test passes; filled → wrapper fails (the flip). | §7 T12 |
| 7 | ~~rev3 UNKNOWNS #5 "session cleanup not traced"~~ and rev3 §2.9 "silent-dropped" as the whole story | **Traced** (log). Findings F1 and F2 in §2.9: the morning sweep still writes for a deactivated engineer, and evening/hindrance session rows are left parked indefinitely. Not fixed here. | §2.9 |
| 8 | ~~rev3 UNKNOWNS #6 / §2.7 "`pg_temp` not settled"~~ | Resolved as far as the repo goes: all 15 existing definer functions carry exactly `search_path=public` (probe n); the new functions follow. | §2.7 |
| 9 | ~~rev3 §7.3 "the row is created `active` on test-db, where no cron runs against real Twilio (ASSUMED)"; `TEST_BOUNDARY_PHONE_LITERAL` "value owed"~~ | Literal supplied (`+919176861156`). The "assumed" is replaced by a shown/not-shown breakdown (§7.3). | §7.3 |
| 10 | ~~rev3 R7 "same tenant with no membership → generic `number_registered`"~~ | Split: a same-tenant engineer with **no membership** now returns its own status `registered_no_project` (in-tenant only; cross-tenant stays generic). Reason: otherwise the admin has no signal and the engineer's own reply loops back to the PM (F3, §2.9). | §4 |
| 11 | ~~rev3 §7.2 presented all matrix rows as equally real~~ | Rows 3–8 (`users.role='pm'` and similar) are **fixture-only shapes**: test-db has no `pm` user (probe t) and real PMs are `admin` + `pm` membership. Row 2 is the real shape. | §7.2 |
| 12 | ~~rev3 §6 "**[D8]** a CHECK … optional"~~ | Now a definite item of the migration (gated on D11). | §6 |
| 13 | ~~rev3 §3.3 evidence list and §3.2 quoted specific ten-digit values~~ | Individual digit strings removed from prose (instruction: mint no other `+91` value anywhere); the corpus is in the log. | §3 |
| 14 | (new) | Added: residual-risk statement (D); the restated truncations (Section 0 of the log); new strings (F); new tests T19–T21; `docs/schema.md:127-130` noted stale. | throughout |

## Dated corrections, ~~18 Sep 2026~~ **19 Sep 2026** (rev3) — every change in that pass (date corrected in rev4, #1)

| # | rev2 said (retracted) | rev3 result |
|---|---|---|
| 1 | ~~§9 "`// Tamil owed, NOT approved`" citing `lib/photos/copy.ts:13-20`~~ | Mis-citation: that comment marks *approved English awaiting Tamil* (`copy.ts:3-6`). Unapproved wording uses `// Wording owed, NOT approved`, which exists nowhere yet (grep s2). |
| 2 | ~~§2.3 step 1 explicit NULL-tenant refusal; T1 fixture a NULL-role stub~~ | One null-safe comparison; T1 fixture `role='admin'` with NULL tenant (the stub could never have gone red: the role gate refuses NULL role first). |
| 3 | ~~§1 `isProjectPm` unused; page render via empty dry-run~~ | Advisory TypeScript gate reusing `isProjectPm`; T6 runs one matrix against both. |
| 4 | ~~§1/§2.3 "`admin`, or `pm` + membership"~~ | Restated as D6's intersection (same outcomes). |
| 5 | ~~§2.3/§3.7 function re-asserts the India shape; T9 two implementations agree~~ | India rule in TypeScript only; SQL asserts generic E.164. *(The reason given for this was itself retracted in rev4 #2.)* |
| 6 | ~~§3.5 listed a `whatsapp:` prefix as accepted paste input~~ | Rejected by the paste validator (V1). |
| 7–14 | rev2 §3.6 rejected list; §3.6 fixture claim; §9 plain constants; UNKNOWN #1; §6 migration scope; §12 file list; new dry-run/deactivate/attribution/validator/strings/tests | See the pinned rev3 text `git show 9b9187c:docs/plans/add-engineer-plan.md`. Fixture claim corrected: shapes 11-digit, 14-digit and a run-scoped nested form; probe g: 1,868 × 14 digits and 2 × 11 digits; none starts `+91`. |

## Dated corrections, 18 Sep 2026 (rev2) — kept (dates verified correct, rev4 #1)

| # | rev1 said (retracted) | rev2 result |
|---|---|---|
| 1–12 | ~~§1 "tighter than the policy"; §0 service-client claim; §2 two-client design; §3 "prod unread"; §4 quoted labels; R6 "index enforces"; §5 partial apply; §6 "048 reserved, 049 next"; §7 T8/T10; §8 residual; §9 three per-row strings; §12 `classify.ts`~~ | Gate moved into the function; no service client; one transaction; drafted wording removed; R6 is a lookup; all-or-nothing; 048 is free (reservations file: "RELEASED, NEVER USED … 048 is free"); strings folded into `ERROR_BATCH_NOT_APPLIED`. Full rows: `git show e67e297:docs/plans/add-engineer-plan.md`. |

## 0. Findings that shape the plan — read first

1. **`status='active'` (D1) departs from ENG-01** (`docs/bot-flows.md:303-308`: `pending` + opt-in template + audit row). None of that exists in code (greps g1–g3: the only
   `quoco_engineer_optin` hit is a comment, `route.ts:209`; no `registered_by`; grep c1/c3: none of `registered_by`, `registered_at`, `consent_attest*`,
   `deactivated_by`, `deactivated_at` exists in `app lib supabase scripts test types`; probe s: none on any table). A non-`active` user is silently dropped by the webhook
   (`reactivation.ts:29-33`) and every roster. So `active` is the only value that works today; the missing consent step is recorded and mitigated (§2.8, §4.6), not solved.
2. **The partial index cannot fire from this screen's own inserts** — every pasted row is a new `users.id`. T3 inserts directly.
3. **`users.status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`); the gate is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users`**: no INSERT (probe k, `015:114`), UPDATE only on `full_name, avatar_url` (`015:105`), only UPDATE policy is own-row (probe j). So add
   and deactivate both need definer functions; no service client (g4: none under `app/(dashboard)`).
5. **Phone chain: no mismatch, but no validator exists** (§3).
6. **Migration number 048** is free (log: `origin/main` migrations end at 047; reservations end at 048, "RELEASED, NEVER USED … 048 is free").
7. **Deactivation propagates through `users.status`** (§2.9), but two side-effects are **findings** (F1, F2) and one dead end exists for engineers with no membership (F3).
8. **A test/production shape gap decides real bugs in this repo** (§3.6): six test sites `update({ role: 'pm' })` on a fixture profile while real PMs are `admin`.
9. **Conflict with D8's set:** three test sites write `role: 'qs'` into `project_members` (§4.5, D11).

## 1. Authorisation

**The rule (D6).** With the caller resolved as the `users` row where `auth_id = auth.uid()`: `users.role IN ('admin','pm')` **AND** the project exists **in the caller's tenant**
**AND** (`users.role = 'admin'` **OR** a `project_members` row with `role = 'pm'` for this `(user, project)`). Identical outcomes to rev3's "admin, or pm + membership" (T6 matrix).
It is the intersection of the DB policy's role list (`project_members_insert`, probe j) and per-project membership; `qs`/`engineer`/NULL-role users never pass, even with a `pm` membership.

**Where each role column is written.** `users.role='admin'` for a self-serve account: `005:76-80`, `016:177-181`. `project_members.role='pm'` for a project's creator:
`app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM is `users.role='admin'` + `project_members.role='pm'`. grep g8: nothing writes `users.role='pm'` outside tests; probe t: test-db
has 10 admins, 3 NULL-role stubs, 1,872 engineers, **no `pm` user**. Effective rule today is tenant-wide; the per-project narrowing only bites a `users.role='pm'` account.

**Two implementations, one authority.** SQL (authoritative): the internal helper (§2.7) used by both functions. TypeScript (advisory only): pure `decideEngineerAdminAccess`, deciding whether to
*show* the link, page and deactivate control; its membership leg reuses `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`). If they disagree, SQL wins. T6 catches drift.

## 2. The add function — SECURITY DEFINER (`add_engineers_to_project`)

### 2.1 Contract (signature and behaviour; no body is written here)

`(p_project_id uuid, p_engineers jsonb, p_dry_run boolean, p_consent_attested boolean) → jsonb`. No parameter defaults (`CLAUDE.md:361-372`). `p_engineers` is an array of
`{ name, whatsapp_number }`, the number **already validated and normalised by TypeScript** (§3); the function asserts only the generic stored shape (§3.6).
~~rev3: three parameters~~ — the fourth is new (rev4 #4). In dry-run, `p_consent_attested` is ignored. In apply it is recorded as `coalesce(p_consent_attested, false)`.

Return `{ applied: boolean, rows: [ { idx, status, … } ] }`. Status values are machine identifiers, not wording. **Allowed fields per status — the whole payload:**

| status | fields | note |
|---|---|---|
| `ok` (dry-run: would be added) | `idx, status` | |
| `added` (apply) | `idx, status, user_id` | |
| `already_on_this_project` | `idx, status` | no name, no id |
| `on_another_project` | `idx, status, other_project_name` | **the caller's own tenant only** |
| `registered_no_project` | `idx, status` | **same-tenant engineer with no membership only** (new, rev4 #10) |
| `number_registered` | `idx, status` — **exactly these two keys** | the generic outcome; never a project id, project name, or full name |

### 2.2 The dry-run flag (D7) — specified behaviour, both modes

`p_dry_run = true`: authorisation, tenant binding, argument validation and **full classification**; returns the payload apply would; **writes nothing**. The preview calls it this way.

**Why it exists, plainly.** Without it a cross-tenant collision is invisible at preview (a preview under RLS reads only its own tenant's `users`, probe j `users_select`) and **aborts the whole
all-or-nothing batch at apply**. With it, preview and apply run the *same code path*, and the collision is caught at preview and reported only generically.

1. **Authorisation runs BEFORE any number lookup, in both modes** (§2.3 steps 1–3 precede step 5). An unauthorised caller learns nothing about which numbers exist; they get an error.
2. **Cross-tenant collisions are `number_registered`**: payload exactly `{idx, status}` — no project id, no project name, no full name. T5 asserts on the payload's key set.
3. **Apply re-runs every check** in its own transaction and never trusts the preview's verdicts; nothing from the preview is passed in except the same input rows.
4. Dry-run performs no writes (T7 asserts row counts unchanged).

### 2.3 Order of operations (one transaction)

1. **Resolve the caller:** `users` where `auth_id = auth.uid()` (`019:170-171`; live `get_user_tenant_id()` body, probe p). None → `insufficient_privilege` (`019:172-175`). `auth.uid()` is never compared to `users.id`
   (decoupled since 007: `007:127`, `007:60-67`, `uq_users_auth_id` `007:76-78`); engineers/owners have `auth_id` NULL (`CLAUDE.md:833-840`) so are never callers.
2. **Load the project; tenant-bind NULL-safe.** Missing, **or** `project.tenant_id IS DISTINCT FROM caller.tenant_id` → `no_data_found`, one indistinguishable error (`019:219-222`). `projects.tenant_id` is
   NOT NULL (`001:55`), so a NULL-tenant caller always fails here. **This single comparison is the only tenant-binding mechanism** (T1 targets it).
3. **Role/authority gate (§1)**, else `insufficient_privilege`.
4. **Validate the argument:** 1..50 rows (`program_limit_exceeded`, `019:208-212`); each element a non-empty `name` ≤ 100 chars and a `whatsapp_number` matching the generic stored shape; duplicate numbers
   → `invalid_parameter_value` (caller bugs, TypeScript filtered them).
5. **Classify every row** (R5–R7, §4).
6. If `p_dry_run`, or **any** row is not `ok` → write nothing, return `applied: false`.
7. Otherwise insert per row (§2.6) and return `applied: true`. Any exception rolls back everything; a concurrent add of the same number loses on `UNIQUE (whatsapp_number)` (`001:44`, probe h; `23505`).

**The NULL trap in the precedent (deferred, §4.5).** `019:230` is `IF v_tenant_id <> get_user_tenant_id()`; a NULL tenant makes it NULL and the guard passes (masked in 019 by `019:224-229`). The new function does not copy it.

### 2.4 `tenant_id` is derived from the project row, never a parameter
(a) A parameter is caller-controlled; accepting it means validating it and a miss writes a user into the wrong tenant. (b) The function bypasses RLS; the composite FKs (`017:94-106`, probe h) validate the
*membership* but not the `users.tenant_id` *value*. (c) It removes a class of test cases.

### 2.5 Ownership and grants
Precedent printed in full: `019:149-297` (`SECURITY DEFINER SET search_path = public` `:156`; `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` `:294-295`). Live (probe n): all 15 definer functions are owned by
`postgres`; `correct_daily_log` still holds `service_role:EXECUTE`, hence the per-role rule (`CLAUDE.md:910-918`). Tables are owned by `postgres`, RLS on, **not forced** (probe o): an owner-run function bypasses RLS.

### 2.6 Columns written (explicit wherever a default or NULL would hide a bug)

**`users` row** (live columns, probe r; defaults, probe l):

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
| **`registered_at`** | `now()` in the function — never a parameter | new |
| **`consent_attested`** | `coalesce(p_consent_attested, false)` — recorded, not enforced (D9) | new; the **claim as passed** |
| not set | `avatar_url, hierarchy_level, reporting_manager_id, delegation_active, employee_id, notification_email, notification_email_verified_at, whatsapp_declined_at, deactivated_by, deactivated_at` | nullable |

**`project_members` row:** `id`/`created_at` defaults; `tenant_id` = derived tenant; `project_id` = `p_project_id`; `user_id` = the new id; `role` = literal `'engineer'` (exact string — and now constrained, §4.5 D8).

### 2.7 Shared internal helper; search_path; grants of all three functions
Steps 1–3 live in one **internal helper** returning `(caller id, caller tenant)` or raising; both public functions call it. The helper is **not callable from outside**: `REVOKE EXECUTE … FROM PUBLIC, anon,
authenticated, service_role`. Public functions: `REVOKE EXECUTE … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`.

**`search_path` — resolved from source (rev4 #8).** Live probe n: all **15** existing definer functions have `config = {search_path=public}` and nothing else; the declarations read `SECURITY DEFINER SET search_path = public`
(`019:156`, `012:85-87`, `033:170-171`; the grep of all 71 `SECURITY DEFINER` lines is in the log). **The new functions follow exactly that: `SET search_path = public`, no `pg_temp`, every object schema-qualified, no
dynamic SQL** (contrast `019:246,265`). I did not evaluate whether the house style is itself best; I am following it as instructed. `service_role` is revoked because it carries no `auth.uid()`.
**Alternative, one line:** duplicate steps 1–3 inline in both functions (no helper ACL to test, but two copies that can drift).

### 2.8 Attribution — `registered_by`, `registered_at`, `consent_attested`, `deactivated_by`, `deactivated_at` (C, D9, D10)

**Confirmed absent.** grep c1/c3 (code, migrations, scripts, tests, generated types) and probe s (live catalog, all tables): none of the five exists; the lone `registered*` hit is the unrelated `tenants.registered_address`.
Probe r: `users` has no actor column (`auth_id, avatar_url, created_at, delegation_active, employee_id, full_name, hierarchy_level, id, messaging_blocked, notification_email, notification_email_verified_at,
reporting_manager_id, role, status, tenant_id, whatsapp_declined_at, whatsapp_number`); `project_members` has only `created_at, id, project_id, role, tenant_id, user_id`.

**Why they ship now and cannot be reconstructed later.** After apply nothing on either row records *who* created or deactivated it — only `created_at` — and the only other trace is request logging outside the
database, which this repo does not read and whose retention it does not control. The 1,872 existing engineer rows are already unattributable (NULL, not a guess).

**D9 — recorded, not enforced, and why.** The consent attestation is written as `consent_attested` next to `registered_by`. It is **not enforced inside the function**: a direct caller can pass any value, so a
refusal would buy nothing, while the recorded claim plus `registered_by` and `registered_at` answers "who confirmed this, and when" later. What is recorded is **the caller's claim**, not proof of consent. The screen's apply
control is disabled until the box is ticked (UI only; ~~rev3: "the server action refuses if absent"~~ retracted).

**D10 — deactivation attribution.** Same justification: accepting one and refusing the other is inconsistent. `deactivate_engineer` writes `deactivated_by` (resolved caller's `users.id`) and `deactivated_at` (`now()`) in the same
UPDATE as `status='deactivated'`. **Limit:** one slot per row — a future reactivation and second deactivation would overwrite; no history table.

**Design (recommended, reviewer-flagged):** all five columns nullable on `users`; pairing CHECKs — `(registered_by IS NULL) = (registered_at IS NULL) AND (registered_by IS NULL) = (consent_attested IS NULL)`, and
`(deactivated_by IS NULL) = (deactivated_at IS NULL)` — after the precedent `036…:232-244`; composite same-tenant FKs `(registered_by, tenant_id)` and `(deactivated_by, tenant_id)` → `users (id, tenant_id)` in the style of
`017:94-106` (`users_id_tenant_id_key` exists, probe h), default `ON DELETE` so deleting an admin cannot silently erase attribution (**ASSUMED**). New columns are readable to same-tenant users via the existing table-level SELECT and
`users_select` (probes k, j); UPDATE stays limited to `full_name, avatar_url` (`015:105`) (**ASSUMED** acceptable). Departure from ENG-06 (`bot-flows.md:308`, an audit *row*): columns on the user row; editing name/number (deferred)
would overwrite what was registered.

### 2.9 Deactivate — the SECOND SECURITY DEFINER function (`deactivate_engineer`)

**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb` `{ status: 'deactivated' | 'already_deactivated' }`. Same helper, gate, tenant binding and grants as §2.7. Locate the target: `users u JOIN project_members pm`
with `u.id = p_user_id`, `u.role='engineer'`, `u.tenant_id` = derived tenant, `pm.project_id = p_project_id`, `pm.role='engineer'`; **not found → `no_data_found`** (indistinguishable from a foreign or missing project). Then one
UPDATE: `status='deactivated'`, `deactivated_by`, `deactivated_at`. Already deactivated → `already_deactivated`, **no write, no overwrite of the first attribution.** `'deactivated'` is permitted by `users_status_check` (probe h).
**Does NOT:** delete anything; touch `whatsapp_number`, `messaging_blocked`, `project_members`, or `whatsapp_sessions`; send anything; reactivate; use dynamic SQL.

**KNOWN LIMIT — the number stays held.** Deactivation does not free `whatsapp_number`: the global `UNIQUE (whatsapp_number)` (`001:44`, probe h) keeps it reserved, and the `project_members` row keeps the partial-index slot. **A mistyped
number cannot be corrected from the dashboard; the only repair path is manual SQL**, a production write under `CLAUDE.md`'s apply rules.

**Deactivation takes effect with no further change — printed source.** Webhook: `decideInboundGate` returns `gated_noop` for any `status !== 'active'` (`reactivation.ts:29-33`), the header forbids silent reactivation
(`:11-14`), the clear-half re-asserts `status='active'` (`:64`); called at `route.ts:159`, returning `twimlEmpty()` at `route.ts:161-163`. Outbound cron: `fetchActiveEngineers` filters `.eq('users.status','active')`
(`roster.ts:168`); both exported rosters use it (`:203`, `:248`); it is module-private (`:150`), so tests use the exported rosters. Also filtering: `lib/checkin-escalations/roster.ts:65`,
`app/api/cron/dpr-generate/route.ts:80`, `lib/dpr/accountability.ts:159`, `lib/dpr/dispatch.ts:417-418`. Why `status` and not `messaging_blocked`: the flag would make the gate return `reactivate` (`:36-38`).

### Session trace (E) — findings, named, not fixed
Traced from `lib/whatsapp/session.ts`, `route.ts:146-330`, `012:60-200`, `033` and `jobs/tick`.
- **How a deactivated engineer's inbound is handled.** Gate at `route.ts:159-163` returns `twimlEmpty()` **before** idempotency, project resolution and any session call. No session write, no reply.
- **F1 — the morning sweep still writes for a deactivated engineer.** `sweep_stale_morning_sessions` runs inside `jobs/tick` every 60 s (`033:154-157`, `tick/route.ts:106`) after the 15:00 IST cutoff (`033:186-196`),
  selects `whatsapp_sessions WHERE current_flow = 'morning'` (`033:199`) with **no join to `users` and no status check**, and for an engineer with exactly one membership (`033:220-233`) either stamps
  `daily_logs.morning_submitted_at` (steps 2–4, `033:235-245`) or **inserts an `absent`, `attendance_defaulted = true` row** (step 5, `033:265-280`), then closes the session (`current_flow := NULL`, `033:96-99`). So an in-flight
  morning session of an engineer deactivated mid-flow yields a `daily_logs` write **attributed to a deactivated engineer** the same day. Whether the PM's Daily Logs view then shows it: **not traced** (UNKNOWNS #5).
- **F2 — evening and hindrance sessions are left parked indefinitely.** The sweep covers `'morning'` only (`033:199`). `expires_at` is written but read by nothing (grep s3: only `session.ts:31`, writes in `012:100,181`,
  and a comment at `033:32`) and nothing deletes session rows (grep s4: zero). The only reset is the BOT-07 next-day wipe inside `acquire_and_transition_session` (`012:115-121`), reached only by an inbound past the gate
  or a cron send — neither can happen for a deactivated engineer (`route.ts:161-163`; `roster.ts:168`). So the row keeps `current_flow`, `current_step`, `context` and `pending_flows` **indefinitely**: inert, but a stuck row.
- **What is observed.** *The engineer:* silence — no reply to any message and no more check-ins; indistinguishable from an outage. *The PM:* deactivate result and a deactivated marker in the list; that day's evening half stays
  incomplete, and escalation, DPR roster and accountability all skip the engineer (`checkin-escalations/roster.ts:65`, `dpr-generate/route.ts:80`, `accountability.ts:159`). Nothing alerts.
- **F3 — the engineer with no project membership (the deactivate-scope case).** They **cannot be deactivated from the dashboard**: `deactivate_engineer` requires an engineer-role membership on the project, and the engineers list
  is built from `project_members` (the same shape as `projects/[id]/page.tsx:49-65`), so **the admin sees nothing to click**. Before rev4 the only signal was the generic add-path rejection (no actionable meaning, and no string named
  the situation). Meanwhile that engineer, if `active`, texts in, passes the gate, and gets `replyForProjectResolution` at `route.ts:244-247` (`ZERO_MEMBERSHIPS_REPLY`, `project-resolution.ts:71-72`: ask your Project Manager
  to add you) — but the PM **cannot** add them (R7a) or deactivate them: a **dead end** until the deferred reassign slice or manual SQL. Test-db holds **1,870** such engineers (probe z; fixtures); prod count is unread (§11 `w`).
  The sweep also parks such a morning session rather than closing it (`033:224-233`). rev4 gives the add path a distinct in-tenant status for this case, `registered_no_project` (§4), and a constant (§9); it does **not** fix the dead end.

## 3. Phone numbers and the validator

### 3.1 The chain
`route.ts:111`: `fromNumber = normalisePhoneNumber(params.From ?? '')`; `route.ts:130-133` looks up `.eq('whatsapp_number', fromNumber)`. Only helper: `normalisePhoneNumber` (`route.ts:5`). Inbound form: `+` + digits, no `whatsapp:`
prefix, no separators (`normalise.ts:13-15,18,21-23`). Downstream passes it through verbatim (`dispatch.ts:180,199,217`; `inbound-start.ts:463,852`; `session.ts:58,91`). **No mismatch with the prod stored form** (`+` + 12 digits) provided the
screen stores `normalisePhoneNumber(raw)` output and nothing else. That real Twilio sends `whatsapp:` + E.164 rests on a comment (`normalise.ts:4`) and fixtures (`test/webhook.test.ts:263`).

### 3.2 Status of the validator — the consequence, stated explicitly
`normalise.ts` **never rejects anything** (`normalise.ts:40-42`, "Caller should validate downstream"), and **no validator exists anywhere in the repo** (the phone `git grep`; the one schema CHECK is
`outbound_sends_to_phone_number_check`, `031:478-479`, probe q). `links.ts:10-11` and `reactivate-copy.ts:48-52` say the guarantee "lives upstream at the write paths"; grep g5 shows no engineer write path exists, so this screen is the
first. **Consequence:** without a validator in front of it, a mistyped line stores a well-formed-looking row that can never match an inbound message (the webhook compares the *normalised inbound* number for equality,
`route.ts:133`) and **permanently holds that value under the global unique** (`001:44`), with no removal path in this slice (§2.9). The executed probe shows what `normalisePhoneNumber` alone would have stored for the rejected
classes: letters gain a `+` prefix, the empty string becomes `"+"`, a too-short value gains one, a value with trailing text keeps the text, and a `00`-prefixed international form keeps its zeros.

### 3.3 Validation happens BEFORE normalisation — the exact rule
On each raw pasted token, in order: **V1 charset** — only ASCII digits, `+`, whitespace, `-`, `(`, `)` (the separators `normalise.ts:18` strips); anything else rejects (letters incl. a `whatsapp:` prefix and "ext", non-ASCII digits,
empty). **V2 separators** — remove whitespace, `-`, `(`, `)` → `t`. **V3 shape** — `t` must match exactly one of `S1 ^\+91[6-9][0-9]{9}$`, `S2 ^91[6-9][0-9]{9}$`, `S3 ^0[6-9][0-9]{9}$`, `S4 ^[6-9][0-9]{9}$`.
Only then call `normalisePhoneNumber(raw)` and **assert** the result matches the single stored form and is a fixed point.
**Single stored form: `^\+91[6-9][0-9]{9}$`** (13 characters). **Reuse, not reimplementation:** import `normalisePhoneNumber` (`lib/whatsapp/normalise.ts:9`); never edit or copy it.
**Evidence (throwaway probe, printed with output, re-run in this log):** 34 inputs (14 accepted, 20 rejected), **0 violations**. Accepted: separator variants of the `+91` form, the `91`-without-plus form, the `0`-prefixed form, and
the bare 10-digit form (including a 10-digit value that itself starts `91`). Rejected: a `whatsapp:` prefix; `00`-prefixed input; non-Indian `+` numbers; too-short and too-long values; a first digit outside 6–9; letters; empty and
whitespace-only; a lone `+`; a doubled `+`; trailing letters; non-ASCII digits; trailing "ext".

### 3.4 What the preview shows on failure
The row with the **raw text exactly as pasted** (never a normalised guess) and `REJECT_BAD_NUMBER`. Nothing is written for it; it is never sent to the function; other rows still preview.

### 3.5 Line format (D4)
One engineer per line; the number is the trailing run of digits, `+`, spaces, hyphens, parentheses; the name is the rest, trimmed of trailing `,` `-` `:` `|` tab and spaces. Blank lines ignored. Name ≤ 100 characters; paste ≤ 50 lines.

### 3.6 The function's shape check is generic — ACCEPTED LIMIT, with the corrected reason (rev4 #2)
The function asserts `^\+[1-9][0-9]{1,14}$`, the shape of `outbound_sends_to_phone_number_check` (`031:478-479`, probe q), so a stored value cannot later violate that CHECK when the cron sends. The India-only rule lives **in TypeScript only**.

~~**Struck reason (rev3):** "India-only in SQL is rejected because every DB fixture is `+1…`, so an India-only SQL check would make every DB test impossible."~~ **Retracted 19 Sep 2026.** Test-fixture shape must never decide a
production constraint. This repo has already been bitten by exactly that: six test sites set a fixture profile's `users.role` to `'pm'` (`test/migration-019.test.ts:123,222`, `daily-log-detail-query.test.ts:69`,
`dpr-detail.test.ts:97`, `migration-023.test.ts:121`, `daily-log-correction-rpc.test.ts:87`), while a real PM's `users.role` is `'admin'` on prod (`is-project-pm.ts:11-16`, `016:177-181`); the gate passed on fixtures and failed a real PM on
2026-09-17. (That the fixtures are why it stayed hidden is Aravind's characterisation; the six sites and the source comment are what I printed.)

**Replacement reason, recorded as an ACCEPTED LIMIT:** (1) **the screen is the only intended caller** — no code calls the function yet, and a direct API caller must be an authenticated tenant admin/PM (§2.3 steps 1–3), bounded by the 50-row cap;
(2) **the residual risk is a stored row that never matches an inbound message, which is recoverable** (manual SQL; nothing is lost or corrupted); (3) **minting Indian test numbers is unsafe**: every `+91[6-9]…` value is a routable live handset, so a
general Indian fixture block would put real people's numbers in a database (§7.3). **Stated plainly:** an authorised caller who bypasses the screen can store any well-formed E.164 number, not only an Indian mobile, and a foreign or mistyped
number would be sent check-ins by the cron. **Accepted, not closed.**

## 4. Rejection cases — which are reachable where

Preview = TypeScript parse (R1–R4) then the function with `p_dry_run = true` (R5–R7). Apply = parse again, then the function with `p_dry_run = false`, re-running R5–R7 against current state.

| # | Reason | Detected by | Preview? | Apply? | Shown by |
|---|---|---|---|---|---|
| R1 | Empty name | TypeScript | yes | re-run | `REJECT_NO_NAME` |
| R2 | Name over 100 | TypeScript | yes | re-run | `formatRejectNameTooLong` |
| R3 | Bad number (§3.3) | TypeScript | yes | re-run | `REJECT_BAD_NUMBER` |
| R4 | Same number twice in the paste | TypeScript, first wins | yes | re-run | `REJECT_DUPLICATE_IN_PASTE` |
| R5 | Engineer already on **this** project | `already_on_this_project` | yes | yes | `REJECT_ALREADY_ON_THIS_PROJECT` |
| R6 | Engineer on **another project in the caller's own tenant** | `on_another_project` + that project's name | **yes** | yes | `formatRejectOnAnotherProject` (in-tenant only) |
| R7a | **Same-tenant engineer with no project membership** | `registered_no_project` | yes | yes | `REJECT_REGISTERED_NO_PROJECT` |
| R7 | Any other existing number: **another tenant**, or same tenant but not an engineer | `number_registered`; global `UNIQUE (whatsapp_number)`, `001:44` | yes (the dry-run flag) | yes | `REJECT_NUMBER_REGISTERED` (generic) |
| R8 | A concurrent add commits the same number between steps 5 and 7 | `23505`, rollback | **no** | **yes**, whole batch | `ERROR_BATCH_NOT_APPLIED` |

**Reachable at preview:** R1–R7 (R7 including cross-tenant). **Reachable only at apply:** R8 (and unexpected errors). **R6 is never an insert failure** — every pasted row is a new `users.id`, so the partial index cannot fire from this function;
it is a lookup result, and cross-tenant it cannot be reported: the function names a project only when the existing user's tenant equals the caller's. R7a is likewise in-tenant only: a tenant-B engineer with no membership, classified by
a tenant-A admin, is R7 (generic), never R7a. Whole-request refusals: unauthenticated (redirect); `no_data_found` → `ERROR_PROJECT_NOT_FOUND`; `insufficient_privilege` → `ERROR_NOT_ALLOWED`; empty → `ERROR_PASTE_EMPTY`; over the cap → `formatErrorPasteTooLong`.
**Number-existence oracle, bounded not closed:** authorisation precedes lookup, generic payload, 50 rows per call; **no rate limit across calls** (UNKNOWNS #7).

### 4.5 Findings, decisions and deferred items

1. **`project_members.role` CHECK — D8 SETTLED: add it, in the same migration.**
   **Underlying finding.** The RLS insert policy places **no restriction on the `role` value of the row being inserted.** Live (probe j): `project_members_insert` has `with_check = ((tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE
   users.auth_id = auth.uid()) = ANY (ARRAY['pm','admin'])))` — the `users.role` it tests is the **caller's**, not the new row's `role`. Probe k: `authenticated` holds INSERT on `project_members`. Probe h: no CHECK on `project_members.role`. **So any tenant admin or
   pm can write an arbitrary role string today**, and `'Engineer'`, `'engineer '` or `'ENGINEER'` would **silently escape the partial index** (whose predicate is `role = 'engineer'`). (Shown from the catalog and grants; I did not run a write, being read-only.)
   **Allowed set: `('pm','engineer')`.** Evidence: `app`, `lib` and `scripts` write only `'pm'` and `'engineer'` (the write-site scan in the log: 24 `pm`, 20 `engineer`); Aravind reports prod holds `pm` and `engineer` only (not in this log);
   test-db holds `engineer` only (probe t) and **0 rows** violate the CHECK (probe x). **It applies cleanly to data.**
   **NEW CONFLICT — flagged, not resolved (D11).** Three test sites write `role: 'qs'` into `project_members`: `test/dash-03-board-photo-gate.test.ts:69-70`, `test/photo-access-route.test.ts:147-148`,
   `test/photo-access-boundary-agreement.test.ts:137` (scan). They clean up afterwards (test-db holds none now), but with the CHECK their fixture upserts would **fail at setup**. Two ways out, neither taken here: change those three fixtures to a valid
   non-`pm` role (they use `'qs'` only as "a non-PM member"), or add `'qs'` to the set (the `users.role` vocabulary includes `qs`, `CLAUDE.md:833-840` region). The plan states `('pm','engineer')` as instructed; the build slice must not start until D11 is answered.
   Also: `docs/schema.md:127-130` still says the role is `NOT NULL` free text and "One active project per engineer — enforced at insert in app logic, NOT a DB constraint"; both become stale (not edited: only this file may change).
2. **Deferred, out of scope — the `<>` tenant comparison at `019:230`.** It changes the logic of a live SECURITY DEFINER function (review-gate trigger (a), `CLAUDE.md:192-205`), so it needs its own migration, package and rehearsal; today it is masked by the
   membership check at `019:237-243` (`019:224-229`). This plan only ensures the *new* function does not copy it.
3. **Deferred, out of scope — scoping `resolveEngineerProject` to `role='engineer'`.** It counts every `project_members` row for the user whatever the role (`lib/whatsapp/project-resolution.ts:37`); scoping it changes bot behaviour in `lib/whatsapp/`,
   which this slice may not touch, and belongs with the webhook work.
4. **Prod phone-format evidence is a single row.** Reported by Aravind (not in this log): `users.whatsapp_number` on prod is `+` + 12 digits, prefix `+91`, **n=1 — the whole population observed**, consistent with `normalisePhoneNumber`'s output for an Indian mobile.
   One row cannot show that any other stored value shares that form. Test-db holds no `+91` (probe g). Queries `g` and `r` in §11 read more.

### 4.6 Residual risk — known and accepted, NOT closed (D)
**The validator catches malformed numbers, not wrong ones.** A correctly formatted number with one digit wrong is **a stranger's live handset**; that person will receive a check-in message from the production sender with **no opt-in**, at the next
scheduled send (`vercel.json:12-19`: 08:30 and 18:30 IST; roster rules `roster.ts:165-168`, `checkpoint-trigger.ts:226-233`). The confirm step (§5), the consent attestation (recorded, §2.8) and the deactivate control (§2.9) are **mitigations, not a solution**:
they slow a mistake and record who made it; none prevents it or recalls a sent message, and deactivation does not free the number. **This is a known and accepted risk, not a closed one.**

## 5. The flow, and atomicity
**Flow:** paste → **Preview** (dry-run) → **Confirm** — a step naming the count of rows about to be created (`formatAddConfirm({ count })`) plus the admin-facing consent attestation (`ADD_CONSENT_ATTESTATION`), with the apply control **disabled until ticked** (UI only)
→ **Apply**. The action re-parses the raw text server-side, refuses if the re-parsed accepted count differs from the confirmed count, and passes the tick state to the function as `p_consent_attested` **as recorded, not enforced** (D9).
**Atomicity:** all-or-nothing per apply call. Rows rejected at preview are left out of the input; if any row is not `ok` at apply, or a concurrent add wins, nothing is written and the admin sees `ERROR_BATCH_NOT_APPLIED` and re-previews. Concurrency (T15) is **not verifiable locally** (`CLAUDE.md:478-486`).

## 6. The migration
- **File:** `048_engineer_registration.sql` (name **ASSUMED**). **Number 048** (log: `origin/main` ends at 047; reservations end at 048 "RELEASED, NEVER USED … free"). **ASSUMED still free at write time** — recheck (`CLAUDE.md:869-872`). Held in `docs/reviews/` until applied (`CLAUDE.md:947-952`).
- **Contents:** (1) five nullable columns on `users` with the pairing CHECKs and composite FKs (§2.8); (2) the partial index `uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'` (name clear of live `pg_indexes`, probe i; not `CONCURRENTLY`, it cannot run
  in a transaction and the skeleton wraps files in `BEGIN;…COMMIT;`, `docs/migration-runbook-template.md:34`); (3) **the CHECK `role IN ('pm','engineer')` on `project_members`** (D8, definite; **gated on D11**); (4) the internal helper; (5) `add_engineers_to_project`; (6) `deactivate_engineer`; (7) ACLs (§2.7).
- **`UNIQUE (project_id, user_id)` (`001:79`) is insufficient:** it forbids the same user twice on the *same* project; `(P1,U)`,`(P2,U)` are distinct pairs. **Partial, because** PMs hold `pm` memberships on many projects (`projects/new/page.tsx:49-54`).
- **If prod has violating rows** (query `e`): the index fails `23505`; the whole file aborts with no change; no auto-dedupe (destructive statements are pinned). Same for the CHECK if prod holds a role outside the set (query `n`). Test-db: probes a, e, x — 0 rows each.
- **Review gate (`CLAUDE.md:192-205`) clearly tripped:** new SECURITY DEFINER functions (a, b), identity (c), a `DROP COLUMN` in the DOWN is destructive (d). Whole PR needs the package. Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`); `service_role` denial on the **real** database;
  ACL / `proowner` / `proconfig` fingerprint for **all three** functions; disposable local dry-run first (`CLAUDE.md:1020-1030`); rehearsal on the cleaned existing test-db (`CLAUDE.md:74-78`).
- **DOWN:** drop the three functions, the CHECK, the index, the five columns; commented per `down-section-must-be-commented` (`CLAUDE.md:1135-1139`, `scripts/lint-migrations.mjs:547-552`) and **rehearsed** (`CLAUDE.md:1120-1128`). Dropping the columns **destroys attribution data** — irreversible for that data.
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`, foreground, never `db push` (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it (`CLAUDE.md:142-146`).

## 7. Positive controls
"Shown to fail" = a captured red run, then the fix, then green. Non-regression controls get a mutation or negative control. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`), never on test-db or prod.

### 7.1 Tests
| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T1** | A caller with `users.tenant_id` **NULL** is refused, nothing written, in both modes. **Fixture: `role='admin'`, `tenant_id` NULL, a real `auth_id`** (constructed with a service-role insert; test-db's 3 NULL-role stubs, probe t, would not exercise it). Expected `no_data_found`. | **Red against a `<>` comparison first.** Scaffold variant: `IF project.tenant_id <> caller.tenant_id`. `NULL <> uuid` is NULL, the guard does not fire, the admin gate passes, and the engineer is written into the **project's** tenant — T1 fails. Then `IS DISTINCT FROM` → green. |
| T2 | *(folded into T6; number kept so earlier references stay valid)* | |
| **T3** | A second `role='engineer'` membership for the same user on another project is rejected `23505` naming `uq_project_members_one_engineer_project` (**direct insert**). | Natural red: run on test-db **before** the migration → succeeds → fails. Capture, delete rows, apply, green. |
| **T4** | `admin` with `pm` memberships on P1 **and** P2 is unaffected; `pm` on P1 + `engineer` on P2 allowed. | Negative control on the scaffold: wrong index `UNIQUE (user_id)` → fails; real index → green. |
| **T5 (extended)** | A **tenant-B engineer's number** classified by a **tenant-A admin** (dry-run) returns `number_registered`, the row has **exactly the keys `idx, status`**, and the serialised payload contains **no** tenant-B project id, project name, or full name — asserted **on the payload**, not the rendered string. A tenant-B engineer with **no membership** also returns `number_registered`, never `registered_no_project`. In-tenant cases return `on_another_project` (with `other_project_name`, no id/full name) and `registered_no_project` (`idx, status` only). | Mutations: (i) return `other_project_name`/`full_name`/a project id for cross-tenant → key-set and substring assertions fail; (ii) classify only within the caller's tenant → the cross-tenant number returns `ok` → fails; (iii) return `registered_no_project` cross-tenant → fails. |
| **T6** | **One shared fixture matrix (§7.2), run twice:** against the **TypeScript gate** and against the **SQL function**; both must return the matrix's expected verdict on every row, and agree with each other. | Mutate each side separately (rev1's membership-only rule) → the `qs`-with-`pm`-membership row fails on that side; mutate one side only → the agreement assertion fails. |
| **T7** | **Dry-run writes nothing.** After a dry-run that returns **accepted (`ok`) verdicts**, row counts of `users` and `project_members` are unchanged; asserts ≥1 `ok` (not vacuous). | Mutation: let dry-run fall through to step 7 → counts change → fails. |
| **T8** | An unauthorised caller's dry-run gets an error, **not** statuses. | Mutation: move step 5 before step 3 → statuses leak → fails. |
| **T9** | **Shape and round-trip.** The validator over the §3.3 corpus **generated from `TEST_BOUNDARY_PHONE_LITERAL` by formatting and mutation only** (so no second `+91` value exists in `test/`); every accepted input → the stored form, fixed point under `normalisePhoneNumber`; the function accepts the generic shape and rejects malformed values. | Red: pin that bare `normalisePhoneNumber('abc')` returns `'+abc'` (`normalise.ts:42`), then assert the validator rejects it — fails until it exists. Mutation: store the raw input → round trip fails. |
| **T10** | **Explicit columns, attribution, consent.** (a) Read-back: `tenant_id` = project tenant, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = caller's `users.id` (not the auth uid), `registered_at` non-null and equal across the rows of one call, `consent_attested` = the value passed**; membership `role='engineer'`, same tenant. (b) **Source guard** on the migration file: the `INSERT INTO public.users` column list contains all of `tenant_id, role, status, messaging_blocked, auth_id, registered_by, registered_at, consent_attested`. *"In the payload" is read as the insert payload.* | Mutations: drop `registered_by` → (a),(b) fail; write `auth.uid()` instead of the resolved id → (a) fails; drop `status` → (b) fails. |
| **T11** | **Deactivate.** (i) Tenant-A admin **cannot** deactivate a tenant-B user (same `no_data_found` as nonexistent), zero writes. (ii) `pm` without membership, and `qs`/NULL-role with a membership: `insufficient_privilege`. (iii) Positive control first: the engineer **is** in `fetchMorningRoster` and `decideInboundGate` gives `proceed`; after deactivation they are **excluded** (`roster.ts:150,203`) and the gate returns `gated_noop` (`reactivation.ts:29-33`); `whatsapp_number` and membership untouched. (iv) **Attribution:** `deactivated_by` = caller's `users.id`, `deactivated_at` non-null; a **second call returns `already_deactivated` and does not overwrite** either column. | (i) mutation dropping tenant binding → succeeds → fails. (iii) function absent → fails; mutation setting `messaging_blocked` instead → gate returns `reactivate` → fails. (iv) mutation that always writes → the second call changes the timestamp → fails. |
| **T12** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty: each constant `!== ''`; each formatter, called with sample parameters, returns non-empty. | **Expected-fail at commit** (`it.fails`): values are blank → the assertion fails → the test passes; when the copy PR fills them → the wrapper goes red — the flip is the signal to remove it. **Verified** (rev4 #6): run in a scratch dir on vitest 3.2.7 (log): blank → PASS, filled → FAIL, control PASS. There is **no live `it.fails` in `test/` today**, so this would be its first executable use. |
| **T13** | **Boundary test** (§7.3): one literal through the function in apply mode; row read back in the stored form; cleaned up. | Function absent → fails. |
| **T14** | End state: after adding one engineer, `resolveEngineerProject` (`project-resolution.ts:31-63`) returns `resolved` and the morning roster includes them. | Function absent → `zero_memberships`. |
| **T15** | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md:478-486`). |
| **T16** | **ACL evidence** on the real test-db for all three functions: anon-key call → `42501`; `service_role` → denied; `authenticated` may call the two public functions and **not** the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` = `search_path=public`. | Before the REVOKEs, `service_role`/PUBLIC hold EXECUTE (probe n shows this for `correct_daily_log`). |
| **T17** | Tenant-A admin with a tenant-B `p_project_id` gets `no_data_found` **identical** to a nonexistent id, zero writes. | Mutation raising `insufficient_privilege` for foreign ids → fails. |
| **T18** | **Atomicity.** Row K fails after step 5 (a second connection commits a conflicting number) → **zero** new rows. | Mutation: per-row `EXCEPTION` sub-blocks → earlier rows persist → fails. |
| **T19 (new)** | **The CHECK.** On test-db, inserting a `project_members` row with role `'Engineer'`, `'engineer '`, `'ENGINEER'` or `'owner'` is rejected `23514`; `'pm'` and `'engineer'` still succeed; and a second `'engineer'` membership is still caught by T3's index. | Natural red: **before** the migration those inserts succeed (probe h: no CHECK; probes j/k: policy and grant allow them) → fails. Delete the rows, apply, green. |
| **T20 (new)** | **Consent is recorded, not enforced.** `p_consent_attested = false` (and NULL) does **not** block the apply; the row stores `false`; `true` stores `true`. | Mutation: make the function raise when false → the "does not block" assertion fails; mutation: skip writing the column → read-back fails. |
| **T21 (new)** | **Boundary-literal source guard.** In `test/`, the literal `+91` followed by a digit appears **only** in `test/helpers/boundary-phone.ts`; the boundary test imports `test/helpers/db.ts` and imports **no** module under `lib/whatsapp/outbound/` or `app/api/cron/`; it creates its fixture project with `status <> 'active'`. | Mutation: add a second `+91` literal / import `send.ts` / use an `active` project → the guard fails. |

### 7.2 The shared T6 matrix (one data table, two runners)
Columns: caller `users.role` · caller tenant vs project · membership · **expected** · whether that shape exists in prod.
| # | role | tenant | membership | expected | shape exists in prod? |
|---|---|---|---|---|---|
| 1 | admin | same | none | allow | yes (an admin who is not on the project) |
| 2 | admin | same | pm | allow | **yes — the real PM shape** (`admin` + `pm` membership) |
| 3 | pm | same | pm | allow | **no — fixture-only** (no `users.role='pm'` exists, probe t) |
| 4 | pm | same | none | not_permitted | fixture-only |
| 5 | pm | same | engineer only | not_permitted | fixture-only |
| 6 | qs | same | pm | not_permitted | fixture-only |
| 7 | engineer | same | pm | not_permitted | fixture-only |
| 8 | NULL | same | pm | not_permitted | pre-onboarding stub shape |
| 9 | admin | other tenant's project | none | not_found | yes |
| 10 | admin | caller tenant NULL | none | not_found | constructed |
| 11 | admin | project id nonexistent | — | not_found | yes |

Rows 3–8 are the shapes the correction-gate bug hid behind. **No conclusion may rest on rows 3–8 alone; rows 1, 2, 9 and 11 are the ones that exist for real.** The SQL runner calls dry-run with one generic-shape fixture number.

### 7.3 The boundary literal, and the fixture gap
**`TEST_BOUNDARY_PHONE_LITERAL = '+919176861156'`** — one named constant in one file, `test/helpers/boundary-phone.ts`, swappable in a single edit. **No other `+91` value is minted anywhere** (T9's corpus is derived from it; T21 guards this).
Checked in the log: it is 13 characters, matches the India stored form `^\+91[6-9][0-9]{9}$` and the generic shape, is a fixed point of `normalisePhoneNumber`, and equals what the webhook would compute from `whatsapp:` + the literal.

**The fixture gap (limit).** DB fixtures are `+1…` (`test/helpers/db.ts:43,112,132-134,233`; `run-scoped-fixtures.ts`): 1,868 × 14 digits and 2 × 11 digits on test-db (probe g), none `+91`. So end-to-end tests run on a shape this screen can never produce; the **one** boundary test drives the literal directly.

**Instruction B — the three confirmations, each from printed output:**
1. **The boundary test targets test-db only — SHOWN at the harness level.** `test/setup/guard.ts:9-61` aborts the entire run unless the resolved ref equals `exfccwlrhoutkgrlikod`, wired as `globalSetup` (`vitest.config.ts:31`); `vitest.config.ts:9` loads only `.env.test`; `test/helpers/db.ts:205-207,953-955` builds
   clients from `SUPABASE_TEST_*`, and `db.ts:26-28` states tests avoid the app env names because they "could resolve to production". Limit: the boundary test **does not exist yet**; the property is inherited from the harness, plus T21's guard that it uses `db.ts`.
2. **No row with this number exists on test-db today — SHOWN.** Probe v (read-only, counts only): `users.whatsapp_number` 0, `whatsapp_sessions.phone_number` 0, `outbound_sends.to_phone_number` 0, `processed_messages` 0.
3. **Nothing in the test path can cause a real Twilio send — SHOWN for every path in the repo and the database; NOT shown for deployed-environment configuration, and neutralised structurally.**
   *Shown:* (a) the test path is `rpc` to the database only; **probe w:** no non-internal triggers on `users`, `project_members` or `projects`, and no `pg_net`, `pg_cron` or `http` extension (only `supabase_vault`), so nothing inside the database can call out or schedule.
   (b) Only two modules send: `lib/whatsapp/outbound/trigger.ts:206` (engineer check-ins) and `lib/dpr/owner-deliver-dispatch.ts:503` (owner DPR); the engineer path is reached only via `runCheckpointTrigger` → `fetchActiveProjects` → per-project roster
   (`checkpoint-trigger.ts:226-233`, `roster.ts:285-288`), started by cron routes authorised by `CRON_SECRET` (`morning-trigger/route.ts:29-36`). (c) `readCredentials` throws unless **all three** of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` are set (`send.ts:154-176`); the real
   `.env.test` holds the **name** `TWILIO_AUTH_TOKEN` only (names printed, values never; log), and the existing outbound tests stub fake credentials and mock `fetch` (`outbound-trigger.test.ts:173-181`). (d) Vercel's documentation, fetched into the log (page last updated 2026-09-16), says cron requests go to "your project's
   production deployment URL". **Structural neutraliser (required, T21):** the boundary test creates its own fixture project with `status <> 'active'` (`projects.status` allows `on_hold`, probe z), and the roster only loads **active** projects, so even a mis-scheduled cron cannot reach the row; the row exists only between apply and cleanup (`afterAll` plus `finally`, plus a pre-run cleanup by exact number).
   *Not shown:* that the deployed **Production** environment's variables do not point at test-db, and that no other scheduler calls the cron routes with the secret — the Vercel dashboard is the source of truth and is not readable from here. I do **not** treat that as blocking because the non-active-project rule removes the path regardless; **if Aravind disagrees, treat (3) as blocking.**
   Limit: concurrent CI runs of this one test collide on `UNIQUE (whatsapp_number)`; it surfaces as R7, not corruption (**ASSUMED** tolerable).

## 8. RLS
Live (probes j, k, o): `users` — `users_select` (own or same tenant), `users_update` (own row; column grant `full_name, avatar_url`, `015:105`); no INSERT/DELETE policy, `authenticated` lacks both (`015:114`). `project_members` — select tenant-scoped; insert/update require tenant match AND
`users.role IN ('pm','admin')` **with no condition on the inserted row's `role`** (§4.5); no DELETE policy (`047:230`). Both tables owned by `postgres`, RLS on, **not forced**. **The three functions bypass RLS**; the gate is re-stated inside (§1). Still enforced regardless of RLS: composite FKs
(`017:94-106`), `UNIQUE (whatsapp_number)`, `users_role_check`, `users_status_check`, the new CHECK on `project_members.role`, the new index, the new pairing CHECKs. Cross-tenant: tenant is never an input (§2.4); a foreign project is treated as nonexistent (§2.3 step 2).

## 9. Strings — every value blank; Aravind writes all wording
No wording is drafted anywhere in this document. **Every value is blank and carries `// Wording owed, NOT approved`.** (`Tamil owed, NOT approved` means approved English awaiting Tamil, `lib/photos/copy.ts:3-6`; not these.) Home: `lib/engineers/copy.ts` (new).

**Formatters, after `formatKeptUntilLine`** (`lib/photos/copy.ts:23-46`: exported function, **named positional parameters**, template slot documented in a comment; **ASSUMED positional** — object-vs-positional is a build choice). Each returns blank until the copy PR.
| Requested name | Function | Named parameters |
|---|---|---|
| `PREVIEW_SUMMARY` | `formatPreviewSummary` | `accepted`, `rejected` |
| `RESULT_SUMMARY` | `formatResultSummary` | `added` |
| `REJECT_NAME_TOO_LONG` | `formatRejectNameTooLong` | `max` |
| `ERROR_PASTE_TOO_LONG` | `formatErrorPasteTooLong` | `max` |
| `ADD_CONFIRM` *(implied: names the row count)* | `formatAddConfirm` | `count` |
| `REJECT_ON_ANOTHER_PROJECT` *(name slot)* | `formatRejectOnAnotherProject` | `projectName` — in-tenant only |
| **new (D9)** | `formatRegisteredLine` | `registeredByName`, `registeredAt`, `consentAttested` — engineers-list row |
| **new (D10)** | `formatDeactivatedLine` | `deactivatedByName`, `deactivatedAt` — engineers-list row |

**Constants (blank):** `ADD_ENGINEERS_PAGE_TITLE`, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_ENGINEERS_TEXTAREA_LABEL`, `ADD_ENGINEERS_PREVIEW_BUTTON`, `ADD_ENGINEERS_APPLY_BUTTON`, `ADD_ENGINEERS_EDIT_BUTTON`, `PREVIEW_ROW_ACCEPTED`, `PREVIEW_ROW_REJECTED`,
`REJECT_NO_NAME`, `REJECT_BAD_NUMBER`, `REJECT_DUPLICATE_IN_PASTE`, `REJECT_ALREADY_ON_THIS_PROJECT`, `REJECT_NUMBER_REGISTERED` (generic; the only rejection ever used for a cross-tenant number), `PREVIEW_NOTHING_TO_APPLY`, `RESULT_ROW_ADDED`, `ERROR_BATCH_NOT_APPLIED`, `ERROR_PROJECT_NOT_FOUND`,
`ERROR_NOT_ALLOWED`, `ERROR_PASTE_EMPTY`, `ERROR_GENERIC_SAVE`, `PROJECT_PAGE_ADD_ENGINEERS_LINK`, `ENGINEERS_LIST_TITLE`, `DEACTIVATE_CONTROL`, `DEACTIVATE_CONFIRM`, `DEACTIVATE_RESULT`, `ADD_CONSENT_ATTESTATION`, `ENGINEER_STATUS_ACTIVE`, `ENGINEER_STATUS_DEACTIVATED`, and, **new in rev4**:
| Constant | Purpose | Case |
|---|---|---|
| `REJECT_REGISTERED_NO_PROJECT` | R7a: the number belongs to an engineer in this tenant who is on no project | E, F3 — the deactivate-scope / dead-end case |
| `DEACTIVATE_ERROR_NOT_FOUND` | the deactivate call returned `no_data_found` (target not an engineer of this project, or a stale list) — distinct from `ERROR_PROJECT_NOT_FOUND` | E |

No constant is added for the orphan in the deactivate list itself: an engineer with no membership **does not appear** there (F3). (`DEACTIVATE_CONFIRM` is a constant per instruction; if it must name the engineer it becomes a formatter — UNKNOWNS #11.)
**Removed earlier (kept):** ~~`RESULT_ROW_RACE`~~, ~~`RESULT_ROW_FAILED`~~, ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~ (one transaction). **Removed in rev4:** none; an attestation-required error is **not** added because the function does not enforce (D9).
**Existing approved strings (reference, do not copy):** `route.ts:55-62` `notRegisteredResponse`; `project-resolution.ts:71-72` `ZERO_MEMBERSHIPS_REPLY` (what an orphan sees, F3) and `:74-75` `MULTIPLE_MEMBERSHIPS_REPLY`; `hindrances/actions.ts:24` `SAVE_FAILURE_MESSAGE` is a non-exported constant outside this slice. **No new engineer-facing WhatsApp string.**
**T12** asserts every export above is non-empty (expected-fail at commit).

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)
`supabase/.temp/project-ref` printed `exfccwlrhoutkgrlikod`; the log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.
| Probe | Result |
|---|---|
| (a) users with >1 `project_members` row | **0 rows** |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers missing tenant or whatsapp | **2** (tenant present, whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| (e) index-predicate violations | **0 rows** |
| (f) `project_members` | 2 rows, both `engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits, zero `+91` |
| (h–l) constraints, indexes, policies, grants, nullability | as cited |
| (n) definer inventory | 15 functions, owner `postgres`, all `search_path=public` |
| (o) owner / RLS forced | `postgres`, on, not forced |
| (p) `get_user_tenant_id()` | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` |
| (r, s) live columns; `registered*`/`deactivat*` anywhere | no actor column; only `tenants.registered_address` |
| (t) role distributions | `project_members`: 2 × `engineer`; `users`: 10 admin, 3 NULL-role, 1,872 engineer, all `active`, no `pm` |
| **(v) boundary literal presence** | **0** in `users`, `whatsapp_sessions`, `outbound_sends`, `processed_messages` |
| **(w) triggers / extensions** | **no** non-internal triggers on `users`, `project_members`, `projects`; only `supabase_vault` present (no `pg_net`, `pg_cron`, `http`) |
| **(x) rows violating `CHECK (role IN ('pm','engineer'))`** | **0** (0 NULL) |
| **(y) `whatsapp_sessions` shape** | printed in the log |
| **(z) orphans; projects** | **1,870** engineers with no membership vs 2 with; 14 projects, all `active`; `projects.status` CHECK allows `active, completed, on_hold, in_bidding, bids_submitted` |

**Would the partial unique index apply cleanly on test-db today? YES** (a, e). **Would the `('pm','engineer')` CHECK? YES** on data (x) — but not on three test fixtures (D11).

## 11. For Aravind — run against PROD (not run by me)
Read-only; confirm the project ref first; paste raw results.
```sql
-- (a) users with more than one project_members row
SELECT pm.user_id, u.role AS users_role,
       array_agg(pm.role ORDER BY pm.project_id) AS project_members_roles,
       array_agg(pm.project_id ORDER BY pm.project_id) AS project_ids,
       count(*) AS membership_count
FROM project_members pm JOIN users u ON u.id = pm.user_id
GROUP BY pm.user_id, u.role HAVING count(*) > 1 ORDER BY membership_count DESC;

-- (e) the exact index predicate: any row blocks CREATE UNIQUE INDEX
SELECT user_id, count(*) AS engineer_memberships, array_agg(project_id) AS project_ids
FROM project_members WHERE role = 'engineer' GROUP BY user_id HAVING count(*) > 1;

-- (g) stored phone SHAPES, digits masked
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (n) DISTINCT project_members.role values, exact (confirms the CHECK set; shows case variants)
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (r) country-code prefix and length only; no personal digits
SELECT left(whatsapp_number, 3) AS prefix, length(whatsapp_number) AS len, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (u) do registered_* / consent_attest* / deactivat* columns already exist on prod?
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE 'registered%' OR column_name ILIKE 'consent_attest%' OR column_name ILIKE 'deactivat%');

-- (v) users by role and status (any pm users? any already-deactivated engineers?)
SELECT coalesce(role, '<NULL>') AS role, status, count(*) AS n FROM users GROUP BY 1, 2 ORDER BY 1, 2;

-- (w) NEW: engineers on prod with NO project membership (the F3 dead-end population)
SELECT count(*) AS orphan_engineers FROM users u
WHERE u.role = 'engineer' AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id);

-- (y) NEW: any in-flight sessions belonging to deactivated users on prod (F1/F2 population)
SELECT s.current_flow, count(*) AS n FROM whatsapp_sessions s JOIN users u ON u.id = s.user_id
WHERE u.status = 'deactivated' GROUP BY 1 ORDER BY 1;
```

## 12. File list
**Created (later build slice, not by this plan):** `docs/reviews/048_engineer_registration.sql` (moves to `supabase/migrations/` only at apply), `docs/reviews/048-review-package.md`; `app/(dashboard)/projects/[id]/engineers/new/page.tsx` and `actions.ts`;
`app/(dashboard)/projects/[id]/engineers/page.tsx` and `actions.ts` (list + deactivate control; routes **ASSUMED**); `lib/engineers/parse-roster.ts`, `gate.ts`, `add-engineers.ts`, `deactivate.ts`, `copy.ts`; tests per §7, `test/helpers/engineer-gate-matrix.ts`,
**`test/helpers/boundary-phone.ts`** (the one literal), `test/migration-048.test.ts`.
**Modified (build slice):** `scripts/migration-number-reservations.json`; `docs/build-status.md`; `docs/schema.md` (now stale at `:127-130`); `types/database.ts` (regenerated); **and, pending D11, the three test files that write `role: 'qs'`**; `app/(dashboard)/projects/[id]/page.tsx` — one optional link.
**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`, or any existing migration; `is-project-pm.ts` and `normalise.ts` are imported, not edited. **This revision's diff:** exactly `docs/plans/add-engineer-plan.md`.

## Decisions
| | Status |
|---|---|
| D1, D2/D5, D3, D4, D6, D7 | **settled** |
| D8 CHECK on `project_members.role`, set `('pm','engineer')`, same migration | **settled** |
| D9 attestation recorded, not enforced (`consent_attested`) | **settled** |
| D10 record who deactivated and when | **settled** |
| **D11** the three test fixtures that write `role: 'qs'` conflict with D8's set: change those fixtures, or add `'qs'` to the set. Build cannot start until answered | **open — new, forced by source** |

## UNKNOWNS
**Not determinable from printed source or the test database:**
1. **Prod state.** Whether queries a/e/n return rows; the prod role set (Aravind reports `pm` and `engineer` only — not in this log); the prod phone shapes (Aravind reports one row, `+91`, n=1 — not in this log, unverified by me); users by role; orphans (w); deactivated-user sessions (y).
2. **What Twilio actually sends in `From`.** Only `normalise.ts:4` and fixtures (`test/webhook.test.ts:263`) say `whatsapp:` + E.164.
3. **Prod/test-db parity for 048's target.** Probes ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** None designed; adding to a completed project is allowed.
5. **Whether the PM's Daily Logs view shows the `daily_logs` row that the morning sweep writes for a deactivated engineer (F1)**, and whether `checkin-escalations/reachability.ts`'s join of `users.whatsapp_number` to `whatsapp_sessions` (`:26-43`) sees a parked session: not traced beyond the roster filters.
6. **Whether the deployed Production environment's variables point only at prod and whether any other scheduler calls the cron routes** — not printable from here; neutralised (not proven) by the non-active-project rule (§7.3, B(3)). Vercel's page (fetched, quoted in the log) says cron hits the production deployment URL and is silent on previews in the text returned.
7. **Rate limiting across calls** — only the 50-row per-call cap bounds the R7 oracle.
8. **Other consumers of `project_members.role = 'engineer'`.** Not resolved; the rosters read key on `users.role`.
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
10. **Whether any path creates `users.role='pm'`.** g8 found none; a pattern search cannot see live data (probe t is test-db only).
11. **Whether `DEACTIVATE_CONFIRM` must name the engineer** (would become a formatter).
12. **My reading of instruction A's word "parsing"** (validating jsonb elements inside the function; raw-text parsing and normalisation stay in TypeScript because D forbids reimplementing `normalise.ts`).
13. **Whether "in the payload" (T10)** means the insert payload (read as such) or the function's return.
14. **Attribution design details** (composite FKs, default `ON DELETE`, pairing CHECKs, column visibility to tenant peers) are recommendations, not rehearsed.
15. **Whether `photo-access-route.test.ts:41` and `db.ts:27-28` (comments naming the app env variables) imply anything beyond the comments** — I read only the comment lines.
16. **Whether a later `it.fails` wrapper survives a vitest upgrade** — verified on 3.2.7 only.
17. **Whether my reading of D9's "column alongside `registered_by`" as a boolean `consent_attested` matches intent** (a timestamp or text would also fit).
18. **The exact digit-level content of the T9 corpus** (derived from the literal by formatting/mutation) — designed, not built.

**Assumed:** migration number 048 still free and the file name; routes `projects/[id]/engineers[/new]`; TypeScript gate and SQL function can be kept in agreement (T6 tests, does not prove); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`; T15 un-testable here; no in-flight bot session depends on the new functions; that concurrent CI runs colliding on the boundary literal are tolerable; that the default `ON DELETE` on attribution FKs is right.

**Decisions still open:** D11.
