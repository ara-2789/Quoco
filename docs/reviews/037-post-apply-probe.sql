-- Post-apply verification for migration 037 on test-db. Same one-result-
-- set shape as 036-post-apply-probe.sql, for the same reason.
SELECT 'column: ' || column_name AS check,
       'type=' || data_type || ' nullable=' || is_nullable || ' default=' || COALESCE(column_default, 'NULL') AS result
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name = 'pm_notified_at'
UNION ALL
SELECT 'comment: ' || column_name, COALESCE(col_description('hindrances'::regclass, ordinal_position), 'NULL')
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name = 'pm_notified_at'
ORDER BY 1;
