-- =============================================================================
-- d30-after2.sql  --  D-30 follow-up. READ-ONLY, ONE plain SELECT (UNION ALL of o/k/v rows), no writes.
-- Run in the Supabase SQL editor on PROD jvxwqignooseazzmwhvl. Replace ONLY the three <<...>> literals in the
-- `params` CTE (left unreplaced, the casts fail loudly instead of running against a wrong value).
-- The job id and the byte size below are fixed literals from the 31 Oct observation, also in `params`.
--   <<SNAPSHOT_TS>>   2026-10-31 06:15:00+00   (the d30-4-before snapshot)
--   <<PROJECT_ID>>    acef67fe-e775-439d-82b8-5b8526868d6d
--   <<ARAVIND_PHONE>> Aravind's number. Compared as DIGITS ONLY, exactly (matches_input) and by LAST 10 digits
--                     (matches_last10, DIAGNOSTIC ONLY: it never counts as "the input user"). The last-10 column
--                     exists because the previous run's sanity check returned n=0; a country-code difference
--                     (91xxxxxxxxxx vs xxxxxxxxxx) would explain that.
-- OUTPUT PRIVACY: no full phone number is printed anywhere (prefix 3 chars, length, last 4 only). No ack/answer
-- TEXT is printed: notes and captions are reported as present/absent + char length. engineer_ack (a 4-value
-- enum: yes/no/partial/unclear) IS printed, as asked in F.
-- COLUMNS USED (file:line of the definition):
--   capture_documents  049_capture_tables.sql:282 id, :283 created_at, :284 tenant_id, :285 project_id, :286 kind,
--                      :287 sent_by, :288 source_message_sid, :289 engineer_ack, :290 engineer_ack_at,
--                      :291 engineer_ack_note, :292 caption. Note only allowed with ack no/partial/unclear: :301.
--   capture_files      049:313 id, :314 created_at, :316 project_id, :317 document_id, :318 file_no,
--                      :319 source_message_sid, :320 media_index, :321 claimed_content_type, :322 content_type,
--                      :323 byte_size, :324 sha256, :326 ingest_status.
--   deliveries         049:348 id, :349 created_at, :352 reported_by, :355 status, :360 dc_document_id,
--                      :362 created_from_invoice_id.
--   delivery_invoice_links 049:404 id, :405 created_at, :408 delivery_id, :409 invoice_document_id,
--                      :411 link_source, :412 linked_by, :414 unlinked_at.
--   WHERE ack/note ARE WRITTEN (050_material_inward_functions.sql, apply_material_inward_turn):
--                      :234 v_ack parsed from the reply (1=yes 2=no 3=partial, else NULL);
--                      :241 v_note := left(v_text,1000) only when the ack is unclear (raw text kept as the note);
--                      :244-246 UPDATE capture_documents SET engineer_ack, engineer_ack_note (the ack is ALWAYS stored);
--                      :280-281 step 4 (after no/partial): UPDATE ... SET engineer_ack_note = left(v_text,1000).
--                      Caption is written at the INSERT, NULLIF(left(v_text,1000),'') (the text sent with the file).
--   users              001_core_schema.sql:36-45 (id, tenant_id, role, whatsapp_number), auth_id 007_auth_surgery.sql:5.
--   project_members    001:72-80 (project_id, user_id, role).
--   whatsapp_sessions  001:86-97 (user_id, phone_number, current_flow, current_step, expires_at, created_at, updated_at).
--   daily_logs         001:99- (engineer_id, log_date, created_at; every other column is reported by NAME only).
--   jobs               006_jobs_queue.sql:4-14 (type, payload, status, attempt_count, created_at, completed_at, last_error).
--   hindrances         001:~180-195 (tenant_id, project_id, reported_by, status, submitted_via), pm_notified_at
--                      037_hindrances_pm_notified_at.sql:148, report_date 046_hindrances_report_date.sql:79.
--   hindrance_pm_notify payload = {hindrance_id} only: lib/hindrance/pm-notify.ts:313-315.
-- NOT EXECUTED by the author against prod (no DB connection by instruction).
-- =============================================================================
WITH params AS (
  SELECT '<<SNAPSHOT_TS>>'::timestamptz AS snap,
         '<<PROJECT_ID>>'::uuid         AS pid,
         regexp_replace('<<ARAVIND_PHONE>>', '\D', '', 'g') AS aphone,
         '975f254c-d2a1-4603-955c-116373cbc20f'::uuid AS jid,
         215323::bigint                 AS dup_size
), proj AS (
  SELECT p.id, p.tenant_id FROM public.projects p JOIN params ON p.id = params.pid
), people AS (
  -- every user in the project's tenant, plus every project_member of the project (a member in another tenant would
  -- be a data bug; including them means it shows up here instead of hiding).
  SELECT u.id, u.role, u.tenant_id,
         regexp_replace(COALESCE(u.whatsapp_number, ''), '\D', '', 'g') AS d,
         left(COALESCE(u.whatsapp_number, ''), 3)  AS prefix3,
         length(COALESCE(u.whatsapp_number, ''))   AS raw_len,
         EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = params.pid AND m.user_id = u.id) AS is_member,
         (SELECT string_agg(m.role, ',' ORDER BY m.role) FROM public.project_members m
           WHERE m.project_id = params.pid AND m.user_id = u.id) AS member_role
    FROM public.users u CROSS JOIN proj CROSS JOIN params
   WHERE u.tenant_id = proj.tenant_id
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = params.pid AND m.user_id = u.id)
), pp AS (
  SELECT p.*,
         (params.aphone <> '' AND p.d = params.aphone) AS matches_input,
         (length(params.aphone) >= 10 AND length(p.d) >= 10 AND right(p.d, 10) = right(params.aphone, 10)) AS matches_last10
    FROM people p CROSS JOIN params
), me AS (SELECT id FROM pp WHERE matches_input),
   cd AS (SELECT x.* FROM public.capture_documents x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   dv AS (SELECT x.* FROM public.deliveries x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   dl AS (SELECT x.* FROM public.delivery_invoice_links x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   lg AS (SELECT x.* FROM public.daily_logs x, params WHERE x.project_id = params.pid AND x.created_at > params.snap),
   jb AS (SELECT x.* FROM public.jobs x, params WHERE x.created_at > params.snap),
   ws AS (SELECT x.* FROM public.whatsapp_sessions x, params, proj
           WHERE x.tenant_id = proj.tenant_id AND (x.created_at > params.snap OR x.updated_at > params.snap)),
   ij AS (  -- new capture_ingest jobs, keyed to a NEW capture_document of this project via payload.document_id
     SELECT j.*, d.sent_by AS doc_sender FROM jb j JOIN cd d ON d.id::text = j.payload ->> 'document_id'
      WHERE j.type = 'capture_ingest')
SELECT o, k, v FROM (

  -- 0: parameters
  SELECT 0 AS o, 'params check' AS k,
         'project_found=' || (SELECT count(*) FROM proj) || ' snapshot=' || (SELECT snap::text FROM params)
         || ' now=' || now()::text
         || ' input_phone_digits_len=' || (SELECT length(aphone) FROM params)
         || ' users_matching_input_exact=' || (SELECT count(*) FROM me)
         || ' users_matching_input_last10_only=' || (SELECT count(*) FROM pp WHERE matches_last10 AND NOT matches_input) AS v

  -- A: phone diagnosis. No full numbers.
  UNION ALL
  SELECT 1, 'A input phone',
         'last4=' || COALESCE(NULLIF(right((SELECT aphone FROM params), 4), ''), 'EMPTY')
         || ' digits_len=' || (SELECT length(aphone) FROM params)
  UNION ALL
  SELECT 1, 'A user ' || pp.id::text,
         'role=' || COALESCE(pp.role, 'NULL')
         || ' tenant_id=' || pp.tenant_id::text
         || ' is_project_member=' || pp.is_member::text
         || ' project_member_role=' || COALESCE(pp.member_role, '-')
         || ' prefix3=' || pp.prefix3
         || ' raw_len=' || pp.raw_len::text
         || ' digits_len=' || length(pp.d)::text
         || ' last4=' || COALESCE(NULLIF(right(pp.d, 4), ''), 'EMPTY')
         || ' matches_input=' || pp.matches_input::text
         || ' matches_last10=' || pp.matches_last10::text
    FROM pp

  -- B: attribution by user id. Flag = the row's user is not a matches_input=true user.
  UNION ALL
  SELECT 2, 'B capture_document ' || to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || d.id::text,
         'kind=' || d.kind || ' sent_by=' || d.sent_by::text || ' role=' || COALESCE(p.role, 'NULL')
         || ' last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' ' || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'FLAG(no user matches input)'
                        WHEN EXISTS (SELECT 1 FROM me WHERE me.id = d.sent_by) THEN 'ok'
                        ELSE 'FLAG(not the input user)' END
    FROM cd d LEFT JOIN pp p ON p.id = d.sent_by
  UNION ALL
  SELECT 2, 'B delivery ' || to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || d.id::text,
         'status=' || d.status || ' reported_by=' || d.reported_by::text || ' role=' || COALESCE(p.role, 'NULL')
         || ' last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' ' || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'FLAG(no user matches input)'
                        WHEN EXISTS (SELECT 1 FROM me WHERE me.id = d.reported_by) THEN 'ok'
                        ELSE 'FLAG(not the input user)' END
    FROM dv d LEFT JOIN pp p ON p.id = d.reported_by
  UNION ALL
  -- a link row has no sender column of its own; the user shown is the sent_by of the invoice document it links (049:409),
  -- and linked_by (049:412) is printed beside it (NULL for the automatic self-link).
  SELECT 2, 'B delivery_invoice_link ' || to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || l.id::text,
         'link_source=' || l.link_source || ' linked_by=' || COALESCE(l.linked_by::text, 'NULL')
         || ' invoice_doc_sent_by=' || COALESCE(d.sent_by::text, 'NULL (document not in the new set)')
         || ' role=' || COALESCE(p.role, 'NULL') || ' last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' ' || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'FLAG(no user matches input)'
                        WHEN d.sent_by IS NOT NULL AND EXISTS (SELECT 1 FROM me WHERE me.id = d.sent_by) THEN 'ok'
                        ELSE 'FLAG(not the input user)' END
    FROM dl l LEFT JOIN public.capture_documents d ON d.id = l.invoice_document_id LEFT JOIN pp p ON p.id = d.sent_by
  UNION ALL
  SELECT 2, 'B capture_ingest job ' || to_char(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || j.id::text,
         'status=' || j.status || ' document_id=' || (j.payload ->> 'document_id')
         || ' doc_sent_by=' || j.doc_sender::text || ' role=' || COALESCE(p.role, 'NULL')
         || ' last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' ' || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'FLAG(no user matches input)'
                        WHEN EXISTS (SELECT 1 FROM me WHERE me.id = j.doc_sender) THEN 'ok'
                        ELSE 'FLAG(not the input user)' END
    FROM ij j LEFT JOIN pp p ON p.id = j.doc_sender
  UNION ALL
  SELECT 2, 'B summary',
         'documents=' || (SELECT count(*) FROM cd)
         || ' flagged_documents=' || (SELECT count(*) FROM cd WHERE NOT EXISTS (SELECT 1 FROM me WHERE me.id = cd.sent_by))
         || ' deliveries=' || (SELECT count(*) FROM dv)
         || ' flagged_deliveries=' || (SELECT count(*) FROM dv WHERE NOT EXISTS (SELECT 1 FROM me WHERE me.id = dv.reported_by))
         || ' ingest_jobs=' || (SELECT count(*) FROM ij)
         || ' flagged_ingest_jobs=' || (SELECT count(*) FROM ij WHERE NOT EXISTS (SELECT 1 FROM me WHERE me.id = ij.doc_sender))
         || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN ' NOTE=no user matches the input, so every row is flagged' ELSE '' END

  -- C: the sessions touched since the snapshot (tenant of the project).
  UNION ALL
  SELECT 3, 'C session ' || to_char(s.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || s.id::text,
         'label=' || CASE
                       WHEN (SELECT aphone FROM params) <> '' AND regexp_replace(COALESCE(s.phone_number, ''), '\D', '', 'g') = (SELECT aphone FROM params)
                         THEN 'ARAVIND (phone matches input)'
                       WHEN EXISTS (SELECT 1 FROM me WHERE me.id = s.user_id) THEN 'ARAVIND (user matches input)'
                       WHEN length((SELECT aphone FROM params)) >= 10
                        AND right(regexp_replace(COALESCE(s.phone_number, ''), '\D', '', 'g'), 10) = right((SELECT aphone FROM params), 10)
                         THEN 'ARAVIND? (last 10 digits only)'
                       ELSE 'OTHER' END
         || ' user_id=' || COALESCE(s.user_id::text, 'NULL')
         || ' user_last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' user_role=' || COALESCE(p.role, 'NULL')
         || ' session_phone_last4=' || COALESCE(NULLIF(right(regexp_replace(COALESCE(s.phone_number, ''), '\D', '', 'g'), 4), ''), 'EMPTY')
         || ' current_flow=' || COALESCE(s.current_flow, 'NULL')
         || ' current_step=' || COALESCE(s.current_step::text, 'NULL')
         || ' created_at=' || COALESCE(s.created_at::text, 'NULL')
         || ' updated_at=' || COALESCE(s.updated_at::text, 'NULL')
    FROM ws s LEFT JOIN pp p ON p.id = s.user_id

  -- D: the new daily_logs. Non-null column NAMES only, never values. Columns with a non-null DEFAULT
  -- (e.g. attendance_defaulted, is_holiday, created_at, log_date) will always be listed.
  UNION ALL
  SELECT 4, 'D daily_log ' || to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || g.id::text,
         'engineer_id=' || g.engineer_id::text || ' role=' || COALESCE(p.role, 'NULL')
         || ' last4=' || COALESCE(right(p.d, 4), 'NULL')
         || ' ' || CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'FLAG(no user matches input)'
                        WHEN EXISTS (SELECT 1 FROM me WHERE me.id = g.engineer_id) THEN 'ok'
                        ELSE 'FLAG(not the input user)' END
         || ' log_date=' || g.log_date::text
         || ' created_at=' || g.created_at::text
         || ' non_null_columns=' || (SELECT string_agg(e.key, ',' ORDER BY e.key)
                                       FROM jsonb_each(to_jsonb(g)) e WHERE jsonb_typeof(e.value) <> 'null')
    FROM lg g LEFT JOIN pp p ON p.id = g.engineer_id

  -- E: job 975f254c-... . Payload KEYS and value TYPES only; ids come from the hindrance row it points to.
  UNION ALL
  SELECT 5, 'E job',
         CASE WHEN j.id IS NULL THEN 'NOT FOUND'
              ELSE 'type=' || j.type || ' status=' || j.status || ' attempt_count=' || j.attempt_count::text
                   || ' created_at=' || j.created_at::text || ' completed_at=' || COALESCE(j.completed_at::text, 'NULL')
                   || ' last_error=' || COALESCE(left(j.last_error, 300), 'NULL')
                   || ' payload_keys=' || COALESCE((SELECT string_agg(e.key || ':' || jsonb_typeof(e.value), ',' ORDER BY e.key)
                                                      FROM jsonb_each(j.payload) e), '(empty)')
         END
    FROM params LEFT JOIN public.jobs j ON j.id = params.jid
  UNION ALL
  SELECT 5, 'E job -> hindrance',
         CASE WHEN h.id IS NULL THEN 'hindrance row NOT FOUND for payload.hindrance_id=' || COALESCE(j.payload ->> 'hindrance_id', 'NULL')
              ELSE 'hindrance_id=' || h.id::text
                   || ' project_id=' || h.project_id::text
                   || ' in_project_acef67fe=' || (h.project_id = params.pid)::text
                   || ' tenant_id=' || h.tenant_id::text
                   || ' tenant_matches_project_tenant=' || (h.tenant_id = (SELECT tenant_id FROM proj))::text
                   || ' reported_by=' || h.reported_by::text
                   || ' reporter_role=' || COALESCE(p.role, 'NULL')
                   || ' reporter_last4=' || COALESCE(right(p.d, 4), 'NULL')
                   || ' reporter_is_input_user=' || (EXISTS (SELECT 1 FROM me WHERE me.id = h.reported_by))::text
                   || ' status=' || COALESCE(h.status, 'NULL')
                   || ' submitted_via=' || COALESCE(h.submitted_via, 'NULL')
                   || ' report_date=' || COALESCE(h.report_date::text, 'NULL')
                   || ' created_at=' || h.created_at::text
                   || ' pm_notified_at=' || COALESCE(h.pm_notified_at::text, 'NULL')
         END
    FROM params LEFT JOIN public.jobs j ON j.id = params.jid
         LEFT JOIN public.hindrances h ON h.id::text = j.payload ->> 'hindrance_id'
         LEFT JOIN pp p ON p.id = h.reported_by

  -- F: per new capture_document: answers and linkage.
  UNION ALL
  SELECT 6, 'F doc ' || to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || ' ' || d.id::text,
         'kind=' || d.kind
         || ' created_at=' || d.created_at::text
         || ' created_ist=' || to_char(d.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS')
         || ' files=' || (SELECT count(*) FROM public.capture_files f WHERE f.document_id = d.id)
         || ' files_by_status=' || COALESCE((SELECT string_agg(q.s || ':' || q.n, ',' ORDER BY q.s)
                                               FROM (SELECT f.ingest_status AS s, count(*) AS n FROM public.capture_files f
                                                      WHERE f.document_id = d.id GROUP BY 1) q), '-')
         || ' file_nos=' || COALESCE((SELECT string_agg(f.file_no::text, ',' ORDER BY f.file_no) FROM public.capture_files f WHERE f.document_id = d.id), '-')
         || ' distinct_message_sids=' || (SELECT count(DISTINCT f.source_message_sid) FROM public.capture_files f WHERE f.document_id = d.id)
         || ' max_media_index=' || COALESCE((SELECT max(f.media_index)::text FROM public.capture_files f WHERE f.document_id = d.id), '-')
         || ' content_types=' || COALESCE((SELECT string_agg(COALESCE(f.content_type, 'NULL'), ',' ORDER BY f.file_no) FROM public.capture_files f WHERE f.document_id = d.id), '-')
         || ' engineer_ack=' || COALESCE(d.engineer_ack, 'NULL')
         || ' engineer_ack_at=' || COALESCE(d.engineer_ack_at::text, 'NULL')
         || ' note_present=' || (d.engineer_ack_note IS NOT NULL)::text
         || ' note_len=' || COALESCE(char_length(d.engineer_ack_note)::text, 'NULL')
         || ' caption_present=' || (d.caption IS NOT NULL)::text
         || ' caption_len=' || COALESCE(char_length(d.caption)::text, 'NULL')
         || ' delivery=' || COALESCE((SELECT string_agg(dd.id::text || '(status=' || dd.status || ',via='
                                              || CASE WHEN dd.dc_document_id = d.id THEN 'dc_document_id' ELSE 'created_from_invoice_id' END || ')', ';')
                                         FROM public.deliveries dd WHERE dd.dc_document_id = d.id OR dd.created_from_invoice_id = d.id), 'NONE')
         || ' invoice_links=' || COALESCE((SELECT string_agg(l.id::text || '(' || l.link_source || ','
                                              || CASE WHEN l.unlinked_at IS NULL THEN 'active' ELSE 'unlinked' END || ',delivery=' || l.delivery_id::text || ')', ';')
                                         FROM public.delivery_invoice_links l WHERE l.invoice_document_id = d.id), 'NONE')
    FROM cd d

  -- G: duplicate content. Any two capture_files of the project (any age) with the same sha256.
  UNION ALL
  SELECT 7, 'G dup sha256 ' || f.sha256,
         'n=' || count(*)
         || ' file_ids=' || string_agg(f.id::text, ',' ORDER BY f.created_at, f.id)
         || ' document_ids=' || string_agg(f.document_id::text, ',' ORDER BY f.created_at, f.id)
         || ' file_created_at=' || string_agg(f.created_at::text, ',' ORDER BY f.created_at, f.id)
         || ' distinct_documents=' || count(DISTINCT f.document_id)
    FROM public.capture_files f, params
   WHERE f.project_id = params.pid AND f.sha256 IS NOT NULL
   GROUP BY f.sha256
  HAVING count(*) > 1
  UNION ALL
  SELECT 7, 'G summary',
         'project_files=' || count(*) || ' with_sha256=' || count(f.sha256)
         || ' duplicate_sha256_groups=' || (SELECT count(*) FROM (SELECT 1 FROM public.capture_files x, params
                                                                    WHERE x.project_id = params.pid AND x.sha256 IS NOT NULL
                                                                    GROUP BY x.sha256 HAVING count(*) > 1) q)
    FROM public.capture_files f, params WHERE f.project_id = params.pid
  UNION ALL
  -- cross-check of the two files with byte_size 215323: are they byte-identical (same sha256)?
  SELECT 7, 'G byte_size ' || params.dup_size::text || ' file ' || f.id::text,
         'document_id=' || f.document_id::text || ' created_at=' || f.created_at::text
         || ' sha256=' || COALESCE(f.sha256, 'NULL')
         || ' ingest_status=' || f.ingest_status
         || ' sha256_equal_to_other_' || params.dup_size::text || '_files='
         || COALESCE((SELECT (count(DISTINCT x.sha256) = 1)::text FROM public.capture_files x
                       WHERE x.project_id = params.pid AND x.byte_size = params.dup_size AND x.sha256 IS NOT NULL), 'NULL')
    FROM public.capture_files f, params
   WHERE f.project_id = params.pid AND f.byte_size = params.dup_size

) x
ORDER BY o, k;
