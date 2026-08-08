import { classifyYesNo } from './lexicon'
import { PRODUCTIVITY_STOPWORDS } from './lexicon'

// Q4 step 2 (productivity/idle) parser — Evening Flow Pass 2. PURE — no
// Supabase, no IO.
//
// Question (bot-flows.md): "All productive, or any idle? If idle: how many +
// why?" — ONE free-text answer, not two messages. Rule 3.2's "two-part
// question is two messages" rule governs headcount-vs-productivity (Q4 step 1
// vs step 2), not this sub-question's own internal shape.
//
// AGGREGATE-ONLY v1 — DECIDED, not an oversight (design-decisions-beta-
// feedback.md §9, 2026-07-28). Ships a total idle count + free-text idle
// reason. Trade-level attribution [{trade, actual_count}] is explicitly
// deferred for three reasons verified against the code in that decision:
// canonicalTrade fails silently with no re-ask signal, coverage is
// Civil-biased (Electrical/Plumbing have zero vernacular aliases), and
// multi-word trades ("pipe fitter") cannot match the single-token positional
// tokenizer at all — an architectural gap, not a data gap. Do not "improve"
// this into a trade breakdown without reading that decision first.
//
// Reuses classifyYesNo for the all-productive/some-idle classification: its
// NO_WORDS list already contains "partly/partial/partially/mostly/half/some",
// exactly the words a hedged "some idle" answer uses. "met: true" from
// classifyYesNo reads as "all productive"; "met: false" reads as "some idle".

export interface ProductivityParse {
  // true = engineer confirmed all productive. false = some idle (idle_count
  // may still be null if no number was given). null = couldn't classify at
  // all — neither an affirmative nor a negative/hedge token was found.
  all_productive: boolean | null
  // First number found, meaningful only when all_productive is false. null
  // when all_productive is true (no idle count needed) or unclassifiable.
  idle_count: number | null
  // Remaining free text once the idle count and PRODUCTIVITY_STOPWORDS are
  // stripped. null when nothing is left (e.g. a bare "no" with no number or
  // reason) or when all_productive is true.
  idle_reason: string | null
  // Always preserved verbatim (trimmed) — the raw answer never gets lost.
  raw_text: string
}

function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

export function parseProductivity(raw: string): ProductivityParse {
  const raw_text = raw.trim()
  if (raw_text === '') {
    return { all_productive: null, idle_count: null, idle_reason: null, raw_text }
  }

  const classified = classifyYesNo(raw_text)

  if (classified.ok && classified.met) {
    // Explicit "all productive" signal — no idle count or reason to extract.
    return { all_productive: true, idle_count: null, idle_reason: null, raw_text }
  }

  // classifyYesNo said "some idle" (ok && !met), OR it couldn't classify at
  // all — check for a digit independently, since the MOST NATURAL answer to
  // "how many idle" is a bare number with no no/hedge WORD at all ("2 idle
  // waiting for cement" never says "no"). A digit is its own "some idle"
  // signal, on top of classifyYesNo's word-based one.
  const tokens = splitDigitBoundaries(raw_text.toLowerCase())
    .split(/[\s,]+/)
    .filter(Boolean)
  const hasDigit = tokens.some((t) => /^\d+$/.test(t))

  if (!classified.ok && !hasDigit) {
    // Truly unclassifiable: no no/hedge word, no number either.
    return { all_productive: null, idle_count: null, idle_reason: null, raw_text }
  }

  let idle_count: number | null = null
  const reasonWords: string[] = []
  for (const t of tokens) {
    if (/^\d+$/.test(t) && idle_count === null) {
      idle_count = parseInt(t, 10)
      continue
    }
    if (PRODUCTIVITY_STOPWORDS.has(t)) continue
    if (!/[a-z]/.test(t)) continue // stray punctuation ("-", ",") isn't a reason word
    reasonWords.push(t)
  }

  return {
    all_productive: false,
    idle_count,
    idle_reason: reasonWords.length > 0 ? reasonWords.join(' ') : null,
    raw_text,
  }
}

// Whether this parse is an acceptable Q4-step-2 answer: classifyYesNo
// resolved confidently either way. Unclassifiable (all_productive === null)
// drives the reask-once path. Mirrored in SQL as p_parse_ok['5'].
export function isProductivityAnswered(parse: ProductivityParse): boolean {
  return parse.all_productive !== null
}
