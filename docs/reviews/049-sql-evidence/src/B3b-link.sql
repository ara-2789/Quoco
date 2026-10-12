\pset tuples_only on
\pset format unaligned
SELECT 'LINK session pid=' || pg_backend_pid() || ' start ' || clock_timestamp()::time(3);
SELECT current_setting('transaction_isolation') AS isolation;
SELECT t.expect('LINK of D2 to V1 is refused E3 once the RETYPE commits', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L1}', '{T1}', '{P1}', '{V1}', '{D2}', 'pm_manual', '{U.PM1}')$$, 'E3');
SELECT 'LINK finished ' || clock_timestamp()::time(3);
