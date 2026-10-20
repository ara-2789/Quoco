-- S1b: SQL review r2 S-4 -- an engineer whose ONLY project membership has a role other than 'engineer' is refused QE012.
-- NOT YET RUN: the scaffold used for the block 12 transcripts was destroyed, and test-db now carries 050 (a fresh dump
-- would already contain the 050 functions, so this scenario needs a dump taken BEFORE the apply or an adapted runner).
-- The same case is covered by the vitest case "S-4" in test/capture-engineer-flow.test.ts (CI).
\pset pager off
\echo == S-4: engineer user, membership role 'qs' on P1 only
INSERT INTO public.users (id, tenant_id, full_name, role, status) VALUES ('30000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-000000000001', 'ENG3', 'engineer', 'active');
INSERT INTO public.project_members (tenant_id, project_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000e3', 'qs');
SELECT t.turn_as('+91900000030', '4', 's4-s0', '30000000-0000-0000-0000-0000000000e3', '20000000-0000-0000-0000-000000000001', NULL, true);
SELECT t.turn_as('+91900000030', '1', 's4-s1', '30000000-0000-0000-0000-0000000000e3', '20000000-0000-0000-0000-000000000001');
SELECT t.expect('S-4: an engineer whose only membership is role qs is refused QE012', $$SELECT t.turn_as('+91900000030', NULL, 's4-s2', '30000000-0000-0000-0000-0000000000e3', '20000000-0000-0000-0000-000000000001', t.media(1))$$, 'QE012');
SELECT t.ok('S-4: no rows written', (SELECT count(*) = 0 FROM public.capture_documents WHERE source_message_sid = 's4-s2') AND (SELECT count(*) = 0 FROM public.deliveries WHERE reported_by = '30000000-0000-0000-0000-0000000000e3'));
\echo == S1b end
