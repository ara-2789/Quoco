-- lib.sql -- helpers for the 052 local PG17 dry-run (DISPOSABLE scaffold only; never applied anywhere else).
-- Loaded after docs/reviews/049-sql-evidence/src/_fixture.sql (fixed-ID tenants, projects, users, members; schema t).
-- LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST. auth.uid() is a stub reading request.jwt.claim.sub.
\set QUIET on
CREATE OR REPLACE FUNCTION t.ok(p_label text, p_cond boolean) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN p_cond IS TRUE THEN 'PASS: ' ELSE 'FAIL: ' END || p_label $$;

-- One engineer turn (ENG1, T1, P1). Inserts the processed_messages row first, as the webhook does.
CREATE OR REPLACE FUNCTION t.turn(p_phone text, p_msg text, p_sid text, p_media jsonb DEFAULT NULL,
                                  p_start boolean DEFAULT false, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.processed_messages (message_sid) VALUES (p_sid) ON CONFLICT DO NOTHING;
  RETURN public.apply_material_inward_turn(p_phone, '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', p_msg, p_sid, p_media, p_start, p_now);
END;
$$;

CREATE OR REPLACE FUNCTION t.media(n int) RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_agg(jsonb_build_object('index', i, 'content_type', 'image/jpeg', 'url', 'https://example.invalid/m/' || i)) FROM generate_series(0, n - 1) i $$;

CREATE OR REPLACE FUNCTION t.sess(p_phone text) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(current_flow, 'NULL') || '/' || current_step || ' ' || context::text FROM public.whatsapp_sessions WHERE phone_number = p_phone $$;

CREATE OR REPLACE FUNCTION t.docid(p_sid text) RETURNS uuid LANGUAGE sql AS
$$ SELECT id FROM public.capture_documents WHERE source_message_sid = p_sid $$;

-- Run one statement as a role with a given auth uid; returns 'OK <result>' or 'ERR <sqlstate> <message>'.
-- The statement must return one text value. SET LOCAL ROLE is undone on both paths.
CREATE OR REPLACE FUNCTION t.try_as(p_role text, p_sub uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  BEGIN
    EXECUTE p_sql INTO r;
    RESET ROLE;
    RETURN 'OK ' || coalesce(r, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
  END;
END;
$$;

-- Run one statement as the owner; returns 'OK' or 'ERR <sqlstate> <message>'.
CREATE OR REPLACE FUNCTION t.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END;
$$;

-- auth uids of the fixture users (users.auth_id = 4000...N): PM1 ..01, QS1 ..03, DPM ..04, PM2 ..07, PM3 ..09
