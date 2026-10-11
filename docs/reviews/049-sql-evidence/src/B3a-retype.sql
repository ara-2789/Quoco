\pset tuples_only on
\pset format unaligned
SELECT 'RETYPE session pid=' || pg_backend_pid() || ' start ' || clock_timestamp()::time(3);
SELECT current_setting('transaction_isolation') AS isolation;
SELECT t.expect('RETYPE of V1 to internal_transfer is refused E6 once the LINK commits', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V1}'$$, 'E6');
SELECT 'RETYPE finished ' || clock_timestamp()::time(3);
