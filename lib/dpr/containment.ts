import type { ExecutionOutputFacts } from './schema'

// THE CONTAINMENT CHECK — the one piece of code that actually enforces the
// Facts/Judgment boundary schema.ts declares. Pure, no IO, no API call.
// Before this file, CONTAINMENT_CHECKED_JUDGMENT_FIELDS named which fields
// needed checking and the no-digit pattern protected the rest structurally,
// but nothing ever ran the check itself — the boundary was documented, not
// enforced. This closes that gap for the one field that still needs it
// after the 2026-08-11 amendment (schema.ts): execution_narrative.
//
// READING A (Aravind's decision, 2026-08-11): containment against CODE-OWNED
// FACT VALUES only, never the whole prompt or an engineer's raw free text.
// The corpus and the section it's built for must MATCH — see
// buildExecutionCorpus below for why it's scoped to execution Facts alone,
// not a union of every section's Facts.

// Every digit-bearing token in a string, normalized to a comparable number so
// "4,730" (thousands separator) and "4730", or "37.50" and "37.5", compare
// equal regardless of which side happens to carry the formatting. Currency
// symbols and other non-digit prefixes are irrelevant here — the regex only
// captures the digit run itself, never what precedes it.
const DIGIT_TOKEN = /\d[\d,]*(\.\d+)?/g

export function extractDigitTokens(text: string): Set<number> {
  const matches = text.match(DIGIT_TOKEN) ?? []
  const tokens = new Set<number>()
  for (const match of matches) {
    const value = Number(match.replace(/,/g, ''))
    if (!Number.isNaN(value)) tokens.add(value)
  }
  return tokens
}

export interface ContainmentMeta {
  project_name: string
  // DELIBERATELY NO log_date FIELD (removed 2026-08-11, design review): a
  // date's digit components (month 1-12, day 1-31) sit in exactly the same
  // magnitude band as real construction quantities. Including them bought
  // nothing — execution_narrative has no reason to cite the date, since
  // render.ts prints it code-side in the DPR header — while costing two
  // free small integers the model could emit as a fabricated quantity
  // every single day. project_name stays: its digits are stable
  // identifiers ("Phase 2"), not magnitudes, so naming the project is
  // legitimate narrative content.
}

// Execution section's corpus, and ONLY execution's — section-scoped, not a
// union of every section's Facts. Rationale (schema.ts's digit-rules note):
// a real equipment hire-rate number echoed into execution_narrative is a
// fabrication wearing a real number; a whole-Facts corpus would pass it as
// "contained" purely because it's real somewhere else in the report. Built
// from:
//   - every digit substring inside an activity name. This is what makes
//     ordinals ("2nd floor") and material/grade identifiers ("M25",
//     "Tower 2") free, with no separate allowlist: quantities.ts's own
//     ordinal-suffix handling already keeps a token like "2nd" attached to
//     the activity string rather than stripped as a number, so it arrives
//     here as ordinary Fact text, not a special case.
//   - every REPORTED quantity value, INCLUDING a legitimate 0 — quantity is
//     CapturedNumber (schema.ts), whose status is only 'reported' or
//     'not_captured'; there is no separate 'zero' state to special-case,
//     and none is needed: assemble.ts's wrapNumber already stores a
//     genuine zero as {status: 'reported', value: 0}, and the check below
//     (`status === 'reported' && value !== null`) already includes it,
//     since 0 !== null. CapturedCount's three-way 'reported'/'zero'/
//     'not_captured' split (headcount, productive_count, idle_count) is a
//     DIFFERENT type, deliberately not reused here — CORRECTED 2026-08-11,
//     design review: this comment previously implied quantity carried that
//     same three-way split and that the code was missing a 'zero' branch.
//     It doesn't and isn't. CapturedCount's 'zero' exists because a
//     headcount/idle zero can arrive by a route that carries no number at
//     all — "all productive" is an affirmative zero, and collapsing it
//     into 'not_captured' was a real bug (024/025's own fix). A quantity
//     has no equivalent route: an engineer either states a number (which
//     may be 0) or states none, which is 'not_captured' — there is no
//     third case a route could produce. Widening CapturedNumber to add a
//     'zero' state would create a case no code path can ever populate,
//     that every consumer would still have to handle. The asymmetry
//     between the two types is deliberate, not an oversight.
//     See the NAMED LIMITATION block below for what this check does NOT
//     catch even within the reported set.
//   - project name framing, unambiguously code-provided. Deliberately NOT
//     log_date — see ContainmentMeta's own comment for why.
// A suppressed item's activity name is still legitimate corpus (only its
// quantity is withheld) — already covered by the activity-string pass below,
// no separate branch needed.
//
// NAMED LIMITATION, not fixed here (flagged in design review, 2026-08-11):
// extractDigitTokens normalizes to a Set<number> — containment is NUMERIC-
// SET MEMBERSHIP, not token-in-context matching. An activity named "M25
// slab" puts the bare number 25 into the corpus (from the identifier, via
// the activity-string pass) — after which the model may legitimately write
// "M25" back, but could ALSO write "25 bays" or "25 workers" and pass,
// because the check only asks "is 25 anywhere in this section's Facts,"
// never "does 25 in THIS sentence refer to the same thing it did in the
// Facts." This is the same class of fabrication section-scoping was built
// to stop (a real digit reused to dress up an invented figure) — surviving
// WITHIN one section rather than across sections. What this check DOES
// catch: a number with no source anywhere in execution Facts. What it does
// NOT catch: a real identifier digit reused as a fabricated magnitude in
// the same section. Fixing this properly needs token-plus-context matching
// (e.g. requiring the digit's surrounding words to overlap with the source
// phrase it came from), which is real design work, not a tweak — recovery
// path if beta shows this matters, not built now. Full writeup:
// docs/design-decisions-beta-feedback.md §19.
export function buildExecutionCorpus(execution: ExecutionOutputFacts, meta: ContainmentMeta): Set<number> {
  const corpus = new Set<number>()

  for (const token of extractDigitTokens(meta.project_name)) corpus.add(token)

  for (const item of execution.quantities) {
    for (const token of extractDigitTokens(item.activity)) corpus.add(token)
    if (item.quantity.status === 'reported' && item.quantity.value !== null) {
      corpus.add(item.quantity.value)
    }
  }

  return corpus
}

export interface ContainmentResult {
  ok: boolean
  violations: number[] // uncontained digit tokens, for the thrown error / log
}

export function checkContainment(outputText: string, corpus: Set<number>): ContainmentResult {
  const outputTokens = extractDigitTokens(outputText)
  const violations = Array.from(outputTokens).filter((token) => !corpus.has(token))
  return { ok: violations.length === 0, violations }
}
