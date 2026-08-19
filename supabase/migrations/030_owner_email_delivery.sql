-- =============================================================================
-- 030_owner_email_delivery.sql
-- DPR delivery/versioning, BLOCKED HALF (docs/dpr-delivery-versioning-plan.md
-- §2j, §2e's pm_notified/skipped_no_template/skipped_unverified widening).
--
-- STATUS: WRITTEN, NOT TO BE APPLIED YET. Per the split-package sequencing
-- decision (external review, 2026-08-19): this half is BLOCKED on the
-- trigger-cron workstream (the actual ownerSend cron entry, and #69's own
-- outbound-send primitive for PM-notify) — applying this schema before that
-- exists would add live PII columns and a public verification surface with
-- no code path that ever populates or reads them. Written now so the review
-- package is complete and the next artifact, once trigger-cron lands, is a
-- go-ahead to apply this file, not another design pass.
--
-- CLAUDE.md §0 GATING ASSESSMENT, condition by condition:
--   (a) "CREATES OR MODIFIES a live function's LOGIC." Does not trip — no
--       Postgres function created or modified in this file (verification is
--       a service-role application-code write, not an RPC — see §5 below for
--       why, not merely asserted).
--   (b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING
--       OBJECT." TRIPS. Widens delivery_status's CHECK on the existing,
--       live dprs table, and adds two new PII columns to the existing,
--       live users table.
--   (c) "Touches auth or identity." TRIPS — named explicitly, per direct
--       instruction, not left to ride in on (b)'s coattails. The
--       owner_email_verifications table (§5) is a PUBLIC, UNAUTHENTICATED
--       write path into users' verification state, keyed by a bearer token,
--       for a person who has no login and never will (auth_id NULL by
--       design). This is an identity-verification surface with no
--       Supabase Auth session backing it at all — the closest analogue in
--       this codebase to a password-reset-token flow, and the first one
--       this project has ever built outside Supabase Auth's own managed
--       magic-link mechanism. A token-gated write path is, at minimum, a
--       judgment call worth recording under (c) even though it doesn't
--       touch web-login identity — same discipline #69's own plan applies
--       to its (c) entry for phone-number identity.
--   (d) "Is destructive or irreversible." Does not trip in the schema
--       sense — additive only.
--   (e) "Moves money." Does not trip.
--   NET: (b) and (c) both trip — full external-review package required.
--   This IS that package (docs/reviews/030-owner-email-review-package.md).
--
-- UNDOCUMENTED DEPENDENCY, cited (external review finding, not previously
-- stated anywhere): `role = 'owner'` (§2j/A1's operator INSERT) is legal
-- only because `016_corrections.sql:71-72`'s users_role_check CHECK —
-- `CHECK (role IN ('pm', 'qs', 'engineer', 'owner', 'subcontractor',
-- 'admin'))` — includes it. Not touched by this file; cited so the
-- dependency is pinned, not assumed.
--
-- S3 — NOT SHIPPED, ARGUMENT PINNED, NOT ASSERTED WITHOUT EVIDENCE: the
-- composite same-tenant FK on projects.owner_user_id this package might
-- otherwise be expected to add already exists — `017_rls_column_bounding.
-- sql:82-91`, `projects_owner_user_id_fkey`, `FOREIGN KEY (owner_user_id,
-- tenant_id) REFERENCES users(id, tenant_id)`. Verified against the live
-- catalog on test-db, not just the migration file text: `pg_constraint`
-- shows this exact constraint live today, confupdtype='a', confdeltype='r'.
-- Nothing to add here.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. users.notification_email — the owner's delivery address.
--    Constraints per B1 (external review): NOT globally unique, NOT unique
--    per tenant (one person may own multiple projects, even within one
--    tenant) — format-checked, both DB CHECK and application layer (the DB
--    check is a weak defense against the real risk, wrong-recipient, not
--    malformed data; it exists for cheap defense-in-depth, matching this
--    project's TEXT+CHECK convention for status/money columns).
-- ----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN notification_email TEXT NULL
    CHECK (notification_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD COLUMN notification_email_verified_at TIMESTAMPTZ NULL;

-- S4 — PII exposure recorded against the existing tracked item, not left to
-- be discovered later. users_select (007_auth_surgery.sql:214-216) is
-- column-agnostic — any authenticated tenant member who can see a users row
-- sees every column. notification_email inherits the SAME exposure
-- whatsapp_number already carries (tracked: docs/reviews/017-review-
-- package.md §7, primary tracking 007 review §11d; whatsapp_number's own
-- live client surface: lib/daily-logs/query.ts + app/(dashboard)/daily-logs/
-- reactivate-cta.tsx). Column-bounding users_select is the distinct F5
-- least-privilege workstream that item already scopes this to — NOT fixed
-- here. This comment is the record that the connection was seen, not missed.
COMMENT ON COLUMN public.users.notification_email IS
  'Owner delivery address for the nightly DPR email (docs/dpr-delivery-'
  'versioning-plan.md §2j). PII — inherits users_select''s column-agnostic '
  'exposure to any tenant member, same class of finding as whatsapp_number '
  '(docs/reviews/017-review-package.md §7, primary tracking 007 review §11d). '
  'Set ONLY by the beta-provisioning operator path (§2j/A1); '
  'notification_email_verified_at is set ONLY by owner_email_verifications'' '
  'confirm route, never by the seeding step itself (§2j/A2).';

-- ----------------------------------------------------------------------------
-- 2. delivery_status widened — three new values, scoped per the plan's own
--    2e/§2j findings.
-- ----------------------------------------------------------------------------
ALTER TABLE public.dprs DROP CONSTRAINT dprs_delivery_status_check;
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_delivery_status_check
    CHECK (delivery_status IN (
      'pending', 'pm_notified', 'delivered', 'paused',
      'skipped_no_data', 'skipped_no_template', 'skipped_unverified', 'failed'
    ));

-- ----------------------------------------------------------------------------
-- 3. owner_email_verifications — S2, fully specified, not a magic word.
--
--    TOKEN GENERATION AND STORAGE: the raw token is generated in application
--    code (crypto.randomBytes(32).toString('hex'), a small operator script
--    per §2j/A1 step 3 — NOT in SQL; Postgres has no cryptographically
--    strong random-string primitive without pgcrypto, which this project
--    does not use anywhere today, and introducing it for one token column
--    is not worth the new dependency). ONLY THE HASH IS STORED — token_hash
--    is SHA-256(raw token), computed in application code before the INSERT;
--    the raw token exists only in the confirmation email itself and is
--    never written to any table. A stolen database dump cannot reconstruct
--    a usable token from token_hash alone.
--
--    EXPIRING: expires_at, set by the caller at INSERT time (recommended:
--    now() + interval '7 days' — long enough for a real person to notice a
--    seeded confirmation email, short enough that a stale, unconfirmed link
--    doesn't sit valid indefinitely).
--
--    SINGLE-USE: used_at, NULL until the confirm route succeeds, then set
--    once. The confirm route's own query (§5's runbook text) MUST check
--    used_at IS NULL before honoring a token — a second click on an
--    already-used link is NOT an error, it reads as "already verified"
--    (idempotent messaging, not alarming).
-- ----------------------------------------------------------------------------
CREATE TABLE public.owner_email_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id    UUID NOT NULL,
  user_id      UUID NOT NULL,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ NULL,
  UNIQUE (token_hash),
  CONSTRAINT owner_email_verifications_user_id_fkey
    FOREIGN KEY (user_id, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX idx_owner_email_verifications_user_id
  ON public.owner_email_verifications (user_id);

ALTER TABLE public.owner_email_verifications ENABLE ROW LEVEL SECURITY;

-- RLS: NO policy for authenticated or anon, on either read or write — this
-- table is reached exclusively via a service-role route handler (§5), the
-- same shape as daily_log_edits' service-role-only write path (019). A
-- token is not an auth.uid() session; there is no RLS predicate that could
-- correctly express "possession of this bearer token," so the boundary is
-- enforced entirely in the route handler, not in a policy. Default-deny
-- (RLS enabled, zero policies) is the correct state, not an oversight.
REVOKE ALL ON public.owner_email_verifications FROM authenticated;
REVOKE ALL ON public.owner_email_verifications FROM anon;

COMMENT ON TABLE public.owner_email_verifications IS
  'Double opt-in confirmation tokens for users.notification_email (docs/dpr-'
  'delivery-versioning-plan.md §2j, B3/B4). token_hash is SHA-256 of a '
  'randomly-generated token minted in application code — the raw token is '
  'NEVER stored, only its hash. expires_at + used_at enforce expiring, '
  'single-use semantics. Reached ONLY via a service-role route handler '
  '(app/api/owner/confirm-email/route.ts, per this file''s header) — no RLS '
  'policy exists for authenticated/anon by design; a bearer token is not an '
  'auth.uid() session and RLS has no predicate for "possession of a token."';

COMMIT;

-- ----------------------------------------------------------------------------
-- APPLICATION-LAYER SPEC (S2), recorded here since it has no SQL of its own
-- but is required content for this package, per direct instruction:
--
-- ROUTE: app/api/owner/confirm-email/route.ts (or equivalent) — GET with a
--   ?token=<raw> query param. PUBLIC, unauthenticated by design (the owner
--   has no login) — this is the ENTIRE reason this route needs the careful
--   treatment above, not an oversight to fix by adding auth.
--
-- WRITE MECHANISM: service-role handler ONLY. On request: hash the raw
--   token (SHA-256), SELECT the owner_email_verifications row by
--   token_hash. If none found, or expires_at < now(), or used_at IS NOT
--   NULL: show a generic "link expired or already used" page — do NOT
--   distinguish "not found" from "expired" from "used" in the response
--   (distinguishing them lets an attacker enumerate valid-but-expired
--   tokens). If valid: in one transaction, UPDATE users SET
--   notification_email_verified_at = now() WHERE id = <user_id>, and
--   UPDATE owner_email_verifications SET used_at = now() WHERE id = <row
--   id> — both writes via the service-role client, not a public RPC (this
--   route is the boundary, matching daily_log_edits' own service-role-only
--   write precedent).
--
-- RE-CLICK BEHAVIOUR: a second click on an already-used token (used_at IS
--   NOT NULL) shows "already verified" — same generic page as the expired
--   case, per the enumeration-resistance note above, but the underlying
--   state is a no-op, not an error: the owner's notification_email stays
--   verified, nothing regresses.
--
-- EXPIRED-TOKEN BEHAVIOUR: same generic page. Recovery path: the operator
--   (§2j/A1's own seeding operator, for beta) re-triggers the confirmation
--   script, which mints a NEW token/row rather than reusing or extending
--   the expired one — an expired token is dead, never revived.
--
-- RATE LIMITING: this route is a public, unauthenticated write surface —
--   rate-limit by IP (a standard Vercel/middleware rate-limit, matching the
--   discipline this project already applies to the WhatsApp webhook's own
--   signature-verified-before-processing posture, though the mechanism
--   differs since there's no HMAC to check here). Not implemented in this
--   migration (application code); named as a required part of the route's
--   own build, not optional hardening to add later.
-- ----------------------------------------------------------------------------
