-- legacy-post.sql -- 052 dry-run: checks AFTER 052 was applied over the legacy rows.
-- LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST.
\pset pager off
\set ECHO none
\echo == LEGACY post-apply checks
SELECT t.ok('both legacy documents are kind_source engineer_declared with NULL kind_set_at / kind_set_by',
  (SELECT count(*) = 2 FROM public.capture_documents WHERE kind_source = 'engineer_declared' AND kind_set_at IS NULL AND kind_set_by IS NULL AND kind IS NOT NULL));
SELECT t.ok('each document received_at equals its own delivery received_at (lossless copy)',
  (SELECT count(*) = 2 FROM public.capture_documents d JOIN public.deliveries x ON (x.dc_document_id = d.id OR x.created_from_invoice_id = d.id) WHERE d.received_at = x.received_at));
SELECT t.ok('received_at <= created_at on both', (SELECT count(*) = 2 FROM public.capture_documents WHERE received_at <= created_at));
SELECT 'classify legacy DC, same kind      ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', '50000000-0000-0000-0000-000000000001', 'dc')) AS r;
SELECT 'classify legacy invoice, same kind ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', '50000000-0000-0000-0000-000000000002', 'invoice')) AS r;
SELECT 'classify legacy DC, other kind     ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', '50000000-0000-0000-0000-000000000001', 'invoice')) AS r;
SELECT t.ok('legacy classify wrote nothing: still 2 documents, 2 deliveries, 1 link, kind_source unchanged',
  (SELECT count(*) = 2 FROM public.capture_documents WHERE kind_source = 'engineer_declared') AND (SELECT count(*) = 2 FROM public.deliveries) AND (SELECT count(*) = 1 FROM public.delivery_invoice_links));
SELECT 'owner UPDATE kind on a legacy row  ' || t.try('UPDATE public.capture_documents SET kind = ''invoice'' WHERE id = ''50000000-0000-0000-0000-000000000001''') AS r;
SELECT 'owner UPDATE kind_source to pm     ' || t.try('UPDATE public.capture_documents SET kind_source = ''pm'' WHERE id = ''50000000-0000-0000-0000-000000000001''') AS r;
