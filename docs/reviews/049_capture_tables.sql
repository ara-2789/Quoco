-- =============================================================================
-- 049_capture_tables.sql
-- Slice 1a (capture engine) PR-A: four tenant-scoped tables, their triggers,
-- RLS, grants and the private `capture-documents` storage bucket.
--
-- HELD -- NOT APPLIED to any database (test-db or prod). This file lives in
-- docs/reviews/, not supabase/migrations/, until an apply is actually
-- happening (CLAUDE.md section 6: a migration file enters supabase/migrations/
-- when it is being applied, not when it is written).
--
-- Spec commit: 0289bcf (origin/main). Specification, in order of precedence:
--   docs/reviews/049-plan-review-package.md  (section 3 D-1..D-33, section 4
--     strings, section 11 round 2 table and the reviewer's SQL-package
--     checklist) -- WINS on any conflict;
--   docs/reviews/049-plan-evidence/pra-plan-v2.md  (the base spec);
--   docs/reviews/049-plan-evidence/review-round-1.txt, review-round-2.txt.
--
-- TIER: FULL (CLAUDE.md section 0; new tenant-scoped tables, RLS, grants,
-- SECURITY DEFINER trigger functions, a storage bucket).
-- RISK CLASS: additive (4 new tables, 4 new functions, 1 new bucket row, no
-- existing object altered). DOWN is destructive only against rows written
-- after apply (data loss, not rollback; the answer there is PITR).
-- EXTERNAL-REVIEW TRIGGERS TRIPPED (CLAUDE.md section 0): (a) new function
-- logic (four SECURITY DEFINER trigger functions); (b) new tables with their
-- own RLS and grants from day one. Not tripped: (c) no auth/identity object
-- is created or altered (the policies only READ users); (d) the UP is not
-- destructive; (e) no money column exists anywhere.
--
-- TRACEABILITY: the map below is generated from the `-- [src: ...]` marker
-- lines in this file (line numbers are of THIS file). Source ids are those of
-- the cover file (D-n), review round 1 (R/B/S/N), review round 2 (S-A..S-F,
-- N-1, N-2, Q2-n) and plan v2 (TR1..TR5, C-n).
--   E7: 120-141
--   E12: 120-141
--   E-codes-table: 120-141
--   N-1: 120-141
--   D-31: 120-141
--   lock-paths: 143-201
--   R3: 143-201, 431-494, 585-657, 659-695
--   D-26: 143-201
--   Q2-2: 143-201
--   Q2-3: 143-201
--   S-C: 143-201
--   D-27: 143-201, 585-657
--   S-F: 203-213
--   S-E: 203-213
--   D-4: 203-213, 253-277, 284-311
--   Q2-6: 215-226
--   D-22: 215-226, 319-368
--   D-25: 215-226, 319-368
--   B3: 228-238, 431-494, 496-583, 585-657, 659-695
--   S-B: 228-238
--   D-19: 228-238, 253-277, 319-368
--   D-1: 253-277, 319-368
--   S-2: 253-277, 284-311
--   D-5: 253-277, 284-311, 319-368, 720-733, 735-748, 750-763, 765-778
--   D-30: 253-277
--   S-A: 253-277, 319-368, 375-407
--   S4: 253-277, 319-368
--   C-29: 253-277, 284-311, 319-368, 375-407
--   D-29: 253-277, 284-311, 319-368, 375-407, 894-973
--   S-3: 284-311
--   D-9: 284-311, 822-826
--   D-10: 284-311, 822-826
--   D-18: 319-368
--   D-23: 319-368, 585-657
--   D-2: 375-407
--   D-3: 375-407, 414-419, 496-583
--   R2: 375-407, 496-583
--   Q2-5: 375-407
--   R5: 375-407
--   C-37: 375-407
--   N1: 414-419
--   A33: 414-419
--   E8: 414-419
--   C-35: 414-419
--   TR1: 431-494, 697-705
--   TR2: 431-494
--   B2: 431-494, 496-583
--   R4: 431-494, 496-583, 585-657, 659-695, 787-791, 803-807, 853-890
--   D-7: 431-494, 496-583, 585-657, 659-695, 803-807
--   E1: 431-494
--   E2: 431-494
--   E3: 431-494
--   E4: 431-494
--   E5: 431-494
--   E10: 431-494, 496-583
--   E14: 431-494, 496-583, 585-657, 659-695
--   A28: 431-494
--   A34: 431-494
--   TR3: 496-583, 697-705
--   C-36: 496-583, 585-657
--   Q2-4: 496-583
--   TR4a: 585-657, 697-705
--   TR4b: 585-657, 697-705
--   TR4c: 585-657, 697-705
--   D-6: 585-657, 659-695
--   S6: 585-657
--   B1: 585-657
--   E6: 585-657
--   E9: 585-657, 659-695
--   E11: 585-657, 659-695
--   E13: 585-657
--   TR5: 659-695, 697-705
--   D-20: 714-718, 720-733, 735-748, 750-763, 765-778
--   R7: 714-718, 720-733, 735-748, 750-763, 765-778
--   C-30: 714-718, 720-733, 735-748, 750-763, 765-778
--   D-8: 787-791, 853-890
--   D-21: 787-791
--   CLAUDE.md-s6-per-role-revoke: 787-791
--   C-27: 803-807
--   D-11: 822-826
--   042-precedent: 822-826
--   CLAUDE.md-s6-ACL-fingerprint: 853-890
--   R8: 894-973
--   S-D: 894-973
--   C-31: 894-973
--   down-order: 894-973
--
-- [src: E7, E12, E-codes-table, N-1, D-31]
-- RAISE CODES (E-numbers of the cover file section 4). Every RAISE in this
-- file carries a code only: ERRCODE = 'QE0nn', MESSAGE = 'En'. No prose, no
-- row data (definer reads bypass RLS). The app maps code -> named string.
--   E1  QE001  TR1  PM link while the invoice has an active self-link
--   E2  QE002  TR1  self-link while the invoice has an active PM link
--   E3  QE003  TR2  PM link to an internal transfer
--   E4  QE004  TR2  PM link to an automatic delivery
--   E5  QE005  TR2  PM link to a rejected/cancelled delivery; also a
--                   self-link to a rejected delivery (A34)
--   E6  QE006  TR4b retype to internal_transfer while an active link exists
--   E7  (not raised) CHECK deliveries_auto_not_internal_chk, SQLSTATE 23514
--   E8  (not raised) unique index uq_dil_active_per_delivery, SQLSTATE 23505
--   E9  QE009  TR4a / TR5  immutable column changed
--   E10 QE010  TR3 (any refused link edit) and TR1 (B2: INSERT carrying
--                   unlink/snapshot values)  -- assignment, see review package
--   E11 QE011  TR4c (transition, locked content) and TR5 (second ack/note)
--   E12 (not raised) CHECK/FK, SQLSTATE 23514 / 23503
--   E13 QE013  TR4c(2)(3)  move to rejected/cancelled while a link is active
--   E14 QE014  isolation guard: any invariant trigger under a level other
--                   than READ COMMITTED
-- [/src]
--
-- [src: lock-paths, R3, D-26, Q2-2, Q2-3, S-C, D-27]
-- THE SIX PR-B LOCK PATHS (the contract PR-B functions must follow; lock
-- levels in order: 1 invoice capture_documents row FOR NO KEY UPDATE; 2
-- deliveries rows ascending id -- a DC delivery FOR SHARE by every link and
-- unlink path, an automatic delivery FOR NO KEY UPDATE; 3 delivery_invoice_
-- links rows). I = invoice document, Da = automatic delivery, Dd = DC
-- delivery. TR3 never locks the delivery (level 3 must not take level 2).
--   PATH 1  Link  pm_link_invoice(I, [Dd...])
--     1. Lock I [NO KEY UPDATE].
--     2. Validate the caller is a PM of I's project; validate every target.
--     3. In ascending id order lock every Dd [SHARE]; lock Da (if I has an
--        active self-link) [NO KEY UPDATE] in the same pass.
--     4. Soft-unlink the self-link (superseded_by_link). TR3 snapshots Da.
--     5. Update Da to cancelled (TR4c: no active link now; TR4 re-locks I).
--     6. Insert the pm_manual links (TR1: isolation, I again, XOR, TR2 FOR
--        SHARE again on each Dd).
--   PATH 2  Unlink with restore  pm_unlink_invoice(link)
--     1. Read the link's invoice_document_id unlocked (safe: TR3 makes it
--        immutable). Lock I [NO KEY UPDATE]. Re-read the link under the lock;
--        refuse if it is no longer active.
--     2. In ascending id order lock the link's Dd [SHARE] and, if restore is
--        possible, Da [NO KEY UPDATE].
--     3. Soft-unlink the PM link (pm_unlinked).
--     4. If I now has zero active PM links and Da is cancelled with
--        superseded_by_link: update Da FIRST to incomplete (invoice document
--        has no ack) or awaiting_pm (it has one), clearing cancelled_* and
--        approved_*; THEN insert the new self-link. Never the self-link first.
--     5. A rejected Da is not restored.
--   PATH 3  Reject an automatic delivery  pm_reject_delivery(Da)
--     1. Read Da.created_from_invoice_id unlocked (safe: TR4a). Lock I.
--     2. Lock Da [NO KEY UPDATE]; re-read its status.
--     3. Soft-unlink its self-link (delivery_rejected).
--     4. Update Da to rejected (TR4c: no active link).
--   PATH 4  Reject a DC delivery with restore  pm_reject_delivery(Dd)
--           (review-round-2.txt Q2-2 steps 1-8; D-26; S-C re-read rule)
--     1. Read Dd's active link unlocked, to get I.
--     2. Lock I [NO KEY UPDATE].
--     3. In ascending id order, lock Dd and, if restore is possible, Da, both
--        [NO KEY UPDATE].
--     4. Re-read under the locks. If Dd's active link no longer points at I,
--        or now exists when step 1 saw none, RAISE E11 and STOP (S-C). Never
--        take I after Dd: Postgres cannot release a row lock mid-transaction.
--     5. Soft-unlink the link (delivery_rejected). TR3 forces the snapshot
--        NULL.
--     6. Update Dd to rejected. TR4c passes because no link is active.
--     7. Count I's active PM links. Stable: every path that inserts or unlinks
--        I's links holds I.
--     8. If the count is zero and Da is cancelled with superseded_by_link:
--        update Da to pending (incomplete or awaiting_pm, from the ack),
--        clearing cancelled_* and approved_*; THEN insert the new self-link
--        (TR1 XOR passes; TR2 sees Da not rejected).
--   PATH 5  Approve  pm_approve_delivery(d)
--     DC: update Dd (implicit NO KEY UPDATE); no other lock.
--     Automatic: read created_from_invoice_id unlocked; lock I; update Da.
--   PATH 6  Retype  pm_set_delivery_details(d)
--     DC: update Dd only (TR4b reads active links unlocked; TR2 in a
--     concurrent link INSERT takes FOR SHARE on Dd, so the two serialise,
--     READ COMMITTED only). Automatic: lock I first, then update Da.
-- [/src]
--
-- [src: S-F, S-E, D-4]
-- WHAT UNIQUE (source_message_sid) DOES AND DOES NOT DO (S-F -- a PR-B
-- BLOCKING condition, recorded here and NOT solved here): it guards
-- server-side double calls of the capture RPC only. A Twilio webhook retry is
-- stopped earlier, by the processed_messages SID consumption that happens
-- BEFORE any processing (app/api/whatsapp/webhook/route.ts:224,
-- lib/whatsapp/idempotency.ts:24-38), so a capture that fails after that
-- point is lost on retry with no row and no alert. PR-B must record the
-- inbound media durably at or before SID consumption, or add a failure path
-- that records and alerts. PR-B must not merge without this.
-- [/src]
--
-- [src: Q2-6, D-22, D-25]
-- PR-B RPC RULE FOR received_at (review round 2 Q2-6; this file has no RPC):
-- the capture RPC takes ONE p_message_sid and uses it for BOTH the lookup of
-- received_at (= processed_messages.created_at for that MessageSid, read
-- inside the RPC, never passed in by the route) AND
-- capture_documents.source_message_sid, so received_at and the creating
-- message are the same fact by construction. It refuses a missing
-- processed_messages row or a NULL created_at. Residual risk, named and
-- accepted: processed_messages holds no sender, so a server bug pairing one
-- engineer with another's SID cannot be detected in the database; its cost is
-- bounded (the other engineer's own document then fails UNIQUE loudly).
-- [/src]
--
-- [src: B3, S-B, D-19]
-- ISOLATION (B3): every invariant trigger refuses a non-READ-COMMITTED
-- writer. A REPEATABLE READ or SERIALIZABLE writer cannot change these tables.
-- Lock-order and race behaviour is CI-only / two-real-session on PG: a single
-- local session proves nothing about contention (CLAUDE.md section 0).
--
-- ORPHAN PROBES (D-19, S-B): three probes, each must return 0 after every happy-path
-- scenario (DC document with no delivery; invoice document with neither a
-- delivery nor an active link; invoice document with no active link whose
-- automatic delivery is not rejected). Source: docs/reviews/049-sql-evidence/T-ORPH.txt.
-- [/src]
--
-- NULL-SAFETY NOTE: a CHECK passes on NULL. Every CHECK below that implies
-- "X => Y" is written so a NULL operand cannot make it pass vacuously
-- (COALESCE / IS NOT DISTINCT FROM / explicit IS NOT NULL), per review
-- round 2 Q2-5.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- capture_documents. No delivery_id: a delivery points at its document (D-1).
-- One document per capture flow, one delivery per document, for life (D-19,
-- D-30). Created first: deliveries references it.
-- -----------------------------------------------------------------------------
-- [src: D-1, D-4, S-2, D-5, D-19, D-30, S-A, S4, C-29, D-29]
CREATE TABLE public.capture_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  project_id         uuid        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('dc', 'invoice')),
  sent_by            uuid        NOT NULL,
  source_message_sid text        NOT NULL,
  engineer_ack       text        CHECK (engineer_ack IN ('yes', 'no', 'partial', 'unclear')),
  engineer_ack_at    timestamptz,
  engineer_ack_note  text,
  caption            text,
  CONSTRAINT capture_documents_source_message_sid_key UNIQUE (source_message_sid),
  CONSTRAINT capture_documents_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT capture_documents_id_project_tenant_key UNIQUE (id, project_id, tenant_id),
  CONSTRAINT capture_documents_id_project_tenant_kind_key UNIQUE (id, project_id, tenant_id, kind),
  CONSTRAINT capture_documents_project_fk FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT capture_documents_sent_by_fk FOREIGN KEY (sent_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT capture_documents_ack_pair_chk CHECK ((engineer_ack IS NULL) = (engineer_ack_at IS NULL)),
  CONSTRAINT capture_documents_ack_at_order_chk CHECK (engineer_ack_at IS NULL OR engineer_ack_at >= created_at),
  CONSTRAINT capture_documents_ack_note_scope_chk CHECK (engineer_ack_note IS NULL OR COALESCE(engineer_ack IN ('no', 'partial', 'unclear'), false)),
  CONSTRAINT capture_documents_ack_note_len_chk CHECK (char_length(engineer_ack_note) <= 1000),
  CONSTRAINT capture_documents_caption_len_chk CHECK (char_length(caption) <= 1000)
);

