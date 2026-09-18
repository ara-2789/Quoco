# Add-engineer screen — build plan (rev3)

> PLAN ONLY. rev1 at `c86c5b6`, rev2 at `e67e297` (each pinned: `git show <sha>:docs/plans/add-engineer-plan.md`
> returns the exact text). rev3 written on `feat/add-engineer-plan`, base `origin/main` @ `0744110`
> (re-fetched this pass; unchanged). No application code, no migration file, no SQL intended to ship.
> Tier: FULL (identity, tenant isolation, new migration).
>
> **Evidence rule.** Every claim cites source printed in `~/Desktop/add-engineer-plan-rev3.txt` ("the log").
> Citations are `path:line`; database claims cite `probe <letter>` (SQL and result both in the log); two
> throwaway analysis scripts (not in the repo, not shipping) are printed with their output. Anything not
> printed is **ASSUMED** or under UNKNOWNS. Anything Aravind must decide is **DECISION**.
>
> **Correction discipline.** Retracted claims stay visible as ~~strikethrough~~ with a dated correction, in the
> two blocks below and inline. Nothing is silently rewritten.
>
> **Settled by Aravind, applied here without re-raising:** D1 `status='active'` plus `registered_by` /
> `registered_at`; D2/D5 a SECURITY DEFINER function, not a service client; D3 India-mobile only; D4 caps
> stand (100-character names, 50 lines); D6 the role gate is the intersection stated in §1; D7 the dry-run flag.

## Scope

**In scope:** paste → preview (dry-run) → confirm → apply for adding site engineers to ONE project; a
**deactivate** control (new in rev3); attribution columns; the partial unique index.
**Deferred, named:** file upload/extraction; reassigning an existing number to another project;
**removing** an engineer or freeing a number (deactivate does neither, §2.9); editing an engineer;
duplicate-name detection; reactivating a deactivated engineer from the dashboard; the ENG-01 opt-in flow;
rate limiting across calls; recording who deactivated (D10).
~~rev1 listed "removing an engineer" as one deferred item.~~ **CORRECTED 18 Sep 2026 (rev3):** *deactivating* is
now in scope by Aravind's decision; *removal* and *freeing the number* stay deferred.

## Dated corrections, 18 Sep 2026 (rev2) — kept from the previous pass

| # | rev1 said (retracted) | rev2 result |
|---|---|---|
| 1 | ~~§1 "tighter than the DB policy `project_members_insert`"~~ | Tighter on scope, looser on role; the gate moved into the function (§1). |
| 2 | ~~§0 "the users insert needs the service client; first dashboard use of `createServiceClient()`"~~ | Superseded by D2/D5. No service client. |
| 3 | ~~§2 two-client split, compensating delete, Sentry orphan path~~ | One SECURITY DEFINER function, one transaction. |
| 4 | ~~§3 "prod shapes are unread"~~ | Aravind observed prod; §3 rewritten from source. |
| 5 | ~~§4 preview cells quoted candidate labels~~ | Drafted wording removed; constants only. |
| 6 | ~~§4 R6 "also what the new partial index enforces"~~ | The index never fires from this screen; R6 is a lookup result. |
| 7 | ~~§5 row-by-row partial apply~~ | All-or-nothing. |
| 8 | ~~§6 "048 is reserved; 049 next"~~ | 048 is released and free (`migration-number-reservations.json`). |
| 9 | ~~§7 T8 cleanup test, T10 payload spy~~ | Replaced. |
| 10 | ~~§8 wrong-tenant residual~~ | Moot. |
| 11 | ~~§9 `RESULT_ROW_RACE`, `RESULT_ROW_FAILED`, `RESULT_ROW_FAILED_NEEDS_SUPPORT`~~ | Removed. |
| 12 | ~~§12 `classify.ts`~~ | Dropped. |

## Dated corrections, 18 Sep 2026 (rev3) — every change in this pass

| # | rev2 said (retracted) | rev3 result | Where |
|---|---|---|---|
| 1 | ~~§9 "comment `// Tamil owed, NOT approved` (convention: `lib/photos/copy.ts:13-20`)"~~ | **Mis-citation.** `lib/photos/copy.ts:3-6` says the strings are approved English, "Tamil is owed, not yet approved"; that comment marks *approved English awaiting Tamil*. Unapproved wording gets `// Wording owed, NOT approved`. That phrase exists nowhere in the repo yet (grep s2), so it is a new convention set by this instruction. | §9 |
| 2 | ~~§2.3 step 1 refused a NULL-tenant caller explicitly, and §7 T1's fixture was "a pre-onboarding stub (role NULL)"~~ | One mechanism only: a null-safe tenant comparison. **T1's old fixture could never have gone red**: a stub has `role` NULL, and the role gate refuses it before the tenant comparison matters. New fixture: `role='admin'`, `tenant_id` NULL. | §2.3, §7 T1 |
| 3 | ~~§1 "`isProjectPm` is no longer used"; page render decided by an empty dry-run~~ | A TypeScript **advisory** gate exists (UI affordance only) and reuses `isProjectPm`; the function stays authoritative; T6 runs one shared matrix against both. The empty-list dry-run probe is removed. | §1, §7 T6 |
| 4 | ~~§1/§2.3 rule "`admin`, or `pm` + membership"~~ | Restated in D6's intersection form; identical outcomes (shown in the T6 matrix). Tenant equality now applies to both branches explicitly. | §1 |
| 5 | ~~§2.3 / §3.7 "the function re-asserts the India shape"; §7 T9 "two implementations must agree"~~ | The India policy is enforced **in TypeScript only**. The function asserts the generic E.164 shape, exactly the one phone CHECK in the schema. Reason: the DB fixtures are all `+1…`, so an India-only SQL check would make every DB test impossible. Known limit recorded. | §3.6, §7 T9 |
| 6 | ~~§3.5 table listed `whatsapp:+919876543210` as an accepted input~~ | Rejected by the paste validator (V1, charset). Real Twilio input still goes through `normalisePhoneNumber` untouched on the webhook side. | §3.3 |
| 7 | ~~§3.6 rejected-input list from the rev2 probe~~ | Replaced by the rev3 validator probe (34 inputs (14 accepted, 20 rejected), 0 violations). | §3 |
| 8 | ~~§3.6 "the test phone blocks are `+1999555…`"~~ | Corrected in detail: fixture shapes are 11-digit (`+19995550NNN`), 14-digit (`+19995551…`, `+19995552…`), and a run-scoped nested form; none starts `+91`. The instruction's "every fixture is 14 digits" is also not quite right: probe g shows 1,868 × 14 digits **and 2 × 11 digits**. Conclusion unchanged. | §7.3 |
| 9 | ~~§9 `PREVIEW_SUMMARY`, `RESULT_SUMMARY`, `REJECT_NAME_TOO_LONG`, `ERROR_PASTE_TOO_LONG` as plain constants~~ | Formatters with named parameters, after `formatKeptUntilLine`. | §9 |
| 10 | ~~UNKNOWNS #1 "prod phone shape unknown; the mask can't show `+91`"~~ | Aravind reports prod: one row, prefix `+91`, `+` + 12 digits. Recorded as user-supplied, the whole observed population (n=1). | §4.5 |
| 11 | ~~§6 migration = index + one function~~ | Index + two attribution columns + a helper + **two** functions (add, deactivate); optional CHECK on `project_members.role` (D8). | §6 |
| 12 | ~~§12 file list~~ | Updated (gate, deactivate wrapper, engineers list page, shared test matrix, blank copy file). | §12 |
| 13 | (new) | Added: dry-run specification (A), deactivate function (B), attribution (C), validator status (D), formatters and new constants (E), test changes (F), §4.5 additions (G). | §2–§9 |

## 0. Findings that shape the plan — read first

1. **`status='active'` is settled (D1), with attribution.** It still departs from ENG-01
   (`docs/bot-flows.md:303-308`), which wanted `pending` plus an opt-in template and an audit row. Nothing in code
   implements that flow (log greps g1–g3): the only `quoco_engineer_optin` hit is a comment (`route.ts:209`); no
   `registered_by` anywhere (grep c1: zero hits in `app lib supabase scripts test types`; the only doc hit is the
   ENG-06 spec line, `bot-flows.md:308`). Because `active` engineers receive the next cron send with no opt-in,
   the plan adds an admin **consent attestation** before apply (§5, §9) and records who registered (§2.6).
