import { canonicalEquipment, RATE_STOPWORDS } from './lexicon'

// Q4 (equipment hours, ONE number per type) parser — Evening Flow
// restructuring (migration 035). REPLACES the old two-number, per-machine,
// MATCH-TIERS design entirely (label, available_hours, actual_hours, the
// arithmetic-guard reject that caused the 2026-08-31 production incident —
// see docs/reviews/ for the forensic record). PURE — no Supabase, no IO.
//
// TRANSITION COMPLETE (migration 035's evening.ts rewrite): this file used
// to carry BOTH this design (under the name `parseEquipmentHoursByType`)
// AND the old design (`parseEquipmentHours`) side by side, because
// evening.ts's live production wrapper still called the old one — deleting
// it in place would have shipped new-shaped TS data into the old-shaped
// live RPC body (review package §9 Finding A). That coexistence window is
// now closed: evening.ts's own rewrite and this rename land in the same
// commit, and the old design (label/available_hours/actual_hours/
// arithmetic guards/MATCH TIERS) is gone, not just superseded. This file
// reclaims the clean `parseEquipmentHours` name — the same shape migration
// 030's own §10.2 finding already described once: "an overload hazard
// traded for a duplicate-logic hazard," a bounded coexistence window,
// closed here.
//
// This parser has NO KNOWLEDGE of morning_equipment — unchanged
// architectural principle from the original Q5 parser's own header: the
// answer has to be matched back to morning_equipment.items by type string,
// and the only safe read of that list is the RPC's own locked read. This
// parser extracts only what's recoverable from the reply TEXT ALONE; the
// RPC does the type join under its own lock.
//
// NO ARITHMETIC GUARD, ON PURPOSE — the direct fix for the 2026-08-31
// incident. The old parser's arithmetic guards rejected an out-of-range
// answer outright, silently, with no explanation. Implausibility is now a
// SQL-side FLAG computed against morning_equipment's count (review package
// §5), never a TS-side rejection. Whatever number is reported is stored,
// exactly as given.
//
// LOWERCASING FIX (applied identically across labour.ts, idle-hours.ts, and
// this file): tokenise on the ORIGINAL-CASE text; push `.toLowerCase()`
// into the `canonicalEquipment` lookup call (it lowercases internally)
// rather than lowercasing the whole string up front. Matching stays
// case-insensitive; an unmatched token is captured exactly as the engineer
// typed it (§42), never silently recased.

export interface EquipmentHoursItem {
  // canonicalEquipment's output when matched, else the raw token exactly as
  // heard (original case).
  type: string
  hours_used: number
  // true when canonicalEquipment resolved the token; false when the token
  // is preserved unmatched (§42). Always present.
  matched: boolean
  raw: string
}

export interface EquipmentHoursParse {
  items: EquipmentHoursItem[]
  // Always preserved verbatim (trimmed) — the raw answer never gets lost.
  raw_text: string
}

function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

const HOURS_FILLER_WORDS: ReadonlySet<string> = new Set(['hours', 'hour', 'hrs', 'used', 'run', 'ran', 'today'])

// Parse one comma/"and"-separated chunk into an item, or null when the
// chunk carries no usable hours number at all (garbled — contributes to
// the reask path, never stored as a fabricated value).
function parseChunk(chunk: string): EquipmentHoursItem | null {
  const tokens = splitDigitBoundaries(chunk)
    .split(/\s+/)
    .filter(Boolean)

  let hours_used: number | null = null
  let matchedType: string | null = null
  let firstWord: string | null = null // original case, for the unmatched fallback

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      if (hours_used === null) hours_used = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t) // lowercases internally
    if (kw && matchedType === null) {
      matchedType = kw
      continue
    }
    const lower = t.toLowerCase()
    if (firstWord === null && /\p{L}/u.test(t) && !RATE_STOPWORDS.has(lower) && !HOURS_FILLER_WORDS.has(lower)) {
      firstWord = t
    }
  }

  if (hours_used === null) return null

  // §42: preserve the token exactly as heard when unrecognised. Fall back
  // to a generic label only when literally nothing else in the chunk
  // survives (mirrors equipment.ts's own firstNameWord fallback shape).
  const type = matchedType ?? firstWord ?? 'equipment'
  return { type, hours_used, matched: matchedType !== null, raw: chunk.trim() }
}

export function parseEquipmentHours(raw: string): EquipmentHoursParse {
  const raw_text = raw.trim()

  // Empty is handled upstream as the ordinary empty-answer reask. Return a
  // neutral non-answer.
  if (raw_text === '') return { items: [], raw_text }

  const chunks = raw_text
    .split(/[,\n;]|\band\b|\bplus\b/i)
    .map((c) => c.trim())
    .filter(Boolean)

  const items: EquipmentHoursItem[] = []
  for (const chunk of chunks) {
    const item = parseChunk(chunk)
    if (item) items.push(item)
  }

  return { items, raw_text }
}

// Whether this parse is an acceptable step-4 answer: at least one item
// parsed. Mirrored in SQL as p_parse_ok['4'].
export function isEquipmentHoursAnswered(parse: EquipmentHoursParse): boolean {
  return parse.items.length > 0
}
