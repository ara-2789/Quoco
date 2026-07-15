import { canonicalEquipment, detectTenure, isNoneSentinel, RATE_STOPWORDS } from './lexicon'

// Q3 equipment parser (Morning Flow Pass 2). PURE — no Supabase, no IO.
//
// Domain reality: terse Tamil/English. Answers look like "JCB 1500",
// "mixer 800 per day", "2 lorry hired", or a bare negative "illa" / "no" /
// "nothing". The spec shape is [{type, count, owned_or_hired, daily_hire_cost}];
// we keep that per-item and preserve the raw answer at the top level.
//
// Three outcomes:
//   - none:true, items:[]  -> a "no equipment" answer. ANSWERED-EMPTY, never a
//     reask. (Evening Q5 auto-skips when the list is empty, BOT-22.)
//   - items.length > 0      -> at least one confident item (a known machine
//     keyword OR a machine word carrying a number/rate).
//   - items:[] && !none     -> garbled (non-empty but nothing recognisable):
//     the RPC / mirror reasks ONCE, then accepts the raw text and advances so a
//     field engineer is never trapped. raw_text preserves what they sent.

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
  let cost: number | null = null
  let firstNameWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // First number in the chunk is taken as the daily hire rate — the field
      // gives rates ("JCB 1500"), not counts. count stays null.
      if (cost === null) cost = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && keyword === null) keyword = kw
    if (firstNameWord === null && !RATE_STOPWORDS.has(t)) firstNameWord = t
  }

  const hasNumber = cost !== null
  // No known machine AND no number -> we cannot confidently call this equipment.
  if (keyword === null && !hasNumber) return null

  const type = keyword ?? firstNameWord ?? 'equipment'
  return {
    type,
    count: null,
    owned_or_hired: detectTenure(tokens),
    daily_hire_cost: cost,
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
