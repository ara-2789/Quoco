import type { ExecutionOutputFacts, EngineerDprFacts } from './schema'

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
//
// DATED PARTIAL SUPERSESSION (2026-08-14, per-engineer report reformat,
// review round 3): Reading A has two prongs — (i) corpus built from
// code-owned Fact values, (ii) never the whole prompt or an engineer's raw
// free text. Prong (i) still holds unchanged. Prong (ii) is now PARTIALLY
// SUPERSEDED for the new per-engineer verdict-sentence corpus (built from
// the rendered body, not execution Facts alone — see
// docs/dpr-engineer-report-spec.md Rule 2b): the new body's pair lines
// quote engineer free text VERBATIM (`morning_plan`, `evening_output`), so
// digits inside that quoted text now enter the corpus the verdict is
// checked against — exactly what prong (ii) was written to forbid.
// DELIBERATE, not an oversight: the traceability guarantee this file
// existed to make ("a digit in the model's output must be findable
// somewhere real") gets STRONGER under the new design, not weaker — the
// quoted source sits directly adjacent, on the same rendered page, to the
// digit the verdict might cite, rather than being raw prompt input the
// reader never sees at all (the failure mode prong (ii) was guarding
// against under the old design, where raw free text was model-input-only).
// Reading A's prong (i) is the one that still does the real work; prong
// (ii) is retired for this corpus specifically, not for
// buildExecutionCorpus below, which is unchanged and still excludes raw
// free text per the original decision.

// THE CONTAINMENT LIMIT — named 2026-09-05, the "113 fabrication" incident
// (schema.ts's EngineerManpowerFacts comment has the full story). This
// function's corpus is built from `renderedBody` — whatever is ALREADY in
// the rendered output by the time the model sees it. That means containment
// catches an INVENTED digit (one the model made up, present in neither Facts
// nor the rendered body) but CANNOT catch a FABRICATED one (a wrong number
// that CODE itself put into the rendered body before the model ever ran) —
// the model citing it is, by this check's own definition, doing exactly what
// it's supposed to do. evening_manpower.total (a parser-summed number, not
// an engineer-stated one — see parseLabourCount, lib/whatsapp/flows/parsers/
// labour.ts) was one such fabricated number: wrong, but already in the body,
// so a model citing it as "113 workers on site" passed this check cleanly.
// This is not a defect in this function — extractDigitTokens is doing
// exactly what it was built to do (READING A, this file's own header:
// containment against code-owned Fact/body values, checking the MODEL, not
// the code that assembled those values). The fix for a fabricated-at-the-
// source number belongs upstream, at the point the value is assembled
// (assemble.ts) and rendered (render.ts/generate.ts) — not here. Recorded
// so the next false-confidence read of "containment passed" on a manpower-
// or count-shaped field checks the SOURCE of the number, not just whether a
// safety net exists.
//
// THE SAME INCIDENT'S SECOND HALF, RECORDED SEPARATELY BECAUSE IT'S A
// DIFFERENT MECHANISM, NOT A RESTATEMENT — the fix for the fabricated
// total (quoting the engineer's raw manpower text instead) made this
// check WEAKER, not stronger, for a few hours the same day. Before that
// fix, a real number like "25" buried in "CIVIL Team 25 nos" was NOT in
// renderedBody at all — a model citing "25 workers on the civil team" as
// a fact would have been an INVENTED digit, caught cleanly by
// extractDigitTokens(renderedBody). After the fix, that same raw text is
// quoted verbatim in renderedBody (Rule 2b: raw text renders exactly as
// stored) — so "25" became genuinely present in that corpus, and the
// identical sentence would have passed cleanly. Restating a real
// substring of raw context as though it were a confirmed fact is the
// SAME fabrication, in prose instead of a computed total — and a
// whole-body digit scan cannot tell the difference, by design: it
// validates that a digit appears SOMEWHERE in the report, never that the
// sentence citing it means what the sentence claims.
//
// RESOLVED, same day: `extractDigitTokens(renderedBody)` is no longer
// what the per-engineer path uses. `buildEngineerFactsCorpus` below
// builds the corpus from the STRUCTURED Facts object instead — an
// explicit allowlist of fields, the same shape buildExecutionCorpus
// already used — so a digit's provenance is known before it ever enters
// the corpus, not inferred after the fact from a flattened string (the
// inference `extractDigitTokens(renderedBody)` was making, and the exact
// thing that let this gap open). ENGINEER_SYSTEM_PROMPT's own exclusion
// sentence is the request; this function is the mechanism the model
// cannot talk its way around. Named as its own pattern in the admin-merge
// retrospective (isHireRateTrusted, buildBodyCorpus, this) — recorded
// there, not repeated here.

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

