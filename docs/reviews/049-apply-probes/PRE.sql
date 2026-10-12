-- 049 apply probe PRE (read-only). Run against PROD before the apply (runbook step B).
-- One SELECT, columns (k, v), so the CLI cannot collapse same-named columns (the P10 lesson, D-17).
-- PROCEED only if every line equals the expected value in docs/reviews/049-prod-apply-runbook.md step B.
BEGIN;
SET TRANSACTION READ ONLY;
SELECT k, v FROM (
  SELECT 1 AS o, 'server_version' AS k, current_setting('server_version') AS v
  UNION ALL
  SELECT 2, 'P3 whatsapp_sessions current_flow=invoice', count(*)::text
    FROM public.whatsapp_sessions WHERE current_flow = 'invoice'
  UNION ALL
  SELECT 3, 'P10 public.' || t, COALESCE(to_regclass('public.' || t)::text, 'absent')
    FROM unnest(ARRAY['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links']) AS t
  UNION ALL
  SELECT 4, 'fn public.' || f, count(p.oid)::text
    FROM unnest(ARRAY['trg_dil_before_insert', 'trg_dil_before_update', 'trg_deliveries_before_update',
                      'trg_capture_documents_before_update', 'trg_deliveries_before_insert',
                      'trg_capture_documents_before_insert']) AS f
    LEFT JOIN pg_proc p ON p.proname = f AND p.pronamespace = 'public'::regnamespace
   GROUP BY f
  UNION ALL
  SELECT 5, 'bucket capture-documents rows', count(*)::text FROM storage.buckets WHERE id = 'capture-documents'
  UNION ALL
  SELECT 5, 'objects in bucket capture-documents', count(*)::text FROM storage.objects WHERE bucket_id = 'capture-documents'
  UNION ALL
  SELECT 6, 'ledger max version', max(version) FROM supabase_migrations.schema_migrations
  UNION ALL
  SELECT 6, 'ledger 049 rows', count(*)::text FROM supabase_migrations.schema_migrations WHERE version = '049'
  UNION ALL
  SELECT 6, 'ledger rows', count(*)::text FROM supabase_migrations.schema_migrations
  UNION ALL
  SELECT 7, 'public tables', count(*)::text FROM pg_tables WHERE schemaname = 'public'
  UNION ALL
  SELECT 7, 'public functions', count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 7, 'storage buckets', count(*)::text FROM storage.buckets
) x
ORDER BY o, k;
ROLLBACK;
