-- _lib050.sql -- helpers for the 050 PG17 dry-run (DISPOSABLE LOCAL scaffold only; never applied anywhere else).
-- Loaded after the 049 helpers (_lib.sql, _fixture.sql). Test-only objects in schema t.
CREATE OR REPLACE FUNCTION t.ok(p_label text, p_cond boolean) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN p_cond IS TRUE THEN 'PASS: ' ELSE 'FAIL: ' END || p_label $$;

-- t.turn: one engineer turn through apply_material_inward_turn (ENG1 in T1/P1). Inserts the processed_messages
-- row first, as the webhook does before the RPC. SECURITY DEFINER only so the helper can insert that row; the
-- grants of the function itself are tested separately (S4-pm.sql, T-F5-4).
CREATE OR REPLACE FUNCTION t.turn(p_phone text, p_msg text, p_sid text, p_media jsonb DEFAULT NULL,
                                  p_start boolean DEFAULT false, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.processed_messages (message_sid) VALUES (p_sid) ON CONFLICT DO NOTHING;
  RETURN public.apply_material_inward_turn(p_phone, '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
    p_msg, p_sid, p_media, p_start, p_now);
END;
$$;

-- t.media: n jpeg media items for a message
CREATE OR REPLACE FUNCTION t.media(n int) RETURNS jsonb LANGUAGE sql AS
$$ SELECT jsonb_agg(jsonb_build_object('index', i, 'content_type', 'image/jpeg', 'url', 'https://example.invalid/m/' || i)) FROM generate_series(0, n - 1) i $$;

-- t.sess: the session row of a phone as one text line
CREATE OR REPLACE FUNCTION t.sess(p_phone text) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(current_flow, 'NULL') || '/' || current_step || ' ' || context::text FROM public.whatsapp_sessions WHERE phone_number = p_phone $$;

-- t.docid / t.dlv: ids by SID / by document
CREATE OR REPLACE FUNCTION t.docid(p_sid text) RETURNS uuid LANGUAGE sql AS
$$ SELECT id FROM public.capture_documents WHERE source_message_sid = p_sid $$;
CREATE OR REPLACE FUNCTION t.dlv(p_doc uuid) RETURNS uuid LANGUAGE sql AS
$$ SELECT id FROM public.deliveries WHERE dc_document_id = p_doc OR created_from_invoice_id = p_doc $$;
CREATE OR REPLACE FUNCTION t.dstatus(p_doc uuid) RETURNS text LANGUAGE sql AS
$$ SELECT status FROM public.deliveries WHERE dc_document_id = p_doc OR created_from_invoice_id = p_doc $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO PUBLIC;