// PER-ENGINEER CORPUS — added 2026-09-05, closing THE CONTAINMENT LIMIT
// note above for the per-engineer path specifically (generate.ts used to
// build its corpus from `extractDigitTokens(renderedBody)` -- the whole
// rendered string, provenance-blind). This function is built the same way
// buildExecutionCorpus already is: from the STRUCTURED Facts object,
// field by field, an explicit allowlist -- not from a flattened string,
// because a flattened string cannot answer "which field did this digit
// come from," and that question is exactly what distinguishes a citable
// number from a context-only one here.
//
// PROVENANCE, NOT APPEARANCE, IS THE RULE -- confirmed by a real
// counterexample found while designing this, not assumed: `evening_
// schedule_miss_reason`'s raw string is fed into the per-engineer prompt
// TWICE -- once as `facts.hindrance.note` (previously treated as a
// citable Fact, formatEngineerFacts's own Hindrance line) and once as
// `narrative.hindrance_note` ("context only, never a source of a new
// digit", the SAME byte-identical text). Nothing about the VALUE
// distinguishes these two framings -- only which field of EngineerDprFacts/
// EngineerNarrativeContext it travels through. This function resolves
// that contradiction by NOT including hindrance.note here: a hindrance is
// a reason, not a quantity, and ENGINEER_SYSTEM_PROMPT's own exclusion
// sentence already lists "hindrance" as a context-only field -- this
// corpus now matches that, instead of silently permitting the digit
// anyway via the old whole-body scan.
//
// CITABLE, explicitly, and why:
//   - work.planned / work.done_text (verbatim quoted text) -- DELIBERATE
//     per containment.ts's own header, the 2026-08-14 decision: quoting
//     engineer free text verbatim in the rendered body is intended to
//     make any digit inside it citable, since the source sits directly
//     adjacent to whatever the verdict might cite. Structurally, this is
//     the ONE place "which field it came from" says "citable" for a raw
//     free-text field -- every other raw-text field (hindrance, manpower
//     planned/reported, manpower idle reason, equipment idle reason) is
//     the opposite.
//   - work.done_quantity, idle_hours_by_trade[].idle_hours, equipment
//     items[].actual_hours -- real, code-computed/reported quantities.
// NEVER a digit source: hindrance.note, manpower.planned, manpower.on_site
// -- all three are raw engineer text, all three are also fed to the model
// as explicit "context only" lines (formatEngineerFacts), and none of the
// three is a quantity the DPR is meant to state as fact.
export function buildEngineerFactsCorpus(facts: EngineerDprFacts, meta: { project_name: string }): Set<number> {
  const corpus = new Set<number>()

  for (const token of extractDigitTokens(meta.project_name)) corpus.add(token)

  if (facts.work.planned.status === 'reported' && facts.work.planned.value !== null) {
    for (const token of extractDigitTokens(facts.work.planned.value)) corpus.add(token)
  }
  if (facts.work.done_text.status === 'reported' && facts.work.done_text.value !== null) {
    for (const token of extractDigitTokens(facts.work.done_text.value)) corpus.add(token)
  }
  if (facts.work.done_quantity.status === 'reported' && facts.work.done_quantity.value !== null) {
    corpus.add(facts.work.done_quantity.value)
  }

  for (const trade of facts.idle_hours_by_trade) {
    corpus.add(trade.idle_hours)
  }

  for (const item of facts.equipment.items) {
    if (item.actual_hours.status === 'reported' && item.actual_hours.value !== null) {
      corpus.add(item.actual_hours.value)
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
