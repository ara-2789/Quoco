-- =============================================================================
-- 031_outbound_send_ledger.sql
-- The outbound WhatsApp send primitive's idempotency/tracking table
-- (docs/outbound-send-primitive-plan.md §3d) — the send ledger B2 (round 1)
-- and C2's `unreachable` derivation both read.
--
-- RELOCATED (2026-08-20, SS2c): moved from supabase/migrations/ to here.
-- A file sitting unapplied, on no ledger, in the scanned migrations
-- directory is a live hazard on ANY branch that has it checked out — a
-- stray `supabase db push` would apply it. Holding it off `main` alone does
-- not protect a branch that still has it in the scanned path. Standing
-- convention, CLAUDE.md's Database section: a migration file enters
-- supabase/migrations/ when it is BEING APPLIED, not when it is written —
-- until then it lives here, alongside its review package. Same rule,
-- applied here the way it was already applied to 030
-- (docs/reviews/030_owner_email_delivery.sql, BB2) — this file had sat in
-- the scanned directory for the length of this session's II3/JJ/KK/LL/QQ
-- rounds without being caught, exactly the hazard the rule exists to close
-- before anyone works this branch again.
--
-- STATUS: WRITTEN, NOT TO BE APPLIED YET. BLOCKED on the trigger-cron
-- workstream (no cron exists yet to call the sender this table supports —
-- §S's own finding) and on B3's cross-flow RPC fix landing first (both
-- named dependencies in the plan, unchanged by this file). Written now so
-- the review package is complete.
--
-- CLAUDE.md §0 GATING ASSESSMENT — carried over from the plan's own §3g,
-- verbatim, not re-derived:
--   (a) Does NOT trip for this table in isolation (a plain INSERT/UPDATE
--       table, no new Postgres function here) — DOES trip for the
--       workstream as a whole via B3's RPC change, which is its own,
--       separate migration, reviewed on its own terms when it ships.
--   (b) TRIPS. A new table with wrong RLS/grants from day one is at least
--       as dangerous as a bad change to an existing one (§0's own text).
--   (c) Judgment call, recorded: touches WhatsApp reachability and
--       phone-number identity, not web-auth identity. Reading: does not
--       trip, but the adjacency is real enough to name.
--   (d) TRIPS. A delivered WhatsApp message cannot be unsent.
--   (e) TRIPS. Every template send this table tracks is billed (§3g's own
--       economics finding, A2 — 4 templates + ~10 service replies/engineer/
--       day, PER_MESSAGE_RATE_INR still an open, named variable).
--   NET: (b), (d), (e) trip on this table alone; (a) trips for the
--   workstream via B3. Full external-review package required — this IS
--   that package (docs/reviews/031-outbound-send-ledger-review-package.md).
-- =============================================================================

BEGIN;

CREATE TABLE public.outbound_sends (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id         UUID NOT NULL,
  project_id        UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  event_key         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN (
      'sending', 'sent', 'failed',
      'skipped_no_template', 'skipped_already_submitted'
    )),
  twilio_sid        TEXT NULL,
  error             TEXT NULL,
  -- A3 (external review): Meta's raw per-message pricing object, logged in
  -- full from the status-callback route (§3e/B4) from day one — the
  -- empirical ground truth for whether/how a message was billed, not
  -- reasoned from a rate card alone.
  pricing           JSONB NULL,
  UNIQUE (tenant_id, recipient_user_id, event_key),
  -- Composite same-tenant FKs, 017's pattern, mirroring checkin_escalations'
  -- (027) shape exactly.
  CONSTRAINT outbound_sends_project_id_fkey
    FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT outbound_sends_recipient_user_id_fkey
    FOREIGN KEY (recipient_user_id, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX idx_outbound_sends_recipient
  ON public.outbound_sends (recipient_user_id, created_at DESC);
CREATE INDEX idx_outbound_sends_project_date
  ON public.outbound_sends (project_id, created_at);

ALTER TABLE public.outbound_sends ENABLE ROW LEVEL SECURITY;

-- RLS, mirroring checkin_escalations_select (027) exactly — project_members
-- join, pm/admin only, 'qs' deliberately excluded (same precedent).
CREATE POLICY "outbound_sends_select" ON public.outbound_sends
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.project_members pm
        ON pm.project_id = outbound_sends.project_id
       AND pm.user_id = u.id
      WHERE u.auth_id = auth.uid()
        AND u.role IN ('pm', 'admin')
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.outbound_sends FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.outbound_sends FROM anon;
REVOKE ALL ON public.outbound_sends FROM anon;
-- Written ONLY by the send primitive itself (service_role) — claim-before-
-- send (3d), then updated to 'sent'/'failed' after the Twilio call, then
-- again by the status-callback route (B4) as async status resolves. No
-- authenticated write path exists or is needed.

COMMENT ON TABLE public.outbound_sends IS
  'Idempotency + outcome ledger for the outbound WhatsApp send primitive '
  '(docs/outbound-send-primitive-plan.md §3d). Claim-before-Twilio-call: a '
  'row is INSERTed as ''sending'' before the Twilio API call, then updated to '
  'its real outcome. UNIQUE(tenant_id, recipient_user_id, event_key) is the '
  'idempotency key — event_key encodes checkpoint+IST-calendar-date (e.g. '
  '''morning_send:2026-08-19''), never UTC (A4). '
  'C2 SKIP-ROW TRANSPARENCY (external review, C2 sharpening): the derived '
  '`unreachable` read (3e, B2 round 1) treats any NON-''failed'' row as '
  'chain-breaking evidence of reachability by default — but the two skip '
  'outcomes carry DIFFERENT evidence and must not be treated identically by '
  'the computeUnreachable() helper. skipped_already_submitted implies '
  'recent inbound activity (the engineer already answered via another '
  'checkpoint) — genuinely chain-breaking, correctly resets the consecutive-'
  'failure count. skipped_no_template implies NOTHING about reachability — '
  'no send was attempted at all, so it is TRANSPARENT: excluded from the '
  'consecutive-failure sequence entirely, neither breaking it nor extending '
  'it. Concretely: the sequence failed, skipped_no_template, failed, failed '
  'must read as 3 consecutive failures (skipped_no_template is skipped over, '
  'not counted), not as reachable-because-something-non-failed-appeared. '
  'computeUnreachable() MUST implement this distinction, not treat all non-'
  '''failed'' rows as equivalent.';

COMMIT;
