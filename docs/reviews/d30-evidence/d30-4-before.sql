-- =============================================================================
-- d30-4-before.sql  --  PART B: D-30 before-snapshot. READ-ONLY, ONE plain SELECT (UNION ALL of k/v rows).
-- Run in the Supabase SQL editor on PROD jvxwqignooseazzmwhvl. No parameters: the Speed Mechatronics
-- lookup is by name (projects.name ILIKE '%speed mechatronics%', 001_core_schema.sql:52, name TEXT NOT NULL),
-- and EVERY match is shown. Aravind confirms which project_id is the D-30 one; section 2 counts are given
-- for every match so nothing here depends on that choice being made first.
-- The 'snapshot' row is the :snapshot_ts for d30-4-after.sql (copy its value exactly).
-- Scoping: capture_documents / capture_files / deliveries / delivery_invoice_links / daily_logs /
--   project_members carry project_id (049_capture_tables.sql:281,312,347,403; 001:99,72); whatsapp_sessions,
--   users, projects carry tenant_id (001:86,36,52); tenants is matched by id. jobs has NO tenant_id or
--   project_id column (006_jobs_queue.sql:4-14): its project scope is payload->>'project_id', which exists only
--   on capture_ingest jobs (050_material_inward_functions.sql:378-385), so the 'scoped' jobs row is that subset
--   and the global row is the whole table.
-- =============================================================================
WITH mp AS (
  SELECT p.id AS project_id, p.tenant_id, p.name AS project_name, p.created_at AS project_created_at
    FROM public.projects p
   WHERE p.name ILIKE '%speed mechatronics%'
), mt AS (SELECT DISTINCT tenant_id FROM mp)
SELECT o, k, v FROM (
  SELECT 0 AS o, 'snapshot (use as :snapshot_ts)' AS k, now()::text AS v

  UNION ALL
  SELECT 1, 'match ' || mp.project_id::text,
         'tenant_id=' || mp.tenant_id::text || ' tenant_name=' || COALESCE(t.name, '?')
         || ' project_name=' || mp.project_name || ' project_created_at=' || COALESCE(mp.project_created_at::text, 'NULL')
    FROM mp LEFT JOIN public.tenants t ON t.id = mp.tenant_id
  UNION ALL
  SELECT 1, 'matches found', count(*)::text FROM mp

  -- section 2: global
  UNION ALL SELECT 2, 'global capture_documents',      'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.capture_documents
  UNION ALL SELECT 2, 'global capture_files',          'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.capture_files
  UNION ALL SELECT 2, 'global deliveries',             'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.deliveries
  UNION ALL SELECT 2, 'global delivery_invoice_links', 'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.delivery_invoice_links
  UNION ALL SELECT 2, 'global jobs',                   'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.jobs
  UNION ALL SELECT 2, 'global whatsapp_sessions',      'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') || ' max_updated_at=' || COALESCE(max(updated_at)::text, 'NULL') FROM public.whatsapp_sessions
  UNION ALL SELECT 2, 'global daily_logs',             'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.daily_logs
  UNION ALL SELECT 2, 'global users',                  'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.users
  UNION ALL SELECT 2, 'global project_members',        'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.project_members
  UNION ALL SELECT 2, 'global projects',               'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.projects
  UNION ALL SELECT 2, 'global tenants',                'n=' || count(*) || ' max_created_at=' || COALESCE(max(created_at)::text, 'NULL') FROM public.tenants

  -- section 3: scoped to each matched project / its tenant
  UNION ALL SELECT 3, 'scoped capture_documents '      || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.capture_documents x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped capture_files '          || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.capture_files x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped deliveries '             || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.deliveries x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped delivery_invoice_links ' || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.delivery_invoice_links x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped daily_logs '             || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.daily_logs x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped project_members '        || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.project_members x ON x.project_id = mp.project_id GROUP BY mp.project_id
  UNION ALL SELECT 3, 'scoped jobs (payload.project_id) ' || mp.project_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mp LEFT JOIN public.jobs x ON x.payload ->> 'project_id' = mp.project_id::text GROUP BY mp.project_id
  UNION ALL SELECT 3, 'tenant-scoped whatsapp_sessions ' || mt.tenant_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') || ' max_updated_at=' || COALESCE(max(x.updated_at)::text, 'NULL') FROM mt LEFT JOIN public.whatsapp_sessions x ON x.tenant_id = mt.tenant_id GROUP BY mt.tenant_id
  UNION ALL SELECT 3, 'tenant-scoped users '           || mt.tenant_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mt LEFT JOIN public.users x ON x.tenant_id = mt.tenant_id GROUP BY mt.tenant_id
  UNION ALL SELECT 3, 'tenant-scoped projects '        || mt.tenant_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mt LEFT JOIN public.projects x ON x.tenant_id = mt.tenant_id GROUP BY mt.tenant_id
  UNION ALL SELECT 3, 'tenants (matched) '             || mt.tenant_id::text, 'n=' || count(x.id) || ' max_created_at=' || COALESCE(max(x.created_at)::text, 'NULL') FROM mt LEFT JOIN public.tenants x ON x.id = mt.tenant_id GROUP BY mt.tenant_id

  -- section 4: latest job (whole table, no scope exists)
  UNION ALL
  SELECT 4, 'latest job (created_at desc, id desc)',
         COALESCE((SELECT 'id=' || j.id::text || ' type=' || j.type || ' status=' || j.status || ' created_at=' || j.created_at::text
                     FROM public.jobs j ORDER BY j.created_at DESC, j.id DESC LIMIT 1), 'jobs table empty')
) x
ORDER BY o, k;
