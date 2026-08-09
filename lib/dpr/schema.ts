// DPR OUTPUT SCHEMA — the boundary between what code computes and what the
// model is asked to write. Not wired to a real API call yet: this module
// defines the shape the future generator (lib/dpr/generate) uses to build
// the prompt and the output_config it sends, and the shape it merges the
// response into. scripts/spike-dpr-claude.mjs proved the request/response
// wire shapes against live docs; this file is the real schema built on top
// of that, per docs/design-decisions-beta-feedback.md §11 and bot-flows.md's
// DPR GENERATION section.
//
// TWO DISJOINT POOLS, per section:
//   - Facts — every number, full stop. Parsed from daily_logs or computed in
//     code (idle cost, utilisation %; see bot-flows.md's "Compute IN CODE"
//     list). Injected into the prompt as context. NEVER part of the model's
//     output_config schema — there is no field for the model to put a number
//     in, so it structurally cannot emit one for these values.
//   - Judgment — the model's entire output_config schema (DPR_JUDGMENT_SCHEMA
//     below). Narrative synthesis + a handful of typed categorical fields.
//     Merged with Facts into the final structured_content AFTER the call.
//
// Only sections 3 and 4 have real code-computed arithmetic (utilisation %,
// idle cost) — section 2 has no planned quantity to vary against (see §11's
// correction), section 1's numbers are reported, not derived, and section 6
// is pure code (see below). The arithmetic-boundary risk is concentrated
// exactly where bot-flows.md already flags it.

// ---------------------------------------------------------------------------
// Shared Facts wrappers — zero, absent, and present must never collapse into
// the same shape (the property migration 024's NULL propagation exists to
// serve; see CLAUDE.md's PARSER DEBT / EQUIPMENT entries for what happens
// when a downstream consumer can't tell them apart).
// ---------------------------------------------------------------------------

export type CapturedCountStatus = 'reported' | 'zero' | 'not_captured'
export interface CapturedCount {
  status: CapturedCountStatus
  value: number | null // integer; null iff status !== 'reported'
}

export type CapturedNumberStatus = 'reported' | 'not_captured'
export interface CapturedNumber {
  status: CapturedNumberStatus
  value: number | null // decimal (hours, Rs); null iff status !== 'reported'
}

// ---------------------------------------------------------------------------
// Facts — code-owned. Never sent as an output_config field to the model.
// ---------------------------------------------------------------------------

export interface ExecutionOutputFacts {
  quantities: Array<{ activity: string; quantity: number; unit: string }>
  // from daily_logs.evening_output_quantities.items — code pass-through,
  // untouched by the model. Numbers here are reported, not derived.
}

export interface ScheduleFacts {
  schedule_met: boolean | null // daily_logs.evening_schedule_met; null = not captured.
  // No planned QUANTITY exists anywhere in the schema (§11's correction) —
  // this section has never had real arithmetic to guard against.
}

export interface ManpowerFacts {
  headcount: CapturedCount // evening_workers_on_site
  productive_count: CapturedCount // evening_productive_manpower.productive_count
  idle_count: CapturedCount // evening_productive_manpower.idle_count
  utilisation_pct: CapturedNumber // CODE-COMPUTED: productive_count / headcount.
  // not_captured if either input is not_captured — never divide through a gap.
}

export interface EquipmentItemFacts {
  morning_item_index: number // join key — POSITION, not type (schema.md's
  // EQUIPMENT JOIN KEY note: two same-type machines at different rates would
  // collide on a type-string join).
  type: string
  available_hours: CapturedNumber
  actual_hours: CapturedNumber
  daily_hire_cost: CapturedNumber
  idle_cost: CapturedNumber // CODE-COMPUTED: daily_hire_cost * (1 - actual/available).
  // KNOWN DEBT (CLAUDE.md §10, "A COUNT IN A MONEY FIELD"): daily_hire_cost
  // can be a miscaptured count, not a real rate — the 018-era parser always
  // reads the first number in a chunk as a rate. Whatever populates idle_cost
  // MUST force status: 'not_captured' when the rate's provenance is
  // untrusted, rather than compute confidently off a bad rate. The detection
  // heuristic is not decided here — this is a flag for the generator, not a
  // fix.
}

export interface EquipmentFacts {
  items: EquipmentItemFacts[]
  // An item with BOTH available_hours and actual_hours 'not_captured' IS the
  // "not reported" case (constraint 3 from the schema-design session) — no
  // separate flag needed, the wrapper already represents it.
}

export interface TomorrowsPlanFacts {
  dependencies: Array<{ item: string; responsible_party: string; required_by_time: string | null }>
  // from daily_logs.evening_dependencies — empty until Q6 ships.
}

