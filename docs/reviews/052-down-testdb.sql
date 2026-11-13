-- docs/reviews/052-down-testdb.sql  -- DOWN artifact for migration 052 (MI-KIND-REMOVAL), TEST-DB (exfccwlrhoutkgrlikod).
-- NEVER APPLY THIS FILE TO THE OTHER DATABASE (prod, jvxwqignooseazzmwhvl). That database has its own artifact,
-- docs/reviews/052-down-prod.sql: same body, its own header.
-- Plan: docs/reviews/052-design/kind-removal-plan.md rev 8.1, section E ("DOWN (S6)").
-- NOT RUN on any database by the block that wrote it (no database connection in that block).
--
-- The three restored bodies below are the pre-052 text, byte-exact, captured with pg_get_functiondef
-- (prod, per Aravind's SQL editor run 13 Nov 2026, project identity not observed; equal to test-db
-- exfccwlrhoutkgrlikod, observed). PRECISELY: the body TEXT was read from test-db (13 Nov 2026); the prod
-- paste supplied the md5 only, and that it came from prod is not established. Each embedded body's md5
-- equals its pre-052 baseline:
--   cecc170b26208d4b820402879e020271 apply_material_inward_turn
--   b5467b20392b7e26449602acb9da2d00 trg_capture_documents_before_insert
--   4a7f470362e0bc7b7687737860d112f4 trg_capture_documents_before_update
-- The closing assertion re-reads md5(pg_get_functiondef(oid)) for all three and aborts on any difference.
--
-- ROLLBACK ORDER (SQL review round 1, S-6b):
--   1. Revert the PR-D2 deploy (the PM page reads columns and a function this DOWN drops; merge is deploy).
--   2. This 052 DOWN, then the 050 DOWN, then the 049 DOWN. Never run at 08:25-08:40 or 18:25-18:40 IST.
-- A DOWN over an unclassified document is REFUSED (DOWN_PRECONDITION_052_UNCLASSIFIED): a kind is never guessed.
-- DOWN_PRECONDITION_052_UNCLASSIFIED is expected once digit 4 is live. Resolution: Aravind opens each unclassified
-- document and calls private.capture_apply_classification as postgres with his own PM users.id. Each call is recorded in
-- the apply record as a human decision. A kind is never guessed. (SQL review round 1, S-6a)
-- NAMED CONSEQUENCE: dropping kind_source, kind_set_at and kind_set_by destroys PM attribution and the
-- engineer_declared marker. Dropping received_at loses nothing: each delivery keeps its own.
-- Every invoice-flow session is cleared (subtract-only), so no session can be mid-flow on the restored function.

BEGIN;

SET LOCAL lock_timeout = '3s';
LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;

-- 0. Preconditions. Structure first (a second run, or a run against a database that never had 052, must
--    report the missing objects rather than succeed on nothing), then the unclassified-document refusal.
DO $$
DECLARE
  v_ledger boolean;
  v_helper integer;
  v_wrap   integer;
  v_cols   integer;
  v_cons   integer;
  v_unclassified bigint;
BEGIN
  v_ledger := EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '052');
  SELECT count(*) INTO v_helper FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private' AND p.proname = 'capture_apply_classification';
  SELECT count(*) INTO v_wrap FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pm_classify_document';
  SELECT count(*) INTO v_cols FROM pg_attribute a
   WHERE a.attrelid = 'public.capture_documents'::regclass AND NOT a.attisdropped
     AND a.attname IN ('kind_source', 'kind_set_at', 'kind_set_by', 'received_at');
  SELECT count(*) INTO v_cons FROM pg_constraint c
   WHERE c.conrelid = 'public.capture_documents'::regclass
     AND c.conname IN ('capture_documents_kind_provenance_chk', 'capture_documents_kind_set_order_chk',
                       'capture_documents_received_order_chk', 'capture_documents_kind_set_by_fk');
  IF NOT v_ledger OR v_helper <> 1 OR v_wrap <> 1 OR v_cols <> 4 OR v_cons <> 4 THEN
    RAISE EXCEPTION 'DOWN_PRECONDITION_052: ledger_052=% helper_found=% wrapper_found=% columns_found=% constraints_found=%',
      v_ledger, v_helper, v_wrap, v_cols, v_cons;
  END IF;
  SELECT count(*) INTO v_unclassified FROM public.capture_documents WHERE kind IS NULL;
  IF v_unclassified > 0 THEN
    RAISE EXCEPTION 'DOWN_PRECONDITION_052_UNCLASSIFIED: % document(s) have no kind; a kind is never guessed', v_unclassified;
  END IF;
END;
$$;

-- 1. Clear every invoice-flow session, SUBTRACT-ONLY (never context := '{}'), under the lock taken above.
UPDATE public.whatsapp_sessions
   SET current_flow = NULL,
       current_step = 0,
       context      = COALESCE(context, '{}'::jsonb) - 'mi_last_sid' - 'mi_kind' - 'mi_document_id' - 'mi_reask'
 WHERE current_flow = 'invoice';

