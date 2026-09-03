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

// Parse one comma/"and"-separated chunk into a trade+hours pair, or null
// when the chunk carries no usable number (garbled — contributes to the
// unknown/reask path, never stored as a fabricated zero).
function parseChunk(chunk: string): IdleHoursTrade | null {
  const tokens = splitDigitBoundaries(chunk)
    .split(/\s+/)
    .filter(Boolean)

  let idle_hours: number | null = null
  let matchedTrade: string | null = null
  let firstWord: string | null = null // original case, for the unmatched fallback

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      if (idle_hours === null) idle_hours = parseInt(t, 10)
      continue
    }
    const kw = canonicalTrade(t) // lowercases internally
    if (kw && matchedTrade === null) {
      matchedTrade = kw
      continue
    }
    const lower = t.toLowerCase()
    if (firstWord === null && /\p{L}/u.test(t) && !IDLE_HOURS_FILLER_WORDS.has(lower)) {
      firstWord = t
    }
  }

  if (idle_hours === null) return null

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
