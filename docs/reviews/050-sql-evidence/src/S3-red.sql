-- S3-RED: the same scenarios against the PRE-050 live bodies (positive controls: they must go wrong without the hunks).
\pset pager off
\echo == RED setup: the pre-050 LIVE morning and evening bodies are re-installed over the 050 ones
\i /tmp/quoco/live-apply_morning_flow_turn-testdb.sql
\i /tmp/quoco/live-apply_evening_flow_turn-testdb.sql
SELECT t.turn('+91940000001', '4', 'r1-s0', NULL, true) \gset
SELECT t.turn('+91940000001', '1', 'r1-s1') \gset
SELECT t.turn('+91940000001', NULL, 'r1-s2', t.media(1)) \gset
\echo == RED T-N2-KEY: pre-050 start over a live invoice session
SELECT public.apply_morning_flow_turn('+91940000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '', true) AS pre050_start;
SELECT t.ok('RED T-N2-KEY: the pre-050 body answers reask (the scheduled check-in does NOT start)', t.sess('+91940000001') LIKE 'invoice/3 %');
\echo == RED T-N13-2: pre-050 morning step 1 with the flag planted and the note "2 bags short"
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91940000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'morning', 1, '{"invoice_reset_guard": "morning"}', now() + interval '20 minutes', now());
SELECT public.apply_morning_flow_turn('+91940000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2 bags short', false) AS pre050_note;
SELECT t.ok('RED T-N13-2: without hunk (2) the note is taken as the answer and the engineer goes to step 5 (not on site = recorded absent)', t.sess('+91940000002') LIKE 'morning/5 %');
\echo == RED T-N13-1: pre-050 evening step 1 with the flag planted and a bare "1"
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91940000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'evening', 1, '{"invoice_reset_guard": "evening"}', now() + interval '20 minutes', now());
SELECT public.apply_evening_flow_turn('+91940000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '1', false, '{"1": []}'::jsonb, '{"1": true}'::jsonb) AS pre050_one;
SELECT t.ok('RED T-N13-1: without hunk (2) the bare "1" is written as the day''s evening_output', (SELECT count(*) = 1 FROM public.daily_logs WHERE evening_output = '1'));
\echo == S3-RED end
