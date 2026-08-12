-- =============================================================================
-- 027_checkin_escalations.sql
-- ----------------------------------------------------------------------------
-- STATUS: WRITTEN ONLY. Not rehearsed on test-db, not applied anywhere, not
-- pushed. This file exists so docs/reviews/027-review-package.md can pin it
-- via `git show <sha>:path` (CLAUDE.md §0 provenance rule) BEFORE the
-- external review round runs — not after. Do NOT rehearse or apply this
-- migration until that review confirms the RLS design below. It trips the
-- external-review gate on two independent grounds (CLAUDE.md §0): a brand
-- new table has no prior safe state to fall back on ("CREATES OR MODIFIES...
-- a new table with wrong RLS from day one... is at least as dangerous as a
-- bad change to an existing one"), and RLS/grants are named explicitly as
-- trigger (b), the condition CLAUDE.md calls out by name after migration
-- 020's incident.
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
-- RLS SCOPING — DELIBERATELY MIRRORS dprs_select (023), FLAGGED FOR REVIEW,
-- NOT ASSERTED AS SETTLED. The policy below is SELECT-only,
-- project_members-scoped, tenant_id + EXISTS-over-project_members — byte-
-- for-byte the same shape as dprs_select. That shape was right for dprs
-- because a DPR is a single-project artifact (CLAUDE.md §4: "Owner DPR
-- content is strictly single-project scoped"). checkin_escalations is
-- different in one respect worth naming, not resolving here: it is
-- ACCOUNTABILITY data — who has and hasn't submitted — and a PM who sits on
-- multiple projects sees it project-by-project under this policy, same as
-- every other project-scoped table. Whether that is the right scope for
-- accountability data specifically (as opposed to, say, a tenant-wide
-- admin view across all of a PM's projects) is an open question put
-- directly to the reviewer in docs/reviews/027-review-package.md — this
-- migration takes the dprs_select shape as its starting point, not its
-- final answer.
--
-- RISK CLASS: additive (new table only, no existing object touched) but
-- NOT low-risk by CLAUDE.md §0's own subject-matter test — a new table
-- with RLS from day one is explicitly named as the case with no prior safe
-- state to fall back on, hence the external-review gate and the
-- WRITTEN-ONLY status above. Reversible without PITR if it ever needs
-- rolling back pre-apply (nothing else references this table yet).
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
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id),
  project_id           UUID NOT NULL REFERENCES public.projects(id),
  engineer_id          UUID NOT NULL REFERENCES public.users(id),
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
  UNIQUE (project_id, engineer_id, log_date, half)
);

COMMENT ON TABLE public.checkin_escalations IS
  'One row per (project, engineer, log_date, half) tracking that half''s '
  'nudge/escalation lifecycle: awaited -> nudged -> escalated -> submitted / '
  'not_submitted. Roster comes from project_members, never daily_logs (see '
  'lib/dpr/accountability.ts header for why). Written only by the escalation '
  'sweep job (not yet built) via service_role, upserting on the UNIQUE key to '
  'stay correct under at-least-once job retries. Read by the DASH-01 '
  'exceptions surface (docs/bot-flows.md).';

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
-- 2. RLS: SELECT only, project_members-scoped — mirrors dprs_select (023).
--    See the RLS SCOPING header note above: this shape is a starting point
--    for review, not asserted as final for accountability data specifically.
--    No authenticated/anon write policy exists; the only writer is the
--    escalation sweep job via service_role, which bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.checkin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkin_escalations_select" ON public.checkin_escalations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = checkin_escalations.project_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM anon;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.checkin_escalations;  -- drops its policy + indexes
-- COMMIT;
-- =============================================================================
