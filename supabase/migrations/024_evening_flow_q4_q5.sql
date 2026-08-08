-- =============================================================================
-- 024_evening_flow_q4_q5.sql
-- Evening check-in flow, Pass 2: Q4 (headcount + productivity, two steps) and
-- Q5 (equipment hours, auto-skipped when morning listed no equipment). Q6 is
-- deliberately OUT OF SCOPE — no code anywhere gives it a parser precedent
-- (morning's own Q5/Q6 are still unbuilt Pass 3), and required_by_time has no
-- existing extraction surface to borrow. Tracked, not solved here.
--
-- WHAT THIS DOES
--   1. CREATE OR REPLACE apply_evening_flow_turn — SIGNATURE UNCHANGED (still
--      p_parse/p_parse_ok, generic JSONB keyed by step id — Q4/Q5 fit the
--      existing keying scheme, no new RPC arguments needed). Adds:
--        step 4  Q4a headcount            (reuses parseLabourCount verbatim)
--        step 5  Q4b productivity/idle    (AGGREGATE-ONLY v1, new parser)
--        step 6  Q5  equipment hours      (new parser, auto-skippable)
--      and changes the Q2=Yes / Q3 completion edges to route to step 4
--      instead of completing (022's own reserved comment already flagged
--      these two lines as the hand-off point; see the DECIDE section below).
--   2. No new daily_logs columns — evening_workers_on_site (INTEGER),
--      evening_productive_manpower (JSONB), evening_equipment_utilisation
--      (JSONB) have existed, untouched, since 001_core_schema.sql. This
--      migration is RPC-only.
--   3. EXECUTE hardening re-asserted (belt-and-braces — CREATE OR REPLACE on
--      an unchanged signature already preserves the ACL; same discipline 022
--      already established for its own re-assertion of morning's grants).
--
-- BOT-22 NULL CASE — A REAL BUG IN THE RESERVED TEST, FIXED HERE, NOT
--   INHERITED. Migration 022's own Pass-2 reserved block (022:410-422) pinned
--   the auto-skip test as `jsonb_array_length(morning_equipment->'items') = 0`.
--   That test is INCOMPLETE on its own: an engineer who never submitted
--   morning at all has NO morning_equipment value to index into —
--   `jsonb_array_length(NULL->'items')` evaluates to NULL, not 0, so the
--   pinned test alone would NOT skip Q5 for that engineer and would send a
--   "hours per machine" prompt with nothing to echo. This is a REACHABLE
--   path, not a theoretical one: BOT-22's own spec text anticipates it
--   directly — "If NO morning submission: omit the morning-plan echo (BOT-22)"
--   (bot-flows.md:97) is the identical no-morning-submission case, one
--   question earlier in the same flow. Fixed below with an explicit
--   `morning_equipment IS NULL OR jsonb_array_length(...) = 0` test. T-SM
--   covers this case by name (a full evening flow run with NO prior morning
--   submission for that engineer/day).
--
-- CONFIDENCE FLAG — LOAD-BEARING FOR DPR CORRECTNESS, NOT HYGIENE. Rule 3.5
--   promises "accept whatever comes and flag it low-confidence for PM
--   review" (design-principles.md:31); CLAUDE.md's own tracked PARSER DEBT
--   entry records that the flag half was never built anywhere in the system.
--   This migration builds it for exactly two fields — evening_productive_
--   manpower and evening_equipment_utilisation — and ONLY those two,
--   deliberately, not as a general retrofit. The reason is specific, not
--   general hygiene: Q5's actual_hours/available_hours feed DPR section 4's
--   idle-cost formula directly (bot-flows.md:223, "Idle cost per machine =
--   daily_hire_cost × (1 − actual_hours/available_hours)"), a formula the
--   owner reads as a stated rupee figure in a document they cannot
--   independently check. That formula's OTHER input, daily_hire_cost, is
--   ALREADY known to be an occasionally-miscaptured COUNT rather than a rate
--   (CLAUDE.md §10, "EQUIPMENT daily_hire_cost — A COUNT IN A MONEY FIELD") —
--   a pre-existing, unaddressed risk this migration does NOT fix (morning's
--   parser is out of scope here). Q5's own confidence signal is therefore
--   NECESSARY, not sufficient: it is the mechanism that lets a FUTURE
--   generator (not built here — dpr_generate still throws "not implemented")
--   emit something like "idle 4 of 8 hours, cost not computed — hire rate
--   unverified" instead of asserting a number when EITHER side of the
--   arithmetic is untrustworthy. This migration produces the signal; it does
--   not implement the suppression logic, which belongs to the generator when
--   it exists. The asymmetry with morning Q2/Q3 (which still have no
--   confidence field) is deliberate and accepted here for this reason
--   specifically — those two fields do not feed currency into a
--   customer-facing artifact; these two do.
--   Mechanism: 'low' when the reask budget (one reask, same
--   EVENING_PARSE_REASK_CAP as Q2) was exhausted and the raw answer was
--   accepted anyway — exactly the moment 022's own Q2 comment (022:467-477)
--   already identified as unable to flag, "no confidence field exists
--   anywhere in the system." 'high' otherwise. Computed in THIS function, at
--   write time, because only the RPC (under its lock) knows the current
--   reask counter — lib/whatsapp/flows/parsers/productivity.ts and
--   equipment-hours.ts (the pure TS PARSERS) have no session access and
--   genuinely cannot compute it themselves. The pure MIRROR
--   (dispatchEveningFlow, evening.ts) is a DIFFERENT thing — it DOES take
--   session as an argument and DOES compute this identically, since its job
--   is to police RPC drift and a field it couldn't produce would be a field
--   it couldn't check. CORRECTED (this same review pass): an earlier version
--   of this note said "the pure TS parsers have no session access" in a way
--   that read as covering the mirror too — it didn't mean to, and the mirror
--   was never actually asymmetric; only this sentence was wrong.
--   THIS SAME COMMENT ALSO NOW COVERS PER-ITEM confidence (step 6): each
--   entry in evening_equipment_utilisation.items carries its OWN confidence,
--   a DIFFERENT signal from the one above — see MATCH TIERS below for what
--   it means there (inferred-vs-stated join, not accept-after-budget).
--
--   TWO MORE FIXES, FOUND BEFORE REHEARSAL, BOTH THE SAME CLASS AS THE
--   RUPEE-FIGURE RISK ABOVE — the record asserting what the system doesn't
--   actually know, in the step 4/5 seam this time rather than the
--   daily_hire_cost/hours seam:
--     1. CONFIDENCE SPANS TWO STEPS, NOT ONE. evening_productive_manpower's
--        productive_count is derived from v_headcount — a STEP 4 value — but
--        the confidence flag was computed from p_parse_ok->'5' alone. If
--        step 4 exhausted ITS OWN budget on an unparseable headcount
--        (planned_total NULL -> e4_headcount NULL -> v_headcount NULL here),
--        a clean step-5 parse would stamp a productive_count computed from a
--        headcount nobody actually gave as confidence='high'. Fixed: v_headcount
--        is read before v_confidence is computed, and v_confidence now checks
--        v_headcount IS NULL too.
--     2. AN UNCLASSIFIABLE ANSWER MUST NOT DEFAULT TO "EVERYONE WAS
--        PRODUCTIVE." When budget is exhausted and all_productive is still
--        NULL, the boolean is forced to false ("some idle") — but the
--        original code then computed idle_count via
--        COALESCE(v_idle_count, 0), turning a genuinely-unknown count into a
--        confident zero, which made productive_count come out as the FULL
--        headcount: the stored record asserted "0 idle, everyone
--        productive" — the exact opposite of what the "some idle, count
--        unknown" comment said the fallback was, and the rosiest possible
--        reading of an answer nobody understood, on a report whose entire
--        commercial value is surfacing problems a contractor would
--        otherwise miss. Fixed: idle_count is stored exactly as parsed, NULL
--        included, never defaulted; productive_count is NULL whenever either
--        input (v_headcount or v_idle_count) is NULL, computed once and
--        reused by both write branches so they can't disagree with each
--        other. A generator reading a NULL productive_count can say "not
--        captured" — reading a fabricated 0 or a fabricated full headcount,
--        it cannot tell the difference from a real answer.
--
-- EQUIPMENT JOIN KEY / MATCH TIERS — DECIDED BEFORE THE PARSER WAS WRITTEN,
--   REVISED ONCE MORE BEFORE REHEARSAL (see LABEL BUG below for the other
--   pre-rehearsal fix). DPR section 4 needs Q5's hours matched to morning
--   Q3's daily_hire_cost, PER MACHINE. `type` string alone cannot be that
--   key: morning_equipment carries no field distinguishing two machines of
--   the SAME type at different rates (two JCBs hired separately) — a
--   type-string join would silently collide them.
--   A FIRST FIX (pure REPLY-ORDER position, i.e. reply chunk i -> morning
--   item i unconditionally) was drafted and REJECTED before rehearsal: it
--   fixes the type-collision case but breaks the moment the engineer answers
--   out of order relative to how the bot echoed the list, or answers for
--   fewer machines than were echoed — both silently attach the WRONG
--   machine's hours to the WRONG daily_hire_cost, the identical
--   wrong-currency-figure failure this whole design exists to prevent,
--   entering through the reply-order-vs-echo-order gap instead of the
--   type-collision gap. Neither pure position nor pure type-name matching
--   alone is safe; the fix is a TIERED match, applied per reply chunk, at
--   this function (which holds the lock and the morning_equipment read) —
--   "unmatched, not guessed" as the standing principle:
--     TIER 1 — explicit label match ("1)", "1.", "1:"). equipment-hours.ts
--       recognises a leading label as PURE TEXT STRUCTURE, still never
--       consulting morning_equipment — see that file's own header. A label
--       is positional-by-ECHO (the bot's own fixed, numbered prompt order),
--       not positional-by-reply, so it stays unambiguous even between two
--       machines of the same type. Matched first because it's the strongest
--       signal: an engineer who used it said so explicitly.
--     TIER 2 — canonical-type match, only when a chunk names EXACTLY ONE
--       not-yet-claimed morning item's type unambiguously. equipment-hours.ts
--       resolves the engineer's word through the SAME lexicon.ts alias table
--       morning's own equipment.ts parser used ("mixer" -> "concrete_mixer"),
--       so this is an EXACT string match against morning_equipment.items[].
--       type, never a substring search against the engineer's raw words
--       (which would miss the alias entirely). Two unclaimed items sharing a
--       name (two mixers, neither labelled) is ambiguous, not a match —
--       falls through, does not guess between them.
--     TIER 3 — pure positional fallback, ONLY when NOTHING in the whole
--       reply used a label or a recognisable type name (tiers 1/2 matched
--       ZERO chunks between them — not "not this one chunk") AND chunk count
--       exactly equals echoed item count. Realistic terse answers ("8 6, 10
--       10") carry neither signal, and without this tier section 4 goes dark
--       on most days — but this tier only fires when there is genuinely NO
--       signal being ignored: every failure actually demonstrated (the
--       rejected first fix, above) involved a type NAMED out of order,
--       which tier 2 already catches before tier 3 is ever reached.
--       confidence='low' on these entries specifically — "inferred, not
--       stated," the exact distinction the confidence field exists to carry
--       (see the CONFIDENCE FLAG note above).
--     TIER 4 — anything still unmatched: morning_item_index=NULL,
--       confidence=NULL. An orphan entry (a reply chunk with no home) is
--       preserved, not dropped, matching equipment.ts's own
--       garbled-but-accepted convention — but never joined to a guess.
--   CASE B — fewer answers than machines: every morning item NOTHING
--   matched (across all four tiers) gets an explicit "NOT REPORTED" entry
--   (morning_item_index + type set, every hours/reason field NULL,
--   confidence NULL) appended after the reply-derived entries. An absence
--   the DPR generator can see and say "not reported" about, not a silent gap
--   that reads identically to "ran the full day, no idle time."
--
-- LABEL BUG, FIXED BEFORE REHEARSAL, INDEPENDENT OF THE JOIN WORK ABOVE. The
--   Q5 prompt (buildEquipmentHoursPrompt, evening.ts) numbers the echo ("1)
--   JCB", "2) Mixer") and asks the engineer to answer in that order. Before
--   this fix, equipment-hours.ts had no label concept at all, so a FULLY
--   COMPLIANT engineer typing exactly what the prompt asked for — "1) 8 6" —
--   had its leading "1" read as available_hours and "8" as actual_hours.
--   Section 4's formula (rate × (1 − actual/available)) would then compute
--   rate × (1 − 8/1), a large NEGATIVE rupee figure, stated as fact in a
--   document the owner cannot check. Fixed in the parser (a label is
--   recognised and stripped before hours extraction runs) — orthogonal to
--   the join-key work above, but found by the same review pass.
--
-- ARITHMETIC GUARDS, ALSO INDEPENDENT, ALSO IN THE PARSER — cheap insurance
--   on a number that becomes currency. equipment-hours.ts rejects (not
--   stores) a chunk where actual_hours > available_hours (can't run more
--   than were available) or available_hours > 24 (impossible for one
--   calendar day). Either signature means a misparse. Note the SAME "1) 8 6"
--   case above would ALSO have been caught by this guard alone, with no
--   label fix at all: available_hours=1, actual_hours=8, and 8 > 1. Two
--   independent fixes, each sufficient for that one example, both worth
--   having for the cases where only one applies.
--
-- STORAGE SHAPES — OBJECT-WRAPPED, matching morning_equipment/morning_
--   manpower_planned's ACTUAL shape (and evening_output_quantities' actual,
--   if under-documented, shape — see the companion schema.md dated
--   correction in this same PR), never a bare array:
--     evening_productive_manpower =
--       {productive_count, idle_count, idle_reason, raw_text, confidence}
--     evening_equipment_utilisation =
--       {items: [{morning_item_index, type, available_hours, actual_hours,
--                 idle_reason, raw, confidence}], raw_text, confidence}
--   NOTE two DIFFERENT confidence fields at two DIFFERENT levels, not a
--   duplicate: the outer one is the accept-after-budget-exhausted signal
--   (CONFIDENCE FLAG, above); each item's own `confidence` is the MATCH
--   TIERS signal (null when unmatched/not-reported, 'high' for a
--   label/type-name match, 'low' for the tier-3 positional inference).
--   docs/schema.md's own pre-existing design note for evening_equipment_
--   utilisation (a bare array `[{type, available_hours, actual_hours,
--   idle_reason}]`) predates this decision and is corrected in the same PR.
--
-- Q2=YES / Q3 HAND-OFF — the two edges 022's own reserved comment named.
--   Q2=Yes (022:483-486) currently sets v_complete := true immediately; here
--   it instead routes to step 4. Q3's completion (022:492-496) now also
--   routes to step 4 instead of completing. Both edges converge on Q4 exactly
--   as 022 anticipated — "Pass 2 will send it to step 4 (Q4a) instead of
--   completing" / "Pass 2 will send it to step 4 instead of completing".
--
-- WHY Q4a/Q4b IS TWO STEPS, NOT ONE MESSAGE — Rule 3.2 (design-principles.md:
--   28) is explicit and names THIS exact question as its own canonical
--   example: "A two-part question is two messages (Q4 headcount/productivity
--   is the existing template)." A single inbound answering both in one
--   message is NOT a shortcut to build for — it is not a supported input.
--   Step 4a's parser reads only the headcount from whatever arrives while
--   step 4 is active; anything else in that same message is not consumed and
--   is not re-parsed for step 5 (step 5 parses the NEXT inbound). Do not
--   "fix" this into try-parse-both; that would be a real behaviour change
--   against a design rule, not a bug fix.
--
-- CONTEXT DISCIPLINE applies to every new site here (four new reask counters:
--   e4_reask, e5_reask, e6_reask, plus the intermediate e4_headcount value
--   held between steps 4 and 5) — see 022's file header for the one rule this
--   is not restated from: strip only THIS flow's own in-flight keys on
--   completion, merge everything else.
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
  v_productive_count   INTEGER;            -- NULL when either input is NULL — computed once, reused by both writes
  v_confidence         TEXT;
  v_equip_items        JSONB;
  v_equipment_echo     JSONB   := NULL;    -- returned to the caller when step 6 becomes active
  i                     INTEGER;
  -- MATCH TIERS (step 6 only) — see the file header's EQUIPMENT JOIN KEY note.
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

        -- productive_count computed ONCE, NULL-aware, reused by both write
        -- branches below so the two INSERTs can never disagree with each
        -- other on this logic.
        v_productive_count := CASE WHEN v_headcount IS NULL OR v_idle_count IS NULL
                                    THEN NULL
                                    ELSE GREATEST(v_headcount - v_idle_count, 0) END;

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
-- CREATE OR REPLACE already preserved the ACL from 022 — this is belt-and-
-- braces, matching 022's own re-assertion of morning's grants.
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
--   -- Re-apply 022's apply_evening_flow_turn body verbatim:
--   --   psql -f supabase/migrations/022_evening_flow_apply_turn.sql
--   --   (022 is CREATE OR REPLACE on an unchanged signature, so re-running
--   --   it restores the Pass-1 (Q1-Q3) body and preserves the ACL — no
--   --   DROP+CREATE, same discipline as every migration in this series.)
-- COMMIT;
--
-- Any evening_workers_on_site / evening_productive_manpower / evening_
-- equipment_utilisation data already written by this flow is left in place:
-- it is the engineer's real check-in record, not migration scaffolding.
-- =============================================================================
