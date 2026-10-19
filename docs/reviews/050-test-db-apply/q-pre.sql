WITH f AS (
  SELECT 'morning' AS k, 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure AS o
  UNION ALL
  SELECT 'evening', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure
)
SELECT jsonb_build_object(
  'live', (SELECT jsonb_agg(jsonb_build_object(
      'fn', f.k,
      'md5', md5(pg_get_functiondef(f.o)),
      'proacl', (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = f.o),
      'proconfig', (SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = f.o),
      'owner', (SELECT p.proowner::regrole::text FROM pg_proc p WHERE p.oid = f.o),
      'anon', has_function_privilege('anon', f.o, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', f.o, 'EXECUTE'),
      'service_role', has_function_privilege('service_role', f.o, 'EXECUTE')
    ) ORDER BY f.k) FROM f),
  'new_names_present', (SELECT coalesce(jsonb_agg(proname), '[]'::jsonb) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details','pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice')),
  'invoice_sessions', (SELECT count(*) FROM public.whatsapp_sessions WHERE current_flow = 'invoice'),
  'ledger_049_050', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name, 'statements', coalesce(array_length(statements,1),0)) ORDER BY version), '[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version IN ('049','050')),
  'current_flow_check', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.whatsapp_sessions'::regclass AND conname = 'whatsapp_sessions_current_flow_check')
) AS pre;
