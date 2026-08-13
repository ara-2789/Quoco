-- =============================================================================
-- 027_checkin_escalations.sql
-- ----------------------------------------------------------------------------
-- STATUS: WRITTEN ONLY. Not rehearsed on test-db, not applied anywhere, not
-- pushed. This file exists so docs/reviews/027-review-package.md can pin it
-- via `git show <sha>:path` (CLAUDE.md §0 provenance rule) BEFORE the
-- external review round runs — not after. Do NOT rehearse or apply this
-- migration until Aravind and the reviewer have both seen this revision. It
-- trips the external-review gate on two independent grounds (CLAUDE.md §0): a
-- brand new table has no prior safe state to fall back on ("CREATES OR
-- MODIFIES... a new table with wrong RLS from day one... is at least as
-- dangerous as a bad change to an existing one"), and RLS/grants are named
-- explicitly as trigger (b), the condition CLAUDE.md calls out by name after
-- migration 020's incident.
--
-- REVIEWED TWICE, both incorporated here, neither left as a follow-up:
--   1. INTERNAL PASS (2026-08-12, Aravind reading the branch directly) — see
--      the "nudge_outcome" section below.
--   2. EXTERNAL PRE-APPLY REVIEW (2026-08-13) — verdict STOP, three blocking
--      findings + two non-blocking. See "RLS — ROLE GATE", "REFERENTIAL
--      INTEGRITY", and "LIFECYCLE CHECK CONSTRAINTS" below for each. Full
--      external review record: docs/reviews/027-review-package.md.
--
-- WHAT THIS IS FOR
-- Backs the check-in nudges / escalation feature (docs/bot-flows.md TRIGGER
-- TIMES, "Morning cutoff" + design-principles.md Rule 7.2): one row per
-- (project, engineer, log_date, half) tracking that half's nudge/escalation
-- lifecycle — awaited -> nudged -> escalated (PM notified) -> submitted /
-- not_submitted. Read by the DASH-01 exceptions surface (bot-flows.md,
-- not yet built) to show a PM which engineers are missing today. Written
-- only by the escalation sweep job (not yet built — same "schema before
-- handler" sequencing as migration 023's dprs table before the dpr_generate
-- handler existed).
--
-- ROSTER PRECEDENT — project_members, NOT daily_logs (per lib/dpr/
-- accountability.ts's own header, the house precedent for this exact
-- problem shape). accountability.ts asks "who's missing," and an engineer
-- who submitted nothing has no daily_logs row to read — absence can't be
-- detected from rows that don't exist. This table has the same shape: it
-- exists BECAUSE an engineer hasn't submitted, so anything driving it (the
-- roster of who SHOULD have a row today) has to come from project_members,
-- never from daily_logs. Not restated as code here — this migration is
-- schema only — but the job handler that populates this table MUST follow
-- accountability.ts's left-join-and-look-for-NULL shape, not the fetch-
-- what-exists shape lib/dpr/assemble.ts uses for a different question.
--
-- UNIQUE (project_id, engineer_id, log_date, half) — AT-LEAST-ONCE WRITE
-- SAFETY, not just a dedupe convenience. The escalation sweep is a job
-- polled by the existing /api/jobs/tick worker (NFR-16) — the same queue
-- whose retry/backoff semantics mean a sweep for a given engineer/day/half
-- can legitimately run more than once (a retried job after a transient
-- failure, or two overlapping poller invocations under BOT-26-style
-- ordering pressure). Nothing about this table's writer is exactly-once by
-- construction. The UNIQUE constraint is what turns "the sweep may fire
-- more than once" into "at most one row exists regardless" — the writer
-- upserts (INSERT ... ON CONFLICT (project_id, engineer_id, log_date, half)
-- DO UPDATE) rather than plain INSERT, the same idempotency shape
-- processed_messages (011) uses for inbound webhook SIDs and dprs (023)
-- uses for regeneration. Without it, a re-run sweep would create duplicate
-- escalation rows for the same engineer/day/half, double-counting on
-- DASH-01 and potentially double-firing a PM notification.
--
-- nudge_outcome — ONE nullable column, not three independent booleans.
-- INTERNAL-REVIEW CHANGE (2026-08-12): the first draft of this migration
-- stored the send outcome as three separate booleans (sent_free_form,
-- sent_template, template_unavailable) ALONGSIDE the five-value `status`
-- lifecycle column — two representations of overlapping facts, free to
-- disagree (nothing prevented status='nudged' with all three false, or
-- sent_free_form AND sent_template both true simultaneously). Caught before
-- this went to external review, not by him — the exact class of bug this
-- project has been bitten by four times now (see CLAUDE.md's HAND-MIRRORED
-- RECONCILIATION entry for the pattern, though that entry is about a
-- different pair of columns). Collapsed to a single nullable
-- `nudge_outcome`, CHECK-constrained to ('free_form', 'template',
-- 'unavailable', 'failed'), NULL meaning not attempted. `status` keeps
-- answering a DIFFERENT question (where the escalation lifecycle is:
-- awaited/nudged/escalated/submitted/not_submitted) — two columns, one job
-- each, same principle as schema.ts's CapturedCount in the DPR pipeline
-- (lib/dpr/schema.ts): a contradictory state is impossible BY CONSTRUCTION,
-- not by discipline.
--
-- 'template' AND 'unavailable' ARE UNREACHABLE VALUES TODAY, BY DESIGN —
-- recorded so a future reader doesn't mistake a dead code path for a bug.
-- Per bot-flows.md's 2026-08-12 correction, free-form send is the PRIMARY
-- path for every trigger and the named template is the FALLBACK for a
-- closed 24h session window. But CLAUDE.md §10 Week 2 item 5/6: the Twilio
-- PRODUCTION sender is still BLOCKED on company registration, and
-- bot-flows.md's own "Sandbox limitation" section states the Twilio
-- SANDBOX cannot send custom approved templates at all — session messages
-- only. So until the production sender exists, no code path in this system
-- can attempt a template send, meaning nudge_outcome can only ever land on
-- 'free_form', 'failed', or NULL — never 'template' or 'unavailable'. They
-- exist now so the escalation job handler's schema is stable when that
-- sender ships, not because either is exercised today. Do not treat their
-- absence from every row as evidence the fallback path was tested; it is
-- evidence the fallback path has never been reachable. ('free_form' and
-- 'failed' ARE reachable today, unlike the booleans-era note this replaces
-- implied for the whole column — free-form/session sends already work in
-- the Twilio sandbox, and a send can fail for ordinary infra reasons
-- regardless of which path it took.)
--
-- RLS — ROLE GATE (EXTERNAL REVIEW, 2026-08-13, blocking finding #1, FIXED).
-- The prior draft mirrored dprs_select (023) byte-for-byte: tenant pin +
-- project_members EXISTS, no further gate. The reviewer's frame, confirmed
-- correct rather than accepted on faith: dprs is a DELIVERABLE — shown to
-- people ON the project, owner included (once a Phase 2 owner dashboard
-- exists); single-project scoping is the entire point of that policy.
-- checkin_escalations is the opposite kind of data — INTERNAL MANAGEMENT
-- information about the contractor's OWN STAFF's submission behaviour.
-- Project membership answers "are you attached to this project?" when the
-- real question is "are you management?" Same scoping SHAPE (tenant +
-- project), opposite AUDIENCE.
--
-- TWO CONCRETE LEAKS, BOTH VERIFIED AGAINST REAL STATE, NOT ASSUMED:
--   (a) ENGINEER — the sharper of the two. The old policy's EXISTS did not
--       filter project_members.role at all: ANY project_members row for
--       that project/user satisfies it, engineer or not. Checked directly
--       against prod, not hypothetically: project_members.role already
--       holds the value 'engineer' TODAY (the 025/027 test engineer,
--       3534756b, is a live project_members row with role='engineer' on
--       project acef67fe). Nothing in the OLD policy would have excluded
--       that row from reading every other engineer's miss-list on that
--       project, the moment engineers get web logins — the only reason
--       it's inert today is auth_id=NULL (CLAUDE.md §5: engineers are
--       WhatsApp-bot-only, no web login), not the policy.
--   (b) OWNER — real, but one step further away than it first reads.
--       023's own header states owners are NOT in project_members at all
--       ("Owners are not associated via project_members at all... Owner
--       association is a SEPARATE mechanism, projects.owner_user_id") — so
--       an owner login ALONE does not satisfy the old EXISTS. The leak
--       needs a FUTURE change (a Phase 2 owner-facing dashboard adding
--       owners to project_members, which is a plausible design, not a
--       remote one) before it's reachable. Recorded precisely rather than
--       overstated: this is a forward risk one step removed, not a live
--       hole the way (a) is.
--
-- FIX: keep the tenant pin and the project_members EXISTS EXACTLY as
-- written (the project-scoping shape was never the problem) and ADD a
-- caller-role gate: only `role IN ('pm', 'admin')` may read. 'qs' is
-- DELIBERATELY EXCLUDED — Aravind's decision, recorded here as a decision,
-- not inherited as a side effect of the dprs_select shape this migration
-- started from: a quantity surveyor deals with measurement and valuation,
-- not attendance, and has no product reason to see who has and hasn't
-- checked in. The membership requirement stays for admins too, deliberately
-- — CLAUDE.md §4's "should a tenant admin see every project" is a DASH-01
-- product decision, not something to smuggle into a table policy via an
-- unrelated migration.
--
-- FORWARD RATIONALE (so Phase 2's author inherits the REASON, not just the
-- gate): this policy is role-gated because owner and engineer web logins
-- are BOTH planned, not hypothetical, and this table is internal-management
-- data neither audience has a product reason to read. If either login
-- capability ships, re-verify this gate before shipping it, don't assume
-- the shape below still covers the new case unexamined.
--
-- PERFORMANCE (mine, not the reviewer's, folded into the same fix): the
-- naive version of this gate would run a SECOND per-row subquery to resolve
-- auth.uid() -> role, on top of the existing one resolving auth.uid() -> id
-- for the membership join — doubling the users lookup on every row
-- evaluated. The policy below resolves id AND role in ONE lookup (a single
-- `users` row, joined once), not two.
--
-- RISK CLASS: additive (new table only, no existing object touched) but
-- NOT low-risk by CLAUDE.md §0's own subject-matter test — a new table
-- with RLS from day one is explicitly named as the case with no prior safe
-- state to fall back on, hence the external-review gate and the
-- WRITTEN-ONLY status above. Reversible without PITR if it ever needs
-- rolling back pre-apply (nothing else references this table yet).
--
-- REFERENTIAL INTEGRITY (EXTERNAL REVIEW, 2026-08-13, blocking findings
-- #2 and #3, FIXED). Two separate findings, one fix each, both about FK
-- shape:
--
-- #2 — REFERENTIAL ACTIONS CHOSEN, NOT INHERITED. All three FKs in the
--   first draft defaulted to NO ACTION by omission (Postgres's default,
--   never stated). 017's own header establishes the house rule these are
--   CHOSEN and WRITTEN, not left to default. VERIFIED, not accepted from
--   the review text: grepped app/ and lib/ for a project-delete code path
--   — NONE EXISTS today (only list/new/[id] pages under
--   app/(dashboard)/projects/, zero delete/archive action anywhere). So
--   "the first PM to delete a project" cannot happen through the product
--   as it stands. But the SCHEMA already anticipates project deletion as a
--   real operation regardless of the UI: project_members.project_id has
--   carried ON DELETE CASCADE since migration 001, and nothing stops a
--   direct/manual project deletion today. The underlying concern is real
--   even though the specific "first PM clicks delete" framing overstated
--   how it would happen; the fix is the same either way.
--   CHOSEN: project_id -> ON DELETE CASCADE (an escalation row is
--   meaningless without its project — identical reasoning to
--   project_members.project_id's own CASCADE, the sibling table this
--   design is modeled on).
--   engineer_id -> ON DELETE CASCADE, decided explicitly, not defaulted.
--   RESTRICT was the alternative and is defensible on its own terms — this
--   system NEVER hard-deletes a user row (status='deactivated' is the only
--   lifecycle transition anywhere in this codebase; CLAUDE.md §5), so
--   RESTRICT would in practice just never fire. CASCADE was chosen instead
--   because (a) it matches project_members.user_id's own ON DELETE CASCADE
--   exactly (017) — the sibling table checkin_escalations' roster logic is
--   already modeled on — and (b) this table is classified operational/
--   prunable-hygiene-class data (see the RETENTION note in CLAUDE.md §10,
--   added alongside this revision), not a permanent compliance record like
--   daily_logs — losing escalation history for a user row that, by this
--   system's own design, is never actually deleted is an acceptable trade
--   for consistency with the precedent table over a RESTRICT that only
--   ever guards a scenario that cannot occur.
--   tenant_id -> ON DELETE CASCADE, matching the near-universal house
--   pattern (every table in 001_core_schema.sql uses `REFERENCES
--   tenants(id) ON DELETE CASCADE`) rather than dprs's (023) undocumented
--   deviation to plain NO ACTION-by-omission — checked, not assumed, and
--   the original 001 pattern is treated as the house default here since
--   023 never explains the departure.
--
-- #3 — CROSS-TENANT REFERENCE INTEGRITY. The only writer is service_role
--   (the escalation sweep job), which bypasses BOTH RLS and grants —
--   nothing structural stops a buggy sweep writing a tenant-A row pointing
--   at a tenant-B project or engineer. Two house precedents exist for this
--   exact problem and the first draft cited neither: 017's composite
--   same-tenant FKs (FOREIGN KEY (col, tenant_id) REFERENCES parent (id,
--   tenant_id)), or 019's documented plain-FK exception with a pinned
--   argument for why a composite FK wasn't needed there. CHOSEN: the
--   composite FKs, per the reviewer's recommendation — the parent UNIQUE
--   (id, tenant_id) indexes (017: users_id_tenant_id_key,
--   projects_id_tenant_id_key) ALREADY EXIST on prod, so this costs
--   nothing beyond declaring the FK correctly, and unlike 019's case this
--   table's writer does not exist yet to independently verify same-tenant
--   behaviour some other way. What is NOT acceptable, stated as plainly as
--   the reviewer put it: plain FKs with the question unasked, on the table
--   whose entire purpose is per-project accountability claims. ON UPDATE
--   NO ACTION is stated explicitly on both composite FKs (matching 017's
--   own reasoning verbatim): tenant_id is immutable post-creation (007
--   §9), so no legitimate write ever updates a referenced (id, tenant_id)
--   key, and if one ever did, failing loud is correct — silently
--   cascading a tenant-move nobody designed is not.
--
-- LIFECYCLE CHECK CONSTRAINTS (EXTERNAL REVIEW, 2026-08-13, non-blocking
-- finding #4, DONE ANYWAY — zero cost while the table is unapplied). The
-- original five-value status/three-timestamp shape let status='nudged'
-- coexist with nudge_sent_at IS NULL, 'escalated' with escalated_at IS
-- NULL, 'submitted' with resolved_at IS NULL — three representable-but-
-- meaningless states. This is the EXACT SAME PRINCIPLE the internal pass
-- (above) already applied to the send-outcome booleans — impossible by
-- construction, not by discipline — left unapplied one column over. Three
-- CHECK constraints close it; see the CREATE TABLE below.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. checkin_escalations table.
-- -----------------------------------------------------------------------------
CREATE TABLE public.checkin_escalations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NOT trigger-maintained — no trigger exists anywhere in this project for
  -- any updated_at column (checked: grepped every migration; the house
  -- pattern is explicit setting at every write site, e.g.
  -- whatsapp_sessions.updated_at, labelled "SESSION WRITE — ALWAYS" at each
  -- RPC call site that touches it). This column follows the same
  -- convention: the escalation sweep job (not yet built) MUST set
  -- updated_at = now() explicitly on every UPDATE/upsert. See this column's
  -- own COMMENT below — read that before assuming Postgres refreshes this
  -- for you on UPDATE. It does not.
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- project_id / engineer_id: plain columns here, deliberately WITHOUT an
  -- inline single-column REFERENCES — the actual FK relationship is the
  -- composite constraint below (project_id, tenant_id) / (engineer_id,
  -- tenant_id), which also pins same-tenant. See REFERENTIAL INTEGRITY
  -- (#3) in the header. Matches 017's end-state shape for project_members
  -- exactly (project_members.project_id/.user_id carry no inline
  -- single-column FK either, only the composite table constraint).
  project_id           UUID NOT NULL,
  engineer_id          UUID NOT NULL,
  log_date             DATE NOT NULL,
  half                 TEXT NOT NULL CHECK (half IN ('morning', 'evening')),
  status               TEXT NOT NULL DEFAULT 'awaited'
                          CHECK (status IN (
                            'awaited', 'nudged', 'escalated', 'submitted', 'not_submitted'
                          )),
  nudge_sent_at        TIMESTAMPTZ,
  escalated_at         TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ,
  -- See header note above: 'template' / 'unavailable' are unreachable
  -- values until the Twilio production sender exists. NULL = not attempted.
  nudge_outcome        TEXT CHECK (nudge_outcome IN (
                          'free_form', 'template', 'unavailable', 'failed'
                        )),
  -- At-least-once write safety for the escalation sweep — see header note.
  UNIQUE (project_id, engineer_id, log_date, half),
  -- Composite same-tenant FKs — REFERENTIAL INTEGRITY #3. Parent UNIQUE
  -- (id, tenant_id) indexes already exist (017: projects_id_tenant_id_key,
  -- users_id_tenant_id_key) — nothing to add on the parent side.
  CONSTRAINT checkin_escalations_project_id_fkey
    FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT checkin_escalations_engineer_id_fkey
    FOREIGN KEY (engineer_id, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  -- Lifecycle CHECK constraints — non-blocking finding #4. Each status that
  -- implies a transition happened requires that transition's own timestamp;
  -- see the header note for why this is the same principle as the
  -- nudge_outcome collapse, applied one column over.
  CONSTRAINT checkin_escalations_nudged_requires_timestamp
    CHECK (status <> 'nudged' OR nudge_sent_at IS NOT NULL),
  CONSTRAINT checkin_escalations_escalated_requires_timestamp
    CHECK (status <> 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT checkin_escalations_submitted_requires_timestamp
    CHECK (status <> 'submitted' OR resolved_at IS NOT NULL)
);

COMMENT ON TABLE public.checkin_escalations IS
  'One row per (project, engineer, log_date, half) tracking that half''s '
  'nudge/escalation lifecycle: awaited -> nudged -> escalated -> submitted / '
  'not_submitted. Roster comes from project_members, never daily_logs (see '
  'lib/dpr/accountability.ts header for why). Written only by the escalation '
  'sweep job (not yet built) via service_role, upserting on the UNIQUE key to '
  'stay correct under at-least-once job retries. Read by the DASH-01 '
  'exceptions surface (docs/bot-flows.md), gated to pm/admin roles only — see '
  'the RLS policy''s own comment for why.';

COMMENT ON COLUMN public.checkin_escalations.updated_at IS
  'Set explicitly by the escalation sweep job on every write — NOT trigger-'
  'maintained (no updated_at trigger exists anywhere in this project). '
  'Mirrors whatsapp_sessions.updated_at''s "SESSION WRITE — ALWAYS" '
  'convention. A row where this lags created_at despite a real status '
  'change is a bug in that writer, not expected behaviour.';

COMMENT ON COLUMN public.checkin_escalations.nudge_outcome IS
  'Which send path was actually used for the most recent attempt this half.'
  ' ''template'' and ''unavailable'' are UNREACHABLE until the Twilio '
  'production sender exists (CLAUDE.md §10) — the sandbox cannot send '
  'custom templates at all. NULL means no send has been attempted yet; '
  'distinct from ''failed'', which means an attempt was made and did not '
  'succeed. Kept separate from `status` deliberately — status is the '
  'escalation LIFECYCLE, this is the send-path OUTCOME, and collapsing '
  'them (or splitting outcome across independent booleans, as an earlier '
  'draft of this migration did) makes contradictory states representable. '
  'See this migration''s header for the fuller reasoning.';

-- Serves the DASH-01 exceptions surface's actual query shape (project +
-- date). idx_checkin_escalations_engineer (engineer_id, log_date) was in
-- the first draft of this migration and is DROPPED here, not shipped: no
-- query in this codebase or in bot-flows.md's DASH-01/escalation-sweep
-- spec is keyed by engineer_id first. The only candidate use (a future
-- per-engineer 7-day pattern view) is speculative — not built, not
-- specified — and migration 021 exists specifically because this project
-- shipped a redundant index once already and had to clean it up later. Add
-- it back with a real query to justify it, not ahead of one.
CREATE INDEX idx_checkin_escalations_project_date
  ON public.checkin_escalations (project_id, log_date);

-- -----------------------------------------------------------------------------
-- 2. RLS: SELECT only, project_members-scoped AND role-gated to management
--    roles (pm, admin) — see "RLS — ROLE GATE" in the header for the full
--    reasoning (external review, 2026-08-13). No authenticated/anon write
--    policy exists; the only writer is the escalation sweep job via
--    service_role, which bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.checkin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkin_escalations_select" ON public.checkin_escalations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      -- ONE users lookup (auth.uid() -> id AND role together), then a
      -- single join against project_members on that resolved id — not a
      -- second subquery for role on top of a first for id. See the
      -- PERFORMANCE note in the header.
      SELECT 1
      FROM public.users u
      JOIN public.project_members pm
        ON pm.project_id = checkin_escalations.project_id
       AND pm.user_id = u.id
      WHERE u.auth_id = auth.uid()
        -- Management roles only. 'qs' deliberately excluded — Aravind's
        -- decision: a quantity surveyor deals with measurement and
        -- valuation, not attendance. 'engineer'/'owner'/'subcontractor'
        -- excluded because this is internal-management data neither
        -- audience has a product reason to read (see FORWARD RATIONALE in
        -- the header) — not because project_members.role happens to say
        -- something else; that column is NOT consulted here at all, on
        -- purpose, since the old bug was trusting project_members.role's
        -- absence-of-filtering, not its presence.
        AND u.role IN ('pm', 'admin')
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM anon;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.checkin_escalations;  -- drops its policy,
--     indexes, CHECK constraints, and composite FKs — nothing else was
--     altered (unlike 017, this migration never touches projects/users).
-- COMMIT;
-- =============================================================================
