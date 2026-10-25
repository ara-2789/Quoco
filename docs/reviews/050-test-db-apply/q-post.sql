WITH f AS (
  SELECT 'apply_material_inward_turn' AS k, 'public.apply_material_inward_turn(text,uuid,uuid,uuid,text,text,jsonb,boolean,timestamptz,integer)'::regprocedure AS o
  UNION ALL SELECT 'expire_stale_material_inward', 'public.expire_stale_material_inward(text,timestamptz)'::regprocedure
  UNION ALL SELECT 'pm_set_delivery_details', 'public.pm_set_delivery_details(uuid,text,text,text,date)'::regprocedure
  UNION ALL SELECT 'pm_approve_delivery', 'public.pm_approve_delivery(uuid)'::regprocedure
  UNION ALL SELECT 'pm_reject_delivery', 'public.pm_reject_delivery(uuid,text)'::regprocedure
  UNION ALL SELECT 'pm_link_invoice', 'public.pm_link_invoice(uuid,uuid[])'::regprocedure
  UNION ALL SELECT 'pm_unlink_invoice', 'public.pm_unlink_invoice(uuid)'::regprocedure
  UNION ALL SELECT 'apply_morning_flow_turn', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure
  UNION ALL SELECT 'apply_evening_flow_turn', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure
)
SELECT jsonb_build_object(
  'functions', (SELECT jsonb_agg(jsonb_build_object(
      'fn', f.k,
      'rows_in_public_by_name', (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname = f.k),
      'prosecdef', p.prosecdef,
      'proconfig', p.proconfig::text,
      'owner', p.proowner::regrole::text,
      'proacl', p.proacl::text,
      'anon', has_function_privilege('anon', f.o, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', f.o, 'EXECUTE'),
      'service_role', has_function_privilege('service_role', f.o, 'EXECUTE'),
      'md5_def', CASE WHEN f.k IN ('apply_morning_flow_turn','apply_evening_flow_turn') THEN md5(pg_get_functiondef(f.o)) END
    ) ORDER BY f.k) FROM f JOIN pg_proc p ON p.oid = f.o),
  'ledger_049_050', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name, 'statements', coalesce(array_length(statements,1),0)) ORDER BY version), '[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version IN ('049','050')),
  'invoice_sessions', (SELECT count(*) FROM public.whatsapp_sessions WHERE current_flow = 'invoice')
) AS post;
