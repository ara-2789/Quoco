-- supabase/migrations/050_material_inward_functions.sql  (HELD in docs/reviews/ -- NOT APPLIED to any database)
--
-- Slice 1a, PR-B: the material-inward functions and the N2 / N13 hunks in the two live
-- check-in functions. Source of truth: docs/plans/pr-b-050-plan.md rev 6 (cleared for SQL by
-- external review round 2, 18 Oct 2026; review text in docs/reviews/050-plan-review-round-1.md
-- and 050-plan-review-round-2.md).
--
-- TIER: FULL. EXTERNAL-REVIEW TRIGGERS TRIPPED (CLAUDE.md section 0): (a) new and modified live
-- function logic; (b) new SECURITY DEFINER functions and their grants; (c) the five pm_* functions
-- decide who may act on tenant data. NOT applied, NOT rehearsed: this is the first draft, written
-- and syntax-checked only. No user-facing string appears in this file: codes and outcome names only.
--
-- CONTENTS
--   1. seven NEW functions (plain CREATE FUNCTION, never CREATE OR REPLACE: a same-name function
--      must abort the migration, not be silently replaced -- 049 precedent):
--        apply_material_inward_turn   service_role only
--        expire_stale_material_inward service_role only
--        pm_set_delivery_details, pm_approve_delivery, pm_reject_delivery,
--        pm_link_invoice, pm_unlink_invoice   authenticated only (048 pattern; D-4)
--   2. two LIVE functions replaced: apply_morning_flow_turn (038) and apply_evening_flow_turn (040).
--      Each body is the LIVE pg_get_functiondef text of test-db captured 18 Oct (md5 707c10fe...
--      and d19d0750..., equal to probe 1) plus EXACTLY FOUR hunks, marked "050 hunk (n)":
--        (0) DECLARE lines for the two new variables
--        (1) the N2 branch (an 'invoice' session discarded by a scheduled start) + sets the N13 flag
--        (2) the first-message guard: a NEW ELSIF arm before the step-1 arm; no existing line moves
--        (3) the two new return keys capture_discarded and capture_deferred
--      Proof: docs/reviews/050-hunk-diff-testdb.txt (diff -u against the captured live text).
--      Signatures are unchanged (12 and 10 arguments), so CREATE OR REPLACE really replaces.
--   3. grants, and an in-file assertion block (N3) that aborts the whole UP on any surprise.
--
-- LIVE-BODY BASELINES (rule 10, function-redefinition-requires-capture). Captured read-only from test-db
-- (ref exfccwlrhoutkgrlikod) on 18 Oct 2026 with SELECT md5(pg_get_functiondef(p.oid)) ... FROM pg_proc,
-- the full text saved outside the repo; equal to probe 1. The PROD baselines are captured and pinned just
-- before the apply (plan sections 12 and 13); none exists yet.
--   body_md5 (pre-050): 707c10fe09dfd5a7cd065f7826eacd46  apply_morning_flow_turn  (sha256 of the saved text 69ae1b5cb73e9a1b2830b7524d853db2e48d91d4bc8030f1233e31edab2cebe5)
--   body_md5 (pre-050): d19d07507abccdaf7d54ee1d74419af7  apply_evening_flow_turn  (sha256 of the saved text 30979c8f4d8745e63184079cefedfd74b2cc2d54455b9e679578a4e9327c18a4)
--
-- NO CHECK CHANGE: the stored current_flow value is 'invoice', already allowed by
-- whatsapp_sessions_current_flow_check (001:92; D-1).
--
-- DECISIONS applied in this revision (Aravind, 18 Oct): the block 9 proposals are approved as listed in the
-- block 9 report, with these changes: the S3 ack parser also accepts a trailing '.' or ')' and the keycap forms;
-- pm_approve_delivery with no type raises QE016 'E16'; pm_reject_delivery with a blank reason raises QE017 'E17'.
-- QE011 stays for real transition refusals (approving or rejecting from a status that does not allow it, linking
-- while the automatic delivery is approved). Nothing in this file is left awaiting approval. Still contracts with
-- PR-C, to be confirmed there: the capture_ingest job payload and the outcome names.
--
-- SQL REVIEW ROUND 1 (docs/reviews/050-sql-review-round-1.md, verbatim; applied 19 Oct, marked [SQL review r1, per Aravind 18 Oct]):
-- S-1 engineer project-membership check (QE012); S-2 the DOWN deletes the 050 ledger row; N-1 S1 and S3 share one
-- normalisation; N-2 ROW_COUNT = 1 on the document UPDATEs; N-3 pm_set_delivery_details refuses a rejected delivery;
-- N-4 reject_reason capped at 1000 characters; N-5 the ACL comment reworded. S-3 is a PR-C condition (plan section 10).
--
-- LOCK ORDER (plan section 4; 049 header "THE SIX PR-B LOCK PATHS"): session row; then the invoice
-- capture_documents row FOR NO KEY UPDATE; then deliveries ascending id (DC delivery FOR SHARE on
-- link paths, automatic delivery FOR NO KEY UPDATE); then links. Authorisation happens BEFORE any
-- of these locks, with unlocked reads of project_id / tenant_id, which are immutable (TR4a, TR5),
-- so a refused caller never waits on a row and never learns whether an id exists (S1).
--
-- DOWN: see the commented block at the end. It points to docs/reviews/050-down-testdb.sql (written; dry-run on the
-- local scaffold, sha256 in docs/reviews/050-sql-evidence/SHA256.txt) and docs/reviews/050-down-prod.sql (built from the
-- prod-captured bodies just before the apply; does not exist yet).

BEGIN;

