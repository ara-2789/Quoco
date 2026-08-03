import { canonicalUnit, QUANTITY_STOPWORDS } from './lexicon'

// Q1 quantities parser (Evening Flow Pass 1). PURE — no Supabase, no IO.
//
// Q1 asks "work completed today + quantity/area", e.g.
//   "slab concrete 120 sqm, plastering 300 sft"
//   "block work 2nd floor 45 sqm"
//   "finished the column shuttering"           <- no quantity at all
//
// NOT A GATE. Unlike morning Q2 (where a missing number is the sole reask
// trigger), Q1's real answer is the free text itself — it lands in
// daily_logs.evening_output verbatim. What this parser produces is ENRICHMENT
// stored alongside it in evening_output_quantities. An answer with no number, no
// unit, or no recognisable activity is still a perfectly good Q1 answer and MUST
// NOT cost the engineer a reask. design-decisions §9 records why structured
// extraction is not trusted as a gate on this product.
//
// STORAGE SHAPE — an OBJECT, not a bare array (migration 018's precedent, and
// the shape schema.md documents for the morning columns):
//   { items: [{activity, quantity, unit, raw}], raw_text }
// raw_text preserves the engineer's answer even when items is empty.

export interface QuantityItem {
  /** Best-effort activity name; null when the chunk carried only a number. */
  activity: string | null
  /** First number found in the chunk. null when the chunk had none. */
  quantity: number | null
  /** Canonical unit (sqm/cum/bags/…), null when unrecognised or absent. */
  unit: string | null
  /** The chunk exactly as the engineer wrote it. */
  raw: string
}

export interface QuantitiesParse {
  items: QuantityItem[]
  /** Always preserved verbatim (trimmed) — the raw answer never gets lost. */
  raw_text: string
}

// Insert a space at every digit<->non-digit boundary so "120sqm" tokenises the
// same as "120 sqm". Identical treatment to the labour/equipment parsers, with
// ONE addition those don't need: a decimal point sitting between two digits
// ("12.5") is NOT a boundary, so it survives as one token instead of being
// split into "12", ".", "5" (which would truncate the quantity to 12 and leak
// a stray "." into the activity name — caught during 022 test authoring, fixed
// before this file's first commit; labour/equipment have no decimal inputs on
// their questions, so they are deliberately left untouched).
function splitDigitBoundaries(s: string): string {
  return s
    .replace(/(\d)(?!\.\d)(\D)/g, '$1 $2')
    .replace(/(\D)(?<!\d\.)(\d)/g, '$1 $2')
}

// Ordinal suffixes ("2nd floor", "3rd grid", "21st column"). A number
// immediately followed by one of these names a POSITION, not a measurement —
// "block work 2nd floor 45 sqm" must not let "2" win the quantity slot ahead
// of the real "45". Detected post-tokenisation (splitDigitBoundaries already
// separates "2nd" into "2"/"nd") and re-joined into one activity word.
const ORDINAL_SUFFIXES: ReadonlySet<string> = new Set(['st', 'nd', 'rd', 'th'])

// Parse one chunk into an item, or null when the chunk is pure noise (no number
// AND no word that could be an activity).
function parseChunk(chunk: string): QuantityItem | null {
  const tokens = splitDigitBoundaries(chunk.toLowerCase())
    .split(/\s+/)
    .filter(Boolean)

  let quantity: number | null = null
  let unit: string | null = null
  const activityWords: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const next = tokens[i + 1]

    if (/^\d+$/.test(t) && next !== undefined && ORDINAL_SUFFIXES.has(next)) {
      // "2" + "nd" -> one activity word "2nd"; the suffix token is consumed
      // here so the outer loop never reprocesses it as its own token.
      activityWords.push(t + next)
      i++
      continue
    }

    if (/^\d+(\.\d+)?$/.test(t)) {
      // First number in the chunk is the quantity. Decimals are real on site
      // ("12.5 cum"), so they parse rather than truncating.
      if (quantity === null) quantity = parseFloat(t)
      continue
    }

    const u = canonicalUnit(t)
    if (u && unit === null) {
      unit = u
      continue
    }

    if (!QUANTITY_STOPWORDS.has(t)) activityWords.push(t)
  }

  if (quantity === null && activityWords.length === 0) return null

  return {
    activity: activityWords.length > 0 ? activityWords.join(' ') : null,
    quantity,
    unit,
    raw: chunk.trim(),
  }
}

export function parseQuantities(raw: string): QuantitiesParse {
  const raw_text = raw.trim()

  // Empty is handled upstream as the ordinary empty-answer reask (the flow never
  // advances on an empty message). Return a neutral non-answer.
  if (raw_text === '') return { items: [], raw_text }

  const chunks = raw_text
    .split(/[,\n;]|\band\b|\bplus\b/i)
    .map((c) => c.trim())
    .filter(Boolean)

  const items: QuantityItem[] = []
  for (const chunk of chunks) {
    const item = parseChunk(chunk)
    if (item) items.push(item)
  }

  return { items, raw_text }
}

// Q1 is NOT parse-gated, so there is deliberately no isQuantitiesAnswered()
// counterpart to isLabourAnswered/isEquipmentAnswered. The RPC receives
// p_parse_ok['1'] = true unconditionally; adding a gate here later would be a
// behaviour change, not a refactor.