2. **The partial index cannot fire from this screen's own inserts** — every pasted row is a new `users.id`. The
   index test (§7 T3) inserts directly.
3. **`status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`), so an omitted `status` would also read
   as live. The gate decision is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users` at all** — no INSERT (probe k, `015:114`), UPDATE only on
   `full_name, avatar_url` (`015:105`), and the only UPDATE policy is `auth_id = auth.uid()` (probe j). So *both*
   the add and the deactivate need a definer function; no service client is involved (g4: none imported under
   `app/(dashboard)`).
5. **Phone chain: no mismatch, but no validator exists** (§3). `normalisePhoneNumber` never rejects.
6. **Migration number 048** is free (log: `git ls-tree origin/main` ends at 047; reservations file ends at 048 with
   "RELEASED, NEVER USED … 048 is free for the next real migration").
7. **Deactivation already takes effect everywhere that matters** (§2.9, printed source).

## 1. Authorisation

**The rule (D6, settled).** A caller may add or deactivate iff, with the caller resolved as `users` row where
`auth_id = auth.uid()`:

`users.role IN ('admin','pm')` **AND** the project exists **in the caller's tenant** **AND**
(`users.role = 'admin'` **OR** a `project_members` row with `role = 'pm'` for this `(user, project)`).

Equivalently: an admin of the project's tenant; or a `pm` (or an `admin`) holding a `pm` membership on this project.
This is the *intersection* of the DB policy's role list (`project_members_insert`, probe j: `users.role IN
('pm','admin')`) and per-project membership. Rows a `qs`/`engineer`/NULL-role user cannot pass even with a `pm`
membership.

**Where each role column is written.** `users.role='admin'` for a self-serve account: `complete_onboarding`,
`005_auth_trigger.sql:76-80`, `016_corrections.sql:177-181`. `project_members.role='pm'` for a project's creator:
`app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM today is `users.role='admin'` + `project_members.role='pm'`.
grep g8 finds no code or migration writing `users.role='pm'`; probe t shows test-db holds 10 admins, 3 NULL-role
stubs, 1,872 engineers and **no** `pm` users. In practice the effective rule today is tenant-wide, which is already
true of the RLS policy; the per-project narrowing only bites for a `users.role='pm'` account.

**Two implementations, one authority.**
- **SQL (authoritative):** the shared internal helper (§2.7) evaluates the rule for both functions.
- **TypeScript (advisory only):** a pure `decideEngineerAdminAccess` used to decide whether to *show* the link,
  the page, and the deactivate control. Its membership leg reuses `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`;
  `project_members.role='pm'` for the exact pair, takes `users.id`, throws on error → treat as refuse). It is never a
  security boundary; if it and the SQL ever disagree, SQL wins. **T6 exists to catch that drift**: one fixture matrix
  run against both.
~~rev2: "`isProjectPm` is not used on the write path any more … whether to render the form is decided by calling the
function in dry-run mode with an empty list."~~ **Corrected (rev3, #3).** The empty-list probe is removed; the
function requires at least one row in both modes.

**Correction carried from rev2, kept visible.**
~~"This is *tighter* than the DB policy `project_members_insert`."~~ — rev1. It is tighter on per-project scope and
looser on role (rev1 admitted any `pm`-membership holder regardless of `users.role`). The intersection above
closes the role side.

## 2. The add function — SECURITY DEFINER (`add_engineers_to_project`)

### 2.1 Contract (signature and behaviour; no body is written here)

`(p_project_id uuid, p_engineers jsonb, p_dry_run boolean) → jsonb`. No parameter defaults (a later signature
change would create a second overload, `CLAUDE.md:361-372`; brand-new function, so not tripped now).
`p_engineers` is an array of `{ name, whatsapp_number }`. `whatsapp_number` arrives **already validated and
normalised by TypeScript** (§3); the function asserts only the generic stored shape (§3.6).

Return: `{ applied: boolean, rows: [ { idx, status, … } ] }`. Row `status` values are machine identifiers, not
wording. **Allowed fields per status — this is the whole payload, and nothing else may appear:**

| status | fields | note |
|---|---|---|
| `ok` (dry-run: would be added) | `idx, status` | |
| `added` (apply) | `idx, status, user_id` | the new `users.id` |
| `already_on_this_project` | `idx, status` | no name, no id |
| `on_another_project` | `idx, status, other_project_name` | **in the caller's own tenant only** |
| `number_registered` | `idx, status` — **exactly these two keys** | the generic outcome; never carries a project id, project name, or full name |

### 2.2 The dry-run flag (A)

`p_dry_run = true`: the function performs authorisation, tenant binding, argument validation and **full
classification**, returns the same per-row payload apply would, and **writes nothing**. The preview screen calls it
this way. `p_dry_run = false` is apply.