-- =============================================================================
-- 1a. apply_material_inward_turn  (engineer side; service_role only)
-- =============================================================================
CREATE FUNCTION public.apply_material_inward_turn(
  p_phone_number  text,
  p_tenant_id     uuid,
  p_user_id       uuid,
  p_project_id    uuid,
  p_message       text,
  p_message_sid   text,
  p_media         jsonb       DEFAULT NULL,
  p_start_flow    boolean     DEFAULT false,
  p_now           timestamptz DEFAULT now(),
  p_test_sleep_ms integer     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_session       public.whatsapp_sessions;
  v_text          text;
  v_outcome       text;
  v_touch         boolean := false;   -- true once the session row is to be persisted (a processed turn)
  v_media_n       integer := 0;
  v_kind          text;
  v_doc_id        uuid;
  v_delivery_id   uuid;
  v_reask         integer;
  v_ack           text;
  v_norm          text;     -- [SQL review r1, per Aravind 18 Oct] N-1: ONE normalised reply, used by BOTH the S1 kind parser and the S3 ack parser
  v_rows          integer;  -- [SQL review r1, per Aravind 18 Oct] N-2
  v_note          text;
  v_create        boolean := false;
  v_attach        boolean := false;
  v_received      timestamptz;
  v_next_file_no  integer;
  v_files         jsonb;
  -- The flow-owned context keys (decided 18 Oct).
  c_mi_keys CONSTANT text[] := ARRAY['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask'];
BEGIN
  -- Input shape. A SID is mandatory: it is both the duplicate key and the received_at key (Q2-6).
  IF p_message_sid IS NULL OR btrim(p_message_sid) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';       -- malformed call
  END IF;
  IF p_media IS NOT NULL AND jsonb_typeof(p_media) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
  END IF;
  v_media_n := CASE WHEN p_media IS NULL THEN 0 ELSE jsonb_array_length(p_media) END;
  v_text    := btrim(COALESCE(p_message, ''));

  -- Session row: same insert-or-lock pattern as the live check-in functions (038/040).
  INSERT INTO public.whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);

  -- SID idempotency (D-5, review r1 S5; second line of defence after the webhook's processed_messages
  -- check). A SID already handled -- the last one this flow processed, or one that already owns a
  -- document or file row -- writes nothing and returns 'duplicate'. Runs under the session lock,
  -- BEFORE the expiry and IST-day checks (a duplicate must not re-clear a session).
  IF (v_session.context ->> 'mi_last_sid') = p_message_sid
     OR EXISTS (SELECT 1 FROM public.capture_documents d WHERE d.source_message_sid = p_message_sid)
     OR EXISTS (SELECT 1 FROM public.capture_files f WHERE f.source_message_sid = p_message_sid) THEN
    RETURN jsonb_build_object(
      'outcome',      'duplicate',
      'current_flow', v_session.current_flow,
      'current_step', v_session.current_step
    );
  END IF;

  -- IST-day rule first (v3 line 342): a session from a previous IST day is reset in memory.
  IF NOT public.quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  IF v_session.current_flow = 'invoice' AND v_session.expires_at <= p_now THEN
    -- A27: 30 idle minutes end the flow. The clear is subtract-only and is the ONLY write; the
    -- caller replies via the idle path. expires_at / updated_at are deliberately not touched.
    UPDATE public.whatsapp_sessions
       SET current_flow = NULL,
           current_step = 0,
           context      = v_session.context - c_mi_keys
     WHERE id = v_session.id;
    RETURN jsonb_build_object('outcome', 'expired', 'current_flow', NULL, 'current_step', 0);

  ELSIF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'invoice';
      v_session.current_step := 1;
      v_session.context      := v_session.context - c_mi_keys;
      v_outcome := 'start';
      v_touch   := true;
    ELSIF v_session.current_flow = 'invoice' THEN
      v_outcome := 'reask';
      v_touch   := true;
    ELSE
      v_outcome := 'reask';          -- never create this flow over a live other-flow session
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    v_outcome := 'idle';

  ELSIF v_session.current_flow = 'invoice' THEN
    v_touch  := true;
    v_kind   := v_session.context ->> 'mi_kind';
    v_doc_id := NULLIF(v_session.context ->> 'mi_document_id', '')::uuid;
    v_reask  := COALESCE((v_session.context ->> 'mi_reask')::int, 0);
    -- [SQL review r1, per Aravind 18 Oct] N-1: the shared normalisation (decided 18 Oct): strip the keycap marks, then ONE trailing '.' or ')'.
    v_norm   := btrim(regexp_replace(translate(v_text, E'\uFE0F\u20E3', ''), '[.)]$', ''));

    IF v_text = '' AND v_media_n = 0 THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- S1 kind parsing (decided 18 Oct): '1' / 'dc' / 'challan' = delivery challan; '2' / 'invoice' / 'bill'
      -- = invoice. A file at S1 is not an answer. One re-ask, then close with nothing recorded.
      IF v_media_n = 0 AND lower(v_norm) IN ('1', 'dc', 'challan') THEN
        v_session.current_step := 2;
        v_session.context      := v_session.context || jsonb_build_object('mi_kind', 'dc', 'mi_reask', 0);
        v_outcome := 'advance';
      ELSIF v_media_n = 0 AND lower(v_norm) IN ('2', 'invoice', 'bill') THEN
        v_session.current_step := 2;
        v_session.context      := v_session.context || jsonb_build_object('mi_kind', 'invoice', 'mi_reask', 0);
        v_outcome := 'advance';
      ELSIF v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('mi_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'mi_kind' - 'mi_document_id' - 'mi_reask';
        v_outcome := 'closed';
      END IF;

    ELSIF v_session.current_step = 2 THEN
      -- S2 file(s). Text without a file: one re-ask, then close with nothing recorded.
      IF v_media_n > 0 THEN
        v_create := true;
      ELSIF v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('mi_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'mi_kind' - 'mi_document_id' - 'mi_reask';
        v_outcome := 'closed';
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- S3 ack. A file attaches to the same document and the step stays (D-11): a file is never an answer.
      IF v_media_n > 0 THEN
        v_attach := true;
      ELSE
        -- S3: the ONE ack parser (review r1 S3; forms decided 18 Oct). Accepts 1 / 2 / 3, optionally followed by
        -- a single '.' or ')', and the keycap forms (digit + U+FE0F + U+20E3). Anything else is not an ack.
        v_ack := CASE v_norm WHEN '1' THEN 'yes' WHEN '2' THEN 'no' WHEN '3' THEN 'partial' ELSE NULL END;
        IF v_ack IS NULL AND v_reask < 1 THEN
          v_session.context := v_session.context || jsonb_build_object('mi_reask', v_reask + 1);
          v_outcome := 'reask';
        ELSE
          IF v_ack IS NULL THEN
            v_ack  := 'unclear';
            v_note := left(v_text, 1000);          -- the raw text is kept as the note (v3:91)
          END IF;
          -- The ack is ALWAYS stored on the document (B1).
          UPDATE public.capture_documents
             SET engineer_ack      = v_ack,
                 engineer_ack_note = v_note
           WHERE id = v_doc_id;
          -- [SQL review r1, per Aravind 18 Oct] N-2: exactly one document row must have been updated. If mi_document_id were ever missing,
          -- the UPDATE would touch 0 rows and the flow would still answer 'complete' with no ack stored.
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          IF v_rows <> 1 THEN
            RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
          END IF;
          -- The delivery moves to awaiting_pm ONLY WHERE its status is 'incomplete'; any other
          -- status is left alone (B1). Do NOT clear cancelled_* to force a move.
          UPDATE public.deliveries
             SET status = 'awaiting_pm'
           WHERE status = 'incomplete'
             AND (dc_document_id = v_doc_id OR created_from_invoice_id = v_doc_id);
          IF v_ack IN ('no', 'partial') THEN
            v_session.current_step := 4;
            v_session.context      := v_session.context || jsonb_build_object('mi_reask', 0);
            v_outcome := 'advance';
          ELSE
            -- 'yes' closes; 'unclear' CLOSES and never goes to S4 (the raw text is already the note;
            -- a second note would raise QE011 from TR5).
            v_session.current_flow := NULL;
            v_session.current_step := 0;
            v_session.context      := v_session.context - 'mi_kind' - 'mi_document_id' - 'mi_reask';
            v_outcome := 'complete';
          END IF;
        END IF;
      END IF;

    ELSIF v_session.current_step = 4 THEN
      -- S4 note. A file attaches and the step stays (D-11).
      IF v_media_n > 0 THEN
        v_attach := true;
      ELSE
        UPDATE public.capture_documents
           SET engineer_ack_note = left(v_text, 1000)
         WHERE id = v_doc_id;
        -- N-2 applied to the note UPDATE too (same reasoning; the reviewer named the ack UPDATE): one row or QE012.
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
        END IF;
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'mi_kind' - 'mi_document_id' - 'mi_reask';
        v_outcome := 'complete';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  -- Rows for a file turn: S2 creates the document (+ delivery, + self-link for an invoice) and the
  -- file rows; S3 / S4 attach further files to the same document.
  IF v_create OR v_attach THEN
    IF v_create THEN
      -- [SQL review r1, per Aravind 18 Oct] S-1: the engineer must be a member of THIS project as an engineer. The composite FKs on
      -- sent_by / reported_by catch another TENANT's user; nothing else catches the right tenant with the wrong
      -- PROJECT. Refused with QE012 before anything is written.
      IF NOT EXISTS (SELECT 1 FROM public.project_members m
                      WHERE m.project_id = p_project_id AND m.user_id = p_user_id AND m.role = 'engineer') THEN
        RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
      END IF;
      -- Q2-6: ONE SID for both the received_at lookup and source_message_sid. A missing
      -- processed_messages row (or a NULL created_at) is refused.
      SELECT pm.created_at INTO v_received
        FROM public.processed_messages pm
       WHERE pm.message_sid = p_message_sid;
      IF v_received IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
      END IF;

      INSERT INTO public.capture_documents
        (tenant_id, project_id, kind, sent_by, source_message_sid, caption)
      VALUES
        (p_tenant_id, p_project_id, v_kind, p_user_id, p_message_sid, NULLIF(left(v_text, 1000), ''))
      RETURNING id INTO v_doc_id;

      IF v_kind = 'dc' THEN
        INSERT INTO public.deliveries
          (tenant_id, project_id, reported_by, received_at, dc_document_id)
        VALUES
          (p_tenant_id, p_project_id, p_user_id, v_received, v_doc_id)
        RETURNING id INTO v_delivery_id;
      ELSE
        -- A28: every invoice creates one automatic delivery and one active self-link, one transaction.
        INSERT INTO public.deliveries
          (tenant_id, project_id, reported_by, received_at, created_from_invoice_id)
        VALUES
          (p_tenant_id, p_project_id, p_user_id, v_received, v_doc_id)
        RETURNING id INTO v_delivery_id;
        INSERT INTO public.delivery_invoice_links
          (tenant_id, project_id, delivery_id, invoice_document_id, link_source)
        VALUES
          (p_tenant_id, p_project_id, v_delivery_id, v_doc_id, 'created_from_invoice');
      END IF;
      v_next_file_no := 1;
    ELSE
      SELECT COALESCE(max(f.file_no), 0) + 1 INTO v_next_file_no
        FROM public.capture_files f
       WHERE f.document_id = v_doc_id;
    END IF;

    INSERT INTO public.capture_files
      (tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type)
    SELECT p_tenant_id, p_project_id, v_doc_id,
           v_next_file_no + (t.ord::int - 1),
           p_message_sid,
           COALESCE((t.e ->> 'index')::int, t.ord::int - 1),
           t.e ->> 'content_type'
      FROM jsonb_array_elements(p_media) WITH ORDINALITY AS t(e, ord);

    -- The ingest job (payload: a contract with PR-C, plan section 14). jobs.type has no CHECK.
    SELECT jsonb_agg(
             jsonb_build_object(
               'file_id',              f.id,
               'file_no',              f.file_no,
               'media_index',          f.media_index,
               'claimed_content_type', f.claimed_content_type,
               'url',                  m.e ->> 'url')
             ORDER BY f.file_no)
      INTO v_files
      FROM public.capture_files f
      JOIN (SELECT e, COALESCE((e ->> 'index')::int, ord::int - 1) AS idx
              FROM jsonb_array_elements(p_media) WITH ORDINALITY AS t(e, ord)) m
        ON m.idx = f.media_index
     WHERE f.source_message_sid = p_message_sid;

    INSERT INTO public.jobs (type, payload)
    VALUES ('capture_ingest',
            jsonb_build_object(
              'tenant_id',          p_tenant_id,
              'project_id',         p_project_id,
              'document_id',        v_doc_id,
              'source_message_sid', p_message_sid,
              'files',              v_files));

    IF v_create THEN
      v_session.current_step := 3;
      v_session.context      := v_session.context || jsonb_build_object('mi_document_id', v_doc_id::text, 'mi_reask', 0);
      v_outcome := 'advance';
    ELSE
      v_outcome := 'file_attached';
    END IF;
  END IF;

  -- Persist a processed turn: N8 (every processed turn, including 'reask', writes expires_at and
  -- updated_at) and the last processed SID for the text-turn duplicate check.
  IF v_touch THEN
    v_session.context := v_session.context || jsonb_build_object('mi_last_sid', p_message_sid);
    UPDATE public.whatsapp_sessions
       SET current_flow  = v_session.current_flow,
           current_step  = v_session.current_step,
           context       = v_session.context,
           pending_flows = v_session.pending_flows,
           tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
           user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
           expires_at    = p_now + INTERVAL '30 minutes',
           updated_at    = p_now
     WHERE id = v_session.id
    RETURNING * INTO v_session;
  END IF;

  RETURN jsonb_build_object(
    'outcome',      v_outcome,
    'current_flow', v_session.current_flow,
    'current_step', v_session.current_step,
    'document_id',  v_doc_id,
    'delivery_id',  v_delivery_id
  );
END;
$fn$;

-- =============================================================================
-- 1b. expire_stale_material_inward  (router side; service_role only)
-- =============================================================================
CREATE FUNCTION public.expire_stale_material_inward(
  p_phone_number text,
  p_now          timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_session public.whatsapp_sessions;
BEGIN
  SELECT s.* INTO v_session
    FROM public.whatsapp_sessions s
   WHERE s.phone_number = p_phone_number
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Only an expired 'invoice' row; morning, evening and hindrance rows are never touched (T-A27-7).
  -- Re-checked under the lock, so a late turn racing this call is safe. The clear is subtract-only
  -- and the only write: expires_at / updated_at are not touched.
  IF v_session.current_flow = 'invoice' AND v_session.expires_at <= p_now THEN
    UPDATE public.whatsapp_sessions
       SET current_flow = NULL,
           current_step = 0,
           context      = COALESCE(v_session.context, '{}'::jsonb)
                          - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask'
     WHERE id = v_session.id;
    RETURN true;
  END IF;
  RETURN false;
END;
$fn$;

-- =============================================================================
-- 1c. pm_set_delivery_details  (PM side; authenticated only)
--     Full overwrite: a NULL argument clears that field (decided 18 Oct).
-- =============================================================================
CREATE FUNCTION public.pm_set_delivery_details(
  p_delivery_id   uuid,
  p_delivery_type text,
  p_vehicle_number text,
  p_dc_number     text,
  p_dc_date       date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project  uuid;
  v_tenant   uuid;
  v_auto_inv uuid;
  v_caller   uuid;
  v_status   text;   -- [SQL review r1, per Aravind 18 Oct] N-3
BEGIN
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- S1: unlocked read of the immutable project_id / tenant_id, authorise, refuse with QE015, then lock.
  SELECT d.project_id, d.tenant_id, d.created_from_invoice_id
    INTO v_project, v_tenant, v_auto_inv
    FROM public.deliveries d
   WHERE d.id = p_delivery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- B2: 049's D-20 audience. Active user found by auth_id = auth.uid(), same tenant, and a
  -- project_members row with role = 'pm' on the row's OWN project. Admins count only as PM members.
  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id   = auth.uid()
     AND u.status    = 'active'
     AND u.tenant_id = v_tenant
     AND m.project_id = v_project
     AND m.role      = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Path 6: a DC delivery updates its own row only; an automatic delivery locks the invoice first.
  IF v_auto_inv IS NOT NULL THEN
    PERFORM 1 FROM public.capture_documents d WHERE d.id = v_auto_inv FOR NO KEY UPDATE;
  END IF;

  -- [SQL review r1, per Aravind 18 Oct] N-3: a REJECTED delivery is final (nothing leaves 'rejected'); its type and DC number must not be
  -- rewritten after the fact. D-23 locks content only while approved / cancelled, so this is the function's rule.
  SELECT d.status INTO v_status
    FROM public.deliveries d
   WHERE d.id = p_delivery_id
     FOR NO KEY UPDATE;
  IF v_status = 'rejected' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
  END IF;

  -- The 049 triggers raise QE006 (retype with an active link), QE007 (automatic delivery to
  -- internal transfer), QE011 (locked content while approved or cancelled).
  UPDATE public.deliveries
     SET delivery_type  = p_delivery_type,
         vehicle_number = p_vehicle_number,
         dc_number      = p_dc_number,
         dc_date        = p_dc_date
   WHERE id = p_delivery_id;

  RETURN jsonb_build_object('delivery_id', p_delivery_id);
END;
$fn$;

-- =============================================================================
-- 1d. pm_approve_delivery  (PM side; authenticated only)
-- =============================================================================
CREATE FUNCTION public.pm_approve_delivery(p_delivery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project  uuid;
  v_tenant   uuid;
  v_auto_inv uuid;
  v_caller   uuid;
  v_status   text;
  v_type     text;
BEGIN
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT d.project_id, d.tenant_id, d.created_from_invoice_id
    INTO v_project, v_tenant, v_auto_inv
    FROM public.deliveries d
   WHERE d.id = p_delivery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id   = auth.uid()
     AND u.status    = 'active'
     AND u.tenant_id = v_tenant
     AND m.project_id = v_project
     AND m.role      = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Path 5: DC delivery, update only; automatic delivery, lock the invoice first.
  IF v_auto_inv IS NOT NULL THEN
    PERFORM 1 FROM public.capture_documents d WHERE d.id = v_auto_inv FOR NO KEY UPDATE;
  END IF;

  SELECT d.status, d.delivery_type INTO v_status, v_type
    FROM public.deliveries d
   WHERE d.id = p_delivery_id
     FOR NO KEY UPDATE;

  -- D-10: the PM may approve 'incomplete' (not acknowledged) as well as 'awaiting_pm'.
  -- QE011: the delivery is in a status that cannot be approved (a real transition refusal).
  IF v_status NOT IN ('incomplete', 'awaiting_pm') THEN
    RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
  END IF;
  -- QE016 (decided 18 Oct): no delivery type set; the CHECK deliveries_approved_requires_chk would
  -- otherwise answer with 23514.
  IF v_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE016', MESSAGE = 'E16';
  END IF;

  -- approved_by is set here; approved_at is stamped by the database (TR4c, S-3).
  UPDATE public.deliveries
     SET status      = 'approved',
         approved_by = v_caller
   WHERE id = p_delivery_id;

  RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'approved');
END;
$fn$;

-- =============================================================================
-- 1e. pm_reject_delivery  (PM side; authenticated only)  Paths 3 and 4
-- =============================================================================
CREATE FUNCTION public.pm_reject_delivery(p_delivery_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project     uuid;
  v_tenant      uuid;
  v_auto_inv    uuid;
  v_caller      uuid;
  v_status      text;
  v_link_id     uuid;
  v_inv         uuid;
  v_auto_id     uuid;
  v_auto_status text;
  v_auto_cancel text;
  v_pm_links    integer;
  v_has_ack     boolean;
  v_restored    boolean := false;
  r             record;
BEGIN
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT d.project_id, d.tenant_id, d.created_from_invoice_id
    INTO v_project, v_tenant, v_auto_inv
    FROM public.deliveries d
   WHERE d.id = p_delivery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id   = auth.uid()
     AND u.status    = 'active'
     AND u.tenant_id = v_tenant
     AND m.project_id = v_project
     AND m.role      = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- A rejection needs a reason (CHECK deliveries_rejected_requires_chk). QE017 (decided 18 Oct).
  -- [SQL review r1, per Aravind 18 Oct] N-4: reject_reason is capped at 1000 characters here (049's other PM-typed text is capped at 64 / 1000; a CHECK
  -- cannot be added without touching 049).
  IF p_reason IS NULL OR btrim(p_reason) = '' OR char_length(p_reason) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'QE017', MESSAGE = 'E17';
  END IF;

  IF v_auto_inv IS NOT NULL THEN
    -- Path 3: an automatic delivery. Lock the invoice, then the delivery.
    PERFORM 1 FROM public.capture_documents d WHERE d.id = v_auto_inv FOR NO KEY UPDATE;
    SELECT d.status INTO v_status
      FROM public.deliveries d
     WHERE d.id = p_delivery_id
       FOR NO KEY UPDATE;
    IF v_status NOT IN ('incomplete', 'awaiting_pm') THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
    -- Soft-unlink its self-link FIRST (TR4c refuses a move to rejected while any link is active).
    UPDATE public.delivery_invoice_links
       SET unlinked_at = now(), unlinked_by = v_caller, unlink_reason = 'delivery_rejected'
     WHERE delivery_id = p_delivery_id AND unlinked_at IS NULL;
    UPDATE public.deliveries
       SET status = 'rejected', rejected_by = v_caller, reject_reason = p_reason
     WHERE id = p_delivery_id;

  ELSE
    -- Path 4: a DC delivery. Step 1: read its active link UNLOCKED, to learn the invoice.
    SELECT l.id, l.invoice_document_id INTO v_link_id, v_inv
      FROM public.delivery_invoice_links l
     WHERE l.delivery_id = p_delivery_id AND l.unlinked_at IS NULL;

    IF v_link_id IS NULL THEN
      -- No link seen: lock the delivery, then re-check that none appeared (S-C).
      SELECT d.status INTO v_status
        FROM public.deliveries d
       WHERE d.id = p_delivery_id
         FOR NO KEY UPDATE;
      IF EXISTS (SELECT 1 FROM public.delivery_invoice_links l
                  WHERE l.delivery_id = p_delivery_id AND l.unlinked_at IS NULL)
         OR v_status NOT IN ('incomplete', 'awaiting_pm') THEN
        RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
      END IF;
      UPDATE public.deliveries
         SET status = 'rejected', rejected_by = v_caller, reject_reason = p_reason
       WHERE id = p_delivery_id;

    ELSE
      -- Step 2: lock the invoice FIRST (Postgres cannot release a row lock mid-transaction).
      PERFORM 1 FROM public.capture_documents d WHERE d.id = v_inv FOR NO KEY UPDATE;
      SELECT d.id INTO v_auto_id FROM public.deliveries d WHERE d.created_from_invoice_id = v_inv;
      -- Step 3: lock the DC delivery and, if there is one, the automatic delivery, ascending id.
      FOR r IN
        SELECT x.id
          FROM unnest(ARRAY[p_delivery_id] || CASE WHEN v_auto_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_auto_id] END) AS x(id)
         GROUP BY x.id ORDER BY x.id
      LOOP
        PERFORM 1 FROM public.deliveries d WHERE d.id = r.id FOR NO KEY UPDATE;
      END LOOP;
      -- Step 4 (S-C re-read rule): if the active link no longer points at this invoice, stop.
      IF NOT EXISTS (SELECT 1 FROM public.delivery_invoice_links l
                      WHERE l.id = v_link_id AND l.unlinked_at IS NULL AND l.invoice_document_id = v_inv) THEN
        RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
      END IF;
      SELECT d.status INTO v_status FROM public.deliveries d WHERE d.id = p_delivery_id;
      IF v_status NOT IN ('incomplete', 'awaiting_pm') THEN
        RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
      END IF;
      -- Step 5: soft-unlink the link (TR3 forces the snapshot NULL for this reason).
      UPDATE public.delivery_invoice_links
         SET unlinked_at = now(), unlinked_by = v_caller, unlink_reason = 'delivery_rejected'
       WHERE id = v_link_id;
      -- Step 6: reject the DC delivery (TR4c passes: no active link).
      UPDATE public.deliveries
         SET status = 'rejected', rejected_by = v_caller, reject_reason = p_reason
       WHERE id = p_delivery_id;
      -- Step 7: the invoice's remaining active PM links (stable: every inserter / unlinker holds the invoice).
      SELECT count(*) INTO v_pm_links
        FROM public.delivery_invoice_links l
       WHERE l.invoice_document_id = v_inv AND l.link_source = 'pm_manual' AND l.unlinked_at IS NULL;
      -- Step 8: restore the automatic delivery if it was cancelled by supersession and no PM link remains.
      IF v_pm_links = 0 AND v_auto_id IS NOT NULL THEN
        SELECT d.status, d.cancel_reason INTO v_auto_status, v_auto_cancel
          FROM public.deliveries d WHERE d.id = v_auto_id;
        IF v_auto_status = 'cancelled' AND v_auto_cancel = 'superseded_by_link' THEN
          SELECT (c.engineer_ack IS NOT NULL) INTO v_has_ack
            FROM public.capture_documents c WHERE c.id = v_inv;
          -- Restore FIRST (clearing cancelled_* and approved_*), THEN insert the new self-link.
          UPDATE public.deliveries
             SET status       = CASE WHEN v_has_ack THEN 'awaiting_pm' ELSE 'incomplete' END,
                 cancelled_at = NULL,
                 cancel_reason = NULL,
                 approved_by  = NULL,
                 approved_at  = NULL
           WHERE id = v_auto_id;
          INSERT INTO public.delivery_invoice_links
            (tenant_id, project_id, delivery_id, invoice_document_id, link_source)
          VALUES
            (v_tenant, v_project, v_auto_id, v_inv, 'created_from_invoice');
          v_restored := true;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'rejected', 'restored_automatic', v_restored);
END;
$fn$;

-- =============================================================================
-- 1f. pm_link_invoice  (PM side; authenticated only)  Path 1
-- =============================================================================
CREATE FUNCTION public.pm_link_invoice(p_invoice_document_id uuid, p_delivery_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project     uuid;
  v_tenant      uuid;
  v_kind        text;
  v_caller      uuid;
  v_cnt         integer;
  v_ids         uuid[];
  v_auto_id     uuid;
  v_auto_status text;
  v_self_id     uuid;
  v_target      uuid;
  v_linked      integer := 0;
  v_cname       text;
  r             record;
BEGIN
  -- S1 array conditions. Every failure is QE015 for the whole call and names no id.
  -- Array cap 20 (decided, block 9). Nothing is locked or written until every check has passed.
  IF p_invoice_document_id IS NULL OR p_delivery_ids IS NULL
     OR cardinality(p_delivery_ids) = 0 OR cardinality(p_delivery_ids) > 20 THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_delivery_ids) AS e WHERE e IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;
  SELECT count(DISTINCT e) INTO v_cnt FROM unnest(p_delivery_ids) AS e;
  IF v_cnt <> cardinality(p_delivery_ids) THEN              -- a duplicate id
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Unlocked read of the invoice's immutable project_id / tenant_id (TR5), then authorise.
  SELECT c.project_id, c.tenant_id, c.kind INTO v_project, v_tenant, v_kind
    FROM public.capture_documents c
   WHERE c.id = p_invoice_document_id;
  IF NOT FOUND OR v_kind IS DISTINCT FROM 'invoice' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id   = auth.uid()
     AND u.status    = 'active'
     AND u.tenant_id = v_tenant
     AND m.project_id = v_project
     AND m.role      = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Every delivery must belong to the INVOICE's project and tenant: one unlocked query, compared with
  -- the number of distinct ids (TR4a makes both columns immutable, so the answer cannot flip). Without
  -- this, a foreign id would surface later as an FK 23503 instead of QE015.
  SELECT count(*) INTO v_cnt
    FROM public.deliveries d
   WHERE d.id = ANY (p_delivery_ids)
     AND d.project_id = v_project
     AND d.tenant_id  = v_tenant;
  IF v_cnt <> cardinality(p_delivery_ids) THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT array_agg(e ORDER BY e) INTO v_ids FROM unnest(p_delivery_ids) AS e;   -- sorted for the locks

  -- Path 1 step 1: lock the invoice document FOR NO KEY UPDATE.
  PERFORM 1 FROM public.capture_documents c WHERE c.id = p_invoice_document_id FOR NO KEY UPDATE;

  -- The invoice's automatic delivery and active self-link (stable under the invoice lock).
  SELECT d.id INTO v_auto_id FROM public.deliveries d WHERE d.created_from_invoice_id = p_invoice_document_id;
  SELECT l.id INTO v_self_id
    FROM public.delivery_invoice_links l
   WHERE l.invoice_document_id = p_invoice_document_id
     AND l.link_source = 'created_from_invoice'
     AND l.unlinked_at IS NULL;

  -- Step 3: one ascending-id pass: each DC delivery FOR SHARE, the automatic delivery FOR NO KEY UPDATE.
  FOR r IN
    SELECT x.id
      FROM unnest(v_ids || CASE WHEN v_auto_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_auto_id] END) AS x(id)
     GROUP BY x.id ORDER BY x.id
  LOOP
    IF r.id = v_auto_id THEN
      PERFORM 1 FROM public.deliveries d WHERE d.id = r.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM public.deliveries d WHERE d.id = r.id FOR SHARE;
    END IF;
  END LOOP;

  -- X6 / D-9: linking while the automatic delivery is APPROVED is refused; nothing changes.
  -- QE011 (a real transition refusal).
  IF v_auto_id IS NOT NULL THEN
    SELECT d.status INTO v_auto_status FROM public.deliveries d WHERE d.id = v_auto_id;
    IF v_auto_status = 'approved' THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
  END IF;

  -- Steps 4-5: soft-unlink the self-link (TR3 snapshots the delivery), THEN cancel the automatic delivery.
  IF v_self_id IS NOT NULL THEN
    UPDATE public.delivery_invoice_links
       SET unlinked_at = now(), unlinked_by = v_caller, unlink_reason = 'superseded_by_link'
     WHERE id = v_self_id;
    UPDATE public.deliveries
       SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link'
     WHERE id = v_auto_id;
  END IF;

  -- Step 6: insert the pm_manual rows. The handler wraps ONLY this loop (review r1 S2): a caught error
  -- rolls back only the writes inside the block; the writes of steps 4-5 are OUTSIDE it and would
  -- COMMIT if the handler fell through. So the handler never falls through: it re-raises.
  BEGIN
    FOREACH v_target IN ARRAY v_ids LOOP
      INSERT INTO public.delivery_invoice_links
        (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by)
      VALUES
        (v_tenant, v_project, v_target, p_invoice_document_id, 'pm_manual', v_caller);
      v_linked := v_linked + 1;
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname = 'uq_dil_active_per_delivery' THEN
      RAISE EXCEPTION USING ERRCODE = 'QE008', MESSAGE = 'E8';
    END IF;
    RAISE;          -- every other 23505 is re-raised unchanged; never swallowed, never translated
  END;

  RETURN jsonb_build_object(
    'invoice_document_id',  p_invoice_document_id,
    'linked',               v_linked,
    'superseded_automatic', (v_self_id IS NOT NULL)
  );
END;
$fn$;

-- =============================================================================
-- 1g. pm_unlink_invoice  (PM side; authenticated only)  Path 2
-- =============================================================================
CREATE FUNCTION public.pm_unlink_invoice(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project     uuid;
  v_tenant      uuid;
  v_inv         uuid;
  v_delivery    uuid;
  v_source      text;
  v_caller      uuid;
  v_unlinked    timestamptz;
  v_auto_id     uuid;
  v_auto_status text;
  v_auto_cancel text;
  v_pm_links    integer;
  v_has_ack     boolean;
  v_restored    boolean := false;
  r             record;
BEGIN
  IF p_link_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Path 2 step 1: read the link UNLOCKED (TR3 makes its identity columns immutable), authorise.
  SELECT l.project_id, l.tenant_id, l.invoice_document_id, l.delivery_id, l.link_source
    INTO v_project, v_tenant, v_inv, v_delivery, v_source
    FROM public.delivery_invoice_links l
   WHERE l.id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id   = auth.uid()
     AND u.status    = 'active'
     AND u.tenant_id = v_tenant
     AND m.project_id = v_project
     AND m.role      = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- The automatic self-link is never unlinked by a PM (TR3 / dil_pm_unlinked_scope_chk).
  IF v_source IS DISTINCT FROM 'pm_manual' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
  END IF;

  -- Lock the invoice, re-read the link under the lock, refuse if it is no longer active.
  PERFORM 1 FROM public.capture_documents c WHERE c.id = v_inv FOR NO KEY UPDATE;
  SELECT l.unlinked_at INTO v_unlinked FROM public.delivery_invoice_links l WHERE l.id = p_link_id;
  IF v_unlinked IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
  END IF;

  -- Step 2: the DC delivery FOR SHARE and, if present, the automatic delivery FOR NO KEY UPDATE, ascending id.
  SELECT d.id INTO v_auto_id FROM public.deliveries d WHERE d.created_from_invoice_id = v_inv;
  FOR r IN
    SELECT x.id
      FROM unnest(ARRAY[v_delivery] || CASE WHEN v_auto_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_auto_id] END) AS x(id)
     GROUP BY x.id ORDER BY x.id
  LOOP
    IF r.id = v_auto_id THEN
      PERFORM 1 FROM public.deliveries d WHERE d.id = r.id FOR NO KEY UPDATE;
    ELSE
      PERFORM 1 FROM public.deliveries d WHERE d.id = r.id FOR SHARE;
    END IF;
  END LOOP;

  -- Step 3: soft-unlink the PM link.
  UPDATE public.delivery_invoice_links
     SET unlinked_at = now(), unlinked_by = v_caller, unlink_reason = 'pm_unlinked'
   WHERE id = p_link_id;

  -- Step 4: zero active PM links left AND the automatic delivery cancelled by supersession -> restore it
  -- FIRST (incomplete or awaiting_pm from the ack, clearing cancelled_* and approved_*), THEN insert the
  -- new self-link. Never the self-link first. A rejected automatic delivery is not restored.
  SELECT count(*) INTO v_pm_links
    FROM public.delivery_invoice_links l
   WHERE l.invoice_document_id = v_inv AND l.link_source = 'pm_manual' AND l.unlinked_at IS NULL;
  IF v_pm_links = 0 AND v_auto_id IS NOT NULL THEN
    SELECT d.status, d.cancel_reason INTO v_auto_status, v_auto_cancel
      FROM public.deliveries d WHERE d.id = v_auto_id;
    IF v_auto_status = 'cancelled' AND v_auto_cancel = 'superseded_by_link' THEN
      SELECT (c.engineer_ack IS NOT NULL) INTO v_has_ack
        FROM public.capture_documents c WHERE c.id = v_inv;
      UPDATE public.deliveries
         SET status        = CASE WHEN v_has_ack THEN 'awaiting_pm' ELSE 'incomplete' END,
             cancelled_at  = NULL,
             cancel_reason = NULL,
             approved_by   = NULL,
             approved_at   = NULL
       WHERE id = v_auto_id;
      INSERT INTO public.delivery_invoice_links
        (tenant_id, project_id, delivery_id, invoice_document_id, link_source)
      VALUES
        (v_tenant, v_project, v_auto_id, v_inv, 'created_from_invoice');
      v_restored := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('link_id', p_link_id, 'restored_automatic', v_restored);
END;
$fn$;

-- =============================================================================
-- 2a. apply_morning_flow_turn  (LIVE text + four hunks)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_morning_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_manpower jsonb DEFAULT NULL::jsonb, p_manpower_ok boolean DEFAULT NULL::boolean, p_equipment jsonb DEFAULT NULL::jsonb, p_equipment_ok boolean DEFAULT NULL::boolean, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session    whatsapp_sessions;
  v_text       TEXT;
  v_log_date   DATE;
  v_outcome    TEXT;
  v_col        TEXT := NULL;
  v_reask      INTEGER;
  v_attendance TEXT := NULL;
  v_yesno      JSONB;
  v_attendance_defaulted BOOLEAN := NULL;
  v_attendance_raw        TEXT    := NULL;
  -- S-set (a), discard observability (external review round 2): set only
  -- by the hindrance-collision branch below, NEVER elsewhere -- NULL (not
  -- false) on every other outcome, so the caller can tell "this branch
  -- didn't fire" from "it fired and found nothing to discard."
  v_hindrance_discarded      BOOLEAN := NULL;
  v_hindrance_had_description BOOLEAN := NULL;
  -- 050 hunk (0): variables for the N2 branch and the N13 deferral (plan section 6).
  v_capture_discarded         BOOLEAN := NULL;
  v_capture_deferred          BOOLEAN := NULL;
BEGIN
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask';
      v_outcome := 'start';
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- NEW BRANCH, migration 038 -- REVISED after external review round 2
      -- (B1, BLOCKING): the original force-reset used a bare context wipe
      -- (context := '{}'::jsonb), which silently destroyed
      -- morning_submitted whenever an engineer completed morning, then
      -- started (and abandoned) a hindrance report the same day. A
      -- scheduled trigger firing into that live hindrance session would
      -- restart morning for an ALREADY-SUBMITTED engineer, and his next
      -- reply would overwrite the day's real attendance via the very same
      -- ON CONFLICT upsert that recorded it in the first place --
      -- reproduced exactly by Scenario 5 (docs/reviews/038-hindrance-flow-
      -- review-package.md), RED against the original branch, GREEN here.
      --
      -- TWO-CLAUSE FIX: check the flow's own submitted marker BEFORE
      -- choosing an outcome.
      --   Already submitted -> the scheduled trigger's job here is
      --   already done; morning is not "stale," it's complete. Clear the
      --   hindrance session (subtract-only -- q2_reask/description are
      --   hindrance's own leftover state, nothing left to do with them;
      --   morning_submitted and any other cross-flow marker survive by
      --   NOT being named, not because this branch specifically saved
      --   them) and return 'already_complete' -- the SAME outcome the
      --   idle branch already uses for this exact fact. Never re-run a
      --   completed flow.
      --   Genuinely unsubmitted -> scheduled triggers still win over a
      --   live ad-hoc flow, no age check, unchanged reasoning (see THE
      --   FIX in this file's own header for why "stale" overclaimed this).
      --   The wipe is now
      --   SUBTRACT-ONLY -- morning's own reask keys (matching the genuine
      --   fresh-start branch three lines above, same discipline) plus
      --   hindrance's own leftover keys -- never a bare replace, so any
      --   cross-flow marker survives by construction, not convention.
      v_hindrance_discarded       := true;
      v_hindrance_had_description := (v_session.context ? 'description');
      IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'q2_reask' - 'description';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'morning';
        v_session.current_step := 1;
        v_session.context      := v_session.context
                                    - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask'
                                    - 'q2_reask' - 'description';
        v_outcome := 'start';
      END IF;
    ELSIF v_session.current_flow = 'invoice' THEN
      -- 050 hunk (1): N2. A scheduled start over a live 'invoice' (material inward) session discards
      -- that session, subtract-only (flow-owned keys only; morning_submitted and every other cross-flow
      -- marker survive by NOT being named), and starts the check-in (outcome 'start'). The partial
      -- delivery rows are not in whatsapp_sessions and stay saved. The N13 flag records which
      -- check-in set it (value 'morning'); the first step-1 message afterwards is deferred
      -- by hunk (2). Mirrors the hindrance branch above; capture_discarded mirrors hindrance_discarded.
      v_capture_discarded := true;
      IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context
                                    - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'morning';
        v_session.current_step := 1;
        v_session.context      := (v_session.context
                                    - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask'
                                    - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask')
                                  || jsonb_build_object('invoice_reset_guard', 'morning');
        v_outcome := 'start';
      END IF;
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'morning' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1
          AND (v_session.context->>'invoice_reset_guard') = 'morning' THEN
      -- 050 hunk (2): N13, review r1 B3 option (a). The FIRST non-empty step-1 message after an
      -- 'invoice' discard is never taken as an answer, whatever it contains: nothing is written
      -- (no attendance, q1_reask not consumed), v_col stays NULL, the flag is cleared, and the reply
      -- builder sends one explanation-plus-question message (capture_deferred). The SECOND message
      -- is handled by the existing step-1 arm below, unchanged. A NEW arm: no existing line moves.
      v_session.context  := v_session.context - 'invoice_reset_guard';
      v_capture_deferred := true;
      v_outcome          := 'reask';

    ELSIF v_session.current_step = 1 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q1_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q1_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSIF COALESCE((v_yesno->>'ok')::boolean, false) AND NOT (v_yesno->>'met')::boolean THEN
        v_session.current_step := 5;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_outcome := 'advance';
      ELSE
        v_session.current_step := 2;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_attendance := 'present';
        v_col        := 'attendance';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome    := 'advance';
      END IF;

    ELSIF v_session.current_step = 2 THEN
      v_session.current_step := 3;
      v_outcome := 'advance';
      v_col     := 'plan';

    ELSIF v_session.current_step = 3 THEN
      v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 4;
        v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
        v_outcome := 'advance';
        v_col     := 'manpower';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 4 THEN
      v_reask := COALESCE((v_session.context->>'q4_reask')::int, 0);
      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_outcome := 'advance';
        v_col     := 'equipment';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q5_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q5_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        IF COALESCE((v_yesno->>'ok')::boolean, false) AND (v_yesno->>'met')::boolean THEN
          v_attendance := 'site_holiday';
        ELSE
          v_attendance := 'absent';
        END IF;
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_col     := 'attendance_complete';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome := 'advance';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_col = 'attendance' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw;

  ELSIF v_col = 'attendance_complete' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw, is_holiday, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw, (v_attendance = 'site_holiday'), p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw,
          is_holiday           = EXCLUDED.is_holiday,
          morning_submitted_at = EXCLUDED.morning_submitted_at;

  ELSIF v_col = 'plan' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_plan)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_plan = EXCLUDED.morning_plan;

  ELSIF v_col = 'manpower' THEN
    -- ONLY CHANGED BRANCH IN THIS FUNCTION. §42: the by_trade reshape now
    -- also carries `matched` through from whatever the TS parser supplied
    -- (COALESCE to true when absent, so a p_manpower payload from a caller
    -- not yet updated to emit `matched` -- e.g. mid-deploy -- degrades to
    -- "assume matched" rather than crash on a missing key; TRUE, not FALSE,
    -- because every element this RPC has ever received up to this migration
    -- WAS a matched trade -- the old parser never pushed unmatched ones at
    -- all, so the honest default for pre-migration-shaped input is "yes,
    -- this was matched", not "unknown, assume worst").
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_manpower->'planned_total',
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',   t->>'trade',
                        'count',   (t->>'planned_count')::int,
                        'matched', COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_manpower->'by_trade', '[]'::jsonb)) AS t
         ),
         'raw_text', p_manpower->'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_manpower = EXCLUDED.morning_manpower;

  ELSIF v_col = 'equipment' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_equipment, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_equipment    = EXCLUDED.morning_equipment,
          morning_submitted_at = EXCLUDED.morning_submitted_at;
  END IF;

  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = v_session.context,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'outcome',                    v_outcome,
    'current_flow',               v_session.current_flow,
    'current_step',               v_session.current_step,
    'log_date',                   v_log_date,
    'attendance',                 v_attendance,
    'capture_discarded',          v_capture_discarded,
    'capture_deferred',           v_capture_deferred,
    'hindrance_discarded',        v_hindrance_discarded,
    'hindrance_had_description',  v_hindrance_had_description
  );
