-- Post-apply verification for migration 036 on test-db. ONE result set
-- (UNION ALL, normalized to check/result text pairs) -- `supabase db
-- query --linked -f` only surfaces the LAST statement's output, found the
-- hard way running the schema-vs-ledger diagnostic; this avoids that.
SELECT 'column: ' || column_name AS check,
       'type=' || data_type || ' nullable=' || is_nullable || ' default=' || COALESCE(column_default, 'NULL') AS result
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing', 'timing_raw', 'submitted_via')
UNION ALL
SELECT 'constraint: ' || conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'hindrances'::regclass
   AND conname IN ('hindrances_timing_raw_pairing_check', 'hindrances_timing_check', 'hindrances_submitted_via_check')
UNION ALL
SELECT 'comment: ' || column_name, COALESCE(col_description('hindrances'::regclass, ordinal_position), 'NULL')
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing', 'timing_raw', 'submitted_via')
ORDER BY 1;
