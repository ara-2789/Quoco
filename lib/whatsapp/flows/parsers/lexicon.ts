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
