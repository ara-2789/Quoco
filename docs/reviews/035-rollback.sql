-- =============================================================================
-- docs/reviews/035-rollback.sql
-- Exact inverse of 035_evening_flow_restructuring.sql's two CREATE OR REPLACE
-- statements. Restores apply_morning_flow_turn and apply_evening_flow_turn to
-- their pre-035 bodies, verbatim, by re-running 030's and 025's own function
-- definitions. Both signatures are unchanged by 035, so this is safe -- no
-- overload risk either direction.
--
-- NOT REVERSED, DELIBERATELY (same principle as 025's own rollback comment:
-- real engineer data is not migration scaffolding):
--   - evening_manpower / evening_idle_hours columns -- left in place. Any real
--     data 035 wrote there before rollback stays; the restored old RPCs simply
--     never read it again.
--   - The daily_logs authenticated UPDATE grant addition -- harmless to leave.
--   - The one-time session sweep -- already happened, nothing to undo; any
--     session reset to idle by it simply starts fresh under the restored code.
--
-- KNOWN GAP, FOUND AND WORKED AROUND 2026-09-03 (test-db re-apply round):
-- leaving the additive schema in place on rollback is CORRECT (per the
-- principle above), but it makes RE-APPLYING THE FULL 035 FILE VERBATIM
-- IMPOSSIBLE afterward -- `ALTER TABLE ... ADD COLUMN evening_manpower`
-- fails with 42701 ("column already exists") the second time around,
-- because the columns this rollback deliberately kept are still there. Hit
-- for real on test-db: the full pinned file (sha256
-- cae77de9bed877951cf34c35f9bb373d2c6ef281e219df46697d49f2a561cb6d) was
-- re-applied after a prior rollback, and the ALTER TABLE step failed
-- exactly this way. The failure was loud, transaction-wrapped, and rolled
-- back atomically -- confirmed by re-fingerprinting both function bodies
-- (md5(prosrc)) before and after the failed attempt: byte-identical either
-- side, zero corruption.
--
-- THE RESOLUTION, now a known procedure rather than a rediscovery: after a
-- rollback that used THIS file, do not re-run the full 035 file. Extract
-- and re-run ONLY its two `CREATE OR REPLACE FUNCTION` statements (each
-- with its own trailing EXECUTE grant reassertion) from the exact
-- byte-identical pinned source, wrapped in a fresh BEGIN/COMMIT. The
-- ALTER TABLE and GRANT statements in the full file are no-ops in this
-- state -- the additive schema and grant are already there, left by this
-- rollback on purpose -- so skipping them changes nothing about the
-- resulting schema, only avoids the redundant (and now-erroring) DDL.
-- Verified by direct comparison against production afterward: function
-- body hashes, column types, and grants all matched exactly, on every axis
-- checked. Full record: docs/reviews/035-apply-record.md.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION apply_evening_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_parse         JSONB    DEFAULT NULL,
  p_parse_ok      JSONB    DEFAULT NULL,
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session            whatsapp_sessions;
  v_text               TEXT;
  v_log_date           DATE;
  v_outcome            TEXT;
  v_col                TEXT    := NULL;
  v_reask              INTEGER;
  v_met                BOOLEAN := NULL;
  v_complete           BOOLEAN := false;
  v_morning_equipment  JSONB;
  v_morning_count      INTEGER;
  v_headcount          INTEGER;
  v_all_productive     BOOLEAN;
  v_idle_count         INTEGER;
  v_productive_count   INTEGER;
  v_productive_count_stated INTEGER;
  v_numbers_discarded  BOOLEAN;
  v_confidence         TEXT;
  v_equip_items        JSONB;
  v_equipment_echo     JSONB   := NULL;
  i                     INTEGER;
  v_chunk_count        INTEGER;
  v_claimed            BOOLEAN[];
  v_chunk_morning_idx  INTEGER[];
  v_chunk_confidence   TEXT[];
  v_label_int          INTEGER;
  v_chunk_type         TEXT;
  v_match_idx          INTEGER;
  v_match_count        INTEGER;
  v_any_signal         BOOLEAN;
  j                     INTEGER;
