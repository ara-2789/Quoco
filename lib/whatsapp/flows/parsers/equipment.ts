import { canonicalEquipment, detectTenure, isNoneSentinel, RATE_STOPWORDS } from './lexicon'

// Q3 equipment parser (Morning Flow Pass 2). PURE — no Supabase, no IO.
//
// Domain reality: terse Tamil/English. Answers look like "JCB 2",
// "mixer 3", "2 lorry hired", or a bare negative "illa" / "no" /
// "nothing". The spec shape is [{type, count, owned_or_hired, daily_hire_cost}];
// we keep that per-item and preserve the raw answer at the top level.
//
// Three outcomes:
//   - none:true, items:[]  -> a "no equipment" answer. ANSWERED-EMPTY, never a
//     reask. (Evening Q5 auto-skips when the list is empty, BOT-22.)
//   - items.length > 0      -> at least one confident item (a known machine
//     keyword OR a machine word carrying a number).
//   - items:[] && !none     -> garbled (non-empty but nothing recognisable):
//     the RPC / mirror reasks ONCE, then accepts the raw text and advances so a
//     field engineer is never trapped. raw_text preserves what they sent.
//
// COUNT, NOT RATE (design-decisions-beta-feedback.md §33(a), 2026-08-25,
// built 2026-09-04 as part of the production hire-rate-removal fix): Q4 now
// asks for unit count ("JCB 2" = two JCBs), not a hire rate. The engineer's
// number maps directly to `count` — the exact number he already types,
// with no new parsing logic needed to distinguish "this is a count" from
// "this is a rate". This DISSOLVES the defect that made `daily_hire_cost`
// a miscaptured count (docs/reviews/equipment-parser-count-gap.md) rather
// than patching it: there is no longer a rate for the first numeric token
// to be mistaken for. `daily_hire_cost` is kept on the shape (§33(e): the
// column and the idle-cost code stay, unwritten, for the invoice era) but
// this parser never populates it — it is always null on every return.

export interface EquipmentItem {
  type: string
  count: number | null
  owned_or_hired: 'owned' | 'hired' | null
  daily_hire_cost: number | null
  raw: string
}

export interface EquipmentParse {
  items: EquipmentItem[]
  none: boolean
  raw_text: string
}

function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

// Parse one comma/"and"-separated chunk into an item, or null when the chunk
// carries neither a known machine keyword nor a number (i.e. not a confident
// item — contributes to the garbled/reask path).
function parseChunk(chunk: string): EquipmentItem | null {
  const tokens = splitDigitBoundaries(chunk.toLowerCase())
    .split(/\s+/)
    .filter(Boolean)

  let keyword: string | null = null
  let count: number | null = null
  let firstNameWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // First number in the chunk is the unit count (§33(a)) — the field
      // gives counts ("JCB 2"), not rates. daily_hire_cost stays null.
      if (count === null) count = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && keyword === null) keyword = kw
    if (firstNameWord === null && !RATE_STOPWORDS.has(t)) firstNameWord = t
  }

  const hasNumber = count !== null
  // No known machine AND no number -> we cannot confidently call this equipment.
  if (keyword === null && !hasNumber) return null

  const type = keyword ?? firstNameWord ?? 'equipment'
  return {
    type,
    count,
    owned_or_hired: detectTenure(tokens),
    daily_hire_cost: null,
    raw: chunk.trim(),
  }
}

export function parseEquipment(raw: string): EquipmentParse {
  const raw_text = raw.trim()

  // Empty is handled upstream as the ordinary empty-answer reask (Pass 1
  // semantics), not here. Return a neutral non-answer.
  if (raw_text === '') return { items: [], none: false, raw_text }

  if (isNoneSentinel(raw_text)) return { items: [], none: true, raw_text }

  const chunks = raw_text
    .split(/[,\n;]|\band\b|\bplus\b/i)
    .map((c) => c.trim())
    .filter(Boolean)

  const items: EquipmentItem[] = []
  for (const chunk of chunks) {
    const item = parseChunk(chunk)
    if (item) items.push(item)
  }

  return { items, none: false, raw_text }
}

// Whether this parse is an acceptable Q3 answer: an explicit "none", or at least
// one confident item. Garbled (neither) drives the reask-once path. Mirrored in
// SQL as p_equipment_ok.
export function isEquipmentAnswered(parse: EquipmentParse): boolean {
  return parse.none || parse.items.length > 0
}
