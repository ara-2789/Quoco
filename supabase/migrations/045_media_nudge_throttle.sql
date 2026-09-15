-- =============================================================================
-- 045_media_nudge_throttle.sql
--
-- HELD, NOT APPLIED ANYWHERE (not test-db, not prod). Per CLAUDE.md's own "a
-- migration file enters supabase/migrations/ when it is being applied, not
-- when it is written" rule, this file lives in docs/reviews/ alongside its
-- review package (docs/reviews/045-review-brief.md) and stays here until an
-- actual apply happens. This pass's own explicit instruction was stronger
-- than that standing default: do not apply to prod OR any remote database
-- (test-db included) at all this round -- verification for this file is a
-- local disposable dry-run only (CLAUDE.md §7's own "EVERY NEW MIGRATION
-- GETS A DISPOSABLE DRY-RUN" rule), never a real Supabase project.
-- ----------------------------------------------------------------------------
-- Stage 3 of the media capability (docs/plans/media-capture-design.md item
-- 20; full plan: docs/plans/media-capture-design.md's stage 3 entry, appended
-- by this same change). Adds ONE function: a per-phone-number throttle so an
-- idle-session photo (current_flow IS NULL) gets a nudge-plus-menu reply on
-- its first arrival in a window, then silence for any further photo inside
-- that same window -- see docs/reviews/045-review-brief.md for the full
-- design rationale, the updated_at constraint, and the fail-open choice.
--
-- EXTERNAL REVIEW GATE: trips CLAUDE.md §0's condition (a) -- "CREATES OR
-- MODIFIES a live function's LOGIC" applies to a brand-new SECURITY DEFINER
-- function exactly as it does to a changed one (the rule's own text: "a
-- brand-new SECURITY DEFINER function... has no prior safe state to fall
-- back on and is at least as dangerous as a bad change to an existing one").
-- This file and its review brief ARE that review package -- it has not yet
-- been read by Aravind, so it is NOT cleared to apply anywhere until that
-- happens, per the gate's own wording, matching 041/042/043's own held
-- posture before their review rounds.
--
-- SHAPE, DEVIATING FROM THE ILLUSTRATIVE SIGNATURE GIVEN BY NAME:
--   * The instruction's own signature was `claim_media_nudge(p_phone_number
--     text, p_now timestamptz, p_window_seconds int)` -- three arguments, no
--     tenant/user identity. That signature cannot be used AS GIVEN: this
--     function takes the exact same row-lock acquire path as
--     acquire_and_transition_session (012_whatsapp_session_transition.sql:
--     99-105) and apply_hindrance_flow_turn (044_hindrance_photos.sql:
--     441-447) -- `INSERT ... ON CONFLICT (phone_number) DO UPDATE ...
--     RETURNING`, which MATERIALISES the row the first time this phone
--     number is ever seen. whatsapp_sessions.tenant_id is NOT NULL
--     (001_core_schema.sql:89) with no default -- an INSERT that omits it
--     fails outright on a phone number's genuinely first-ever inbound
--     message (nothing upstream of routeInboundMessage's idle branch ever
--     pre-creates a whatsapp_sessions row -- readCurrentFlow, session.ts:
--     44-66, is an unlocked SELECT, never an INSERT -- so "first message
--     this phone has ever sent is a photo" is a real, reachable case, not a
--     contrived one). p_tenant_id (required, no default, mirroring 012/044's
--     own p_tenant_id) and p_user_id (nullable, DEFAULT NULL, mirroring
--     012/044's own p_user_id -- "userId null for an unregistered sender")
--     are added so the acquire step can materialise a genuinely first-ever
--     row exactly like every other flow RPC already does. Named here rather
--     than silently changed, per CLAUDE.md's own "a document submitted for
--     external review is audited for asserted-but-nonexistent artifacts, not
--     just factual correctness" discipline -- flagging a deviation from the
--     instruction as given, not presenting it as though it were asked for
--     verbatim.
--
-- WHY THERE IS NO TENANT CHECK ON AN EXISTING ROW (pinned, external review
-- fold, 2026-09-15). p_tenant_id is a MATERIALIZATION-ONLY parameter -- it
-- exists solely to satisfy whatsapp_sessions.tenant_id's NOT NULL
-- constraint on the acquire INSERT's first-ever-row branch (see above). It
-- is NEVER compared against the row's own stored tenant_id when the row
-- ALREADY EXISTS -- the acquire's own `ON CONFLICT DO UPDATE SET
-- phone_number = s.phone_number` leaves tenant_id untouched either way, and
-- nothing downstream re-reads p_tenant_id to check it against v_session's.
-- THE THROTTLE'S IDENTITY IS THE PHONE NUMBER, not the tenant -- deliberate,
-- not an oversight: a row-vs-parameter tenant divergence (this call site
-- believes phone X belongs to tenant A, the stored row says tenant B) is
-- the SAME cross-tenant phone-routing debt this project already carries
-- upstream of every session RPC (a phone number is looked up against
-- `users.whatsapp_number`, tenant-unscoped, before any of 012/044/045 ever
-- runs) -- it is not created by this function and this function is not
-- where it would be fixed. THE BLAST RADIUS of leaving it unchecked here is
-- exactly one suppressed nudge -- a false negative on whether to send a
-- reply, nothing written to any tenant-scoped table, no cross-tenant data
-- read or exposed. A guard added HERE ALONE would diverge from the
-- IDENTICAL acquire pattern already live in 012 and 044, both of which have
-- the same COALESCE-driven "first writer wins, never re-validated" shape on
-- tenant_id/user_id (012:166-173's own comment names this explicitly: "this
-- function is not the place to re-home a number between tenants; that must
-- be an explicit, separate operation") -- if that upstream debt is ever
-- closed with an explicit tenant-match check, it closes for all three
-- acquire sites TOGETHER, in one pass, not piecemeal starting here.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- claim_media_nudge -- per-phone-number burst throttle for the idle-photo
-- nudge (stage 3). Returns true the FIRST time this is called for a phone
-- number, or the first time again after p_window_seconds has elapsed since
-- the last true; false for every call inside that window. The caller (idle
-- branch of routeInboundMessage) sends the nudge+menu reply only when this
-- returns true, and sends nothing at all when it returns false.
--
-- ROW LOCK: identical acquire pattern to acquire_and_transition_session
-- (012_whatsapp_session_transition.sql:99-105) and apply_hindrance_flow_turn
-- (044_hindrance_photos.sql:441-447) -- INSERT ... ON CONFLICT (phone_number)
-- DO UPDATE SET phone_number = s.phone_number RETURNING * INTO v_session.
-- The DO UPDATE is the same deliberate no-op those two functions use: its
-- only job is to take the row lock (so two concurrent photos from the same
-- phone number cannot both read "no nudge yet" and both claim it) and return
-- the row's current values, whether the row already existed or was just
-- created by this same statement.
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT DO, stated so a future reader does
-- not assume it follows every convention the flow RPCs do:
--   * NO cross-day (BOT-07) reset. acquire_and_transition_session and
--     apply_hindrance_flow_turn both wipe current_flow/current_step/context
--     to a fresh state when quoco_same_ist_day(p_now, updated_at) is false.
--     This function never touches current_flow/current_step and only ever
--     writes ONE context key -- there is nothing here for a day-boundary
--     reset to apply to. A last_media_nudge_at value that happens to survive
--     across a day boundary is harmless by construction: the throttle window
--     (300s, per the app-side MEDIA_NUDGE_WINDOW_SECONDS constant) is many
--     orders of magnitude shorter than a day, so a stale cross-day value is
--     already "older than p_window_seconds" the moment this function next
--     runs, and is treated exactly like an absent key.
--   * NO write to updated_at, ever, on an existing row. See
--     docs/reviews/045-review-brief.md for why this is CRITICAL, not a
--     style choice: whatsapp_sessions.updated_at is what
--     quoco_same_ist_day(p_now, updated_at) reads to decide whether a flow
--     RPC's NEXT call is a same-day resume or a fresh-day reset
--     (acquire_and_transition_session, 012:115; apply_hindrance_flow_turn,
--     044:454). A throttle check that bumped updated_at on every photo would
--     make an idle session look freshly-active to that check, silently
--     defeating the cross-day reset for any phone number that happens to
--     receive an off-step photo near a day boundary. The one place
--     updated_at IS written here is the INITIAL INSERT's own VALUES clause
--     (p_now) -- that is the row's true creation moment, not a later
--     "change" to an existing row, and is exactly what every other
--     session-touching RPC's own first-ever-INSERT already does (012:102,
--     044:444).
--   * NO write to expires_at, pending_flows, current_flow, or current_step
--     on an existing row -- this function's only side effect on an existing
--     row is the one context key below. Minimises the footprint to exactly
--     what stage 3 needs; there is no TTL concept for an idle session this
--     function needs to refresh.
--   * NO cross-tenant re-homing -- COALESCE semantics are not needed here at
--     all (unlike 012/044's own tenant_id/user_id COALESCE-on-UPDATE) because
--     this function's UPDATE never touches tenant_id/user_id in the first
--     place; the acquire INSERT's own ON CONFLICT DO UPDATE already leaves
--     them untouched on an existing row (SET phone_number = s.phone_number
--     touches nothing else).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_media_nudge(
  p_phone_number   TEXT,
  p_tenant_id      UUID,
  p_user_id        UUID        DEFAULT NULL,
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_window_seconds INTEGER     DEFAULT 300,
  p_test_sleep_ms  INTEGER     DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session  whatsapp_sessions;
  v_last_raw TEXT;
  v_last     TIMESTAMPTZ;
  v_claimed  BOOLEAN := false;
BEGIN
  -- Acquire + lock. See this function's own header for why this mirrors
  -- 012/044's identical INSERT ... ON CONFLICT DO UPDATE line-for-line.
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  -- TEST-ONLY, mirrors apply_hindrance_flow_turn (044_hindrance_photos.sql:
  -- 449-451) line-for-line: same placement (immediately after the acquire,
  -- lock already held), same guard, same semantics. Forces a mid-transaction
  -- pause so a second concurrent caller on the same phone number is
  -- provably blocked on the acquire until this call commits -- the same
  -- forced-interleaving lock proof 012/013's own Test B and 044's rehearsal
  -- both rely on. NULL/no-op in production; never passed by claimMediaNudge
  -- (lib/whatsapp/session.ts), which has no parameter for it.
  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- Read the last-claimed timestamp, treating a missing key, a NULL, or an
  -- unparseable value identically as "absent" -- none of them should ever
  -- block a nudge. `->>'key'` on a genuinely absent key returns SQL NULL
  -- (no exception); casting that NULL to TIMESTAMPTZ is also NULL (no
  -- exception) -- only a non-NULL, non-timestamp STRING actually raises,
  -- which the nested block below catches.
  v_last_raw := (COALESCE(v_session.context, '{}'::jsonb)) ->> 'last_media_nudge_at';

  BEGIN
    v_last := v_last_raw::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    -- Malformed timestamp string -- treated as absent, per this function's
    -- own contract ("If absent, unparseable, or older than
    -- p_window_seconds -> claim it"). RAISE LOG'd, external review fold
    -- (2026-09-15) -- a malformed value should never have gotten into this
    -- column at all (nothing but this function's own `p_now` write ever
    -- sets last_media_nudge_at), so a real occurrence is worth a server-log
    -- trace with the actual bad value, even though behaviour does not
    -- change. SELF-HEALING, stated so a future reader does not treat a
    -- logged occurrence as an open incident needing a manual fix: the very
    -- claim this exception handler lets through OVERWRITES the malformed
    -- value with a well-formed p_now (the merge-only UPDATE below, keyed on
    -- v_claimed=true) -- corruption in this one key is bounded to exactly
    -- ONE throttle window, self-correcting on the next successful claim,
    -- never requiring intervention.
    RAISE LOG 'claim_media_nudge: malformed last_media_nudge_at for phone % -- raw value: %',
      p_phone_number, v_last_raw;
    v_last := NULL;
  END;

  IF v_last IS NULL OR p_now >= v_last + make_interval(secs => p_window_seconds) THEN
    v_claimed := true;

    -- Merge-only write. `||` replaces ONLY the `last_media_nudge_at` key;
    -- every other key already in context (e.g. a hindrance flow's own
    -- carry-forward state, if this phone happens to have some -- though an
    -- idle session by definition has none active) is left byte-identical.
    -- No write to updated_at/expires_at/current_flow/current_step/
    -- pending_flows -- see this function's own header for why.
    UPDATE whatsapp_sessions
       SET context = COALESCE(context, '{}'::jsonb)
                      || jsonb_build_object('last_media_nudge_at', p_now)
     WHERE id = v_session.id;
  END IF;

  RETURN v_claimed;
END;
$fn$;

-- Re-asserted explicitly even though a first-ever CREATE OR REPLACE has
-- nothing to preserve -- same convention every prior migration in this
-- project follows for a new SECURITY DEFINER function (e.g. 044:646-655),
-- so a future editor never has to wonder whether an omission here was
-- deliberate.
REVOKE EXECUTE ON FUNCTION public.claim_media_nudge(
  text, uuid, uuid, timestamptz, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_nudge(
  text, uuid, uuid, timestamptz, integer, integer
) TO service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.claim_media_nudge(text, uuid, uuid, timestamptz, integer, integer);
--
-- COMMIT;