BEGIN
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      v_session.context := v_session.context
                            - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask';
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'evening' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'output';

    ELSIF v_session.current_step = 2 THEN
      v_reask := COALESCE((v_session.context->>'e2_reask')::int, 0);

      IF NOT COALESCE((p_parse_ok->>'2')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('e2_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        IF COALESCE((p_parse_ok->>'2')::boolean, false) THEN
          v_met := COALESCE((p_parse->'2'->>'met')::boolean, false);
        ELSE
          v_met := false;
        END IF;

        v_session.context := v_session.context || jsonb_build_object('e2_reask', 0);
        v_col     := 'schedule_met';
        v_outcome := 'advance';

        IF v_met THEN
          v_session.current_step := 4;
        ELSE
          v_session.current_step := 3;
        END IF;
      END IF;

    ELSIF v_session.current_step = 3 THEN
      v_col              := 'miss_reason';
      v_outcome          := 'advance';
      v_session.current_step := 4;

    ELSIF v_session.current_step = 4 THEN
      v_reask := COALESCE((v_session.context->>'e4_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'4')::boolean, false) OR v_reask >= 1 THEN
        v_headcount := (p_parse->'4'->>'planned_total')::int;
        v_session.current_step := 5;
        v_session.context := v_session.context
                              || jsonb_build_object('e4_headcount', v_headcount, 'e4_reask', 0);
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      v_reask := COALESCE((v_session.context->>'e5_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'5')::boolean, false) OR v_reask >= 1 THEN
        v_headcount := (v_session.context->>'e4_headcount')::int;

        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'5')::boolean, false)
                                OR v_headcount IS NULL
                              THEN 'low' ELSE 'high' END;

        v_all_productive := (p_parse->'5'->>'all_productive')::boolean;
        IF v_all_productive IS NULL THEN
          v_all_productive := false;
        END IF;

        v_idle_count := (p_parse->'5'->>'idle_count')::int;
        IF v_all_productive THEN
          v_idle_count := 0;
        END IF;

        IF v_idle_count IS NOT NULL AND v_headcount IS NOT NULL AND v_idle_count > v_headcount THEN
          v_idle_count := NULL;
          v_confidence := 'low';
        END IF;

        v_productive_count_stated := (p_parse->'5'->>'productive_count')::int;

        IF v_idle_count IS NOT NULL AND v_productive_count_stated IS NOT NULL AND v_headcount IS NOT NULL THEN
          IF v_idle_count + v_productive_count_stated = v_headcount THEN
            v_productive_count := v_productive_count_stated;
          ELSE
            v_idle_count       := NULL;
            v_productive_count := NULL;
            v_confidence       := 'low';
          END IF;
        ELSIF v_idle_count IS NULL AND v_productive_count_stated IS NOT NULL AND v_headcount IS NOT NULL THEN
          IF v_productive_count_stated > v_headcount THEN
            v_idle_count       := NULL;
            v_productive_count := NULL;
            v_confidence       := 'low';
          ELSE
            v_idle_count       := GREATEST(v_headcount - v_productive_count_stated, 0);
            v_productive_count := v_productive_count_stated;
          END IF;
        ELSE
          v_productive_count := CASE WHEN v_headcount IS NULL OR v_idle_count IS NULL
                                      THEN NULL
                                      ELSE GREATEST(v_headcount - v_idle_count, 0) END;
          IF v_headcount IS NULL AND v_productive_count_stated IS NOT NULL THEN
            v_confidence := 'low';
          END IF;
        END IF;

        v_numbers_discarded := COALESCE((p_parse->'5'->>'numbers_discarded')::boolean, false);
        IF v_numbers_discarded THEN
          v_confidence := 'low';
        END IF;

        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;

        IF v_morning_equipment IS NULL
           OR jsonb_array_length(v_morning_equipment->'items') = 0 THEN
          v_col      := 'productivity_complete';
          v_complete := true;
        ELSE
          v_session.current_step := 6;
          v_session.context := (v_session.context - 'e4_headcount')
                                || jsonb_build_object('e5_reask', 0);
          v_col := 'productivity';
          v_equipment_echo := v_morning_equipment->'items';
        END IF;
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e5_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 6 THEN
      v_reask := COALESCE((v_session.context->>'e6_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'6')::boolean, false) OR v_reask >= 1 THEN
        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'6')::boolean, false)
                              THEN 'low' ELSE 'high' END;

        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_morning_count := COALESCE(jsonb_array_length(v_morning_equipment->'items'), 0);
        v_chunk_count    := COALESCE(jsonb_array_length(p_parse->'6'->'items'), 0);

        v_claimed           := array_fill(false, ARRAY[GREATEST(v_morning_count, 0)]);
        v_chunk_morning_idx := array_fill(NULL::integer, ARRAY[GREATEST(v_chunk_count, 0)]);
        v_chunk_confidence  := array_fill(NULL::text, ARRAY[GREATEST(v_chunk_count, 0)]);

        FOR i IN 0..v_chunk_count - 1 LOOP
          v_label_int := (p_parse->'6'->'items'->i->>'label')::int;
          IF v_label_int IS NOT NULL
             AND v_label_int BETWEEN 1 AND v_morning_count
             AND NOT v_claimed[v_label_int] THEN
            v_chunk_morning_idx[i+1] := v_label_int - 1;
            v_chunk_confidence[i+1]  := 'high';
            v_claimed[v_label_int]   := true;
          END IF;
        END LOOP;

        FOR i IN 0..v_chunk_count - 1 LOOP
          IF v_chunk_morning_idx[i+1] IS NULL THEN
            v_chunk_type := p_parse->'6'->'items'->i->>'canonical_type';
            IF v_chunk_type IS NOT NULL THEN
              v_match_idx   := NULL;
              v_match_count := 0;
              FOR j IN 0..v_morning_count - 1 LOOP
                IF NOT v_claimed[j+1]
                   AND (v_morning_equipment->'items'->j->>'type') = v_chunk_type THEN
                  v_match_idx   := j;
                  v_match_count := v_match_count + 1;
                END IF;
              END LOOP;
              IF v_match_count = 1 THEN
                v_chunk_morning_idx[i+1] := v_match_idx;
                v_chunk_confidence[i+1]  := 'high';
                v_claimed[v_match_idx+1] := true;
              END IF;
            END IF;
          END IF;
        END LOOP;

        v_any_signal := EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_parse->'6'->'items') elem
           WHERE (elem->>'label') IS NOT NULL OR (elem->>'canonical_type') IS NOT NULL
        );
        IF NOT v_any_signal AND v_chunk_count = v_morning_count AND v_morning_count > 0 THEN
          FOR i IN 0..v_chunk_count - 1 LOOP
            v_chunk_morning_idx[i+1] := i;
            v_chunk_confidence[i+1]  := 'low';
            v_claimed[i+1]           := true;
          END LOOP;
        END IF;

        v_equip_items := '[]'::jsonb;
        FOR i IN 0..v_chunk_count - 1 LOOP
          v_equip_items := v_equip_items || jsonb_build_array(
            jsonb_build_object(
              'morning_item_index', v_chunk_morning_idx[i+1],
              'type',            CASE WHEN v_chunk_morning_idx[i+1] IS NOT NULL
                                       THEN v_morning_equipment->'items'->v_chunk_morning_idx[i+1]->>'type'
                                       ELSE NULL END,
              'available_hours', (p_parse->'6'->'items'->i)->'available_hours',
              'actual_hours',    (p_parse->'6'->'items'->i)->'actual_hours',
              'idle_reason',     (p_parse->'6'->'items'->i)->'idle_reason',
              'raw',             (p_parse->'6'->'items'->i)->'raw',
              'confidence',      v_chunk_confidence[i+1]
            )
          );
        END LOOP;

        FOR i IN 0..v_morning_count - 1 LOOP
          IF NOT v_claimed[i+1] THEN
            v_equip_items := v_equip_items || jsonb_build_array(
              jsonb_build_object(
                'morning_item_index', i,
                'type',             v_morning_equipment->'items'->i->>'type',
                'available_hours',  NULL,
                'actual_hours',     NULL,
                'idle_reason',      NULL,
                'raw',              NULL,
                'confidence',       NULL
              )
            );
          END IF;
        END LOOP;

        v_col      := 'equipment_hours';
        v_complete := true;
        v_outcome  := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e6_reask', v_reask + 1);
        v_outcome := 'reask';
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_equipment_echo := v_morning_equipment->'items';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := (v_session.context
                                 - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask')
                              || jsonb_build_object('evening_submitted', true);
  END IF;

  IF v_col = 'output' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_output, evening_output_quantities)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_parse->'1')
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_output            = EXCLUDED.evening_output,
          evening_output_quantities = EXCLUDED.evening_output_quantities;

  ELSIF v_col = 'schedule_met' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_schedule_met)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_met)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_schedule_met = EXCLUDED.evening_schedule_met;

  ELSIF v_col = 'miss_reason' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_schedule_miss_reason)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_schedule_miss_reason = EXCLUDED.evening_schedule_miss_reason;

  ELSIF v_col = 'productivity' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_workers_on_site, evening_productive_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       v_headcount,
       jsonb_build_object(
         'productive_count', v_productive_count,
         'idle_count',       v_idle_count,
         'idle_reason',      p_parse->'5'->>'idle_reason',
         'raw_text',         p_parse->'5'->>'raw_text',
         'confidence',       v_confidence
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_workers_on_site     = EXCLUDED.evening_workers_on_site,
          evening_productive_manpower = EXCLUDED.evening_productive_manpower;

  ELSIF v_col = 'productivity_complete' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_workers_on_site, evening_productive_manpower,
       evening_equipment_utilisation, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       v_headcount,
       jsonb_build_object(
         'productive_count', v_productive_count,
         'idle_count',       v_idle_count,
         'idle_reason',      p_parse->'5'->>'idle_reason',
         'raw_text',         p_parse->'5'->>'raw_text',
         'confidence',       v_confidence
       ),
       jsonb_build_object('items', '[]'::jsonb, 'raw_text', NULL, 'confidence', NULL),
       p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_workers_on_site       = EXCLUDED.evening_workers_on_site,
          evening_productive_manpower   = EXCLUDED.evening_productive_manpower,
          evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation,
          evening_submitted_at          = EXCLUDED.evening_submitted_at;

  ELSIF v_col = 'equipment_hours' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_equipment_utilisation, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object('items', v_equip_items, 'raw_text', p_parse->'6'->>'raw_text',
                           'confidence', v_confidence),
       p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation,
          evening_submitted_at          = EXCLUDED.evening_submitted_at;
  END IF;

  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = v_session.context,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'outcome',        v_outcome,
    'current_flow',   v_session.current_flow,
    'current_step',   v_session.current_step,
    'log_date',       v_log_date,
    'equipment_echo', v_equipment_echo
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

CREATE OR REPLACE FUNCTION apply_morning_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_manpower      JSONB    DEFAULT NULL,
  p_manpower_ok   BOOLEAN  DEFAULT NULL,
  p_equipment     JSONB    DEFAULT NULL,
  p_equipment_ok  BOOLEAN  DEFAULT NULL,
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session    whatsapp_sessions;
  v_text       TEXT;
  v_log_date   DATE;
  v_outcome    TEXT;
  v_col        TEXT := NULL;
  v_reask      INTEGER;
  v_attendance TEXT := NULL;
  v_yesno      JSONB;
  v_attendance_defaulted BOOLEAN := NULL;
  v_attendance_raw        TEXT    := NULL;
BEGIN
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask';
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'morning' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q1_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q1_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSIF COALESCE((v_yesno->>'ok')::boolean, false) AND NOT (v_yesno->>'met')::boolean THEN
        v_session.current_step := 5;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_outcome := 'advance';
      ELSE
        v_session.current_step := 2;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_attendance := 'present';
        v_col        := 'attendance';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome    := 'advance';
      END IF;

    ELSIF v_session.current_step = 2 THEN
      v_session.current_step := 3;
      v_outcome := 'advance';
      v_col     := 'plan';

    ELSIF v_session.current_step = 3 THEN
      v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 4;
        v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
        v_outcome := 'advance';
        v_col     := 'manpower';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 4 THEN
      v_reask := COALESCE((v_session.context->>'q4_reask')::int, 0);
      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_outcome := 'advance';
        v_col     := 'equipment';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q5_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q5_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        IF COALESCE((v_yesno->>'ok')::boolean, false) AND (v_yesno->>'met')::boolean THEN
          v_attendance := 'site_holiday';
        ELSE
          v_attendance := 'absent';
        END IF;
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_col     := 'attendance_complete';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome := 'advance';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_col = 'attendance' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw;

  ELSIF v_col = 'attendance_complete' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw, is_holiday, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw, (v_attendance = 'site_holiday'), p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw,
          is_holiday           = EXCLUDED.is_holiday,
          morning_submitted_at = EXCLUDED.morning_submitted_at;

  ELSIF v_col = 'plan' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_plan)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_plan = EXCLUDED.morning_plan;

  ELSIF v_col = 'manpower' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_manpower->'planned_total',
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object('trade', t->>'trade', 'count', (t->>'planned_count')::int)
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_manpower->'by_trade', '[]'::jsonb)) AS t
         ),
         'raw_text', p_manpower->'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_manpower = EXCLUDED.morning_manpower;

  ELSIF v_col = 'equipment' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_equipment, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_equipment    = EXCLUDED.morning_equipment,
          morning_submitted_at = EXCLUDED.morning_submitted_at;
  END IF;

  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = v_session.context,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'outcome',      v_outcome,
    'current_flow', v_session.current_flow,
    'current_step', v_session.current_step,
    'log_date',     v_log_date,
    'attendance',   v_attendance
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

COMMIT;
