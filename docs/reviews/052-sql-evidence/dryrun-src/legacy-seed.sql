-- legacy-seed.sql -- 052 dry-run: legacy rows seeded PRE-052 (old triggers, old columns).
-- LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST.
\pset pager off
\set ECHO none
\echo == LEGACY seed (pre-052): one DC with its delivery, one invoice with automatic delivery and self-link
SELECT t.mk_dc('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'L-dc1') AS dc_delivery;
SELECT t.mk_inv('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'L-inv1') AS inv_doc;
SELECT 'legacy documents=' || count(*) || ' deliveries=' || (SELECT count(*) FROM public.deliveries) || ' links=' || (SELECT count(*) FROM public.delivery_invoice_links) FROM public.capture_documents;
