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
//
// SEVERE BUG, FIXED 2026-08-10 (found by a real sandbox smoke test, not a
// unit test — see the ANCHOR-WORD PAIRING note below for why 17 existing
// tests all missed it). A real engineer answered "15 productive, 3 idle
// waiting for material" against a headcount of 18. The pre-fix parser took
// the FIRST digit in the message as idle_count unconditionally — idle_count
// became 15, the RPC derived productive_count = 18-15 = 3, and the numbers
// were exactly inverted: 16.7% utilisation reported instead of 83.3%,
// confidence='high' because the parse "succeeded" (no reask was needed).
// Confidently, completely wrong, in the one section where labour cost shows
// to an owner who acts on it.
//
// ANCHOR-WORD PAIRING — the specific fix. 'idle' and 'productive' are both
// recognised anchors now: a digit immediately before or after either word is
// assigned to that count, regardless of which comes first in the message
// ("15 productive, 3 idle" and "3 idle, 15 productive" resolve identically).
// A single UNANCHORED number still defaults to idle_count — unchanged from
// before, and still correct, because the prompt itself
// (EVENING_QUESTIONS[5]) literally asks "how many were idle and why", so an
// answer with no anchor word at all ("2 idle waiting for cement", or even
// bare "2") is answering exactly what was asked. The bug was never that
// idle-first-by-default is a bad assumption — it's a fine default for the
// question's own literal shape. It broke when an engineer volunteered BOTH
// counts and led with productive, which the old parser had no vocabulary to
// recognise at all ('productive' was not even a stopword).
//
// THE GENERAL GUARD — numbers_discarded, more important than the anchor
// words above. Anchor-word pairing fixes THIS sentence; it does not fix the
// next unimagined one. 17 tests covered every phrasing their author had in
// mind, and the 18th real sentence broke all of them. numbers_discarded is
// the structural backstop: ANY digit token this parser sees but cannot place
// (a second number with no anchor, three numbers where only two can be
// used, two numbers with NEITHER anchored) sets this true, independent of
// anchor-word coverage. It would have caught the original bug with zero
// anchor-word logic — "3" was silently discarded by the pre-fix code, and
// a discarded token is itself the confidence signal, whether or not this
// file's author ever anticipated the specific sentence that produced it.
// The caller (evening.ts) downgrades confidence to 'low' whenever this is
// true — see its own REGISTRATION note next to where it does so. This is
// also the second confidence trigger design-decisions-beta-feedback.md
// flagged as missing (structural ambiguity on a clean first attempt, not
// just reask-budget exhaustion) — supplied here, not as a separate channel.

export interface ProductivityParse {
  // true = engineer confirmed all productive. false = some idle (idle_count
  // may still be null if no number was given, or if a genuine contradiction
  // invalidated it — see numbers_discarded / the caller's reconciliation).
  // null = couldn't classify at all — neither an affirmative nor a
  // negative/hedge token was found.
  all_productive: boolean | null
  // The idle-anchored number, or the single unanchored number when idle
  // was not itself anchored (see ANCHOR-WORD PAIRING above). null when
  // all_productive is true, unclassifiable, or genuinely ambiguous.
  idle_count: number | null
  // The productive-anchored number ("15 productive"). null whenever no
  // number was anchored to 'productive' — including the common case where
  // only idle_count was given, which is NOT an error, just an unanswered
  // question the RPC derives from headcount as it always has.
  productive_count: number | null
  // Remaining free text once every claimed number, anchor word, and
  // PRODUCTIVITY_STOPWORDS token is stripped. null when nothing is left.
  idle_reason: string | null
  // TRUE when this message contained a numeric token that could not be
  // placed into idle_count or productive_count — see THE GENERAL GUARD
  // above. The caller must treat this as a confidence-lowering signal on
  // its own, never silently ignore it because idle_count/productive_count
  // still came out non-null from OTHER tokens in the same message.
  numbers_discarded: boolean
  // Always preserved verbatim (trimmed) — the raw answer never gets lost.
  raw_text: string
}

function splitDigitBoundaries(s: string): string {
  return s.replace(/(\d)(\D)/g, '$1 $2').replace(/(\D)(\d)/g, '$1 $2')
}