END;
$function$;

-- =============================================================================
-- 2b. apply_evening_flow_turn  (LIVE text + four hunks)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_evening_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_parse jsonb DEFAULT NULL::jsonb, p_parse_ok jsonb DEFAULT NULL::jsonb, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session            whatsapp_sessions;
  v_text               TEXT;
  v_log_date           DATE;
  v_outcome            TEXT;
  v_col                TEXT    := NULL;
  v_reask              INTEGER;
  v_complete           BOOLEAN := false;
  v_morning_equipment  JSONB;
  v_confidence         TEXT;
  v_equip_items        JSONB;
  v_equipment_echo     JSONB   := NULL;  -- kept for RETURN shape compatibility; see note at RETURN
  i                     INTEGER;
  -- Evening Q4 (equipment) join state -- TYPE STRING only, no positional
  -- index, no label tiers. §33(b)/§6: the entire per-machine matching
  -- apparatus this replaces is retired outright, not patched.
  v_reply_count        INTEGER;
  v_reply_type         TEXT;
  v_morning_count_for_type INTEGER;  -- summed `count` across every morning_equipment item sharing this type
  -- S-set (a), discard observability -- same shape as apply_morning_flow_
  -- turn's own identical addition; see that function's own comment.
  -- CARRIED FORWARD FROM MIGRATION 038, UNCHANGED BY THIS MIGRATION -- see
  -- this file's own header note on the rehearsal finding that caught this
  -- function needing 038's body as its base, not 035's alone.
  v_hindrance_discarded      BOOLEAN := NULL;
  v_hindrance_had_description BOOLEAN := NULL;
  -- 050 hunk (0): variables for the N2 branch and the N13 deferral (plan section 6).
  v_capture_discarded         BOOLEAN := NULL;
  v_capture_deferred          BOOLEAN := NULL;
