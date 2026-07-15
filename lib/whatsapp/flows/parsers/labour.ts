import { canonicalTrade } from './lexicon'

// Q2 labour parser (Morning Flow Pass 2). PURE — no Supabase, no IO.
//
// Domain reality (construction cofounder, overrides the spec's structured
// ambitions): answers are terse. Q2 is the ONE morning field where a number is
// genuinely needed and a single reask is worth spending. Accept:
//   - a bare number: "12"
//   - a trade breakdown if sent: "12 mason 8 helper"
//   - a number embedded in mixed Tamil/English: "12 per aalu", "8 mason da"
// The trade breakdown is ENRICHMENT: an unrecognised trade word is not stored
// (we cannot invent a canonical name), but the number still counts toward the
// total. planned_total is null ONLY when no digit appears anywhere — that null
// is the sole reask trigger for Q2 (handled by the RPC / dispatch mirror).

export interface LabourTrade {
  trade: string
  planned_count: number
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

export function parseLabourCount(raw: string): LabourParse {
  const raw_text = raw.trim()
  const tokens = splitDigitBoundaries(raw_text.toLowerCase())
    .split(/[\s,]+/)
    .filter(Boolean)

  const by_trade: LabourTrade[] = []
  let total = 0
  let sawNumber = false

  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i])) continue
    const n = parseInt(tokens[i], 10)
    sawNumber = true
    total += n
    // Associate with an adjacent trade token: the word AFTER the number is the
    // common order ("12 mason"), fall back to the word BEFORE ("mason 12").
    const after = i + 1 < tokens.length ? canonicalTrade(tokens[i + 1]) : null
    const before = i > 0 ? canonicalTrade(tokens[i - 1]) : null
    const trade = after ?? before
    if (trade) by_trade.push({ trade, planned_count: n })
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