-- -----------------------------------------------------------------------------
-- capture_files. file_no (page order across the whole document) and
-- media_index (position inside one Twilio message) are different facts (S2,
-- D-19): both stay. storage_path is pinned to tenant/project/document/ (S-3).
-- -----------------------------------------------------------------------------
-- [src: D-4, S-2, D-5, S-3, C-29, D-9, D-10, D-29]
CREATE TABLE public.capture_files (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  tenant_id            uuid        NOT NULL REFERENCES public.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  project_id           uuid        NOT NULL,
  document_id          uuid        NOT NULL,
  file_no              integer     NOT NULL CHECK (file_no > 0),
  source_message_sid   text        NOT NULL,
  media_index          integer     NOT NULL CHECK (media_index >= 0),
  claimed_content_type text,
  content_type         text,
  byte_size            bigint,
  sha256               text,
  storage_path         text,
  ingest_status        text        NOT NULL DEFAULT 'pending' CHECK (ingest_status IN ('pending', 'stored', 'rejected', 'failed')),
  reject_reason        text        CHECK (reject_reason IN ('wrong_type', 'too_large')),
  preview_state        text        CHECK (preview_state IN ('previewable', 'not_previewable')),
  CONSTRAINT capture_files_document_file_no_key UNIQUE (document_id, file_no),
  CONSTRAINT capture_files_sid_media_index_key UNIQUE (source_message_sid, media_index),
  CONSTRAINT capture_files_document_fk FOREIGN KEY (document_id, project_id, tenant_id) REFERENCES public.capture_documents (id, project_id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT capture_files_stored_complete_chk CHECK (ingest_status <> 'stored' OR (storage_path IS NOT NULL AND content_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL)),
  CONSTRAINT capture_files_rejected_reason_chk CHECK (ingest_status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT capture_files_stored_size_chk CHECK (ingest_status <> 'stored' OR byte_size <= 16777216),
  CONSTRAINT capture_files_content_type_chk CHECK (content_type IS NULL OR content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT capture_files_sha256_chk CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT capture_files_storage_path_prefix_chk CHECK (storage_path IS NULL OR starts_with(storage_path, tenant_id::text || '/' || project_id::text || '/' || document_id::text || '/'))
);

-- -----------------------------------------------------------------------------
-- deliveries. Points at its document (D-1): exactly one of dc_document_id /
-- created_from_invoice_id. received_at has NO default (D-22, D-25).
-- dc_doc_kind / inv_doc_kind are fixed-value columns, not generated (D-18):
-- MATCH SIMPLE skips the composite document FK whose pointer is NULL.
-- -----------------------------------------------------------------------------
-- [src: D-1, D-5, D-18, D-19, D-22, D-25, S-A, S4, C-29, D-23, D-29]
CREATE TABLE public.deliveries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  project_id              uuid        NOT NULL,
  reported_by             uuid        NOT NULL,
  received_at             timestamptz NOT NULL,
  delivery_date           date        GENERATED ALWAYS AS (timezone('Asia/Kolkata', received_at)::date) STORED,
  status                  text        NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'awaiting_pm', 'approved', 'rejected', 'cancelled')),
  delivery_type           text        CHECK (delivery_type IN ('supplier', 'internal_transfer')),
  vehicle_number          text        CHECK (char_length(vehicle_number) <= 64),
  dc_number               text        CHECK (char_length(dc_number) <= 64),
  dc_date                 date,
  dc_document_id          uuid,
  dc_doc_kind             text        NOT NULL DEFAULT 'dc' CHECK (dc_doc_kind = 'dc'),
  created_from_invoice_id uuid,
  inv_doc_kind            text        NOT NULL DEFAULT 'invoice' CHECK (inv_doc_kind = 'invoice'),
  approved_by             uuid,
  approved_at             timestamptz,
  rejected_by             uuid,
  rejected_at             timestamptz,
  reject_reason           text,
  cancelled_at            timestamptz,
  cancel_reason           text        CHECK (cancel_reason IN ('superseded_by_link')),
  CONSTRAINT deliveries_dc_document_id_key UNIQUE (dc_document_id),
  CONSTRAINT deliveries_created_from_invoice_id_key UNIQUE (created_from_invoice_id),
  CONSTRAINT deliveries_id_project_tenant_key UNIQUE (id, project_id, tenant_id),
  CONSTRAINT deliveries_id_created_from_invoice_key UNIQUE (id, created_from_invoice_id),
  CONSTRAINT deliveries_project_fk FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_reported_by_fk FOREIGN KEY (reported_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_approved_by_fk FOREIGN KEY (approved_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_rejected_by_fk FOREIGN KEY (rejected_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_dc_document_fk FOREIGN KEY (dc_document_id, project_id, tenant_id, dc_doc_kind) REFERENCES public.capture_documents (id, project_id, tenant_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_invoice_document_fk FOREIGN KEY (created_from_invoice_id, project_id, tenant_id, inv_doc_kind) REFERENCES public.capture_documents (id, project_id, tenant_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT deliveries_one_document_chk CHECK (num_nonnulls(dc_document_id, created_from_invoice_id) = 1),
  CONSTRAINT deliveries_approved_pair_chk CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT deliveries_approved_requires_chk CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND delivery_type IS NOT NULL)),
  CONSTRAINT deliveries_unapproved_no_approver_chk CHECK (status NOT IN ('incomplete', 'awaiting_pm', 'rejected') OR approved_by IS NULL),
  CONSTRAINT deliveries_rejected_requires_chk CHECK (status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND reject_reason IS NOT NULL AND btrim(reject_reason) <> '')),
  CONSTRAINT deliveries_rejected_clear_chk CHECK (status = 'rejected' OR (rejected_by IS NULL AND rejected_at IS NULL AND reject_reason IS NULL)),
  CONSTRAINT deliveries_cancelled_at_chk CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT deliveries_cancelled_reason_chk CHECK ((cancelled_at IS NOT NULL) = (cancel_reason IS NOT NULL)),
  CONSTRAINT deliveries_cancelled_auto_only_chk CHECK (status <> 'cancelled' OR created_from_invoice_id IS NOT NULL),
  CONSTRAINT deliveries_auto_not_internal_chk CHECK (created_from_invoice_id IS NULL OR delivery_type IS DISTINCT FROM 'internal_transfer'),
  CONSTRAINT deliveries_received_order_chk CHECK (received_at <= created_at),
  CONSTRAINT deliveries_approved_at_order_chk CHECK (approved_at IS NULL OR approved_at >= created_at),
  CONSTRAINT deliveries_rejected_at_order_chk CHECK (rejected_at IS NULL OR rejected_at >= created_at),
  CONSTRAINT deliveries_cancelled_at_order_chk CHECK (cancelled_at IS NULL OR cancelled_at >= created_at)
);

-- -----------------------------------------------------------------------------
-- delivery_invoice_links. Rows are never deleted and are updated only to
-- unlink (TR3). linked_by / unlinked_by / superseded_approval_by carry
-- composite FKs to users (S-A: restored after the v2 silent drop).
-- -----------------------------------------------------------------------------
-- [src: D-2, D-3, S-A, R2, Q2-5, R5, C-29, C-37, D-29]
CREATE TABLE public.delivery_invoice_links (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  project_id              uuid        NOT NULL,
  delivery_id             uuid        NOT NULL,
  invoice_document_id     uuid        NOT NULL,
  doc_kind                text        NOT NULL DEFAULT 'invoice' CHECK (doc_kind = 'invoice'),
  link_source             text        NOT NULL CHECK (link_source IN ('created_from_invoice', 'pm_manual')),
  linked_by               uuid,
  linked_at               timestamptz NOT NULL DEFAULT now(),
  unlinked_at             timestamptz,
  unlinked_by             uuid,
  unlink_reason           text        CHECK (unlink_reason IN ('superseded_by_link', 'pm_unlinked', 'delivery_rejected')),
  superseded_from_status  text        DEFAULT NULL::text CHECK (superseded_from_status IN ('incomplete', 'awaiting_pm', 'approved')),
  superseded_approval_by  uuid,
  superseded_approval_at  timestamptz,
  self_invoice_id         uuid        GENERATED ALWAYS AS (CASE WHEN link_source = 'created_from_invoice' THEN invoice_document_id END) STORED,
  CONSTRAINT dil_delivery_fk FOREIGN KEY (delivery_id, project_id, tenant_id) REFERENCES public.deliveries (id, project_id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_invoice_document_fk FOREIGN KEY (invoice_document_id, project_id, tenant_id, doc_kind) REFERENCES public.capture_documents (id, project_id, tenant_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_self_link_fk FOREIGN KEY (delivery_id, self_invoice_id) REFERENCES public.deliveries (id, created_from_invoice_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_linked_by_fk FOREIGN KEY (linked_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_unlinked_by_fk FOREIGN KEY (unlinked_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_superseded_approval_by_fk FOREIGN KEY (superseded_approval_by, tenant_id) REFERENCES public.users (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT dil_linked_by_pairing_chk CHECK ((link_source = 'pm_manual') = (linked_by IS NOT NULL)),
  CONSTRAINT dil_unlinked_pair_chk CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL)),
  CONSTRAINT dil_unlinked_order_chk CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at),
  CONSTRAINT dil_unlink_reason_pair_chk CHECK ((unlinked_at IS NULL) = (unlink_reason IS NULL)),
  CONSTRAINT dil_snapshot_status_chk CHECK ((superseded_from_status IS NOT NULL) = COALESCE(link_source = 'created_from_invoice' AND unlink_reason = 'superseded_by_link', false)),
  CONSTRAINT dil_snapshot_approver_chk CHECK ((superseded_approval_by IS NOT NULL) = (superseded_from_status IS NOT DISTINCT FROM 'approved')),
  CONSTRAINT dil_snapshot_approver_pair_chk CHECK ((superseded_approval_by IS NULL) = (superseded_approval_at IS NULL))
);

-- -----------------------------------------------------------------------------
-- Indexes. A33: a delivery has at most one active link (E8 = 23505 here).
-- N1: TR1's XOR scan needs an index on active links by invoice; the self-link
-- unique does not cover PM links.
-- -----------------------------------------------------------------------------
-- [src: N1, A33, E8, D-3, C-35]
CREATE UNIQUE INDEX uq_dil_active_per_delivery ON public.delivery_invoice_links (delivery_id) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX uq_dil_active_self_per_invoice ON public.delivery_invoice_links (invoice_document_id) WHERE link_source = 'created_from_invoice' AND unlinked_at IS NULL;
CREATE INDEX idx_dil_active_invoice ON public.delivery_invoice_links (invoice_document_id) WHERE unlinked_at IS NULL;
CREATE INDEX idx_deliveries_project_received ON public.deliveries (project_id, received_at DESC);
CREATE INDEX idx_deliveries_reported_by ON public.deliveries (reported_by);

-- -----------------------------------------------------------------------------
-- Trigger functions. Common rules (R4, D-7): SECURITY DEFINER, SET
-- search_path = '', every relation public.-qualified, RAISE codes only, plain
-- CREATE FUNCTION (never CREATE OR REPLACE: a same-name function must abort,
-- not be silently replaced), explicit per-role REVOKE below, no GRANT.
-- Reason for definer: an invariant check must not change behaviour with the
-- writer's grants (under invoker, prod service_role -- SELECT only -- would
-- get 42501 from the FOR SHARE lock in TR2 instead of the invariant verdict).
-- -----------------------------------------------------------------------------

-- [src: TR1, TR2, B2, B3, R3, R4, D-7, E1, E2, E3, E4, E5, E10, E14, A28, A34]
CREATE FUNCTION public.trg_dil_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status   text;
  v_type     text;
  v_auto_inv uuid;
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- B2: a forged INSERT cannot carry unlink or snapshot values.
  IF NEW.unlinked_at IS NOT NULL OR NEW.unlinked_by IS NOT NULL OR NEW.unlink_reason IS NOT NULL
     OR NEW.superseded_from_status IS NOT NULL OR NEW.superseded_approval_by IS NOT NULL
     OR NEW.superseded_approval_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
  END IF;

  -- Lock level 1: the invoice document row, FOR NO KEY UPDATE (R3).
  PERFORM 1 FROM public.capture_documents d WHERE d.id = NEW.invoice_document_id FOR NO KEY UPDATE;

  -- A28 XOR, written with <> so a later auto_match source needs no edit.
  IF EXISTS (
    SELECT 1 FROM public.delivery_invoice_links l
    WHERE l.invoice_document_id = NEW.invoice_document_id
      AND l.unlinked_at IS NULL
      AND (l.link_source = 'created_from_invoice') <> (NEW.link_source = 'created_from_invoice')
  ) THEN
    IF NEW.link_source = 'pm_manual' THEN
      RAISE EXCEPTION USING ERRCODE = 'QE001', MESSAGE = 'E1';
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'QE002', MESSAGE = 'E2';
    END IF;
  END IF;

  -- TR2 (same function, fixed order): FOR SHARE on the target delivery.
  SELECT d.status, d.delivery_type, d.created_from_invoice_id
    INTO v_status, v_type, v_auto_inv
    FROM public.deliveries d
   WHERE d.id = NEW.delivery_id
     FOR SHARE;
  IF FOUND THEN
    IF NEW.link_source = 'pm_manual' THEN
      IF v_auto_inv IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'QE004', MESSAGE = 'E4';
      ELSIF v_type = 'internal_transfer' THEN
        RAISE EXCEPTION USING ERRCODE = 'QE003', MESSAGE = 'E3';
      ELSIF v_status IN ('rejected', 'cancelled') THEN
        RAISE EXCEPTION USING ERRCODE = 'QE005', MESSAGE = 'E5';
      END IF;
    ELSIF v_status = 'rejected' THEN
      RAISE EXCEPTION USING ERRCODE = 'QE005', MESSAGE = 'E5';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- [src: TR3, B2, B3, R2, C-36, Q2-4, D-3, R4, D-7, E10, E14]
CREATE FUNCTION public.trg_dil_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status  text;
  v_appr_by uuid;
  v_appr_at timestamptz;
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- TR3 does not lock the delivery: it runs at lock level 3 (R3).
  -- Identity columns never change.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.invoice_document_id IS DISTINCT FROM OLD.invoice_document_id
     OR NEW.doc_kind IS DISTINCT FROM OLD.doc_kind
     OR NEW.link_source IS DISTINCT FROM OLD.link_source
     OR NEW.linked_by IS DISTINCT FROM OLD.linked_by
     OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
  END IF;

  -- An already-unlinked row is final: nothing set may change, unlinked_at
  -- can never be cleared.
  IF OLD.unlinked_at IS NOT NULL THEN
    IF NEW.unlinked_at IS DISTINCT FROM OLD.unlinked_at
       OR NEW.unlinked_by IS DISTINCT FROM OLD.unlinked_by
       OR NEW.unlink_reason IS DISTINCT FROM OLD.unlink_reason
       OR NEW.superseded_from_status IS DISTINCT FROM OLD.superseded_from_status
       OR NEW.superseded_approval_by IS DISTINCT FROM OLD.superseded_approval_by
       OR NEW.superseded_approval_at IS DISTINCT FROM OLD.superseded_approval_at THEN
      RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
    END IF;
    RETURN NEW;
  END IF;

  -- The row is active. No unlink in this UPDATE: the snapshot columns are
  -- forced NULL, never trusted from NEW (B2).
  IF NEW.unlinked_at IS NULL AND NEW.unlinked_by IS NULL AND NEW.unlink_reason IS NULL THEN
    NEW.superseded_from_status := NULL;
    NEW.superseded_approval_by := NULL;
    NEW.superseded_approval_at := NULL;
    RETURN NEW;
  END IF;

  -- The only allowed change: NULL -> value on unlinked_by + unlinked_at +
  -- unlink_reason TOGETHER.
  IF NEW.unlinked_at IS NULL OR NEW.unlinked_by IS NULL OR NEW.unlink_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
  END IF;

  -- Overwrite the snapshot from the delivery row (B2). Only a self-link
  -- unlinked as superseded_by_link records the delivery's pre-cancel state.
  IF OLD.link_source = 'created_from_invoice' AND NEW.unlink_reason = 'superseded_by_link' THEN
    SELECT d.status, d.approved_by, d.approved_at
      INTO v_status, v_appr_by, v_appr_at
      FROM public.deliveries d
     WHERE d.id = OLD.delivery_id;
    IF NOT FOUND OR NOT COALESCE(v_status IN ('incomplete', 'awaiting_pm', 'approved'), false) THEN
      RAISE EXCEPTION USING ERRCODE = 'QE010', MESSAGE = 'E10';
    END IF;
    NEW.superseded_from_status := v_status;
    IF v_status = 'approved' THEN
      NEW.superseded_approval_by := v_appr_by;
      NEW.superseded_approval_at := v_appr_at;
    ELSE
      NEW.superseded_approval_by := NULL;
      NEW.superseded_approval_at := NULL;
    END IF;
  ELSE
    NEW.superseded_from_status := NULL;
    NEW.superseded_approval_by := NULL;
    NEW.superseded_approval_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- [src: TR4a, TR4b, TR4c, D-6, D-23, S6, B1, B3, C-36, D-27, R3, R4, D-7, E6, E9, E11, E13, E14]
CREATE FUNCTION public.trg_deliveries_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- TR4a: immutable columns.
  IF NEW.created_from_invoice_id IS DISTINCT FROM OLD.created_from_invoice_id
     OR NEW.dc_document_id IS DISTINCT FROM OLD.dc_document_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
  END IF;

  -- Self-enforcing lock contract (R3): for an automatic delivery the first
  -- lock action is the invoice document, FOR NO KEY UPDATE. A correct caller
  -- already holds it (no-op); an out-of-order caller deadlocks (40P01)
  -- instead of racing silently. The unlocked read of created_from_invoice_id
  -- that finds the invoice is safe ONLY because TR4a above makes that column
  -- immutable.
  IF NEW.created_from_invoice_id IS NOT NULL THEN
    PERFORM 1 FROM public.capture_documents d WHERE d.id = NEW.created_from_invoice_id FOR NO KEY UPDATE;
  END IF;

  -- TR4b: no retype to internal_transfer while an active link exists.
  IF NEW.delivery_type = 'internal_transfer' AND OLD.delivery_type IS DISTINCT FROM 'internal_transfer' THEN
    IF EXISTS (SELECT 1 FROM public.delivery_invoice_links l WHERE l.delivery_id = NEW.id AND l.unlinked_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'QE006', MESSAGE = 'E6';
    END IF;
  END IF;

  -- TR4c (1): status transitions. Nothing leaves rejected.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'incomplete'  AND NEW.status IN ('awaiting_pm', 'approved', 'rejected', 'cancelled'))
      OR (OLD.status = 'awaiting_pm' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
      OR (OLD.status = 'approved'    AND NEW.status = 'cancelled')
      OR (OLD.status = 'cancelled'   AND NEW.status IN ('incomplete', 'awaiting_pm'))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
    -- TR4c (2)(3): B1 and C-36 -- no move to rejected/cancelled while ANY
    -- active link exists (DC or automatic): the paths unlink first.
    IF NEW.status IN ('rejected', 'cancelled') THEN
      IF EXISTS (SELECT 1 FROM public.delivery_invoice_links l WHERE l.delivery_id = NEW.id AND l.unlinked_at IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'QE013', MESSAGE = 'E13';
      END IF;
    END IF;
  END IF;

  -- TR4c (4): approved means locked (D-23). While OLD is approved or
  -- cancelled these four content fields are immutable.
  IF OLD.status IN ('approved', 'cancelled') THEN
    IF NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
       OR NEW.vehicle_number IS DISTINCT FROM OLD.vehicle_number
       OR NEW.dc_number IS DISTINCT FROM OLD.dc_number
       OR NEW.dc_date IS DISTINCT FROM OLD.dc_date THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- [src: TR5, D-6, B3, R3, R4, D-7, E9, E11, E14]
CREATE FUNCTION public.trg_capture_documents_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  IF NEW.kind IS DISTINCT FROM OLD.kind
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

  RETURN NEW;
END;
$$;

-- [src: TR1, TR3, TR4a, TR4b, TR4c, TR5]
CREATE TRIGGER tr_dil_before_insert BEFORE INSERT ON public.delivery_invoice_links
  FOR EACH ROW EXECUTE FUNCTION public.trg_dil_before_insert();
CREATE TRIGGER tr_dil_before_update BEFORE UPDATE ON public.delivery_invoice_links
  FOR EACH ROW EXECUTE FUNCTION public.trg_dil_before_update();
CREATE TRIGGER tr_deliveries_before_update BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.trg_deliveries_before_update();
CREATE TRIGGER tr_capture_documents_before_update BEFORE UPDATE ON public.capture_documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_documents_before_update();

-- -----------------------------------------------------------------------------
-- RLS (D-20, R7). One SELECT policy per table: the PMs of the row's project
-- only, with users.status = 'active'. QS excluded (Phase 2 role); admin sees
-- rows only as a PM member; deactivated/pending users read nothing. No write
-- policy exists: service_role bypasses RLS, so for it the grant layer below
-- is the only barrier.
-- -----------------------------------------------------------------------------
-- [src: D-20, R7, C-30]
ALTER TABLE public.capture_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capture_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_invoice_links ENABLE ROW LEVEL SECURITY;

-- [src: D-20, R7, C-30, D-5]
CREATE POLICY capture_documents_select ON public.capture_documents
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.users u ON u.id = pm.user_id
      WHERE pm.project_id = capture_documents.project_id
        AND pm.role = 'pm'
        AND u.auth_id = (SELECT auth.uid())
        AND u.status = 'active'
    )
  );

-- [src: D-20, R7, C-30, D-5]
CREATE POLICY capture_files_select ON public.capture_files
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.users u ON u.id = pm.user_id
      WHERE pm.project_id = capture_files.project_id
        AND pm.role = 'pm'
        AND u.auth_id = (SELECT auth.uid())
        AND u.status = 'active'
    )
  );

-- [src: D-20, R7, C-30, D-5]
CREATE POLICY deliveries_select ON public.deliveries
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.users u ON u.id = pm.user_id
      WHERE pm.project_id = deliveries.project_id
        AND pm.role = 'pm'
        AND u.auth_id = (SELECT auth.uid())
        AND u.status = 'active'
    )
  );

