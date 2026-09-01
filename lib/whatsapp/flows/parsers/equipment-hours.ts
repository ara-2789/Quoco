import { canonicalEquipment, RATE_STOPWORDS } from './lexicon'

// Q5 (equipment hours) parser — Evening Flow Pass 2. PURE — no Supabase, no
// IO, and deliberately NO KNOWLEDGE of morning_equipment.
//
// WHY THIS PARSER NEVER SEES morning_equipment (read this before "improving"
// it to resolve the join here). Q5's answer has to be matched back to the
// SAME machines morning_equipment.items listed. Resolving that join requires
// morning_equipment, and the only safe read of it is the RPC's OWN locked
// read (022's Pass-2 reserved block) — exactly the same reasoning 022 already
// gives for why p_parse/p_parse_ok are keyed by step id rather than "the
// active step's parse": the webhook/TS wrapper cannot know session state
// without an UNLOCKED read that can race a concurrent turn. So this parser
// extracts only what's recoverable from the reply TEXT ALONE — label,
// canonical equipment type (via the SAME lexicon.ts alias table morning's own
// equipment.ts uses, so "mixer" resolves to the identical canonical string
// "concrete_mixer" morning_equipment.items already stores), and the hours
// themselves — and the RPC does the actual matching against morning_equipment
// under its own lock. See 024_evening_flow_q4_q5.sql's EQUIPMENT JOIN KEY /
// MATCH TIERS note for the full matching algorithm this data feeds.
//
// Question format (bot-flows.md): bot echoes the morning equipment list by
// name and pre-fills a format per machine; reply is ONE message, one chunk
// per machine. buildEquipmentHoursPrompt (evening.ts) NUMBERS the echo
// ("1) JCB", "2) Mixer") and asks the engineer to answer in that order — this
// parser recognises a leading "1)"/"1."/"1:" label as PURE TEXT STRUCTURE
// (never consumed as an hours value; see the LABEL BUG note below) so a
// compliant engineer's numbered reply joins unambiguously even when two
// machines share a type. An engineer who ignores the numbering and just lists
// machines by name or in list order is still handled — see the RPC's MATCH
// TIERS for how an unlabelled reply resolves.
//
// LABEL BUG, FIXED HERE (found during review of this parser's own output,
// not by a failing test): an earlier version of this file had no label
// concept at all, so a COMPLIANT engineer typing exactly what the prompt
// asks for — "1) 8 6" — had its leading "1" read as available_hours and "8"
// as actual_hours. Section 4's idle-cost formula (rate × (1 − actual /
// available)) would then compute rate × (1 − 8/1), a large NEGATIVE rupee
// figure, stated as fact in a document the owner cannot check. Fixed
// independently of the join-key work below — a label, once recognised, is
// stripped before hours extraction runs, never counted as one.
//
// ARITHMETIC GUARDS — cheap insurance on a number that becomes currency.
// actual_hours > available_hours is impossible (can't run more than were
// available); available_hours > 24 is impossible for one calendar day.
// Either signature means a misparse: the chunk is REJECTED (same path as
// "no number found" — contributes to the garbled/reask count, not stored as
// data) rather than persisted as a value section 4 would turn into nonsense.
// Note this guard alone would have caught the "1) 8 6" case above even
// without the label fix (available_hours=1, actual_hours=8 -> 8 > 1) — the
// two fixes are independent, both worth having.