**Why it exists, stated plainly.** Without it the preview cannot see a number that belongs to **another tenant**
(under RLS a preview would read only its own tenant's `users`, probe j `users_select`). A cross-tenant collision
would then be invisible at preview and would **abort the whole all-or-nothing batch at apply**. With the flag,
preview and apply run the *same code path*, so they cannot drift, and the collision is caught at preview and reported
only generically.

**Specified behaviour, both modes:**
1. **Authorisation runs BEFORE any number lookup, in both modes** (§2.3 steps 1–3 precede step 5). An unauthorised
   caller learns nothing about which numbers exist; they get an error, not statuses.
2. **Cross-tenant collisions are `number_registered`**: payload exactly `{idx, status}` — no project id, project
   name, or full name (T5 asserts on the payload's key set, not on rendered text).
3. **Apply re-runs every check** (steps 1–5) inside its own transaction. It never accepts or trusts a verdict from
   an earlier preview; nothing from the preview is passed in except the same input rows.
4. Dry-run holds no write and no lock beyond ordinary reads (T7 asserts row counts unchanged).

### 2.3 Order of operations (one transaction)

1. **Resolve the caller:** `users` row where `auth_id = auth.uid()` (`019:170-171`; live `get_user_tenant_id()`
   body, probe p). No row → `insufficient_privilege` (`019:172-175`). `auth.uid()` is never compared to `users.id`:
   `users.id` is decoupled since 007 (`007:127` default; `auth_id` backfilled `= id` only for pre-007 rows,
   `007:60-67`; `uq_users_auth_id` partial unique, `007:76-78`). Engineers/owners have `auth_id` NULL
   (`CLAUDE.md:833-840`), so they can never be callers; anon has `auth.uid()` NULL and matches nothing.
2. **Load the project by `p_project_id`; tenant-bind, NULL-safe.** If the project is missing, **or**
   `project.tenant_id IS DISTINCT FROM caller.tenant_id`, raise `no_data_found` — one indistinguishable error
   (precedent `019:219-222`), so a foreign id is not an existence oracle. `projects.tenant_id` is `NOT NULL`
   (`001_core_schema.sql:55`), so a caller whose tenant is NULL always fails this comparison. **This single
   null-safe comparison is the only tenant-binding mechanism** (rev3 #2; T1 targets exactly it).
3. **Role/authority gate (§1).** Else `insufficient_privilege`.
4. **Validate the argument:** length 1..50 (D4; `program_limit_exceeded`, precedent `019:208-212`); each element an
   object with a non-empty text `name` ≤ 100 chars and a `whatsapp_number` matching the generic stored shape;
   duplicate numbers within the array → `invalid_parameter_value`. These are caller bugs (TypeScript already
   filtered), not user-facing rejections.
5. **Classify every row** against current state (R5–R7, §4). The owner can read all tenants, so the function
   reveals only what §2.1 allows.
6. If `p_dry_run`, or **any** row is not `ok` → write nothing, return `applied: false` with the statuses.
7. Otherwise insert, per row, one `users` row then one `project_members` row (§2.6) and return `applied: true`.
   Any exception rolls back the whole call. A concurrent add committing the same number between 5 and 7 loses on
   `UNIQUE (whatsapp_number)` (`001:44`, live `users_whatsapp_number_key`, probe h) and the transaction aborts (`23505`).

**The NULL trap in the precedent (deferred, §4.5).** `019:230` is `IF v_tenant_id <> get_user_tenant_id() THEN
RAISE`; a NULL caller tenant makes it NULL, the guard passes silently, masked in 019 only by the membership check
(its own comment, `019:224-229`). The new function does not copy it. Fixing 019 is a separate slice.

### 2.4 `tenant_id` is derived from the project row, never a parameter

(a) A parameter is caller-controlled; accepting it means validating it, and a missed validation writes a user into
the wrong tenant. Read from the project row it is not an input, so no argument can name another tenant. (b) The
function bypasses RLS, so RLS cannot catch a wrong value; the composite FKs (`017…:94-106`, probe h) validate the
*membership* but cannot validate the `users.tenant_id` *value*. (c) It removes a class of test cases.

### 2.5 Ownership, search_path, grants

Same posture for every new function (§2.7). Precedent printed in full: `019_daily_log_corrections.sql:149-297`
(`SECURITY DEFINER SET search_path = public`, `:156`; `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated`,
`:294-295`). Live inventory (probe n): all 15 existing definer functions are owned by `postgres` with
`search_path=public`; `correct_daily_log` still holds `service_role:EXECUTE`, which `FROM PUBLIC, anon` does not
remove, hence `CLAUDE.md:910-918`'s per-role rule. Tables are owned by `postgres`, RLS enabled and **not forced**
(probe o), so an owner-run function bypasses RLS — that is the mechanism that lets it write `users`.

### 2.6 Columns written (every one explicit where a default or NULL would hide a bug)

**`users` row** (live columns, probe r; nullability/defaults, probe l):

| column | value | source |
|---|---|---|
| `id` | DB default, captured via `RETURNING` | `007:127` |
| `tenant_id` | the **project row's** tenant — explicit | §2.4 |
| `role` | literal `'engineer'` — explicit | `users_role_check` (probe h) |
| `status` | literal `'active'` — explicit (D1) | probe d: default is also `active`, so explicit for intent |
| `full_name` | the row's `name`, trimmed | argument |
| `whatsapp_number` | the row's number, already normalised | argument |
| `messaging_blocked` | `false` — explicit | probe l |
| `auth_id` | `NULL` — explicit | `CLAUDE.md:833-840` |
| **`registered_by`** | the **resolved caller's `users.id`** (step 1) — never `auth.uid()`, never a parameter | new column (§2.8) |
| **`registered_at`** | `now()` inside the function — never a parameter | new column (§2.8) |
| not set | `avatar_url`, `hierarchy_level`, `reporting_manager_id`, `delegation_active`, `employee_id`, `notification_email`, `notification_email_verified_at`, `whatsapp_declined_at` | nullable (probe r; the last is an owner-email consent column, `034:148-153`) |

**`project_members` row** (`001:72-80`; live, probe r): `id`/`created_at` defaults; `tenant_id` = same derived tenant
(`001:75` NOT NULL; composite FKs agree); `project_id` = `p_project_id`; `user_id` = the new id; `role` = literal
**`'engineer'`, exact string** (probe h: no CHECK on this column — see §4.5/D8).

### 2.7 Shared internal helper, and the grant posture of all three functions

To make "the same authorisation and tenant binding" literally shared rather than copied, steps 1–3 live in one
**internal helper** returning `(caller id, caller tenant)` or raising. Both public functions call it. The helper is
**not** callable from outside: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role` (only its owner,
`postgres`, retains EXECUTE, which is who a definer function runs as). Public functions: `REVOKE EXECUTE … FROM
PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`. `SET search_path = public`, every object
schema-qualified, no dynamic SQL (contrast `019:246,265`). `service_role` is revoked by name because it carries no
`auth.uid()` (step 1 would refuse it anyway); this deliberately differs from 019's ACL. **Open, not resolved from
source:** none of the 15 append `pg_temp` to `search_path` (UNKNOWNS #6). **Alternative, one line:** duplicate the
three steps inline in both functions — smaller ACL surface, but two copies that can drift; T6 would then be the only
guard.

### 2.8 Attribution — `registered_by`, `registered_at` (C)

**Confirmed absent (grep and live catalog).** grep c1: no `registered_by`/`registered_at` in `app lib supabase
scripts test types`. Probe s: no column named `registered*` or `deactivat*` on any public table except the unrelated
`tenants.registered_address`. Probe r: `users` has no actor column at all (columns: `auth_id, avatar_url, created_at,
delegation_active, employee_id, full_name, hierarchy_level, id, messaging_blocked, notification_email,
notification_email_verified_at, reporting_manager_id, role, status, tenant_id, whatsapp_declined_at,
whatsapp_number`), and `project_members` has only `created_at, id, project_id, role, tenant_id, user_id`.

**Why it ships now and cannot be reconstructed later.** After apply nothing on either row records *who* created it
— only `created_at`. The only other trace is request logging outside the database, which this repo does not read and
whose retention it does not control. So a row created without the columns is permanently unattributable, and the
1,872 existing engineer rows already are (they get NULL, not a guess).

**Column design (recommended, flagged for the reviewer):**
- `registered_by uuid NULL`, `registered_at timestamptz NULL`, on `users`; **same migration as the partial index**.
- A pairing CHECK, `(registered_by IS NULL) = (registered_at IS NULL)`, after the precedent in `036…:232-244`
  (`(timing = 'unspecified') = (timing_raw IS NOT NULL)`).
- A composite same-tenant FK `(registered_by, tenant_id) → users (id, tenant_id)` in the style of `017:94-106`
  (`users_id_tenant_id_key` exists, probe h), so an attribution can never point across tenants; `ON DELETE` left as
  the default so deleting a registering admin cannot silently erase the attribution (**ASSUMED**, reviewer question).
- Both nullable: existing rows cannot be backfilled honestly.
- New columns are readable by same-tenant users through the existing table-level SELECT + `users_select` (probe k,
  probe j); UPDATE stays limited to `full_name, avatar_url` (`015:105`). A uuid and a timestamp; judged acceptable
  (**ASSUMED**).
Departure from ENG-06 (`bot-flows.md:308`: an audit *row* with name and phone): two columns on the user row instead.
Consequence: the record is only as durable as the row; editing name/number (deferred) would overwrite what was registered.

### 2.9 Deactivate — the SECOND SECURITY DEFINER function (`deactivate_engineer`) (B)

**Why a function.** `authenticated` has no UPDATE on `users` beyond `full_name, avatar_url` (`015:105`; probe k
`upd=false`) and the only UPDATE policy is own-row (probe j), so an admin cannot update another user's row through
RLS. Same posture as §2.7, same helper, same grants.

**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb`: `{ status: 'deactivated' | 'already_deactivated' }`.
1–3 as §2.3 (helper: caller, tenant binding, D6 gate). 4. Locate the target: the row `users u JOIN project_members pm`
with `u.id = p_user_id`, `u.role='engineer'`, `u.tenant_id` = the derived tenant, `pm.project_id = p_project_id`,
`pm.role='engineer'`. **Not found → `no_data_found`**, the same error as a foreign or missing project (a target in
another tenant is indistinguishable from a nonexistent one). 5. `UPDATE users SET status='deactivated'` on exactly
that row; already deactivated → `already_deactivated`, no write.
`'deactivated'` is already permitted by `users_status_check` (probe h: `pending, active, deactivated`).

**What it does NOT do.** No `DELETE`; does not touch `whatsapp_number`, `messaging_blocked`, `project_members`, or any
other column; does not reset `whatsapp_sessions`; does not send anything; no reactivation (deferred); no dynamic SQL.
Requires `project_id` because the authorisation is project-bound: a `pm`-role caller can deactivate only engineers of a
project they hold a `pm` membership on. An engineer with **no** membership (an orphan) cannot be deactivated through
this function (**limit**).

**KNOWN LIMIT — the number stays held.** Deactivation does not free `whatsapp_number`: the global
`UNIQUE (whatsapp_number)` (`001_core_schema.sql:44`, live `users_whatsapp_number_key`, probe h) keeps the value
reserved by the deactivated row, and the row's `project_members` entry also keeps holding the partial-index slot.
**A mistyped number therefore cannot be corrected from the dashboard**; the only repair path is **manual SQL**
against the database, which is a production write governed by `CLAUDE.md`'s apply rules. This is why the validator
(§3), the preview and the confirm step matter.

**Deactivation takes effect with no further change — from printed source.**
- Webhook: `decideInboundGate` (`lib/whatsapp/reactivation.ts:29-33`) returns `gated_noop` for any `status !==
  'active'`; the module header states a deactivated engineer must never be reactivated by texting in
  (`reactivation.ts:11-14`); the clear-half re-asserts `status='active'` (`:64`). The webhook calls it at `route.ts:159`.
- Outbound cron: `fetchActiveEngineers` filters `.eq('users.status','active')` (`lib/whatsapp/outbound/roster.ts:168`);
  both exported rosters go through it (`fetchMorningRoster` → `:203`, `fetchEveningRoster` → `:248`).
  `fetchActiveEngineers` itself is module-private (`:150`), so tests use the exported rosters.
- Also already filtering: escalation roster (`lib/checkin-escalations/roster.ts:65`), DPR roster
  (`app/api/cron/dpr-generate/route.ts:80`), accountability (`lib/dpr/accountability.ts:159`), and DPR dispatch
  (`lib/dpr/dispatch.ts:417-418`, `stillActiveMember`).
- **Why `status`, not `messaging_blocked`:** setting the flag instead would make `decideInboundGate` return
  `reactivate` (`:36-38`) and the engineer would clear it by texting in.
Not verified from source: whether an in-flight `whatsapp_sessions` row for a deactivated engineer needs cleanup; the gate
runs before session handling (`route.ts:146-162`, printed), so it is silent-dropped, but I did not trace sessions (UNKNOWNS #5).

**Attribution for deactivation.** Not specified by the instruction and not added. `users.status` is overwritten with
no record of who or when. **DECISION D10** (§Decisions).

## 3. Phone numbers and the validator (D)

### 3.1 The chain (Part A, printed in the rev2 log and re-printed here)

`route.ts:111`: `const fromNumber = normalisePhoneNumber(params.From ?? '')`; `route.ts:130-133` looks up
`.eq('whatsapp_number', fromNumber)`. Only helper called: `normalisePhoneNumber` (imported `route.ts:5`). Inbound
form: `+` + digits, no `whatsapp:` prefix, no whitespace/hyphens/parentheses (`normalise.ts:13-15,18,21-23`).
Downstream code passes it through verbatim (`dispatch.ts:180,199,217`; `inbound-start.ts:463,852`; `session.ts:58,91`,
in the phone `git grep`). **No mismatch with the prod stored form** (`+` + 12 digits) — *provided the screen stores
`normalisePhoneNumber(raw)` output and nothing else*. That real Twilio sends `whatsapp:+E164` is stated only by a
comment (`normalise.ts:4`); not observable here.

### 3.2 STATUS OF THE VALIDATOR (D) — the consequence, stated explicitly

Printed: `lib/whatsapp/normalise.ts` **never rejects anything** (its last line, `normalise.ts:42`, prefixes `+` onto
whatever it has; its own comment says "Caller should validate downstream", `:40-41`), and **no validator exists
anywhere in the repo** (phone `git grep`: the only other hits are `links.ts` formatters and comments; the one schema
CHECK is `outbound_sends_to_phone_number_check`, `031:478-479`, probe q). `links.ts:10-11` and
`reactivate-copy.ts:48-52` both say the E.164 guarantee "lives upstream at the write paths"; grep g5 shows no engineer
write path exists, so this screen is the first.

**Consequence.** Without a validator in front of it, a mistyped line stores a well-formed-looking row that can
never match an inbound message — the webhook compares the *normalised inbound* number for equality
(`route.ts:133`), and a junk value is not any real number's normal form — **and permanently holds that value under the
global unique** (`001:44`), with no removal path in this slice (§2.9). The executed probe (log) shows what
`normalisePhoneNumber` alone would have stored: `"abc"` → `"+abc"`, `""` → `"+"`, `"98765 4321"` → `"+987654321"`,
`"5876543210"` → `"+915876543210"`, `"+91 98765 43210 ext 4"` → `"+919876543210ext4"`, `"0091 98765 43210"` →
`"+00919876543210"`.

**A limit no validator removes.** It catches malformed numbers, not *wrong-but-valid* ones. A transposed digit or
someone else's handset passes, is stored `active`, and will receive the next cron send with no opt-in. That is why the
confirm step and the consent attestation exist (§5), and why the deactivate control exists (§2.9).

### 3.3 Validation happens BEFORE normalisation — the exact rule

Applied to each raw pasted token, in order:
- **V1 charset.** Only ASCII digits, `+`, whitespace, `-`, `(`, `)` (the separators `normalise.ts:18` itself strips).
  Anything else → reject. This rejects letters (including a `whatsapp:` prefix and "ext"), non-ASCII digits, and empty.
- **V2 separators.** Remove whitespace, `-`, `(`, `)` → `t`.
- **V3 shape.** `t` must match exactly one of four shapes, where the mobile digit is `[6-9]`:
  `S1 ^\+91[6-9][0-9]{9}$` · `S2 ^91[6-9][0-9]{9}$` · `S3 ^0[6-9][0-9]{9}$` · `S4 ^[6-9][0-9]{9}$`.
- Only then call `normalisePhoneNumber(raw)` and **assert** the result matches the single stored form below, and that
  `normalisePhoneNumber(result) === result`. The assertion is a guard against the helper drifting, not a second normaliser.

**The single stored form:** `^\+91[6-9][0-9]{9}$` — `+91`, a mobile digit 6–9, nine more digits; 13 characters.
**Reuse, not reimplementation:** the screen imports `normalisePhoneNumber` (`lib/whatsapp/normalise.ts:9`) and never edits
or copies it (the webhook depends on it). The validator is new code in front of it (`lib/engineers/parse-roster.ts`).

**Evidence — the rev3 validator probe (throwaway script, printed with output):** 34 inputs (14 accepted, 20 rejected), **0 violations**. Accepted
and stored as shown: `+919876543210`, `+91 98765 43210`, `+91-98765-43210`, `(+91) 98765-43210`, `+91 (98765) 43210`
(S1); `919876543210`, `91 98765 43210` (S2); `09876543210`, `0 98765 43210` (S3); `98765 43210`, `9876543210`,
`9198765432` (→ `+919198765432`), `6000000000`, `  9876543210  ` (S4). Rejected: `whatsapp:+919876543210` (V1),
`0091 98765 43210`, `+1 415 523 8886`, `+14155238886`, `98765 4321`, `987654321012`, `98765432101`, `5876543210`,
`+915876543210`, `+91 98765 4321`, `+91 987654 32101`, `++919876543210`, `+` (V3), and `+91abc98765`, `abc`, empty,
whitespace, `9876543210x`, Devanagari digits, `… ext 4` (V1).
~~rev2 §3.5 listed `whatsapp:+919876543210` as an accepted input~~ — corrected above (rev3 #6).

### 3.4 What the preview shows on failure

The rejected row with the **raw text exactly as pasted** (never a normalised guess) and `REJECT_BAD_NUMBER`. Nothing
is written for it and it is never sent to the function. Rows with a bad number do not block the other rows from being
previewed; only accepted rows go forward (§5).

### 3.5 Line format (D4, settled)

One engineer per line; the number is the trailing run of digits, `+`, spaces, hyphens, parentheses; the name is the
rest, trimmed of trailing `,` `-` `:` `|` tab and spaces. Blank lines ignored. Name ≤ 100 characters; paste ≤ 50 lines
(over the cap the whole paste is refused).

### 3.6 The function's shape check is generic, on purpose (rev3 #5)

The function asserts `^\+[1-9][0-9]{1,14}$`, the same pattern as `outbound_sends_to_phone_number_check` (`031:478-479`,
probe q), so a stored value can never later violate that CHECK when the cron sends to it. The India-only policy lives
**in TypeScript only**.
~~rev2: the function "re-asserts the India shape … the two implementations must agree" (T9).~~ **Retracted.** Reason: every
DB fixture is `+1…` (§7.3), so an India-only SQL check would make every DB-level test impossible.
**Known limit, stated plainly:** an authorised admin/PM who calls the function directly through the API with a valid
session can store any well-formed E.164 number, not only an Indian mobile. Bounded to authorised callers and the
50-row cap; not closed. The alternative (India-only in SQL too) would force every DB test onto routable +91 handsets.

## 4. Rejection cases — which are reachable where

Preview = TypeScript parse (R1–R4) then the function with `p_dry_run = true` (R5–R7). Apply = parse again, then the
function with `p_dry_run = false`, re-running R5–R7 against current state.

| # | Reason | Detected by | At preview? | At apply? | Shown by |
|---|---|---|---|---|---|
| R1 | Empty name | TypeScript | yes | re-run | `REJECT_NO_NAME` |
| R2 | Name over 100 | TypeScript | yes | re-run | `formatRejectNameTooLong` |
| R3 | Bad number (§3.3) | TypeScript | yes | re-run | `REJECT_BAD_NUMBER` |
| R4 | Same number twice in the paste | TypeScript, first wins | yes | re-run | `REJECT_DUPLICATE_IN_PASTE` |
| R5 | Engineer already on **this** project | function step 5 `already_on_this_project` | yes | yes | `REJECT_ALREADY_ON_THIS_PROJECT` |
| R6 | Engineer on **another project in the caller's own tenant** | function step 5 `on_another_project` + that project's name | **yes** | yes | `formatRejectOnAnotherProject` (in-tenant only) |
| R7 | Number exists but fits neither R5 nor R6: **another tenant**, or same tenant but not an engineer, or an engineer with no membership | function step 5 `number_registered`; global `UNIQUE (whatsapp_number)`, `001:44` | **yes** (this is what the dry-run flag buys) | yes | `REJECT_NUMBER_REGISTERED` |
| R8 | A concurrent add commits the same number between steps 5 and 7 | `23505`, transaction rolls back | **no** (a dry run cannot race) | **yes**, whole batch | `ERROR_BATCH_NOT_APPLIED` |

**R6 is never an insert failure.** Every pasted row is a new `users.id`, so `uq_project_members_one_engineer_project`
cannot fire from this function. It is a classification result, reachable at **preview** and re-run at apply. Cross-tenant
it is impossible to report: the function names a project only when the existing user's tenant equals the caller's, so a
tenant-B engineer classified by a tenant-A admin is R7 with no project id, project name or full name.
**Reachable only at apply:** R8 (and unexpected errors). **Reachable at both:** R1–R7.
Whole-request refusals: unauthenticated (redirect); `no_data_found` (missing/foreign project, or a NULL-tenant caller) →
`ERROR_PROJECT_NOT_FOUND`; `insufficient_privilege` → `ERROR_NOT_ALLOWED`; empty paste → `ERROR_PASTE_EMPTY`; over the
cap → `formatErrorPasteTooLong`.

**Number-existence oracle, bounded not closed.** Authorisation precedes lookup, the R7 payload is generic, 50 rows
per call; **no rate limit across calls** (UNKNOWNS #7). It reveals no more than the webhook's own not-registered
reply (`route.ts:55-62`).

### 4.5 Deferred items and open decisions (G)

1. **`project_members.role` has no CHECK constraint — decision for Aravind, not assumed (D8).** Live: probe h lists
   `project_members_pkey`, the two composite FKs, `project_members_tenant_id_fkey`, and `UNIQUE (project_id, user_id)` —
   no CHECK on `role`. So the partial index predicate `role = 'engineer'` rests on unconstrained free text:
   `'Engineer'`, `'engineer '` or `'ENGINEER'` would **escape it**. The add function writes the literal and the app writes
   `'pm'` (`projects/new/page.tsx:53`), but the RLS insert policy accepts any role string from any tenant admin/pm
   (probe j `project_members_insert` checks tenant and `users.role` only). Test-db holds only `engineer` (probe t, 2 rows);
   **prod's distribution is unread** (§11 query n). **Recommendation: add a CHECK in the same migration**, with the allowed
   set chosen *after* prod query n is read (I know two values in use, `pm` and `engineer`; adding a CHECK that omits a value
   prod actually holds would fail the migration). Flagged; not assumed.
2. **Deferred, out of scope — the `<>` tenant comparison at `019:230`.** It changes the logic of a live SECURITY DEFINER
   function (review-gate trigger (a), `CLAUDE.md:192-205`), so it needs its own migration, package and rehearsal; today it is
   masked by the membership check at `019:237-243` (`019:224-229`). This plan only ensures the *new* function does not copy it.
3. **Deferred, out of scope — scoping `resolveEngineerProject` to `role='engineer'`.** It counts every `project_members` row
   for the user whatever the role (`lib/whatsapp/project-resolution.ts:37`), so a user with memberships in more than one role
   resolves as multiple; scoping it changes bot behaviour in `lib/whatsapp/`, which this slice may not touch, and belongs with the
   webhook work.
4. **Prod phone-format evidence is one row.** Reported by Aravind (not in this log): `users.whatsapp_number` on prod is
   `+` + 12 digits, prefix `+91`, n=1 — **the whole population observed**. It is consistent with `normalisePhoneNumber`'s
   output for an Indian mobile (`+91` + 10 digits). One row cannot show that other stored values share that form. Test-db
   holds no `+91` (probe g). Queries g and r in §11 read more.

## 5. The flow, and atomicity

**Flow:** paste → **Preview** (dry-run, R1–R7 per row) → **Confirm** (a step naming the count of rows about to be created,
`formatAddConfirm({ count })`, plus the admin-facing consent attestation, `ADD_CONSENT_ATTESTATION`) → **Apply**. The apply
action re-parses the raw text server-side, refuses if the attestation is absent, and refuses if the re-parsed accepted-row
count differs from the confirmed count (an edit between confirm and apply). Attestation is enforced in the server action;
whether the DB should also require or record it is **D9**.

**Atomicity.** ~~rev1: row-by-row.~~ All-or-nothing per apply call (rev2 #7): every `users` and `project_members` row is
written or none. Rows rejected at preview are left out of the apply input by the admin's choice to proceed; if any row is not
`ok` at apply, or a concurrent add wins, nothing is written and the admin sees `ERROR_BATCH_NOT_APPLIED` and re-previews.
Concurrency (T15) is **not verifiable locally** (`CLAUDE.md:478-486`).

## 6. The migration (index + attribution columns + helper + two functions)

- **File:** `048_engineer_registration.sql` (name **ASSUMED**). **Number 048** (log: `origin/main` migrations end at 047;
  reservations end at 048 "RELEASED, NEVER USED … free"; sibling worktrees checked in rev2, none above 048). **ASSUMED still
  free at write time** — recheck `ls supabase/migrations/`, `supabase migration list`, the reservations file and sibling worktrees
  (`CLAUDE.md:869-872`). Held in `docs/reviews/` until applied (`CLAUDE.md:947-952`).
- **Contents:** (1) `ADD COLUMN registered_by, registered_at` on `users` with the pairing CHECK and composite FK (§2.8);
  (2) the partial index; (3) **[D8]** a CHECK on `project_members.role`; (4) the internal helper; (5) `add_engineers_to_project`;
  (6) `deactivate_engineer`; (7) ACLs (§2.7).
- **Index:** `CREATE UNIQUE INDEX uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`.
  Name checked against live `pg_indexes` (probe i). Not `CONCURRENTLY`: it cannot run in a transaction and the apply skeleton
  wraps files in `BEGIN;…COMMIT;` (`docs/migration-runbook-template.md:34`); test-db table is 2 rows (probe f).
- **`UNIQUE (project_id, user_id)` is insufficient:** it forbids the same user twice on the *same* project; `(P1,U)` and `(P2,U)` are
  distinct pairs. **Partial, because** PMs hold `pm` memberships on many projects (`projects/new/page.tsx:49-54`).
- **If prod has violating rows** (query e): the index fails `23505`; inside `BEGIN/COMMIT` the whole file aborts with no change; no
  auto-dedupe (destructive statements are pinned, `CLAUDE.md`); an in-file pre-check lists the offenders. Test-db: probes a and e, **0 rows**.
- **Review gate (`CLAUDE.md:192-205`) clearly tripped:** new SECURITY DEFINER functions (a, b), identity (c), and a `DROP COLUMN` in
  the DOWN is destructive (d). Whole PR needs the package. Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`);
  `service_role` denial against the **real** database (the local scaffold has no Supabase default ACLs); ACL, `proowner`,
  `proconfig` fingerprint for **all three** functions, including that the helper has no `authenticated` EXECUTE; disposable local dry-run
  first (`CLAUDE.md:1020-1030`, the disposable dry-run rule); rehearsal on the cleaned existing test-db (`CLAUDE.md:74-78`), not a fresh branch.
- **DOWN:** drop the three functions, the index, and the two columns; commented per `down-section-must-be-commented`
  (`CLAUDE.md:1135-1139`, `scripts/lint-migrations.mjs:547-552`) and **rehearsed** (`CLAUDE.md:1120-1128`). Dropping the columns
  **destroys the attribution data** — the DOWN is irreversible for that data. With the app deployed, a rolled-back DB makes the
  screen's calls fail (→ `ERROR_GENERIC_SAVE`); no in-flight bot session depends on these functions (**ASSUMED**).
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`,
  foreground, never `db push`, explicit go-ahead (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it
  (`CLAUDE.md:142-146`).

## 7. Positive controls

"Shown to fail" = a captured red run, then the fix, then green, in the PR record. Non-regression controls get a mutation or negative
control. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`, the disposable dry-run rule), never on test-db or prod.

### 7.1 Tests

| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T1** | A caller with `users.tenant_id` **NULL** is refused, and nothing is written, in both modes. **Fixture: `role='admin'`, `tenant_id` NULL, a real `auth_id`** (constructed with a service-role insert, not observed; test-db's 3 NULL-role stubs, probe t, would not exercise this). Expected `no_data_found`. | **Red against a `<>` comparison first.** Scaffold variant: `IF project.tenant_id <> caller.tenant_id` (the `019:230` shape). `NULL <> uuid` is NULL, the guard does not fire, the admin gate passes, and the engineer is written into the **project's** tenant — T1 fails. Then the null-safe `IS DISTINCT FROM` → green. rev2's fixture (NULL role) would have stayed green against `<>` (role gate refuses first) — that is why it is replaced. |
| **T2** | Authorisation matrix, SQL leg (see T6). | see T6 |
| **T3** | A second `role='engineer'` membership for the same user on another project is rejected `23505` naming `uq_project_members_one_engineer_project` (**direct insert**, §0 #2). | Natural red: run on test-db **before** the migration → insert succeeds → fails. Capture, delete rows, apply, green. |
| **T4** | A `users.role='admin'` user with `pm` memberships on P1 **and** P2 is unaffected; `pm` on P1 + `engineer` on P2 allowed. | Negative control on the local scaffold: wrong index `UNIQUE (user_id)` with no predicate → fails; real index → green. |
| **T5 (extended)** | A **tenant-B engineer's number** classified by a **tenant-A admin** (dry-run) returns `number_registered`, and the returned row object has **exactly the keys `idx, status`**; the serialized payload contains **no** tenant-B project id, project name, or full name. Asserted **on the payload**, not the rendered string. Also: an in-tenant engineer on another project returns `on_another_project` with `other_project_name` and no id/full name. | Two mutations: (i) return `other_project_name`/`full_name` for cross-tenant → key-set and substring assertions fail; (ii) classify only within the caller's tenant (RLS-like) → the cross-tenant number comes back `ok` → fails. |
| **T6 (one shared fixture matrix, run twice)** | The same matrix (§7.2) is run against the **TypeScript gate** and against the **SQL function**; both must return the same verdict on every row, and each is compared to the matrix's expected verdict. | Mutation on **each side separately**: (a) TS gate switched to rev1's membership-only rule; (b) SQL gate switched likewise — the `qs`-with-`pm`-membership row fails on the mutated side. Third: mutate only one side → the **agreement** assertion fails. |
| **T7 (new)** | **Dry-run writes nothing.** After a dry-run call that returns **accepted (`ok`) verdicts**, row counts of `users` and `project_members` are unchanged; asserts at least one `ok` verdict returned (not vacuous). | Mutation: let dry-run fall through to step 7 → counts change → fails. |
| **T8** | Unauthorised caller's dry-run gets an error, **not** statuses (no oracle); authorisation precedes lookup. | Mutation: move step 5 before step 3 → an unauthorised caller receives statuses → fails. |
| **T9** | **Shape and round-trip.** TypeScript validator over the §3.3 corpus (accept/reject as listed); for every accepted input `normalisePhoneNumber(stored) === stored` and matches `^\+91[6-9][0-9]{9}$`; the function accepts the generic shape and rejects malformed values (`+abc`, empty). | Red: pin that bare `normalisePhoneNumber('abc')` returns `'+abc'` (`normalise.ts:42`), then assert the validator rejects it — fails until the validator exists. Mutation: store the raw input → round trip fails. |
| **T10 (extended)** | **Explicit columns and attribution.** (a) DB read-back: `tenant_id` = project tenant, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = the caller's `users.id` (not the auth uid), `registered_at` non-null and equal across all rows of one call**; membership `role='engineer'`, same tenant. (b) **Source guard** on the migration file: the `INSERT INTO public.users` column list contains `tenant_id, role, status, messaging_blocked, auth_id, registered_by, registered_at` — needed because an omitted `status` is invisible while the default is also `active` (probe d). *"In the payload" is read as the insert payload, i.e. the inserted row plus the INSERT column list; the function's return carries only `user_id`.* | Mutations: drop `registered_by` from the INSERT → (a) and (b) fail; write `auth.uid()` instead of the resolved `users.id` → (a) fails; drop `status` → (b) fails. |
| **T11 (new)** | **Deactivate.** (i) An admin of tenant A **cannot** deactivate a tenant-B user: same `no_data_found` as a nonexistent target, zero writes. (ii) `pm` without membership, and `qs`/NULL role with a membership: `insufficient_privilege`. (iii) Positive control first: the engineer **is** returned by `fetchMorningRoster` and `decideInboundGate` gives `proceed`; after deactivation the engineer is **excluded** from `fetchMorningRoster` (via the module-private `fetchActiveEngineers`, `roster.ts:150,203`) and `decideInboundGate` returns `gated_noop` (`reactivation.ts:29-33`); `whatsapp_number` and the membership are untouched; a second call returns `already_deactivated`. | (i) mutation dropping tenant binding → cross-tenant deactivation succeeds → fails. (iii) Red-before-fix: the function does not exist, so the call fails; mutation setting `messaging_blocked` instead of `status` → `decideInboundGate` returns `reactivate`, not `gated_noop` → fails. |
| **T12 (new)** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty: each constant `!== ''`; each formatter, called with sample parameters, returns a non-empty string. | **Expected-fail at commit** (wrapped in vitest `it.fails`; the repo already uses this, e.g. `test/evening-flow.test.ts:128`; vitest `^3.2.7`, `package.json:44`): every value is blank, so the assertion fails and `it.fails` passes; when the copy PR fills the strings the assertion passes and the `it.fails` wrapper goes red — **that flip is the signal to remove the wrapper.** |
| **T13** | **Boundary test (§7.3):** one literal `+91` value driven through the function in apply mode; row read back in the stored form; cleaned up. | Red: before the function exists the call errors. |
| **T14** | End state, not mechanism (`CLAUDE.md:1011-1016`, the state-loss rule): after adding one engineer, `resolveEngineerProject` (`project-resolution.ts:31-63`) returns `resolved` with that project and the morning roster includes them. | Red: before the function exists → `zero_memberships`. |
| **T15** | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md:478-486`). No local pass is reported as evidence. |
| **T16** | **ACL / privilege evidence** on the real test-db for all three functions: anon-key call → `42501`; `service_role` call → denied; `authenticated` may call the two public functions and **may not** call the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` contains `search_path=public`. | Red: before the REVOKE lines exist, `service_role` and PUBLIC hold EXECUTE by default (probe n shows this for `correct_daily_log`). |
| **T17** | Cross-tenant: tenant-A admin with a tenant-B `p_project_id` gets `no_data_found`, **identical** (errcode and message) to a nonexistent id, zero writes. | Mutation: raise `insufficient_privilege` for foreign ids → indistinguishability assertion fails. |
| **T18** | **Atomicity.** A batch where row K fails after step 5 (second connection commits a conflicting number) leaves **zero** new `users` and `project_members` rows. | Mutation: per-row `EXCEPTION` sub-blocks that swallow the error → earlier rows persist → fails. |

### 7.2 The shared T6 matrix (one data table, two runners)

Columns: caller `users.role` · caller tenant vs project · membership on this project · **expected verdict**
(`allow` / `not_permitted` / `not_found`).

| # | role | tenant | membership | expected |
|---|---|---|---|---|
| 1 | admin | same | none | allow |
| 2 | admin | same | pm | allow |
| 3 | pm | same | pm | allow |
| 4 | pm | same | none | not_permitted |
| 5 | pm | same | engineer only | not_permitted |
| 6 | qs | same | pm | not_permitted |
| 7 | engineer | same | pm | not_permitted |
| 8 | NULL | same | pm | not_permitted |
| 9 | admin | other tenant's project | none | not_found |
| 10 | admin | caller tenant NULL | none | not_found |
| 11 | admin | project id nonexistent | — | not_found |

Rows 6–8 are the rev1 looseness (a `pm` membership alone). The SQL runner calls the function in dry-run mode with one
generic-shape fixture number (so no write, no routable handset). No-session/anon is exercised separately in T16.

### 7.3 Fixture gap, stated as a limit

Printed: `test/helpers/run-scoped-fixtures.ts` derives `+19995552NNNNNN` (`deriveRunScopedPhone`); `test/helpers/db.ts` defines
`TEST_PHONE_PREFIX = '+19995550'` (`:43`) with 3-digit slots, reserves `+19995551NNNNNN` wholesale to the outbound suite (`:112`) and
`+19995552NNNNNN` (`:132-134`), and nests a run-scoped block for slotted phones (`:233`). Test-db actually holds 1,868 × `+` + 14 digits
and 2 × `+` + 11 digits (probe g). **None starts `+91`**, so the India validator rejects every fixture: **the end-to-end tests run on a
shape this screen can never produce.** That is a real limit of this test plan, and it is why the function's shape check is generic (§3.6).

**Boundary test (T13) — exactly one.** It drives **one literal `+91` value** through the function in apply mode, reads the row
back, and deletes it. **No general `+91` fixture block is minted**: every `+91[6-9]` value is a routable Indian handset. The literal is
**`TEST_BOUNDARY_PHONE_LITERAL`, value owed from Aravind (his own handset)** — not chosen here — so no stranger's number is ever stored
(`CLAUDE.md:557-564`, the outbound-send rule). The row is created `active` on test-db, where no cron runs against real Twilio (**ASSUMED**); the test never
sends. Cleanup deletes by exact number (`service_role` DELETE on `users`, probe k; the membership cascades). Limit: concurrent CI runs of this
one test collide on `UNIQUE (whatsapp_number)` (**ASSUMED**, tolerable: it surfaces as R7, not corruption).

## 8. RLS

Live (probes j, k, o): `users` — `users_select` (own row or same tenant), `users_update` (own row; column grant `full_name, avatar_url`,
`015:105`); no INSERT/DELETE policy, `authenticated` lacks INSERT/DELETE (`015:114`). `project_members` — select tenant-scoped; insert/update
require tenant match AND `users.role IN ('pm','admin')`; no DELETE policy (`047:230`). Both tables owned by `postgres`, RLS enabled, **not forced**.
**Both new functions bypass RLS** (definer, owner `postgres`); the policies no longer govern these paths and the functions re-state the role
requirement themselves (§1). Still enforced regardless of RLS: composite FKs (`017:94-106`), `UNIQUE (whatsapp_number)`, `users_role_check`,
`users_status_check`, the new partial index, and the new pairing CHECK. **Cross-tenant:** tenant is never an input (§2.4), the project lookup treats
a foreign project as nonexistent (§2.3 step 2), and the composite FKs agree at the database.

## 9. Strings — every value blank; Aravind writes all wording

No wording is drafted anywhere in this document. **Every value is blank and carries `// Wording owed, NOT approved`.**
~~rev2: `// Tamil owed, NOT approved`, citing `lib/photos/copy.ts:13-20`.~~ **Corrected (rev3 #1):** in this repo `Tamil owed, NOT approved` means
*approved English awaiting Tamil* (`lib/photos/copy.ts:3-6`, `:13-21`; `app/(dashboard)/dashboard/page.tsx:59`), which these strings are not.
`Wording owed, NOT approved` appears nowhere yet (grep s2).

**Formatters, after `formatKeptUntilLine`.** The precedent (`lib/photos/copy.ts:33-46`) is an exported function with **named, positional**
parameters (`expiresAt: string, now: Date`) returning `string | null`, documented by a comment naming the template slot (`:23-32`). These
follow it; whether parameters are positional or one options object is a build-time choice (**ASSUMED positional**, matching the precedent).
Each returns blank until the copy PR.

| Requested name | Function | Named parameters |
|---|---|---|
| `PREVIEW_SUMMARY` | `formatPreviewSummary` | `accepted: number`, `rejected: number` |
| `RESULT_SUMMARY` | `formatResultSummary` | `added: number` |
| `REJECT_NAME_TOO_LONG` | `formatRejectNameTooLong` | `max: number` |
| `ERROR_PASTE_TOO_LONG` | `formatErrorPasteTooLong` | `max: number` |
| *(implied by the spec: "confirm naming the row count")* `ADD_CONFIRM` | `formatAddConfirm` | `count: number` |
| *(already had a name slot in rev2)* `REJECT_ON_ANOTHER_PROJECT` | `formatRejectOnAnotherProject` | `projectName: string` — in-tenant only |

**Constants (blank):** `ADD_ENGINEERS_PAGE_TITLE`, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_ENGINEERS_TEXTAREA_LABEL`,
`ADD_ENGINEERS_PREVIEW_BUTTON`, `ADD_ENGINEERS_APPLY_BUTTON`, `ADD_ENGINEERS_EDIT_BUTTON`, `PREVIEW_ROW_ACCEPTED`, `PREVIEW_ROW_REJECTED`,
`REJECT_NO_NAME`, `REJECT_BAD_NUMBER`, `REJECT_DUPLICATE_IN_PASTE`, `REJECT_ALREADY_ON_THIS_PROJECT`, `REJECT_NUMBER_REGISTERED` (generic; the only rejection
ever used for a cross-tenant number; must not identify the other party), `PREVIEW_NOTHING_TO_APPLY`, `RESULT_ROW_ADDED`, `ERROR_BATCH_NOT_APPLIED`,
`ERROR_PROJECT_NOT_FOUND`, `ERROR_NOT_ALLOWED`, `ERROR_PASTE_EMPTY`, `ERROR_GENERIC_SAVE`, `PROJECT_PAGE_ADD_ENGINEERS_LINK`, `ENGINEERS_LIST_TITLE`,
and, **new in rev3:**

| Constant | Purpose | Where |
|---|---|---|
| `DEACTIVATE_CONTROL` | the deactivate control's label | engineers list |
| `DEACTIVATE_CONFIRM` | its confirm step | engineers list |
| `DEACTIVATE_RESULT` | its result | engineers list |
| `ADD_CONSENT_ATTESTATION` | admin-facing consent attestation shown before apply | confirm step |
| `ENGINEER_STATUS_ACTIVE`, `ENGINEER_STATUS_DEACTIVATED` | status shown per engineer in the list | engineers list |

(`DEACTIVATE_CONFIRM` is a constant per the instruction; if it must name the engineer it becomes a formatter — UNKNOWNS #11.)

**Removed from rev2 §9 and why (kept from rev2):** ~~`RESULT_ROW_RACE`~~, ~~`RESULT_ROW_FAILED`~~, ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~ — one transaction leaves no
per-row apply failure, race outcome or orphan; folded into `ERROR_BATCH_NOT_APPLIED`. **Removed in rev3:** none further; `PREVIEW_SUMMARY`,
`RESULT_SUMMARY`, `REJECT_NAME_TOO_LONG`, `ERROR_PASTE_TOO_LONG` and `REJECT_ON_ANOTHER_PROJECT` changed kind (constant → formatter) rather than being dropped.

**Existing approved strings that already cover a case (reference, do not copy):** `route.ts:55-62` `notRegisteredResponse`;
`project-resolution.ts:71-72` `ZERO_MEMBERSHIPS_REPLY` (a state this screen can no longer produce: no orphan can exist) and `:74-75`
`MULTIPLE_MEMBERSHIPS_REPLY` (the index makes it unreachable for `engineer` rows); `hindrances/actions.ts:24` `SAVE_FAILURE_MESSAGE` is a
non-exported constant outside this slice, not reusable. **No new engineer-facing WhatsApp string:** nothing is sent at add time.

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)

`supabase/.temp/project-ref` printed `exfccwlrhoutkgrlikod`; the log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.

| Probe | Result |
|---|---|
| (a) users with >1 `project_members` row | **0 rows** |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers missing tenant or whatsapp | **2** (tenant present, whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| (e) exact index-predicate violations | **0 rows** |
| (f) `project_members` | 2 rows, both `engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits, zero `+91` |
| (h–l) constraints, indexes, policies, grants, nullability | as cited |
| (n) definer inventory | 15 functions, owner `postgres`, `search_path=public` |
| (o) owner / RLS forced | `postgres`, on, **not forced** |
| (p) `get_user_tenant_id()` | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` `^\+[1-9]\d{1,14}$` |
| (r) live columns, `users` and `project_members` | no `registered_*`, no actor column |
| (s) `registered*`/`deactivat*` columns anywhere | only `tenants.registered_address` |
| (t) role distributions | `project_members`: 2 × `engineer`. `users`: 10 `admin`, 3 NULL-role, 1,872 `engineer`, all `active`; **no `pm`, none deactivated** |

**Would the partial unique index apply cleanly against test-db today? YES** — (a) and (e) return 0 rows. Caveat: 2 `project_members` rows total.

## 11. For Aravind — run against PROD (not run by me)

Read-only; confirm the project ref first; paste raw results back.

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

-- (n) DISTINCT project_members.role values, exact (answers D8: which CHECK set is safe; shows case variants)
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (r) country-code prefix and length only; no personal digits
SELECT left(whatsapp_number, 3) AS prefix, length(whatsapp_number) AS len, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (u) NEW: do registered_by / registered_at / deactivated_* columns already exist on prod?
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE 'registered%' OR column_name ILIKE 'deactivat%');

-- (v) NEW: users by role and status (are there any pm users, or already-deactivated engineers?)
SELECT coalesce(role, '<NULL>') AS role, status, count(*) AS n FROM users GROUP BY 1, 2 ORDER BY 1, 2;
```

## 12. File list

**Created (later build slice, not by this plan):**
- `docs/reviews/048_engineer_registration.sql` (moves to `supabase/migrations/` only at apply), `docs/reviews/048-review-package.md`
- `app/(dashboard)/projects/[id]/engineers/new/page.tsx` and `actions.ts` (preview, confirm, apply — one user-session client, calls the function via `rpc`)
- `app/(dashboard)/projects/[id]/engineers/page.tsx` and `actions.ts` (engineers of this project with status; the deactivate control) — routes **ASSUMED**
- `lib/engineers/parse-roster.ts` (pure: line parser, V1–V3 validator, R1–R4; imports `normalisePhoneNumber`)
- `lib/engineers/gate.ts` (pure advisory `decideEngineerAdminAccess`; reuses `isProjectPm`)
- `lib/engineers/add-engineers.ts`, `lib/engineers/deactivate.ts` (thin `rpc` wrappers, SQLSTATE → constants)
- `lib/engineers/copy.ts` (§9: all blank, `// Wording owed, NOT approved`)
- tests per §7, the shared matrix `test/helpers/engineer-gate-matrix.ts`, `test/migration-048.test.ts`
**Modified (build slice):** `scripts/migration-number-reservations.json` (reserve 048); `docs/build-status.md`; `types/database.ts` (regenerated after apply);
`app/(dashboard)/projects/[id]/page.tsx` — **one link only**, optional.
**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`, or any existing migration.
`is-project-pm.ts` and `normalise.ts` are **imported, not edited**. **This revision's diff:** exactly one file, `docs/plans/add-engineer-plan.md`.

## Decisions

| | Status |
|---|---|
| D1 `status='active'` + `registered_by`/`registered_at` | **settled** |
| D2/D5 SECURITY DEFINER function | **settled** |
| D3 India-mobile only (validator, TypeScript) | **settled** |
| D4 100-char names, 50 lines | **settled** |
| D6 role gate = intersection (§1) | **settled** |
| D7 dry-run flag | **settled** |
| **D8** add a CHECK on `project_members.role` in the same migration (allowed set after prod query n) | **open — recommended** |
| **D9** should the DB also require/record the consent attestation (e.g. a fourth parameter)? Recommendation: enforce in the server action now; add DB enforcement only if you want the attestation itself to be auditable | **open** |
| **D10** record who deactivated and when (`deactivated_by`/`deactivated_at`)? Not specified, not added; status is otherwise overwritten with no record | **open** |

## UNKNOWNS

**Not determinable from printed source or the test database:**
1. **Prod state.** Whether queries a/e return rows, `project_members` size and role values (n), whether prod already has `registered_*` columns (u), users by role (v). The prod phone evidence (n=1, prefix `+91`) is Aravind's report, not in this log.
2. **What Twilio actually sends in `From`.** Only `normalise.ts:4` and test fixtures (`test/webhook.test.ts:263`) say `whatsapp:+E164`.
3. **Prod/test-db parity for 048's target.** Probes ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** No gate designed.
5. **Whether a deactivated engineer's in-flight `whatsapp_sessions` row needs cleanup.** The gate runs first (`route.ts:146-162`) so inbound is dropped silently; I did not trace sessions or the sweep functions.
6. **`pg_temp` in `search_path`.** All 15 existing definer functions use `search_path=public` only (probe n); not settled from repo source.
7. **Rate limiting across calls** — only the 50-row per-call cap bounds the R7 oracle.
8. **Other consumers of `project_members.role = 'engineer'`.** Not resolved; the rosters I read key on `users.role`.
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
10. **Whether any path creates `users.role='pm'`.** g8 found none; it is a pattern search and cannot see live data (probe t is test-db only).
11. **Whether `DEACTIVATE_CONFIRM` must name the engineer** (would make it a formatter).
12. **My reading of instruction A's word "parsing".** I read it as strict parsing/validation of the jsonb elements and stored-shape assertion inside the function; raw-text line parsing and normalisation stay in TypeScript, because D forbids reimplementing `normalise.ts` and SQL would need a second implementation. If raw-text parsing in SQL was intended, it conflicts with D.
13. **Whether "T10 … in the payload"** means the insert payload (read as such) or the function's return.
14. **Attribution design details** (composite FK, default `ON DELETE`, pairing CHECK, column visibility to tenant peers) are recommendations for the reviewer, not verified against a rehearsal.
15. **Whether vitest `it.fails` behaves as described in T12** on `^3.2.7`: the repo references it (`test/evening-flow.test.ts:128`), I did not run one.
16. **Whether the boundary-test row is harmless on test-db** (no cron against real Twilio there) — assumed; `TEST_BOUNDARY_PHONE_LITERAL` is owed by Aravind.

**Assumed (not verified):** migration number 048 still free at write time and the file name; routes `projects/[id]/engineers[/new]`; the function and the TypeScript gate can be kept in agreement (T6 tests this, does not prove it); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege` by code; concurrency (T15) un-testable here; the deactivate control's location; that no in-flight bot session depends on the new functions.

**Decisions still open:** D8, D9, D10.
