import { canonicalTrade, isNoneSentinel, isAllWorkingSentinel } from './lexicon'

// Evening step 3 (idle hours by trade) parser — NEW, migration
// 035_evening_flow_restructuring.sql. No TS counterpart existed before this
// file (review package §10, item 2). PURE — no Supabase, no IO.
//
// This question is UNCONDITIONAL (asked every evening turn, no auto-skip),
// so "nobody was idle" must be a real, common, CONFIDENT answer — never
// treated as a non-answer. See lexicon.ts's isAllWorkingSentinel for why
// that detection is a small, purpose-built list for this question alone,
// deliberately NOT classifyYesNo (that lexicon's attendance-tuned
// present-side forms — "half day", "late" — invert on this question: "half
// day" here plausibly means HALF THE DAY WAS IDLE, the opposite of the
// present/met reading classifyYesNo would give it).
//
// TRI-STATE, NOT BOOLEAN, BY DESIGN (Aravind's ruling, migration 035 round
// 3): an unparseable answer records UNKNOWN, never a fabricated zero.
// Defaulting an unclassifiable answer to "zero idle" would silently report
// the flattering number — the same failure class as the plausibility flag's
// NULL-not-false ruling (review package §5a): absence of a classifiable
// answer is recorded as absence, never as evidence of the good case. Same
// discipline migration 024 already applied once at the SQL layer (its own
// T-024-23: "unclassifiable after budget -> NULL, never a fabricated 0") —
// applied here for the first time at the TS-parser layer.
//   - by_trade non-empty          -> real per-trade idle-hours data.
//   - by_trade empty, all_working -> CONFIDENT zero (an explicit
//     "all working" / "no idle" signal was recognised).
//   - by_trade empty, !all_working -> UNKNOWN. Nothing recognisable at all —
//     no number, no trade, no all-working/none signal. NEVER coerced to
//     zero. Only ever persisted after the RPC's own reask-once budget is
//     exhausted (the same accept-the-raw-text-and-advance pattern every
//     other garbled-answer path in this codebase already uses).
//
// §42 UNMATCHED-TOKEN CAPTURE: an unrecognised trade token adjacent to a
// number is captured in `by_trade` with `matched: false` and the token AS
// HEARD (original case) — never dropped. Same lowercasing fix as labour.ts
// and the equipment-hours redesign: tokenise on original-case text, push
// `.toLowerCase()` into the `canonicalTrade` lookup only.

export interface IdleHoursTrade {
  trade: string
  idle_hours: number
  // true when `canonicalTrade` resolved the token; false when the token is
  // preserved unmatched (§42). Always present.
  matched: boolean
}

export interface IdleHoursParse {
  by_trade: IdleHoursTrade[]
  // CONFIDENT zero — an explicit "all working" / "no idle" signal was
  // recognised. Never true at the same time by_trade is non-empty in
  // practice, but isIdleHoursAnswered below (not a structural invariant
  // here) is what the RPC actually gates on.
  all_working: boolean
  // Genuinely unparseable — no number, no trade, no all-working/none
  // sentinel. NEVER coerced to a zero. true only when by_trade is empty AND
  // all_working is false.
  unknown: boolean
  // Always preserved verbatim (trimmed) — the raw answer never gets lost.
  raw_text: string
}

// Insert a space at every digit<->non-digit boundary so "2hours"/"hours2"
// tokenise the same as "2 hours".
function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

// Filler words that never become a trade name when nothing else in the
// chunk resolves — deliberately NOT PRODUCTIVITY_STOPWORDS (lexicon.ts),
// which spreads YES_WORDS/NO_WORDS and would reintroduce exactly the
// classifyYesNo-adjacent vocabulary this file's header explains staying
// away from. A small, independent list for this file alone.
const IDLE_HOURS_FILLER_WORDS: ReadonlySet<string> = new Set([
  'idle',
  'hours',
  'hour',
  'hrs',
  'for',
  'was',
  'were',
  'is',
  'are',
  'a',
  'an',
  'the',
  'team',
  'today',
])

