# Add-engineer screen — build plan (rev2)

> PLAN ONLY. rev1 written 2026-09-18 at `c86c5b6` (pinned: `git show
> c86c5b6:docs/plans/add-engineer-plan.md` returns the exact rev1 text). rev2
> written 2026-09-18 on `feat/add-engineer-plan`, base `origin/main` @ `0744110`.
> No application code, no migration file, no SQL function body intended to ship.
> Tier: FULL (identity, tenant isolation, new migration).
>
> **Evidence rule for this revision.** Every claim below cites source that is
> printed in `~/Desktop/add-engineer-plan-rev2.txt` ("the log"). rev1's log omitted
> its file reads; that is fixed here. Citations use `path:line`; database claims cite
> `probe <letter>` (SQL text and result are both in the log). Anything not printed in
> the log is marked **ASSUMED** or listed under UNKNOWNS. Anything Aravind must decide
> is **DECISION**.
>
> **Correction discipline.** rev1 claims that turned out wrong are kept visible in
> ~~strikethrough~~ with a dated correction, in the Revision log below and inline where
> the claim lived. Nothing was silently rewritten. Decided by Aravind, 2026-09-18:
> **D2/D5 → a SECURITY DEFINER database function, not a service client.**

## Revision log — rev2, 2026-09-18 (what changed, and what was wrong)

| # | rev1 said (retracted) | Now | Where |
|---|---|---|---|
| 1 | ~~"§1: this is *tighter* than the DB policy `project_members_insert`"~~ | Tighter on per-project scope, **looser on role**. Resolved by moving the gate into the function. | §1 |
| 2 | ~~"§0 finding 4: the users insert needs the service client; this would be the first dashboard use of `createServiceClient()`"~~ | The fact (authenticated has no INSERT on `users`) stands; the conclusion is **superseded** by the D2/D5 decision. No service client anywhere. | §0 |
| 3 | ~~§2 as a whole: two-client split, per-row `users`+membership inserts, compensating `DELETE`, Sentry orphan path~~ | Replaced by one SECURITY DEFINER function, one transaction. | §2 |
| 4 | ~~"§3: prod shapes are unread"~~ / stored form "determined from code" | Aravind observed prod: `+` + 12 digits, no prefix, n=1. §3 rewritten from printed source and an executed probe. | §3 |
| 5 | ~~§4 "Preview shows" cells contained short quoted candidate labels for each rejection~~ | That was drafted wording, against the no-invented-strings rule. Quotes removed; constants only. (The labels are not repeated here; see the pinned rev1 text.) | §4 |
| 6 | ~~§4 R6: "also what the new partial index enforces"~~ | Misleading: the index never fires from this screen (every pasted row is a new `users.id`). R6 is a **preview-time / apply-pass-1 lookup**, never an insert failure. | §4 |
| 7 | ~~§5 row-by-row, partial apply of valid rows~~ | All-or-nothing. Rows rejected at preview are filtered *before* the call; a state change at apply aborts the whole batch. | §5 |
| 8 | ~~§6 "048 is reserved; 049 is next unreserved"~~ | **Wrong.** `scripts/migration-number-reservations.json` records 048 as "RELEASED, NEVER USED … 048 is free for the next real migration". Number is 048. | §6 |
| 9 | ~~§7 T8 (cleanup test) and T10 (payload spy)~~ | T8 replaced by an atomicity test; T10 replaced by a source guard plus a DB read-back. | §7 |
| 10 | ~~§8 "residual: a bug could write a `users` row into the wrong tenant; cleanup removes it"~~ | Moot: tenant is derived inside the function and cannot be supplied. | §8 |
| 11 | ~~§9 `RESULT_ROW_RACE`, `RESULT_ROW_FAILED`, `RESULT_ROW_FAILED_NEEDS_SUPPORT`~~ | Removed (no per-row apply failure exists). `REJECT_ON_ANOTHER_PROJECT` narrowed to in-tenant only. One batch-level constant added. | §9 |
| 12 | ~~§12 `lib/engineers/classify.ts`; `add-engineers.ts` as "§1 gate + §2 writes"~~ | R5–R7 classification moves into the function; TS keeps only pure parsing and a thin RPC wrapper. | §12 |

## 0. Findings that change the shape of the brief — read first

1. **`status` conflicts with the docs (DECISION D1, still open).** The ENG-01 spec
   (`docs/bot-flows.md:303-308`) says a PM-created engineer is `status='pending'`, gets
   `quoco_engineer_optin`, and becomes `active` on an opt-in reply, with an audit row.
   None of that exists in code (log, greps g1–g3, g6–g7): the only mention of
   `quoco_engineer_optin` in `app`/`lib` is a comment (`route.ts:209`); no `registered_by`
   / `engineer_registrations` anywhere; the only two `users` UPDATEs in app code write
   `notification_email_verified_at` (`app/api/owner/confirm-email/route.ts:281`) and
   `messaging_blocked` (`lib/whatsapp/reactivation.ts:61`) — neither writes `status`.
   Meanwhile a non-`active` user is silently dropped by the webhook
   (`reactivation.ts:29-33`) and the cron roster (`roster.ts:168`). So `pending` would
   create engineers nothing can activate; `active` works today but skips the consent
   step ENG-01 describes. This plan specifies `'active'`, flagged as a deviation.
2. **The partial index cannot fire from this screen's own inserts.** Every pasted row
   creates a brand-new `users.id`, so it can never already hold an engineer membership.
   The index is a backstop against other writers and the deferred reassign flow.
   Consequence: the index test (§7 T2) inserts directly, not through the function.
3. **A missing `status` reads as live because of the column default, not the webhook.**
   `users.status` is `NOT NULL DEFAULT 'active'` (probe d; `012_…sql:45-46`). The gate
   decision is `route.ts:159` → `reactivation.ts:29-33`. `route.ts:128-134` is a
   comment and the lookup. `status` is still set explicitly (§2).
4. ~~`authenticated` cannot INSERT into `users`, so the write needs the service client;
   this would be the first dashboard use of `createServiceClient()`.~~ **CORRECTED
   2026-09-18 (rev2):** the premise holds — `authenticated` has no INSERT on `users`
   (probe k, `ins=false`; `015_…sql:114`), and there is no users INSERT policy (probe j)
   — but the conclusion is superseded by decision D2/D5. The write is done by a
   SECURITY DEFINER function owned by `postgres`, which bypasses RLS because the tables
   are owned by `postgres` with RLS not forced (probe o). No service client is
   involved; g4 confirms none is imported under `app/(dashboard)`.
5. **Phone format chain — no blocking mismatch, with conditions (Part A; full trace in
   §3).** Inbound `fromNumber` is `+` + digits, no `whatsapp:` prefix; that equals the
   observed prod stored shape. The screen must store `normalisePhoneNumber(raw)` output
   and nothing else, and must add validation because that helper never rejects.
