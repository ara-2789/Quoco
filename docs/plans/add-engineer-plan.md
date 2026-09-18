# Add-engineer screen — build plan

> PLAN ONLY. Written 2026-09-18 on branch `feat/add-engineer-plan` from
> `origin/main` @ `0744110`. No application code, no migration file, no
> existing file edited. Tier: FULL (identity, tenant isolation, new migration).
> Every claim about current behaviour cites a file:line I read this session.
> Anything not verified is marked **ASSUMED**. Anything Aravind must decide
> is marked **DECISION**. Raw pre-flight output: `~/Desktop/add-engineer-plan.txt`.

## 0. Four findings that change the shape of the brief — read first

1. **`status` is a real conflict with the docs (DECISION D1).** The ENG-01 spec
   (`docs/bot-flows.md:303-308`) says a PM-created engineer is `status='pending'`,
   gets a `quoco_engineer_optin` template, and flips to `active` on an opt-in
   reply, with an audit row (ENG-06). **None of that exists in code:** no code
   sends `quoco_engineer_optin` (grep: only comments, `webhook/route.ts:209`,
   `reactivation.ts:3`); no code writes `users.status='active'` (grep, zero hits);
   no audit table (`registered_by`, zero hits in app/lib/migrations). Meanwhile a
   non-`active` row is silently dropped by the webhook (`reactivation.ts:29-33`,
   `decideInboundGate`) and by both cron rosters (`lib/whatsapp/outbound/roster.ts:168`,
   `.eq('users.status','active')`). So `pending` would create engineers who can
   never transact and nothing can activate. `active` works today but skips the
   consent step ENG-01 describes (the Meta pre-consent record). This plan
   specifies `'active'` and flags the departure; Aravind must confirm (§2).
2. **The partial index cannot fire from this flow's own inserts.** Every row this
   screen creates is a brand-new `users.id`, so it can never already hold another
   engineer membership. "Already on another project" is caught earlier, by the
   global `UNIQUE (whatsapp_number)` (the number already exists, so no new user is
   created). The index is a backstop against *other* writers and against the
   deferred reassign flow. Consequence: the index test (§7 T2) must insert
   directly, not through the screen.
3. **The brief's premise about `route.ts:128-134` is slightly off.** Those lines
   are a comment and the gate lookup. A row with no `status` is treated as live
   because `users.status` is `NOT NULL DEFAULT 'active'` (live probe d;
   `012_whatsapp_session_transition.sql:45-46`), not because the webhook
   special-cases NULL. The decision is at `route.ts:159` → `reactivation.ts:29`.
   The instruction to set `status` explicitly stands regardless (§2, T10).
4. **`authenticated` cannot INSERT into `users` at all** (live probe k: `ins=false`;
   `015_users_update_column_grant.sql:114`; no users INSERT policy, probe j). The
   users insert therefore cannot go through RLS; it needs the service client. This
   would be the **first dashboard code path to use `createServiceClient()`**
   (grep: all current callers are API routes, cron, webhook or `lib/`). Reviewer
   should look at that specifically.

## 1. Authorisation

**Who may reach the screen and the write path:** an authenticated user who is
either (a) a tenant `admin` (`users.role = 'admin'`) whose tenant equals the
project's tenant, or (b) a PM **on this project** (`project_members.role='pm'`
row for this `(user, project)`).

**The two role columns, where each is written:**
- `users.role='admin'` for a self-serve account: `complete_onboarding`, first
  written `005_auth_trigger.sql:76-80`, re-written `016_corrections.sql:177-181`.
- `project_members.role='pm'` for the project creator, independently of their
  `users.role`: `app/(dashboard)/projects/new/page.tsx:49-54`.
So a real PM is `users.role='admin'` + `project_members.role='pm'`. A gate on
`users.role==='pm'` is the known wrong shape: `canEditLog`
(`lib/daily-logs/correction.ts:131-132`) does exactly that, and
`lib/auth/is-project-pm.ts:8-15` records that it locked a real PM out on prod.

**Helper.** `lib/auth/is-project-pm.ts:20-34` `isProjectPm(client, userId, projectId)`
is the right helper for case (b): it checks `project_members.role='pm'` for the
exact pair and takes `users.id` (pass `profile.id`, **not** the auth uid;
`profile-query.ts:10-17`). Caveats I read: it does not cover admins (case (a) is a
separate `profile.role==='admin'` check); it does no tenant check itself (the
tenant proof is §2); it throws on a query error, which the screen must treat as
"refuse", not "not a PM". Pass it the user-session client so RLS scopes the read
(`project_members_select`, tenant-scoped, probe j).