// ANCHOR-WORD GUARD — ported from productivity.ts's anchor-word pairing
// (2026-08-10 fix + 2026-08-12 external-review round, 32 tests), Option C
// of the 2026-09-12 parser review (docs/reviews/parser-digit-
// misattribution-inventory.md), PRIORITY 1 (this parser was named the most
// exposed of the four: same "first digit wins" skeleton, no discard flag
// at all, reaches both the rendered RESOURCE body and the SUMMARY prompt
// as a citable Fact). Aravind's own ruling on WHY this pattern and not a
// stop-word list: "a stop-word list narrows the class without closing it
// -- 'Pump conked out 1 hr' would pass a list containing 'breakdown'."
//
// THE LESSON CARRIED ACROSS, stated once so it doesn't need re-deriving:
// productivity.ts's own root-cause finding (2026-08-10, "15 productive, 3
// idle waiting for material" inverted into productive_count=3) was that a
// parser trusting ANY nearby digit, with no positive confirmation that the
// digit answers the question actually being asked, will eventually attach
// a real number to the wrong thing. The fix there was never "reject known
// bad words" -- it was "require a real anchor before trusting a digit."
// Applied here: `idle_hours` is trusted ONLY when the literal word "idle"
// -- the ONE anchor this question's own vocabulary revolves around --
// appears somewhere in the chunk. "Mason left early 2 hours" has a trade
// word and a digit, exactly like "mason idle 2 hours" does, and the
// pre-port code could not tell them apart; requiring "idle" to be present
// is what tells them apart, the same way productivity.ts's anchor
// requirement told "15 productive" apart from an unrelated "2" sitting
// nearby in the same message.
//
// WHY THIS IS AN ADAPTATION, NOT A LITERAL COPY, NAMED SO THE DIFFERENCE
// ISN'T MISTAKEN FOR AN INCOMPLETE PORT:
//   1. NO BEFORE/AFTER POSITIONAL SCAN. productivity.ts distinguishes a
//      confident BEFORE match ("15 productive") from a weak AFTER match
//      ("productive 15") because its input is ONE undivided message that
//      can contain TWO competing anchors ('idle' AND 'productive') plus
//      multiple numbers, and word ORDER is the only signal separating a
//      real pairing from an unrelated one ("all productive, 2 left
//      early"). This parser already splits the raw answer into short,
//      comma/and/plus-delimited CHUNKS before this function ever runs
//      (parseIdleHoursByTrade, below) — each chunk realistically carries
//      at most one trade, one digit, and one candidate anchor ('idle').
//      The ambiguity BEFORE/AFTER exists to resolve does not arise at
//      chunk scope: there is only one anchor to check for, so "is 'idle'
//      present in this chunk at all" is the faithful equivalent, not a
//      simplification that drops coverage.
//   2. NO "SINGLE UNANCHORED NUMBER DEFAULTS TO IDLE" FALLBACK.
//      productivity.ts's own PASS 2 deliberately defaults a lone
//      unanchored number to idle_count, reasoning that its question is
//      single-topic (idle vs. productive) so an unanchored number is
//      still almost certainly about idleness. Porting that same default
//      HERE would silently readmit the exact bug this port exists to
//      close: "Mason left early 2 hours" IS a lone unanchored number, and
//      defaulting it to idle_hours is precisely the wrong call this
//      change is making. The fallback is deliberately NOT carried across.
//   3. WEAK MATCHES COLLAPSE INTO "UNKNOWN," NOT A SEPARATE FLAG.
//      productivity.ts keeps "claimed via a weak match" distinct from
//      "never found a candidate at all" (both set numbers_discarded, but
//      only because a caller elsewhere downgrades confidence on that
//      signal). This parser has no equivalent per-item confidence field,
//      and the outer three-state result (real data / all_working /
//      unknown) already gives "no confident chunk survived" a home —
//      adding a second signal with no consumer would be complexity this
//      question's design doesn't need. If a future caller needs to
//      distinguish "no anchor anywhere" from "an ambiguous anchor
//      position" for THIS parser, that is new scope, not implied by this
//      fix.
//
// GATING-BEHAVIOUR CHANGE, NAMED EXPLICITLY (2026-09-12 review round's own
// WATCH FOR): a chunk with a trade word and a digit but NO literal "idle"
// anywhere — e.g. a bare "mason 2" with no anchor at all — now returns
// null instead of a confident item. If EVERY chunk in an answer lacks the
// anchor, `isIdleHoursAnswered` flips from true to false, which crosses
// into evening.ts's `p_parse_ok['3']` and changes the RPC's reask-vs-
// advance decision for that turn (a previously-silent, possibly-wrong
// accept becomes an explicit reask instead). No existing test in this file
// or in test/evening-flow.test.ts exercises a bare "trade digit" answer
// with no anchor word, so none regress — but this is a real behaviour
// change, not merely an internal parsing fix, and is called out as such
// rather than left to be discovered later.
//
// Parse one comma/"and"-separated chunk into a trade+hours pair, or null
// when the chunk carries no usable, anchored number (garbled OR unanchored
// — both contribute to the unknown/reask path, never stored as a
// fabricated zero or an unconfirmed guess).
function parseChunk(chunk: string): IdleHoursTrade | null {
  const tokens = splitDigitBoundaries(chunk)
    .split(/\s+/)
    .filter(Boolean)

  let idle_hours: number | null = null
  let matchedTrade: string | null = null
  let firstWord: string | null = null // original case, for the unmatched fallback
  let hasIdleAnchor = false

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      if (idle_hours === null) idle_hours = parseInt(t, 10)
      continue
    }
    const lower = t.toLowerCase()
    if (lower === 'idle') {
      hasIdleAnchor = true
      continue
    }
    const kw = canonicalTrade(t) // lowercases internally
    if (kw && matchedTrade === null) {
      matchedTrade = kw
      continue
    }
    if (firstWord === null && /\p{L}/u.test(t) && !IDLE_HOURS_FILLER_WORDS.has(lower)) {
      firstWord = t
    }
  }

  if (idle_hours === null) return null
  // ANCHOR-WORD GUARD (see this function's own header comment above): a
  // digit with no "idle" anchor anywhere in the chunk is never trusted,
  // regardless of whether a trade word matched — a matched trade word only
  // says WHO the number might be about, never WHAT the number means.
  if (!hasIdleAnchor) return null

  if (matchedTrade) {
    return { trade: matchedTrade, idle_hours, matched: true }
  }
  // §42: preserve the token exactly as heard. Fall back to a generic label
  // only when literally nothing else in the chunk survives (mirrors
  // equipment.ts's own firstNameWord fallback shape).
  return { trade: firstWord ?? 'trade', idle_hours, matched: false }
}