BEGIN
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      -- CONTEXT DISCIPLINE. Strips the full NEW reask-key set (e2/e3/e4) --
      -- the old set (e4_headcount/e5_reask/e6_reask) is a different regime
      -- and cannot appear once this migration is live, but stripping both
      -- costs nothing and matches STEP 3's own belt-and-braces sweep above.
      v_session.context := v_session.context
                            - 'e2_reask' - 'e3_reask' - 'e4_reask'
                            - 'e4_headcount' - 'e5_reask' - 'e6_reask';
      v_outcome := 'start';
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- CARRIED FORWARD FROM MIGRATION 038, UNCHANGED BY THIS MIGRATION.
      -- NEW BRANCH, migration 038 -- REVISED after external review round 2
      -- (B1, BLOCKING). Mirrors apply_morning_flow_turn's own revised
      -- branch exactly -- forces a stale/abandoned ad-hoc hindrance session
      -- to yield to a scheduled evening trigger rather than silently
      -- blocking it. See this file's own header note: the first draft of
      -- this migration was built from 035's body alone and would have
      -- deleted this entire branch -- caught by rehearsal, fixed before
      -- Aravind ever saw a draft.
      v_hindrance_discarded       := true;
      v_hindrance_had_description := (v_session.context ? 'description');
      IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'q2_reask' - 'description';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'evening';
        v_session.current_step := 1;
        v_session.context      := v_session.context
                                    - 'e2_reask' - 'e3_reask' - 'e4_reask'
                                    - 'e4_headcount' - 'e5_reask' - 'e6_reask'
                                    - 'q2_reask' - 'description';
        v_outcome := 'start';
      END IF;
    ELSIF v_session.current_flow = 'invoice' THEN
      -- 050 hunk (1): N2. A scheduled start over a live 'invoice' (material inward) session discards
      -- that session, subtract-only (flow-owned keys only; evening_submitted and every other cross-flow
      -- marker survive by NOT being named), and starts the check-in (outcome 'start'). The partial
      -- delivery rows are not in whatsapp_sessions and stay saved. The N13 flag records which
      -- check-in set it (value 'evening'); the first step-1 message afterwards is deferred
      -- by hunk (2). Mirrors the hindrance branch above; capture_discarded mirrors hindrance_discarded.
      v_capture_discarded := true;
      IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context
                                    - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'evening';
        v_session.current_step := 1;
        v_session.context      := (v_session.context
                                    - 'e2_reask' - 'e3_reask' - 'e4_reask'
                                    - 'e4_headcount' - 'e5_reask' - 'e6_reask'
                                    - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask')
                                  || jsonb_build_object('invoice_reset_guard', 'evening');
        v_outcome := 'start';
      END IF;
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'evening' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1
          AND (v_session.context->>'invoice_reset_guard') = 'evening' THEN
      -- 050 hunk (2): N13, review r1 B3 option (a). The FIRST non-empty step-1 message after an
      -- 'invoice' discard is never taken as an answer, whatever it contains: nothing is written
      -- (daily_logs untouched), v_col stays NULL, the flag is cleared, and the reply
      -- builder sends one explanation-plus-question message (capture_deferred). The SECOND message
      -- is handled by the existing step-1 arm below, unchanged. A NEW arm: no existing line moves.
      v_session.context  := v_session.context - 'invoice_reset_guard';
      v_capture_deferred := true;
      v_outcome          := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 (free text + enrichment) -> evening_output + quantities.
      -- BYTE-IDENTICAL to the pre-migration step 1 (plan §2: "unchanged").
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'output';

    ELSIF v_session.current_step = 2 THEN
      -- Evening Q2 -- workers by trade. Reuses parseLabourCount's shape
      -- (§42 extends it with `matched`, plan §15(d)/§15(e) -- unlike
      -- morning's manpower branch, THIS reshape has no pre-existing field
      -- names to preserve across a shared-parser boundary, since this is a
      -- brand-new write site; `matched` still defaults to true when absent,
      -- same reasoning as morning's branch above.
      v_reask := COALESCE((v_session.context->>'e2_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'2')::boolean, false) OR v_reask >= 1 THEN
        v_session.current_step := 3;
        v_session.context := v_session.context || jsonb_build_object('e2_reask', 0);
        v_col     := 'manpower';
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e2_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- Evening Q3 -- idle hours by trade. UNCONDITIONAL (asked every day,
      -- not gated on a bad day) -- "nobody idle" is a valid, common,
      -- ANSWERED (not defaulted) response; p_parse_ok->'3' is the TS
      -- parser's own judgment of that, not re-derived here.
      v_reask := COALESCE((v_session.context->>'e3_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'3')::boolean, false) OR v_reask >= 1 THEN
        v_session.context := v_session.context || jsonb_build_object('e3_reask', 0);
        v_col     := 'idle_hours';
        v_outcome := 'advance';

        -- EQUIPMENT AUTO-SKIP DECISION (BOT-22, unchanged trigger, moved
        -- from the old step 5 to here since idle-hours is now the step
        -- immediately before equipment). Same NULL-vs-empty distinction
        -- 024/025 already established: NULL (no morning submission at all)
        -- and empty ({items:[]}) both skip identically.
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;

        IF v_morning_equipment IS NULL
           OR jsonb_array_length(v_morning_equipment->'items') = 0 THEN
          -- SKIP Evening Q4 entirely -> Evening Q5 (tomorrow's needs)
          -- directly. UNLIKE the old flow's auto-skip, this does NOT
          -- complete the turn -- Q5 is unconditional now, so there is
          -- always one more question regardless of equipment. Store an
          -- empty utilisation object, same "explicit empty, not silent
          -- absence" convention 024 established.
          v_session.current_step := 5;
          v_col := 'idle_hours_skip_equipment';
        ELSE
          v_session.current_step := 4;
        END IF;
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e3_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 4 THEN
      -- Evening Q4 -- equipment, HOURS USED, one number per type. Decision 1
      -- (2026-08-31): supersedes §33(b)'s per-machine/two-number design
      -- entirely -- no available_hours, no idle_reason, no positional index.
      -- Joined to morning_equipment by TYPE STRING only.
      v_reask := COALESCE((v_session.context->>'e4_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'4')::boolean, false) OR v_reask >= 1 THEN
        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'4')::boolean, false)
                              THEN 'low' ELSE 'high' END;

        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_reply_count := COALESCE(jsonb_array_length(p_parse->'4'->'items'), 0);

        -- BUILD ONE STORED ITEM PER REPLY ENTRY. No claimed/unclaimed
        -- array, no tiers -- the join is a single type-string comparison.
        -- implausible := hours_used > 24 * (summed count across every
        -- morning item sharing this type) -- FLAG ONLY (finding 1, review
        -- round), never a reject, never a reask trigger. NULL when the
        -- type's count can't be determined (no morning match, or a
        -- matching morning item with count still NULL) -- "unknown" is not
        -- "plausible", so this stays NULL, not false.
        v_equip_items := '[]'::jsonb;
        FOR i IN 0..v_reply_count - 1 LOOP
          v_reply_type := p_parse->'4'->'items'->i->>'type';

          SELECT SUM((elem->>'count')::int) INTO v_morning_count_for_type
          FROM jsonb_array_elements(COALESCE(v_morning_equipment->'items', '[]'::jsonb)) AS elem
          WHERE elem->>'type' = v_reply_type;

          v_equip_items := v_equip_items || jsonb_build_array(
            jsonb_build_object(
              'type',        v_reply_type,
              'hours_used',  (p_parse->'4'->'items'->i)->'hours_used',
              'matched',     COALESCE((p_parse->'4'->'items'->i->>'matched')::boolean, true),
              'implausible', CASE
                                WHEN v_morning_count_for_type IS NULL THEN NULL
                                WHEN ((p_parse->'4'->'items'->i)->>'hours_used') IS NULL THEN NULL
                                ELSE ((p_parse->'4'->'items'->i->>'hours_used')::numeric
                                      > 24 * v_morning_count_for_type)
                              END,
              'raw',         (p_parse->'4'->'items'->i)->'raw'
            )
          );
        END LOOP;

        -- CASE B, TYPE-LEVEL: one "not reported" entry per DISTINCT morning
        -- type the reply never mentioned at all. Direct analogue of 024/025's
        -- per-MACHINE Case B, now per TYPE since matching is type-level.
        v_equip_items := v_equip_items || (
          SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                     'type', mtype, 'hours_used', NULL, 'matched', true,
                     'implausible', NULL, 'raw', NULL
                   )
                 ), '[]'::jsonb)
          FROM (
            SELECT DISTINCT elem->>'type' AS mtype
            FROM jsonb_array_elements(COALESCE(v_morning_equipment->'items', '[]'::jsonb)) AS elem
          ) morning_types
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_parse->'4'->'items') r
             WHERE r->>'type' = morning_types.mtype
          )
        );

        v_col := 'equipment_hours';
        v_session.current_step := 5;
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      -- Evening Q5 -- CHANGED, migration 040. "Anything *extra needed*
      -- tomorrow beyond the plan -- material, labour or machine?"
      -- Forward-looking; the old backward-looking "anything that slowed
      -- execution today?" role now belongs entirely to the explicit ad-hoc
      -- hindrance flow (migration 038, public.hindrances). Same shape as
      -- before: UNCONDITIONAL, free text, ungated (no reask, no parser) --
      -- see STEP 1/3's own column comment for why free text stays free
      -- text. Writes evening_tomorrow_needs (STEP 1 above), NOT
      -- evening_schedule_miss_reason (retired, STEP 4 above). Terminal
      -- step: completes the flow.
      v_col      := 'tomorrow_needs';
      v_complete := true;
      v_outcome  := 'advance';

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := (v_session.context - 'e2_reask' - 'e3_reask' - 'e4_reask')
                              || jsonb_build_object('evening_submitted', true);
  END IF;

  IF v_col = 'output' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_output, evening_output_quantities)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_parse->'1')
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_output            = EXCLUDED.evening_output,
          evening_output_quantities = EXCLUDED.evening_output_quantities;

  ELSIF v_col = 'manpower' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_parse->'2'->'planned_total',
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',   t->>'trade',
                        'count',   (t->>'planned_count')::int,
                        'matched', COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'2'->'by_trade', '[]'::jsonb)) AS t
         ),
         'raw_text', p_parse->'2'->>'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_manpower = EXCLUDED.evening_manpower;

  ELSIF v_col = 'idle_hours' THEN
    -- TRI-STATE, NOT BOOLEAN (added round 3, Aravind's ruling, after this
    -- branch's first draft only carried `by_trade`/`raw_text` -- an
    -- unparseable answer would have collapsed into the exact same stored
    -- shape as a confident "all working" zero, indistinguishable to any
    -- later reader. `all_working` and `unknown` are read straight from
    -- p_parse (parseIdleHoursByTrade's own tri-state, lib/whatsapp/flows/
    -- parsers/idle-hours.ts) rather than re-derived here, so the SQL layer
    -- can never disagree with the TS layer about which of the three states
    -- applies.
    --
    -- RAISE, NOT COALESCE-TO-FALSE (round-3 review finding, fixing a
    -- self-inflicted recurrence of the exact bug this tri-state exists to
    -- close). The first draft of this branch defended a caller omitting
    -- BOTH fields with `COALESCE(..., false)` on each -- which stores
    -- `{all_working:false, unknown:false}`, a FOURTH shape this field was
    -- designed to never have, and specifically defaults `unknown` to
    -- false: "known to not be unknown" where nothing was actually known.
    -- Same class of error the plausibility flag (§5a) got right twelve
    -- lines away in this same file: absence of information must never
    -- default toward the confident reading. A caller omitting these
    -- fields is a BUG (code that predates this migration's tri-state, the
    -- same class of mismatch `assertPostMigrationPayload`,
    -- `lib/dpr/dispatch.ts:46`, already guards against for a different
    -- payload) -- it must be legible as an error, not papered over as a
    -- valid state.
    IF (p_parse->'3'->'all_working') IS NULL OR (p_parse->'3'->'unknown') IS NULL THEN
      RAISE EXCEPTION 'apply_evening_flow_turn: p_parse[3] missing all_working/unknown -- pre-035 caller shape (idle-hours tri-state contract violated)';
    END IF;
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_idle_hours)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',      t->>'trade',
                        'idle_hours', (t->>'idle_hours')::numeric,
                        'matched',    COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'3'->'by_trade', '[]'::jsonb)) AS t
         ),
         'all_working', (p_parse->'3'->>'all_working')::boolean,
         'unknown',     (p_parse->'3'->>'unknown')::boolean,
         'raw_text', p_parse->'3'->>'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_idle_hours = EXCLUDED.evening_idle_hours;

  ELSIF v_col = 'idle_hours_skip_equipment' THEN
    -- Same idle-hours write as above, PLUS the explicit-empty equipment
    -- placeholder (auto-skip case) in the SAME transaction/turn -- one
    -- write, so a partial state (idle-hours written, equipment forever
    -- NULL) can never be observed between turns. Mirrors 024/025's own
    -- 'productivity_complete' shape for the identical reason.
    --
    -- RAISE, NOT COALESCE-TO-FALSE -- same fix, same reasoning, as the
    -- plain 'idle_hours' branch above. Duplicated rather than factored out
    -- because this branch's two-column write already duplicates the
    -- by_trade reshape too (pre-existing shape, not introduced here).
    IF (p_parse->'3'->'all_working') IS NULL OR (p_parse->'3'->'unknown') IS NULL THEN
      RAISE EXCEPTION 'apply_evening_flow_turn: p_parse[3] missing all_working/unknown -- pre-035 caller shape (idle-hours tri-state contract violated)';
    END IF;
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_idle_hours, evening_equipment_utilisation)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',      t->>'trade',
                        'idle_hours', (t->>'idle_hours')::numeric,
                        'matched',    COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'3'->'by_trade', '[]'::jsonb)) AS t
         ),
         'all_working', (p_parse->'3'->>'all_working')::boolean,
         'unknown',     (p_parse->'3'->>'unknown')::boolean,
         'raw_text', p_parse->'3'->>'raw_text'
       ),
       jsonb_build_object('items', '[]'::jsonb, 'raw_text', NULL, 'confidence', NULL))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_idle_hours            = EXCLUDED.evening_idle_hours,
          evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation;

  ELSIF v_col = 'equipment_hours' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_equipment_utilisation)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object('items', v_equip_items, 'raw_text', p_parse->'4'->>'raw_text',
                           'confidence', v_confidence))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation;

  ELSIF v_col = 'tomorrow_needs' THEN
    -- Terminal write. CHANGED, migration 040: evening_tomorrow_needs
    -- (STEP 1), NOT evening_schedule_miss_reason (retired, STEP 4).
    -- evening_submitted_at stamped here, the only place it's set --
    -- unchanged.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_tomorrow_needs, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_tomorrow_needs = EXCLUDED.evening_tomorrow_needs,
          evening_submitted_at   = EXCLUDED.evening_submitted_at;
  END IF;

  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = v_session.context,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  -- equipment_echo is NOT populated by this version -- unchanged from 035.
  -- hindrance_discarded/hindrance_had_description CARRIED FORWARD FROM
  -- MIGRATION 038, UNCHANGED BY THIS MIGRATION -- see this file's own
  -- header note.
  RETURN jsonb_build_object(
    'outcome',                    v_outcome,
    'current_flow',               v_session.current_flow,
    'current_step',               v_session.current_step,
    'log_date',                   v_log_date,
    'equipment_echo',             v_equipment_echo,
    'capture_discarded',          v_capture_discarded,
    'capture_deferred',           v_capture_deferred,
    'hindrance_discarded',        v_hindrance_discarded,
    'hindrance_had_description',  v_hindrance_had_description
  );
