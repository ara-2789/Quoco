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

// Tokenize on ORIGINAL-CASE text (LOWERCASING FIX, matching equipment-hours.ts/
// labour.ts/idle-hours.ts's own convention) — needed so a split-out
// sub-segment's `raw` (below) can preserve the engineer's own casing, not a
// force-lowercased copy. Digit/keyword matching stays case-insensitive
// throughout (canonicalEquipment lowercases internally; every other
// comparison below lowercases the individual token first).
function tokenize(chunk: string): string[] {
  return splitDigitBoundaries(chunk).split(/\s+/).filter(Boolean)
}

// Parse one token run (a whole chunk, or a keyword-bounded sub-segment of
// one — see parseChunk below) into an item, or null when it carries neither
// a known machine keyword nor a number (i.e. not a confident item —
// contributes to the garbled/reask path).
function parseTokens(tokens: readonly string[], raw: string): EquipmentItem | null {
  let keyword: string | null = null
  let count: number | null = null
  let firstNameWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // First number in this run is the unit count (§33(a)) — the field
      // gives counts ("JCB 2"), not rates. daily_hire_cost stays null.
      if (count === null) count = parseInt(t, 10)
      continue
    }
    const lower = t.toLowerCase()
    const kw = canonicalEquipment(lower)
    if (kw && keyword === null) keyword = kw
    if (firstNameWord === null && !RATE_STOPWORDS.has(lower)) firstNameWord = lower
  }

  const hasNumber = count !== null
  // No known machine AND no number -> we cannot confidently call this equipment.
  if (keyword === null && !hasNumber) return null

  const type = keyword ?? firstNameWord ?? 'equipment'
  return {
    type,
    count,
    owned_or_hired: detectTenure(tokens.map((t) => t.toLowerCase())),
    daily_hire_cost: null,
    raw,
  }
}

// A chunk carrying MORE THAN ONE recognised equipment keyword is really
// several machines the engineer ran together with no separating comma —
// missing punctuation is normal on a phone (2026-09-12 real incident,
// "Poclain 1 Dumper 3" silently collapsing into one "excavator" item and
// discarding "Dumper 3" outright: docs/reviews/equipment-chunk-boundary-
// poclain-dumper-gap.md). Split at each keyword boundary so every keyword
// gets its OWN item, paired with the digit that follows it, instead of the
// first keyword's item silently absorbing every later keyword+digit into
// its own `raw`.
//
// A chunk with 0 or 1 keyword is exactly ONE segment — the whole chunk —
// which reproduces the pre-fix single-item behaviour byte-for-byte
// (including `raw` staying the untouched, trimmed original chunk text).
// This is a superset of the old logic, not a parallel path: every existing
// single-keyword/no-keyword test is exercising the same code as before,
// unchanged.
function parseChunk(chunk: string): EquipmentItem[] {
  const tokens = tokenize(chunk)

  const keywordIndices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i]) && canonicalEquipment(tokens[i])) keywordIndices.push(i)
  }

  if (keywordIndices.length < 2) {
    const item = parseTokens(tokens, chunk.trim())
    return item ? [item] : []
  }

  const items: EquipmentItem[] = []
  for (let i = 0; i < keywordIndices.length; i++) {
    // Segment i runs from its own keyword up to (not including) the next
    // keyword. Any tokens before the FIRST keyword (a leading bare number,
    // say) are folded into segment 0 — the same tokens that segment would
    // have owned when there was only one keyword in the whole chunk.
    const start = i === 0 ? 0 : keywordIndices[i]
    const end = i === keywordIndices.length - 1 ? tokens.length : keywordIndices[i + 1]
    const segment = tokens.slice(start, end)
    const item = parseTokens(segment, segment.join(' '))
    if (item) items.push(item)
  }
  return items
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
    items.push(...parseChunk(chunk))
  }

  return { items, none: false, raw_text }
}

// Whether this parse is an acceptable Q3 answer: an explicit "none", or at least
// one confident item. Garbled (neither) drives the reask-once path. Mirrored in
// SQL as p_equipment_ok.
export function isEquipmentAnswered(parse: EquipmentParse): boolean {
  return parse.none || parse.items.length > 0
}
