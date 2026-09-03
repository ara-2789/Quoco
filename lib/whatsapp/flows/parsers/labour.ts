import { canonicalTrade } from './lexicon'

// Q2 labour parser (Morning Flow Pass 2). PURE — no Supabase, no IO.
//
// Domain reality (construction cofounder, overrides the spec's structured
// ambitions): answers are terse. Q2 is the ONE morning field where a number is
// genuinely needed and a single reask is worth spending. Accept:
//   - a bare number: "12"
//   - a trade breakdown if sent: "12 mason 8 helper"
//   - a number embedded in mixed Tamil/English: "12 per aalu", "8 mason da"
// The trade breakdown is ENRICHMENT: an unrecognised trade word IS still
// stored (§42, migration 035) — the number always counts toward the total
// either way. planned_total is null ONLY when no digit appears anywhere —
// that null is the sole reask trigger for Q2 (handled by the RPC / dispatch
// mirror). SHARED PARSER: also used by evening step 2 (workers by trade),
// unchanged, per 035_evening_flow_restructuring.sql's own header ("SAME
// field names as morning's p_manpower").
//
// §42 UNMATCHED-TOKEN CAPTURE (migration 035 round 3) — an unrecognised
// trade token adjacent to a number is pushed to `by_trade` with
// `matched: false` and the token AS HEARD, instead of being silently
// dropped (the pre-035 behaviour: the number still reached `planned_total`,
// but its attribution vanished). Applies the SAME lowercasing fix as
// idle-hours.ts and the equipment-hours redesign (see those files' own
// headers): tokenising no longer lowercases the whole string up front —
// `canonicalTrade` lowercases internally at the lookup site, so a captured
// unmatched token keeps its original case ("PEB", not "peb").
//
// CONSUMED-TOKEN TRACKING, fixing a latent double-attribution bug found
// while building this: the OLD "after ?? before" tie-break could attribute
// a SECOND number to the SAME trade word twice — e.g. "25 mason 11 PEB"
// used to read the second number's `before` token (tokens[1] = "mason",
// already consumed by the FIRST number) as a second mason entry, because
// nothing tracked that "mason" had already been used. `consumedTradeTokens`
// below closes that: a token index already attributed to one number is
// never reused for another, so the second number falls through correctly to
// its own `after` token ("PEB") instead of double-counting `mason`.

export interface LabourTrade {
  trade: string
  planned_count: number
  // true when `canonicalTrade` resolved the adjacent token; false when the
  // token is preserved unmatched (§42). Always present — never omitted.
  matched: boolean
}

export interface LabourParse {
  // Sum of every number found. null => no number at all => reask (once).
  planned_total: number | null
  // Numbers we could attribute to a recognised trade. May be empty even when
  // planned_total is set (a bare "12" has a total but no trade breakdown).
  by_trade: LabourTrade[]
  // Always preserved verbatim (trimmed) — the raw answer never gets lost.
  raw_text: string
}

// Insert a space at every digit<->non-digit boundary so "12mason"/"mason12"
// tokenise the same as "12 mason". Keeps embedded-digit answers parseable.
function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

// Filler words adjacent to a labour count that are NEVER a trade name, even
// though §42 now captures unmatched tokens rather than dropping them —
// without this exclusion, "12 per aalu" would wrongly capture "per" as an
// unmatched "trade". Deliberately small and local to this file, not
// borrowed from RATE_STOPWORDS/QUANTITY_STOPWORDS (lexicon.ts), which serve
// a different question's vocabulary.
const LABOUR_FILLER_WORDS: ReadonlySet<string> = new Set([
  'per',
  'workers',
  'worker',
  'people',
  'aalu',
  'total',
  'nos',
  'persons',
  'staff',
  'labour',
  'labourers',
  'count',
])

// True when the token at this index is a real, word-like candidate for an
// unmatched-trade capture: at least one Unicode LETTER (so a transliterated
// or Tamil-script word counts, and a stray punctuation remnant from
// splitDigitBoundaries does not), and not a known filler word.
function isCandidateTradeWord(tokens: readonly string[], idx: number | null): idx is number {
  if (idx === null) return false
  const t = tokens[idx]
  return /\p{L}/u.test(t) && !LABOUR_FILLER_WORDS.has(t.toLowerCase())
}

export function parseLabourCount(raw: string): LabourParse {
  const raw_text = raw.trim()
  // Tokenise on ORIGINAL-CASE text — do not lowercase the whole string.
  // canonicalTrade lowercases internally at the lookup site; keeping the
  // tokens themselves case-intact is what lets an unmatched token be
  // captured exactly as heard (§42) instead of silently recased.
  const tokens = splitDigitBoundaries(raw_text)
    .split(/[\s,]+/)
    .filter(Boolean)

  const by_trade: LabourTrade[] = []
  const consumedTradeTokens = new Set<number>()
  let total = 0
  let sawNumber = false

  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i])) continue
    const n = parseInt(tokens[i], 10)
    sawNumber = true
    total += n

    // Associate with an adjacent trade token: the word AFTER the number is
    // the common order ("12 mason"), fall back to the word BEFORE
    // ("mason 12") — but never a token index already consumed by an earlier
    // number (the double-attribution fix, see this file's own header).
    const afterIdx = i + 1 < tokens.length && !consumedTradeTokens.has(i + 1) ? i + 1 : null
    const beforeIdx = i > 0 && !consumedTradeTokens.has(i - 1) ? i - 1 : null
    const afterCanonical = afterIdx !== null ? canonicalTrade(tokens[afterIdx]) : null
    const beforeCanonical = beforeIdx !== null ? canonicalTrade(tokens[beforeIdx]) : null

    if (afterCanonical) {
      by_trade.push({ trade: afterCanonical, planned_count: n, matched: true })
      consumedTradeTokens.add(afterIdx as number)
    } else if (beforeCanonical) {
      by_trade.push({ trade: beforeCanonical, planned_count: n, matched: true })
      consumedTradeTokens.add(beforeIdx as number)
    } else {
      // §42: neither adjacent token is a recognised trade. Capture the
      // adjacent word AS HEARD (original case) rather than dropping the
      // attribution — same after-then-before tie-break order as the
      // matched case. Only pushed when an adjacent word-like, non-filler
      // token actually exists; a bare number with no such neighbour ("12",
      // or "12 per aalu"'s filler words) correctly contributes to
      // planned_total only.
      const unmatchedIdx = isCandidateTradeWord(tokens, afterIdx)
        ? afterIdx
        : isCandidateTradeWord(tokens, beforeIdx)
          ? beforeIdx
          : null
      if (unmatchedIdx !== null) {
        by_trade.push({ trade: tokens[unmatchedIdx], planned_count: n, matched: false })
        consumedTradeTokens.add(unmatchedIdx)
      }
    }
  }

  return {
    planned_total: sawNumber ? total : null,
    by_trade,
    raw_text,
  }
}

// Whether this parse is an acceptable Q2 answer (a number was found). Drives the
// RPC's advance-vs-reask decision; mirrored in SQL as p_manpower_ok.
export function isLabourAnswered(parse: LabourParse): boolean {
  return parse.planned_total !== null
}
