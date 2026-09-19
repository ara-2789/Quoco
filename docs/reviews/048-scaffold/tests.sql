-- 048 disposable-scaffold behavioural tests (CLAUDE.md §7 dry-run). Runs ONLY against the
-- local throwaway Postgres built by run.sh from a schema-only dump of test-db plus the named
-- stubs in stubs.sql. It never touches test-db or prod. Not a migration; no number.
--
-- Covers the SQL side of: T1, T5, T6 (the 11-row matrix), T7, T8, T9, T10, T16, T17, T18, T19,
-- T20, T47, T48. NOT covered here (they need code or a database this pass does not have):
-- T6's TypeScript half, T12, T13, T14, T21, T44, T46, T49; T15 is CI-only (CLAUDE.md §0).
-- Every fixture number is a +1555 fake -- no +91 literal appears in this file.
--
-- Every check is wrapped by scaf.chk: an unexpected error is a recorded FAIL, never a
-- silently missing test. Output is a PASS/FAIL line per check and a SUMMARY line.

\set ON_ERROR_STOP off
\set QUIET on
\pset tuples_only on
\pset format unaligned

CREATE SCHEMA scaf;
CREATE TABLE scaf.results (n serial PRIMARY KEY, name text NOT NULL, ok boolean NOT NULL, detail text);
CREATE TABLE scaf.fx (k text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE scaf.res (k text PRIMARY KEY, j jsonb);
CREATE TABLE scaf.snaps (k text PRIMARY KEY, v text);

CREATE FUNCTION scaf.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM scaf.fx WHERE k = p_k $$;

CREATE FUNCTION scaf.chk(p_name text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v_ok;
    INSERT INTO scaf.results (name, ok) VALUES (p_name, coalesce(v_ok, false));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO scaf.results (name, ok, detail) VALUES (p_name, false, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;

-- Returns 'ok' or the SQLSTATE of the statement. A successful statement's effect persists.
CREATE FUNCTION scaf.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
  END;
END $$;

CREATE FUNCTION scaf.eng(p_numbers text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('name', 'Eng ' || n, 'whatsapp_number', n)) FROM unnest(p_numbers) n
$$;

-- Call add_engineers_to_project as a role, with the caller's auth uid set. Never raises: returns
-- {"ok": <payload>} or {"err": <sqlstate>, "msg": <message>}.
CREATE FUNCTION scaf.call(p_sub uuid, p_project uuid, p_eng jsonb, p_dry boolean, p_consent boolean,
                          p_role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    r := public.add_engineers_to_project(p_project, p_eng, p_dry, p_consent);
    RESET ROLE;
    RETURN jsonb_build_object('ok', r);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN jsonb_build_object('err', SQLSTATE, 'msg', SQLERRM);
  END;
END $$;

-- Same, for the internal helper (T16: no role but its owner may call it).
CREATE FUNCTION scaf.hcall(p_sub uuid, p_project uuid, p_role text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM * FROM public.engineer_admin_gate(p_project);
    RESET ROLE;
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN SQLSTATE;
  END;
END $$;

-- One dry-run row as the named fixture user: 'allow' or the SQLSTATE the gate raised.
CREATE FUNCTION scaf.verdict(p_user_k text, p_project uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := scaf.call(scaf.id(p_user_k || '.sub'), p_project, scaf.eng(ARRAY['+15550300001']), true, true);
  IF r ? 'err' THEN RETURN r ->> 'err'; END IF;
  IF r -> 'ok' -> 'rows' -> 0 ->> 'status' = 'ok' THEN RETURN 'allow'; END IF;
  RETURN 'unexpected';
END $$;

CREATE FUNCTION scaf.counts() RETURNS text LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM public.users)::text || '/' || (SELECT count(*) FROM public.project_members)::text
$$;
CREATE FUNCTION scaf.snap(p_k text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO scaf.snaps (k, v) VALUES (p_k, scaf.counts()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$$;
CREATE FUNCTION scaf.same(p_k text) RETURNS boolean LANGUAGE sql AS $$
  SELECT v = scaf.counts() FROM scaf.snaps WHERE k = p_k
$$;
CREATE FUNCTION scaf.save(p_k text, p_j jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO scaf.res (k, j) VALUES (p_k, p_j) ON CONFLICT (k) DO UPDATE SET j = EXCLUDED.j
$$;
CREATE FUNCTION scaf.j(p_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT j FROM scaf.res WHERE k = p_k $$;
CREATE FUNCTION scaf.statuses(p_j jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(r ->> 'status' ORDER BY (r ->> 'idx')::int) FROM jsonb_array_elements(p_j -> 'ok' -> 'rows') r
$$;
CREATE FUNCTION scaf.keys(p_j jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_j) k
$$;

-- Fixture builders (run as the scaffold owner; bypass RLS like the real definer functions do).
CREATE FUNCTION scaf.mk_tenant(p_k text) RETURNS void LANGUAGE sql AS $$
  WITH t AS (INSERT INTO public.tenants (name, slug) VALUES (p_k, p_k) RETURNING id)
  INSERT INTO scaf.fx (k, id) SELECT p_k, id FROM t
$$;
CREATE FUNCTION scaf.mk_project(p_k text, p_tenant text, p_name text) RETURNS void LANGUAGE sql AS $$
  WITH p AS (INSERT INTO public.projects (tenant_id, name) VALUES (scaf.id(p_tenant), p_name) RETURNING id)
  INSERT INTO scaf.fx (k, id) SELECT p_k, id FROM p
$$;
CREATE FUNCTION scaf.mk_user(p_k text, p_tenant text, p_role text, p_auth boolean, p_num text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_auth uuid := CASE WHEN p_auth THEN gen_random_uuid() END;
BEGIN
  -- users.auth_id has an FK to auth.users (stubbed in stubs.sql): a caller needs a real row there.
  IF p_auth THEN INSERT INTO auth.users (id) VALUES (v_auth); END IF;
  INSERT INTO public.users (tenant_id, role, full_name, whatsapp_number, auth_id)
  VALUES (scaf.id(p_tenant), p_role, 'Name ' || p_k, p_num, v_auth) RETURNING id INTO v_id;
  INSERT INTO scaf.fx (k, id) VALUES (p_k, v_id);
  IF p_auth THEN INSERT INTO scaf.fx (k, id) VALUES (p_k || '.sub', v_auth); END IF;
END $$;
CREATE FUNCTION scaf.mk_member(p_user text, p_project text, p_role text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.project_members (tenant_id, project_id, user_id, role)
  SELECT u.tenant_id, scaf.id(p_project), u.id, p_role FROM public.users u WHERE u.id = scaf.id(p_user)
$$;
-- T19 helper: try one membership with a role for a FRESH tenant-A user; 'ok' or the SQLSTATE.
CREATE FUNCTION scaf.member_try(p_role text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    INSERT INTO public.users (tenant_id, role, full_name) VALUES (scaf.id('tA'), 'engineer', 'scratch') RETURNING id INTO v_id;
    INSERT INTO public.project_members (tenant_id, project_id, user_id, role) VALUES (scaf.id('tA'), scaf.id('PA1'), v_id, p_role);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
  END;
END $$;

-- ---------------------------------------------------------------- fixtures
\o /dev/null
SELECT scaf.mk_tenant('tA'), scaf.mk_tenant('tB');
SELECT scaf.mk_project('PA1', 'tA', 'Alpha Site'), scaf.mk_project('PA2', 'tA', 'Beta Site'),
       scaf.mk_project('PB1', 'tB', 'Bravo Secret Site');
-- callers (auth_id set)
SELECT scaf.mk_user('adminA',    'tA', 'admin',    true, NULL),
       scaf.mk_user('adminA2',   'tA', 'admin',    true, NULL),
       scaf.mk_user('pmA',       'tA', 'pm',       true, NULL),
       scaf.mk_user('pmA_nomem', 'tA', 'pm',       true, NULL),
       scaf.mk_user('pmA_engmem','tA', 'pm',       true, NULL),
       scaf.mk_user('qsA',       'tA', 'qs',       true, NULL),
       scaf.mk_user('engCaller', 'tA', 'engineer', true, '+15550200010'),
       scaf.mk_user('nullRole',  'tA', NULL,       true, NULL),
       scaf.mk_user('adminNullT', NULL, 'admin',   true, NULL),
       scaf.mk_user('adminB',    'tB', 'admin',    true, NULL);
SELECT scaf.mk_member('adminA2', 'PA1', 'pm'), scaf.mk_member('pmA', 'PA1', 'pm'),
       scaf.mk_member('pmA_engmem', 'PA1', 'engineer'), scaf.mk_member('qsA', 'PA1', 'pm'),
       scaf.mk_member('engCaller', 'PA1', 'pm'), scaf.mk_member('nullRole', 'PA1', 'pm');
-- existing numbers (auth_id NULL)
SELECT scaf.mk_user('engB1',  'tB', 'engineer', false, '+15550200001'),
       scaf.mk_user('engB2',  'tB', 'engineer', false, '+15550200002'),
       scaf.mk_user('engA2',  'tA', 'engineer', false, '+15550200003'),
       scaf.mk_user('engA3',  'tA', 'engineer', false, '+15550200004'),
       scaf.mk_user('engA4',  'tA', 'engineer', false, '+15550200005'),
       scaf.mk_user('ownerA', 'tA', 'owner',    false, '+15550200006');
SELECT scaf.mk_member('engB1', 'PB1', 'engineer'), scaf.mk_member('engA2', 'PA2', 'engineer'),
       scaf.mk_member('engA4', 'PA1', 'engineer');
\o

-- ---------------------------------------------------------------- T6: the shared §7.2 matrix, SQL side
\o /dev/null
SELECT scaf.chk('T6 row1  admin/same/no membership -> allow',        $q$ SELECT scaf.verdict('adminA', scaf.id('PA1')) = 'allow' $q$);
SELECT scaf.chk('T6 row2  admin/same/pm membership -> allow',        $q$ SELECT scaf.verdict('adminA2', scaf.id('PA1')) = 'allow' $q$);
SELECT scaf.chk('T6 row3  pm/same/pm membership -> allow',           $q$ SELECT scaf.verdict('pmA', scaf.id('PA1')) = 'allow' $q$);
SELECT scaf.chk('T6 row4  pm/same/no membership -> 42501',           $q$ SELECT scaf.verdict('pmA_nomem', scaf.id('PA1')) = '42501' $q$);
SELECT scaf.chk('T6 row5  pm/same/engineer-only membership -> 42501',$q$ SELECT scaf.verdict('pmA_engmem', scaf.id('PA1')) = '42501' $q$);
SELECT scaf.chk('T6 row6  qs/same/pm membership -> 42501',           $q$ SELECT scaf.verdict('qsA', scaf.id('PA1')) = '42501' $q$);
SELECT scaf.chk('T6 row7  engineer/same/pm membership -> 42501',     $q$ SELECT scaf.verdict('engCaller', scaf.id('PA1')) = '42501' $q$);
SELECT scaf.chk('T6 row8  NULL role/same/pm membership -> 42501',    $q$ SELECT scaf.verdict('nullRole', scaf.id('PA1')) = '42501' $q$);
SELECT scaf.chk('T6 row9  admin/other tenant project -> P0002',      $q$ SELECT scaf.verdict('adminA', scaf.id('PB1')) = 'P0002' $q$);
SELECT scaf.chk('T6 row10 admin/caller tenant NULL -> P0002',        $q$ SELECT scaf.verdict('adminNullT', scaf.id('PA1')) = 'P0002' $q$);
SELECT scaf.chk('T6 row11 admin/nonexistent project -> P0002',       $q$ SELECT scaf.verdict('adminA', gen_random_uuid()) = 'P0002' $q$);
SELECT scaf.chk('T6 extra unknown auth uid -> 42501',                $q$ SELECT scaf.call(gen_random_uuid(), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true) ->> 'err' = '42501' $q$);
SELECT scaf.chk('T6 extra NULL auth uid (anon-shaped) -> 42501',     $q$ SELECT scaf.call(NULL, scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true) ->> 'err' = '42501' $q$);

-- ---------------------------------------------------------------- T1: NULL-tenant caller, both modes
SELECT scaf.snap('t1');
SELECT scaf.chk('T1 tenant-NULL admin: dry-run -> P0002',   $q$ SELECT scaf.call(scaf.id('adminNullT.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true) ->> 'err' = 'P0002' $q$);
SELECT scaf.chk('T1 tenant-NULL admin: apply -> P0002, nothing written', $q$ SELECT scaf.call(scaf.id('adminNullT.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'err' = 'P0002' AND scaf.same('t1') $q$);

-- ---------------------------------------------------------------- T7 / T8
SELECT scaf.snap('t7');
-- T7 uses numbers no other check touches, so a dry run that wrongly wrote could not be masked by an
-- earlier check having already registered them.
SELECT scaf.save('t7', scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550310001', '+15550310002']), true, true));
SELECT scaf.chk('T7 dry-run returns ok verdicts (>=1) and applied=false', $q$ SELECT scaf.statuses(scaf.j('t7')) = ARRAY['ok','ok'] AND (scaf.j('t7') -> 'ok' ->> 'applied')::boolean = false $q$);
SELECT scaf.chk('T7 dry-run wrote nothing (users + project_members counts unchanged)', $q$ SELECT scaf.same('t7') $q$);
SELECT scaf.save('t8', scaf.call(scaf.id('qsA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true));
SELECT scaf.chk('T8 unauthorised dry-run gets an error, not statuses', $q$ SELECT scaf.j('t8') ? 'err' AND NOT (scaf.j('t8') ? 'ok') $q$);

-- ---------------------------------------------------------------- T5: classification and the cross-tenant payload
SELECT scaf.save('t5', scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'),
  scaf.eng(ARRAY['+15550200001', '+15550200002', '+15550200003', '+15550200004', '+15550200005', '+15550200006', '+15550300001']), true, true));
SELECT scaf.chk('T5 statuses: B-engineer, B-no-membership, on-another, no-project, already, owner, new',
  $q$ SELECT scaf.statuses(scaf.j('t5')) = ARRAY['number_registered','number_registered','on_another_project','registered_no_project','already_on_this_project','number_registered','ok'] $q$);
SELECT scaf.chk('T5 cross-tenant rows carry EXACTLY {idx,status}',
  $q$ SELECT scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 0) = ARRAY['idx','status'] AND scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 1) = ARRAY['idx','status'] $q$);
SELECT scaf.chk('T5 payload text contains no tenant-B project name, full name, project id or tenant id',
  $q$ SELECT position('Bravo' IN scaf.j('t5')::text) = 0 AND position('Name engB1' IN scaf.j('t5')::text) = 0
        AND position(scaf.id('PB1')::text IN scaf.j('t5')::text) = 0 AND position(scaf.id('tB')::text IN scaf.j('t5')::text) = 0 $q$);
SELECT scaf.chk('T5 on_another_project carries other_project_name of the caller''s own tenant, no id / full name',
  $q$ SELECT scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 2) = ARRAY['idx','other_project_name','status']
        AND scaf.j('t5') -> 'ok' -> 'rows' -> 2 ->> 'other_project_name' = 'Beta Site'
        AND position('Name engA2' IN scaf.j('t5')::text) = 0 $q$);
SELECT scaf.chk('T5 registered_no_project / already / owner rows carry EXACTLY {idx,status}',
  $q$ SELECT scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 3) = ARRAY['idx','status'] AND scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 4) = ARRAY['idx','status']
        AND scaf.keys(scaf.j('t5') -> 'ok' -> 'rows' -> 5) = ARRAY['idx','status'] $q$);

-- ---------------------------------------------------------------- T9 (SQL side): shape and argument validation
SELECT scaf.chk('T9 generic shape accepted: +12 and a 15-digit number',
  $q$ SELECT scaf.statuses(scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+12', '+123456789012345']), true, true)) = ARRAY['ok','ok'] $q$);
SELECT scaf.chk('T9 malformed numbers rejected 22023: letters, +0.., no plus, +1, 16 digits, empty, spaces, trailing newline',
  $q$ SELECT bool_and(scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY[n]), true, true) ->> 'err' = '22023')
       FROM unnest(ARRAY['abc', '+0123', '15550300001', '+1', '+1234567890123456', '', ' +15550300001', '+1555 0300001', E'+15550300001\n']) n $q$);
SELECT scaf.chk('T9 name rules: blank and 101 chars -> 22023, exactly 100 accepted',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '[{"name":"   ","whatsapp_number":"+15550300001"}]', true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), jsonb_build_array(jsonb_build_object('name', repeat('x', 101), 'whatsapp_number', '+15550300001')), true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), jsonb_build_array(jsonb_build_object('name', repeat('x', 100), 'whatsapp_number', '+15550300001')), true, true) -> 'ok' -> 'rows' -> 0 ->> 'status' = 'ok' $q$);
SELECT scaf.chk('T9 shape rules: non-array, NULL, non-object element, missing key, non-string number, in-paste duplicate -> 22023',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '{"a":1}', true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), NULL, true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '[1]', true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '[{"name":"x"}]', true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '[{"name":"x","whatsapp_number":15550300001}]', true, true) ->> 'err' = '22023'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001', '+15550300001']), true, true) ->> 'err' = '22023' $q$);
SELECT scaf.chk('T9 row cap: 0 rows and 51 rows -> 54000, 50 rows accepted',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), '[]', true, true) ->> 'err' = '54000'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), (SELECT scaf.eng(array_agg('+1555040' || lpad(g::text, 4, '0'))) FROM generate_series(1, 51) g), true, true) ->> 'err' = '54000'
        AND scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), (SELECT scaf.eng(array_agg('+1555040' || lpad(g::text, 4, '0'))) FROM generate_series(1, 50) g), true, true) ->> 'err' IS NULL $q$);

-- ---------------------------------------------------------------- T17: foreign project id == nonexistent id, nothing written
SELECT scaf.snap('t17');
SELECT scaf.chk('T17 tenant-A admin + tenant-B project: same code AND message as a nonexistent id (P0002), zero writes',
  $q$ SELECT (scaf.call(scaf.id('adminA.sub'), scaf.id('PB1'), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'err') = 'P0002'
        AND (scaf.call(scaf.id('adminA.sub'), scaf.id('PB1'), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'err')
            = (scaf.call(scaf.id('adminA.sub'), gen_random_uuid(), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'err')
        AND (scaf.call(scaf.id('adminA.sub'), scaf.id('PB1'), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'msg')
            = (scaf.call(scaf.id('adminA.sub'), gen_random_uuid(), scaf.eng(ARRAY['+15550300001']), false, true) ->> 'msg')
        AND scaf.same('t17') $q$);

-- ---------------------------------------------------------------- mixed batch: any non-ok row -> nothing written
SELECT scaf.snap('mixed');
SELECT scaf.chk('mixed batch (one new, one already on this project) in APPLY mode: applied=false, nothing written',
  $q$ SELECT (scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300005', '+15550200005']), false, true) -> 'ok' ->> 'applied')::boolean = false AND scaf.same('mixed') $q$);

-- ---------------------------------------------------------------- T10: explicit columns, attribution, consent
SELECT scaf.save('t10', scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300002', '+15550300003']), false, true));
SELECT scaf.chk('T10 apply: applied=true, both rows added, each with a user_id',
  $q$ SELECT (scaf.j('t10') -> 'ok' ->> 'applied')::boolean AND scaf.statuses(scaf.j('t10')) = ARRAY['added','added']
        AND (scaf.j('t10') -> 'ok' -> 'rows' -> 0 ->> 'user_id') IS NOT NULL $q$);
SELECT scaf.chk('T10 read-back: tenant, role, status, messaging_blocked, auth_id NULL, registered_by = caller users.id, consent true, one shared registered_at',
  $q$ SELECT count(*) = 2
        AND bool_and(u.tenant_id = scaf.id('tA') AND u.role = 'engineer' AND u.status = 'active' AND u.messaging_blocked = false
                     AND u.auth_id IS NULL AND u.registered_by = scaf.id('adminA') AND u.registered_at IS NOT NULL AND u.consent_attested IS TRUE)
        AND count(DISTINCT u.registered_at) = 1
      FROM public.users u WHERE u.whatsapp_number IN ('+15550300002', '+15550300003') $q$);
SELECT scaf.chk('T10 membership: role engineer, caller''s tenant, this project, user_id matches the payload',
  $q$ SELECT count(*) = 2 AND bool_and(m.role = 'engineer' AND m.tenant_id = scaf.id('tA') AND m.project_id = scaf.id('PA1'))
        AND bool_and(m.user_id::text IN (SELECT r ->> 'user_id' FROM jsonb_array_elements(scaf.j('t10') -> 'ok' -> 'rows') r))
      FROM public.project_members m JOIN public.users u ON u.id = m.user_id WHERE u.whatsapp_number IN ('+15550300002', '+15550300003') $q$);
SELECT scaf.chk('T10 re-adding the same numbers now reports already_on_this_project (apply never trusts a preview)',
  $q$ SELECT scaf.statuses(scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300002', '+15550300003']), true, true)) = ARRAY['already_on_this_project','already_on_this_project'] $q$);

-- ---------------------------------------------------------------- T20: consent recorded, not enforced; NULL raises
SELECT scaf.save('t20f', scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300004']), false, false));
SELECT scaf.chk('T20 consent=false does not block apply and stores false (not NULL)',
  $q$ SELECT (scaf.j('t20f') -> 'ok' ->> 'applied')::boolean AND (SELECT consent_attested IS FALSE AND registered_by IS NOT NULL FROM public.users WHERE whatsapp_number = '+15550300004') $q$);
SELECT scaf.snap('t20');
SELECT scaf.chk('T20 consent=NULL raises 22023 in APPLY mode, zero rows written',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300006']), false, NULL) ->> 'err' = '22023' AND scaf.same('t20') $q$);
SELECT scaf.chk('T20 consent=NULL raises 22023 in DRY-RUN mode too, zero rows written',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300006']), true, NULL) ->> 'err' = '22023' AND scaf.same('t20') $q$);
SELECT scaf.chk('T20 dry-run flag NULL raises 22023 (a NULL would otherwise read as not-a-dry-run), zero rows written',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300006']), NULL, true) ->> 'err' = '22023' AND scaf.same('t20') $q$);
SELECT scaf.chk('T20 CHECK backstop: registered_by set + consent NULL rejected 23514',
  $q$ SELECT scaf.try(format($f$ INSERT INTO public.users (tenant_id, role, whatsapp_number, registered_by, registered_at, consent_attested) VALUES (%L, 'engineer', '+15550300090', %L, now(), NULL) $f$, scaf.id('tA'), scaf.id('adminA'))) = '23514' $q$);
SELECT scaf.chk('pairing CHECK: registered_by set + registered_at NULL rejected 23514; all-NULL row accepted',
  $q$ SELECT scaf.try(format($f$ INSERT INTO public.users (tenant_id, role, whatsapp_number, registered_by, registered_at, consent_attested) VALUES (%L, 'engineer', '+15550300091', %L, NULL, true) $f$, scaf.id('tA'), scaf.id('adminA'))) = '23514'
        AND scaf.try($f$ INSERT INTO public.users (tenant_id, role, whatsapp_number) VALUES (NULL, 'engineer', '+15550300092') $f$) = 'ok' $q$);
SELECT scaf.chk('attribution FK is same-tenant: a tenant-B row registered by a tenant-A admin rejected 23503',
  $q$ SELECT scaf.try(format($f$ INSERT INTO public.users (tenant_id, role, whatsapp_number, registered_by, registered_at, consent_attested) VALUES (%L, 'engineer', '+15550300093', %L, now(), true) $f$, scaf.id('tB'), scaf.id('adminA'))) = '23503' $q$);

-- ---------------------------------------------------------------- T18: atomicity
\o /dev/null
CREATE FUNCTION scaf.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.whatsapp_number = '+15550300099' THEN RAISE EXCEPTION 'boom' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$;
CREATE TRIGGER scaf_boom BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION scaf.boom();
SELECT scaf.snap('t18');
SELECT scaf.chk('T18 row 3 of 3 fails after classification: error returned AND zero new users / memberships',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300007', '+15550300008', '+15550300099']), false, true) ->> 'err' = 'P0001' AND scaf.same('t18') $q$);
DROP TRIGGER scaf_boom ON public.users;

-- ---------------------------------------------------------------- T19: the project_members.role CHECK
SELECT scaf.chk('T19 each of the six valid roles is accepted',
  $q$ SELECT bool_and(scaf.member_try(r) = 'ok') FROM unnest(ARRAY['pm','qs','engineer','owner','subcontractor','admin']) r $q$);
SELECT scaf.chk('T19 Engineer, engineer<space>, ENGINEER, and a value outside the six rejected 23514',
  $q$ SELECT bool_and(scaf.member_try(r) = '23514') FROM unnest(ARRAY['Engineer', 'engineer ', 'ENGINEER', 'supervisor']) r $q$);

-- ---------------------------------------------------------------- T16: ACL evidence (catalog AND real calls)
SELECT scaf.chk('T16 catalog: add fn -- authenticated may EXECUTE; anon, service_role and PUBLIC may not',
  $q$ SELECT has_function_privilege('authenticated', 'public.add_engineers_to_project(uuid,jsonb,boolean,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.add_engineers_to_project(uuid,jsonb,boolean,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'public.add_engineers_to_project(uuid,jsonb,boolean,boolean)', 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE p.oid = 'public.add_engineers_to_project(uuid,jsonb,boolean,boolean)'::regprocedure AND a.grantee = 0) $q$);
SELECT scaf.chk('T16 catalog: helper -- no role but the owner may EXECUTE (anon, authenticated, service_role, PUBLIC all refused)',
  $q$ SELECT has_function_privilege('postgres', 'public.engineer_admin_gate(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.engineer_admin_gate(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.engineer_admin_gate(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'public.engineer_admin_gate(uuid)', 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE p.oid = 'public.engineer_admin_gate(uuid)'::regprocedure AND a.grantee = 0) $q$);
SELECT scaf.chk('T16 catalog: the helper''s ACL is exactly {postgres=X/postgres} (the explicit owner grant changes nothing effective)',
  $q$ SELECT (SELECT proacl::text FROM pg_proc WHERE oid = 'public.engineer_admin_gate(uuid)'::regprocedure) = '{postgres=X/postgres}' $q$);
SELECT scaf.chk('T16 real call as anon (anon-key shape) -> 42501',
  $q$ SELECT scaf.call(NULL, scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true, 'anon') ->> 'err' = '42501' $q$);
SELECT scaf.chk('T16 real call as service_role -> 42501, even with a valid admin auth uid',
  $q$ SELECT scaf.call(scaf.id('adminA.sub'), scaf.id('PA1'), scaf.eng(ARRAY['+15550300001']), true, true, 'service_role') ->> 'err' = '42501' $q$);
SELECT scaf.chk('T16 real call as authenticated on the PUBLIC function succeeds (dry-run ok)',
  $q$ SELECT scaf.verdict('adminA', scaf.id('PA1')) = 'allow' $q$);
SELECT scaf.chk('T16 real call to the HELPER as authenticated, anon and service_role -> 42501',
  $q$ SELECT scaf.hcall(scaf.id('adminA.sub'), scaf.id('PA1'), 'authenticated') = '42501'
        AND scaf.hcall(NULL, scaf.id('PA1'), 'anon') = '42501'
        AND scaf.hcall(scaf.id('adminA.sub'), scaf.id('PA1'), 'service_role') = '42501' $q$);
SELECT scaf.chk('T16 owner is postgres; SECURITY DEFINER; proconfig is exactly search_path=public -- both functions',
  $q$ SELECT bool_and(pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
        AND count(*) = 2
      FROM pg_proc p WHERE p.proname IN ('add_engineers_to_project', 'engineer_admin_gate') AND p.pronamespace = 'public'::regnamespace $q$);

-- ---------------------------------------------------------------- T48: function identity pinned
SELECT scaf.chk('T48 pg_proc count for add_engineers_to_project in public = 1; and for the helper = 1',
  $q$ SELECT (SELECT count(*) FROM pg_proc WHERE proname = 'add_engineers_to_project' AND pronamespace = 'public'::regnamespace) = 1
        AND (SELECT count(*) FROM pg_proc WHERE proname = 'engineer_admin_gate' AND pronamespace = 'public'::regnamespace) = 1 $q$);
SELECT scaf.chk('T48 argument TYPE LIST is exactly uuid, jsonb, boolean, boolean (compared with spaces removed)',
  $q$ SELECT replace(oidvectortypes(proargtypes), ' ', '') = 'uuid,jsonb,boolean,boolean'
      FROM pg_proc WHERE proname = 'add_engineers_to_project' AND pronamespace = 'public'::regnamespace $q$);
SELECT scaf.chk('T48 md5(prosrc) is non-null',
  $q$ SELECT bool_and(md5(prosrc) IS NOT NULL) FROM pg_proc WHERE proname = 'add_engineers_to_project' AND pronamespace = 'public'::regnamespace $q$);

-- ---------------------------------------------------------------- T47: the attribution FK's actions, LAST (it deletes the caller)
SELECT scaf.chk('T47(i) FK actions: confdeltype = r, confupdtype = a, confmatchtype = s, on (registered_by, tenant_id) -> users (id, tenant_id)',
  $q$ SELECT confdeltype = 'r' AND confupdtype = 'a' AND confmatchtype = 's'
        AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (registered_by, tenant_id) REFERENCES users(id, tenant_id)%'
      FROM pg_constraint WHERE conname = 'users_registered_by_fkey' AND conrelid = 'public.users'::regclass $q$);
SELECT scaf.chk('T47(ii) deleting the registering admin while engineers stand is refused 23503, both rows unchanged',
  $q$ SELECT scaf.try(format('DELETE FROM public.users WHERE id = %L', scaf.id('adminA'))) = '23503'
        AND EXISTS (SELECT 1 FROM public.users WHERE id = scaf.id('adminA'))
        AND EXISTS (SELECT 1 FROM public.users WHERE whatsapp_number = '+15550300002') $q$);
\o

-- ---------------------------------------------------------------- report
SELECT CASE WHEN ok THEN 'PASS  ' ELSE 'FAIL  ' END || name || coalesce('   [' || detail || ']', '') FROM scaf.results ORDER BY n;
SELECT 'SUMMARY pass=' || count(*) FILTER (WHERE ok) || ' fail=' || count(*) FILTER (WHERE NOT ok) || ' total=' || count(*) FROM scaf.results;
