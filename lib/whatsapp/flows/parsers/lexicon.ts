// Shared Tamil/English lexicon for the morning-flow Pass-2 parsers (Q2 labour,
// Q3 equipment). Chennai-region beta: answers are terse, transliterated Tamil
// in Latin script mixed with English trade/equipment terms (and occasional
// Tamil script). Recognition here is ENRICHMENT, never a gate — an unrecognised
// token is still stored as raw; nothing here ever blocks an answer.
//
// Pure data + pure lookups. Zero Supabase, zero IO.

// ---------------------------------------------------------------------------
// Trades (Q2). Maps a lowercased token -> canonical English trade name. The
// canonical name is what lands in morning_manpower_planned.by_trade[].trade.
const TRADE_ALIASES: Readonly<Record<string, string>> = {
  // mason
  mason: 'mason',
  masons: 'mason',
  mesthiri: 'mason',
  mestri: 'mason',
  mesthri: 'mason',
  kannar: 'mason',
  // helper / unskilled
  helper: 'helper',
  helpers: 'helper',
  coolie: 'helper',
  cooli: 'helper',
  kooli: 'helper',
  thozhilaali: 'helper',
  thozhilali: 'helper',
  mazdoor: 'helper',
  // carpenter
  carpenter: 'carpenter',
  carpenters: 'carpenter',
  thachan: 'carpenter',
  thacchan: 'carpenter',
  // bar bender / steel fixer
  barbender: 'bar_bender',
  bender: 'bar_bender',
  steel: 'bar_bender',
  // electrician
  electrician: 'electrician',
  wireman: 'electrician',
  // plumber
  plumber: 'plumber',
  // painter
  painter: 'painter',
  painters: 'painter',
}

export function canonicalTrade(token: string): string | null {
  return TRADE_ALIASES[token.toLowerCase()] ?? null
}

// ---------------------------------------------------------------------------
// Equipment (Q3). Maps a lowercased token -> canonical equipment type.
const EQUIPMENT_ALIASES: Readonly<Record<string, string>> = {
  jcb: 'jcb',
  excavator: 'excavator',
  poclain: 'excavator',
  poklain: 'excavator',
  hitachi: 'excavator', // colloquial site name for a tracked excavator
  backhoe: 'backhoe_loader',
  mixer: 'concrete_mixer',
  mixie: 'concrete_mixer',
  mixture: 'concrete_mixer', // common transliteration slip for "mixer"
  crane: 'crane',
  roller: 'roller',
  loader: 'loader',
  generator: 'generator',
  genset: 'generator',
  pump: 'concrete_pump',
  vibrator: 'vibrator',
  tractor: 'tractor',
  dumper: 'dumper',
  tipper: 'tipper',
  lorry: 'lorry',
}

export function canonicalEquipment(token: string): string | null {
  return EQUIPMENT_ALIASES[token.toLowerCase()] ?? null
}

// ---------------------------------------------------------------------------
// "No equipment" sentinels (Q3 only). A terse negative that must normalise to a
// clean answered-empty state (none:true), NOT a reask. Covers English + common
// transliterated/Tamil-script negatives. Matched against the whole trimmed
// answer AND token-wise (so "onnum illa", "edhuvum illa" resolve).
const NONE_WORDS: ReadonlySet<string> = new Set([
  'no',
  'none',
  'nothing',
  'nil',
  'na',
  'zero',
  '0',
  '-',
  'illa',
  'ille',
  'illai',
  'illae',
  'kidaiyathu',
  'kedaiyathu',
])

export function isNoneSentinel(text: string): boolean {
  const cleaned = text.trim().toLowerCase()
  if (cleaned === '') return false
  if (NONE_WORDS.has(cleaned)) return true
  // Token-wise: any negative token present (e.g. "onnum illa", "no equipment
  // today") reads as none. A number-bearing answer never reaches here because
  // the caller only consults this on the whole answer before chunking.
  const tokens = cleaned.split(/[\s,]+/).filter(Boolean)
  // A digit anywhere means it is NOT a pure negative (e.g. "1 jcb").
  if (tokens.some((t) => /\d/.test(t))) return false
  return tokens.some((t) => NONE_WORDS.has(t))
}