-- [src: D-20, R7, C-30, D-5]
CREATE POLICY delivery_invoice_links_select ON public.delivery_invoice_links
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      JOIN public.users u ON u.id = pm.user_id
      WHERE pm.project_id = delivery_invoice_links.project_id
        AND pm.role = 'pm'
        AND u.auth_id = (SELECT auth.uid())
        AND u.status = 'active'
    )
  );

-- -----------------------------------------------------------------------------
-- GRANTS. REVOKE ALL by name from anon, authenticated AND service_role on
-- each table first (the default ACL grants service_role every privilege and
-- anon/authenticated SELECT/INSERT/UPDATE per role, not via PUBLIC); then
-- only SELECT to authenticated and to service_role (D-8). Writes happen only
-- through PR-B SECURITY DEFINER functions. anon gets nothing.
-- -----------------------------------------------------------------------------
-- [src: D-8, R4, D-21, CLAUDE.md-s6-per-role-revoke]
REVOKE ALL ON public.capture_documents FROM anon, authenticated, service_role;
REVOKE ALL ON public.capture_files FROM anon, authenticated, service_role;
REVOKE ALL ON public.deliveries FROM anon, authenticated, service_role;
REVOKE ALL ON public.delivery_invoice_links FROM anon, authenticated, service_role;

