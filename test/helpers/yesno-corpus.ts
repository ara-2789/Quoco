// Shared corpus of yes/no inputs, checked against BOTH implementations of
// yes/no classification that now co-exist in this product:
//   - classifyYesNo (TypeScript, lib/whatsapp/flows/parsers/lexicon.ts) --
//     used by evening Q2 (precomputed parse, passed into
//     apply_evening_flow_turn as p_parse['2']/p_parse_ok['2']) and by
//     dispatchMorningFlow (morning's pure TS mirror, unrelated to the RPC
//     call it mirrors).
//   - quoco_classify_yes_no (PL/pgSQL, supabase/migrations/
//     030_morning_flow_attendance.sql) -- used by apply_morning_flow_turn's
//     Q1/holiday-follow-up branches, ADDED 2026-08-23 specifically so
//     morning's RPC signature could stay byte-identical to the pre-migration
//     one (review package §10.1) instead of passing a precomputed flag in
//     the way evening still does.
//
// Two independently-maintained implementations of the same classification
// now live in this product permanently -- see review package §10.2 for the
// trade this represents (an overload hazard traded for a duplicate-logic
// hazard) and design-decisions-beta-feedback.md §31 for the refactor that
// would eventually reunify them into one. This corpus is the ONE thing
// containing that hazard in the meantime: every word either lexicon
// recognises must appear here, checked against BOTH sides by
// test/unit/yesno-mirror.test.ts, so a vocabulary change to one side that's
// forgotten on the other is caught immediately rather than surfacing later
// as a silently wrong `attendance` value on some vernacular reply nobody
// happened to test by hand.
//
// Every literal below is checked against the live word lists as of
// 2026-08-24 (lib/whatsapp/flows/parsers/lexicon.ts's YES_WORDS/NO_WORDS/
// NONE_WORDS) -- this file does not invent vocabulary, it enumerates what
// already exists on the TS side and asserts the SQL side agrees. TWO CASES
// BELOW (added 2026-09-03, 'ya'/'ys') are the first exception to "asserts
// the SQL side agrees" -- see pendingSqlMigration's own doc comment above
// for why, and test/unit/yesno-mirror.test.ts's own header for how the
// mirror test honours the exception without silently widening its scope.
//
// RE-TUNED FOR ATTENDANCE, 2026-08-24 (external review round 2, review
// package §11.5): 'half' moved from NO_WORDS to YES_WORDS, and
// half-day/late/coming/come/reaching/reached/way were added -- see
// lexicon.ts's own RE-TUNED note for the full decision + the accepted-cost
// tradeoff this makes on evening Q2 during the window before evening Q2 is
// deleted. Cases below were updated to match, not just appended to.
//
// TRANSLITERATED TAMIL FORMS: the lexicon recognises exactly six -- 'aama'/
// 'ama'/'aam' (yes, YES_WORDS) and 'illa'/'ille'/'illai'/'illae'/
// 'kidaiyathu'/'kedaiyathu' (no, via the shared NONE_WORDS set). All are
// included below. Named explicitly, not left implicit: this is a THIN
// vernacular surface for a Chennai-region beta where site engineers
// routinely answer in transliterated Tamil -- lexicon.ts's own header
// documents this as "Chennai-region beta: answers are terse, transliterated
// Tamil common (Roman script only -- WhatsApp text input rarely uses Tamil
// script)". Six words covering only "yes"/"no" is a real coverage gap
// against that stated user base, not a design choice this corpus should
// paper over by omission -- flagged in the review package alongside this
// file, not silently accepted here. CHECKED AGAIN as part of the 2026-08-24
// retune: none of the eight new attendance present-side forms have an
// existing Tamil transliteration in the lexicon today -- not invented here,
// same cofounder-review requirement as everything else vernacular.