**Order of checks, all server-side, every time (page render, preview action, apply action):**
1. `getProfile()` (`lib/auth/profile.ts:21-29`) — redirects to `/login` if unauthenticated.
2. Load the project through the **user-session** client. RLS `projects_select`
   (`002_rls_policies.sql:91-93`) hides other tenants' projects, so a foreign
   `project_id` returns nothing → refuse as "not found".
3. Assert `profile.tenant_id` is non-null and `=== project.tenant_id`.
4. `profile.role==='admin' || await isProjectPm(...)`. Otherwise refuse.

**Scope note (ties to CLAUDE.md §4 cross-project rule).** An `admin` may add to
any project in their tenant; a PM only to projects where they hold a `pm`
membership. This is *tighter* than the DB policy `project_members_insert`, which
is tenant-wide for `users.role IN ('pm','admin')` (probe j). Deliberate.
Whether a PM-only user (`users.role='pm'`, no admin) should be allowed is covered
by the same rule: yes iff they hold the project's `pm` membership.

**Client-supplied identity is never trusted.** `project_id` comes from the route
param and is re-validated on every action; `tenant_id` is never read from the form.

## 2. The insert

Path: one server action module, `'server-only'`, after §1. Users row via the
**service client** (`lib/supabase/service.ts:8-18`; bypasses RLS, per its header
:4-7, so §1 is the only app-layer gate). Membership row via the **user-session**
client so RLS (`project_members_insert`: tenant match AND `users.role IN
('pm','admin')`, probe j) is a second, independent layer. **DECISION D2:** this
two-client split is my recommendation; the simpler alternative is service client
for both.

**`users` row** (cols from `001_core_schema.sql:36-50`, `005`, `007`, `012`, probe l):

| column | value | source |
|---|---|---|
| `id` | DB default `gen_random_uuid()`; read back via `.select('id')` | `007_auth_surgery.sql:127`; live default confirmed (probe l) |
| `tenant_id` | `project.tenant_id` — **set explicitly, never omitted** | read server-side in §1 step 2; asserted `=== profile.tenant_id` |
| `role` | `'engineer'` — **explicit** | literal; `users_role_check` allows it (probe h) |
| `status` | `'active'` — **explicit** (see D1) | literal |
| `full_name` | parsed name, trimmed | from the pasted line |
| `whatsapp_number` | normalised + validated E.164 (§3) | from the pasted line |
| `messaging_blocked` | `false` — explicit | live default false (probe l); explicit so intent is visible |
| `auth_id` | `null` — explicit | CLAUDE.md §5: engineers have no web login; nullable (probe l) |
| everything else | not set (`avatar_url`, `hierarchy_level`, `reporting_manager_id`, `delegation_active`, `employee_id`, `notification_email`) | nullable / defaulted |

Why explicit `tenant_id`/`role`/`status`: `005_auth_trigger.sql:20-21` dropped
NOT NULL on `tenant_id` and `role`; **live probe l confirms both are nullable**
(and `whatsapp_number` too). Test-db already holds 2 engineers with a null
`whatsapp_number` (probe c/m; tenant present) — the bad state is real, and
`roster.ts:112-120` already special-cases it as "unreachable". A guard rejecting a
null/mismatched tenant runs **before** the users insert, because the DB will not
stop a null-tenant `users` row (§7 T1).

**D1 status.** `'active'` = engineer is live for the webhook and crons the moment
the row exists; no consent message is sent; departs from `docs/bot-flows.md:303-308`.
`'pending'` = follows the doc but the engineer is inert forever until an opt-in
flow that does not exist is built. Recommendation: `'active'`, with the consent gap
recorded as a known deviation. Not my call to make silently.

**`project_members` row** (`001_core_schema.sql:72-80`):

| column | value | source |
|---|---|---|
| `id`, `created_at` | defaults | — |
| `tenant_id` | same value as the users row | proven equal to the project's tenant (§1) |
| `project_id` | the validated route param | §1 |
| `user_id` | the new `users.id` | returned by the users insert |
| `role` | `'engineer'` — **exact string**, or the partial index does not apply to the row | no CHECK on this column (live probe h); nothing else guards the value |