export interface EquipmentHoursItem {
  // Leading numeric label ("1)", "1.", "1:"), if the engineer followed the
  // numbered format buildEquipmentHoursPrompt asks for. null otherwise. Pure
  // text structure — never validated against morning_equipment.items'
  // length here; the RPC does that (a label of "5" when only 2 machines were
  // echoed is meaningless there, not here).
  label: number | null
  // Canonical equipment type recognised in this chunk via the SAME
  // lexicon.ts alias table morning's equipment.ts parser uses — so "mixer"
  // resolves to "concrete_mixer", matching morning_equipment.items[].type
  // exactly. null when no recognisable keyword appears. Never validated
  // against morning_equipment here — the RPC does the actual matching.
  canonical_type: string | null
  available_hours: number | null
  actual_hours: number | null
  // Free text remaining after the label, recognised type keyword, and both
  // numbers are removed. null when nothing is left.
  idle_reason: string | null
  // The chunk exactly as the engineer wrote it (before lowercasing).
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

// Parse one comma/"and"-separated chunk into an item, or null when the chunk
// carries no usable number (garbled — no number at all, or an arithmetically
// impossible pair; see the ARITHMETIC GUARDS note above). Both are treated
// identically: contribute to the reask/garbled count, never stored.
function parseChunk(chunk: string): EquipmentHoursItem | null {
  const tokens = splitDigitBoundaries(chunk.toLowerCase())
    .split(/\s+/)
    .filter(Boolean)

  // LABEL — a leading "<number>" token immediately followed by a lone ")"
  // / "." / ":" token (the digit-boundary split above already separated
  // "1)" into "1" and ")"). Consumed here so it's never read as an hours
  // value.
  let label: number | null = null
  let start = 0
  if (tokens.length >= 2 && /^\d+$/.test(tokens[0]) && /^[).:]$/.test(tokens[1])) {
    label = parseInt(tokens[0], 10)
    start = 2
  }

  const numbers: number[] = []
  const words: string[] = []
  let canonical_type: string | null = null

  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^\d+$/.test(t)) {
      numbers.push(parseInt(t, 10))
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && canonical_type === null) {
      canonical_type = kw
      continue // recognised keyword contributes to canonical_type, not idle_reason
    }
    if (/[a-z]/.test(t)) words.push(t) // stray punctuation isn't a reason word
  }

  if (numbers.length === 0) return null

  const available_hours = numbers[0] ?? null
  const actual_hours = numbers[1] ?? null

  // ARITHMETIC GUARDS — see the file header. Reject rather than store.
  if (available_hours !== null && available_hours > 24) return null
  if (available_hours !== null && actual_hours !== null && actual_hours > available_hours) return null

  return {
    label,
    canonical_type,
    available_hours,
    actual_hours,
    idle_reason: words.length > 0 ? words.join(' ') : null,
    raw: chunk.trim(),
  }
}