export interface YesNoCorpusCase {
  input: string
  expected: { met: boolean; ok: boolean }
  /**
   * Set ONLY for a word that TS (classifyYesNo/YES_WORDS or NO_WORDS) has
   * already learned but quoco_classify_yes_no (SQL,
   * 030_morning_flow_attendance.sql, already applied/live) has not yet —
   * an already-shipped migration file cannot be edited in place (CLAUDE.md's
   * own rule), so closing this gap needs its own follow-up migration, not a
   * same-day edit here. test/unit/yesno-mirror.test.ts skips ONLY the live
   * SQL RPC assertion for a case flagged this way -- the TS assertion still
   * runs and must still pass. Remove this flag (and confirm the corpus's
   * own "every word here" invariant holds via the mirror test running
   * clean, unflagged) the moment the follow-up SQL migration ships -- it is
   * a temporary, dated exception, never a permanent one.
   */
  pendingSqlMigration?: string
}

export const YESNO_CORPUS: readonly YesNoCorpusCase[] = [
  // --- YES_WORDS, one entry per word ---
  // 'ya'/'ys' ADDED 2026-09-03 -- real engineer typos observed 2026-09-02,
  // 18:47/18:48 IST, on the live evening flow. Neither classified that
  // night: "Ya" produced a reask; "Ys" exhausted the reask budget and
  // force-advanced to the NO branch, storing a false schedule-miss reason
  // ("Completed") from what was actually a typo'd yes. TS-side only for
  // now (YES_WORDS, lexicon.ts) -- quoco_classify_yes_no's own v_yes_words
  // array (030_morning_flow_attendance.sql) is an ALREADY-APPLIED, LIVE
  // migration and cannot be edited in place; adding these words there
  // needs its own follow-up migration, deliberately not folded into 035
  // (which is reviewed, rehearsed, and about to apply). See
  // pendingSqlMigration's own doc comment above.
  { input: 'ya', expected: { met: true, ok: true }, pendingSqlMigration: '2026-09-03: needs a follow-up migration to add to quoco_classify_yes_no\'s v_yes_words' },
  { input: 'ys', expected: { met: true, ok: true }, pendingSqlMigration: '2026-09-03: needs a follow-up migration to add to quoco_classify_yes_no\'s v_yes_words' },
  { input: 'yes', expected: { met: true, ok: true } },
  { input: 'y', expected: { met: true, ok: true } },
  { input: 'yeah', expected: { met: true, ok: true } },
  { input: 'yep', expected: { met: true, ok: true } },
  { input: 'yup', expected: { met: true, ok: true } },
  { input: 'ok', expected: { met: true, ok: true } },
  { input: 'okay', expected: { met: true, ok: true } },
  { input: 'done', expected: { met: true, ok: true } },
  { input: 'completed', expected: { met: true, ok: true } },
  { input: 'complete', expected: { met: true, ok: true } },
  { input: 'finished', expected: { met: true, ok: true } },
  { input: 'achieved', expected: { met: true, ok: true } },
  { input: 'met', expected: { met: true, ok: true } },
  { input: 'full', expected: { met: true, ok: true } },
  { input: 'fully', expected: { met: true, ok: true } },
  // -- transliterated Tamil, yes --
  { input: 'aama', expected: { met: true, ok: true } },
  { input: 'ama', expected: { met: true, ok: true } },
  { input: 'aam', expected: { met: true, ok: true } },
  // -- attendance present-side forms, added 2026-08-24 (see RE-TUNED note
  //    above) -- 'half' moved here FROM NO_WORDS, the rest are new --
  { input: 'half', expected: { met: true, ok: true } },
  { input: 'half-day', expected: { met: true, ok: true } },
  { input: 'late', expected: { met: true, ok: true } },
  { input: 'coming', expected: { met: true, ok: true } },
  { input: 'come', expected: { met: true, ok: true } },
  { input: 'reaching', expected: { met: true, ok: true } },
  { input: 'reached', expected: { met: true, ok: true } },
  { input: 'way', expected: { met: true, ok: true } },
  // -- present-side PHRASES from the reviewer's own list, single-token
  //    matches proven against the realistic multi-word answer --
  { input: 'half day', expected: { met: true, ok: true } },
  { input: 'half day today', expected: { met: true, ok: true } },
  { input: 'coming late', expected: { met: true, ok: true } },
  { input: 'reaching at 11', expected: { met: true, ok: true } },
  { input: 'on the way', expected: { met: true, ok: true } },
  { input: 'reached site', expected: { met: true, ok: true } },
  { input: 'will come', expected: { met: true, ok: true } },
  { input: 'coming at 11', expected: { met: true, ok: true } },

  // --- NO_WORDS, one entry per word ---
  { input: 'no', expected: { met: false, ok: true } },
  { input: 'n', expected: { met: false, ok: true } },
  { input: 'nope', expected: { met: false, ok: true } },
  { input: 'not', expected: { met: false, ok: true } },
  { input: 'notdone', expected: { met: false, ok: true } },
  { input: 'incomplete', expected: { met: false, ok: true } },
  { input: 'pending', expected: { met: false, ok: true } },
  { input: 'partly', expected: { met: false, ok: true } },
  { input: 'partial', expected: { met: false, ok: true } },
  { input: 'partially', expected: { met: false, ok: true } },
  { input: 'mostly', expected: { met: false, ok: true } },
  { input: 'some', expected: { met: false, ok: true } },
  { input: 'delayed', expected: { met: false, ok: true } },
  { input: 'missed', expected: { met: false, ok: true } },
  { input: 'short', expected: { met: false, ok: true } },

  // --- NONE_WORDS, reused by classifyYesNo as negatives (one entry each) ---
  { input: 'none', expected: { met: false, ok: true } },
  { input: 'nothing', expected: { met: false, ok: true } },
  { input: 'nil', expected: { met: false, ok: true } },
  { input: 'na', expected: { met: false, ok: true } },
  { input: 'zero', expected: { met: false, ok: true } },
  { input: '0', expected: { met: false, ok: true } },
  { input: '-', expected: { met: false, ok: true } },
  // -- transliterated Tamil, no --
  { input: 'illa', expected: { met: false, ok: true } },
  { input: 'ille', expected: { met: false, ok: true } },
  { input: 'illai', expected: { met: false, ok: true } },
  { input: 'illae', expected: { met: false, ok: true } },
  { input: 'kidaiyathu', expected: { met: false, ok: true } },
  { input: 'kedaiyathu', expected: { met: false, ok: true } },

  // --- Compound/mixed answers -- documented behaviour (lexicon.ts's own
  // classifyYesNo doc comment): token-wise, a negative token anywhere wins
  // over an affirmative one. ---
  { input: 'yes fully done', expected: { met: true, ok: true } },
  // "no, half only" -- still met:false: 'no' itself is NO_WORDS and
  // negatives win outright regardless of 'half' now being YES_WORDS.
  { input: 'no, half only', expected: { met: false, ok: true } },
  // "yes but only half" -- CHANGED 2026-08-24 (was met:false pre-retune,
  // when 'half' was itself a negative winning over 'yes'; this case used to
  // be this corpus's own demonstration of "a negative token anywhere wins").
  // With 'half' now YES_WORDS, no token in this input is negative, so it
  // resolves affirmatively -- exactly the accepted-cost tradeoff the
  // RE-TUNED note above names for evening Q2's schedule-met semantics.
  { input: 'yes but only half', expected: { met: true, ok: true } },
  { input: 'aama seri', expected: { met: true, ok: true } },
  // A digit token anywhere still resolves via NONE_WORDS membership of that
  // SAME token, not a whole-string digit guard -- see quoco_classify_yes_no's
  // own PORT NOTE (030_morning_flow_attendance.sql) for why this is correct,
  // not an oversight: isNoneSentinel's digit guard never actually fires
  // inside classifyYesNo's own usage, since it is only ever called on
  // already-split single tokens.
  { input: '0 items', expected: { met: false, ok: true } },

  // --- Case/whitespace normalisation ---
  { input: '  YES  ', expected: { met: true, ok: true } },
  { input: 'No.', expected: { met: false, ok: true } },
  { input: 'AAMA!', expected: { met: true, ok: true } },

  // --- Unclassifiable (ok: false) ---
  { input: '', expected: { met: false, ok: false } },
  { input: 'maybe idk', expected: { met: false, ok: false } },
  { input: 'still unclear', expected: { met: false, ok: false } },
  { input: 'dunno', expected: { met: false, ok: false } },
  { input: '5', expected: { met: false, ok: false } },
] as const
