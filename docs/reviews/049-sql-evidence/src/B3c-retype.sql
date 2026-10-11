\pset tuples_only on
\pset format unaligned
SELECT 'RETYPE(RR) session pid=' || pg_backend_pid() || ' start ' || clock_timestamp()::time(3);
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT current_setting('transaction_isolation') AS isolation;
SELECT 'links seen by my snapshot: ' || count(*) FROM public.delivery_invoice_links;
SELECT 'RETYPE(RR) snapshot taken, sleeping 4s ' || clock_timestamp()::time(3);
SELECT pg_sleep(4);
SELECT 'links seen by my snapshot after the sleep (the LINK has committed meanwhile): ' || count(*) FROM public.delivery_invoice_links;
SELECT t.expect('RETYPE of V1 under REPEATABLE READ is refused E14', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V1}'$$, 'E14');
COMMIT;
SELECT 'RETYPE(RR) finished ' || clock_timestamp()::time(3);
