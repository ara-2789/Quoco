# Production Hardening Backlog

> Prod/UX/config issues found during behavioral testing on 2026-07-10, kept
> **entirely separate from migration 007** (its own branch/PR). None of these
> are 007 blockers; none touch the 007 identity surgery. Each is an independent
> follow-up.

---

## 1. `signInWithOtp` silently creates accounts (`shouldCreateUser: true`)

The login server action (`app/(auth)/login/page.tsx`, `sendMagicLink`) calls
`supabase.auth.signInWithOtp({ email, ... })`. `shouldCreateUser` defaults to
**`true`**, so **any mistyped email silently creates a new, tenant-less auth
account** (the `handle_new_user` trigger then gives it a stub `users` row, and
the callback routes it to `/onboarding`). This is exactly how logging in with a
wrong email today produced a fresh account instead of an error.

**Fix:** set `shouldCreateUser: false` on the `signInWithOtp` call and surface a
clear **"no account found"** message instead of silently minting an account.

## 2. Onboarding page uses real founder data as placeholder text

`app/(onboarding)/onboarding/page.tsx` hardcodes
`placeholder="Rajamani Constructions Pvt Ltd"` and
`placeholder="Aravindan Rajamani"` on the form inputs. **Confirmed hardcoded
placeholders — NOT a data leak** (no query populates field values; the render
path fetches nothing). But using a real company / real person as example text
makes it look like a cross-tenant leak.

**Fix:** replace with generic placeholders, e.g.
`"Acme Constructions Pvt Ltd"` and `"Your full name"`.

## 3. `emailRedirectTo` is request-header-derived; `NEXT_PUBLIC_APP_URL` is unused

In `sendMagicLink`, `emailRedirectTo` is built from the request's **`Origin`**
header (fallback `https://` + **`Host`**), not from `NEXT_PUBLIC_APP_URL` —
which is declared in the env spec (CLAUDE.md §8) but **unused in this code
path**.

**Fix:** either wire `NEXT_PUBLIC_APP_URL` into actual use, or remove it from the
required env-var list to avoid confusion. **Note:** because the redirect target
is header-derived, Supabase's **Redirect URLs allow-list is doing real security
work here, not just plumbing** — do not treat it as optional config.

## 4. Supabase default SMTP caps auth emails at 2/hour

Supabase's built-in SMTP limits auth emails (magic links, confirmations) to
**2/hour regardless of paid plan tier**, and this applies to **production and the
test-db branch project independently**.

**Fix:** configure **custom SMTP via Resend** once a Resend account + verified
sending domain exist.

## 5. No per-environment config checklist

There is **no single document** recording the required Supabase **Site URL /
Redirect URLs / relevant env values** per environment (production, test-db branch
preview, local dev). This caused real time loss today when the test-db branch
project needed the **same fix already applied to production**.

**Fix:** write a short **per-environment config checklist**.

## 6. Fast-Follow nav items still clickable in production

The production sidebar still shows **Safety / Invoices / Hindrances** as
clickable nav items, despite CLAUDE.md's Week-1 note that these Fast-Follow
sections should be **hidden/disabled for Spine betas** (so betas don't click into
empty sections).

**Fix:** verify current state and **hide/disable** if still live.

## 8. HARD ORDERING: HIGH-1 fix must land BEFORE invitations ships

HIGH-1 (users_update self-privilege-escalation, §11a of the 007 review) has
deadline "before any second real user exists." The invitations deliverable is
precisely what creates that second user. Therefore: the column-grants migration
(REVOKE UPDATE / GRANT UPDATE (full_name, avatar_url)) must be drafted,
reviewed by the developer friend, and applied to prod BEFORE any invitation
flow work begins. Reviewer has asked to see the migration when drafted.
Recorded 2026-07-10 per reviewer closeout feedback.

## 9. SYSTEMIC: audit ALL UPDATE policies for column-bounding (same class as HIGH-1)

The same no-column-bounds RLS class as HIGH-1 (migration 015, users_update)
exists on `projects_update`, `invoices_update`, `whatsapp_sessions_*` and other
UPDATE policies — a `USING`/`WITH CHECK` that gates the *row* but never restricts
*which columns* an authenticated client may write, leaving the table-level UPDATE
grant as the only (absent) column bound.

**Fix:** audit **all** UPDATE policies for column-bounding needs and apply the
same REVOKE-table-UPDATE / GRANT-column-UPDATE fix where warranted. Same deadline
logic as HIGH-1 — land before invitations ship (a second real user is what turns
self-only blast radius into cross-user). Recorded 2026-07-12 per 015 round-3
sign-off carry item #3.

**Migration number RESERVED: 017.** The audit's fix ships as `017_*` (the RLS
column-bounding pass). 016 is the corrections migration; 017 is the next number
and is now earmarked for this work so the deadline ("before invitations") is
sequenced explicitly: **017 lands before any invitation-flow migration.** Also
folds in `owner_user_id`'s missing same-tenant enforcement (deferred out of 016 —
plain FK lets a project point at an owner row in another tenant; composite-FK /
trigger territory), which belongs to this same systemic tenant-scoping pass.
Reserved 2026-07-13 per 016 round-2 reviewer round.