// ---------------------------------------------------------------------------
// Ownership tenure (Q3). Detect owned vs hired from any token in the chunk.
const OWNED_WORDS: ReadonlySet<string> = new Set(['owned', 'own', 'sontham', 'mine'])
const HIRED_WORDS: ReadonlySet<string> = new Set([
  'hired',
  'hire',
  'rent',
  'rental',
  'rented',
  'vaadagai',
  'vadagai',
  'bhada',
])

export function detectTenure(tokens: readonly string[]): 'owned' | 'hired' | null {
  for (const t of tokens) {
    if (HIRED_WORDS.has(t)) return 'hired'
    if (OWNED_WORDS.has(t)) return 'owned'
  }
  return null
}

// Words that describe a rate/tenure rather than the machine itself — excluded
// from becoming an equipment "type" when no known keyword is present.
export const RATE_STOPWORDS: ReadonlySet<string> = new Set([
  'per',
  'day',
  'days',
  'daily',
  'rs',
  'rupee',
  'rupees',
  'inr',
  'a',
  'an',
  'the',
  'on',
  'at',
  'site',
  'only',
  'and',
  'plus',
  ...OWNED_WORDS,
  ...HIRED_WORDS,
])

// ---------------------------------------------------------------------------
// EVENING FLOW (Pass 1). Everything below serves the evening parsers; nothing
// above it changed. Same contract as the morning half: recognition is
// ENRICHMENT, never a gate — with ONE deliberate exception, the yes/no
// classification for Q2, which genuinely has to resolve to a BOOLEAN column.
// ---------------------------------------------------------------------------

// Measurement units (evening Q1). Maps a lowercased token -> canonical unit.
// Indian site vocabulary: quantities arrive as "slab 120 sqm", "12 cum concrete",
// "40 bags cement". An unrecognised unit is NOT an error — the quantity and the
// activity still store, and unit lands null.
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  // area
  sqm: 'sqm',
  sqmt: 'sqm',
  sqmtr: 'sqm',
  sqft: 'sqft',
  sft: 'sqft',
  // volume
  cum: 'cum',
  cbm: 'cum',
  cft: 'cft',
  brass: 'brass', // 100 cft — standard Indian aggregate/sand unit
  // length
  rmt: 'rmt',
  rft: 'rft',
  m: 'm',
  km: 'km',
  // count / mass
  nos: 'nos',
  no: 'nos',
  bags: 'bags',
  bag: 'bags',
  kg: 'kg',
  ton: 'ton',
  tonne: 'ton',
  mt: 'ton',
  ltr: 'ltr',
  litre: 'ltr',
  liters: 'ltr',
}

export function canonicalUnit(token: string): string | null {
  return UNIT_ALIASES[token.toLowerCase()] ?? null
}

// Words that describe the measurement rather than the activity — excluded from
// becoming an activity name. Mirrors RATE_STOPWORDS' role on the equipment side.
export const QUANTITY_STOPWORDS: ReadonlySet<string> = new Set([
  'of',
  'done',
  'completed',
  'complete',
  'finished',
  'today',
  'approx',
  'about',
  'around',
  'total',
  'work',
  'a',
  'an',
  'the',
  'and',
  'plus',
  ...Object.keys(UNIT_ALIASES),
])