export interface AccountabilityEntry {
  // SECTION 6 IS ENTIRELY CODE. No model call, no Judgment counterpart —
  // bot-flows.md already fully specifies this shape; don't redesign it here.
  // Attendance-pattern arithmetic over a 7-day window is arithmetic like any
  // other in this schema; it happens to never touch the model because the
  // model has nothing qualitative to add to "did they submit or not."
  engineer_name: string
  morning_status: 'submitted' | 'missing'
  evening_status: 'submitted' | 'missing'
  pattern: {
    missed_count: number
    window_days: number // 7-day pattern, holiday + messaging_blocked days
    // excluded from BOTH numerator and denominator (bot-flows.md's own
    // CROSS-DATE CONSTRAINT — messaging_blocked is a current-state flag, not
    // historical; do not read it across dates without a block-history
    // mechanism).
  }
  status_note: string // code-templated, e.g. "Rajesh — evening not submitted
  // today (missed 3 of last 5 site-operating days)." Never model-generated.
}

// ---------------------------------------------------------------------------
// Judgment — the model's entire output. Digit rules are per-field-purpose,
// not uniform:
//   - Sections 3 & 4 notes: NO-DIGIT pattern. These sections sit directly
//     next to code-computed arithmetic (utilisation %, idle cost) — a digit
//     here is almost certainly the model recomputing or restating a number
//     it was never given a field for.
//   - Section 1's narrative and sections 2 & 5's notes: digits ALLOWED. These
//     are qualitative paraphrases of free text that may legitimately carry
//     identifiers ("M25", "Tower 2", "level 3") — a blanket digit ban makes
//     them unreproducible without banning arithmetic, since identifiers
//     aren't arithmetic. Guarded instead by a CONTAINMENT check: every
//     digit-bearing token in the model's output must appear in the input
//     text it was given. Catches invention (a number with no source) without
//     banning legitimate transcription, and without asserting on prose shape
//     — it's a token-membership check against a known source, not a regex
//     search for wording.
// ---------------------------------------------------------------------------

export type DataStatus = 'complete' | 'partial' | 'not_captured'

// WHY THE MODEL DECLARES data_status AT ALL, when code already knows every
// Fact's status and could compute this itself: the model's declaration is a
// PROBE FOR DISAGREEMENT, not a source of truth. Code cross-checks the
// model's declared data_status against its own Facts after the call — a
// mismatch (model says 'complete' where code knows a Fact is
// 'not_captured') is exactly the papering-over-a-NULL failure mode golden
// case #1 (see memory / next-session notes) exists to catch. If this field
// is ever "simplified away" because it looks redundant with information code
// already has, that check goes with it. The redundancy IS the mechanism —
// do not remove it to deduplicate.
//
// THE OTHER HALF OF THIS MECHANISM — decided 2026-08-09, while designing
// golden case #1: a section whose FINAL data_status is 'not_captured' (code's
// own Facts, not the model's declaration — the cross-check above is what
// reconciles the two) renders CODE-SIDE templated text in that section, e.g.
// "Not captured today.", NEVER the model's own note field for that section.
// This is the only structural answer available to "confident prose written
// over a real hole": for a fully-not_captured section, the model's note is
// simply unreachable at render time, so whatever it contains — accurate,
// bland, or a fabricated "all productive" — cannot reach the owner. See case
// #1's own file for why this guarantee does NOT extend to 'partial' sections.
// CONSEQUENCE, noted not optimised: for a 'not_captured' section the model's
// note is generated and then discarded — wasted output tokens. Worth fixing
// once the generator exists (e.g. skip requesting that field when code
// already knows pre-call the section will be 'not_captured' for reasons
// other than the model's own declaration — headcount fully missing, say).
// Not addressed here; recorded so it isn't rediscovered as a surprise cost.

export interface EquipmentItemJudgment {
  morning_item_index: number // must match the EquipmentItemFacts item it comments on
  idle_reason_note: string // no-digit
}

export interface DprJudgment {
  execution_narrative: string // digits allowed, containment-checked
  execution_data_status: DataStatus

  schedule_miss_reason_note: string // digits allowed, containment-checked;
  // meaningful only when schedule_met === false
  schedule_data_status: DataStatus

  manpower_idle_reason_note: string // no-digit
  manpower_data_status: DataStatus

  equipment_items: EquipmentItemJudgment[] // no-digit per item
  equipment_data_status: DataStatus

  tomorrows_plan_carry_forward_note: string // digits allowed, containment-checked
  // tomorrows_plan_data_status is DELIBERATELY ABSENT — see
  // TOMORROWS_PLAN_DATA_STATUS_FORCED below. This is not asymmetric by
  // design; it's transitional scaffolding around Q6 not existing yet.
}

