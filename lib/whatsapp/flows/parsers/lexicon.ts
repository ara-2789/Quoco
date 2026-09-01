// Shared Tamil/English lexicon for the morning-flow Pass-2 parsers (Q2 labour,
// Q3 equipment). Chennai-region beta: answers are terse, transliterated Tamil
// in Latin script mixed with English trade/equipment terms (and occasional
// Tamil script). Recognition here is ENRICHMENT, never a gate — an unrecognised
// token is still stored as raw; nothing here ever blocks an answer.
//
// Pure data + pure lookups. Zero Supabase, zero IO.

// ---------------------------------------------------------------------------
// Trades (Q2). Maps a lowercased token -> canonical English trade name. The
// canonical name is what lands in morning_manpower.by_trade[].trade (renamed
// from morning_manpower_planned by 030_morning_flow_attendance.sql — the
// parser's own field names are unchanged, only the RPC's write-time reshape).
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

// Display labels for the Q5 equipment prompt — what a site engineer actually
// reads on his phone. Humanize is the RULE, not the fallback: split on '_',
// capitalize each word. That renders every current canonical type correctly
// except acronyms, AND renders the unmatched raw tokens equipment.ts:66 can
// store ("hydra", "bobcat") correctly too, which a lookup table cannot.
// The override map is for acronyms and anything humanize gets wrong — one
// entry today. A new canonical type added to EQUIPMENT_ALIASES renders
// correctly with no change here; that is the point of this shape.
const EQUIPMENT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  jcb: 'JCB',
}

export function equipmentLabel(type: string): string {
  const key = type.trim().toLowerCase()
  const override = EQUIPMENT_LABEL_OVERRIDES[key]
  if (override) return override
  const words = key.split('_').filter(Boolean)
  if (words.length === 0) return 'Equipment'
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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
// Yes / no classification. Originally evening Q2 "was the plan met?" only;
// morning Q1 (attendance) and the holiday follow-up became consumers when
// migration 030 ported this exact word-for-word into quoco_classify_yes_no
// (SQL) so the RPC's signature could stay byte-identical (review package
// §10.1) rather than pass a precomputed flag in.
//
// RE-TUNED FOR ATTENDANCE SEMANTICS (2026-08-24, external review round 2,
// review package §11.5; Aravind's decision). classifyYesNo was originally
// tuned for schedule-met: a partial answer like "half" classifies NOT MET on
// purpose (see the NO_WORDS comment below, kept for the historical record).
// Imported unchanged into attendance, that tuning INVERTS: "half day today"
// describes a PRESENT engineer, and was routing to the site-holiday
// follow-up instead. DECIDED: re-tune the ONE shared list for attendance
// semantics rather than fork two lists — once evening's own restructuring
// (§30(a)) ships, evening Q2 is deleted and the only remaining consumers are
// morning Q1 and the holiday follow-up, both attendance questions; the
// schedule-met tuning will have no consumer left. Forking now would just
// mean merging the fork back later.
//
// ACCEPTED COST, named plainly: for the window between 030 shipping and the
// evening restructuring shipping (one migration wide), evening Q2 gets
// attendance-tuned classification on a question already decided for
// deletion — "yes but only half" (schedule-met: NOT met, a real hedge) now
// classifies MET, same as attendance's "half day" correctly does. Evening
// Q2's own test file (test/unit/yesno-classifier.test.ts) records this
// explicitly rather than silently changing expectations.
//
// PRESENT-SIDE FORMS ADDED: half, half-day, late, coming, come, reaching,
// reached, way — covering "half day"/"half-day", "late"/"coming late",
// "reaching at <time>"/"coming at 11", "on the way", "reached site", "will
// come". Token-wise matching (see classifyYesNo below) means one distinctive
// word per phrase is enough — "at"/"11"/"the"/"on" carry no signal of their
// own and are left unlisted. TRANSLITERATED TAMIL: checked against the
// lexicon as it exists today — NONE of these present-side forms have an
// existing Tamil transliteration here (the only Tamil entries anywhere in
// this yes/no set remain 'aama'/'ama'/'aam' and the shared NONE_WORDS
// negatives). Not invented for this pass — see COVERAGE HONESTY below,
// unchanged: a Tamil form for "coming"/"reached"/"on the way" etc. needs
// cofounder review before it's added, same as every other vernacular entry
// in this file.
//
// DO NOT REUSE classifyYesNo FOR A THIRD QUESTION WITHOUT READING THIS
// (added migration 035 round 3, 2026-09-01). This lexicon already carries
// TWO semantics (schedule-met, then attendance — the RE-TUNED note above).
// A third candidate came up during the evening restructuring: evening step
// 3's new "how many hours were idle, by trade?" question needs an
// "everyone was working" / "nobody idle" signal, and classifyYesNo looked
// like a natural fit. REJECTED: this lexicon's present-side attendance
// forms ("half day", "late", "coming late", "reached site") mean the
// OPPOSITE thing on an idle-hours question — "half day" on "was the
// engineer present?" reads MET/present (correct), but "half day" as an
// answer to "how many hours were idle?" plausibly means HALF THE DAY WAS
// IDLE, the exact inversion of what classifyYesNo would return. Idle-hours'
// "all working" detection is therefore a SMALL, PURPOSE-BUILT list
// (`isAllWorkingSentinel`, this file, EVENING FLOW step 3 section below),
// built for this one question, not borrowed from one built for two others
// already. See the RE-TUNED note above (docs/reviews/morning-flow-migration-
// review-package.md §11.5) for the FIRST time this lexicon's vocabulary was
// stretched across a second, different question — this is that same risk
// almost recurring a third time, caught before it shipped rather than
// after. CITATION CHECKED: an earlier draft of this comment cited
// design-decisions-beta-feedback.md §32, which turned out to be about the
// parse-attempt corpus, not this — corrected in place before commit, not
// left as a dangling reference for the next reader to trip on.
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
  // -- attendance present-side forms, added 2026-08-24 (see note above) --
  'half',
  'half-day',
  'late',
  'coming',
  'come',
  'reaching',
  'reached',
  'way',
])

