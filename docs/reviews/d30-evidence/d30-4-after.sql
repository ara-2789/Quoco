-- =============================================================================
-- d30-4-after.sql  --  D-30 after-check. READ-ONLY, ONE plain SELECT (UNION ALL of k/v rows).
-- Run in the Supabase SQL editor on PROD jvxwqignooseazzmwhvl AFTER the D-30 run.
-- PARAMETERS (placeholders only; replace the three <<...>> literals in the `params` CTE below, nowhere else.
-- Left unreplaced, the casts fail loudly instead of running against a wrong value):
--   :snapshot_ts    <<SNAPSHOT_TS>>     the 'snapshot' row value from d30-4-before.sql
--   :project_id     <<PROJECT_ID>>      the Speed Mechatronics project id Aravind confirmed
--   :aravind_phone  <<ARAVIND_PHONE>>   Aravind's number; compared DIGITS ONLY (so +91.., whatsapp:+91.. and
--                                       spaces all compare equal). ASSUMPTION: users.whatsapp_number
--                                       (001_core_schema.sql:43) and whatsapp_sessions.phone_number (:91) hold the
--                                       same number in some format; if one is stored differently, section 9 will say so.
-- Section 8 reads storage.objects (Supabase-managed; the SQL editor's role can SELECT it). Phones are never printed; offending rows are reported by id only.
-- WHAT CANNOT BE A SELECT: quarantine events and markedCount. They are Sentry messages
--   ('capture_ingest: <kind>' with extra markedCount, lib/media/capture-ingest.ts:376-377, :772-779), not DB rows.
--   The DB-side trace of a quarantine is capture_files.ingest_status = 'failed' (markFailed, capture-ingest.ts:557-561);
--   section 6 counts those. markedCount for a run should equal that count; the event itself is read in Sentry.
-- =============================================================================
WITH params AS (
  SELECT '<<SNAPSHOT_TS>>'::timestamptz AS snap,
         '<<PROJECT_ID>>'::uuid         AS pid,
         regexp_replace('<<ARAVIND_PHONE>>', '\D', '', 'g') AS aphone
), proj AS (
  SELECT p.id, p.tenant_id FROM public.projects p JOIN params ON p.id = params.pid
), cd AS (SELECT x.* FROM public.capture_documents x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   cf AS (SELECT x.* FROM public.capture_files x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   dv AS (SELECT x.* FROM public.deliveries x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   dl AS (SELECT x.* FROM public.delivery_invoice_links x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   lg AS (SELECT x.* FROM public.daily_logs x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   jb AS (SELECT x.* FROM public.jobs x, params WHERE x.created_at > params.snap),
   ws AS (SELECT x.* FROM public.whatsapp_sessions x, params, proj
           WHERE x.tenant_id = proj.tenant_id AND (x.created_at > params.snap OR x.updated_at > params.snap))
SELECT o, k, v FROM (
  SELECT 0 AS o, 'params check (project found / snapshot / now)' AS k,
         'project_found=' || (SELECT count(*) FROM proj) || ' snapshot=' || (SELECT snap::text FROM params) || ' now=' || now()::text AS v

  -- 1: new rows per table, with ids
  UNION ALL SELECT 1, 'new capture_documents',      'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM cd
  UNION ALL SELECT 1, 'new capture_files',          'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM cf
  UNION ALL SELECT 1, 'new deliveries',             'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM dv
  UNION ALL SELECT 1, 'new delivery_invoice_links', 'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM dl
  UNION ALL SELECT 1, 'new daily_logs',             'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM lg
  UNION ALL SELECT 1, 'new jobs (whole table; jobs has no project column)', 'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM jb
  UNION ALL SELECT 1, 'whatsapp_sessions created-or-updated since snapshot (tenant of project)', 'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-') FROM ws

  -- 2: the PDF row(s): every new capture_files row, with the fields asked for
  UNION ALL
  SELECT 2, 'file ' || cf.id::text,
         'content_type=' || COALESCE(cf.content_type, 'NULL')
         || ' claimed_content_type=' || COALESCE(cf.claimed_content_type, 'NULL')
         || ' is_pdf=' || COALESCE((cf.content_type = 'application/pdf')::text, 'NULL')
         || ' storage_path_present=' || (cf.storage_path IS NOT NULL)::text
         || ' storage_path=' || COALESCE(cf.storage_path, 'NULL')
         || ' byte_size=' || COALESCE(cf.byte_size::text, 'NULL')
         || ' byte_size_gt_0=' || COALESCE((cf.byte_size > 0)::text, 'NULL')
         || ' ingest_status=' || cf.ingest_status
         || ' reject_reason=' || COALESCE(cf.reject_reason, 'NULL')
         || ' sha256_present=' || (cf.sha256 IS NOT NULL)::text
         || ' ingested_at=' || COALESCE(cf.ingested_at::text, 'NULL')
         || ' file_no=' || cf.file_no::text || ' media_index=' || cf.media_index::text
         || ' document_id=' || cf.document_id::text
    FROM cf

  -- 3: ingest_status tally of the new files
  UNION ALL
  SELECT 3, 'new capture_files by ingest_status', COALESCE(string_agg(s || '=' || n, ' ' ORDER BY s), 'none')
    FROM (SELECT ingest_status AS s, count(*) AS n FROM cf GROUP BY 1) q

  -- 6: DB-side trace of quarantine (see header: the Sentry event itself is not a table)
  UNION ALL
  SELECT 6, 'quarantined files in project since snapshot (ingest_status=failed, DB proxy for sum(markedCount))',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-')
    FROM cf WHERE ingest_status = 'failed'

  -- 7: jobs created since snapshot
  UNION ALL
  SELECT 7, 'job ' || jb.id::text,
         'type=' || jb.type || ' status=' || jb.status || ' attempt_count=' || jb.attempt_count::text
         || ' created_at=' || jb.created_at::text || ' completed_at=' || COALESCE(jb.completed_at::text, 'NULL')
         || ' last_error=' || COALESCE(left(jb.last_error, 300), 'NULL')
    FROM jb
  UNION ALL
  SELECT 7, 'jobs by status since snapshot', COALESCE(string_agg(s || '=' || n, ' ' ORDER BY s), 'none')
    FROM (SELECT status AS s, count(*) AS n FROM jb GROUP BY 1) q
  UNION ALL
  SELECT 7, 'capture_ingest jobs for this project since snapshot (payload.project_id)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(id::text, ',' ORDER BY created_at), '-')
    FROM jb, params WHERE jb.type = 'capture_ingest' AND jb.payload ->> 'project_id' = params.pid::text

  -- 9: anything tied to a phone other than :aravind_phone (EXPECT ZERO on every line). Ids only.
  UNION ALL
  SELECT 9, 'new capture_documents sent_by a user whose whatsapp_number differs (expect n=0)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(cd.id::text, ',' ORDER BY cd.created_at), '-')
    FROM cd JOIN public.users u ON u.id = cd.sent_by AND u.tenant_id = cd.tenant_id, params
   WHERE regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') <> params.aphone
  UNION ALL
  SELECT 9, 'new deliveries reported_by a user whose whatsapp_number differs (expect n=0)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(dv.id::text, ',' ORDER BY dv.created_at), '-')
    FROM dv JOIN public.users u ON u.id = dv.reported_by AND u.tenant_id = dv.tenant_id, params
   WHERE regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') <> params.aphone
  UNION ALL
  SELECT 9, 'new daily_logs by an engineer whose whatsapp_number differs (expect n=0)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(lg.id::text, ',' ORDER BY lg.created_at), '-')
    FROM lg JOIN public.users u ON u.id = lg.engineer_id, params
   WHERE regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') <> params.aphone
  UNION ALL
  SELECT 9, 'whatsapp_sessions touched since snapshot with a different phone_number (expect n=0)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(ws.id::text, ',' ORDER BY ws.created_at), '-')
    FROM ws, params
   WHERE regexp_replace(COALESCE(ws.phone_number, ''), '\D', '', 'g') <> params.aphone
  UNION ALL
  SELECT 9, 'new capture_ingest jobs whose document was sent by a different phone (expect n=0)',
         'n=' || count(*) || ' ids=' || COALESCE(string_agg(jb.id::text, ',' ORDER BY jb.created_at), '-')
    FROM jb
    JOIN public.capture_documents d ON d.id::text = jb.payload ->> 'document_id'
    JOIN public.users u ON u.id = d.sent_by AND u.tenant_id = d.tenant_id, params
   WHERE jb.type = 'capture_ingest'
     AND regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') <> params.aphone
  UNION ALL
  SELECT 9, 'phone check sanity: users in project tenant matching :aravind_phone (expect n>=1, else format mismatch)',
         'n=' || count(*)
    FROM public.users u, proj, params
   WHERE u.tenant_id = proj.tenant_id AND regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') = params.aphone
  -- 8: stored files vs Storage. Each new STORED capture_files row is joined to storage.objects on
  -- bucket_id = 'capture-documents' (049_capture_tables.sql:1021) AND name = storage_path.
  -- Flags: MISSING (no storage.objects row) and SIZE DIFFERS (metadata->>'size' <> byte_size).
  -- Sizes are compared as text so a non-numeric metadata value cannot raise a cast error.
  UNION ALL
  SELECT 8, 'storage ' || cf.id::text,
         CASE WHEN so.name IS NULL
              THEN 'flag=MISSING (no storage.objects row; bucket_id=capture-documents, name=' || cf.storage_path || ')'
              ELSE 'name=' || so.name || ' bucket_id=' || so.bucket_id
                   || ' size=' || COALESCE(so.metadata ->> 'size', 'NULL')
                   || ' mimetype=' || COALESCE(so.metadata ->> 'mimetype', 'NULL')
                   || ' created_at=' || COALESCE(so.created_at::text, 'NULL')
                   || ' db_byte_size=' || COALESCE(cf.byte_size::text, 'NULL')
                   || ' flag=' || CASE WHEN so.metadata ->> 'size' IS DISTINCT FROM cf.byte_size::text THEN 'SIZE DIFFERS' ELSE 'ok' END
         END
    FROM cf LEFT JOIN storage.objects so ON so.bucket_id = 'capture-documents' AND so.name = cf.storage_path
   WHERE cf.ingest_status = 'stored'
  UNION ALL
  SELECT 8, 'storage summary (stored files / missing / size differs; expect missing=0 size_differs=0)',
         'stored=' || count(*) || ' missing=' || count(*) FILTER (WHERE so.name IS NULL)
         || ' size_differs=' || count(*) FILTER (WHERE so.name IS NOT NULL AND so.metadata ->> 'size' IS DISTINCT FROM cf.byte_size::text)
    FROM cf LEFT JOIN storage.objects so ON so.bucket_id = 'capture-documents' AND so.name = cf.storage_path
   WHERE cf.ingest_status = 'stored'

) x
ORDER BY o, k;