export function parseEquipmentHours(raw: string): EquipmentHoursParse {
  const raw_text = raw.trim()

  // Empty is handled upstream as the ordinary empty-answer reask (Pass 1/2
  // semantics). Return a neutral non-answer.
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

// Whether this parse is an acceptable Q5 answer: at least one chunk yielded a
// valid (guard-passing) number. Garbled or arithmetically-impossible-only
// drives the reask-once path. Mirrored in SQL as p_parse_ok['6'].
export function isEquipmentHoursAnswered(parse: EquipmentHoursParse): boolean {
  return parse.items.length > 0
}

// =============================================================================
// REDESIGN -- evening step 4, ONE number per equipment TYPE (migration 035
// restructuring, review package §10 item 3). Everything ABOVE this line
// (parseEquipmentHours, isEquipmentHoursAnswered, EquipmentHoursItem,
// EquipmentHoursParse) is the OLD two-number, per-machine, MATCH-TIERS
// design and is LEFT UNTOUCHED, deliberately -- not because it's still
// correct, but because it is still LIVE: evening.ts's applyEveningFlowTurn
// (the real, production RPC-calling wrapper used by
// lib/whatsapp/outbound/trigger.ts) calls parseEquipmentHours unconditionally
// on every evening turn and sends its shape into the CURRENTLY-LIVE
// apply_evening_flow_turn (025's body). Redesigning that function IN PLACE
// here, before 035 applies AND evening.ts's own wrapper is rewritten to
// match, would ship exactly the hazard this migration's own review package
// §9 Finding A names: new-shaped TS data sent into an old-shaped RPC body,
// breaking every live evening check-in from the moment this merges -- not a
// hypothetical, a traced, confirmed dependency (evening.ts:748,
// `const equipmentHours = parseEquipmentHours(params.message)`, keyed into
// `p_parse['6']`, the OLD step numbering).
//
// So this round adds the redesigned parser under a NEW name
// (`parseEquipmentHoursByType`) instead, coexisting with the old one until
// evening.ts's own rewrite (the same "companion TypeScript" the review
// package's runbook S0 already names as a separate, larger, not-yet-started
// piece) replaces `applyEveningFlowTurn`'s step dispatch AND deletes
// everything above this line IN THE SAME LOCKSTEP DEPLOY AS THE SQL APPLY
// (§9 Finding A/B) -- at which point `parseEquipmentHoursByType` is renamed
// back to the clean `parseEquipmentHours` name, reclaiming it. This is the
// SAME transitional shape migration 030's own §10.2 finding already named
// and accepted once: "an overload hazard traded for a duplicate-logic
// hazard" -- two implementations coexisting for a bounded window is the
// deliberately-chosen alternative to shipping a live break.
//
// TARGET SHAPE (035_evening_flow_restructuring.sql's own P_PARSE SHAPES
// comment): {items: [{type, hours_used, matched, raw}], raw_text}. `type` is
// canonicalEquipment's output when matched, else the token exactly as heard
// (original case -- see the lowercasing-fix note below). This parser still
// has NO KNOWLEDGE of morning_equipment (unchanged architectural principle
// from this file's own original header above) -- the RPC does the type join
// under its own lock.
//
// NO ARITHMETIC GUARD, ON PURPOSE -- the single biggest behavioural
// difference from the OLD design above. The old parser's ARITHMETIC GUARDS
// (see its own header) rejected an out-of-range answer outright, silently,
// with no explanation -- the exact failure sequence in the 2026-08-31
// production incident this whole migration exists to fix. Implausibility is
// now a SQL-side FLAG computed against morning_equipment's count (review
// package §5), never a TS-side rejection. Whatever number is reported is
// stored, exactly as given.
//
// LOWERCASING FIX (migration 035 round 3, applied identically across
// labour.ts, idle-hours.ts, and this redesign): tokenise on the
// ORIGINAL-CASE text; push `.toLowerCase()` into the `canonicalEquipment`
// lookup call (it lowercases internally) rather than lowercasing the whole
// string up front. Matching stays case-insensitive; an unmatched token is
// captured exactly as the engineer typed it (§42), never silently recased.

export interface EquipmentHoursByTypeItem {
  // canonicalEquipment's output when matched, else the raw token exactly as
  // heard (original case).
  type: string
  hours_used: number
  // true when canonicalEquipment resolved the token; false when the token
  // is preserved unmatched (§42). Always present.
  matched: boolean
  raw: string
}

export interface EquipmentHoursByTypeParse {
  items: EquipmentHoursByTypeItem[]
  raw_text: string
}

const HOURS_FILLER_WORDS: ReadonlySet<string> = new Set(['hours', 'hour', 'hrs', 'used', 'run', 'ran', 'today'])

function parseByTypeChunk(chunk: string): EquipmentHoursByTypeItem | null {
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

  const type = matchedType ?? firstWord ?? 'equipment'
  return { type, hours_used, matched: matchedType !== null, raw: chunk.trim() }
}

export function parseEquipmentHoursByType(raw: string): EquipmentHoursByTypeParse {
  const raw_text = raw.trim()
  if (raw_text === '') return { items: [], raw_text }

  const chunks = raw_text
    .split(/[,\n;]|\band\b|\bplus\b/i)
    .map((c) => c.trim())
    .filter(Boolean)

  const items: EquipmentHoursByTypeItem[] = []
  for (const chunk of chunks) {
    const item = parseByTypeChunk(chunk)
    if (item) items.push(item)
  }

  return { items, raw_text }
}

// Whether this parse is an acceptable step-4 answer: at least one item
// parsed. Mirrored in SQL as p_parse_ok['4'].
export function isEquipmentHoursByTypeAnswered(parse: EquipmentHoursByTypeParse): boolean {
  return parse.items.length > 0
}
