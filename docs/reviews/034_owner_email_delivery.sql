-- =============================================================================
-- 034_owner_email_delivery.sql
-- DPR delivery/versioning, BLOCKED HALF (docs/dpr-delivery-versioning-plan.md
-- §2j, §2e's pm_notified/skipped_no_template/skipped_unverified widening).
--
-- RENUMBERED 030 -> 034 (2026-08-31, real collision, not cosmetic): this file
-- was drafted and named under 030 on 2026-08-20, the same day (per the plan
-- doc's own record) as a DIFFERENT, concurrently-drafted migration,
-- 030_morning_flow_attendance.sql, which applied under that number on
-- 2026-08-25 -- six days before this correction. This file sat held out of
-- supabase/migrations/ the whole time (per the RELOCATED note below), so
-- there was never a live on-disk collision, but nothing checked its
-- FILENAME against the numbers being consumed around it: 031, 032, and 033
-- were each claimed by other work in the meantime while this file kept the
-- now-taken 030 name. Caught while making an unrelated delivery_status
-- revision to this same file. 034 is the true next open number per
-- `ls supabase/migrations/` as of this correction. Full account:
-- docs/reviews/034-owner-email-review-package.md's delta section.
--
-- RELOCATED (2026-08-20, BB2): moved from supabase/migrations/ to here.
-- A file sitting unapplied, on no ledger, in the scanned migrations
-- directory is a live hazard on ANY branch that has it checked out — a
-- stray `supabase db push` would apply it, PII columns and all. Holding
-- it off `main` alone does not protect a branch that still has it in the
-- scanned path. New convention, CLAUDE.md's Database section: a migration
-- file enters supabase/migrations/ when it is BEING APPLIED, not when it
-- is written — until then it lives here, alongside its review package.
-- This is the rule that would have prevented the 028 hazard in the first
-- place, and matches what actually happened there: 028's file moved into
-- supabase/migrations/ at apply time, not before.
--
-- STATUS: BLOCK LIFTED, 2026-08-31 (Aravind, deliberate decision, not a
-- lapse -- full reasoning: review package §12i). Original text preserved
-- below, not deleted, per this project's own correction discipline:
--
--   ~~WRITTEN, NOT TO BE APPLIED YET. Per the split-package sequencing
--   decision (external review, 2026-08-19): this half is BLOCKED on the
--   trigger-cron workstream (the actual ownerSend cron entry, and #69's own
--   outbound-send primitive for PM-notify) — applying this schema before
--   that exists would add live PII columns and a public verification
--   surface with no code path that ever populates or reads them. Written
--   now so the review package is complete and the next artifact, once
--   trigger-cron lands, is a go-ahead to apply this file, not another
--   design pass.~~
--
-- SHORT FORM, CORRECTED 2026-08-31 (external review, second pass -- the
-- prior version of this note called the guard CIRCULAR; that was wrong,
-- not just imprecise, and is corrected here rather than left standing.
-- Full argument in §12i.) The strike-through above stays struck -- the
-- guard was right to hold, in effect -- but not for the reason first given.
--
-- NOT CIRCULAR: the consumer can be written and held on a branch, merged
-- the moment this file applies -- ordinary apply-then-merge sequencing,
-- the same pattern migration 033 already used, not a rewrite. The real
-- coupling is narrower: the consumer's INTEGRATION TESTS cannot run
-- against test-db until this schema is live there (the same test-schema
-- dependency 030's own mirror tests had on that migration) -- a real but
-- ordinary sequencing cost, not a cycle.
--
-- THE ACTUAL REASON THE GUARD LIFTS: the 2026-08-19 guard conflated the
-- SCHEMA with the SURFACE. This file, applied alone, creates two nullable
-- PII columns with no data, one nullable consent-state column, and an
-- EMPTY token table with RLS enabled, zero policies, and no grant to
-- anon/authenticated/PUBLIC (§3, §5) -- nothing can reach it, because
-- nothing that can reach it exists yet. The public, unauthenticated write
-- surface the original guard was actually protecting against is born when
-- the CONFIRM ROUTE deploys -- application code, gated by ITS OWN merge,
-- not by this file's apply. Applying this schema inert is the 029 shape:
-- mechanism installed, wiring follows. The exposure the guard names was
-- never in this file.
--
-- THE GUARD DOES NOT DISAPPEAR -- IT RELOCATES to the confirm-route PR:
-- that PR ships WITH rate limiting and POST-consume (§S below) as GATE
-- CONDITIONS, carries its own §0(c) review, and does NOT merge before this
-- file is confirmed live on prod (not merely applied -- observed, per
-- CLAUDE.md's own standing rule). STATUS NOW (updated 2026-08-31, rehearsal
-- complete): disposable scaffold and written-and-executed rollback done
-- (§13); the design-GO review round with two blocking findings fixed
-- counts as the fresh external-review pass the checklist required (§12i,
-- §13b); test-db rehearsal DONE against exfccwlrhoutkgrlikod, including
-- the service_role negative-capability probe, both rollback branches, and
-- 034 LEFT APPLIED there per direct instruction (§14); the apply runbook
-- is written in full (§11). STILL NOT APPLIED TO PROD -- that remains a
-- separate, Aravind-executed action (SQL Editor, by hand), gated on §11's
-- own PITR-observation and pre-apply-probe steps, not on anything left in
-- this checklist.
--
-- CLAUDE.md §0 GATING ASSESSMENT, condition by condition:
--   (a) "CREATES OR MODIFIES a live function's LOGIC." Does not trip — no
--       Postgres function created or modified in this file (verification is
--       a service-role application-code write, not an RPC — see §5 below for
--       why, not merely asserted).
--   (b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING
--       OBJECT." TRIPS. Widens delivery_status's CHECK on the existing,
--       live dprs table, and adds three new columns to the existing, live
--       users table (notification_email, notification_email_verified_at —
--       both PII; whatsapp_declined_at — a consent-state signal, added
--       2026-08-31 delta, §12b).
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
--   This IS that package (docs/reviews/034-owner-email-review-package.md).
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
  ADD COLUMN notification_email_verified_at TIMESTAMPTZ NULL,
  ADD COLUMN whatsapp_declined_at TIMESTAMPTZ NULL;

-- whatsapp_declined_at — ADDED 2026-08-31 delta (review package §12b),
-- REVERSING the prior draft's "not designed into this migration" position.
-- WhatsApp is optional for owners (Decision 2, 2026-08-31): §37(d)'s
-- no-report notice falls back to email when the owner has no WhatsApp
-- number, and provisioning must record an explicit DECLINE, distinct from
-- "never asked" -- a null whatsapp_number alone cannot tell the two apart.
-- SAME NULL-MEANS-UNSET SHAPE as notification_email_verified_at
-- immediately above: NULL is the default (every legacy row, every
-- not-yet-asked owner), a timestamp means "asked and explicitly declined
-- at this moment."
--
-- WHY THIS REVERSES, NOT SUPPLEMENTS, THE PRIOR REASONING (external review
-- finding, taking the prior draft's own argument off it): "no reader yet"
-- does not distinguish this column from `notification_email` two lines
-- above -- THIS WHOLE MIGRATION is already blocked on exactly that reason
-- (STATUS block above, "no code path that ever populates or reads them").
-- What that argument actually leaves undecided is not WHETHER to add the
-- column, but WHEN the first real owner rows get provisioned relative to
-- when this file applies -- and THIS is the migration that makes an owner
-- row provisionable at all (§2j/A1's operator INSERT depends on this
-- file's own columns existing). Provisioning is an operator runbook run
-- against whatever schema is LIVE at that moment, not against whatever
-- this migration's package happened to argue was sufficient. Without this
-- column, the first real owner rows collapse "declined" and "never asked"
-- into one indistinguishable NULL, recoverable only by asking the owner
-- again -- the exact "we forgot to ask" vs "he said no" conflation this
-- entry exists to prevent. Same principle already established elsewhere in
-- this codebase for `attendance_defaulted` (capture the distinction AT
-- WRITE TIME, even when nothing renders or reads it yet -- render logic is
-- cheap and can be added whenever it's needed; a distinction never
-- captured cannot be reconstructed after the fact).

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
-- 2. delivery_status widened — six new values now, scoped per the plan's own
--    2e/§2j findings PLUS the 2026-08-31 delta (review package §12a):
--      pm_notified, skipped_no_template, skipped_unverified -- original three.
--      no_report_sent    -- NEW. Success: the §37(d) no-report notice reached
--                            the owner (WhatsApp template 14, or its email
--                            fallback per §12b -- either channel writes this
--                            same value; the channel actually used is not
--                            part of this column's job to record).
--      owner_send_failed -- NEW. Failure, paired with `delivered`: the
--                            full-report EMAIL attempt failed (bounce,
--                            complaint, provider/API rejection -- any
--                            sub-cause, not split further, §12a). Written by
--                            the email delivery-status webhook, #67's own
--                            §2g dependency -- NOT built yet.
--      no_report_failed  -- NEW. Failure, paired with `no_report_sent`: the
--                            no-report WHATSAPP attempt failed (unreachable
--                            number, template rejected, a 63xxx-class async
--                            failure). WRITER CORRECTED 2026-08-31 (external
--                            review, §12a gap #2) -- see the PROPAGATION GAP
--                            note below. Do not read "already-built
--                            status-callback route" as an already-built
--                            end-to-end path to this column.
--    `failed` (already live, no DDL here) is RE-SCOPED IN MEANING ONLY,
--    going forward: it now means stage 1 (PM-notify) failed, specifically,
--    not "either stage failed" -- the same re-scoping treatment `delivered`
--    already got when owner delivery moved from WhatsApp to email (§2e).
--    Full argument for two paired failure values instead of one shared
--    value: review package §12a.
--
-- TRANSITION TABLE AND WHEN `delivered`/`no_report_sent` ARE STAMPED --
-- ADDED 2026-08-31 (external review, §12a gap #1: this was previously
-- undecided, and undecided is what produces a row claiming delivery for a
-- bounced email). DECIDED: stamped at PROVIDER-ACCEPT, not at confirmed
-- delivery -- matching this codebase's OWN existing precedent for the
-- structurally identical WhatsApp case (031/outbound_sends: `status='sent'`
-- is written synchronously on Twilio's 2xx, not on a later delivery
-- receipt; `status-callback.ts`'s own header states delivered/read are
-- explicit no-ops on that table's status column). Applying the same model
-- here, not inventing a second one for email:
--
--   pending -> pm_notified          (stage 1, PM-notify WhatsApp accepted)
--   pending -> skipped_no_template  (stage 1, Meta hasn't approved yet)
--   pending -> failed               (stage 1, PM-notify attempt failed)
--
--   pending -> delivered            (stage 2, evening data present: full
--                                     report EMAIL accepted by the provider
--                                     -- ACCEPT time, not confirmed-delivery)
--   pending -> owner_send_failed    (stage 2: email attempt REJECTED
--                                     synchronously, never reached accept)
--   delivered -> owner_send_failed  (stage 2: LEGAL AND EXPECTED, not an
--                                     edge case -- the provider's async
--                                     webhook reports a bounce/complaint
--                                     MINUTES TO HOURS after accept, which
--                                     is the normal timeline for email
--                                     bounce classification, not a rare
--                                     race. A row can move OUT of a
--                                     terminal-looking success. A consumer
--                                     of this column -- a dashboard, an
--                                     alert -- must not treat `delivered`
--                                     as permanently final.)
--
--   pending -> no_report_sent       (stage 2, evening data absent: no-report
--                                     notice accepted by its provider --
--                                     same accept-time stamping)
--   pending -> no_report_failed     (stage 2: no-report attempt rejected
--                                     synchronously)
--   no_report_sent -> no_report_failed  (stage 2: LEGAL AND EXPECTED, same
--                                     reasoning as delivered -> owner_send_
--                                     failed one level up -- an async
--                                     WhatsApp status-callback undelivered/
--                                     failed event, or an async email bounce
--                                     if the no-report notice used its email
--                                     fallback per §12b, arriving after
--                                     accept.)
--
--   pending -> skipped_unverified   (stage 2, email path only: gated before
--                                     any send attempt -- terminal, no
--                                     further transition for this dprs row)
--
-- CONSEQUENCE FOR dpr_versions.delivered_to_owner_at (029, already applied,
-- NOT altered by this migration), NAMED SO IT ISN'T DISCOVERED LATER AS
-- DRIFT: that column's own COMMENT ON TABLE (029) reads '"Which version was
-- delivered to the owner" is answered by whichever row has
-- delivered_to_owner_at set.' Under the accept-time decision above, this
-- column will be stamped at the SAME moment `dprs.delivery_status` moves to
-- `delivered` -- i.e. "handed to the provider," not "confirmed reached the
-- owner's inbox." This is the identical precision 031's own `status='sent'`
-- already carries for WhatsApp, so it is not a new or inconsistent
-- semantic -- but 029's own comment text predates this migration's
-- delta and reads more confidently than that. Not fixed here (029 is
-- already live; this migration does not touch it) -- named as a documentation-
-- only correction for whoever next touches 029's own comment text, same
-- treatment this project already gives other stale-but-not-wrong comments
-- (023's own dprs table comment, corrected in-place by 029 itself for
-- exactly this reason).
--
-- PROPAGATION GAP, NAMED AS AN UNBUILT REQUIREMENT (external review, §12a
-- gap #2) -- beside the already-named email delivery-status webhook (#67's
-- §2g), NOT solved by it. The `/api/whatsapp/status-callback` route (item
-- D, PR #120/#126) is real and already stamps `outbound_sends.status`,
-- keyed by Twilio's `MessageSid` -- but it has ZERO knowledge of `dprs` and
-- writes nothing to it (confirmed by reading `lib/whatsapp/outbound/
-- status-callback.ts` directly: its entire mapping logic targets
-- `outbound_sends.status` alone). Using it to write `dprs.delivery_status =
-- 'no_report_failed'` needs NEW propagation logic that does not exist, for
-- two independent reasons, not one:
--   1. No mapping from an outbound_sends row back to a dprs row exists at
--      all -- outbound_sends' own event_key scheme (031) has no checkpoint
--      name for a no-report send yet either; this table has never been
--      asked to carry that link.
--   2. THE RELATIONSHIP IS NOT ONE-TO-ONE. The no-report notice is sent
--      ONCE per owner per PROJECT-day; `dprs` rows are per ENGINEER (028's
--      own key widening). One WhatsApp send outcome for one project-day
--      therefore corresponds to N dprs rows (every engineer report
--      generated for that project that day), and something must resolve
--      which N before any UPDATE runs -- a single-row UPDATE keyed by
--      Twilio SID cannot do this by itself.
-- Named here so the already-built status-callback route is never read as
-- an already-built END-TO-END path to this column -- it is the WhatsApp
-- half of the transport layer only. The propagation logic itself (the
-- project-day -> N-engineer-rows fan-out, for whichever channel fired) is
-- unbuilt, same status as the email webhook it sits beside.
-- ----------------------------------------------------------------------------
ALTER TABLE public.dprs DROP CONSTRAINT dprs_delivery_status_check;
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_delivery_status_check
    CHECK (delivery_status IN (
      'pending', 'pm_notified', 'delivered', 'paused',
      'skipped_no_data', 'skipped_no_template', 'skipped_unverified', 'failed',
      'no_report_sent', 'owner_send_failed', 'no_report_failed'
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
  -- Direct single-column FK, ADDED 2026-08-31 delta (nit, external review)
  -- to match 031's own declared shape (tenant_id REFERENCES tenants(id),
  -- ALONGSIDE the composite FK below) rather than leaving tenant_id
  -- validated only transitively through the composite. Transitivity was
  -- sound either way (a valid (user_id, tenant_id) pair already implies
  -- tenant_id is real, since users.tenant_id itself is FK'd to tenants) --
  -- this is a consistency fix with an established sibling, not a
  -- correctness fix for a real gap.
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id)
                 ON UPDATE NO ACTION ON DELETE RESTRICT,
  user_id      UUID NOT NULL,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ NULL,
  UNIQUE (token_hash),
  -- CASCADE, ARGUED (nit, external review 2026-08-31) — contrasted
  -- explicitly with 031's own RESTRICT, so the divergence reads as a
  -- deliberate choice, not an inconsistency: a verification token is a
  -- DERIVATIVE artifact of its user, with no independent retention claim of
  -- its own (unlike outbound_sends, a durable billed record that must
  -- outlive the user row it references) — once the user row is gone, this
  -- token has nothing left to verify and no reason to survive it.
  CONSTRAINT owner_email_verifications_user_id_fkey
    FOREIGN KEY (user_id, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  -- Lifecycle CHECK constraints, ADDED 2026-08-31 delta (nit, external
  -- review) — the 027 (checkin_escalations) habit of a named CONSTRAINT per
  -- timestamp-ordering fact, applied here for the first time to an
  -- ORDERING claim rather than 027's own "this status implies that
  -- timestamp is set" shape; same family, one CHECK per fact, not folded
  -- together.
  CONSTRAINT owner_email_verifications_expires_after_created
    CHECK (expires_at > created_at),
  CONSTRAINT owner_email_verifications_used_after_created
    CHECK (used_at IS NULL OR used_at >= created_at)
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
--
-- GRANT LAYER, REWRITTEN 2026-08-31 delta to MATCH 031's OWN SHAPE
-- (external review nit — 031's REVOKE names PUBLIC alongside the three
-- roles; the prior draft of this block did not). Supabase's project-level
-- default ACL grants new public-schema tables to anon/authenticated/
-- service_role individually (CLAUDE.md's standing rule) — REVOKE ALL from
-- everything first, then GRANT BACK only what's needed, same two-step
-- shape 031 already established, not a third variant of the same idea.
-- This is the FOURTH confirmed instance of the underlying pattern:
-- dpr_versions (029, live on prod), 031_outbound_send_ledger.sql (caught
-- pre-apply by its own rehearsal), and this file's own two earlier drafts
-- (the incomplete per-role REVOKE list first, then a same-day fix that
-- still didn't match 031's own PUBLIC-inclusive shape) — now fixed here
-- before any rehearsal ever ran against either draft. Worth recording as a
-- real limit of the 2026-08-26 grep sweep that found the first three: that
-- sweep scanned supabase/migrations/, the directory every apply/rehearsal
-- tool reads — this file sat in docs/reviews/ the entire time (correctly,
-- per BB2), which is exactly why a migrations-directory grep missed it.
--
-- service_role's actual need, stated precisely: TWO legitimate callers, not
-- one — the confirmation-send operator script (§2j/A1 step 3, mints the
-- token/row) needs INSERT; the confirm-email route (§5) needs SELECT (find
-- the row by token_hash) and UPDATE (set used_at on success). The prior
-- draft's own comment named only SELECT/UPDATE and omitted the minting
-- script's INSERT need entirely — caught while matching this block to
-- 031's shape, not by a separate finding. NONE of DELETE, TRUNCATE,
-- REFERENCES, or TRIGGER are needed — expired/used rows are left in place
-- (§9's own PRUNABLE HYGIENE classification: a future pass may add a
-- scheduled prune, not this migration, and not via ad-hoc DELETE from a
-- route handler), and nothing in this design ever truncates or adds a
-- trigger to this table.
REVOKE ALL ON public.owner_email_verifications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.owner_email_verifications TO service_role;

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
-- but is required content for this package, per direct instruction. REVISED
-- 2026-08-31 (external review, finding S) -- the GET-verifies design below
-- this note replaced is a REAL security defect, not a hardening nice-to-have,
-- and is fixed here while this is still prose, before any route is written.
--
-- THE DEFECT, STATED PRECISELY, SO THE FIX'S REASON SURVIVES ALONGSIDE IT.
-- Corporate mail gateways (Microsoft Safe Links and equivalents) fetch EVERY
-- link in an email automatically, on arrival, before a human ever opens the
-- message -- a GET request indistinguishable, at the HTTP layer, from the
-- owner's own click. A design where GET itself verifies (the original draft
-- below) means the SCANNER'S prefetch confirms the owner's email address,
-- with no human intent involved at all -- a double opt-in BYPASSED by the
-- exact automated-fetch mechanism double opt-in exists to defeat. The milder
-- failure mode is also real and would have shipped invisibly: the token
-- burns on the scanner's prefetch, the real owner clicks minutes or hours
-- later, sees "link expired or already used," and neither the owner nor the
-- operator has any way to tell that from a genuinely stale link -- the two
-- cases produce an IDENTICAL row state (used_at IS NOT NULL, but the wrong
-- actor set it).
--
-- THE FIX: GET RENDERS, POST CONSUMES. Splits the single GET-does-everything
-- step below into two:
--
-- ROUTE (GET): app/api/owner/confirm-email/route.ts (or equivalent) — GET
--   with a ?token=<raw> query param. PUBLIC, unauthenticated by design (the
--   owner has no login). Looks up the token by its hash EXACTLY as before
--   (hash, SELECT by token_hash, check expires_at/used_at) but the GET
--   handler's own response is READ-ONLY -- it never writes used_at or
--   notification_email_verified_at. If the token is not found, expired, or
--   already used: render the same generic "link expired or already used"
--   page as before (enumeration-resistance note below, unchanged). If
--   valid: render an HTML confirmation page carrying the token (a hidden
--   form field, not a second query-string round trip) with a single visible
--   "Confirm my email" button, and copy explaining what confirming does. A
--   scanner's automated GET fetches this page and stops -- there is no
--   button for it to click, and fetching a page performs no write. Nothing
--   is verified yet.
--
-- ROUTE (POST): the SAME route path, POST from that page's own form (token
--   carried in the POST body, not the URL). THIS is where the write
--   mechanism below actually runs -- verification happens only when a human
--   submits the form, which an automated prefetch cannot do. Re-validates
--   the token exactly as the GET did (a POST arriving without a prior valid
--   GET, or against an already-consumed/expired token, gets the same
--   generic failure page) -- the GET's own validation is not trusted to
--   still hold by the time the POST arrives, since real time passes between
--   them.
--
-- WRITE MECHANISM (now POST-only): service-role handler ONLY. Hash the raw
--   token (SHA-256), SELECT the owner_email_verifications row by
--   token_hash. If none found, or expires_at < now(), or used_at IS NOT
--   NULL: show the generic "link expired or already used" page — do NOT
--   distinguish "not found" from "expired" from "used" in the response
--   (distinguishing them lets an attacker enumerate valid-but-expired
--   tokens). If valid: in one transaction, UPDATE users SET
--   notification_email_verified_at = now() WHERE id = <user_id>, and
--   UPDATE owner_email_verifications SET used_at = now() WHERE id = <row
--   id> — both writes via the service-role client, not a public RPC (this
--   route is the boundary, matching daily_log_edits' own service-role-only
--   write precedent).
--
-- TOKEN-IN-QUERY-STRING, NOTED, NOT REDESIGNED AROUND (external review,
--   finding S). The GET still necessarily carries the raw token in the URL
--   to render the confirmation page — and a URL lands in ordinary places a
--   request body does not: server/proxy/CDN access logs, browser history, a
--   Referer header if the confirmation page ever linked out. This is a real,
--   known exposure class for any token-in-URL design, named here rather than
--   left implicit. Two things already bound it, not eliminate it: token_hash
--   is what's stored (a logged raw token cannot be reconstructed from the
--   database, only the reverse), and used_at makes the token single-use (a
--   logged token is worthless once the real confirmation POST has run,
--   narrowing the exposure window to "before the owner clicks," not
--   indefinite). The POST design keeps the CONSUMING write's own request out
--   of the URL, which is what the fix above is actually for -- it does not
--   and cannot remove the token from the GET's URL, since a link is the only
--   thing an email can carry. Accepted as a residual, bounded risk, not
--   solved further in this pass.
--
-- RE-CLICK BEHAVIOUR: a second click/submit on an already-used token
--   (used_at IS NOT NULL) shows "already verified" — same generic page as
--   the expired case, per the enumeration-resistance note above, but the
--   underlying state is a no-op, not an error: the owner's
--   notification_email stays verified, nothing regresses.
--
-- EXPIRED-TOKEN BEHAVIOUR: same generic page. Recovery path: the operator
--   (§2j/A1's own seeding operator, for beta) re-triggers the confirmation
--   script, which mints a NEW token/row rather than reusing or extending
--   the expired one — an expired token is dead, never revived.
--
-- RATE LIMITING: this route is a public, unauthenticated write surface —
--   rate-limit the POST by IP (a standard Vercel/middleware rate-limit,
--   matching the discipline this project already applies to the WhatsApp
--   webhook's own signature-verified-before-processing posture, though the
--   mechanism differs since there's no HMAC to check here). The GET is a
--   read-only render and does not need the same protection, though a
--   generic per-IP rate limit covering both is simplest to build and is not
--   wrong to apply to both. Not implemented in this migration (application
--   code); named as a required part of the route's own build, not optional
--   hardening to add later.
-- ----------------------------------------------------------------------------
