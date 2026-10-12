-- 049 ledger readback (read-only). Run after each ledger step (runbook steps E and F).
-- Expected: top row 049 / capture_tables / statements NOT NULL (written by `migration repair`
-- from supabase/migrations/049_capture_tables.sql), then 048, 047.
BEGIN;
SET TRANSACTION READ ONLY;
SELECT version, name,
       CASE WHEN statements IS NULL THEN 'NULL' ELSE array_length(statements, 1)::text END AS n_statements,
       (SELECT count(*) FROM supabase_migrations.schema_migrations)::text AS ledger_rows
  FROM supabase_migrations.schema_migrations
 ORDER BY version DESC
 LIMIT 3;
ROLLBACK;
