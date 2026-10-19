SELECT jsonb_build_object(
  'md5_morning', md5(pg_get_functiondef('public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure)),
  'md5_evening', md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure)),
  'acl_morning', (SELECT proacl::text FROM pg_proc WHERE oid = 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure),
  'acl_evening', (SELECT proacl::text FROM pg_proc WHERE oid = 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure),
  'new_functions_left', (SELECT coalesce(jsonb_agg(proname), '[]'::jsonb) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details','pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice')),
  'invoice_sessions', (SELECT count(*) FROM public.whatsapp_sessions WHERE current_flow = 'invoice'),
  'rows_with_flag_or_mi_keys', (SELECT count(*) FROM public.whatsapp_sessions WHERE context ?| ARRAY['mi_last_sid','mi_kind','mi_document_id','mi_reask','invoice_reset_guard']),
  'ledger_049_050', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version), '[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version IN ('049','050'))
) AS after;
