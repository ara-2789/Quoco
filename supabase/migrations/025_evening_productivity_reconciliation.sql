-- =============================================================================
-- 025_evening_productivity_reconciliation.sql
-- Fixes a severe, confidently-wrong bug in apply_evening_flow_turn's step 5
-- (Q4b, productivity/idle) — found by a real Twilio sandbox smoke test against
-- prod on 2026-08-10, NOT by any of the 17 unit/integration tests that existed
-- before this migration.
--
-- THE BUG. A real engineer answered Q4b "15 productive, 3 idle waiting for
-- material" against a headcount of 18. productivity.ts (pre-fix) took the
-- FIRST digit in the message as idle_count unconditionally — idle_count
-- became 15, this RPC (024's original body) derived
-- productive_count = 18 - 15 = 3, and the two numbers were EXACTLY INVERTED:
-- 16.7% manpower utilisation stored instead of 83.3%, confidence='high'
-- because the parse "succeeded" (no reask was needed). Confidently, completely
-- wrong, in the one DPR section where labour cost shows to an owner who acts
-- on it. Full trace: lib/whatsapp/flows/parsers/productivity.ts's own SEVERE
-- BUG note.
--
-- WHY THIS IS A NEW MIGRATION, NOT AN EDIT TO 024. 024 is live (confirmed via
-- direct function/column probe against prod, 2026-08-10 — this project's
-- migrations are immutable once applied, CLAUDE.md §6). The fix has TWO
-- halves and this migration is only ONE of them:
--   1. lib/whatsapp/flows/parsers/productivity.ts — anchor-word pairing
--      ('idle'/'productive' now recognised, order-independent) — and THE
--      GENERAL GUARD (numbers_discarded: true whenever a numeric token is
--      seen and cannot be placed, independent of anchor-word coverage; this
--      is the more important half — it protects against phrasings nobody
--      has written a test for yet, not just this one).
--   2. THIS FILE — the RPC has its own, independent, duplicate SQL
--      implementation of the same idle/productive derivation (found the hard
--      way: the TS-side fix alone left 4 of 5 new integration tests red
--      against real test-db, because the SQL below never read the parser's
--      new fields at all). Both halves are required; neither alone fixes
--      the incident.
--
-- WHAT CHANGES, PRECISELY — a minimal, verified diff against 024's function
-- body, not a rewrite: two new DECLARE entries (v_productive_count_stated,
-- v_numbers_discarded) and one block replaced (the "productive_count
-- computed ONCE" block becomes the RECONCILIATION block below). Every other
-- line of this ~590-line function — steps 1-4, the Q5 auto-skip decision, all
-- four equipment MATCH TIERS, every write branch, the EXECUTE grants — is
-- BYTE-IDENTICAL to 024, confirmed via `diff` against the extracted function
-- body before this file was assembled, not asserted from memory.
--
-- RECONCILIATION LOGIC (mirrors lib/whatsapp/flows/evening.ts's own TS "pure
-- mirror" — that file's RECONCILIATION comment has the full reasoning; this
-- SQL is what actually writes daily_logs, the TS mirror only predicts it):
--   - idle-only (the common case, unchanged): productive_count derived from
--     headcount - idle_count, exactly as 024 always did.
--   - BOTH idle and productive stated, and they SUM TO HEADCOUNT: real
--     confirmation, stronger than derivation — use both as parsed rather
--     than re-deriving over them.
--   - BOTH stated but they DON'T sum to headcount: a genuine contradiction.
--     Neither number is trustworthy alone — NOT a tiebreak, same posture as
--     024's own idle>headcount guard: invalidate both, confidence='low'.
--   - productive-only ("18 productive"), no idle number: derive idle the
--     mirror direction of 024's original formula.
--   - THE GENERAL GUARD: numbers_discarded=true (a numeric token the parser
--     saw and could not place) forces confidence='low' regardless of
--     whether idle_count/productive_count still came out non-null from
--     OTHER tokens in the same message — this is what would have caught the
--     original incident with ZERO anchor-word logic, since "3" was silently
--     discarded by the pre-fix parser, and a discarded token is itself the
--     confidence signal.
--
-- NOT TOUCHED, ON PURPOSE: the idle>headcount arithmetic guard, the Q5
-- auto-skip decision, all four equipment MATCH TIERS, every step 1-4 branch.
-- This migration's blast radius is exactly step 5's productivity
-- reconciliation and nothing else.
--
-- AMENDED IN PLACE, 2026-08-10, BEFORE THIS FILE WAS EVER COMMITTED, PUSHED,
-- OR APPLIED TO PROD — three more defects found in design review of the
-- first draft, fixed here rather than as a 026, per the standing rule that
-- an unapplied migration is still just a draft:
--   DEFECT 1 (productivity.ts, TS only, no SQL change) — classifyYesNo
--     returns met:true on ANY YES_WORD ('ok', 'done', 'yes'...) once no
--     NO_WORD is present, and 'idle' is not a NO_WORD. "ok, 2 idle waiting
--     for cement" classified met:true and hit the all-productive early
--     return, discarding the real idle count through the one path THE
--     GENERAL GUARD never reaches at all (an early return skips it
--     entirely) — same failure class this migration exists to fix, reached
--     through the path the guard was switched off on. Fixed: the early
--     return is now gated on !hasDigit && !hasIdleWord too.
--   DEFECT 2 (needs both copies) — the productive-only branch (below) had
--     no upper guard: headcount 18, "20 productive" produced idle=0,
--     productive=20, confidence='high' — 111% utilisation, confidently
--     wrong. The idle direction already had this guard; the mirror
--     direction didn't. Fixed symmetrically: productive_count_stated >
--     headcount invalidates rather than clamps, same posture as the
--     idle>headcount guard.
--   DEFECT 3 (needs both copies) — when headcount is NULL and the parser
--     DID anchor a productive count, the productive-only branch cannot
--     fire (it requires headcount IS NOT NULL), so control falls to the
--     idle-only ELSE branch, and the stated productive number is silently
--     dropped — never written anywhere, at whatever confidence the turn
--     already had (usually 'high'). numbers_discarded is false: the parser
--     DID place the number, it's this reconciliation that has nowhere to
--     put it. Asymmetric with a stated idle count under the same unknown-
--     headcount condition, which survives untouched — worth fixing, not
--     accepting. Fixed: flag confidence='low' in that case rather than
--     lose the signal silently. Option considered and rejected: storing
--     the productive count anyway with headcount left not_captured — honest,
--     but adds a section-5 render case nothing downstream handles today;
--     low confidence + not_captured is the smaller correct change.
--   [DATED CORRECTION, 2026-08-10, same day as the paragraph above — caught
--   independently during verification, not by this file's own author. The
--   paragraph above gets TWO claims wrong; both are worth naming precisely
--   rather than silently edited away, since this header is what a future
--   reader hits FIRST, before the inline comment 300+ lines below it that
--   already carries the corrected version.
--     (a) "at whatever confidence the turn already had (usually 'high')" is
--     FALSE. CONFIDENCE FLAG FIX 1, earlier in this same function (and its
--     mirror in evening.ts), already forces confidence to 'low' whenever
--     headcount IS NULL — unconditionally, before step 5's own logic even
--     runs. In the exact scenario this defect describes, confidence was
--     ALREADY 'low', always, never "usually high."
--     (b) "worth fixing, not accepting. Fixed:" is the OPPOSITE of what the
--     code actually does. The guard sets confidence, nothing more — it does
--     NOT recover the stated productive number, which is still never
--     written anywhere in that branch. The number loss is ACCEPTED, not
--     fixed: with headcount unknown there is no utilisation figure to
--     render regardless of which number survives, so dropping the bare
--     count to not_captured is the honest outcome, not a compromise still
--     owed. Search this file for "DEFECT 3 — CORRECTED" for the full,
--     already-corrected reasoning at the guard itself — this note exists so
--     a reader who stops at the header doesn't carry the wrong claim past
--     it.]
-- Every amendment above is IDEMPOTENT with THE GENERAL GUARD that follows
-- it — each only ever sets confidence to 'low', never contradicts a 'low'
-- already set by another guard.
--
-- STILL OUTSTANDING, RECORDED SEPARATELY, NOT FIXED HERE (CLAUDE.md §10):
-- this reconciliation now exists in two hand-mirrored copies (this file and
-- evening.ts's TS "pure mirror") with NOTHING enforcing the two agree —
-- the fourth defect of that general shape found in this review pass, not
-- fixed by inspection this time. A test that runs both copies against the
-- same fixture set and asserts identical output is the first item for the
-- next session, deliberately deferred out of this PR.
--
-- REHEARSED, NOT YET APPLIED TO PROD as of this commit — see the review
-- record for the apply decision. T-024-25 through T-024-29
-- (test/migration-024.test.ts) exercise this exact logic against test-db.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION apply_evening_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,        -- engineer; also used as daily_logs.engineer_id
  p_project_id    UUID,        -- engineer's single active project (project_members)
  p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
  p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
  p_parse         JSONB    DEFAULT NULL,  -- per-STEP parses, keyed by step id
  p_parse_ok      JSONB    DEFAULT NULL,  -- per-STEP conclusiveness, keyed by step id
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL  -- TEST-ONLY: pause after lock to force an interleave
)
RETURNS jsonb   -- { outcome, current_flow, current_step, log_date, equipment_echo }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session            whatsapp_sessions;
  v_text               TEXT;
  v_log_date           DATE;
  v_outcome            TEXT;
  v_col                TEXT    := NULL;    -- which daily_logs column(s) this turn writes (NULL = no write)
  v_reask              INTEGER;            -- current per-step reask counter
  v_met                BOOLEAN := NULL;    -- resolved Q2 answer
  v_complete           BOOLEAN := false;   -- does this turn finish the flow?
  v_morning_equipment  JSONB;              -- Pass-2 reserved read (022:410-422), now issued for real
  v_morning_count      INTEGER;
  v_headcount          INTEGER;
  v_all_productive     BOOLEAN;
  v_idle_count         INTEGER;            -- NULL means genuinely unknown, never defaulted to 0 (see step 5)
  v_productive_count   INTEGER;            -- NULL when either input is NULL, OR invalidated by a stated-count contradiction — computed once, reused by both writes
  v_productive_count_stated INTEGER;       -- 025: the productive-anchored number from the parser, if any ("15 productive") — DIFFERENT from v_productive_count, which is the RECONCILED/derived value actually stored
  v_numbers_discarded  BOOLEAN;            -- 025: TRUE when productivity.ts saw a numeric token it could not place — see that file's THE GENERAL GUARD note
  v_confidence         TEXT;
  v_equip_items        JSONB;
  v_equipment_echo     JSONB   := NULL;    -- returned to the caller when step 6 becomes active
  i                     INTEGER;
  -- MATCH TIERS (step 6 only) — see migration 024's file header for the full
  -- EQUIPMENT JOIN KEY reasoning, unchanged here.
  v_chunk_count        INTEGER;            -- length of p_parse->'6'->'items' (the reply's own chunks)
  v_claimed            BOOLEAN[];          -- 1-INDEXED, one per morning_equipment.items entry
  v_chunk_morning_idx  INTEGER[];          -- 1-INDEXED by chunk position; value is the 0-based morning index it matched, or NULL
  v_chunk_confidence   TEXT[];             -- 1-INDEXED by chunk position, parallel to v_chunk_morning_idx
  v_label_int          INTEGER;            -- tier 1 helper
  v_chunk_type         TEXT;               -- tier 2 helper — this chunk's canonical_type
  v_match_idx          INTEGER;            -- tier 2 helper — the single unclaimed morning index a type name matched
  v_match_count        INTEGER;            -- tier 2 helper — ambiguity counter (must be exactly 1 to match)
  v_any_signal         BOOLEAN;            -- tier 3 gate — did ANY chunk carry a label/canonical_type, matched or not?
  j                     INTEGER;            -- second loop variable (tier 2's inner scan over morning items)
BEGIN
  -- log_date in IST, same Asia/Kolkata discipline as quoco_same_ist_day.
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  -- (1) ATOMIC ACQUIRE. Insert-or-lock the row for this phone in one step.
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  -- (Test only) Hold the lock across an injected pause (concurrency test).
  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- (2) BOT-07 next-day reset. A previous-IST-day session (mid-flow OR completed)
  -- is wiped to idle. context := '{}' drops BOTH flows' markers and counters,
  -- which is correct: a new IST day starts clean for morning and evening alike.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  -- (3) DECIDE (mirrored in dispatchEveningFlow). --------------------------------
  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      -- CONTEXT DISCIPLINE. Clears only EVENING's own counters; morning_submitted
      -- survives. Strips the FULL Pass-2 set too, in case a same-day restart
      -- (RESTART SEMANTICS, still an open question — design-decisions §10)
      -- resumes mid-Q4/Q5; a stray e5_reask from a prior attempt must not
      -- leak into a fresh start.
      v_session.context := v_session.context
                            - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask';
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    -- Keyed on EVENING's marker; morning's idle branch keys on its own.
    IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'evening' THEN
    IF v_text = '' THEN
      -- Empty answer: reask unlimited, no write, no budget consumed.
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 (free text + enrichment) -> evening_output + quantities, advance to Q2.
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'output';

    ELSIF v_session.current_step = 2 THEN
      -- Q2 (parsed yes/no). One reask on an unclassifiable answer, then resolve.
      v_reask := COALESCE((v_session.context->>'e2_reask')::int, 0);

      IF NOT COALESCE((p_parse_ok->>'2')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('e2_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (2)
      ELSE
        IF COALESCE((p_parse_ok->>'2')::boolean, false) THEN
          v_met := COALESCE((p_parse->'2'->>'met')::boolean, false);
        ELSE
          -- Budget spent and STILL unclassifiable -> treat as NOT MET, ask Q3.
          v_met := false;
        END IF;

        v_session.context := v_session.context || jsonb_build_object('e2_reask', 0);
        v_col     := 'schedule_met';
        v_outcome := 'advance';

        IF v_met THEN
          -- Plan met -> Q3 skipped, route to Q4 (022's own reserved edge —
          -- Pass 1 completed here; Pass 2 sends it onward instead).
          v_session.current_step := 4;
        ELSE
          v_session.current_step := 3;
        END IF;
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- Q3 (free text) -> miss reason, route to Q4 (022's other reserved
      -- edge — was the Pass-1 terminal, now hands off instead of completing).
      v_col              := 'miss_reason';
      v_outcome          := 'advance';
      v_session.current_step := 4;

    ELSIF v_session.current_step = 4 THEN
      -- Q4 step 1 (headcount). Reuses parseLabourCount verbatim — p_parse->'4'
      -- has the SAME shape as morning's p_manpower; only planned_total is
      -- persisted, by_trade doesn't apply to a headcount question. Held in
      -- context (e4_headcount) for step 5's productive_count computation, NOT
      -- written to daily_logs yet — evening_workers_on_site is written
      -- together with the productivity split in step 5's write so a partial
      -- Q4 can never show a headcount with no productivity data alongside it.
      v_reask := COALESCE((v_session.context->>'e4_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'4')::boolean, false) OR v_reask >= 1 THEN
        v_headcount := (p_parse->'4'->>'planned_total')::int;
        v_session.current_step := 5;
        v_session.context := v_session.context
                              || jsonb_build_object('e4_headcount', v_headcount, 'e4_reask', 0);
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e4_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (4)
      END IF;

    ELSIF v_session.current_step = 5 THEN
      -- Q4 step 2 (productivity/idle). AGGREGATE-ONLY v1 (design-decisions
      -- §9) — no trade breakdown, ever. See parseProductivity's header.
      v_reask := COALESCE((v_session.context->>'e5_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'5')::boolean, false) OR v_reask >= 1 THEN
        -- v_headcount read FIRST, deliberately, so the CONFIDENCE FLAG below
        -- can see it — see the two fixes this block carries, found before
        -- rehearsal, both the same class as the DPR idle-cost risk this
        -- whole confidence mechanism exists for: the record asserting what
        -- the system doesn't actually know.
        v_headcount := (v_session.context->>'e4_headcount')::int;

        -- CONFIDENCE FLAG FIX 1 — the object this stamps spans TWO steps
        -- (productive_count is derived from v_headcount, a STEP 4 value),
        -- so the flag has to span both too. Checking p_parse_ok->'5' alone
        -- misses this: if step 4 exhausted ITS OWN budget on an unparseable
        -- headcount (planned_total NULL -> e4_headcount NULL ->
        -- v_headcount NULL here), the stored productive_count would be
        -- computed from a headcount nobody actually gave, and a clean step-5
        -- parse would stamp that fabricated number confidence='high'.
        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'5')::boolean, false)
                                OR v_headcount IS NULL
                              THEN 'low' ELSE 'high' END;

        v_all_productive := (p_parse->'5'->>'all_productive')::boolean;
        IF v_all_productive IS NULL THEN
          -- Budget exhausted and STILL unclassifiable -> treat the BOOLEAN as
          -- SOME IDLE (mirrors evening_schedule_met's own established
          -- precedent, 022's Q2 comment: pick the concrete, conservative
          -- value rather than leave a boolean-typed field NULL). The COUNT is
          -- a separate question — see FIX 2 immediately below; forcing the
          -- boolean does not license inventing a number for the count.
          v_all_productive := false;
        END IF;

        -- CONFIDENCE FLAG FIX 2 — idle_count is read and left AS PARSED,
        -- NULL included; never defaulted to 0 here. The bug this replaces:
        -- COALESCE(v_idle_count, 0) turned "genuinely unknown" into "zero
        -- idle", which made productive_count come out as the FULL headcount
        -- — the record asserting "everyone was productive" as the resting
        -- state for an answer nobody understood, the exact opposite of what
        -- the accompanying comment said the fallback was ("some idle, count
        -- unknown") and the rosiest possible reading on a report whose
        -- entire commercial value is surfacing problems, not hiding them
        -- under uncertainty. NULL propagates to v_productive_count below,
        -- and from there to the stored record — "not captured", not "zero".
        v_idle_count := (p_parse->'5'->>'idle_count')::int;
        IF v_all_productive THEN
          v_idle_count := 0;  -- "all productive" IS a real, confident zero
        END IF;
        -- else: v_idle_count stays exactly what the parser gave — NULL means
        -- genuinely unknown (e.g. "mostly", no count offered), a real number
        -- means a real number. Never coerced.

        -- ARITHMETIC GUARD — idle_count > headcount is impossible (can't
        -- have more idle workers than were on site at all). Same class as
        -- Q5's actual_hours > available_hours guard (equipment-hours.ts) —
        -- a signature that means a misparse, not a real answer. Checked
        -- HERE, not in the parser: productivity.ts has no access to
        -- headcount at all (a step-4 value, cross-step — the same reason
        -- the CONFIDENCE FLAG fixes above live in the RPC, not the parser).
        -- Invalidates rather than clamps: the code this replaces silently
        -- computed GREATEST(headcount - idle_count, 0), which is exactly
        -- the "everyone was productive" fabrication the FIX above already
        -- closed for the unclassifiable case — reachable a second way,
        -- through a real but impossible number instead of a missing one.
        IF v_idle_count IS NOT NULL AND v_headcount IS NOT NULL AND v_idle_count > v_headcount THEN
          v_idle_count := NULL;
          v_confidence := 'low';
        END IF;

        -- 025 RECONCILIATION — mirrors evening.ts's own TS "pure mirror"
        -- reconciliation verbatim (see that file's RECONCILIATION comment
        -- for the full reasoning; this SQL block is the thing that
        -- actually writes daily_logs, the TS mirror only predicts it).
        -- v_productive_count_stated is populated only when the engineer's
        -- reply anchored a number to the word "productive" ("15
        -- productive, 3 idle") — productivity.ts's fix, 2026-08-10. NULL
        -- in the common idle-only case, which falls straight through to
        -- the ORIGINAL 024 derivation in the ELSE branch below, unchanged.
        v_productive_count_stated := (p_parse->'5'->>'productive_count')::int;

        IF v_idle_count IS NOT NULL AND v_productive_count_stated IS NOT NULL AND v_headcount IS NOT NULL THEN
          IF v_idle_count + v_productive_count_stated = v_headcount THEN
            -- Real confirmation, stronger than derivation — use both as
            -- parsed rather than re-deriving over them.
            v_productive_count := v_productive_count_stated;
          ELSE
            -- Genuine contradiction. Neither number is trustworthy alone —
            -- not a tiebreak, same posture as the idle>headcount guard
            -- just above: invalidate both, never silently pick one.
            v_idle_count       := NULL;
            v_productive_count := NULL;
            v_confidence       := 'low';
          END IF;
        ELSIF v_idle_count IS NULL AND v_productive_count_stated IS NOT NULL AND v_headcount IS NOT NULL THEN
          -- Productive-only ("18 productive"), no idle number at all —
          -- derive idle the mirror direction of the original 024 formula.
          -- GUARD (DEFECT 2, design review before this migration ever
          -- reached prod): productive_count_stated > headcount is
          -- impossible, same posture as the idle>headcount guard earlier
          -- in this function — invalidate, never clamp GREATEST(...) into
          -- a confident 0.
          IF v_productive_count_stated > v_headcount THEN
            v_idle_count       := NULL;
            v_productive_count := NULL;
            v_confidence       := 'low';
          ELSE
            v_idle_count       := GREATEST(v_headcount - v_productive_count_stated, 0);
            v_productive_count := v_productive_count_stated;
          END IF;
        ELSE
          -- productive_count computed ONCE, NULL-aware, reused by both write
          -- branches below so the two INSERTs can never disagree with each
          -- other on this logic. UNCHANGED FROM 024 — the idle-only case,
          -- still the common one, still derives exactly as it always did.
          v_productive_count := CASE WHEN v_headcount IS NULL OR v_idle_count IS NULL
                                      THEN NULL
                                      ELSE GREATEST(v_headcount - v_idle_count, 0) END;
          -- DEFECT 3 — CORRECTED 2026-08-10, same day as the original fix:
          -- the comment this replaces claimed this guard "flags, doesn't
          -- lose silently" — false, and worth naming precisely rather than
          -- left misdescribed (this project has been bitten before by a
          -- comment misstating whether a guard was load-bearing). The
          -- number IS still lost: when headcount is unknown AND the parser
          -- anchored a productive count ("15 productive" with no headcount
          -- to check it against), the productive-only ELSIF above cannot
          -- fire (it requires v_headcount IS NOT NULL), so this branch runs
          -- and v_productive_count_stated is never written anywhere — this
          -- IF sets confidence, nothing more, and does NOT recover the
          -- number. ACCEPTED, not fixed: with headcount unknown there is no
          -- utilisation figure to render regardless of which number
          -- survives, so dropping the bare count to not_captured is the
          -- honest outcome, not a compromise. And on the CURRENT confidence
          -- formula (CONFIDENCE FLAG FIX 1, above: v_headcount IS NULL
          -- already forces v_confidence := 'low' before step 5's own logic
          -- even runs) this IF is a NO-OP today, redundant with that
          -- formula, not an independent fix. Kept anyway as an explicit
          -- guard for the day FIX 1's headcount-null condition is ever
          -- narrowed or removed — at which point this stops being
          -- redundant and starts being the only thing catching this case.
          IF v_headcount IS NULL AND v_productive_count_stated IS NOT NULL THEN
            v_confidence := 'low';
          END IF;
        END IF;

        -- THE GENERAL GUARD (025) — a numeric token the parser saw and
        -- could not place is itself a reason not to trust this answer,
        -- independent of whether v_idle_count/v_productive_count still
        -- came out non-null from OTHER tokens in the same message. See
        -- productivity.ts's own THE GENERAL GUARD note for why this
        -- matters more than the reconciliation above: it protects against
        -- phrasings nobody has written a test for yet, not just the one
        -- the 2026-08-10 sandbox smoke test found.
        v_numbers_discarded := COALESCE((p_parse->'5'->>'numbers_discarded')::boolean, false);
        IF v_numbers_discarded THEN
          v_confidence := 'low';
        END IF;

        -- Q5 AUTO-SKIP DECISION (BOT-22) — the single current-day daily_logs
        -- read 022's Pass-1 reserved block anticipated, issued for real here.
        -- CORRECTED vs that block's own pinned test — see the file header's
        -- BOT-22 NULL CASE note: morning_equipment can be NULL (no morning
        -- submission at all), and jsonb_array_length(NULL->'items') is NULL,
        -- not 0, so the literal pinned test alone would not have skipped Q5
        -- for that engineer. Explicit NULL check added ahead of it.
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;

        IF v_morning_equipment IS NULL
           OR jsonb_array_length(v_morning_equipment->'items') = 0 THEN
          -- SKIP Q5 entirely, complete now. Store an EMPTY utilisation array
          -- per bot-flows.md's own instruction ("store empty utilisation
          -- array") — this does NOT distinguish "no morning submission" from
          -- "morning said no equipment"; both produce the identical empty
          -- shape by design. A future reader wanting that distinction must
          -- read daily_logs.morning_equipment itself (NULL vs {none:true} vs
          -- populated), not this column.
          v_col      := 'productivity_complete';
          v_complete := true;
        ELSE
          v_session.current_step := 6;
          v_session.context := (v_session.context - 'e4_headcount')
                                || jsonb_build_object('e5_reask', 0);
          v_col := 'productivity';
          -- EQUIPMENT JOIN KEY / ECHO ORDER — see the file header. The
          -- caller renders the Q5 prompt from this list, in THIS order; that
          -- fixed order is what makes the step-6 positional join valid.
          v_equipment_echo := v_morning_equipment->'items';
        END IF;
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e5_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (5)
      END IF;

    ELSIF v_session.current_step = 6 THEN
      -- Q5 (equipment hours). Only reached when morning_equipment was
      -- non-empty at step 5 — see the auto-skip decision above.
      v_reask := COALESCE((v_session.context->>'e6_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'6')::boolean, false) OR v_reask >= 1 THEN
        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'6')::boolean, false)
                              THEN 'low' ELSE 'high' END;

        -- EQUIPMENT JOIN KEY / MATCH TIERS — see the file header for the full
        -- reasoning. Second, independent read of morning_equipment (each RPC
        -- call is its own transaction; step 5's read does not carry over).
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_morning_count := COALESCE(jsonb_array_length(v_morning_equipment->'items'), 0);
        v_chunk_count    := COALESCE(jsonb_array_length(p_parse->'6'->'items'), 0);

        -- v_claimed is 1-INDEXED (plpgsql's array_fill default) even though
        -- every morning item elsewhere in this function is addressed
        -- 0-indexed — always write v_claimed[i+1] for a 0-based morning
        -- index i. Flagged at every access below, not just here: this is the
        -- one indexing inconsistency in this function, and getting it wrong
        -- would silently misjoin machines — exactly the class of bug this
        -- whole tier system exists to prevent.
        v_claimed           := array_fill(false, ARRAY[GREATEST(v_morning_count, 0)]);
        v_chunk_morning_idx := array_fill(NULL::integer, ARRAY[GREATEST(v_chunk_count, 0)]);
        v_chunk_confidence  := array_fill(NULL::text, ARRAY[GREATEST(v_chunk_count, 0)]);

        -- TIER 1 — explicit label match ("1)", "1.", "1:"). equipment-hours.ts
        -- recognises these as pure text structure, never morning_equipment —
        -- unambiguous even between two machines of the SAME type, since it's
        -- positional-by-ECHO (fixed, known order), not positional-by-REPLY
        -- (which is exactly what broke before this fix).
        FOR i IN 0..v_chunk_count - 1 LOOP
          v_label_int := (p_parse->'6'->'items'->i->>'label')::int;
          IF v_label_int IS NOT NULL
             AND v_label_int BETWEEN 1 AND v_morning_count
             AND NOT v_claimed[v_label_int] THEN
            v_chunk_morning_idx[i+1] := v_label_int - 1;  -- store as 0-based morning index
            v_chunk_confidence[i+1]  := 'high';
            v_claimed[v_label_int]   := true;
          END IF;
        END LOOP;

        -- TIER 2 — canonical-type match, only when a chunk names EXACTLY ONE
        -- not-yet-claimed morning item's type unambiguously. canonical_type
        -- is computed by equipment-hours.ts via the SAME lexicon.ts alias
        -- table morning's own equipment.ts parser used to produce
        -- morning_equipment.items[].type — an EXACT string match here, never
        -- a substring search against the engineer's raw words (which would
        -- miss e.g. "mixer" -> "concrete_mixer" entirely).
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
              -- v_match_count = 0 (no unclaimed item has this type) or > 1
              -- (two unclaimed items share it, e.g. two mixers, neither
              -- labelled) both fall through unmatched — an ambiguous name
              -- match is exactly as unsafe as no match, never guessed.
            END IF;
          END IF;
        END LOOP;

        -- TIER 3 — pure positional fallback, ONLY when NOTHING in the WHOLE
        -- reply carried a label or a recognisable type name — checked by
        -- PRESENCE of the signal (any chunk's label/canonical_type is
        -- non-null), NOT by whether tiers 1/2 successfully resolved a match.
        -- An AMBIGUOUS type name (e.g. two unlabelled mixers, both naming
        -- "mixer") is still a signal that was IGNORED, not absent — it must
        -- NOT fall through to a positional guess; it stays tier-4 unmatched.
        -- This is why v_any_signal is computed from the RAW parsed chunks
        -- (p_parse->'6'), not from v_chunk_morning_idx (which only reflects
        -- what actually got matched). Also requires chunk count to exactly
        -- equal echoed item count. Realistic terse answers ("8 6, 10 10")
        -- carry neither signal, and without this tier section 4 goes dark on
        -- most days — but it fires only when there is genuinely no signal
        -- being ignored: every failure actually demonstrated involved a type
        -- NAMED out of order, which tier 2 already catches. confidence='low'
        -- marks these as inferred, not stated.
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

        -- TIER 4 (implicit) — any chunk still unmatched here keeps
        -- morning_item_index=NULL, confidence=NULL: unmatched, not guessed.
        -- Any count mismatch that isn't tier 1/2-resolved lands here.

        -- BUILD STORED ITEMS — one entry per reply chunk (whichever tier
        -- matched it, or unmatched), THEN one explicit "NOT REPORTED" entry
        -- per morning item nothing matched (Case B: fewer answers than
        -- machines — an absence the DPR generator can see, not a silent gap
        -- masquerading as "no idle time").
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
        v_outcome := 'reask';   -- step unchanged (6)
        -- Q5's prompt is DATA-DRIVEN (the machine list), unlike steps 1-5's
        -- static text — a reask has to carry the same echo again so the
        -- caller can re-render the full per-machine prompt, not a generic
        -- "didn't get that". Same read as the advance path; cheap, and Q5's
        -- reask budget is at most one extra read per engineer per day.
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_equipment_echo := v_morning_equipment->'items';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- A DIFFERENT flow is active (morning). Same contract as the morning RPC's
    -- ELSE branch: report it so the webhook retries against the right function
    -- instead of silently swallowing the engineer's answer.
    v_outcome := 'wrong_flow';
  END IF;

  -- (3a) COMPLETION — CONTEXT DISCIPLINE. MERGE the marker, never replace.
  -- Strips every one of evening's own in-flight keys, not just e2_reask.
  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := (v_session.context
                                 - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask')
                              || jsonb_build_object('evening_submitted', true);
  END IF;

  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a column
  -- was resolved above. UNIQUE(project_id, engineer_id, log_date) backs the upsert.
  IF v_col = 'output' THEN
    -- Q1: first evening answer materialises the row if morning never did.
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
    -- Q4 step 2, NOT the auto-skip edge: productivity resolved, Q5 next.
    -- Also the FIRST point evening_workers_on_site is written — see the
    -- step-4 comment for why it's held rather than written immediately.
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
    -- Q4 step 2, AUTO-SKIP edge (BOT-22): productivity resolved AND Q5
    -- skipped in the same turn — one write, so a partial state (productivity
    -- written, equipment column forever NULL) can never be observed between
    -- turns.
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

  -- (4b) SESSION WRITE — ALWAYS. Refreshes TTL + updated_at and persists the
  -- (merged) context, including the reask counter on a reask turn.
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

-- -----------------------------------------------------------------------------
-- EXECUTE hardening re-assertion (020 discipline). Signature is UNCHANGED, so
-- CREATE OR REPLACE already preserved the ACL from 024 — this is belt-and-
-- braces, matching every prior migration's own re-assertion.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference — exact inverse, no PITR dependency, no data
-- mutation beyond restoring the RPC body)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   -- Re-apply 024's apply_evening_flow_turn body verbatim:
--   --   psql -f supabase/migrations/024_evening_flow_q4_q5.sql
--   --   (024 is CREATE OR REPLACE on an unchanged signature, so re-running
--   --   it restores the pre-025 body and preserves the ACL — no DROP+CREATE,
--   --   same discipline as every migration in this series.)
--   -- ROLLING BACK RESTORES THE INVERTED-NUMBERS BUG. This is not a neutral
--   -- rollback — 024's original step-5 body is what produced the incident
--   -- this migration exists to fix. Only roll back if 025 itself introduced
--   -- a WORSE regression; rolling back to "fix" an unrelated issue trades a
--   -- known, silent, confidently-wrong data corruption bug back in.
-- COMMIT;
--
-- Any evening_workers_on_site / evening_productive_manpower / evening_
-- equipment_utilisation data already written by either 024's or 025's body
-- is left in place: it is the engineer's real check-in record, not migration
-- scaffolding. The one exception, handled separately, not by this migration:
-- the 2026-08-10 sandbox smoke test's own test row (engineer
-- 3534756b-2a32-4b91-954b-0bab15c2dba1, log_date 2026-08-10), which is test
-- artifact data per the standing discipline, not a real check-in.
-- =============================================================================
