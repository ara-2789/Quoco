# Migration 007 — Auth Surgery — Checkpoint 1 Review Document

**Status:** PLAN ONLY. No SQL written, no code changed, no database touched.
**Audience:** second-pair-of-eyes reviewer (cold read).
**Author prep date:** 2026-07-08 · **Revised:** 2026-07-08 (round 1 + round 2 review responses)
**Reviewer feedback (verbatim):** `docs/reviews/007-checkpoint-1-feedback.md` (round 1),
`docs/reviews/007-checkpoint-1-feedback-round-2.md` (round 2 — reviewer's terms: "Fix 1–4, fold in 5, and this is APPROVED without another full round").
**Decision needed from reviewer:** approve / amend the scope, data-migration, and app-code coordination plan below BEFORE any SQL for 007 is written.

> ⚠️ **READ THIS FIRST — the docs lie about the current state.**
> `docs/schema.md` describes the *post-007* world as if it already exists
> (it says `users.id` is "a standalone PK, NOT FK to auth.users" and that
> `get_user_tenant_id()` matches on `auth_id`). **That is not the live
> schema.** I verified the actual applied migrations (001, 002, 005, 012).
> In production **today**:
> - `users.id` **IS** `auth.users(id)` — `PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` (constraint auto-named `users_id_fkey`).
> - There is **no `auth_id` column at all**.
> - `get_user_tenant_id()` matches on `WHERE id = auth.uid()`.
> - Every RLS policy and every dashboard page assumes `users.id == auth.uid()`.
>
> So 007 is not "tidy up a column." It is **changing the primary identity key
> of every user in the system**, and everything downstream currently leans on
> the equality it removes. That is the whole reason this is Checkpoint 1.

> **Revision note (round 1):** the reviewer's central challenge was *"you never
> justified the surgery itself."* Correct. §0 below now makes that decision
> explicitly instead of inheriting it from `schema.md`. Other round-1 fixes:
> unique+indexed `auth_id` (§1a/§5), FK changed to `ON DELETE RESTRICT` with a
> lifecycle section (§10), the role rename evicted from 007 (§1), deploy-window
> argument (§4/R3), PITR + pooler in sequencing (§5), and test-harness JWT
> requirement (§6).

---

## 0. ALTERNATIVES CONSIDERED — is decoupling even the right move?

Three designs satisfy the actual requirement — *"engineers and owners need
`users` rows without a web login."* This section exists to **make** the decision,
not to defend a foregone one.

### Option (a) — Shadow auth users (keep the FK intact)

Keep `users.id == auth.users.id`. For each engineer/owner, create a placeholder
`auth.users` row (phone-identity, no password) so a `users` row can legally exist
under the current FK. Our Pass-1 test fixture already does exactly this via
`supabase.auth.admin.createUser()` — the mechanics are proven, not hypothetical.

**Advantages**
- **No FK drop → no irreversible migration.** The single biggest risk in this
  whole document (R6) simply does not exist under (a).
- No RLS rewrites, no helper change, **no app-code lockstep** — the entire §3
  audit evaporates.
- Fully reversible.
- Promotion to a web login later is *free*: the identity already exists; you just
  attach real credentials.

**Costs**
- **ENG-01 takes a hard dependency on the auth admin API on its hot path.** The
  most common creation path in the product (PM adds an engineer from name +
  phone) turns from a plain `INSERT` into an external network call that can
  fail/timeout mid-flow. *Partial mitigation:* it could be routed through the
  jobs table (NFR-16) with retry — but that adds real complexity to what should
  be a trivial insert.
- **Phantom auth accounts accumulate.** Every engineer/owner occupies the
  `auth.users` namespace. The "who can log in?" invariant softens from *"has an
  auth row"* to *"has an auth row **with usable credentials**"* — a weaker,
  easier-to-get-wrong statement. Attack surface: if phone-auth were ever enabled
  or misconfigured, those numbers could receive an OTP. Today we are
  magic-link-**email**-only and engineers have no email, so they cannot
  authenticate — but that safety rests on a config staying a certain way.
- **Cost / billing dimension — VERIFIED, not assumed:** Supabase bills
  **Monthly Active Users**, defined as a *distinct count of users who log in or
  refresh a token* during the billing cycle — **not** a count of existing
  `auth.users` rows. A shadow user who never authenticates does **not** count
  toward MAU, and paid plans include a 100,000-user free quota.
  (Source: Supabase Docs, *Manage Monthly Active Users usage* —
  https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)
  **So the billing objection to shadow users is weak-to-nil.** The reviewer's
  recollection was correct; this removes what would otherwise have been the
  strongest cost argument against (a).

### Option (b) — Split the table (`people` vs `users`)

`users` today conflates three concepts: auth identity, person/profile, and tenant
membership. Introduce a `people` (or `participants`) table for non-login humans;
keep `users` strictly = "can authenticate." FK stays intact.

**Advantages:** honest domain model; the "who can log in" invariant stays hard.
**Costs:** `daily_logs.engineer_id` and `project_members.user_id` re-point to
`people`; **every query that joins `users` for engineer/owner data changes**; new
FKs, new RLS on `people`. This is effectively a *larger* rewrite than 007 and
carries its own app-code lockstep problem — with none of 007's irreversibility
saved relative to (a). Highest churn of the three.

### Option (c) — Nullable `auth_id` (this document's plan)

Drop `users_id_fkey`; add nullable `auth_id` FK to `auth.users`; engineers/owners
have `auth_id = NULL`. The rest of this document details it.

**Advantages:** the domain model is honest (a WhatsApp user simply *is not* an
auth user, and the schema says so); engineer creation stays a **plain insert**
with no external dependency; one well-trodden pattern.
**Costs:** irreversible FK drop (R6); helper + 8 policies + ~11 app sites rewritten
in lockstep (§3); the R1 lock-out ordering hazard.

### Decision

**Recommended: (c) nullable `auth_id`** — but I want to be honest that, with the
billing objection now *verified away*, **(a) and (c) are much closer than the
original draft implied**, and (a)'s freedom from irreversibility is a real point
in its favour.

The deciding factors for (c):
1. **Engineers/owners are the majority user class of this product**, not an edge
   case. Modeling the majority as placeholder rows in an auth system they never
   touch (option a) is a modeling smell that compounds over every future feature.
2. **Their creation path should be a plain `INSERT`, not an external auth-API
   call** on the hot path (ENG-01). (a) inverts this.
3. (b) buys domain honesty at the price of the biggest rewrite, with no
   reversibility advantage over (a) — it's dominated.

**Two further arguments for (c), surfaced in round 2 (they strengthen the call,
they do not reopen it):**
4. **Shadow users' "no trigger changes" advantage is actually false.**
   `on_auth_user_created` fires on **every** `auth.admin.createUser()` call —
   *including* the shadow-engineer provisioning that option (a) depends on. So
   under (a), `handle_new_user` would need extra logic to distinguish a *real*
   human signup from a *shadow* provisioning call, and that logic races against
   the ENG-01 insert creating the same person's row. That is **uglier than
   anything (c) requires** — (a)'s headline simplicity claim doesn't survive
   contact with the existing trigger.
5. **Supabase enforces global phone uniqueness in `auth.users`.** An engineer
   working for two different builders — *two tenants, same phone number*, entirely
   unremarkable in Indian construction — is **impossible to model as shadow
   users** (one phone → one auth row → one tenant). Under (c) it's simply two
   ordinary `users` rows. This is a correctness ceiling on (a), not a preference.

> **Adjacent known issue (recorded, NOT 007's job to solve):**
> `uq_whatsapp_sessions_phone_number` (migration 012) has this **exact same
> cross-tenant-phone-collision shape one layer up**: the inbound webhook resolves
> an engineer by phone number, and a phone shared across two tenants is a *routing*
> ambiguity that exists regardless of this migration. Flagging it here so it isn't
> lost — it needs a separate decision (e.g. per-tenant WhatsApp sender, or a
> tenant-disambiguation step) and is out of scope for 007.

**Explicit caveat for the reviewer:** if you weight *reversibility* above
*model purity* — a legitimate stance for a solo builder doing an irreversible
change through limited tooling — **(a) is a defensible choice** and I would not
argue hard against it. The one thing I would not accept silently is doing (c)
*without* recording that (a) was a near-tie. It was. This is a genuine judgment
call, not a settled one.

---

## 1. EXACT SCOPE OF 007 — what it changes, what it deliberately does not

*(Scope assumes decision (c). If the reviewer picks (a), most of this document is
moot and 007 as a migration largely disappears — that is the point of §0.)*

### 1a. In scope (the identity surgery — the risky part)

1. **Add `users.auth_id UUID` (nullable), FK `REFERENCES auth.users(id) ON DELETE RESTRICT`.**
   - Guarded `ADD COLUMN IF NOT EXISTS`.
   - The *new* link from a Quoco user to a Supabase Auth login.
   - NULL for `engineer` and `owner` (no web login). Set for `pm`, `qs`, `admin`.
   - **`RESTRICT`, not `SET NULL`** — see §10 for the full rationale (the
     `SET NULL` + trigger combination is a duplicate-profile machine).

2. **Backfill `auth_id` from the current `id` for every existing row** —
   `UPDATE users SET auth_id = id WHERE auth_id IS NULL;`
   Preserves the login link for accounts that exist today (§2).
   **Must run BEFORE steps 4 and 5**, or the owner/admin is locked out (R1).

3. **Add the uniqueness guarantee `auth_id` needs to be safe *and* fast:**
   ```sql
   CREATE UNIQUE INDEX uq_users_auth_id ON users(auth_id) WHERE auth_id IS NOT NULL;
   ```
   - **Named `uq_*`, deliberately NOT `*_key`:** a *partial* unique index cannot
     be expressed as a table constraint (`ADD CONSTRAINT ... UNIQUE` has no
     `WHERE`), so a constraint-style name would imply something it isn't.
   - **Why it is not optional:** `get_user_tenant_id()` hangs off `auth_id` and is
     evaluated on essentially every RLS-guarded query. Without UNIQUE, two rows
     could share an `auth_id` and the helper becomes *nondeterministic* — a login
     silently resolving to an arbitrary (possibly wrong-tenant) row. That is the
     R2 cross-tenant failure **with no policy bug required.** Without the index,
     the hottest lookup in the system moves from a free PK-index hit to a
     sequential scan — invisible at 10 users, a per-query tax at 10k.
   - Positioned **immediately after the backfill** (step 2 → 3) so the index
     builds over already-populated, already-unique values (`auth_id = id`, and
     `id` is the PK).

4. **Drop the FK `users_id_fkey`** (`users.id → auth.users.id`).
   - `id` stays a UUID PK with the same values; it just stops being tied to auth.
   - Guarded: look up the constraint name and drop if present (auto-named
     `users_id_fkey`, confirmed empirically by the Pass-1 fixture FK violation).

5. **Rewrite `get_user_tenant_id()`** to match on `auth_id`:
   `SELECT tenant_id FROM users WHERE auth_id = auth.uid()`.
   - **Keep it `STABLE SECURITY DEFINER SET search_path = public`.** Verified: it
     is *already* declared exactly this way (`002_rls_policies.sql:12–20`), so
     Postgres can plan it as an InitPlan (once per query) rather than per-row.
     The rewrite must preserve all three qualifiers — do not drop `STABLE`.

6. **Rewrite `handle_new_user()`** — no longer a blind insert. It must *re-link*
   to an existing pre-created profile when one matches, and insert only otherwise.
   Full spec + security condition in §10.

7. **Rewrite `complete_onboarding()`** (005 RPC): its
   `UPDATE users ... WHERE id = auth.uid()` becomes `WHERE auth_id = auth.uid()`.

8. **Rewrite every RLS policy that uses `auth.uid()` against `users.id`** — full
   list in §3. The bulk of the SQL and the highest-audit-value part.

> **Evicted from 007 (round-1 fix, point 5):** the `client → owner` role rename
> is **no longer in 007.** It is not identity surgery — it is a string rename, and
> keeping it here violated this document's own "identity surgery and nothing else"
> thesis while being the *least*-audited change in the riskiest migration. It moves
> to the **corrections migration**, which must carry its **own §3-style audit of
> the string `'client'`** (RLS role subqueries, app `role === 'client'` checks, TS
> role types, badge/label strings) before it is authored. *Preliminary blast-radius
> grep for this review:* the only live occurrence of `'client'` as a role value is
> the `001` CHECK constraint — no app/TS reference — so the corrections-migration
> audit is expected to be small, but it must still be done there, not assumed here.

### 1b. Explicitly OUT of scope for 007 (deferred / already done elsewhere)

- **`users.status` / `users.messaging_blocked`** — **already live via 012**
  (`NOT NULL DEFAULT 'active'` / `NOT NULL DEFAULT false`). 007 must NOT redefine
  them. Leave them out entirely; comment that 012 owns them.
- **`whatsapp_sessions.pending_flows`** — already live via 012. Same rule.
- **`whatsapp_sessions.phone_number UNIQUE`** — created by 012 as
  `uq_whatsapp_sessions_phone_number`. Migration 009 owns the "official" one.
- **`client → owner` role rename** — evicted to the corrections migration (above).
  **Sequencing consequence:** the `'owner'` value will **not** exist in the
  `users.role` CHECK constraint until that corrections migration ships. So any
  owner-creation feature (or `projects.owner_user_id` wiring) has the **corrections
  migration as a hard prerequisite** — attempting to insert a `role='owner'` row
  before it lands will fail the CHECK with a confusing constraint violation.
- **`dprs` / `resolutions` tables** — Week-4 / escalation-engine work → migration 008.
- **Column corrections** (`invoices.amount → (12,2)`, `morning_dependencies/
  hindrances → JSONB`, `projects.owner_user_id`, `daily_logs.is_holiday/
  holiday_reason/evening_dependencies`, `safety_incidents.submitted_via CHECK`,
  `hindrances.dpr_included` default drop, `tenants.stripe_customer_id` rename +
  `paid_until`/`last_payment_ref`) → separate corrections migration, so a bug in a
  trivial rename can never force rollback pressure on the irreversible identity
  change. (Reviewer agreed — §8 Q1/Q4.)

> **Core recommendation:** 007 = the identity surgery and **nothing else.** With
> the role rename now evicted, this is finally true.

---

## 2. EXISTING DATA MIGRATION — what happens to rows already in `public.users`

Today there is at least one real row: the owner/admin account, tied to
`auth.users` (its `users.id == auth.users.id` — the only way a row can exist under
the current FK).

**Plan: `id` never changes. `auth_id` is backfilled from `id`. No row is deleted
or re-keyed.** Every existing FK reference (`projects.created_by`,
`project_members.user_id`, …) points at `users.id`, which is unchanged, so all
stay valid.

Before/after for the existing authenticated admin (illustrative):

```
                     BEFORE 007                         AFTER 007
id            9f3c...e1  (== auth.users.id)     9f3c...e1  (UNCHANGED)
auth_id       (column does not exist)           9f3c...e1  (backfilled = id)
tenant_id     <tenant>                           <tenant>   (unchanged)
role          admin                              admin      (unchanged)
```

Login resolution after 007: the session's `auth.uid()` is still `9f3c...e1`;
`get_user_tenant_id()` now finds the row via `auth_id = 9f3c...e1`. **Identical
result, different column.** This is why the backfill MUST run inside the same
migration, before the function swap — a gap where `auth_id` is NULL but the
function already reads `auth_id` = instant lock-out for the only real user.

Future engineer/owner rows (post-007, the ENG-01 path): generated `id`,
`auth_id = NULL`, no `auth.users` entry. Exactly what Pass 1 needs and what
`users_id_fkey` currently forbids.

---

## 3. EVERYTHING THAT REFERENCES THE OLD `users.id == auth.uid()` ASSUMPTION

**This is the heart of the review. The FK drop is one line; the danger is the
long tail of things silently assuming the equality.** Audited against the live
migrations and the app source.

### 3a. Database functions

| Object | File | Current | Post-007 |
|---|---|---|---|
| `get_user_tenant_id()` | 002:12 | `WHERE id = auth.uid()` | `WHERE auth_id = auth.uid()` (keep STABLE/DEFINER/search_path) |
| `handle_new_user()` | 005:39 | `INSERT INTO users (id) VALUES (NEW.id)` | re-link-or-insert; see §10 |
| `complete_onboarding()` | 005:60 | `UPDATE users ... WHERE id = auth.uid()` | `WHERE auth_id = auth.uid()` |

### 3b. RLS policies that use `auth.uid()` against `users.id` (all in 002, plus the 005 patch)

Policies that use only `get_user_tenant_id()` are **safe** once the helper is fixed.
The ones below reference `auth.uid()` *directly* and DO need rewriting:

| Policy | File:line | Current fragment | Fix |
|---|---|---|---|
| `users_select` (patched) | 005:30 | `id = auth.uid() OR tenant_id = ...` | `auth_id = auth.uid() OR tenant_id = ...` |
| `users_update` | 002:81 | `USING (id = auth.uid())` / `WITH CHECK (id = auth.uid())` | `auth_id = auth.uid()` |
| `tenants_update` | 002:60 | `(SELECT role FROM users WHERE id = auth.uid())` | `WHERE auth_id = auth.uid()` |
| `project_members_insert` | 002:118 | `(SELECT role FROM users WHERE id = auth.uid())` | `WHERE auth_id = auth.uid()` |
| `project_members_update` | 002:125 | same subquery | `WHERE auth_id = auth.uid()` |
| `project_members_delete` | 002:136 | same subquery | `WHERE auth_id = auth.uid()` |
| `daily_logs_insert` | 002:176 | `engineer_id = auth.uid()` | `engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())` |
| `daily_logs_update` | 002:183 | `engineer_id = auth.uid()` **and** role subquery `WHERE id = auth.uid()` | both switch to the `auth_id` form |

> Note on `daily_logs`: engineers submit via the webhook using the **service role
> key** (bypasses RLS), so the `engineer_id = auth.uid()` path is effectively dead
> for real submissions today. But it must still be corrected — otherwise a future
> web-based edit path evaluates `engineer_id = auth.uid()` where `engineer_id` is
> now a standalone id that can never equal `auth.uid()`, i.e. it silently denies
> everything. (Reviewer agreed — §8 Q3, option (a).)

**All "pure tenant" policies** (projects, whatsapp_sessions, safety_incidents,
invoices, hindrances, tenders/*, boq_*, vendors, ra_bills, …) use only
`tenant_id = get_user_tenant_id()` and need **no individual change** — they inherit
the fix from the helper. Confirmed by reading all of 002. Blast radius: **8
policies + 3 functions.**

### 3c. Application code that assumes `users.id == auth.uid()` — **BREAKS unless changed in lockstep**

These server components take `supabase.auth.getUser()` (the **auth** uid) and use
it *directly* as `users.id`. After 007 that equality is gone:

| File:line | Current | Why it breaks post-007 | Fix |
|---|---|---|---|
| `app/(auth)/auth/callback/route.ts:33` | `.from('users').eq('id', user.id)` | looks up profile by auth uid | `.eq('auth_id', user.id)` |
| `app/(onboarding)/onboarding/page.tsx:21` | `getUser()` then `complete_onboarding` RPC | RPC now matches on `auth_id` (3a) | verify the RPC change covers it |
| `app/(dashboard)/layout.tsx:26` | `getUser()` + profile lookup | profile lookup by `id` | `.eq('auth_id', user.id)` |
| `app/(dashboard)/dashboard/page.tsx:37` | `.from('users').eq('id', user.id)` | profile by auth uid | `.eq('auth_id', user.id)` |
| `app/(dashboard)/dashboard/page.tsx:41` | `.eq('user_id', user.id)` (project_members) | uses auth uid as `users.id` FK value | resolve profile.id first |
| `app/(dashboard)/projects/page.tsx:50` | `.eq('user_id', user.id)` (project_members) | same | resolve profile.id first |
| `app/(dashboard)/projects/new/page.tsx:16` | `.from('users').eq('id', user.id)` | profile lookup | `.eq('auth_id', user.id)` |
| `app/(dashboard)/projects/new/page.tsx:35` | `created_by: user.id` | **writes auth uid into a FK to users.id** → FK violation after decouple | `created_by: profile.id` |
| `app/(dashboard)/projects/new/page.tsx:49` | `user_id: user.id` (project_members insert) | **same FK-violation risk** | `user_id: profile.id` |
| `app/(dashboard)/projects/[id]/page.tsx:55` | `getUser()` + downstream lookups | verify any `id`-based lookup | audit when touched |
| `app/(dashboard)/dprs/page.tsx:30` | `.eq('user_id', user.id)` | uses auth uid as a `users.id` FK | resolve profile.id first |

**The `projects/new` writes (lines 35, 49) are the sharpest edge:** today they
work only because `user.id == users.id`. The moment 007 drops the FK and a *new*
PM has a generated `id ≠ auth uid`, these writes put the auth uid into
`created_by` / `project_members.user_id` (still FK to `users.id`) — an immediate
FK violation. **Must ship in the same PR as 007** (§8 Q2).

The **webhook** (`app/api/whatsapp/webhook/route.ts:129`) looks up the user by
`whatsapp_number`, not auth identity, and passes the resulting `user.id` onward —
**already correct** post-007, no change.

### 3d. Triggers

Only `on_auth_user_created` (→ `handle_new_user`, covered in 3a + §10). No other
trigger references the identity equality.

---

## 4. WHAT BREAKS IF WE GET IT WRONG — honest risk list + rollback

| # | Failure mode | What it looks like in prod | Rollback story |
|---|---|---|---|
| R1 | Backfill skipped / ordered after the function swap | Owner/admin **locked out** — `get_user_tenant_id()` returns NULL, every RLS check fails, dashboard empty everywhere | Re-run `UPDATE users SET auth_id = id`. Mitigation: strict ordering + probe `SELECT count(*) FROM users WHERE auth_id IS NULL` must be **0** at migration end. |
| R2 | A policy left half-migrated, OR `auth_id` non-unique | Total denial (safe-ish), or a login resolving to the wrong-tenant row → **cross-tenant read** | Re-apply the corrected policy; the `uq_users_auth_id` index makes the non-unique variant impossible. §3b table + two-JWT isolation test (T-007-03) are the guard. |
| R3 | App code not shipped with the migration | New signup hits a broken onboarding lookup; project creation FK-violates | See the deploy-window analysis below — bounded, DB-first mandatory. |
| R4 | `handle_new_user` blindly inserts (old behaviour) | Duplicate `users` row per returning/ pre-created human (see §10) | Fix trigger to re-link; `UPDATE` the stray row. Caught by T-007-04 (T-007-05 once invitations ship). |
| R5 | FK drop fails on a differing constraint name | Migration aborts partway | Wrap 007 in a single `BEGIN…COMMIT`; look the constraint name up dynamically. |
| R6 | Irreversibility | Once `users_id_fkey` is dropped and rows exist with `auth_id = NULL`, you cannot re-add the FK without deleting those rows or giving them auth.users entries | **Access-path is reversible; data-model is forward-only.** See the "oh no" runbook below. |

**R3 — the deploy window, stated honestly (round-1 fix, point 4).**
A DB migration commits in one instant; a Vercel deploy takes minutes. Atomicity is
impossible, so the question is *why the window is safe.* It is safe because **the
backfill sets `auth_id = id`**: for every user that already exists, the old
equality still holds, so old app code doing `.eq('id', user.id)` keeps working
post-007. **The only casualty in the deploy window is a brand-new signup** (a
generated `id ≠ auth.uid`), who would hit a broken onboarding lookup until the new
app code lands. Therefore:
- **Order is mandatory: DB first, then deploy immediately.** New app code against
  the *old* schema errors instantly on a nonexistent `auth_id` column — strictly
  worse than the reverse.
- The window risk reduces to "a signup in those few minutes gets a transient
  error." Acceptable at beta scale; can be tightened by pausing signups during the
  deploy if desired. The window is **real but bounded** — this is why "same PR"
  (§8 Q2) matters less than knowing the order.

**R6 — the "oh no" runbook (round-1 correction, point 7).**
R6 previously overstated things. The **access path is fully reversible**: because
backfilled rows keep `auth_id = id`, you can point `get_user_tenant_id()` and the
8 policies *back* at `id = auth.uid()` and the pre-existing users work exactly as
before. What you cannot cheaply undo is any **standalone row created after 007**
(`auth_id = NULL`, generated id) — those must be **quarantined** (identified and
set aside) before re-adding any FK. So the runbook is: *(1)* repoint functions +
policies to `id`; *(2)* `SELECT * FROM users WHERE auth_id IS NULL OR auth_id <> id`
to find post-007 standalone rows; *(3)* decide per row (delete test rows; for real
engineers, either keep the decoupled model or mint shadow auth users). Data-model
irreversibility ≠ system-unrecoverable.

**Overall:** the irreversible part (FK drop) is mechanically trivial. The real
risk is **R1 (ordering)**, **R2 (uniqueness/policy completeness)**, and **R3 (app
lockstep)** — process risks, exactly what a second reviewer catches best.

---

## 5. SEQUENCING & REHEARSAL

**Before touching prod (round-1 additions, point 7):**
- **(a) Snapshot / confirm PITR checkpoint immediately before the prod apply.** A
  point-in-time restore **is** the real rollback for the first minutes of an
  irreversible migration — the original draft never said so. We have PITR (Week 2).
  Note the exact timestamp before applying so a restore target is unambiguous.
- **(b) 30-minute investigation task: try the CLI against Supabase's *session
  pooler* connection string (IPv4).** The direct host is IPv6-only (what blocked
  013/014); the session pooler is IPv4 and may let `supabase db push` work
  normally. If it does, **007 goes via CLI**, migration tracking stays clean
  automatically, and we avoid doing identity surgery through a browser textarea +
  hand-run `migration repair`. Only if the pooler also fails do we fall back to the
  SQL-Editor-then-repair dance used for 013/014.

**Order within the 007 transaction (single `BEGIN…COMMIT`):**
1. `ADD COLUMN IF NOT EXISTS auth_id … REFERENCES auth.users(id) ON DELETE RESTRICT`
2. Backfill `UPDATE users SET auth_id = id WHERE auth_id IS NULL`
3. `CREATE UNIQUE INDEX uq_users_auth_id ON users(auth_id) WHERE auth_id IS NOT NULL`
4. Drop `users_id_fkey`
5. `CREATE OR REPLACE` the three functions (helper, trigger fn, onboarding) — helper stays `STABLE SECURITY DEFINER SET search_path = public`
6. Drop+recreate the 8 affected RLS policies

*(No role-CHECK swap here any more — evicted to the corrections migration.)*

**Verification probes (run on branch, before/after):**

| Check | Before | After (expected) |
|---|---|---|
| `auth_id` column exists | absent | present |
| **partial unique index `uq_users_auth_id` exists** | absent | **present** |
| FK `users_id_fkey` exists (query `pg_constraint`) | `true` | `false` |
| **NEW `auth_id` FK to `auth.users` exists with delete rule RESTRICT** (query `pg_constraint` for the FK on `users.auth_id`, assert `confdeltype = 'r'`) | absent | **present, `confdeltype='r'`** |
| `SELECT count(*) FROM users WHERE auth_id IS NULL` | n/a | **0** (backfill worked — the simple invariant, per round-1) |
| `get_user_tenant_id()` source contains `auth_id` | `false` | `true` |
| `get_user_tenant_id()` is STABLE + SECURITY DEFINER + `search_path=public` | `true` | **still `true`** (rewrite preserved qualifiers) |
| Spot-check: as the seeded admin, `SELECT get_user_tenant_id()` returns their tenant | tenant | **same tenant** |
| Insert an engineer row with `auth_id = NULL`, standalone id | FK violation | **succeeds** |

> **Why the new-FK probe matters:** step 1 uses `ADD COLUMN IF NOT EXISTS ...
> REFERENCES ...`, which is **all-or-nothing** — on a *partial rerun* where a
> previous attempt already added the `auth_id` column but not its FK, the
> `IF NOT EXISTS` clause **silently no-ops the entire statement** and the FK never
> gets created. Checking only "column exists" would pass while the FK is missing;
> the `confdeltype='r'` probe is what actually catches that.

**Gate to prod:** branch probes all green **AND** full `npm test` green (unit +
integration, incl. the two-JWT RLS isolation test, T-007-03) **AND** the
coordinated app-code changes reviewed. Then apply to prod (via CLI if the pooler
works, else SQL Editor + `supabase migration repair --status applied 007`).

**Migration 014's pending prod apply:** apply 014 to prod **immediately after** 007
is green on prod (007 is what makes real engineer rows possible, so
`apply_morning_flow_turn` only becomes meaningful post-007). Sequence: PITR mark →
007 prod → verify → 014 prod → verify → repair tracking for both. (Reviewer
confirmed — §8 Q5.)

---

## 6. TEST PLAN

**What becomes unnecessary:** the `supabase.auth.admin.createUser()` crutch in
`test/helpers/db.ts` (added for Pass 1 because `users_id_fkey` forbade a standalone
engineer row). Post-007 the fixture creates an engineer the real ENG-01 way:
generated `id`, `auth_id = NULL`, no auth.users entry. **Swap it as an immediate
follow-up to 007** (a small dedicated commit), not inside the migration PR, so the
existing 27 green tests keep passing through the transition.

**Harness note (round-1 fix):** several new tests must execute **as real
authenticated users (distinct JWTs), not the service role.** Our current harness
only has a **service-role client** (which *bypasses RLS*, so an isolation test run
with it is green by definition and proves nothing). Adding these tests therefore
requires standing up **two anon/JWT-scoped Supabase clients** — one per seeded
tenant user — via `signInWithOtp`/admin-generated sessions in the fixture. That
harness addition is itself part of the 007 test deliverable.

**New tests 007 needs (green-gate before prod):**
- **T-007-01** an engineer row with `auth_id = NULL` and standalone `id` inserts
  successfully (proves the FK drop).
- **T-007-02** the seeded owner/admin's login still resolves via `auth_id` —
  `get_user_tenant_id()` returns their tenant (proves R1 didn't happen).
- **T-007-03** two-tenant RLS isolation, **executed as two real user JWTs**: user
  in tenant A cannot read tenant B's rows after the helper rewrite (proves R2).
  (T-RLS-06/07 scope test CLAUDE.md §7 requires.)
- **T-007-04** a fresh auth signup (simulating `handle_new_user`) with **no**
  matching pre-created profile produces one row with generated `id` and
  `auth_id = NEW.id` (proves R4 — no blind-insert regression).
  *Note:* at 007 time the "no matching pre-created profile" qualifier is
  **vacuous** — nothing creates pre-created profiles yet (no invitations, no
  `users.email`). The qualifier only becomes meaningful once invitations ship;
  until then every signup is the "no match → insert" path by construction.

**Deferred to the future invitations deliverable — NOT part of the 007 gate:**
- **T-007-05** *(belongs with invitations, not 007):* a signup whose **verified**
  email matches an existing `auth_id IS NULL` profile **re-links** (sets that
  row's `auth_id`) instead of creating a second row; assert exactly one row for
  the human afterward. Spec kept verbatim here (incl. the verified-email
  condition, §10b(ii)) so it's ready when invitations is built — but it cannot be
  in the 007 green-gate, because §10b concludes the re-link itself is deferred
  (there is no `users.email` column to match on yet). Gating 007 on a test of
  behaviour 007 deliberately doesn't implement would be a contradiction.

---

## 7. THE 006/007 DOC RECONCILIATION

`docs/schema.md` contradicts reality in **three** places; fix all three when 007 is
authored so the doc matches the world 007 creates:

1. **Line ~56 / ~75:** "Migration 006 decouples users.id …" → wrong; 006 is the
   jobs queue. The decouple is **007**. Fix the text.
2. **Lines 35–42 (RLS helper) and line 78 (`auth_id`):** describe the post-007
   state as if live. Mark "(as of 007)" or defer until 007 applies.
3. **Top-of-file PASS-1 BLOCKER callout:** update to "resolved by 007" once shipped.

Pure doc hygiene, but it removes the exact trap that made this audit necessary.

---

## 8. OPEN QUESTIONS — with reviewer's round-1 answers recorded

1. **Split the migration?** → **Yes** (reviewer agreed). 007 = identity surgery
   only; column corrections + `dprs`/`resolutions` to their own migrations; **and
   evict the role rename too** (done, §1). Applied honestly now.
2. **App-code lockstep?** → **DB-first is forced**; "same PR" is fine but the
   deploy-order argument (§4/R3) is what actually matters.
3. **`daily_logs` engineer RLS?** → **Option (a): rewrite** to the `auth_id`-
   resolved form (dead-but-denying code is a trap).
4. **`owner_user_id` on projects?** → **Push out** to the corrections migration.
5. **014-after-007 ordering?** → **Confirmed.**
6. **Backfill assumption?** → Sound *because the FK enforces it*; still **verify
   with `SELECT count(*) FROM users` on prod before running**, not assert from
   memory. One more reason to backfill before the drop (already the order).

**New gating questions the reviewer raised (answered in §0 and §10):**
- *Did we consciously reject shadow auth users?* → §0, option (a): considered
  fairly, billing objection verified away, **recommend (c) but (a) is a near-tie.**
- *What's the invitation/offboarding story?* → §10.

---

## 9. CONSCIOUSLY ACCEPTED CONSTRAINTS

**One auth account ↔ one tenant, forever (under this design).**
`tenant_id` lives on the `users` row, and `get_user_tenant_id()` returns a
**scalar** tenant id. Combined with the now-unique `auth_id` (§1a.3), this
**hardwires each auth login to exactly one tenant.** A QS or PM consulting across
two builders — not exotic in construction — cannot be represented.

This is **the cheapest moment we will ever have to change it**: we are already
rewriting the helper + 8 policies in 007. Introducing multi-tenancy later means a
`tenant_members` join table, a helper that returns a **set** of tenant ids, and a
**second full rewrite of every RLS policy** (the scalar `tenant_id =
get_user_tenant_id()` pattern becomes `tenant_id IN (SELECT ... )` or an EXISTS
join, everywhere).

**Decision: we consciously accept single-tenant-per-login for Phase 1 (YAGNI).**
Not an accident of schema — a recorded choice. If cross-tenant membership ever
lands on the roadmap, the cost above is the known price, and it re-touches the
exact surface 007 touches now.

---

## 10. LIFECYCLE: invitation, offboarding, return (round-1, point 3)

The plan previously said nothing about what happens when a human crosses the
boundary between the two identity classes. This is where the `SET NULL` +
blind-insert combination becomes a **duplicate-profile machine**, so it gets its
own section.

### 10a. Why `ON DELETE RESTRICT`, not `SET NULL`

With `SET NULL`: deleting a PM's auth account leaves their `users` row alive with
`auth_id = NULL` — now *indistinguishable* from an engineer who never had a login.
If they later sign up again with the same email and `handle_new_user` blindly
inserts, you get **two rows for one human**: the old one owning all the
`projects.created_by` / `project_members` history, and a new empty one that
actually logs in. Silent nulling of identity links is how audit trails die.

**Decision: `ON DELETE RESTRICT`.** Deactivation — not deletion — is the primary
offboarding action:
- **Primary offboarding = `status='deactivated'` + `messaging_blocked=true`**
  (both columns already live via 012). The `users` row and all its history stay
  intact; the person simply can't log in or transact.
- **Auth deletion is a deliberate, secondary flow** — **not yet permitted; see the
  binding policy below.** When it *is* eventually allowed (post-invitations), it
  must **null `auth_id` in the same transaction *before* deleting the `auth.users`
  row** — never rely on a cascade to do it implicitly.
- **Intended failure mode, stated plainly:** post-007, deleting an auth user
  *directly from the Supabase dashboard* will **throw an FK error** (RESTRICT).
  **That error is the system working as designed, not a bug** — it is the guard
  that stops the dangerous path. (Future-you at 11pm: this is expected.)

I'm choosing RESTRICT over SET NULL deliberately; if the reviewer prefers SET NULL
they should say why, because RESTRICT makes the *accidental* duplicate-profile path
(a stray dashboard delete) impossible rather than merely discouraged.

**But RESTRICT does NOT make the deliberate path safe — walk it honestly.** Suppose
the secondary flow above runs: a PM is offboarded by nulling `auth_id` and deleting
their `auth.users` row. Months later they return and sign up with the same email.
Because the §10b re-link **does not exist until invitations ship**,
`handle_new_user` blind-inserts a **brand-new** `users` row — the exact
duplicate-profile machine §10b warns about, just reached via the deliberate route
instead of the accidental one. RESTRICT closed the accidental door; this one is
still open.

> **Policy (binding until invitations + re-link ship):** the deliberate
> auth-deletion offboarding flow **must not be built or used.** The **only**
> offboarding action available is **deactivation** — `status='deactivated'` +
> `messaging_blocked=true` (012's columns) — which preserves the row, the
> `auth_id` link, and all history, and cannot produce a duplicate on return.
> Auth-row deletion becomes permissible only once the verified-email re-link
> exists to reattach a returning person to their original profile.

### 10b. `handle_new_user` re-link strategy

The trigger must **re-link, then insert** — not blind-insert:

```sql
-- illustrative, not final SQL
UPDATE users SET auth_id = NEW.id
 WHERE email = NEW.email AND auth_id IS NULL AND <email is verified>;
-- if no row was updated, INSERT a fresh stub with generated id + auth_id = NEW.id
```

Two conditions must be stated and satisfied before this is safe:

**(i) Audit `users.email` — and the finding is a blocker to note.** *`users` has
no `email` column today.* (Verified against `001_core_schema.sql`: the columns are
`id, created_at, tenant_id, full_name, avatar_url, role, whatsapp_number,
hierarchy_level, …` — no email.) Email currently lives only on `auth.users`. So an
email-match re-link presupposes either **adding `users.email`** (populated at
invite time) or **matching against `auth.users.email`** in the trigger. This is
not a detail — it means the re-link strategy is **coupled to building an invitation
flow** (10c). Until that exists, `handle_new_user` has nothing reliable to match
on, so for now it should keep inserting a fresh stub (the current founder-signup
model) and the re-link is **future work landing with invitations.**

**(ii) SECURITY — re-link only on VERIFIED emails.** *Verbatim, because it is the
sharp edge:* the re-link must fire only for **verified** emails
(`email_confirmed_at` set). Matching on email means **whoever controls that inbox
inherits the profile and its memberships/history** — that is the intended outcome
for a returning PM, but it makes an **admin typo in a pre-created profile's email
an account-takeover vector.** Gate the `UPDATE` on the incoming auth user's email
being confirmed, never on an unverified/claimed address.

### 10c. Invitation flow — a named open product gap

**Is "a second PM joins an existing tenant" designed today? No.** Verified from the
audit: `handle_new_user` + `complete_onboarding` assume the **founder-creates-
tenant** model (self-signup → onboarding creates the tenant and claims the caller
as `admin`). There is **no invite path, no second-PM attachment, no engineer/owner
creation UI** in the codebase (the only `role` assignment beyond the founder is the
`project_members.role='pm'` at `projects/new:50`, which is project membership, not
`users.role`).

**Recommended shape (deferred build, not part of 007):** an `invitations` table
(tenant_id, email, role, token, expires_at, status) + an accept flow that, on
signup with a matching **verified** email, attaches the new auth user to the
pre-created profile (the 10b re-link). Recording it here so it is a *known,
deliberate gap* rather than a surprise the first time a beta company adds a second
PM.

### 10d. Promotion: engineer/owner → web login

An engineer (`auth_id = NULL`) later needing dashboard access is **possible under
(c) with a small future flow**: create an `auth.users` entry and set their
`auth_id` (the reverse of offboarding). Impossible-to-model-cleanly under the
*pre*-007 schema; trivial post-007. **No UI exists for this yet — deliberately
future work.** (Note: this is the one lifecycle transition option (a) shadow-auth
would get almost for free — a fair point in (a)'s favour, recorded in §0.)

---

### Appendix — how the current state was verified (not from docs)

- `users.id … PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` — `001_core_schema.sql:37`
- `users` has **no `email` column** — `001_core_schema.sql:36–50`
- `get_user_tenant_id() … WHERE id = auth.uid()`, declared `STABLE SECURITY DEFINER SET search_path = public` — `002_rls_policies.sql:12–20`
- No `auth_id` column in 001; not added by 006/011/012 (all read).
- `handle_new_user … INSERT INTO users (id) VALUES (NEW.id)` — `005_auth_trigger.sql:45`
- `complete_onboarding … WHERE id = auth.uid()` — `005_auth_trigger.sql:80`
- 012 added `status`/`messaging_blocked`/`pending_flows` guarded — `012:29–49`
- Only live `'client'` role reference is the `001` CHECK — grep of `app/ lib/ types/ supabase/`
- App call sites — grep of `lib/` + `app/`, enumerated in §3c.
- Supabase MAU billing semantics — Supabase Docs, *Manage Monthly Active Users usage*: https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users
- FK constraint name `users_id_fkey` — confirmed empirically by the Pass-1 fixture
  FK violation on both prod and the test-db branch (memory `pass1-blocked-on-migration-007`).