GRANT SELECT ON public.capture_documents TO authenticated, service_role;
GRANT SELECT ON public.capture_files TO authenticated, service_role;
GRANT SELECT ON public.deliveries TO authenticated, service_role;
GRANT SELECT ON public.delivery_invoice_links TO authenticated, service_role;

-- Functions: REVOKE ALL by name from PUBLIC and each role. NO GRANT: a trigger
-- fires without the invoking role holding EXECUTE. (scripts/lint-migrations.mjs
-- rule no-orphan-security-definer expects a GRANT EXECUTE for every SECURITY
-- DEFINER function; trigger functions have no caller to grant to. OPEN item
-- O-1 in docs/reviews/049-review-package.md -- not resolved here.)
-- [src: R4, D-7, C-27]
REVOKE ALL ON FUNCTION public.trg_dil_before_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_dil_before_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_deliveries_before_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_capture_documents_before_update() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.capture_documents IS 'Capture engine slice 1a: one document (DC or invoice) per capture flow. Written only by PR-B definer functions. Business record, never pruned (D-29).';
COMMENT ON TABLE public.capture_files IS 'Capture engine slice 1a: one row per page/photo of a capture_documents row. Bytes live in the capture-documents bucket.';
COMMENT ON TABLE public.deliveries IS 'Capture engine slice 1a: a delivery points at its document (dc_document_id xor created_from_invoice_id).';
COMMENT ON TABLE public.delivery_invoice_links IS 'Capture engine slice 1a: invoice-to-delivery links; soft-unlinked, never deleted; the unlinked self-link row carries the supersession snapshot (D-2).';

