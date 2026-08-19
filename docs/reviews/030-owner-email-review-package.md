# Migration 030 review package — owner-email delivery (BLOCKED half)

**Status: WRITTEN, NOT APPLIED, NOT REHEARSED, BLOCKED.** This package accompanies
`supabase/migrations/030_owner_email_delivery.sql`, pinned at commit
`e6a06826ad17df6c27f73db5584f97896d5c0ef2` (branch `docs/dpr-delivery-versioning-plan`).
Design record: `docs/dpr-delivery-versioning-plan.md` §2j (frozen).

**Sequencing (external review, split-package decision):** BLOCKED on the trigger-cron
workstream — no cron exists yet for `ownerSend` (`lib/daily-logs/cutoffs.ts`'s own header:
"the `ownerSend` cron entry is NOT yet in `vercel.json`"), and no code path exists to
populate or read `notification_email`/`notification_email_verified_at` until it does.
Applying this schema now would add live PII columns and a public verification surface with
nothing consuming them. Written now so the package is complete and the next artifact, once
trigger-cron lands, is a go-ahead to apply, not another design pass.

---

## 1. Full SQL, pinned

```
$ git show e6a06826ad17df6c27f73db5584f97896d5c0ef2:supabase/migrations/030_owner_email_delivery.sql
```
Full file at that path/SHA, per CLAUDE.md §0's provenance rule.

---

## 2. §0 gate evaluation

Carried over from the migration file's own header (`030_owner_email_delivery.sql:9-30`):

- **(a) does not trip** — no Postgres function created or modified (the verification write
  is a service-role application route, not an RPC — §5 below states why).
- **(b) trips** — widens `delivery_status`'s `CHECK` on the live `dprs` table; adds two new
  PII columns to the live `users` table.
- **(c) TRIPS, named explicitly, per direct instruction — not left to ride in on (b)'s
  coattails.** `owner_email_verifications` is a PUBLIC, UNAUTHENTICATED write path into
  `users`' verification state, keyed by a bearer token, for a person with no login and none
  ever planned (`auth_id NULL` by design, CLAUDE.md §5). This is the first
  identity-verification surface this codebase has built outside Supabase Auth's own managed
  magic-link mechanism — a token-gated write path is at minimum a judgment call worth
  recording here, matching the discipline #69's own plan applies to its (c) entry for
  phone-number identity.
- **(d) does not trip** in the schema sense — additive only.
- **(e) does not trip** — no billing surface touched by this file (the eventual email-send
  cost is #67's §2g dependency, application-layer, not this migration).

**Net: (b) and (c) trip — full external-review package required. This document is that
package.**

---

## 3. S2 — the verification endpoint, fully specified (not restated from the plan; see
`030_owner_email_delivery.sql`'s own trailing APPLICATION-LAYER SPEC comment block for the
complete route/re-click/expired/rate-limit specification, pinned via the `git show` above,
not retyped here per the provenance rule).**

Summary only, for the package record:
- Token: random, generated in application code (not SQL — no `pgcrypto` dependency
  introduced for one column), SHA-256 hashed before storage, raw token never persisted.
- Storage: `owner_email_verifications` (§4 below), `token_hash UNIQUE`, `expires_at`,
  `used_at`.
- Route: `app/api/owner/confirm-email/route.ts`, public, service-role write, generic
  expired/used/not-found response (enumeration-resistant).
- Rate limiting: named as a required part of the route's own build, not implemented in
  this migration.

---

## 4. Table/RLS audience statement