export function parseIdleHoursByTrade(raw: string): IdleHoursParse {
  const raw_text = raw.trim()

  if (raw_text === '') return { by_trade: [], all_working: false, unknown: true, raw_text }

  // Whole-answer sentinels checked BEFORE chunking, same convention as
  // equipment.ts's isNoneSentinel check. isAllWorkingSentinel covers the
  // affirmative "all working"/"fully productive" phrasings; isNoneSentinel
  // covers the plain negatives ("no idle", "none", "nil", "illa").
  if (isAllWorkingSentinel(raw_text) || isNoneSentinel(raw_text)) {
    return { by_trade: [], all_working: true, unknown: false, raw_text }
  }

  const chunks = raw_text
    .split(/[,\n;]|\band\b|\bplus\b/i)
    .map((c) => c.trim())
    .filter(Boolean)

  const by_trade: IdleHoursTrade[] = []
  for (const chunk of chunks) {
    const item = parseChunk(chunk)
    if (item) by_trade.push(item)
  }

  if (by_trade.length === 0) {
    // Nothing recognisable — no number found anywhere, and no all-working/
    // none signal either (already checked above). UNKNOWN, not zero.
    return { by_trade: [], all_working: false, unknown: true, raw_text }
  }

  return { by_trade, all_working: false, unknown: false, raw_text }
}

// Whether this parse is an acceptable step-3 answer: real data, or a
// confident all-working signal. UNKNOWN drives the reask-once path —
// mirrored in SQL as p_parse_ok['3'].
export function isIdleHoursAnswered(parse: IdleHoursParse): boolean {
  return parse.by_trade.length > 0 || parse.all_working
}