6. **The migration number is 048, not 049** (Revision log #8).

## 1. Authorisation

**Who may use the screen and the write path.** A caller whose `users` row, resolved by
`auth_id = auth.uid()`, satisfies the rule in §2 step 4: **`users.role = 'admin'`, or
`users.role = 'pm'` AND a `project_members` row with `role = 'pm'` on this project.**
Both branches also require `users.tenant_id` = the project's tenant.

**The two role columns, where each is written.** `users.role='admin'` for a self-serve
account: `complete_onboarding`, `005_auth_trigger.sql:76-80`, re-written
`016_corrections.sql:177-181`. `project_members.role='pm'` for the creator, independent
of `users.role`: `app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM today
is `users.role='admin'` **plus** `project_members.role='pm'`. `canEditLog`
(`lib/daily-logs/correction.ts:131-132`) gates on `users.role==='pm'`, the wrong column,
and `lib/auth/is-project-pm.ts:8-15` records that it locked a real PM out on prod.

**The helper question.** `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`) checks
`project_members.role='pm'` for the exact `(userId, projectId)`. It is the right helper
for a *TypeScript* gate. It is **not used on the write path any more**: the gate lives
inside the function (§2), so there is one implementation of the rule, in the database,
and no TypeScript copy that can drift from it.

**Where TypeScript still checks.** The page calls `getProfile()`
(`lib/auth/profile.ts:15-29`) so an unauthenticated visitor is redirected to `/login`.
Whether to *render the form* is decided by calling the function in dry-run mode with an
empty list (§2), so the same rule answers it. If page logic and the function ever
disagree, the function wins.

**Correction (dated, kept visible).**
~~"This is *tighter* than the DB policy `project_members_insert`, which is tenant-wide
for `users.role IN ('pm','admin')`. Deliberate."~~ — rev1 §1.
**CORRECTED 2026-09-18 (rev2).** That was wrong in one direction. The policy
(probe j, `with_check`) requires `tenant_id = get_user_tenant_id()` AND
`users.role IN ('pm','admin')`, and is tenant-wide. rev1's rule admitted **any** holder
of a `pm` membership regardless of `users.role`. So rev1 was **tighter on per-project
scope** (a PM only on projects they belong to) but **looser on role** (a membership
holder whose `users.role` is, say, `qs` or `engineer` would have passed; the policy
would have refused them).
**How the SECURITY DEFINER design resolves it.** The function bypasses RLS (probe o), so
`project_members_insert` no longer governs this path at all and the function's own check
is the only gate. It therefore re-states the policy's role requirement itself:
`admin` (tenant-wide, identical to the policy) **or** `pm` + project membership
(the policy's role requirement plus per-project scope). Result: never looser than the
policy on role; tighter on scope for `pm`; equal for `admin`.
**Honest consequence.** Because self-serve accounts are all `users.role='admin'`
(`005:79`, `016:180`), the per-project narrowing only bites for a `users.role='pm'`
account, and grep g8 in the log finds no code or migration that writes
`users.role='pm'` (the only `role: 'pm'` write is the `project_members` insert,
`projects/new/page.tsx:53`; the other hits are reads such as `029:381`, `041:212`).
Limit: g8 is a pattern search, so a differently-spelled writer would be missed
(UNKNOWNS #10). In practice the effective rule today
is tenant-wide, which is already true of the RLS policy and of CLAUDE.md §4's
"scoped to projects where the PM has a row" rule — a platform property, not introduced
here. **DECISION D6:** confirm this role rule.

## 2. The insert — SECURITY DEFINER function (replaces rev1 §2)

> ~~rev1 §2 (two-client split; service-client `users` insert; user-session membership
> insert; compensating delete; Sentry orphan path)~~ — **superseded 2026-09-18 by
> decision D2/D5.** Exact rev1 text: `git show c86c5b6:docs/plans/add-engineer-plan.md`.

### 2.1 Shape (signature and contract only; no body is written here)

One function, `public.add_engineers_to_project`, taking `(p_project_id uuid,
p_engineers jsonb, p_dry_run boolean)` and returning `jsonb`:
`{ applied: boolean, rows: [ { idx, status, … } ] }`. `p_engineers` is an array of
`{ name, whatsapp_number }` objects. **No parameter defaults** (a later signature change
would create a second overload rather than replace it — `CLAUDE.md:361-372`, the
`CREATE OR REPLACE` rule; this is a brand-new function so it is not tripped now, but
the signature is chosen to be final). Row `status` values are machine identifiers, not
wording: `ok` (dry-run: would be added), `added`, `already_on_this_project`,
`on_another_project` (with `other_project_name`), `number_registered`.

**DECISION D7 — the `p_dry_run` flag.** Aravind's spec named two inputs. I added a third
because without it the preview cannot see a number that belongs to **another tenant**:
under RLS a preview would read only its own tenant's `users` (probe j, `users_select`),
so a cross-tenant collision would be invisible until apply and would then abort the
whole batch. With the flag, preview and apply run **the same code path** (no drift
between what was previewed and what is applied) and cross-tenant collisions are caught
at preview, reported only generically. Alternative: no flag, and accept cross-tenant
collisions surfacing only at apply. Recommended: the flag.

### 2.2 Caller identification and `auth.uid()` → `users.id`

Inside the function the caller is resolved exactly as the closest precedent does,
`correct_daily_log`: `SELECT id, role, tenant_id FROM public.users WHERE auth_id =
auth.uid()` (`019_daily_log_corrections.sql:170-171`), and `get_user_tenant_id()`'s live
body is the same join (probe p: `SELECT tenant_id FROM users WHERE auth_id =
auth.uid()`). `users.id` is **decoupled** from `auth.uid()` since 007 (`users.id` has
`DEFAULT gen_random_uuid()`, `007:127`; `auth_id` was backfilled `= id` only for
pre-007 rows, `007:60-67` as printed; `uq_users_auth_id` is a partial UNIQUE index on
`auth_id`, `007:76-78`, so at most one row can match). So `auth.uid()` is **never**
compared to `users.id`; the resolved `users.id` is what is used everywhere
(membership lookup, and any future `created_by`). Failure modes, all raise
`insufficient_privilege` (precedent `019:172-175`): anon/no JWT (`auth.uid()` is NULL, so
`auth_id = NULL` matches nothing), a valid auth user with no `users` row, and — because
engineers and owners have `auth_id` NULL (`CLAUDE.md:833-840`) — an engineer can never be a
caller. A pre-onboarding stub row (role and tenant NULL, `005:20-21,45`) is refused:
`tenant_id` NULL → raise.

### 2.3 Order of operations inside the function (one transaction)

1. Resolve caller (2.2). Raise if none, or `tenant_id` or `role` is NULL.
2. Validate the argument: array length within the cap (**ASSUMED** 50; D4;
   `program_limit_exceeded`, precedent `019:208-212`); `p_dry_run` may pass an empty array
   (that is the page's authorisation probe), apply may not. Each element is an object
   with a non-empty text `name`, ≤ the name cap, and a `whatsapp_number` that matches the
   **stored shape** (§3). Two elements with the same number, or any malformed element,
   raise `invalid_parameter_value` — these are caller bugs (the TypeScript layer already
   filtered them), not user-facing rejections.
3. Load the project row by `p_project_id`. **Not found OR in another tenant → the same
   `no_data_found` error** (precedent `019:219-222`), so a foreign project id is not an
   existence oracle.
4. **Authorise.** `v_caller_tenant IS NOT DISTINCT FROM v_project_tenant` (never `<>`;
   see the NULL trap below) AND (`caller.role = 'admin'` OR (`caller.role = 'pm'` AND
   EXISTS `project_members` with `role='pm'`, this project, this `users.id`)).
   Otherwise raise `insufficient_privilege`. **This runs before any number is looked
   up**, so an unauthorised authenticated caller learns nothing about which numbers
   exist.
5. Classify every row against current state (R5–R7, §4). Inside the function the owner
   can read all tenants, so it must reveal only what §4 allows.
6. If `p_dry_run`, or **any** row is not `ok` → write nothing; return `applied: false`
   with the per-row statuses.
7. Otherwise insert, per row, one `users` row then one `project_members` row (2.5), and
   return `applied: true` with `added` rows and the new ids. Any exception in this step
   rolls back the entire call (one transaction, all-or-nothing).

**The NULL trap the precedent contains.** `019:230` is
`IF v_tenant_id <> get_user_tenant_id() THEN RAISE`. If the caller's tenant is NULL the
comparison is NULL, the `IF` does not fire, and the guard **passes silently**. In 019
that is masked by the membership check that follows (its own comment, `019:224-229`,
says the assert is belt-and-suspenders). Here it must not be copied: use
`IS DISTINCT FROM`, and step 1 already refuses a NULL tenant. Test T1 targets exactly
this.

### 2.4 `tenant_id` is derived from the project row, never a parameter

Why: (a) a parameter is an input the caller controls; a function that accepts it must
validate it, and a missed validation writes a user into the wrong tenant. If tenant is
read from the project row it is not an input, so no argument can name another tenant.
(b) The function is SECURITY DEFINER and bypasses RLS, so RLS cannot catch a wrong
value; the composite FKs (`017…:94-106`, live in probe h) validate the *membership*
against the users row's tenant but cannot validate the `users.tenant_id` value itself.
(c) It removes a class of test cases. The derived value is additionally asserted equal
to the caller's tenant (step 4).

### 2.5 Columns written (every one explicit where a default or NULL would hide a bug)

**`users` row** (columns per `001_core_schema.sql:36-50`, probe l for nullability/defaults):

| column | value | source |
|---|---|---|
| `id` | DB default `gen_random_uuid()`; captured via `RETURNING` | `007_auth_surgery.sql:127`; probe l `column_default` |
| `tenant_id` | the **project row's** tenant — **explicit** | derived (2.4); probe l: nullable, so a default would be NULL |
| `role` | literal `'engineer'` — **explicit** | `users_role_check` allows it (probe h); probe l: nullable |
| `status` | literal `'active'` — **explicit** (D1) | probe d: NOT NULL DEFAULT `'active'`, so omission would also yield `active` — explicit for intent |
| `full_name` | the row's `name`, trimmed | argument |
| `whatsapp_number` | the row's number, already normalised (§3) | argument |
| `messaging_blocked` | `false` — explicit | probe l: NOT NULL DEFAULT false |
| `auth_id` | `NULL` — explicit | `CLAUDE.md:833-840`; probe l: nullable, so no `auth.users` row (contrast `handle_new_user`, `007:155-160`) |
| not set | `avatar_url`, `hierarchy_level`, `reporting_manager_id`, `delegation_active`, `employee_id`, `notification_email` | nullable |

**`project_members` row** (`001_core_schema.sql:72-80`):

| column | value | source |
|---|---|---|
| `id`, `created_at` | defaults | `001:73-74` |
| `tenant_id` | the same derived tenant | `001:75` NOT NULL; composite FKs enforce agreement with both `users` and `projects` (probe h) |
| `project_id` | `p_project_id` (already proven in-tenant, step 3-4) | argument |
| `user_id` | the `RETURNING` id of the row just inserted | step 7 |
| `role` | literal `'engineer'` — **exact string**, or the partial index does not cover the row | probe h: no CHECK on this column, nothing else guards the value |

### 2.6 Atomicity

One function call = one transaction (plpgsql body). Either every `users` and every
`project_members` row is written, or none is. The rev1 orphan-cleanup design, its
compensating `DELETE`, and the Sentry orphan path are **removed** — there is no state in
which a `users` row exists without its membership. (Generic unexpected-exception capture
to Sentry, CLAUDE.md §6, is ordinary error handling and stays.) A race between step 5
and step 7 (two admins, same number) is arbitrated by `UNIQUE (whatsapp_number)`
(`001:44`, live `users_whatsapp_number_key`, probe h): the loser's transaction raises
`23505` and rolls back entirely.

### 2.7 search_path, ownership, EXECUTE

- **search_path.** `SET search_path = public` on the function, and every object
  reference schema-qualified (`public.users`, …), matching house style: all 15 existing
  definer functions carry `config = {search_path=public}` (probe n) and `019:156` declares
  `SECURITY DEFINER SET search_path = public`. **Open question, not resolved from
  source:** none of the 15 append `pg_temp`; whether to deviate is a reviewer question
  (UNKNOWNS #6).
- **Ownership.** All 15 existing definer functions are owned by `postgres` (probe n).
  The tables the function writes are owned by `postgres`, RLS enabled and **not forced**
  (probe o), so the owner bypasses RLS — this is the mechanism that lets the function
  insert into `users` although `authenticated` has no INSERT and no policy exists
  (probes j, k). The migration is not given an explicit `OWNER TO`; the post-apply
  fingerprint reads `proowner` back and expects `postgres` (**ASSUMED** the apply role
  yields `postgres`, as it did for all 15).
- **EXECUTE.** Closest precedent, printed in full in the log: `019:294-295`,
  `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`. The live ACL
  shows what that leaves behind: `correct_daily_log` still carries
  `service_role:EXECUTE` (probe n). `CLAUDE.md:910-918`, the later per-role rule, says revoke by name.
  So this function: **`REVOKE EXECUTE … FROM PUBLIC, anon, service_role`; `GRANT EXECUTE
  … TO authenticated`.** `service_role` has no legitimate call (it carries no
  `auth.uid()`, so step 1 would refuse it anyway); revoking it shrinks the surface.
  Deliberate deviation from 019's ACL, flagged.

### 2.8 What the function does NOT do (bounds the review surface)

- No `UPDATE` and no `DELETE` anywhere: cannot reassign, move, edit or remove.
- No `auth.users` row, no `auth_id`, no login. Roles other than the literal `'engineer'`
  cannot be created; `tenant_id`, `role` and `status` are not caller-suppliable.
- No WhatsApp send, no opt-in template, no audit row (ENG-06 is unbuilt — §0 #1).
- No parsing of raw pasted text and no phone normalisation: TypeScript does both and the
  function only asserts the stored **shape** (§3).
- No dynamic SQL (`EXECUTE format`), unlike `019:246,265`.
- No writes to `projects`, `tenants`, `whatsapp_sessions`, `daily_logs`, or any table
  other than `users` and `project_members`.
- No checks on `projects.status` (UNKNOWNS #4) and no duplicate-name detection (deferred).
- No advisory locks or extra serialisation beyond the unique constraints.
- Reveals to an authorised caller: statuses, and the *name of another project in the
  caller's own tenant*. Reveals nothing about other tenants beyond the generic
  `number_registered`.

## 3. Phone number handling (restated from printed source; no assumption remains)

Everything here is from Part A's log entries: `route.ts` via `git show`, `normalise.ts`
via `git show`, the repo-wide phone grep, and an **executed** probe of the real
`normalisePhoneNumber` over 20 inputs.

**3.1 The exact form `fromNumber` holds at the `.eq` comparison.**
`route.ts:111`: `const fromNumber = normalisePhoneNumber(params.From ?? '')`; then
`route.ts:130-133` `.from('users')…​.eq('whatsapp_number', fromNumber)`. The only helper
called is `normalisePhoneNumber`, imported at `route.ts:5` from `@/lib/whatsapp/normalise`.
Traced by execution: `"whatsapp:+919876543210"` → `"+919876543210"`. So `fromNumber` is
**`+` followed by digits, no `whatsapp:` prefix, no whitespace, hyphens or parentheses**
(`normalise.ts:13-15` strips the prefix, `:18` strips `[\s\-()]`, `:21-23` returns a
`+`-prefixed value as-is). Nothing downstream re-normalises it: `dispatch.ts`,
`session.ts`, `inbound-start.ts` all pass `phoneNumber` through verbatim
(`lib/whatsapp/dispatch.ts:180,199,217`; `inbound-start.ts:463,852`
`.eq('phone_number', params.phoneNumber)`; `session.ts:58,91` — all in the repo-wide phone
`git grep` printed in the log), and tests build `From` as `` `whatsapp:${phone}` `` (`test/webhook.test.ts:263`…).
That real Twilio sends `whatsapp:+E164` is stated only by a comment (`normalise.ts:4`);
it is not observable from this sandbox.

**3.2 Byte-identical to the stored form?** Aravind's prod observation: `+` followed by 12
digits, no prefix (`+999999999999`, n=1). For an Indian number `+91` + 10 digits is `+` +
12 digits, and the inbound form for that number is `+919876543210` — **the same shape,
same bytes, no prefix/spacing/leading-zero/missing-`+` difference**. Two limits, stated
plainly: (a) the mask replaces digits, so it cannot show whether the stored digits start
`91`; (b) byte-identity with any *given* stored value holds only if that value was itself
produced by `normalisePhoneNumber`. The executed probe shows the function is
idempotent on all 20 test inputs (`normalise(normalise(x)) === normalise(x)`), so a value
it produced is a fixed point and will match. **Nothing in the printed chain is a
mismatch → no blocking finding.** It would become blocking if the screen stored the
*raw* pasted string (e.g. `98765 43210`, `09876543210`, or `whatsapp:+91…`), because the
inbound side would never equal it; hence §3.3.

A trap surfaced by the executed probe: `"987654321012"` (12 digits, not starting `91`)
normalises to `"+987654321012"` — the same "+ 12 digits" shape as the prod row, but not
an Indian number. Shape alone therefore cannot prove a stored value is `+91…`; a prod
prefix query is provided in §11.

**3.3 Rule for the screen.** Store exactly `normalisePhoneNumber(raw)` and nothing else;
never a hand-rolled variant. The function (§2) asserts the stored shape; TypeScript
asserts, before calling, that `normalisePhoneNumber(stored) === stored`.

**3.4 Does a helper already exist? Yes — reuse it, do not reimplement.**
`lib/whatsapp/normalise.ts:9` `normalisePhoneNumber`. It is imported, never edited (the
webhook depends on it). It **normalises but does not validate**: `normalise.ts:40-41`
says "Caller should validate downstream", and the executed probe shows `"abc"` → `"+abc"`,
`""` → `"+"`, `"98765 4321"` → `"+987654321"`, `"0091 98765 43210"` →
`"+00919876543210"`. No other phone helper or validator exists anywhere in `lib/` or
`app/` (the grep in the log: the hits are `links.ts` `waMeHref`/`telHref`, which only
format, and comments). `links.ts:10-11` and `reactivate-copy.ts:48-52` both state that
E.164 is "enforced at the write paths (NFR-15)" — but no engineer write path exists in
the repo (grep g5: `users` INSERTs appear only in `handle_new_user` (`005:45`,
`007:158`), one test, and `scripts/rehearse-038.ts:349`). This screen is therefore the
**first** engineer write path and must itself uphold that guarantee.

**3.5 Accepted input formats** (each verified by execution → the stored form):

| input | stored |
|---|---|
| `whatsapp:+919876543210` | `+919876543210` |
| `+919876543210` | `+919876543210` |
| `+91 98765 43210` | `+919876543210` |
| `+91-98765-43210` | `+919876543210` |
| `(+91) 98765-43210` | `+919876543210` |
| `98765 43210` / `9876543210` | `+919876543210` |
| `09876543210` (leading 0, 11 chars) | `+919876543210` |
| `919876543210` / `91 98765 43210` (12 digits, `91…`, no `+`) | `+919876543210` |
| `9198765432` (10 digits that happen to start `91`) | `+919198765432` |

**3.6 Validation, after normalising (DECISION D3, still open).** Recommended: India
mobile only, `^\+91[6-9]\d{9}$` (Phase 1 is India-only, `normalise.ts:6-7`). It is a
subset of the only phone CHECK in the schema, `outbound_sends_to_phone_number_check`
`^\+[1-9]\d{1,14}$` (`031:478-479`, live in probe q) — so a number that passes cannot
later violate that CHECK when the cron sends to it; a looser validator could store
something outbound would then reject. Under this rule the executed probe gives:
rejected — `"0091 98765 43210"` (`+00919876543210`), `"+1 415 523 8886"`
(`+14155238886`, valid E.164 but not India), `"98765 4321"`, `"987654321012"`,
`"98765432101"`, `"abc"`, `"+91abc98765"`, `""`, whitespace-only. Alternative: any
E.164, `^\+[1-9]\d{1,14}$`, which would accept `+14155238886` and `+987654321012`.
Consequence: the test phone blocks are `+1999555…` (`test/helpers/run-scoped-fixtures.ts:60-80`),
which an India-only validator rejects, so DB-level tests must not go through the parser
with fixture numbers (§7).

**3.7 On failure to parse or validate.** That row is REJECTED at preview (R3), nothing
is written for it, it is not coerced, and it is not sent to the function. The function
re-asserts the stored shape and *raises* if handed a malformed number (caller bug).
The two implementations of the shape check (TypeScript regex and the function's) must
agree; §7 T9 runs one corpus through both.

**3.8 Line format (D4, ASSUMED design).** One engineer per line. The number is the
trailing run of digits, `+`, spaces, hyphens, parentheses; the name is everything before
it, trimmed of trailing `,` `-` `:` `|` tab and spaces. Blank lines ignored. Name cap
**ASSUMED** 100 characters (`users.full_name` has no DB length limit, probe l shows
plain `text`). Paste cap **ASSUMED** 50 lines (matches the function's cap, §2.3).

## 4. Rejection cases — which are reachable where

Preview = TypeScript parse (R1–R4) **then** the function in dry-run mode (R5–R7).
Apply = TypeScript parse again, then the function with `p_dry_run = false`, whose step 5
re-evaluates R5–R7 against current state. Precedence is top to bottom.

| # | Reason | Detected by | Reachable at preview? | Reachable at apply? | Preview shows (constant) |
|---|---|---|---|---|---|
| R1 | Missing/empty name | TypeScript parser | yes | re-run; would already have been filtered | `REJECT_NO_NAME` |
| R2 | Name over cap | TypeScript parser | yes | same | `REJECT_NAME_TOO_LONG` |
| R3 | Number unparseable/invalid (§3.6) | TypeScript validator | yes | same | `REJECT_BAD_NUMBER` |
| R4 | Same number twice in the paste | TypeScript, first-seen wins | yes | same | `REJECT_DUPLICATE_IN_PASTE` |
| R5 | Number is an **engineer already on this project** | function step 5 (`already_on_this_project`) | yes | yes, if state changed since preview | `REJECT_ALREADY_ON_THIS_PROJECT` |
| R6 | Number is an **engineer already on another project in the caller's own tenant** | function step 5 (`on_another_project`, carries that project's name) | yes | yes, if state changed | `REJECT_ON_ANOTHER_PROJECT` (in-tenant only, names the project) |
| R7 | Number exists in `users` but does not fit R5/R6: another tenant, or same tenant but not an engineer, or an engineer with no membership | function step 5 (`number_registered`); backed by `UNIQUE (whatsapp_number)`, `001:44`, **global across tenants** | yes | yes | `REJECT_NUMBER_REGISTERED` (generic: no tenant, project or name) |
| R8 | A concurrent add commits the same number between step 5 and step 7 | `23505` on `users_whatsapp_number_key`, transaction rolls back | **no** (cannot occur in a read-only dry run) | yes — whole batch, nothing written | `ERROR_BATCH_NOT_APPLIED` |

**R6 is never an insert failure** (Revision log #6): every pasted row makes a new
`users.id`, so `uq_project_members_one_engineer_project` cannot fire from this function.
It is a lookup result. **Cross-tenant, R6 is impossible to report**: the function only
names a project when the existing user's `tenant_id` equals the caller's; anything else
falls to the generic R7 (§2.8).
Old R9 (membership insert fails after the `users` insert) **no longer exists** — one
transaction.

**What still applies partially.** Rows rejected at **preview** (R1–R7) are simply left
out of the apply call; the admin applies the accepted rows. What is all-or-nothing is
the apply call itself (§5).

**Whole-request refusals** (nothing previewed, nothing written): unauthenticated
(redirect to `/login`); function raises `no_data_found` (project missing **or in another
tenant**, one indistinguishable error) → `ERROR_PROJECT_NOT_FOUND`; raises
`insufficient_privilege` (in-tenant but not permitted) → `ERROR_NOT_ALLOWED`; empty paste
→ `ERROR_PASTE_EMPTY`; over the cap → `ERROR_PASTE_TOO_LONG`.

**Number-existence oracle (R7), named and bounded.** The global UNIQUE means an
*authorised* caller can learn that a number is registered somewhere on Quoco. Bounded by:
authorisation runs first (§2.3 step 4), the generic status carries no detail, and the
50-row cap per call. **Not bounded:** no rate limit across calls (UNKNOWNS #7). It reveals
no more than the webhook's own not-registered reply does (`route.ts:55-62`, printed).

**Gap found and not fixed (deferred).** A number that already exists with **no**
membership (e.g. an orphan from a past failure) is R7 and cannot be repaired from this
screen: that is the deferred "reassign an existing number".

## 5. Atomicity (rewritten)

> ~~"Row-by-row, each row atomic as far as the service client allows; not
> all-or-nothing. A batch of 20 with 3 bad lines applies 17."~~ — rev1 §5, retracted
> 2026-09-18.

**All-or-nothing, per apply call.** The apply call (`p_dry_run = false`) writes every
row or none (§2.6). Preview-time rejections are filtered by the admin *before* the call,
so "3 bad lines" never reach it. If **any** row is not `ok` at the function's own step 5
(state changed since preview), the function writes nothing and returns per-row statuses;
if a concurrent add wins the race after step 5, the transaction aborts on `23505` and
nothing is written. In both cases the admin sees a single batch-level outcome
(`ERROR_BATCH_NOT_APPLIED`) plus, for the first case, the per-row statuses, and must
re-preview. Partial-failure handling is removed entirely.

Concurrency itself (T12) is **not verifiable locally** — `CLAUDE.md:478-486`, the CONCURRENCY rule.
The correctness argument rests on `UNIQUE (whatsapp_number)`.

## 6. The migration (widened: index **and** function)

- **File:** `048_engineer_membership_index_and_add_rpc.sql` (name **ASSUMED**). **Number
  048.** `git ls-tree origin/main supabase/migrations/` (log) ends at 047;
  `scripts/migration-number-reservations.json` on `origin/main` has 14 entries ending at
  048, whose note reads "RELEASED, NEVER USED … 048 is free for the next real
  migration"; a sweep of every sibling `.claude/worktrees/*` in the log finds nothing
  above 048. **ASSUMED still free at write time — recheck `ls supabase/migrations/`,
  `supabase migration list`, the reservations file and sibling worktrees then**
  (CLAUDE.md §6). Held in `docs/reviews/` until applied (CLAUDE.md §6).
- **Index (unchanged from rev1):**
  ```sql
  CREATE UNIQUE INDEX uq_project_members_one_engineer_project
    ON public.project_members (user_id)
    WHERE role = 'engineer';
  ```
  Name checked against live `pg_indexes` (probe i): no collision. Style follows
  `uq_users_auth_id` (`007:76-78`).
- **Not CONCURRENTLY:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
  block and the apply skeleton wraps files in `BEGIN;…COMMIT;`
  (`docs/migration-runbook-template.md:34`). Table is tiny on test-db (2 rows, probe f).
  Prod size unread → §11 query.
- **If pre-flight returns violating rows on prod:** the `CREATE UNIQUE INDEX` fails with
  `23505` and, inside `BEGIN/COMMIT`, the **whole file** (function included) aborts with
  no change. No auto-dedupe (destructive statements are pinned, CLAUDE.md §6). An
  in-file `DO $$ … RAISE EXCEPTION` pre-check lists offending `user_id`s so a human
  decides which membership to keep. Test-db today: probe a **0 rows**, probe e (the exact
  predicate) **0 rows**.
- **Why `UNIQUE (project_id, user_id)` (`001:79`, live `project_members_project_id_user_id_key`,
  probes h/i) is insufficient:** it forbids the same user twice on the *same* project;
  the rule is one engineer → one project *across* projects, and `(P1,U)`,`(P2,U)` are
  distinct pairs. Its index leads with `project_id`, not `user_id`.
- **Why partial:** PMs hold `pm` memberships on many projects
  (`projects/new/page.tsx:49-54` inserts one per project created). A full
  `UNIQUE(user_id)` would break a PM's second project.
- **Review gate (`CLAUDE.md:192-205`), now clearly tripped.** Creating a live function
  trips (a) logic, (b) grants / SECURITY DEFINER, and (c) identity; the index adds to
  (c). The whole PR needs the package. Required evidence shapes (`CLAUDE.md:934-942`
  for the anon call; `:910-918` per-role revokes), all planned into §7: an **anon-key
  call refused with `42501`** (and the ACL read back via
  `has_function_privilege`); a **`service_role` denial** probe against the real database
  (not the scaffold — the local scaffold has no Supabase default ACLs); ACL and
  `proowner`/`proconfig` fingerprint; a rehearsed DOWN (`DROP FUNCTION` + `DROP INDEX`,
  commented per the `down-section-must-be-commented` lint, `CLAUDE.md:1135-1139`,
  `scripts/lint-migrations.mjs:547-552`; rehearsal rule `CLAUDE.md:1120-1128`) on the
  real test-db, not a fresh branch (`CLAUDE.md:74-78`). The migration linter has no index rule (log: zero lines).
- **DOWN and a live app.** The DOWN removes a function the new screen calls. A DB
  rollback with the app deployed leaves a screen whose call fails (mapped to
  `ERROR_GENERIC_SAVE`); no data is at risk and no in-flight bot session depends on it —
  so the "in-flight session stays processable" rehearsal condition (`CLAUDE.md:1120-1128`)
  does not apply (**ASSUMED**: I read that rule, not every consumer), but the DOWN
  itself is still run.
- **After apply:** regenerate `types/database.ts` (the function appears in generated
  types; `CLAUDE.md:853-858`); apply one file at a time via `supabase db query --linked -f`,
  foreground, never `db push`, with explicit go-ahead (`CLAUDE.md:156-160`); the file
  enters `supabase/migrations/` only at apply time (`CLAUDE.md:947-952`); confirm the file
  is on `origin/main`; test-db carries it for real (`CLAUDE.md:142-146`, runbook Step F).

## 7. Positive controls

"Shown to fail" = a captured red run, then the fix, then green, in the PR record.
Non-regression controls get a **mutation** or **negative control** instead.

| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| T1 | A caller whose `users.tenant_id` is NULL (a pre-onboarding stub, `005:45`) is refused, and nothing is written. Guards the NULL trap (§2.3). | Mutation: replace `IS NOT DISTINCT FROM` with `<>` (the `019:230` shape) and remove the explicit NULL refusal → the NULL-tenant caller passes → assertion fails. Restore, green. |
| T2 | A second `role='engineer'` membership for the same user on another project is rejected with `23505` naming `uq_project_members_one_engineer_project`. **Inserted directly** (§0 #2). | Natural red: run on test-db **before** the migration → insert succeeds → test fails. Capture, delete the rows, apply, green. |
| T3 | A user with `users.role='admin'` and `pm` memberships on P1 **and** P2 is unaffected; `pm` on P1 + `engineer` on P2 is allowed. | Negative control on the disposable local Postgres (CLAUDE.md §7): create the wrong index `UNIQUE (user_id)` with no predicate → T3 fails. Then the real index → green. Test-db is never given the wrong index. |
| T4 | Authorisation matrix, through the function: `admin` of this tenant ✓; `admin` + `pm` membership ✓; `pm` + `pm` membership on this project ✓; `pm` with **no** membership ✗ `insufficient_privilege`; `qs`/`engineer` role holding a `pm` membership ✗ (the rev1 looseness, now closed); `pm` of a *different* project ✗; admin of another tenant ✗ `no_data_found`; unauthenticated ✗. | Mutation: gate on membership alone (rev1's rule) → the `qs`-with-membership case passes → fails. Second mutation: gate on `users.role='pm'` only → the `admin`+membership case fails. |
| T5 | Cross-tenant: tenant-A admin with a tenant-B `p_project_id` gets `no_data_found`, **identical** to a nonexistent id (same errcode and message), zero writes. | Mutation: raise `insufficient_privilege` for foreign ids → the "indistinguishable from missing" assertion fails. |
| T6 | `p_dry_run = true` writes **nothing** (row counts of `users` and `project_members` unchanged) yet returns the same statuses apply would. And an unauthorised caller's dry run gets an error, **not** statuses (no oracle). | Mutation: move the classification before the authorisation step → the unauthorised caller receives statuses → fails. |
| T7 | Classification: R5, R6 (with the in-tenant project name), R7 (other tenant; same-tenant non-engineer; engineer with no membership) each yield the right status; R7 output contains **no** tenant, project or name of the other party. | Mutation: return the other tenant's project name in R7 → no-leak assertion fails. |
| T8 | **Atomicity.** A batch of N rows where row K violates a constraint (e.g. a pre-seeded conflicting number inserted after step 5 by a second connection, or a forced failure) leaves **zero** new `users` and zero new `project_members` rows. Replaces rev1's cleanup test. | Mutation: convert the two inserts to per-row `BEGIN … EXCEPTION … END` sub-blocks that swallow the error → rows before K persist → fails. |
| T9 | Shape agreement: one corpus (every §3.5 accepted input, every §3.6 rejected input) run through the TypeScript validator and the function's shape assertion → identical accept/reject. And round trip: `normalisePhoneNumber(stored) === stored`, and the webhook gate lookup finds the row. | Mutation: store the raw input (`98765 43210`) → round trip fails; loosen the SQL regex → agreement fails. |
| T10 | **Explicit columns.** (a) DB read-back: the new `users` row has `tenant_id = project tenant`, `role='engineer'`, `status = <D1 value>`, `messaging_blocked=false`, `auth_id IS NULL`; the membership has `role='engineer'` and the same `tenant_id`. (b) A **source guard** on the migration file: the `INSERT INTO public.users` column list contains `tenant_id`, `role`, `status`, `messaging_blocked`, `auth_id`. (a) alone cannot detect an omitted `status` while D1 = `active`, because the default is also `active` (probe d) — that is why (b) exists. | Mutation: delete `status` from the INSERT list → (b) fails (and, if D1 were `pending`, (a) too). |
| T11 | **ACL / privilege evidence** on the real test-db: anon-key call → `42501`; `service_role` call → permission denied; `authenticated` allowed to call; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` contains `search_path=public`. | Red: before the REVOKE lines exist, `service_role` (and PUBLIC) hold EXECUTE by default (probe n shows this for `correct_daily_log`) → the denial assertions fail. |
| T12 | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (CLAUDE.md §0). No local pass will be reported as evidence. |
| T13 | End state, not mechanism (CLAUDE.md §7): after adding one engineer, `resolveEngineerProject` (`project-resolution.ts:31-63`) returns `resolved` with that project, and the morning roster (`roster.ts:165-168`) includes them. | Red: before the function exists there is no row → `zero_memberships`. |

## 8. RLS

Live inventory on `users` and `project_members` (probes j, k, o):
- `users`: `users_select` (own row by `auth_id`, or same tenant), `users_update` (own
  row; column grant `full_name, avatar_url` only, `015:105`). **No INSERT/DELETE policy,
  and `authenticated` holds neither privilege** (`015:114`; probe k).
- `project_members`: `select` tenant-scoped; `insert`/`update` require tenant match AND
  `users.role IN ('pm','admin')`; **no DELETE policy** (dropped in 047, `047:230`).
- Both tables: owner `postgres`, RLS enabled, **not forced** (probe o).

**This write path does not go through RLS.** The function runs as its owner and bypasses
RLS on both tables; `project_members_insert` no longer applies to it and its role
requirement is re-stated in the function (§1). No service client is involved.

**What is still enforced regardless of RLS:** the composite FKs
`project_members_user_id_fkey (user_id, tenant_id)` and
`project_members_project_id_fkey (project_id, tenant_id)` (`017:94-106`, probe h),
`UNIQUE (whatsapp_number)`, `users_role_check`, `users_status_check` (probe h), and the
new partial index.

**What stops an admin of tenant A creating an engineer under tenant B:** the tenant is
never an input (§2.4); it is read from the project row; the project lookup treats a
foreign project as nonexistent (§2.3 step 3); the caller's tenant must equal it, NULL-safe
(step 4); and the composite FKs make the membership fail at the database if the two
tenants ever disagreed. The rev1 residual risk (a `users` row written to the wrong
tenant) is ~~present, mitigated by cleanup~~ **moot** — there is no supplied value to get
wrong.

## 9. Strings — every one blank; Aravind writes all wording

No wording is drafted anywhere in this document. Each item is an exported constant, value
`''`, with the comment `// Tamil owed, NOT approved` (convention: `lib/photos/copy.ts:13-20`).
Proposed home `lib/engineers/copy.ts` (new).

| Constant (name only) | Purpose | Where shown |
|---|---|---|
| `ADD_ENGINEERS_PAGE_TITLE` | screen heading | page |
| `ADD_ENGINEERS_PAGE_INTRO` | what the screen does | page |
| `ADD_ENGINEERS_FORMAT_HELP` | the one-per-line format, with an example | page |
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
| `REJECT_ON_ANOTHER_PROJECT` | R6 — **in-tenant only; has a slot for the other project's name; never used cross-tenant** | preview row |
| `REJECT_NUMBER_REGISTERED` | R7 — generic; also the **only** rejection used when the number is in another tenant; must not identify the other party | preview row |
| `PREVIEW_NOTHING_TO_APPLY` | zero accepted rows | preview |
| `RESULT_SUMMARY` | count of engineers added (no "not added" count: apply is all-or-nothing) | result |
| `RESULT_ROW_ADDED` | per-row success | result |
| `ERROR_BATCH_NOT_APPLIED` | apply wrote nothing (state changed, or a concurrent add won the race) — **one constant replacing three** | result |
| `ERROR_PROJECT_NOT_FOUND` | function raised `no_data_found` (missing or foreign project) | page |
| `ERROR_NOT_ALLOWED` | function raised `insufficient_privilege` | page |
| `ERROR_PASTE_EMPTY` | empty paste | page |
| `ERROR_PASTE_TOO_LONG` | over the line cap | page |
| `ERROR_GENERIC_SAVE` | any other unexpected failure | page |
| `PROJECT_PAGE_ADD_ENGINEERS_LINK` | entry point on the project page | project detail page |

**Removed from rev1 §9, and why (~~struck~~):**
- ~~`RESULT_ROW_RACE`~~ — a race now aborts the whole transaction; there is no per-row
  race outcome. Folded into `ERROR_BATCH_NOT_APPLIED`.
- ~~`RESULT_ROW_FAILED`~~ — this was "row failed, cleanup succeeded". With one
  transaction there is no per-row failure and no cleanup.
- ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~ — this was "row failed and the compensating
  delete also failed (orphan)". No orphan can exist, so the state is unreachable.
- `RESULT_SUMMARY` narrowed (no "not added" count); `REJECT_ON_ANOTHER_PROJECT` narrowed
  to in-tenant, with the cross-tenant case explicitly routed to `REJECT_NUMBER_REGISTERED`.

**Existing approved strings that already cover a case (reuse by reference, do not copy):**
- `webhook/route.ts:55-62` `notRegisteredResponse` — what an engineer sees if their
  number is not in `users`.
- `lib/whatsapp/project-resolution.ts:71-72` `ZERO_MEMBERSHIPS_REPLY` — what an engineer
  sees with a `users` row but no membership. Under the transactional design this state
  can no longer be produced by this screen (it was reachable via the rev1 orphan path).
- `project-resolution.ts:74-75` `MULTIPLE_MEMBERSHIPS_REPLY` — 2+ memberships; the new
  index makes this state unreachable for `engineer` rows.
- `hindrances/actions.ts:24` `SAVE_FAILURE_MESSAGE` is a non-exported constant in a file
  outside this slice — not reusable; not copied.
- No new engineer-facing (WhatsApp) string: under D1 = `'active'` nothing is sent at add
  time.

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)

`supabase/.temp/project-ref` printed `exfccwlrhoutkgrlikod` and a shell test in the log
prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. (`current_database()`
returns `postgres` on Supabase and does not identify the project.) All queries read-only.

| Probe | Result |
|---|---|
| (a) users with >1 `project_members` row | **0 rows** |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers with null tenant OR null whatsapp | **2** (both: tenant present, whatsapp NULL — probe m, printed in this log) |
| (d) `users.status` | `text`, default `'active'::text`, `is_nullable = NO` |
| (e) exact index-predicate violations | **0 rows** |
| (f) `project_members` roles | 2 rows, both `engineer`/`engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits; zero `+91` |
| (h–l) constraints, indexes, policies, grants, nullability | as cited in §2, §6, §8 |
| (n) SECURITY DEFINER inventory | 15 functions, all owner `postgres`, all `search_path=public` |
| (o) table owner / RLS forced | all four tables owner `postgres`, RLS on, **not forced** |
| (p) `get_user_tenant_id()` body | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` `^\+[1-9]\d{1,14}$` |

**Would a partial unique index on `project_members(user_id) WHERE role='engineer'` apply
cleanly against test-db today? YES** — (a) 0 rows and (e) 0 rows: nothing for it to
reject. Caveat: test-db has 2 `project_members` rows in total, so this is weak evidence
about prod. Test-db holds no `+91` number (probe g), so the prod observation in §3 is
the only real-format evidence.

## 11. For Aravind — run against PROD (not run by me)

Read-only. Confirm the project ref first; paste raw results back.

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

-- (g) stored phone SHAPES, digits masked
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users
WHERE whatsapp_number IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- (n) size and role mix of project_members (is a plain CREATE INDEX OK?)
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (r) NEW: country-code prefix only (first 3 chars, e.g. '+91'); reveals no personal digits.
-- Answers §3.2: does the observed '+' + 12 digits row start '+91', or is it another shape?
SELECT left(whatsapp_number, 3) AS prefix, length(whatsapp_number) AS len, count(*) AS n
FROM users
WHERE whatsapp_number IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;
```

## 12. File list

**Created (later build slice, not by this plan):**
- `docs/reviews/048_engineer_membership_index_and_add_rpc.sql` (moves to
  `supabase/migrations/` only at apply time), `docs/reviews/048-review-package.md`
- `app/(dashboard)/projects/[id]/engineers/new/page.tsx` (route **ASSUMED**)
- `app/(dashboard)/projects/[id]/engineers/new/actions.ts` (`'use server'`: preview and
  apply; one user-session client; calls the function via `rpc`)
- `lib/engineers/parse-roster.ts` (pure: line parser, validator, R1–R4; **imports**
  `normalisePhoneNumber`)
- `lib/engineers/add-engineers.ts` (thin RPC wrapper + mapping of SQLSTATE → constants)
- `lib/engineers/copy.ts` (§9 constants, all blank)
- tests per §7, including `test/migration-048.test.ts`

~~`lib/engineers/classify.ts` (R1–R7 classification)~~ — dropped: R5–R7 now live in the
function; R1–R4 live in `parse-roster.ts`.

**Modified (build slice):** `scripts/migration-number-reservations.json` (reserve 048);
`docs/build-status.md`; `types/database.ts` (regenerated after apply);
`app/(dashboard)/projects/[id]/page.tsx` — **one link only**, optional, flagged so the
touch is deliberate.

**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`,
`lib/whatsapp/`, `lib/daily-logs/`, `lib/auth/`, or any existing migration.
`lib/auth/is-project-pm.ts` is no longer used by the write path; `lib/whatsapp/normalise.ts`
is **imported, not edited**.

**This revision's own diff:** exactly one file, `docs/plans/add-engineer-plan.md`.

## Decisions

| | Status |
|---|---|
| D1 `status` `'active'` vs `'pending'` (conflicts with ENG-01) | **open** |
| D2 client split / D5 service client vs database function | **decided 2026-09-18: SECURITY DEFINER function** |
| D3 validator: India mobile only vs any E.164 | **open** (recommend India-only) |
| D4 line format, 100-char name cap, 50-line cap | **open**, ASSUMED |
| D6 role rule inside the function (`admin`, or `pm` + membership) | **open — new** |
| D7 the `p_dry_run` flag | **open — new** (recommend keep) |

## UNKNOWNS

**Not determinable from printed source or the test database:**
1. **Prod state.** Whether (a)/(e) return rows, `project_members` size, and the prefix and
   length of stored phone numbers. Aravind's observation (`+` + 12 digits, n=1) is
   user-supplied and I could not verify it; the mask cannot show whether it starts `+91`
   (§3.2). Queries (g), (n), (r) in §11.
2. **What Twilio actually sends in `From`.** Only comments (`normalise.ts:4`) and test
   fixtures (`test/webhook.test.ts:263`) say `whatsapp:+E164`; no real payload is in the
   log.
3. **Prod/test-db schema parity for 048's target.** Probes h–q ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** No gate is designed;
   adding to a completed project is allowed.
5. **Consent implications of `'active'` without an opt-in message (D1).**
6. **`pg_temp` in `search_path`.** All 15 existing definer functions use
   `search_path=public` only (probe n); I could not settle from repo source whether the
   new function should append `pg_temp`. Reviewer question.
7. **Rate limiting across calls.** Only the per-call 50-row cap bounds the R7
   number-existence oracle; nothing throttles repeated calls.
8. **Other consumers of `project_members.role = 'engineer'`.** `app/api/cron/dpr-generate/route.ts:22`
   says "role='engineer'" without saying which table's column; I did not resolve it. The
   roster I read keys on `users.role` (`roster.ts:165-168`, printed in the log's
   `roster.ts:155-170` range).
9. **Apply-time role.** That the apply tool creates the function owned by `postgres`, as
   all 15 existing ones are (probe n); read back post-apply.
10. **Whether any path can create a `users.role='pm'` account** (e.g. a future invite
   flow, or a dashboard/SQL-editor edit). g8 found none in `app`, `lib`, `scripts`,
   `supabase/migrations`, but it is a pattern search and cannot see the live data: no
   query in the log counts `users` by role.

**Assumed (not verified):**
- Migration number 048 is still free at write time; file name.
- Route `projects/[id]/engineers/new`; 100-character name cap; 50-line cap.
- Function may be granted to `authenticated` and called through the user-session client
  via `rpc`; not exercised here (no function exists).
- Two implementations of the shape check (TypeScript and SQL) can be kept in agreement;
  T9 tests this rather than proving it.
- `supabase-js` `rpc` returns the function's `jsonb` and maps SQLSTATE such that
  `no_data_found` vs `insufficient_privilege` are distinguishable by code; not exercised.
- Concurrency behaviour (T12): un-testable in this sandbox (CLAUDE.md §0).

**Decisions Aravind must still make before the build slice:** D1, D3, D4, D6, D7.
