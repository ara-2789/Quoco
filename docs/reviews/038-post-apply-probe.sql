-- Post-apply verification for migration 038 on PROD. ONE result set (UNION
-- ALL, normalized to check/result text pairs) -- same shape as
-- 036-post-apply-probe.sql / 037-post-apply-probe.sql, for the same reason:
-- `supabase db query --linked -f` (and, per this file's use case, a
-- multi-statement SQL Editor paste too) only surfaces the LAST statement's
-- output.
--
-- Covers, in this order: function existence + exact signature (3 functions),
-- the two composite same-tenant FK constraints, EXECUTE grants for
-- anon/authenticated/service_role across all three functions, and COMMENT
-- text on the three functions. On COMMENT: 038 adds no `COMMENT ON FUNCTION`
-- statement for any of the three (confirmed by direct read of the file --
-- unlike 036/037, which both carry extensive COMMENT ON COLUMN text) -- so
-- every comment row below is EXPECTED to read 'NULL'. A non-NULL value there
-- would itself be a signal something unexpected is live.
SELECT 'function exists: ' || p.proname AS check,
       'args=(' || pg_get_function_identity_arguments(p.oid) || ')' AS result
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('apply_hindrance_flow_turn', 'apply_morning_flow_turn', 'apply_evening_flow_turn')

UNION ALL

SELECT 'constraint: ' || conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.hindrances'::regclass
   AND conname IN ('hindrances_project_id_fkey', 'hindrances_reported_by_fkey')

UNION ALL

SELECT 'grant: anon EXECUTE ' || fn, has_function_privilege('anon', fn_regprocedure, 'EXECUTE')::text
  FROM (VALUES
    ('apply_hindrance_flow_turn', 'public.apply_hindrance_flow_turn(text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer)'::regprocedure),
    ('apply_morning_flow_turn',   'public.apply_morning_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer)'::regprocedure),
    ('apply_evening_flow_turn',   'public.apply_evening_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer)'::regprocedure)
  ) AS fns(fn, fn_regprocedure)

UNION ALL

SELECT 'grant: authenticated EXECUTE ' || fn, has_function_privilege('authenticated', fn_regprocedure, 'EXECUTE')::text
  FROM (VALUES
    ('apply_hindrance_flow_turn', 'public.apply_hindrance_flow_turn(text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer)'::regprocedure),
    ('apply_morning_flow_turn',   'public.apply_morning_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer)'::regprocedure),
    ('apply_evening_flow_turn',   'public.apply_evening_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer)'::regprocedure)
  ) AS fns(fn, fn_regprocedure)

UNION ALL

SELECT 'grant: service_role EXECUTE ' || fn, has_function_privilege('service_role', fn_regprocedure, 'EXECUTE')::text
  FROM (VALUES
    ('apply_hindrance_flow_turn', 'public.apply_hindrance_flow_turn(text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer)'::regprocedure),
    ('apply_morning_flow_turn',   'public.apply_morning_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer)'::regprocedure),
    ('apply_evening_flow_turn',   'public.apply_evening_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer)'::regprocedure)
  ) AS fns(fn, fn_regprocedure)

UNION ALL

SELECT 'comment: ' || fn, COALESCE(obj_description(fn_regprocedure, 'pg_proc'), 'NULL')
  FROM (VALUES
    ('apply_hindrance_flow_turn', 'public.apply_hindrance_flow_turn(text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer)'::regprocedure),
    ('apply_morning_flow_turn',   'public.apply_morning_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer)'::regprocedure),
    ('apply_evening_flow_turn',   'public.apply_evening_flow_turn(text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer)'::regprocedure)
  ) AS fns(fn, fn_regprocedure)

ORDER BY 1;