**Tenant-match proof, in three independent layers:** (1) tenant is taken from the
server-read project row, which RLS only returns if it is the caller's tenant;
(2) asserted equal to `profile.tenant_id`; (3) DB backstop —
`project_members_user_id_fkey (user_id, tenant_id) → users(id, tenant_id)` and
`project_members_project_id_fkey (project_id, tenant_id) → projects(id, tenant_id)`
(`017_rls_column_bounding.sql:94-106`, live in probe h) reject any mismatched
membership. The DB cannot check the `users.tenant_id` *value* itself (it is just a
column), which is why layers 1–2 are load-bearing for the users row.

**Order and cleanup.** users insert → membership insert. If the membership insert
fails, delete the just-created users row (`service_role` holds DELETE, probe k),
scoped by that exact `id` AND `tenant_id` AND "has zero `project_members` rows"
(destructive statements are pinned to the exact id, CLAUDE.md §6). If the cleanup
itself fails: `Sentry.captureException` with the orphan id and surface the row as
"failed, needs support" — never report success.

## 3. Phone number handling

**Stored form (determined from code, not from data).** Plain E.164 with a leading
`+`, no `whatsapp:` prefix. Evidence: the webhook computes
`normalisePhoneNumber(params.From)` (`route.ts:111`) and looks up
`.eq('whatsapp_number', fromNumber)` (`route.ts:133`); `normalise.ts:9-43` strips
`whatsapp:`; outbound documents the stored value as `"+919876543210"` and adds the
prefix at send time (`lib/whatsapp/outbound/send.ts:114`, `:179`).
**A stored value must therefore equal `normalisePhoneNumber(stored)` (idempotent
under the webhook's own normalisation), or that engineer can never be matched.**

**Stored values were NOT usable as evidence.** Test-db holds no `+91` value at all:
1,868 are `+` + 14 digits (`+19995552…` test fixtures) and 2 are `+` + 11 digits
(probe g, digits masked). Prod shapes are unread: Aravind runs the masked-shape
query in §11.

**Accepted input** (whatever `normalise.ts:1-7,17-43` already handles): `+91 98765
43210`, `+91-98765-43210`, `98765 43210`, `09876543210`, `919876543210`,
`whatsapp:+919876543210`, parentheses, hyphens, spaces.

**The gap.** `normalisePhoneNumber` never rejects: its last line
(`normalise.ts:42`) prefixes `+` onto any string, so `abc` → `+abc` and `12345` →
`+12345`. It says so itself ("Caller should validate downstream", :40-41). This
screen therefore adds a **separate** validator after normalising — it must not
modify `normalise.ts` (out of slice; used by the webhook).

**DECISION D3 — validator strictness.** Recommended: India mobile only,
`^\+91[6-9]\d{9}$` (Phase 1 is India-only, `normalise.ts:6-7`; CLAUDE.md §1).
Alternative: any E.164, `^\+[1-9]\d{7,14}$`. Consequence of the strict option: the
repo's test phone blocks are `+1999555…` (`test/helpers/run-scoped-fixtures.ts`),
so DB tests cannot go through the parser with fixture numbers; parser tests use
literal `+91` values (pure, no DB) and DB tests call the write function directly.

**A number that fails to parse/validate** → that row is REJECTED in the preview
with reason "unreadable number", nothing is written for it, other rows are
unaffected. It is never silently coerced.

**Line format (DECISION D4, ASSUMED design).** One engineer per line. The number
is the **trailing** run of digits / `+` / spaces / hyphens / parentheses; the name
is everything before it, trimmed of trailing `,` `-` `:` `|` tab and spaces. This
tolerates commas inside names. Blank lines ignored (not counted as rows). Name
must be non-empty and ≤ N chars (N **ASSUMED** 100; `users.full_name` has no DB
length limit). Paste cap **ASSUMED** 50 lines; over the cap the whole paste is
refused, nothing previewed (bounds the number-existence oracle, §4 R7).

## 4. Rejection cases

Classification is server-side, pure where possible, run in the preview **and
re-run from the raw text at apply time** (the preview is never trusted as input).
Precedence is top to bottom; a row gets the first reason that applies.

| # | Reason | Detected by | Preview shows | Other valid rows apply? |
|---|---|---|---|---|
| R1 | Missing/empty name | parser | rejected, "no name" | yes |
| R2 | Name over length cap | parser | rejected | yes |
| R3 | Number unparseable/invalid (§3) | validator | rejected, "unreadable number" | yes |
| R4 | Same number twice in this paste | first-seen set | 2nd+ rejected; 1st kept | yes |
| R5 | Number already on **this** project | tenant-visible lookup via user-session client (`users_select`, `project_members_select`, both tenant-scoped, probe j) | rejected, "already on this project" | yes |
| R6 | Number already on **another** project in my tenant | same lookup (also what the new partial index enforces for role `engineer`) | rejected, "already on another project" | yes |
| R7 | Number already exists in `users` and is not visible to me (other tenant, or same-tenant non-engineer, or same-tenant with no membership) | `UNIQUE (whatsapp_number)`, `001_core_schema.sql:44` (live: `users_whatsapp_number_key`, probe h) — **global across tenants** | one **generic** "number already registered" — no tenant, project or name | yes |
| R8 | Race: number registered between preview and apply | apply-time `23505` on `users_whatsapp_number_key` | result row "not added, number was registered meanwhile" | yes (row-level) |
| R9 | Apply-time membership failure (RLS/FK/other) | insert error → cleanup | result row "failed" + cleanup outcome | yes (row-level) |

Whole-request refusals (nothing applied, nothing previewed): unauthenticated
(→ `/login`), project not found / not permitted (§1), empty paste, over the line
cap, `profile.tenant_id` null or ≠ project tenant.

**Information-disclosure note (R7).** The global UNIQUE means a lookup would tell a
tenant admin that a number is registered *somewhere on Quoco*. The generic reason
plus the line cap limits, but does not eliminate, this number-existence oracle. It
reveals no more than the webhook's own "not registered" reply does
(`route.ts:55-62`, cited by location only). Named, accepted, low; flag for review.

**Gap I found and am not fixing (deferred).** A number that already exists in the
tenant with **zero** memberships (e.g. an orphan from a past partial failure, or a
number added and later removed) hits R7/R6-style rejection and **cannot be
repaired from this screen**. That is the deferred "reassign an existing number".

## 5. Atomicity

**Row-by-row, each row atomic as far as the service client allows; not
all-or-nothing.** A batch of 20 with 3 bad lines applies 17. Reasons:
`supabase-js` cannot span two tables in one transaction, and rejecting a whole
paste for one typo is worse UX for a PM pasting a roster.
- Preview writes nothing.
- Apply processes lines sequentially, one `users` insert + one membership insert
  per line, with the §2 cleanup on membership failure. So a row ends as either
  fully added or not added; the only inconsistent window is a process crash
  between the two inserts (residual, named).
- The admin always sees a per-row result list (added / not added + reason) and
  counts. If the request dies mid-batch the admin sees nothing new, and **must**
  re-run the preview: already-added rows now show as R5, which is correct and safe.
- **DECISION D5 (upgrade path, not recommended now):** a plpgsql RPC would give
  true per-row atomicity (sub-block per row) and let the whole thing run as
  `authenticated` with tenant proof inside the DB. It costs a new SECURITY
  DEFINER function: per-role REVOKEs (CLAUDE.md §6), an anon-call proof, ACL
  fingerprint, DOWN rehearsal, review-gate conditions (a)+(b). That widens the
  migration well beyond "one index". Recommended only if the crash window matters.
- Concurrency (two admins, same number, same instant) is **not verifiable locally**
  — CLAUDE.md §0 CONCURRENCY rule. Its correctness rests on `UNIQUE(whatsapp_number)`
  (R8); tests here would pass trivially. Report as "CI-only", never "verified".

## 6. The migration

- File: `049_project_members_one_engineer_project.sql`. **Number:** 047 is the
  highest applied file; 048 is reserved (`scripts/migration-number-reservations.json`,
  last entry); 049 is next unreserved. **ASSUMED — recheck `ls supabase/migrations/`,
  `supabase migration list`, and the reservations file at write time** (CLAUDE.md §6).
- Lives in `docs/reviews/` until applied (CLAUDE.md §6, "enters `supabase/migrations/`
  when applied"); its reservation entry is a change to the reservations file.
- Definition:
  ```sql
  CREATE UNIQUE INDEX uq_project_members_one_engineer_project
    ON public.project_members (user_id)
    WHERE role = 'engineer';
  ```
  Name checked against live `pg_indexes` (probe i): no collision. Style follows
  `uq_users_auth_id` (`007_auth_surgery.sql:76-78`).
- **Not CONCURRENTLY.** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
  block, and the apply skeleton wraps files in `BEGIN;…COMMIT;`
  (`docs/migration-runbook-template.md`, step C). Table is tiny on test-db (2 rows,
  probe f); a plain `CREATE UNIQUE INDEX` holds a short write lock. Prod size is
  unread → §11 query.
- **Pre-flight and "if (a) returned rows".** On test-db, (a) returned **0 rows**
  and (e) — the exact predicate — returned **0 rows**, so the index applies cleanly
  today (§10). (a) is broader than needed (it counts every role); only (e) can block
  the index. If (e) returns rows on **prod**: the `CREATE UNIQUE INDEX` fails with
  `23505` and, inside `BEGIN/COMMIT`, the whole file aborts with no change. The
  migration must **not** auto-dedupe (no general DELETE; destructive statements
  are pinned per CLAUDE.md §6). It carries an in-file `DO $$ … RAISE EXCEPTION`
  pre-check that lists the offending `user_id`s so a human decides which membership
  to keep, then re-derives the pin at apply time.
- **Why `UNIQUE (project_id, user_id)` (`001_core_schema.sql:79`, live
  `project_members_project_id_user_id_key`, probe h/i) is insufficient:** it forbids
  the same user twice on the *same* project. The rule is one engineer → one project
  *across* projects: `(P1,U)` and `(P2,U)` are distinct pairs and both allowed. Its
  index also leads with `project_id`, so it cannot serve a `user_id`-keyed check.
- **Why partial:** PMs legitimately hold `pm` memberships on many projects
  (`projects/new/page.tsx:49-54` inserts one per project they create; test-db has
  none yet, probe a). A full `UNIQUE(user_id)` would break project creation for a
  PM's second project.
- **Review gate (CLAUDE.md §0).** I judge it trips condition (c) "touches auth or
  identity" (**ASSUMED judgment**) and Aravind set FULL; treat the whole PR as
  needing the package. No function, grant or RLS change → the anon-call and
  `service_role`-negative probes apply to nothing new; state that in the package.
  A DOWN block (`DROP INDEX`) commented per the `down-section-must-be-commented`
  lint rule and **rehearsed**, not just written (CLAUDE.md §7). The migration linter
  has no index rule (`grep` of `scripts/lint-migrations.mjs`: none).
- Apply rules to follow when the time comes (not now): one file at a time via
  `supabase db query --linked -f`, foreground, project ref pasted first, explicit
  go-ahead, never `db push`; after apply regenerate `types/database.ts`
  (indexes don't change generated types, so expect an empty diff, verify); confirm
  the file is on `origin/main`; and test-db carries it for real (Step F).

## 7. Positive controls

"Shown to fail" means a captured red run, *then* the fix, *then* the green run, in
the PR record. Tests that are non-regression controls (green before and after) get
a **mutation** or **negative control** instead, stated per test.

| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| T1 | A null/mismatched tenant is refused **before** any users insert, and no users row exists afterwards. Also documents the baseline: the DB *does* accept a null-tenant `users` row (nullable, probe l) but rejects its membership (`project_members.tenant_id NOT NULL`, `001:75`). | Red: with the guard deleted (mutation, captured), the null-tenant row is written → assertion fails. Restore, green. |
| T2 | A second `role='engineer'` membership for the same user on another project is rejected with `23505` naming `uq_project_members_one_engineer_project`. **Inserted directly** (§0 finding 2). | Red is natural: run against test-db **before** the migration is applied; the insert succeeds → test fails. Capture, clean up the rows, then apply, then green. |
| T3 | A user with `users.role='admin'` and `pm` memberships on P1 **and** P2 is unaffected; likewise a user with `pm` on P1 and `engineer` on P2 is allowed (partial predicate). | Non-regression control, so red by **negative control**: on the disposable local Postgres scaffold (CLAUDE.md §7) create the *wrong* index `UNIQUE (user_id)` with no predicate → T3 fails. Then the real index → green. Test-db is never given the wrong index. |
| T4 | Parser: each accepted input shape → exact stored form; each junk input → rejected. | Red: pin the current behaviour that bare `normalisePhoneNumber('abc')` returns `'+abc'` (`normalise.ts:42`), then assert the screen's validator rejects it; fails until the validator exists. |
| T5 | Classification: every reason R1–R7 produces its own outcome; R7 output contains **no** tenant, project, or name of the other party (cross-tenant existing number). | Mutation: make R7 leak the project name → the no-leak assertion fails. |
| T6 | Authorisation matrix: admin of this tenant ✓; `users.role='admin'` + `pm` membership ✓; `users.role='pm'` with no membership ✗; engineer-role member ✗; PM of a *different* project ✗; admin of another tenant ✗; unauthenticated ✗. | Mutation: swap the gate to `profile.role==='pm'` (the `canEditLog` shape) → the admin+pm-membership case fails. |
| T7 | Cross-tenant: tenant-A admin with tenant-B `project_id` → refused, zero writes. DB backstop: service-client membership insert with a mismatched `tenant_id` → `23503` (017 composite FKs). | App test: mutation removing the tenant assertion → fails. The DB-backstop test pre-exists in effect (017) and is a regression guard only; I state that plainly rather than pretending it went red. |
| T8 | Membership failure ⇒ users row deleted, no orphan; cleanup failure ⇒ Sentry + failed row, never success. Uses the codebase's injected-client pattern (`deps.supabaseClient`, `route.ts:85-88`). | Mutation: remove the cleanup → orphan row remains → fails. |
| T9 | Round trip: `normalisePhoneNumber('whatsapp:' + stored) === stored` for every accepted shape, and the webhook gate lookup finds the row. | Red: a variant storing the raw input (e.g. `'98765 43210'`) fails the round trip. |
| T10 | The payload handed to `insert` **contains** `tenant_id`, `role`, `status`, `messaging_blocked`, `auth_id` keys. Payload-level, via an injected spy client. | Necessary because if D1 = `'active'`, an omitted `status` also yields `'active'` by default (probe d) and a DB-level assertion could not tell them apart. Mutation: drop the key → fails. |
| T11 | End state, not mechanism (CLAUDE.md §7 state-loss rule): after adding one engineer, `resolveEngineerProject` (`project-resolution.ts:31-63`) returns `resolved` with that project, and the morning roster (`roster.ts:165-168`) includes them. | Red: before the write path exists there is no row → `zero_memberships`. |
| T12 | Two concurrent adds of the same number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (CLAUDE.md §0 concurrency rule). No local pass will be reported as evidence. |

## 8. RLS

Live policy inventory on `users` and `project_members` (probe j, test-db):
- `users`: `users_select` (own row by `auth_id`, or same tenant), `users_update`
  (own row; column grant limited to `full_name, avatar_url`,
  `015_users_update_column_grant.sql:105`). **No INSERT or DELETE policy; and
  `authenticated` lacks INSERT/DELETE privilege** (probe k; `015:114`; further
  revokes in `047_revoke_unused_table_rights.sql:215`).
- `project_members`: `select` tenant-scoped; `insert`/`update` require tenant match
  AND `users.role IN ('pm','admin')` (looked up via `auth_id = auth.uid()`);
  **no DELETE policy** (dropped by 047, `047…:230`). `authenticated` holds INSERT
  (probe k).

**Which path uses RLS.** users insert: **service client, RLS bypassed** — forced,
not chosen (RLS cannot permit it). Membership insert: **user-session client, RLS
applies** (D2). Because the users insert bypasses RLS, §1 is the only app-layer gate
there, so §1 runs identically in the page, the preview action and the apply action.

**What stops an admin of tenant A creating an engineer under tenant B:** §2's three
layers — (1) tenant read from a project row RLS only returns for the caller's own
tenant; (2) explicit equality with `profile.tenant_id`; (3) composite FKs (017) on
`project_members`, plus the RLS `tenant_id = get_user_tenant_id()` check on the
membership insert. Residual: a coding bug in (1)–(2) could write a `users` row into
the wrong tenant (the DB can't validate that value); the membership would then fail
the composite FK, and §2's cleanup removes the row. T1/T7 exist for exactly this.

## 9. Strings — every one blank; Aravind writes all wording

No wording is drafted here. Each is one exported constant, empty, with the comment
`// Tamil owed, NOT approved` (convention: `lib/photos/copy.ts:13-20`). Proposed
home: `lib/engineers/copy.ts` (new).

| Constant (name only) | Purpose | Where shown |
|---|---|---|
| `ADD_ENGINEERS_PAGE_TITLE` | screen heading | page |
| `ADD_ENGINEERS_PAGE_INTRO` | what the screen does | page |
| `ADD_ENGINEERS_FORMAT_HELP` | the one-per-line name+number format, with an example | page, above textarea |
| `ADD_ENGINEERS_TEXTAREA_LABEL` | textarea label | page |
| `ADD_ENGINEERS_PREVIEW_BUTTON` | preview action | page |
| `ADD_ENGINEERS_APPLY_BUTTON` | apply accepted rows | preview |
| `ADD_ENGINEERS_EDIT_BUTTON` | go back and edit the paste | preview |
| `PREVIEW_SUMMARY` | counts of accepted / rejected | preview |
| `PREVIEW_ROW_ACCEPTED` | accepted marker | preview row |
| `PREVIEW_ROW_REJECTED` | rejected marker | preview row |
| `REJECT_NO_NAME` | R1 | preview row |
| `REJECT_NAME_TOO_LONG` | R2 | preview row |
| `REJECT_BAD_NUMBER` | R3 | preview row |
| `REJECT_DUPLICATE_IN_PASTE` | R4 | preview row |
| `REJECT_ALREADY_ON_THIS_PROJECT` | R5 | preview row |
| `REJECT_ON_ANOTHER_PROJECT` | R6 | preview row |
| `REJECT_NUMBER_REGISTERED` | R7 (generic, must not identify the other party) | preview row |
| `PREVIEW_NOTHING_TO_APPLY` | zero accepted rows | preview |
| `RESULT_SUMMARY` | added / not added counts | result |
| `RESULT_ROW_ADDED` | per-row success | result |
| `RESULT_ROW_RACE` | R8 | result row |
| `RESULT_ROW_FAILED` | R9, cleanup ok | result row |
| `RESULT_ROW_FAILED_NEEDS_SUPPORT` | R9, cleanup failed (orphan) | result row |
| `ERROR_PROJECT_NOT_FOUND` | whole-request refusal | page |
| `ERROR_NOT_ALLOWED` | not admin / not project PM | page |
| `ERROR_PASTE_EMPTY` | empty paste | page |
| `ERROR_PASTE_TOO_LONG` | over the line cap | page |
| `ERROR_GENERIC_SAVE` | unexpected failure | page |
| `PROJECT_PAGE_ADD_ENGINEERS_LINK` | entry point on the project page | project detail page |

**Existing approved strings that already cover a case (reuse by reference, do not
duplicate):**
- `webhook/route.ts:57-62` `notRegisteredResponse` — what an engineer sees if their
  number is not in `users`. Covers "engineer texts before being added"; no new
  engineer-facing string needed.
- `lib/whatsapp/project-resolution.ts:71-72` `ZERO_MEMBERSHIPS_REPLY` — what an
  engineer sees if a `users` row exists with no membership (i.e. the orphan case,
  §2). It is also why the cleanup matters.
- `project-resolution.ts:74-75` `MULTIPLE_MEMBERSHIPS_REPLY` — what an engineer on
  2+ projects sees; the new index exists to make this state unreachable for
  `engineer` rows.
- `hindrances/actions.ts:24` `SAVE_FAILURE_MESSAGE` is **not** reusable: it is a
  non-exported module constant in a file outside this slice. Not copied.
- No new engineer-facing (WhatsApp) string: under D1=`'active'` nothing is sent at
  add time. Under `'pending'` the opt-in template (unbuilt) would be needed.

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)

`supabase/.temp/project-ref` printed `exfccwlrhoutkgrlikod` → **test-db**, as expected.
(`current_database()` returns `postgres` on Supabase and does not identify the
project; the ref file does.)

| Probe | Result |
|---|---|
| (a) users with >1 `project_members` row | **0 rows** |
| (b) engineer users by status | 1,872 `active`; no other status |
| (c) engineers with null tenant OR null whatsapp | **2** (both: tenant present, whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, `is_nullable = NO` |
| (e) *extra* — exact index predicate violations | **0 rows** |
| (f) *extra* — `project_members` roles | 2 rows total, both `engineer`/`engineer` |
| (g) *extra* — stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits; zero `+91` |
| (h–k) *extra* — live constraints, indexes, policies, grants | as cited in §2, §6, §8 |
| (l–m) *extra* — nullability, breakdown of (c) | `tenant_id`, `role`, `whatsapp_number` nullable |

**Would a partial unique index on `project_members(user_id) WHERE role='engineer'`
apply cleanly against test-db today? YES.** Query (a) returned 0 rows (no user has
more than one membership of any role) and (e), the exact predicate, returned 0 rows
(no user has two `engineer` memberships). There is nothing for the unique index to
reject. Caveat: test-db has 2 `project_members` rows in total, so "clean" here is
weak evidence about prod's shape; prod is unread.

## 11. For Aravind — run against PROD (not run by me)

Read-only. Paste the raw results back. Confirm the project ref first.

```sql
-- (a) exactly as run on test-db
SELECT pm.user_id,
       u.role AS users_role,
       array_agg(pm.role ORDER BY pm.project_id) AS project_members_roles,
       array_agg(pm.project_id ORDER BY pm.project_id) AS project_ids,
       count(*) AS membership_count
FROM project_members pm
JOIN users u ON u.id = pm.user_id
GROUP BY pm.user_id, u.role
HAVING count(*) > 1
ORDER BY membership_count DESC;

-- (e) the exact index predicate: any row here would block CREATE UNIQUE INDEX
SELECT user_id, count(*) AS engineer_memberships, array_agg(project_id) AS project_ids
FROM project_members
WHERE role = 'engineer'
GROUP BY user_id
HAVING count(*) > 1;

-- (g) stored phone SHAPES, digits masked (answers §3: what form does prod actually hold?)
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users
WHERE whatsapp_number IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- (n) size and role mix of project_members (answers §6: is a plain CREATE INDEX OK?)
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;
```

## 12. File list

**Created (all in the later build slice, not by this plan):**
- `docs/reviews/049_project_members_one_engineer_project.sql` (moves to
  `supabase/migrations/` only at apply time)
- `docs/reviews/049-review-package.md`
- `app/(dashboard)/projects/[id]/engineers/new/page.tsx` (route **ASSUMED**; screen)
- `app/(dashboard)/projects/[id]/engineers/new/actions.ts` (`'use server'`: preview, apply)
- `lib/engineers/parse-roster.ts` (pure: line parser + validator)
- `lib/engineers/classify.ts` (pure: R1–R7 classification)
- `lib/engineers/add-engineers.ts` (server-only: §1 gate + §2 writes)
- `lib/engineers/copy.ts` (§9 constants, all blank)
- `test/unit/…` and `test/…` files per §7, plus `test/migration-049.test.ts`

**Modified (build slice):**
- `scripts/migration-number-reservations.json` (reserve 049)
- `docs/build-status.md` (session record)
- `app/(dashboard)/projects/[id]/page.tsx` — **one link only**, the entry point
  (`PROJECT_PAGE_ADD_ENGINEERS_LINK`). Optional: if omitted the screen is reachable by
  URL only. Flagged so the touch is deliberate.

**This plan's own diff:** exactly one file, `docs/plans/add-engineer-plan.md`.
Nothing under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`,
and no existing migration, is modified by this plan or by the slice above.
`lib/auth/is-project-pm.ts` and `lib/whatsapp/normalise.ts` are **imported, not edited**.

## UNKNOWNS

**Could not determine from code or test-db:**
1. Prod state of `project_members`/`users` — whether (a)/(e) return rows, table
   size, and the stored phone shapes (§11 queries).
2. Whether prod's live schema matches test-db's (probes h–l were test-db only; the
   CLAUDE.md rules note test-db/prod are schema-identical post-016 but I did not
   verify 049's target on prod).
3. Whether any code outside this slice reads `project_members.role = 'engineer'`
   (`app/api/cron/dpr-generate/route.ts:22` says "role='engineer'" without saying
   which table's column; I did not resolve it). The roster I read
   (`roster.ts:165-168`) keys on `users.role`, not the membership role.
4. Whether `projects.status` (`active/completed/on_hold/…`) should gate adding
   engineers. No gate is designed; adding to a completed project is allowed.
5. Meta/consent implications of `'active'` without an opt-in message (D1).

**Assumed (not verified):**
- Next migration number is 049 (§6) — recheck at write time.
- Route path `projects/[id]/engineers/new` and the 100-char / 50-line caps (D4).
- Migration trips review-gate condition (c) (judgment).
- Two-client split (D2) is acceptable to the reviewer.
- India-mobile-only validation (D3).
- That `supabase-js` inserts here are not transactional across tables (true of the
  REST API; not re-tested).
- Concurrency behaviour (T12) — un-testable in this sandbox by the CLAUDE.md rule.

**Decisions Aravind must make before the build slice:** D1 status (`active` vs
`pending`, conflicts with ENG-01), D2 two-client split, D3 validator strictness,
D4 line format and caps, D5 service-client-with-cleanup vs an RPC.