-- 2. Restore the three replaced bodies, byte-exact. CREATE OR REPLACE with an unchanged signature
--    keeps each function's ACL; the closing assertion checks it.
CREATE OR REPLACE FUNCTION public.apply_material_inward_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_message_sid text, p_media jsonb DEFAULT NULL::jsonb, p_start_flow boolean DEFAULT false, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.trg_capture_documents_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- S-1 (SQL review r1): id and created_at added to the immutable set.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.sent_by IS DISTINCT FROM OLD.sent_by
     OR NEW.source_message_sid IS DISTINCT FROM OLD.source_message_sid THEN
    RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
  END IF;

  -- The acknowledgement is settable once; the note is settable once.
  IF OLD.engineer_ack IS NOT NULL THEN
    IF NEW.engineer_ack IS DISTINCT FROM OLD.engineer_ack
       OR NEW.engineer_ack_at IS DISTINCT FROM OLD.engineer_ack_at THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
  END IF;
  IF OLD.engineer_ack_note IS NOT NULL THEN
    IF NEW.engineer_ack_note IS DISTINCT FROM OLD.engineer_ack_note THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
  END IF;

  -- S-3 (SQL review r2, Option A per Aravind 11 Oct): the acknowledgement time
  -- is stamped by the database when the ack is first set; a caller-supplied
  -- value is overwritten. It drives the D-12 clock.
  IF OLD.engineer_ack IS NULL AND NEW.engineer_ack IS NOT NULL THEN
    NEW.engineer_ack_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_capture_documents_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  IF NEW.engineer_ack IS NOT NULL OR NEW.engineer_ack_at IS NOT NULL OR NEW.engineer_ack_note IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
  END IF;

  -- S-4 (SQL review r3, per Aravind 12 Oct): created_at stamped by the database.
  NEW.created_at := now();

  RETURN NEW;
END;
$function$;

-- 3. Drop the classify functions and the schema (no CASCADE: a stray dependent object must fail this).
DROP FUNCTION public.pm_classify_document(uuid, text);
DROP FUNCTION private.capture_apply_classification(uuid, text, uuid);
DROP SCHEMA private;

-- 4. Drop the four constraints, then the four columns, then restore NOT NULL on kind (the precondition
--    guarantees no NULL kind remains).
ALTER TABLE public.capture_documents
  DROP CONSTRAINT capture_documents_kind_set_by_fk,
  DROP CONSTRAINT capture_documents_received_order_chk,
  DROP CONSTRAINT capture_documents_kind_set_order_chk,
  DROP CONSTRAINT capture_documents_kind_provenance_chk;
ALTER TABLE public.capture_documents
  DROP COLUMN kind_source,
  DROP COLUMN kind_set_at,
  DROP COLUMN kind_set_by,
  DROP COLUMN received_at;
ALTER TABLE public.capture_documents ALTER COLUMN kind SET NOT NULL;

-- 5. Remove the ledger row, before the closing assertion.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '052';

-- 6. Closing assertion.
DO $$
DECLARE
  v_bad text := '';
  v_n   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('pm_classify_document', 'capture_apply_classification')
                AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_') THEN
    v_bad := v_bad || ' classify_fn_remains';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private') THEN
    v_bad := v_bad || ' schema_private_remains';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.capture_documents'::regclass AND NOT a.attisdropped
     AND a.attname IN ('kind_source', 'kind_set_at', 'kind_set_by', 'received_at');
  IF v_n <> 0 THEN
    v_bad := v_bad || ' new_columns_remain=' || v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.capture_documents'::regclass
                AND c.conname IN ('capture_documents_kind_provenance_chk', 'capture_documents_kind_set_order_chk',
                                  'capture_documents_received_order_chk', 'capture_documents_kind_set_by_fk')) THEN
    v_bad := v_bad || ' constraint_remains';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.capture_documents'::regclass
                  AND a.attname = 'kind' AND a.attnotnull AND NOT a.attisdropped) THEN
    v_bad := v_bad || ' kind_nullable';
  END IF;
  -- The three restored bodies read back as the pre-052 text.
  IF md5(pg_get_functiondef('public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure))
       <> 'cecc170b26208d4b820402879e020271' THEN
    v_bad := v_bad || ' rpc_md5';
  END IF;
  IF md5(pg_get_functiondef('public.trg_capture_documents_before_insert()'::regprocedure))
       <> 'b5467b20392b7e26449602acb9da2d00' THEN
    v_bad := v_bad || ' trg_insert_md5';
  END IF;
  IF md5(pg_get_functiondef('public.trg_capture_documents_before_update()'::regprocedure))
       <> '4a7f470362e0bc7b7687737860d112f4' THEN
    v_bad := v_bad || ' trg_update_md5';
  END IF;
  -- ACLs kept: the RPC is service_role only; both trigger functions have no caller.
  IF has_function_privilege('service_role', 'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure, 'EXECUTE') IS DISTINCT FROM true
     OR has_function_privilege('anon', 'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure, 'EXECUTE') THEN
    v_bad := v_bad || ' rpc_acl';
  END IF;
  IF has_function_privilege('anon', 'public.trg_capture_documents_before_update()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.trg_capture_documents_before_update()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trg_capture_documents_before_update()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.trg_capture_documents_before_insert()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.trg_capture_documents_before_insert()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('service_role', 'public.trg_capture_documents_before_insert()'::regprocedure, 'EXECUTE') THEN
    v_bad := v_bad || ' trigger_fn_acl';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '052') THEN
    v_bad := v_bad || ' ledger_row_remains';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'DOWN_ASSERT_052:%', v_bad;
  END IF;
END;
$$;

COMMIT;
