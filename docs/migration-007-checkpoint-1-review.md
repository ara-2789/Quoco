# Migration 007 — Auth Surgery — Checkpoint 1 Review Document

**Status:** PLAN ONLY. No SQL written, no code changed, no database touched.
**Audience:** second-pair-of-eyes reviewer (cold read).
**Author prep date:** 2026-07-08
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

---

## 1. EXACT SCOPE OF 007 — what it changes, what it deliberately does not

### 1a. In scope (the identity surgery — the risky part)

1. **Add `users.auth_id UUID` (nullable), FK `REFERENCES auth.users(id) ON DELETE SET NULL`.**
   - Guarded `ADD COLUMN IF NOT EXISTS`.
   - This becomes the *new* link from a Quoco user to a Supabase Auth login.
   - NULL for `engineer` and `owner` (no web login). Set for `pm`, `qs`, `admin`.

2. **Backfill `auth_id` from the current `id` for every existing row** —
   `UPDATE users SET auth_id = id WHERE auth_id IS NULL;`
   This preserves the login link for the accounts that exist today (see §2).
   **Must run BEFORE step 4 and step 5**, or the owner/admin is locked out.

3. **Drop the FK `users_id_fkey`** (`users.id → auth.users.id`).
   - `id` stays a UUID PK with the same values; it just stops being tied to auth.
   - Guarded: look up the constraint name and drop if present. (It is auto-named
     `users_id_fkey`, confirmed empirically by the FK violation the Pass-1 test
     fixture hit on both prod and branch.)

4. **Rewrite `get_user_tenant_id()`** to match on `auth_id`:
   `SELECT tenant_id FROM users WHERE auth_id = auth.uid()`.

5. **Rewrite `handle_new_user()`** (migration 005 trigger) so a new auth signup
   inserts a users row with a **generated** `id` and `auth_id = NEW.id`
   (today it does `INSERT INTO users (id) VALUES (NEW.id)`).

6. **Rewrite `complete_onboarding()`** (migration 005 RPC): its
   `UPDATE users ... WHERE id = auth.uid()` must become `WHERE auth_id = auth.uid()`.

7. **Rewrite every RLS policy that uses `auth.uid()` against `users.id`** — full
   list in §3. This is the bulk of the SQL and the highest-audit-value part.

8. **Role rename `client` → `owner`:**
   - `daily_logs`/others don't store the role; only `users.role` CHECK does.
   - Migration 001 CHECK is `('pm','qs','engineer','subcontractor','client','admin')`.
   - 007 drops that CHECK and re-adds it with `owner` instead of `client`, plus
     `UPDATE users SET role='owner' WHERE role='client'` first (there should be
     zero such rows today, but do it defensively before swapping the constraint).

### 1b. Explicitly OUT of scope for 007 (deferred / already done elsewhere)

- **`users.status` and `users.messaging_blocked`** — **already live via migration 012**
  with `NOT NULL DEFAULT 'active'` / `NOT NULL DEFAULT false`. 007 **must NOT
  redefine them.** If 007 touches them at all it is only `ADD COLUMN IF NOT EXISTS`
  with the *identical* definition, so it is a guaranteed no-op. Recommended: leave
  them out of 007 entirely and just add a comment noting 012 owns them.
- **`whatsapp_sessions.pending_flows`** — already live via migration 012. Same rule.
- **`whatsapp_sessions.phone_number UNIQUE`** — created by migration 012 as
  `uq_whatsapp_sessions_phone_number`. Migration 009 owns the "official" one;
  007 must not add it.
- **`dprs` table, `resolutions` table** — schema.md's 007 entry lists these, but
  they belong to Week-4 / escalation-engine work. **Recommend they move to 008**
  (schema.md already lists 008 as "dprs + resolutions"). 007 should be *only* the
  auth/identity surgery + the small column corrections below, to keep the risky
  migration as small and reviewable as possible. **← OPEN QUESTION, see §8.**
