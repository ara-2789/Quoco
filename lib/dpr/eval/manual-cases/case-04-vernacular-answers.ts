import type { ExecutionOutputFacts, ScheduleFacts, ManpowerFacts, EquipmentFacts, TomorrowsPlanFacts } from '../../schema'

// GOLDEN CASE #4 (bot-flows.md minimum cases: "vernacular answers") —
// MANUAL-REVIEW ONLY. Filed in eval/manual-cases/, not eval/cases/, so its
// location alone says "not asserted" — the mistake case #3 flagged (filing
// an arithmetic fixture beside model evals mislabels what a green run
// means) run the other direction here: this file has no assertCase
// function and never will. Do not add one.
//
// WHY THIS CAN'T BE AUTOMATED, and why it's kept anyway: vernacular handling
// is mostly a PARSER-layer concern with its own required T-PR tests
// (CLAUDE.md §7) — by the time data reaches the generator, a vernacular
// answer and a plain-English answer produce identical Facts (that's the
// point of parsing). But raw vernacular free text DOES still reach the
// model directly, unparsed, in two places: idle_reason strings and
// execution/schedule free text, which the model paraphrases into English
// narrative for the owner. Whether that paraphrase reads naturally to an
// Indian contractor — versus stilted, wrong, or accidentally comic — is a
// prose-quality judgment. §7 rules out asserting on prose content, and no
// structural field captures "did this read naturally to a human." That
// makes it exactly the kind of finding a golden case can't produce, and a
// human sign-off is a legitimate substitute — a REAL verdict, not a fake
// green check that proves nothing.
//
// PROCESS: run this fixture against the live model (manually, not in CI),
// read execution_narrative / manpower_idle_reason_note / equipment_items[].
// idle_reason_note, and append an entry to REVIEW_LOG below recording what
// you saw. An empty REVIEW_LOG means this has never been run — treat it the
// same as an untested code path, not as a pass.

export const executionFacts: ExecutionOutputFacts = {
  quantities: [{ activity: 'RCC column casting, Tower 2 grid B2', quantity: 3, unit: 'nos' }],
}

export const scheduleFacts: ScheduleFacts = {
  schedule_met: false,
}

export const manpowerFacts: ManpowerFacts = {
  headcount: { status: 'reported', value: 5 },
  productive_count: { status: 'reported', value: 3 },
  idle_count: { status: 'reported', value: 2 },
  utilisation_pct: { status: 'reported', value: 60 },
}

export const equipmentFacts: EquipmentFacts = {
  items: [
    {
      morning_item_index: 0,
      type: 'concrete_mixer',
      available_hours: { status: 'reported', value: 8 },
      actual_hours: { status: 'reported', value: 5 },
      daily_hire_cost: { status: 'reported', value: 1200 },
      idle_cost: { status: 'reported', value: 450 }, // 1200 * (1 - 5/8)
    },
  ],
}

export const tomorrowsPlanFacts: TomorrowsPlanFacts = {
  dependencies: [],
}

// Deliberately terse, code-mixed Tamil/English — the register bot-flows.md
// itself describes ("Terse Tamil/English tolerance", productivity.ts /
// equipment.ts headers) rather than an invented dialect. The idle_reason and
// schedule-miss text are the fields under review; the rest is plain so the
// review isn't distracted by unrelated ambiguity.
export const rawInputText = `
Project: Site A - Tower 2, 2026-08-09

Execution today: column casting, Tower 2 grid B2, 3 columns done.
Schedule: plan not met.
Reason plan not met (engineer's own words, verbatim): "cement late aayidichu,
morning la vandhudhu illa, adhaan konjam delay aachu"

Workers on site today: 5.
Productivity (engineer's own words, verbatim): "3 pேர் velai pண்ணிச்சுங்க,
2 pேர் idle — cement varaadhadhaala vேற வழி இல்ல"

Equipment: Concrete Mixer (item index 0).
- Available hours: 8, actual hours: 5.
- Idle reason (engineer's own words, verbatim): "cement late aana, mixer
  ஓடல, appuram konjam neram ஓடிச்சு"

Tomorrow's dependencies: none reported.
`.trim()

export interface ReviewEntry {
  date: string // YYYY-MM-DD, when the case was actually run against the live model
  reviewer: string
  model: string // e.g. 'claude-sonnet-5' — record which model was reviewed, tier changes independently
  verdict: 'reads naturally' | 'stilted but understandable' | 'wrong or misleading' | 'fabricated content'
  notes: string
}

// Empty until someone actually runs this and signs off. Do not populate with
// a guessed or assumed verdict — this is only meaningful as a record of a
// human having actually read the output.
export const REVIEW_LOG: ReviewEntry[] = []