`owner_email_verifications` — **RLS ENABLED, ZERO policies, for both `authenticated` and
`anon`.** Deliberate, not an oversight (migration file's own comment, §5): a bearer token
is not an `auth.uid()` session, so there is no RLS predicate that could correctly express
"possession of this token" — the boundary is enforced entirely in the service-role route
handler. Default-deny via RLS-enabled-zero-policies is the correct state here, the same
shape CLAUDE.md's own `jobs`/`processed_messages` F6 finding (017 review) confirms is
fail-CLOSED, not fail-open, once understood correctly.

`users.notification_email`/`notification_email_verified_at` — no new RLS policy; inherits
`users_select`'s existing (column-agnostic, tracked-open) policy. See S4, below.

---

## 5. Composite FK convention (5)

`owner_email_verifications.user_id` → `users(id, tenant_id)`, `ON DELETE CASCADE` — a
verification token has no meaning once its target user row is gone (unlike `dpr_versions`'
`RESTRICT` on an archival author reference, this is disposable state, correctly `CASCADE`).

---

## 6. S3 — pinned argument, not shipped SQL

The composite same-tenant FK on `projects.owner_user_id` this package might otherwise be
expected to add is **already live**, since `017_rls_column_bounding.sql:82-91`
(`projects_owner_user_id_fkey`). Verified against the live catalog on test-db, not just the
migration file text — `pg_constraint`:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.projects'::regclass AND contype = 'f'
  AND conname LIKE '%owner_user_id%';
```
```
projects_owner_user_id_fkey | FOREIGN KEY (owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT
```
Captured this session (2026-08-19), test-db, `exfccwlrhoutkgrlikod`. `confupdtype='a'`
(NO ACTION), `confdeltype='r'` (RESTRICT) — matching 017's own comment exactly. **Nothing
shipped for this in `030_owner_email_delivery.sql`; the argument for not shipping it is
that it already exists, not that it was judged unnecessary.**

---

## 7. S4 — PII exposure recorded against the open item

`notification_email` inherits `users_select`'s (`007_auth_surgery.sql:214-216`)
column-agnostic exposure — any authenticated tenant member sees it, same class of finding
already tracked for `whatsapp_number` (`docs/reviews/017-review-package.md` §7, primary
tracking **007 review §11d**; live client surface: `lib/daily-logs/query.ts:92-96,133` →
`app/(dashboard)/daily-logs/page.tsx:150-152` → `app/(dashboard)/daily-logs/reactivate-
cta.tsx`, a `'use client'` component). **Recorded here and in the column's own `COMMENT`
(migration file, pinned above) — column-bounding `users_select` remains the distinct F5
least-privilege workstream that item already scopes this to, not fixed by this migration.**
A follow-up line should be added to `docs/reviews/017-review-package.md`'s own §7 residual
noting the second column, at whichever future pass actually touches that file — not done in
this commit, to avoid editing a frozen historical review package casually.

---

## 8. Undocumented dependency, cited

`role = 'owner'` (§2j/A1's operator `INSERT`) is legal only because
`016_corrections.sql:71-72`'s `users_role_check` — `CHECK (role IN ('pm', 'qs', 'engineer',
'owner', 'subcontractor', 'admin'))` — includes it. Cited in the migration file's own
header; restated here for the package record.

---

## 9. Retention-ledger lines

- **`users.notification_email`/`notification_email_verified_at`** — not a new table, no
  independent retention posture; inherits `users`' own (no retention policy has ever been
  defined for `users` rows themselves — out of scope here, unchanged by this migration).
- **`owner_email_verifications` — PRUNABLE HYGIENE, same classification as `checkin_
  escalations`, not a compliance record.** Grain: one row per confirmation-send attempt
  (beta: one per manually-seeded owner, occasionally more on a re-trigger after an expired
  link). A token past its `expires_at` has no further use to anyone — it cannot be
  verified, cannot be un-expired, and carries no historical claim on permanence the way
  `daily_log_edits` does. No prune mechanism built in this migration — a future pass could
  safely `DELETE WHERE expires_at < now() - interval '30 days'` — this is a classification,
  not an implementation, matching this project's own "posture nothing yet enforces" pattern
  for its other retention-ledger lines.

---

## 10. Rehearsal plan + pre-apply probes

**Not run — this package is BLOCKED, not merely unrehearsed.** Rehearsal against test-db
is deliberately deferred until trigger-cron lands and there is real code to exercise this
schema against — rehearsing a schema nothing reads or writes yet would prove only that the
`CREATE TABLE`/`ALTER TABLE` statements parse, not that the design is correct in practice.
Probe queries (pre-apply column/constraint absence checks, mirroring 029's package §7
shape) will be written and run at that time, not sketched prematurely here.

---

## 11. Apply runbook

Per `docs/migration-runbook-template.md`. **Not scheduled.** The next artifact for this
migration is a go-ahead to apply, gated on trigger-cron's own workstream landing first —
named here as the explicit trigger condition, not a date.