// Explicit negatives AND partials. Partial answers are classified NOT MET on
// purpose: "half done" is not a met plan, and routing them to Q3 captures the
// shortfall in the engineer's own words instead of rounding it up to success
// -- historical rationale for THIS list's original design, kept for the
// record. 'half' ITSELF moved to YES_WORDS above 2026-08-24 (see the
// RE-TUNED note above) -- it no longer lives here, and the ACCEPTED COST
// note above names exactly what that trades away on evening Q2 during the
// one-migration window before evening Q2 is deleted.
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

// ---------------------------------------------------------------------------
// EVENING FLOW step 3 (idle hours by trade, migration 035 restructuring).
// PURPOSE-BUILT for this one question — see the "DO NOT REUSE classifyYesNo"
// note above classifyYesNo's own definition for why this is a dedicated list
// rather than a third semantic loaded onto that lexicon.
//
// This question is now UNCONDITIONAL (asked every evening turn), so "nobody
// was idle" must resolve to a CONFIDENT zero, not a non-answer. Two shapes
// of "zero idle" exist:
//   - A plain NEGATIVE ("no idle", "none", "nil") — already covered by the
//     shared isNoneSentinel above; generic negation isn't question-specific,
//     unlike the affirmatives below, so it is reused unchanged.
//   - An AFFIRMATIVE stating full productivity with no negation word present
//     ("all working", "fully productive") — isNoneSentinel's token-wise
//     negative-word check cannot catch these; they need matching on the
//     whole phrase, not a single token.
// Phrase-matched (substring, not token-wise) against the normalised whole
// answer, since these are inherently multi-word and may appear with
// trailing text ("all working today", "everyone productive, no issues").
const IDLE_ALL_WORKING_PHRASES: readonly string[] = [
  'all working',
  'everyone working',
  'all productive',
  'everyone productive',
  'fully productive',
  'full productivity',
  'nobody idle',
  'no one idle',
]

export function isAllWorkingSentinel(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (cleaned === '') return false
  return IDLE_ALL_WORKING_PHRASES.some((phrase) => cleaned.includes(phrase))
}