// TRANSITIONAL — remove this constant, and the special-case merge logic that
// reads it, the moment Q6 ships. Until then, section 5's data_status is
// FORCED in code rather than asked of the model: the section is
// definitionally incomplete pre-Q6, so there is nothing for a model
// declaration to probe against yet. Once Q6 ships:
//   1. add tomorrows_plan_data_status: DataStatus to DprJudgment above,
//   2. add it to DPR_JUDGMENT_SCHEMA's properties + required, exactly like
//      the other four sections' *_data_status fields,
//   3. delete this constant and whatever merge-time code reads it.
// If this file is read after Q6 ships and this constant is still here, that
// is a bug, not a stable design choice.
export const TOMORROWS_PLAN_DATA_STATUS_FORCED: DataStatus = 'not_captured'

// Fields validated by CONTAINMENT (every digit-bearing token in the model's
// output must appear in the source text it was given) rather than by a
// schema-level pattern. This check runs in code after the response — it
// isn't expressible as a JSON Schema constraint, and it is NOT a per-golden-
// case prose assertion: it's one uniform structural invariant applied
// identically to every field in this list, the same way the no-digit
// pattern is a uniform invariant applied to the fields below it.
export const CONTAINMENT_CHECKED_JUDGMENT_FIELDS = [
  'execution_narrative',
  'schedule_miss_reason_note',
  'tomorrows_plan_carry_forward_note',
] as const

// Fields where the schema applies the no-digit pattern structurally.
// NOT VERIFIED: whether Anthropic's json_schema structured-output mode
// enforces the `pattern` keyword during constrained decoding (confirmed
// during the spike: `type` / `properties` / `required` / `additionalProperties`
// are enforced; `pattern` specifically was not checked against live docs —
// verify before relying on it). If unenforced, the type-level guarantee
// still holds regardless: no field below is typed `number`, so the model
// cannot return one in a JSON-valid response either way. `pattern` is
// defense-in-depth against a digit smuggled into a string, not the primary
// guarantee.
//
// One deliberate exception to "no field is typed number":
// equipment_items[].morning_item_index is an integer, but it's an identity
// echo of an index the model was itself given, not a computed value — the
// generator must validate the returned indices are a subset of the ones it
// sent, closing the one place a number could otherwise leak through as
// model output.
const NO_DIGIT_PATTERN = '^[^0-9]*$'

export const NO_DIGIT_JUDGMENT_FIELDS = [
  'manpower_idle_reason_note',
  'equipment_items[].idle_reason_note',
] as const

// ---------------------------------------------------------------------------
// The output_config.format.schema sent to the model. Wire shape confirmed
// against live docs during the Claude API spike (2026-08-09) — see
// scripts/spike-dpr-claude.mjs. `equipment_items[].morning_item_index` is
// left as an open integer here; the generator should further restrict it to
// an enum of the indices actually sent for that project/day when it
// assembles the per-call schema, since the valid set differs every call and
// can't be hardcoded into this static export.
// ---------------------------------------------------------------------------

export const DPR_JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    execution_narrative: {
      type: 'string',
      description:
        'Narrative synthesis of what was done today. Digits allowed only for identifiers/quantities present in the source text (e.g. "M25", "Tower 2", "level 3") — every digit-bearing token must be traceable to the input. Do not compute or invent a number.',
    },
    execution_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    schedule_miss_reason_note: {
      type: 'string',
      description:
        'Qualitative paraphrase of why plan and actual diverged, when they did. Digits allowed only if present in the source text.',
    },
    schedule_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    manpower_idle_reason_note: {
      type: 'string',
      pattern: NO_DIGIT_PATTERN,
      description:
        'Qualitative reason for manpower idle time, if any. No digits — utilisation % and headcounts are computed in code and injected separately; this field is reasoning, not a number.',
    },
    manpower_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    equipment_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          morning_item_index: {
            type: 'integer',
            description:
              'Must match one of the item indices given in the input — identity passthrough, not a computed value.',
          },
          idle_reason_note: {
            type: 'string',
            pattern: NO_DIGIT_PATTERN,
            description:
              'Qualitative reason this machine was idle, if any. No digits — hours and idle cost are computed in code and injected separately.',
          },
        },
        required: ['morning_item_index', 'idle_reason_note'],
        additionalProperties: false,
      },
    },
    equipment_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    tomorrows_plan_carry_forward_note: {
      type: 'string',
      description:
        'Qualitative carry-forward of the plan-not-met reason (evening Q2/Q3), applied forward. No derived quantity — none exists in the source data. Digits allowed only if present in the source text.',
    },
  },
  required: [
    'execution_narrative',
    'execution_data_status',
    'schedule_miss_reason_note',
    'schedule_data_status',
    'manpower_idle_reason_note',
    'manpower_data_status',
    'equipment_items',
    'equipment_data_status',
    'tomorrows_plan_carry_forward_note',
    // tomorrows_plan_data_status intentionally absent — see
    // TOMORROWS_PLAN_DATA_STATUS_FORCED above.
  ],
  additionalProperties: false,
} as const