export function parseProductivity(raw: string): ProductivityParse {
  const raw_text = raw.trim()
  if (raw_text === '') {
    return { all_productive: null, idle_count: null, productive_count: null, idle_reason: null, numbers_discarded: false, raw_text }
  }

  const classified = classifyYesNo(raw_text)

  // Token/digit computation moved BEFORE both early returns (DEFECT 1 FIX,
  // 2026-08-10, design review before 025 ever reached prod) — check for a
  // digit independently, since the MOST NATURAL answer to "how many idle"
  // is a bare number with no no/hedge WORD at all ("2 idle waiting for
  // cement" never says "no"). A digit is its own "some idle" signal, on
  // top of classifyYesNo's word-based one.
  const tokens = splitDigitBoundaries(raw_text.toLowerCase())
    .split(/[\s,]+/)
    .filter(Boolean)
  const hasDigit = tokens.some((t) => /^\d+$/.test(t))
  const hasIdleWord = tokens.includes('idle')

  // DEFECT 1 — classifyYesNo returns met:true on ANY YES_WORD ('ok',
  // 'done', 'yes'...) whenever no NO_WORD is present, and 'idle' is NOT a
  // NO_WORD. "ok, 2 idle waiting for cement" used to classify met:true and
  // hit this return, discarding a real idle count through the one path
  // THE GENERAL GUARD was never reached at all — an early return skips it
  // entirely. The old comment's claim here — "an all-productive answer
  // carries no count fields to get wrong" — was the defect itself: false
  // whenever a digit or 'idle' sits anywhere in the same message. Only
  // take this path when NEITHER is present.
  if (classified.ok && classified.met && !hasDigit && !hasIdleWord) {
    // Explicit "all productive" signal with nothing else in the message
    // that could contradict it — no idle/productive count or reason to
    // extract.
    return { all_productive: true, idle_count: null, productive_count: null, idle_reason: null, numbers_discarded: false, raw_text }
  }

  if (!classified.ok && !hasDigit) {
    // Truly unclassifiable: no no/hedge word, no number either.
    return { all_productive: null, idle_count: null, productive_count: null, idle_reason: null, numbers_discarded: false, raw_text }
  }

  // PASS 1 — anchor-adjacent numbers. Iterates over ANCHOR WORD occurrences,
  // not digit occurrences — deliberately, after a real bug found writing
  // this fix's own tests. A digit-first scan ("does this number sit next to
  // the literal word 'idle'?") breaks on "3 idle, 15 productive": "15"'s
  // PREVIOUS token is "idle" too, even though that "idle" was already
  // spoken for by "3" — the digit-first scan can't tell an anchor word is
  // already claimed, only that it's textually adjacent. Anchor-first fixes
  // this: each anchor word looks for ITS OWN nearest unclaimed number, and
  // is itself marked used once it finds one, so a later number can't be
  // mis-paired with an anchor word that already has a partner.
  // Prefers the number immediately BEFORE the anchor ("15 productive", "3
  // idle" — number-then-word, the pattern both the real incident and its
  // reordering use); falls back to AFTER when nothing usable precedes it
  // ("productive 15").
  let idle_count: number | null = null
  let productive_count: number | null = null
  const claimedDigits = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    const anchor = tokens[i]
    if (anchor !== 'idle' && anchor !== 'productive') continue
    if ((anchor === 'idle' && idle_count !== null) || (anchor === 'productive' && productive_count !== null)) continue

    const prevIdx = i - 1
    const nextIdx = i + 1
    let numberIdx: number | null = null
    if (prevIdx >= 0 && /^\d+$/.test(tokens[prevIdx]) && !claimedDigits.has(prevIdx)) {
      numberIdx = prevIdx
    } else if (nextIdx < tokens.length && /^\d+$/.test(tokens[nextIdx]) && !claimedDigits.has(nextIdx)) {
      numberIdx = nextIdx
    }
    if (numberIdx === null) continue // anchor word with no available number neighbor

    const value = parseInt(tokens[numberIdx], 10)
    claimedDigits.add(numberIdx)
    if (anchor === 'idle') idle_count = value
    else productive_count = value
  }
  const claimed = claimedDigits

  // PASS 2 — unclaimed numbers. Exactly one, with idle not already anchored
  // elsewhere: the long-standing default described in ANCHOR-WORD PAIRING
  // above ("2 idle waiting for cement" needs no anchor). Anything else
  // left unclaimed — two or more numbers with no anchor, or a number
  // arriving after idle was already anchored by a DIFFERENT digit — is not
  // guessed at. See THE GENERAL GUARD above for why this is the more
  // important half of this fix.
  const unclaimedDigitIndices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d+$/.test(tokens[i]) && !claimed.has(i)) unclaimedDigitIndices.push(i)
  }

  let numbers_discarded = false
  if (unclaimedDigitIndices.length === 1 && idle_count === null) {
    idle_count = parseInt(tokens[unclaimedDigitIndices[0]], 10)
    claimed.add(unclaimedDigitIndices[0])
  } else if (unclaimedDigitIndices.length > 0) {
    numbers_discarded = true
  }

  const reasonWords: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (claimed.has(i)) continue // consumed as a count, never a reason word
    if (/^\d+$/.test(t)) continue // a discarded numeric token — never a reason word either
    if (PRODUCTIVITY_STOPWORDS.has(t)) continue
    if (!/[a-z]/.test(t)) continue // stray punctuation ("-", ",") isn't a reason word
    reasonWords.push(t)
  }

  return {
    all_productive: false,
    idle_count,
    productive_count,
    idle_reason: reasonWords.length > 0 ? reasonWords.join(' ') : null,
    numbers_discarded,
    raw_text,
  }
}

// Whether this parse is an acceptable Q4-step-2 answer: classifyYesNo
// resolved confidently either way. Unclassifiable (all_productive === null)
// drives the reask-once path. A genuinely ambiguous two-number answer
// (numbers_discarded, both counts null) still counts as ANSWERED — the
// engineer clearly attempted a real answer, Rule 3.5 accepts it and flags
// it low-confidence rather than trapping them in an endless reask loop.
// Mirrored in SQL as p_parse_ok['5'].
export function isProductivityAnswered(parse: ProductivityParse): boolean {
  return parse.all_productive !== null
}
