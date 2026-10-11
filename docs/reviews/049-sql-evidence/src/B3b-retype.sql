\pset tuples_only on
\pset format unaligned
SELECT 'RETYPE session pid=' || pg_backend_pid() || ' start ' || clock_timestamp()::time(3);
BEGIN;
SELECT current_setting('transaction_isolation') AS isolation;
UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V1}';
SELECT 'RETYPE updated (uncommitted), sleeping 4s ' || clock_timestamp()::time(3);
SELECT pg_sleep(4);
COMMIT;
SELECT 'RETYPE committed ' || clock_timestamp()::time(3);