-- -----------------------------------------------------------------------------
-- Bucket (D-9, D-10, D-11). Mirrors 042's INSERT, adding the two settings that
-- bucket lacks. ON CONFLICT DO NOTHING could silently keep a stale bucket, so
-- the assertion below checks the row actually has the approved settings.
-- No storage.objects policy, same as 042 (access is service_role plus app
-- membership checks). The bucket is a backstop; PR-C's byte checks decide
-- acceptance.
-- -----------------------------------------------------------------------------
-- [src: D-9, D-10, D-11, 042-precedent]
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-documents', 'capture-documents', false, 16777216,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_public boolean;
  v_limit  bigint;
  v_mimes  text[];
BEGIN
  SELECT b.public, b.file_size_limit, b.allowed_mime_types
    INTO v_public, v_limit, v_mimes
    FROM storage.buckets b
   WHERE b.id = 'capture-documents';
  IF NOT FOUND
     OR v_public IS DISTINCT FROM false
     OR v_limit IS DISTINCT FROM 16777216
     OR v_mimes IS DISTINCT FROM ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[] THEN
    RAISE EXCEPTION 'BUCKET_ASSERT';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- In-transaction ACL and function-fingerprint assertion (additive; aborts the
-- whole UP on any surprise). Tables: anon nothing; authenticated and
-- service_role SELECT only. Functions: nobody but the owner may EXECUTE;
-- prosecdef = true; proconfig pins search_path to the empty string.
-- -----------------------------------------------------------------------------
-- [src: R4, D-8, CLAUDE.md-s6-ACL-fingerprint]
DO $$
DECLARE
  v_t   text;
  v_r   text;
  v_p   text;
  v_f   text;
  v_bad text := '';
