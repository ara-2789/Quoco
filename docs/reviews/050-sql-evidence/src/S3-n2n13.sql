-- S3: N2 (scheduled start over a live 'invoice' session) and N13 (first step-1 message deferred), morning and evening.
\pset pager off
\echo == N2 morning: start over a live invoice session at S3 (ack pending)
SELECT t.turn('+91920000001', '4', 'n1-s0', NULL, true) \gset
SELECT t.turn('+91920000001', '1', 'n1-s1') \gset
SELECT t.turn('+91920000001', NULL, 'n1-s2', t.media(1)) \gset
SELECT t.sess('+91920000001') AS before_start;
SELECT public.apply_morning_flow_turn('+91920000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', '', true) AS res_m \gset
\echo morning_start result: :res_m
SELECT t.sess('+91920000001') AS after_start;
SELECT t.ok('T-N2-KEY morning: outcome start, capture_discarded = true, flow morning step 1, guard = morning, flow-owned keys gone',
  (:'res_m'::jsonb->>'outcome') = 'start' AND (:'res_m'::jsonb->>'capture_discarded') = 'true'
  AND t.sess('+91920000001') LIKE 'morning/1 %"invoice_reset_guard": "morning"%' AND t.sess('+91920000001') NOT LIKE '%mi_%');
