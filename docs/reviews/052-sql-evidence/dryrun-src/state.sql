-- state.sql -- what is (not) there: the three function md5s and every 052 object, as one block of lines.
-- LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST.
\pset pager off
\pset tuples_only on
SELECT 'md5 ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('apply_material_inward_turn', 'trg_capture_documents_before_insert', 'trg_capture_documents_before_update') ORDER BY p.proname;
SELECT '052 objects: schema_private=' || EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private')
  || ' wrapper=' || EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pm_classify_document')
  || ' helper=' || EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'capture_apply_classification')
  || ' new_columns=' || (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.capture_documents'::regclass AND NOT attisdropped AND attname IN ('kind_source', 'kind_set_at', 'kind_set_by', 'received_at'))
  || ' constraints=' || (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.capture_documents'::regclass AND conname IN ('capture_documents_kind_provenance_chk', 'capture_documents_kind_set_order_chk', 'capture_documents_received_order_chk', 'capture_documents_kind_set_by_fk'))
  || ' kind_not_null=' || (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.capture_documents'::regclass AND attname = 'kind')
  || ' ledger_052=' || EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '052');
SELECT 'rows: documents=' || (SELECT count(*) FROM public.capture_documents) || ' deliveries=' || (SELECT count(*) FROM public.deliveries)
  || ' links=' || (SELECT count(*) FROM public.delivery_invoice_links) || ' sessions_invoice=' || (SELECT count(*) FROM public.whatsapp_sessions WHERE current_flow = 'invoice');
