-- _lib.sql -- assertion helpers for the 049 PG17 dry-run scenarios.
-- Test-only objects in schema `t` of a DISPOSABLE LOCAL scaffold database. Never applied anywhere else.
-- This file names none of the 049 tables (so 049's DOWN guard never trips on it).
CREATE SCHEMA IF NOT EXISTS t;
GRANT USAGE ON SCHEMA t TO PUBLIC;

-- t.expect: run p_sql; p_expected is 'ok' (must succeed) or a SQLSTATE or a code-only MESSAGE (must be refused with it).
-- Returns one line starting 'PASS:' or 'FAIL:'.
CREATE OR REPLACE FUNCTION t.expect(p_label text, p_sql text, p_expected text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_msg   text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_state := SQLSTATE;
    IF p_expected <> 'ok' AND (v_state = p_expected OR v_msg = p_expected) THEN
      RETURN 'PASS: ' || p_label || ' -- refused, SQLSTATE=' || v_state || ' MESSAGE=' || left(v_msg, 60);
    END IF;
    RETURN 'FAIL: ' || p_label || ' -- expected ' || p_expected || ', got refusal SQLSTATE=' || v_state || ' MESSAGE=' || left(v_msg, 60);
  END;
  IF p_expected = 'ok' THEN
    RETURN 'PASS: ' || p_label || ' -- succeeded as expected';
  END IF;
  RETURN 'FAIL: ' || p_label || ' -- expected refusal ' || p_expected || ' but the statement SUCCEEDED';
END;
$$;

-- t.errmsg: run p_sql and return the MESSAGE_TEXT of the error it raises ('(no error)' if it succeeds).
CREATE OR REPLACE FUNCTION t.errmsg(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RETURN v_msg;
  END;
  RETURN '(no error)';
END;
$$;

-- t.val: run a one-value query and compare its text to p_expected.
CREATE OR REPLACE FUNCTION t.val(p_label text, p_sql text, p_expected text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  EXECUTE p_sql INTO v;
  IF v IS NOT DISTINCT FROM p_expected THEN
    RETURN 'PASS: ' || p_label || ' -- value = ' || COALESCE(v, '(null)');
  END IF;
  RETURN 'FAIL: ' || p_label || ' -- expected ' || COALESCE(p_expected, '(null)') || ' got ' || COALESCE(v, '(null)');
END;
$$;