END;
$function$;

-- =============================================================================
-- 3. GRANTS (plan section 5, D-4). Per-role REVOKE by name; FROM PUBLIC alone is not enough.
-- =============================================================================
-- service_role only:
REVOKE ALL ON FUNCTION public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.expire_stale_material_inward(text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_material_inward(text, timestamptz)
  TO service_role;

-- authenticated only (048 pattern: REVOKE FROM PUBLIC, anon, service_role; GRANT TO authenticated):
REVOKE EXECUTE ON FUNCTION public.pm_set_delivery_details(uuid, text, text, text, date)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_set_delivery_details(uuid, text, text, text, date)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pm_approve_delivery(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_approve_delivery(uuid)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pm_reject_delivery(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_reject_delivery(uuid, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pm_link_invoice(uuid, uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_link_invoice(uuid, uuid[])
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pm_unlink_invoice(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_unlink_invoice(uuid)
  TO authenticated;

-- The two replaced live functions keep their grants (same signature): re-asserted, and the ACL is
-- checked by the assertion block below against the EXPECTED matrix ([SQL review r1, per Aravind 18 Oct] N-5). The before-reading of the live ACL
-- (read from the live database before the apply, compared after) belongs in the apply runbook, not in this file.
REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

-- =============================================================================
-- 4. IN-FILE ASSERTION BLOCK (review r1 N3; 049:1051-1099 pattern). Aborts the whole UP on any surprise.
--    Per function: exactly one pg_proc row in public by name (no stray overload); prosecdef; owner
--    postgres; proconfig; no PUBLIC grant and a non-NULL proacl; and the has_function_privilege matrix.
-- =============================================================================
DO $$
DECLARE
  v_bad  text := '';
  v_spec record;
  v_oid  oid;
  v_n    integer;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      -- name, regprocedure signature, expected proconfig, anon, authenticated, service_role
      ('apply_material_inward_turn',   'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)', 'search_path=""',       false, false, true),
      ('expire_stale_material_inward', 'public.expire_stale_material_inward(text,timestamptz)',                                              'search_path=""',       false, false, true),
      ('pm_set_delivery_details',      'public.pm_set_delivery_details(uuid,text,text,text,date)',                                           'search_path=""',       false, true,  false),
      ('pm_approve_delivery',          'public.pm_approve_delivery(uuid)',                                                                   'search_path=""',       false, true,  false),
      ('pm_reject_delivery',           'public.pm_reject_delivery(uuid,text)',                                                               'search_path=""',       false, true,  false),
      ('pm_link_invoice',              'public.pm_link_invoice(uuid,uuid[])',                                                                'search_path=""',       false, true,  false),
      ('pm_unlink_invoice',            'public.pm_unlink_invoice(uuid)',                                                                     'search_path=""',       false, true,  false),
      ('apply_morning_flow_turn',      'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'search_path=public', false, false, true),
      ('apply_evening_flow_turn',      'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)',   'search_path=public',   false, false, true)
    ) AS t(fname, sig, cfg, e_anon, e_auth, e_svc)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_spec.fname;
    IF v_n <> 1 THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':rows=' || v_n;
    END IF;
    v_oid := v_spec.sig::regprocedure::oid;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_oid
         AND p.prosecdef
         AND p.proowner = 'postgres'::regrole
         AND p.proconfig = ARRAY[v_spec.cfg]::text[]
         AND p.proacl IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    ) THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':fingerprint';
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM v_spec.e_anon THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':anon';
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM v_spec.e_auth THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':authenticated';
    END IF;
    IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_spec.e_svc THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':service_role';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ACL_ASSERT_050:%', v_bad;
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- DOWN (commented, inert text; plan section 9). The restore text exists once per database, in two
-- artifacts: docs/reviews/050-down-testdb.sql (written) and docs/reviews/050-down-prod.sql (NOT created yet; built
-- from the prod-captured bodies before the apply), each recorded with its own sha256. This block carries no restore text of its own.
--
-- DOWN, in order, one transaction:
--   SET LOCAL lock_timeout = '3s';
--   LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;            -- NOT SHARE ROW EXCLUSIVE (deadlocks)
--   DO block right after the LOCK: RAISE EXCEPTION 'DOWN_PRECONDITION_050' unless the 050 ledger row exists AND all seven
--     functions exist (a second run refuses and changes nothing);   [block 19 pre-merge fix]
--   clear every whatsapp_sessions row with current_flow = 'invoice', SUBTRACT-ONLY (flow NULL, step 0,
--     remove mi_last_sid / mi_kind / mi_document_id / mi_reask and invoice_reset_guard; never context := '{}');
--   strip invoice_reset_guard from every row that carries it;
--   restore apply_morning_flow_turn and apply_evening_flow_turn from the per-database captured text;
--   DROP the seven new functions;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '050';   -- [SQL review r1, per Aravind 18 Oct] S-2, before the closing assertion
--     (049's DOWN deletes its own row the same way); the closing assertion also checks NOT EXISTS (version = '050').
-- Precondition: PR-C rolled back and that rollback live (C, then B, then A). Never run at 08:25-08:40
-- or 18:25-18:40 IST. Named consequence: a pending ack "1" arriving after a DOWN reaches idle and
-- starts a hindrance report (N2).
-- =============================================================================
