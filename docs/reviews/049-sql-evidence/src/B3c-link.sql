\pset tuples_only on
\pset format unaligned
SELECT 'LINK session pid=' || pg_backend_pid() || ' start ' || clock_timestamp()::time(3);
SELECT current_setting('transaction_isolation') AS isolation;
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L1}', '{T1}', '{P1}', '{V1}', '{D2}', 'pm_manual', '{U.PM1}');
SELECT 'LINK committed (autocommit) ' || clock_timestamp()::time(3);
