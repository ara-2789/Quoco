-- =============================================================================
-- 052_mi_kind_deferred.sql
-- MI-KIND-REMOVAL: the engineer no longer declares a document's kind (DC or
-- invoice). The document is stored without a kind; a PM sets the kind later,
-- once, through public.pm_classify_document. Plan: docs/reviews/052-design/
-- kind-removal-plan.md, revision 8.1 (sha256 0cb3bc14afc70e3052d98c7dd75badc510019a4c3e2ae32a0fb9e52c0eeb83ed).
-- Design review: Design GO (conditional) round 3, verification pass GO stands
-- (docs/reviews/052-design/052-design-review-round-3.md, 052-rev8-verification-pass.md).
--
-- HELD -- NOT APPLIED to any database (test-db or prod); no apply GO exists. This file
-- lives in docs/reviews/, not supabase/migrations/, until an apply is actually
-- happening (CLAUDE.md section 6). Reserved in scripts/migration-number-reservations.json.
-- Branch feat/052-mi-kind-removal. SQL review pending.
--
-- TIER: FULL. External-review triggers tripped (CLAUDE.md section 0): (a) function logic
-- (the engineer RPC and two trigger functions are rewritten, a classify function is new),
-- (b) new SECURITY DEFINER functions, a new schema and grants, (c) an identity check on auth.uid().
--
-- BODY BASELINES, pre-052 (lint Rule 10: one baseline line per redefined function name).
-- Captured with pg_get_functiondef, md5 of the full text it returns.
-- Source: prod, per Aravind's SQL editor run 13 Nov 2026 (project identity not observed);
-- equal to test-db exfccwlrhoutkgrlikod, observed. PRECISELY: the body TEXT was read from test-db (a
-- SELECT run 13 Nov 2026; its md5 equals each pasted prod md5); the prod paste supplied the md5 only, and
-- that the paste came from prod is not established. The bodies are kept byte-exact outside the repo and
-- are embedded in docs/reviews/052-down-testdb.sql and 052-down-prod.sql.
--   body_md5 (pre-052): cecc170b26208d4b820402879e020271 apply_material_inward_turn
--   body_md5 (pre-052): b5467b20392b7e26449602acb9da2d00 trg_capture_documents_before_insert
--   body_md5 (pre-052): 4a7f470362e0bc7b7687737860d112f4 trg_capture_documents_before_update
-- The two functions this file creates (private.capture_apply_classification, public.pm_classify_document)
-- are first definitions and need no baseline.
--
-- WHAT IT DOES, IN ORDER (one transaction; plan section A)
--   A0  lock whatsapp_sessions (EXCLUSIVE, lock_timeout 3 s) and ABORT if any session is in the
--       invoice flow. No sweep. A turn queues on this lock, so the old RPC cannot run between
--       SET NOT NULL and the RPC replace below.
--   A1  capture_documents.kind becomes nullable.
--   A3  adds kind_source, kind_set_at, kind_set_by, received_at. Backfills kind_source =
--       'engineer_declared' for every existing document, and received_at from the document's OWN
--       delivery (a lossless copy: the delivery's received_at was processed_messages.created_at of
--       the same SID). Then SET NOT NULL on received_at and four constraints (provenance, set order,
--       received order, same-tenant FK to users).
--   C   schema private; private.capture_apply_classification (postgres only, no role can call it);
--       public.pm_classify_document (authenticated only; the caller must be a PM member of the
--       document's project).
--   A4  trg_capture_documents_before_update: kind leaves the immutable list and received_at joins
--       it; the one carve-out is NULL -> (kind, 'pm', set_by) with the stamp written by the database.
--   A4b trg_capture_documents_before_insert: an INSERT may not carry any of the four kind columns.
--   B   apply_material_inward_turn: same signature, no kind step, no delivery created by the engineer
--       turn; the document stores received_at. Start goes to step 2; step 1 is retired.
--   A6  in-file assertion blocks: backfill extensions, per-name function counts across ALL non-system
--       schemas, the full per-role EXECUTE matrix, schema USAGE, constraint presence, body markers.
--
-- RIDER (SQL review round 1, answer 2): drop the delivery_id result key and the dead v_delivery_id in the next
-- migration that touches apply_material_inward_turn. After 052 the engineer turn creates no delivery, so the key
-- is always NULL; it is kept now only so the result contract stays stable while the app side is rewritten.
--
-- WHAT IT DOES NOT DO: no row of any table is deleted; no WhatsApp message and no jobs row is written;
-- no grant on a table changes; types/database.ts and the app code are separate (PR block 2).
--
-- APPLY WINDOW: not 08:25-08:40 or 18:25-18:40 IST (the check-in trigger windows; the same bar as the
-- 050 DOWN). Apply only with digit 4 dark and the external probe at 0 (plan section R). The expected
-- failure is a clean abort (lock_timeout, deadlock detection, an assertion): the transaction rolls back
-- and changes nothing. A re-run is a re-probe and a new run, never a resume.
--
-- DOWN: commented block at the end. The runnable files are docs/reviews/052-down-testdb.sql and
-- docs/reviews/052-down-prod.sql (bodies restored from the captured text, refuses over unclassified rows).
--
-- RULE MAP (plan -> where in this file): the per-rule line table is in docs/reviews/052-sql-review-package.md.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A0. Session lock and the in-flight abort (plan A0, B2, N3). Taken BEFORE any capture-table DDL,
--     so the lock order is session -> document, like the engineer path. EXCLUSIVE, not
--     SHARE ROW EXCLUSIVE (that deadlocks with a turn's FOR UPDATE; 050's DOWN uses the same lock).
-- =============================================================================
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;

DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.whatsapp_sessions WHERE current_flow = 'invoice';
  IF v_n > 0 THEN
    -- Abort, no sweep, whatever expires_at says.
    RAISE EXCEPTION 'APPLY_ABORT_052: invoice sessions exist: %', v_n;
  END IF;
END;
$$;

-- =============================================================================
-- A1 + A3 (columns). kind becomes nullable (the inline CHECK on kind passes NULL). The four new
-- columns are added nullable with no default; received_at is made NOT NULL further down.
-- A2: the UNIQUE (id, project_id, tenant_id, kind) key and every FK that uses it are unchanged. A
-- child's kind column is fixed and non-null and the FKs are MATCH SIMPLE, so a delivery or a link
-- cannot reference an unclassified document.
-- =============================================================================
ALTER TABLE public.capture_documents ALTER COLUMN kind DROP NOT NULL;

ALTER TABLE public.capture_documents
  ADD COLUMN kind_source text,
  ADD COLUMN kind_set_at timestamptz,
  ADD COLUMN kind_set_by uuid,
  ADD COLUMN received_at timestamptz;

-- =============================================================================
-- A3 (kind_source backfill). Additive and idempotent: a general predicate. The old triggers are still
-- in force and name none of the new columns, so this UPDATE passes them. Every existing document
-- carries an engineer-declared kind. kind_set_at and kind_set_by stay NULL on these rows (A5).
-- Pre-apply probe (PROCEED/STOP): the extension is expected to be 5 rows on prod.
-- =============================================================================
UPDATE public.capture_documents
   SET kind_source = 'engineer_declared'
 WHERE kind IS NOT NULL AND kind_source IS NULL;

DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.capture_documents WHERE kind IS NOT NULL AND kind_source IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BACKFILL_ASSERT_052: kind_source backfill left % row(s) with a kind and no source', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.capture_documents WHERE kind IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BACKFILL_ASSERT_052: % document(s) have no kind before the first classification could exist', v_n;
  END IF;
END;
$$;

-- =============================================================================
-- A3b (B1). received_at is STORED ON THE DOCUMENT, not looked up at classify time (processed_messages
-- is a dedup table that service_role can delete from). The backfill copies it from the document's own
-- delivery: a lossless copy, since 050 wrote that delivery's received_at from processed_messages.created_at
-- of the same SID. Guarded by an assertion that EVERY document has exactly ONE delivery (D-19: both
-- pointers are UNIQUE). Any document that breaks that assumption aborts the whole apply.
-- Pre-apply probe (PROCEED/STOP): the same 5 documents on prod, each with exactly one delivery.
-- =============================================================================
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.capture_documents d
   WHERE (SELECT count(*) FROM public.deliveries x
           WHERE x.dc_document_id = d.id OR x.created_from_invoice_id = d.id) <> 1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BACKFILL_ASSERT_052: % document(s) do not have exactly one delivery', v_n;
  END IF;
END;
$$;

UPDATE public.capture_documents d
   SET received_at = x.received_at
  FROM public.deliveries x
 WHERE d.received_at IS NULL
   AND (x.dc_document_id = d.id OR x.created_from_invoice_id = d.id);

DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.capture_documents WHERE received_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'BACKFILL_ASSERT_052: received_at backfill left % row(s) NULL', v_n;
  END IF;
END;
$$;

-- =============================================================================
-- A3 (constraints). Being table CHECKs, the first three also cover INSERT.
-- =============================================================================
ALTER TABLE public.capture_documents ALTER COLUMN received_at SET NOT NULL;

ALTER TABLE public.capture_documents
  ADD CONSTRAINT capture_documents_kind_provenance_chk CHECK (
       (kind IS NULL     AND kind_source IS NULL AND kind_set_at IS NULL AND kind_set_by IS NULL)
    OR (kind IS NOT NULL AND kind_source = 'pm'  AND kind_set_at IS NOT NULL AND kind_set_by IS NOT NULL)
    OR (kind IS NOT NULL AND kind_source = 'engineer_declared' AND kind_set_at IS NULL AND kind_set_by IS NULL)
  ),
  ADD CONSTRAINT capture_documents_kind_set_order_chk CHECK (kind_set_at IS NULL OR kind_set_at >= created_at),
  ADD CONSTRAINT capture_documents_received_order_chk CHECK (received_at <= created_at);

-- Same-tenant attribution, explicit RESTRICT/RESTRICT (as sent_by_fk): a PM user cannot be deleted or
-- re-keyed while a classification points at them. Key: users (id, tenant_id), migration 017.
ALTER TABLE public.capture_documents
  ADD CONSTRAINT capture_documents_kind_set_by_fk
  FOREIGN KEY (kind_set_by, tenant_id) REFERENCES public.users (id, tenant_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

-- =============================================================================
-- C. Classify. Wrapper in public (authorises, then calls), helper in private (does the work).
--    The PostgREST exposed-schema list is a Supabase console value, not a file in this repo, so
--    non-exposure of schema private is proven by observation (test-db, then prod); the ACL below is
--    the real control either way.
-- =============================================================================
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- C1. Helper: postgres only. Every value except p_kind and p_set_by is derived from the LOCKED row.
CREATE FUNCTION private.capture_apply_classification(
  p_document_id uuid,
  p_kind        text,
  p_set_by      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tenant      uuid;
  v_project     uuid;
  v_sent_by     uuid;
  v_received    timestamptz;
  v_kind        text;
  v_ack         text;
  v_delivery_id uuid;
  v_self_id     uuid;
BEGIN
  -- Defensive shape checks (the wrapper already enforced them; the helper is callable by postgres only).
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('dc', 'invoice') OR p_set_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
  END IF;

  -- Step 1. FOR UPDATE (not FOR NO KEY UPDATE): step 3 updates kind, which is part of the UNIQUE key
  -- (id, project_id, tenant_id, kind), a key update. Taking it first avoids a lock upgrade between two PMs.
  SELECT d.tenant_id, d.project_id, d.sent_by, d.received_at, d.kind, d.engineer_ack
    INTO v_tenant, v_project, v_sent_by, v_received, v_kind, v_ack
    FROM public.capture_documents d
   WHERE d.id = p_document_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- Step 2. Re-check under the lock. Same kind: already classified, nothing changes (the 5 D-30 rows
  -- included). A different kind: QE011 (set-once; only reachable after the wrapper authorised the caller).
  IF v_kind IS NOT NULL THEN
    IF v_kind <> p_kind THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
    SELECT x.id INTO v_delivery_id
      FROM public.deliveries x
     WHERE x.dc_document_id = p_document_id OR x.created_from_invoice_id = p_document_id;
    SELECT l.id INTO v_self_id
      FROM public.delivery_invoice_links l
     WHERE l.invoice_document_id = p_document_id
       AND l.link_source = 'created_from_invoice'
       AND l.unlinked_at IS NULL;
    RETURN jsonb_build_object(
      'document_id',        p_document_id,
      'kind',               v_kind,
      'delivery_id',        v_delivery_id,
      'self_link_id',       v_self_id,
      'already_classified', true
    );
  END IF;

  -- Step 3. The trigger (A4) accepts only NULL -> (kind, 'pm', set_by) and stamps kind_set_at itself.
  UPDATE public.capture_documents
     SET kind        = p_kind,
         kind_source = 'pm',
         kind_set_by = p_set_by
   WHERE id = p_document_id;

  -- Steps 4-6. received_at comes from the LOCKED document row (written at the document insert, B1);
  -- this function never reads processed_messages. reported_by is the ENGINEER who sent the document,
  -- never the PM. The delivery trigger forces status 'incomplete' at INSERT (049 F4-2).
  IF p_kind = 'dc' THEN
    INSERT INTO public.deliveries
      (tenant_id, project_id, reported_by, received_at, dc_document_id)
    VALUES
      (v_tenant, v_project, v_sent_by, v_received, p_document_id)
    RETURNING id INTO v_delivery_id;
  ELSE
    -- A28: an invoice has one automatic delivery and one active self-link, one transaction.
    INSERT INTO public.deliveries
      (tenant_id, project_id, reported_by, received_at, created_from_invoice_id)
    VALUES
      (v_tenant, v_project, v_sent_by, v_received, p_document_id)
    RETURNING id INTO v_delivery_id;
    INSERT INTO public.delivery_invoice_links
      (tenant_id, project_id, delivery_id, invoice_document_id, link_source)
    VALUES
      (v_tenant, v_project, v_delivery_id, p_document_id, 'created_from_invoice')
    RETURNING id INTO v_self_id;
  END IF;

  -- Step 7. Status from the document's own ack, read under the lock (plan S). The note step never gates it.
  -- This is the same move the engineer's ack turn makes (050:255-259), for a document classified after the ack.
  IF v_ack IS NOT NULL THEN
    UPDATE public.deliveries
       SET status = 'awaiting_pm'
     WHERE id = v_delivery_id AND status = 'incomplete';
  END IF;

  RETURN jsonb_build_object(
    'document_id',        p_document_id,
    'kind',               p_kind,
    'delivery_id',        v_delivery_id,
    'self_link_id',       v_self_id,
    'already_classified', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION private.capture_apply_classification(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.capture_apply_classification(uuid, text, uuid)
  TO postgres;

-- C2. Wrapper: authenticated only. AUTHORISE BEFORE ANY LOCK. The same code (QE015) for "not found" and
-- "not a PM of that project": no existence oracle.
CREATE FUNCTION public.pm_classify_document(
  p_document_id uuid,
  p_kind        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_project uuid;
  v_tenant  uuid;
  v_caller  uuid;
BEGIN
  -- (1) shape
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('dc', 'invoice') THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
  END IF;

  -- (2) unlocked read of the document's immutable project_id / tenant_id
  SELECT d.project_id, d.tenant_id INTO v_project, v_tenant
    FROM public.capture_documents d
   WHERE d.id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- (3) the 050 PM-audience query: active user by auth_id = auth.uid(), same tenant, project_members.role
  -- = 'pm' on the document's OWN project. Admins count only as PM members.
  SELECT u.id INTO v_caller
    FROM public.users u
    JOIN public.project_members m ON m.user_id = u.id
   WHERE u.auth_id    = auth.uid()
     AND u.status     = 'active'
     AND u.tenant_id  = v_tenant
     AND m.project_id = v_project
     AND m.role       = 'pm';
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE015', MESSAGE = 'E15';
  END IF;

  -- (4) the helper gets p_set_by = users.id (FK-checked); the auth uid never leaves this function.
  RETURN private.capture_apply_classification(p_document_id, p_kind, v_caller);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pm_classify_document(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pm_classify_document(uuid, text)
  TO authenticated;

-- =============================================================================
-- A4. trg_capture_documents_before_update (no args; ACL kept, re-asserted below).
--     Before (049:783-791): kind was in the immutable list. After: kind leaves it and received_at joins it.
--     The ONE carve-out: all four OLD kind columns NULL -> kind set, source 'pm', set_by set, with
--     kind_set_at written by the database (a caller-supplied value is overwritten). Every later change
--     is QE009. engineer_declared can never be written by UPDATE.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_capture_documents_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- S-1 (SQL review r1): id and created_at are in the immutable set. 052: kind leaves it (see below),
  -- received_at joins it.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.sent_by IS DISTINCT FROM OLD.sent_by
     OR NEW.source_message_sid IS DISTINCT FROM OLD.source_message_sid THEN
    RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
  END IF;

  -- 052 (A4): the kind columns move together, once, by the PM path only.
  IF OLD.kind IS NOT NULL OR OLD.kind_source IS NOT NULL OR OLD.kind_set_at IS NOT NULL OR OLD.kind_set_by IS NOT NULL THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.kind_source IS DISTINCT FROM OLD.kind_source
       OR NEW.kind_set_at IS DISTINCT FROM OLD.kind_set_at
       OR NEW.kind_set_by IS DISTINCT FROM OLD.kind_set_by THEN
      RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
    END IF;
  ELSIF NEW.kind IS NOT NULL OR NEW.kind_source IS NOT NULL OR NEW.kind_set_at IS NOT NULL OR NEW.kind_set_by IS NOT NULL THEN
    IF NEW.kind IS NULL OR NEW.kind_source IS DISTINCT FROM 'pm' OR NEW.kind_set_by IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
    END IF;
    NEW.kind_set_at := now();
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
$fn$;

REVOKE ALL ON FUNCTION public.trg_capture_documents_before_update()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_capture_documents_before_update()
  TO postgres;

-- =============================================================================
-- A4b (S3). trg_capture_documents_before_insert: the QE012 refusal also covers a non-NULL kind,
-- kind_source, kind_set_at or kind_set_by, so no insert path can bring back an unattributed kind.
-- received_at is accepted only as written by the RPC. On PROD the RPC is the only insert path (a
-- service_role-only definer function; no role holds INSERT on the table). On TEST-DB, quoco_test_capture_insert
-- (scripts/test-db-only-capture-helpers.sql) is a second, test-only insert path that can reach this table;
-- on prod its absence is probed before apply (SQL review round 1, Known limits). No value check on
-- received_at is added here (declined, design review round 3, note 2): the one-insert-path invariant is
-- guarded by a source tripwire test (block 2).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_capture_documents_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  IF NEW.engineer_ack IS NOT NULL OR NEW.engineer_ack_at IS NOT NULL OR NEW.engineer_ack_note IS NOT NULL
     OR NEW.kind IS NOT NULL OR NEW.kind_source IS NOT NULL OR NEW.kind_set_at IS NOT NULL OR NEW.kind_set_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE012', MESSAGE = 'E12';
  END IF;

  -- S-4 (SQL review r3, per Aravind 12 Oct): created_at stamped by the database.
  NEW.created_at := now();

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_capture_documents_before_insert()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_capture_documents_before_insert()
  TO postgres;

-- =============================================================================
-- B. apply_material_inward_turn: same 10-argument signature, CREATE OR REPLACE, so the live ACL is kept
--    (and re-asserted below). No overload. Step map: 2 = file, 3 = ack, 4 = note; step 1 is retired.
--    The body is the captured pre-052 text with these changes only (diff: docs/reviews/052-sql-evidence/
--    rpc-body-diff.txt): v_kind and the S1 kind branch removed; the flow starts at step 2; a stray step-1
--    session is read as step 2; the document INSERT names no kind and stores received_at; the engineer turn
--    creates no delivery and no self-link. The processed_messages lookup and its QE012 refusal are unchanged.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_material_inward_turn(
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
  v_doc_id        uuid;
  v_delivery_id   uuid;   -- 052: never assigned now (always NULL in the result); see the header rider
  v_reask         integer;
  v_ack           text;
  v_norm          text;     -- [SQL review r1, per Aravind 18 Oct] N-1: ONE normalised reply, used by the S3 ack parser (052: the S1 kind parser is retired)
  v_rows          integer;  -- [SQL review r1, per Aravind 18 Oct] N-2
  v_note          text;
  v_create        boolean := false;
  v_attach        boolean := false;
  v_received      timestamptz;
  v_next_file_no  integer;
  v_files         jsonb;
  -- The flow-owned context keys (decided 18 Oct). 052: 'mi_kind' stays in this list and in the clear clauses below.
  -- Source of a stray key: the restored 050 body after a DOWN, which writes mi_kind at S1; a DOWN then re-UP cycle
  -- is the case that leaves it behind (A0 guarantees no invoice session exists at apply). SQL review round 1, answer 2.
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
      v_session.current_step := 2;   -- 052: the flow starts at the file step; step 1 (kind) is retired
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
    v_doc_id := NULLIF(v_session.context ->> 'mi_document_id', '')::uuid;
    v_reask  := COALESCE((v_session.context ->> 'mi_reask')::int, 0);
    -- [SQL review r1, per Aravind 18 Oct] N-1: the shared normalisation (decided 18 Oct): strip the keycap marks, then ONE trailing '.' or ')'.
    v_norm   := btrim(regexp_replace(translate(v_text, E'\uFE0F\u20E3', ''), '[.)]$', ''));

    IF v_text = '' AND v_media_n = 0 THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step IN (1, 2) THEN
      -- 052: step 1 (kind) is retired -- the kind is set later, by the PM only. A stray step-1 row is read as
      -- step 2. Same source as the mi_kind key above: the restored 050 body writes step 1 after a DOWN, so a
      -- DOWN then re-UP cycle can leave one (A0 guarantees none exists at apply). SQL review round 1, answer 2.
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

  -- Rows for a file turn: S2 creates the document (052: no kind, no delivery, no self-link) and the
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

      -- 052 (B1): received_at is stored on the document, copied from the SAME processed_messages row the
      -- lookup above just read. No kind, no delivery, no self-link: the PM classifies later.
      INSERT INTO public.capture_documents
        (tenant_id, project_id, sent_by, source_message_sid, received_at, caption)
      VALUES
        (p_tenant_id, p_project_id, p_user_id, p_message_sid, v_received, NULLIF(left(v_text, 1000), ''))
      RETURNING id INTO v_doc_id;

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

REVOKE ALL ON FUNCTION public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz, integer)
  TO service_role;

-- =============================================================================
-- A6. IN-FILE ASSERTION BLOCK (050 section 4 pattern). Aborts the whole UP on any surprise.
-- =============================================================================
DO $$
DECLARE
  v_bad  text := '';
  v_spec record;
  v_oid  oid;
  v_n    integer;
  v_src  text;
  v_role text;
  v_priv text;
BEGIN
  -- (1) Per function: exactly one pg_proc row by name in its schema; for the two new names, exactly one
  -- across ALL non-system schemas (so a stray public.capture_apply_classification fails here).
  FOR v_spec IN
    SELECT * FROM (VALUES
      -- name, schema, regprocedure signature, anon, authenticated, service_role
      ('capture_apply_classification',        'private', 'private.capture_apply_classification(uuid,text,uuid)', false, false, false),
      ('pm_classify_document',                'public',  'public.pm_classify_document(uuid,text)',               false, true,  false),
      ('trg_capture_documents_before_update', 'public',  'public.trg_capture_documents_before_update()',         false, false, false),
      ('trg_capture_documents_before_insert', 'public',  'public.trg_capture_documents_before_insert()',         false, false, false),
      ('apply_material_inward_turn',          'public',  'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)', false, false, true)
    ) AS t(fname, fschema, sig, e_anon, e_auth, e_svc)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = v_spec.fschema AND p.proname = v_spec.fname;
    IF v_n <> 1 THEN
      v_bad := v_bad || ' ' || v_spec.fname || ':rows_in_schema=' || v_n;
    END IF;
    IF v_spec.fname IN ('capture_apply_classification', 'pm_classify_document') THEN
      SELECT count(*) INTO v_n
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = v_spec.fname
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_';
      IF v_n <> 1 THEN
        v_bad := v_bad || ' ' || v_spec.fname || ':rows_all_schemas=' || v_n;
      END IF;
    END IF;
    v_oid := v_spec.sig::regprocedure::oid;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_oid
         AND p.prosecdef
         AND p.proowner = 'postgres'::regrole
         AND p.proconfig = ARRAY['search_path=""']::text[]
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

  -- (2) Schema private: no USAGE or CREATE for any of the three roles.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_schema_privilege(v_role, 'private', 'USAGE') OR has_schema_privilege(v_role, 'private', 'CREATE') THEN
      v_bad := v_bad || ' private_schema:' || v_role;
    END IF;
  END LOOP;

  -- (2b) Table grants the invariants rest on (SQL review round 1, S-3): "one insert path" and "only definer
  -- functions can UPDATE" both depend on these (049:973-979). No role may INSERT, UPDATE, DELETE or TRUNCATE
  -- capture_documents, at table or column level; authenticated and service_role keep SELECT. Runs at apply time,
  -- where the platform default ACLs actually exist. A failure names the role and the privilege.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege(v_role, 'public.capture_documents', v_priv) THEN
        v_bad := v_bad || ' table_grant:' || v_role || ':' || v_priv;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_role, 'public.capture_documents', 'INSERT') THEN
      v_bad := v_bad || ' column_grant:' || v_role || ':INSERT';
    END IF;
    IF has_any_column_privilege(v_role, 'public.capture_documents', 'UPDATE') THEN
      v_bad := v_bad || ' column_grant:' || v_role || ':UPDATE';
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
    IF NOT has_table_privilege(v_role, 'public.capture_documents', 'SELECT') THEN
      v_bad := v_bad || ' table_select_missing:' || v_role || ':SELECT';
    END IF;
  END LOOP;

  -- (3) Constraints and column shape.
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.capture_documents'::regclass
     AND c.conname IN ('capture_documents_kind_provenance_chk', 'capture_documents_kind_set_order_chk',
                       'capture_documents_received_order_chk', 'capture_documents_kind_set_by_fk');
  IF v_n <> 4 THEN
    v_bad := v_bad || ' constraints_found=' || v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.capture_documents'::regclass
                    AND c.conname = 'capture_documents_kind_set_by_fk'
                    AND c.confupdtype = 'r' AND c.confdeltype = 'r') THEN
    v_bad := v_bad || ' kind_set_by_fk_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.capture_documents'::regclass
              AND a.attname = 'kind' AND a.attnotnull AND NOT a.attisdropped) THEN
    v_bad := v_bad || ' kind_still_not_null';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.capture_documents'::regclass
                  AND a.attname = 'received_at' AND a.attnotnull AND NOT a.attisdropped) THEN
    v_bad := v_bad || ' received_at_nullable';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.capture_documents'::regclass AND NOT a.attisdropped
     AND a.attname IN ('kind_source', 'kind_set_at', 'kind_set_by', 'received_at');
  IF v_n <> 4 THEN
    v_bad := v_bad || ' new_columns_found=' || v_n;
  END IF;

  -- (4) Body markers (the replaced bodies are the new text, not the old one). strpos, not LIKE: in LIKE an
  -- underscore matches any character (SQL review round 1, N-1).
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure;
  IF strpos(v_src, 'v_kind') > 0 OR strpos(v_src, 'INSERT INTO public.deliveries') > 0
     OR strpos(v_src, '(tenant_id, project_id, sent_by, source_message_sid, received_at, caption)') = 0 THEN
    v_bad := v_bad || ' rpc_body_marker';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.trg_capture_documents_before_update()'::regprocedure;
  IF strpos(v_src, 'kind_source') = 0 OR strpos(v_src, 'NEW.received_at IS DISTINCT FROM OLD.received_at') = 0 THEN
    v_bad := v_bad || ' trg_update_body_marker';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.trg_capture_documents_before_insert()'::regprocedure;
  IF strpos(v_src, 'NEW.kind_set_by IS NOT NULL') = 0 THEN
    v_bad := v_bad || ' trg_insert_body_marker';
  END IF;

  -- (5) Data post-conditions: no document without a received_at, no half-set provenance.
  SELECT count(*) INTO v_n FROM public.capture_documents WHERE received_at IS NULL;
  IF v_n <> 0 THEN
    v_bad := v_bad || ' received_at_null_rows=' || v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.capture_documents WHERE kind IS NOT NULL AND kind_source IS NULL;
  IF v_n <> 0 THEN
    v_bad := v_bad || ' kind_without_source_rows=' || v_n;
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ACL_ASSERT_052:%', v_bad;
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- DOWN (commented, inert text; plan section E). The restore text exists once per database, in two
-- artifacts: docs/reviews/052-down-testdb.sql and docs/reviews/052-down-prod.sql, each carrying the
-- three captured pre-052 bodies byte-exact. This block carries no restore text of its own.
--
-- DOWN, in order, one transaction:
--   SET LOCAL lock_timeout = '3s';
--   LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;            -- the same lock as the apply
--   refuse (DOWN_PRECONDITION_052_UNCLASSIFIED) if any document has kind IS NULL -- a kind is never guessed;
--   clear every whatsapp_sessions row with current_flow = 'invoice', SUBTRACT-ONLY (flow NULL, step 0,
--     remove mi_last_sid / mi_kind / mi_document_id / mi_reask; never context := '{}');
--   restore the three replaced bodies from the captured text; drop pm_classify_document,
--     private.capture_apply_classification and schema private;
--   drop the four constraints and the four columns, ALTER COLUMN kind SET NOT NULL;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '052', before the closing assertion,
--     which also re-reads the three restored bodies against their pre-052 md5.
-- Named consequence: dropping kind_source, kind_set_at and kind_set_by destroys PM attribution and the
-- engineer_declared marker; dropping received_at loses nothing (each delivery keeps its own).
-- Rollback order: 052 DOWN, 050 DOWN, 049 DOWN. Never run at 08:25-08:40 or 18:25-18:40 IST.
-- =============================================================================