- The other "column corrections" schema.md piles onto 007 (`invoices.amount →
  (12,2)`, `morning_dependencies/hindrances → JSONB`, `projects.owner_user_id`,
  `daily_logs.is_holiday/holiday_reason/evening_dependencies`,
  `safety_incidents.submitted_via CHECK`, `hindrances.dpr_included` default drop,
  `tenants.stripe_customer_id` rename + `paid_until`/`last_payment_ref`): these
  are low-risk additive/typing changes **unrelated to the identity surgery.**
  **Recommend splitting them into a separate migration** so a bug in a column
  rename can never force a rollback of the irreversible identity change (or vice
  versa). **← OPEN QUESTION, see §8.**

> The core recommendation of this document: **make 007 do the identity surgery
> and nothing else.** Everything that can live in another migration should.

---

## 2. EXISTING DATA MIGRATION — what happens to rows already in `public.users`

Today there is at least one real row: the owner/admin account, which **is** tied
to `auth.users` (its `users.id` == its `auth.users.id`, because that is the only
way a row can exist under the current FK).

**Plan: `id` never changes. `auth_id` is backfilled from `id`. No row is deleted
or re-keyed.** This keeps every existing FK reference (`projects.created_by`,
`project_members.user_id`, etc.) valid, because those all point at `users.id`,
which is unchanged.

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
result, different column.** This is why the backfill MUST happen inside the same
migration, before the function swap — a gap where `auth_id` is NULL but the
function already reads `auth_id` = instant lock-out for the only real user.

Future engineer/owner rows (post-007, the ENG-01 path): generated `id`,
`auth_id = NULL`, no `auth.users` entry. This is exactly what Pass 1 needs and
what `users_id_fkey` currently forbids.

---

## 3. EVERYTHING THAT REFERENCES THE OLD `users.id == auth.uid()` ASSUMPTION

**This is the heart of the review. The FK drop is one line; the danger is the
long tail of things silently assuming the equality.** Audited against the live
migrations and the app source.

### 3a. Database functions

| Object | File | Current | Post-007 |
|---|---|---|---|
| `get_user_tenant_id()` | 002:12 | `WHERE id = auth.uid()` | `WHERE auth_id = auth.uid()` |
| `handle_new_user()` | 005:39 | `INSERT INTO users (id) VALUES (NEW.id)` | generated `id`, `auth_id = NEW.id` |
| `complete_onboarding()` | 005:60 | `UPDATE users ... WHERE id = auth.uid()` | `WHERE auth_id = auth.uid()` |

### 3b. RLS policies that use `auth.uid()` against `users.id` (all in 002, plus the 005 patch)

Every one of these must be rewritten. Policies that only use `get_user_tenant_id()`
(pure `tenant_id = get_user_tenant_id()`) are **safe** once the helper is fixed —
they do not need individual edits. The ones below reference `auth.uid()` *directly*
and DO need rewriting:

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
> key**, which bypasses RLS, so the `engineer_id = auth.uid()` path is effectively
> dead for real submissions today. But it must still be corrected — otherwise a
> future web-based edit path silently evaluates `engineer_id = auth.uid()` where
> `engineer_id` is now a standalone id that can never equal `auth.uid()`, i.e. it
> would deny everything. Correct form resolves the caller's `users.id` via `auth_id`.