// ---------------------------------------------------------------------------
// Yes / no classification (evening Q2 "was the plan met?").
//
// COVERAGE HONESTY (read before extending): the affirmative list below is
// English plus the three standard transliterations of ஆமா/ஆம். It is DELIBERATELY
// short. The morning lexicon's vernacular depth (mesthiri, thozhilaali, kannar…)
// came from the cofounder; inventing Tamil affirmatives without that review
// would put unverified terms on the one evening path that resolves to a stored
// BOOLEAN. Anything unmatched falls to the documented not-met path rather than
// guessing — see the Q2 note in migration 022. Extend WITH cofounder review.
// Exported (unlike TRADE_ALIASES etc.) so PRODUCTIVITY_STOPWORDS below can
// spread them rather than duplicating the list and risking drift.
export const YES_WORDS: ReadonlySet<string> = new Set([
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'done',
  'completed',
  'complete',
  'finished',
  'achieved',
  'met',
  'full',
  'fully',
  'aama',
  'ama',
  'aam',
])

// Explicit negatives AND partials. Partial answers are classified NOT MET on
// purpose: "half done" is not a met plan, and routing them to Q3 captures the
// shortfall in the engineer's own words instead of rounding it up to success.
export const NO_WORDS: ReadonlySet<string> = new Set([
  'no',
  'n',
  'nope',
  'not',
  'notdone',
  'incomplete',
  'pending',
  'partly',
  'partial',
  'partially',
  'mostly',
  'half',
  'some',
  'delayed',
  'missed',
  'short',
])

export interface YesNoClassification {
  /** true = plan met, false = not met. Meaningful only when `ok` is true. */
  met: boolean
  /** Did we classify confidently? false drives the Q2 reask. */
  ok: boolean
}

/**
 * Classify a Q2 answer. Token-wise so "yes fully done" and "no, half only"
 * both resolve. A NEGATIVE token anywhere wins over an affirmative one:
 * "yes but only half" is not a met plan, and the pessimistic reading is the one
 * that asks Q3 and captures the reason.
 */
export function classifyYesNo(text: string): YesNoClassification {
  const cleaned = text.trim().toLowerCase()
  if (cleaned === '') return { met: false, ok: false }

  const tokens = cleaned.split(/[\s,.!]+/).filter(Boolean)

  // Negatives are checked first and win outright — including the shared
  // NONE_WORDS negatives (illa / illai / kidaiyathu) already used by Q3.
  if (tokens.some((t) => NO_WORDS.has(t) || isNoneSentinel(t))) {
    return { met: false, ok: true }
  }
  if (tokens.some((t) => YES_WORDS.has(t))) {
    return { met: true, ok: true }
  }
  return { met: false, ok: false }
}

// ---------------------------------------------------------------------------
// EVENING FLOW Q4 step 2 (productivity/idle, Pass 2). Reuses classifyYesNo's
// own YES_WORDS/NO_WORDS for the all-productive/some-idle classification
// (NO_WORDS already includes "partly/partial/partially/mostly/half/some" —
// exactly the vocabulary a "some idle" answer uses) — nothing new needed
// there. This set is ONLY for building idle_reason: every classification word
// ("no", "mostly", "yes"...) stays in the answer's raw_text but is stripped
// from the reason text so "no 2 idle waiting for cement" reads as "waiting
// for cement", not "no idle waiting for cement", and a bare "mostly" (no
// separate reason given) reads as idle_reason: null, not idle_reason:
// "mostly". Spreads YES_WORDS/NO_WORDS rather than duplicating them so this
// can never drift from classifyYesNo's own vocabulary.
// 'productive' added 2026-08-10 (sandbox smoke test bug): promoted from an
// ordinary reason-word to a recognised ANCHOR alongside 'idle' in
// productivity.ts's number-pairing pass, so it must also be a stopword here
// — otherwise a resolved "15 productive" would leak the literal word
// "productive" into idle_reason instead of being consumed as the anchor
// that assigned the number.
export const PRODUCTIVITY_STOPWORDS: ReadonlySet<string> = new Set([
  'idle',
  'productive',
  'are',
  'is',
  'were',
  'a',
  'an',
  'the',
  ...YES_WORDS,
  ...NO_WORDS,
])