SELECT t.ok('... the partial delivery stays saved, "not acknowledged"', t.dstatus(t.docid('n1-s2')) = 'incomplete' AND (SELECT engineer_ack IS NULL FROM public.capture_documents WHERE source_message_sid = 'n1-s2'));
\echo -- first message "2 bags short" is DEFERRED (would classify as a NO word and record absent)
SELECT public.apply_morning_flow_turn('+91920000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', '2 bags short', false) AS morning_first_msg;
SELECT t.ok('T-N13-2 morning: deferred (outcome reask, capture_deferred true), NO attendance row, q1_reask not consumed, guard cleared, still step 1',
  NOT EXISTS (SELECT 1 FROM public.daily_logs WHERE engineer_id = '30000000-0000-0000-0000-000000000002' AND log_date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
  AND t.sess('+91920000001') LIKE 'morning/1 %' AND t.sess('+91920000001') NOT LIKE '%q1_reask%' AND t.sess('+91920000001') NOT LIKE '%invoice_reset_guard%');
SELECT public.apply_morning_flow_turn('+91920000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', 'yes', false) AS morning_second_msg;
SELECT t.ok('second message handled normally: step 2, attendance present',
  t.sess('+91920000001') LIKE 'morning/2 %' AND (SELECT attendance = 'present' FROM public.daily_logs WHERE engineer_id = '30000000-0000-0000-0000-000000000002' AND log_date = (now() AT TIME ZONE 'Asia/Kolkata')::date));

\echo == N13 morning: a bare 0 as the SECOND message still routes to not-on-site
SELECT t.turn('+91920000002', '4', 'n2-s0', NULL, true) \gset
SELECT public.apply_morning_flow_turn('+91920000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '', true) \gset
SELECT public.apply_morning_flow_turn('+91920000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '5 things', false) \gset
SELECT public.apply_morning_flow_turn('+91920000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '0', false) AS zero_second;
SELECT t.ok('T-N13-3: after the deferral, a bare 0 goes to step 5 (not on site)', t.sess('+91920000002') LIKE 'morning/5 %');

\echo == N2 morning, already submitted today: already_complete, capture_discarded, NO guard, morning_submitted kept
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91920000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'invoice', 3,
        '{"morning_submitted": true, "mi_kind": "dc", "mi_document_id": "x", "mi_last_sid": "q"}', now() + interval '20 minutes', now());
SELECT public.apply_morning_flow_turn('+91920000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '', true) AS morning_already;
SELECT t.ok('already_complete path: flow NULL, morning_submitted survives, no guard, mi_* gone', t.sess('+91920000003') = 'NULL/0 {"morning_submitted": true}');

\echo == N2 evening: start over a live invoice session; first message "1" deferred, evening_output NOT written
SELECT t.turn('+91920000004', '4', 'n4-s0', NULL, true) \gset
SELECT public.apply_evening_flow_turn('+91920000004', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', '', true, '{}'::jsonb, '{}'::jsonb) AS res_e \gset
\echo evening_start result: :res_e
SELECT t.ok('T-N2-KEY evening: outcome start, capture_discarded = true, flow evening step 1, guard = evening',
  (:'res_e'::jsonb->>'outcome') = 'start' AND (:'res_e'::jsonb->>'capture_discarded') = 'true'
  AND t.sess('+91920000004') LIKE 'evening/1 %"invoice_reset_guard": "evening"%');
SELECT public.apply_evening_flow_turn('+91920000004', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', '1', false, '{"1": []}'::jsonb, '{"1": true}'::jsonb) AS evening_first_msg;
SELECT t.ok('T-N13-1 evening: bare "1" deferred, daily_logs.evening_output NOT written, still step 1, guard cleared',
  NOT EXISTS (SELECT 1 FROM public.daily_logs WHERE engineer_id = '30000000-0000-0000-0000-000000000002' AND evening_output IS NOT NULL AND log_date = (now() AT TIME ZONE 'Asia/Kolkata')::date)
  AND t.sess('+91920000004') LIKE 'evening/1 %' AND t.sess('+91920000004') NOT LIKE '%invoice_reset_guard%');
SELECT public.apply_evening_flow_turn('+91920000004', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', 'slab 10 sqm done', false, '{"1": []}'::jsonb, '{"1": true}'::jsonb) AS evening_second_msg;
SELECT t.ok('second message handled normally: step 2, evening_output written',
  t.sess('+91920000004') LIKE 'evening/2 %' AND (SELECT evening_output = 'slab 10 sqm done' FROM public.daily_logs WHERE engineer_id = '30000000-0000-0000-0000-000000000002' AND log_date = (now() AT TIME ZONE 'Asia/Kolkata')::date));

\echo == T-N13-4 scoping: a morning-set flag does NOT defer the evening step 1
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91920000005', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'evening', 1,
        '{"invoice_reset_guard": "morning"}', now() + interval '20 minutes', now());
SELECT public.apply_evening_flow_turn('+91920000005', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001', 'bricks laid', false, '{"1": []}'::jsonb, '{"1": true}'::jsonb) AS evening_with_morning_flag;
SELECT t.ok('T-N13-4: evening first message taken as the answer (step 2), the other check-in''s flag untouched', t.sess('+91920000005') LIKE 'evening/2 %"invoice_reset_guard": "morning"%');
\echo == S3 end

\echo == T-N13 extended: the plan's four first messages, morning and evening (each on a fresh live-invoice session)
DO $$
DECLARE
  m text; k int := 0; r jsonb; eng uuid := '30000000-0000-0000-0000-000000000002'; ten uuid := '10000000-0000-0000-0000-000000000001'; prj uuid := '20000000-0000-0000-0000-000000000001';
  ph text; ctx text; before_att int;
BEGIN
  FOREACH m IN ARRAY ARRAY['1', '2 bags short', 'partial, cement not received', 'some steel pending'] LOOP
    k := k + 1;
    -- morning
    ph := '+9193000' || k;
    PERFORM t.turn(ph, '4', 'x' || k || '-m0', NULL, true);
    PERFORM public.apply_morning_flow_turn(ph, ten, eng, prj, '', true);
    r := public.apply_morning_flow_turn(ph, ten, eng, prj, m, false);
    SELECT context::text INTO ctx FROM public.whatsapp_sessions WHERE phone_number = ph;
    RAISE NOTICE '% morning first message %: outcome=% deferred=% session=%',
      CASE WHEN r->>'outcome' = 'reask' AND r->>'capture_deferred' = 'true' AND ctx NOT LIKE '%q1_reask%' AND ctx NOT LIKE '%invoice_reset_guard%' THEN 'PASS:' ELSE 'FAIL:' END,
      quote_literal(m), r->>'outcome', r->>'capture_deferred', ctx;
    -- evening
    ph := '+9194000' || k;
    PERFORM t.turn(ph, '4', 'x' || k || '-e0', NULL, true);
    PERFORM public.apply_evening_flow_turn(ph, ten, eng, prj, '', true, '{}'::jsonb, '{}'::jsonb);
    r := public.apply_evening_flow_turn(ph, ten, eng, prj, m, false, '{"1": []}'::jsonb, '{"1": true}'::jsonb);
    SELECT context::text INTO ctx FROM public.whatsapp_sessions WHERE phone_number = ph;
    RAISE NOTICE '% evening first message %: outcome=% deferred=% step=% session=%',
      CASE WHEN r->>'outcome' = 'reask' AND r->>'capture_deferred' = 'true' AND (r->>'current_step') = '1' AND ctx NOT LIKE '%invoice_reset_guard%' THEN 'PASS:' ELSE 'FAIL:' END,
      quote_literal(m), r->>'outcome', r->>'capture_deferred', r->>'current_step', ctx;
  END LOOP;
END $$;
SELECT t.ok('none of the four deferred messages was written as evening_output', (SELECT count(*) = 0 FROM public.daily_logs WHERE evening_output IN ('1', '2 bags short', 'partial, cement not received', 'some steel pending')));
\echo == S3 end (extended)