**All the "pure tenant" policies** (projects, whatsapp_sessions, safety_incidents,
invoices, hindrances, tenders/*, boq_*, vendors, ra_bills, etc.) use only
`tenant_id = get_user_tenant_id()` and need **no individual change** — they inherit
the fix from the helper. Confirmed by reading all of 002. This is good: it shrinks
the blast radius to the 8 policies above + 3 functions.

### 3c. Application code that assumes `users.id == auth.uid()` — **BREAKS unless changed in lockstep**

This is the part most likely to bite. These server components take
`supabase.auth.getUser()` (returns the **auth** uid) and use it *directly* as
`users.id`. After 007 that equality is gone, so each is a bug:

| File:line | Current | Why it breaks post-007 | Fix |
|---|---|---|---|
| `app/(auth)/auth/callback/route.ts:33` | `.from('users').eq('id', user.id)` | looks up profile by auth uid | `.eq('auth_id', user.id)` |
| `app/(onboarding)/onboarding/page.tsx:21` | `getUser()` then `complete_onboarding` RPC | RPC now matches on `auth_id` (fixed in 3a) | verify the RPC change covers it |
| `app/(dashboard)/layout.tsx:26` | `getUser()` + profile lookup | profile lookup by `id` | `.eq('auth_id', user.id)` |
| `app/(dashboard)/dashboard/page.tsx:37` | `.from('users').eq('id', user.id)` | profile by auth uid | `.eq('auth_id', user.id)` |
| `app/(dashboard)/dashboard/page.tsx:41` | `.eq('user_id', user.id)` (project_members) | uses auth uid as `users.id` FK value | resolve profile.id first, then `.eq('user_id', profile.id)` |
| `app/(dashboard)/projects/page.tsx:50` | `.eq('user_id', user.id)` (project_members) | same | resolve profile.id first |
| `app/(dashboard)/projects/new/page.tsx:16` | `.from('users').eq('id', user.id)` | profile lookup | `.eq('auth_id', user.id)` |
| `app/(dashboard)/projects/new/page.tsx:35` | `created_by: user.id` | **writes auth uid into a FK to users.id** → FK violation after decouple | `created_by: profile.id` |
| `app/(dashboard)/projects/new/page.tsx:49` | `user_id: user.id` (project_members insert) | **same FK-violation risk** | `user_id: profile.id` |
| `app/(dashboard)/projects/[id]/page.tsx:55` | `getUser()` + downstream lookups | verify any `id`-based lookup | audit when touched |
| `app/(dashboard)/dprs/page.tsx:30` | `.eq('user_id', user.id)` | uses auth uid as a `users.id` FK | resolve profile.id first |

**The `projects/new` writes (lines 35, 49) are the sharpest edge:** today they
happen to work because `user.id == users.id`. The moment 007 drops the FK and a
*new* PM is created with a generated `id ≠ auth uid`, these writes put the auth
uid into `created_by` / `project_members.user_id`, which still FK to `users.id`
— an immediate FK violation (or worse, a silently orphaned reference if the FK
were ever loosened). **These must ship in the same PR as 007.**

The **webhook** (`app/api/whatsapp/webhook/route.ts:129`) looks up the user by
`whatsapp_number`, not by auth identity, and passes the resulting `user.id`
onward — this is **already correct** post-007 and needs no change.

### 3d. Triggers

Only `on_auth_user_created` (→ `handle_new_user`, covered in 3a). No other
triggers reference the identity equality.

---

## 4. WHAT BREAKS IF WE GET IT WRONG — honest risk list + rollback

| # | Failure mode | What it looks like in prod | Rollback story |
|---|---|---|---|
| R1 | Backfill skipped / ordered after the function swap | Owner/admin **locked out** — `get_user_tenant_id()` returns NULL, every RLS check fails, dashboard shows empty everywhere | Re-run `UPDATE users SET auth_id = id`. Recoverable, but scary in the moment. Mitigation: strict ordering + a post-step probe asserting 0 rows with `auth_id IS NULL AND id IN (auth.users)`. |
| R2 | A tenant-scoped RLS policy left half-migrated (helper fixed but a direct-`auth.uid()` policy missed) | Either total denial (safe-ish) or, worst case, a policy that no longer scopes correctly → **cross-tenant read**. | Re-apply the corrected policy. The §3b table is the checklist that prevents this. Add a two-tenant isolation test (T-RLS) to the green-gate. |
| R3 | App code not shipped with the migration | PM dashboard 500s / empty; project creation throws FK violation | App is versioned in git — revert the deploy. But DB is already decoupled (irreversible), so you can't "roll back" the DB; you must **roll forward** the app. This is why app + 007 ship together. |
| R4 | `handle_new_user` still inserts `id = NEW.id` | First new PM signup after 007 creates a row whose `id` collides with the auth uid pattern but has `auth_id` NULL → they can't be found by the (fixed) helper → new user locked out | Fix the trigger, `UPDATE` the stray row's `auth_id`. Caught by a "new signup resolves" test. |
| R5 | Dropping the FK fails because the constraint name differs | Migration aborts partway (if not wrapped) | Wrap the whole 007 in a single transaction so a mid-migration failure rolls the *migration* back cleanly. Look up the constraint name dynamically rather than hardcoding. |
| R6 | Irreversibility itself | Once `users_id_fkey` is dropped and rows exist with `auth_id = NULL`, you cannot re-add the FK without either deleting those rows or giving them auth.users entries | No true rollback. Mitigation: branch rehearsal + this review before prod. Accept that forward-only is the plan. |

**Overall:** the *irreversible* part (FK drop) is mechanically trivial and low-risk
on its own. The real risk is **R1 (ordering)** and **R3 (app lockstep)**. Both are
process risks, not SQL risks — which is exactly what a second reviewer is best at
catching.

---

## 5. SEQUENCING & REHEARSAL

Same IPv6-constrained flow proven on 013/014: apply via the Supabase **dashboard
SQL Editor** (CLI direct connection is blocked by the IPv6-only host), branch first.

**Order within the 007 transaction (single `BEGIN…COMMIT`):**
1. `ADD COLUMN IF NOT EXISTS auth_id …`
2. Backfill `UPDATE users SET auth_id = id WHERE auth_id IS NULL`
3. `UPDATE users SET role='owner' WHERE role='client'`; swap the role CHECK
4. Drop `users_id_fkey`
5. `CREATE OR REPLACE` the three functions (helper, trigger fn, onboarding)
6. Drop+recreate the 8 affected RLS policies

**Verification probes (run on branch, before/after):**

| Check | Before | After (expected) |
|---|---|---|
| `auth_id` column exists | absent | present |
| FK `users_id_fkey` exists (query `pg_constraint`) | `true` | `false` |
| rows with `auth_id IS NULL` where a matching `auth.users` row exists | n/a | **0** (backfill worked) |
| `get_user_tenant_id()` source contains `auth_id` | `false` | `true` |
| `users.role` CHECK contains `owner`, not `client` | `client` | `owner` |
| Spot-check: as the seeded admin, `SELECT get_user_tenant_id()` returns their tenant | tenant | **same tenant** |
| Insert an engineer row with `auth_id = NULL`, standalone id | FK violation | **succeeds** |

**Gate to prod:** branch probes all green **AND** full `npm test` green (unit +
integration, including a two-tenant RLS isolation test) **AND** the coordinated
app-code changes reviewed. Only then apply to prod via SQL Editor, then
`supabase migration repair --status applied 007` once CLI connectivity is fixed
(same deferred-tracking situation as 013/014).

**Migration 014's pending prod apply:** it was deferred to "ride alongside 007."
Recommendation: apply 014 to prod **immediately after** 007 is green on prod (007
is what makes real engineer rows possible, so `apply_morning_flow_turn` only
becomes meaningful post-007). Sequence: 007 prod → verify → 014 prod → verify →
repair CLI tracking for both. **← confirm this ordering, §8.**

---

## 6. TEST PLAN

**What becomes unnecessary:** the `supabase.auth.admin.createUser()` crutch in
`test/helpers/db.ts` (added for Pass 1 because `users_id_fkey` forbade a
standalone engineer row). Post-007 the fixture can create an engineer the real
ENG-01 way: generated `id`, `auth_id = NULL`, no auth.users entry.

**Recommendation:** update the fixture as an **immediate follow-up to 007**, not
inside the 007 migration PR itself — so the migration PR stays focused and the
existing 27 green tests keep passing through the transition (they already work via
the crutch). Swap the crutch once 007 is on the branch, in a small dedicated commit.

**New tests 007 itself needs (add to the green-gate before prod):**
- **T-007-01** an engineer row with `auth_id = NULL` and a standalone `id` can be
  inserted (proves the FK drop). This replaces the crutch's reason for existing.
- **T-007-02** the seeded owner/admin's login still resolves their users row via
  `auth_id` — `get_user_tenant_id()` returns their tenant (proves R1 didn't happen).
- **T-007-03** two-tenant RLS isolation: user in tenant A cannot read tenant B's
  rows after the helper rewrite (proves R2 didn't happen). This is the T-RLS-06/07
  scope test CLAUDE.md §7 already requires.
- **T-007-04** a fresh auth signup (simulating `handle_new_user`) produces a row
  with generated `id` and `auth_id = NEW.id` (proves R4 didn't happen).

---

## 7. THE 006/007 DOC RECONCILIATION

`docs/schema.md` currently contradicts reality in **three** places (not just the
one line we flagged). All three should be fixed **as part of authoring 007**, so
the doc matches the world 007 creates:

1. **Line ~56 / line ~75:** "Migration 006 decouples users.id from the original
   FK." → **Wrong.** 006 is the jobs queue and touches nothing on `users`. The
   decouple is **007**. Fix the text to say 007.
2. **Lines 35–42 (RLS helper block) and line 78 (`auth_id` column):** these
   describe the *post-007* state as if live. Add a "(as of 007)" marker, or keep
   as-is only once 007 is actually applied. Right now they mislead a cold reader
   into thinking `auth_id` already exists.
3. **The top-of-file PASS-1 BLOCKER callout** can be updated to "resolved by 007"
   once 007 ships.

No behavioural change — pure doc hygiene — but it removes the exact trap that made
this audit necessary.

---

## 8. OPEN QUESTIONS FOR THE REVIEWER

1. **Split the migration?** I strongly recommend 007 = *identity surgery only*,
   with the unrelated column corrections (`invoices.amount`, JSONB conversions,
   `projects.owner_user_id`, `tenants` rename, etc.) and the `dprs`/`resolutions`
   tables moved to their own migration(s). schema.md bundles them all into 007.
   Bundling means a bug in a trivial column rename can force rollback pressure on
   the irreversible identity change. **Do you agree with splitting?**

2. **App-code lockstep:** the §3c changes (especially `projects/new` lines 35/49)
   must deploy with 007 or the dashboard breaks. Do you want them in the **same
   PR** as the migration, or a tightly-sequenced follow-up deploy gated on 007
   being live? My vote: same PR.

3. **`daily_logs` RLS for engineers:** engineers never use the web and the webhook
   uses the service role (bypasses RLS), so `daily_logs_insert`'s
   `engineer_id = auth.uid()` is effectively dead code today. Do we (a) rewrite it
   to the correct `auth_id`-resolved form for future-proofing, or (b) leave it and
   document it as intentionally web-inert? My vote: (a), it's cheap and removes a
   latent footgun.

4. **`owner_user_id` on projects:** schema.md assigns `projects.owner_user_id` to
   007, and it FKs `users(id)`. It's additive and low-risk, but it's part of the
   "owner" concept the role rename introduces. Keep it with the identity work, or
   push to the column-corrections migration? (Leaning: it's harmless additive,
   push it out with the other corrections.)

5. **014-after-007 ordering** (see §5) — confirm you're happy applying 014 to prod
   right after 007 rather than folding it in.

6. **Backfill assumption:** I'm assuming **every** current `users` row has a valid
   `auth.users` counterpart (true, because the current FK enforces it). If there's
   any row you know of that shouldn't get `auth_id = id` (e.g. a manually-inserted
   test row), flag it — the blanket backfill would give it a login link.

---

### Appendix — how the current state was verified (not from docs)

- `users.id … PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` — `001_core_schema.sql:37`
- `get_user_tenant_id() … WHERE id = auth.uid()` — `002_rls_policies.sql:19`
- No `auth_id` column in 001; not added by 006/011/012 (all read).
- `handle_new_user … INSERT INTO users (id) VALUES (NEW.id)` — `005_auth_trigger.sql:45`
- `complete_onboarding … WHERE id = auth.uid()` — `005_auth_trigger.sql:80`
- 012 added `status`/`messaging_blocked`/`pending_flows` guarded — `012:29–49`
- App call sites — grep of `lib/` + `app/`, enumerated in §3c.
- FK constraint name `users_id_fkey` — confirmed empirically by the Pass-1 fixture
  FK violation on both prod and the test-db branch (recorded in memory
  `pass1-blocked-on-migration-007`).
</content>
</invoke>