BEGIN
  FOREACH v_t IN ARRAY ARRAY['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links'] LOOP
    FOREACH v_r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      FOREACH v_p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        IF has_table_privilege(v_r, 'public.' || v_t, v_p) IS DISTINCT FROM (v_p = 'SELECT' AND v_r <> 'anon') THEN
          v_bad := v_bad || ' ' || v_t || ':' || v_r || ':' || v_p;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['trg_dil_before_insert', 'trg_dil_before_update', 'trg_deliveries_before_update', 'trg_capture_documents_before_update'] LOOP
    FOREACH v_r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(v_r, 'public.' || v_f || '()', 'EXECUTE') THEN
        v_bad := v_bad || ' ' || v_f || ':' || v_r || ':EXECUTE';
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = ('public.' || v_f || '()')::regprocedure
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=""']::text[]
    ) THEN
      v_bad := v_bad || ' ' || v_f || ':fingerprint';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ACL_ASSERT:%', v_bad;
  END IF;
END;
$$;

COMMIT;

-- [src: R8, S-D, D-29, C-31, down-order]
-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule). R8 + S-D. Order per plan v2 section 11.
--
-- TEST-DB PROCEDURE (S-D): scripts/test-db-only-capture-helpers.sql defines
-- functions whose bodies name these tables, so the intensional guard below
-- MUST trip while they exist (that is the correct outcome). Drop the helpers
-- first (that script's own DOWN), THEN run this block.
--
-- DOWN after real rows exist is data loss, not rollback; the answer there is
-- PITR, observed before the apply (CLAUDE.md section 0). Required cross-PR
-- DOWN order: C, B, A.
--
-- BEGIN;
--
-- DO $$
-- DECLARE
--   v_rows  bigint;
--   v_names text;
-- BEGIN
--   -- Guard 1: nothing to lose.
--   SELECT (SELECT count(*) FROM public.delivery_invoice_links)
--        + (SELECT count(*) FROM public.capture_files)
--        + (SELECT count(*) FROM public.deliveries)
--        + (SELECT count(*) FROM public.capture_documents)
--     INTO v_rows;
--   IF v_rows <> 0 THEN
--     RAISE EXCEPTION 'DOWN_GUARD_ROWS';
--   END IF;
--   -- Guard 2 (intensional, R8; restricted to non-system namespaces, S-D): no
--   -- function other than 049's own four trigger functions may name these
--   -- tables. plpgsql bodies record no dependency, so DROP TABLE alone would
--   -- leave broken functions behind. Catches renamed or later PR-B/PR-C/PR-D
--   -- functions without listing them.
--   SELECT string_agg(n.nspname || '.' || p.proname, ', ')
--     INTO v_names
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
--      AND n.nspname !~ '^pg_'
--      AND p.prosrc ~ '\m(deliveries|capture_documents|capture_files|delivery_invoice_links)\M'
--      AND NOT (n.nspname = 'public' AND p.proname IN (
--            'trg_dil_before_insert', 'trg_dil_before_update',
--            'trg_deliveries_before_update', 'trg_capture_documents_before_update'));
--   IF v_names IS NOT NULL THEN
--     RAISE EXCEPTION 'DOWN_GUARD_FUNCTIONS: %', v_names;
--   END IF;
-- END;
-- $$;
--
-- DROP TABLE public.delivery_invoice_links;
-- DROP TABLE public.capture_files;
-- DROP TABLE public.deliveries;
-- DROP TABLE public.capture_documents;
--
-- DROP FUNCTION public.trg_dil_before_insert();
-- DROP FUNCTION public.trg_dil_before_update();
-- DROP FUNCTION public.trg_deliveries_before_update();
-- DROP FUNCTION public.trg_capture_documents_before_update();
--
-- -- Ledger: in the same transaction, so `migration list` never shows 049
-- -- applied with no objects (R8).
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '049';
--
-- -- Bucket: zero objects, then delete. Supabase Storage may refuse a direct
-- -- SQL delete on storage.*; the disposable scaffold stubs storage and cannot
-- -- show that (block 2b executes this on test-db). If refused, remove the
-- -- bucket through the Storage API instead.
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'capture-documents') THEN
--     RAISE EXCEPTION 'DOWN_GUARD_BUCKET_OBJECTS';
--   END IF;
-- END;
-- $$;
-- DELETE FROM storage.buckets WHERE id = 'capture-documents';
--
-- COMMIT;
-- [/src]
