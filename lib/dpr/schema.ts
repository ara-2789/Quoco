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
  // DECIDED 2026-08-10, while planning the fact assembler — OPTION C of
  // three considered for 024's confidence:'low' signal (evening_
  // productive_manpower / evening_equipment_utilisation, set when Rule
  // 3.5's reask budget was exhausted and the answer accepted anyway).
  //   A — map to status: 'not_captured'. Rejected: throws away a value
  //     that's probably fine (a low-confidence 45 is still likely ~45),
  //     and the loss is PERMANENT with no path back — daily_log_edits'
  //     019 correctable-column set excludes the JSONB columns this signal
  //     lives in, so a PM can never fix it. Worse: it makes an engineer
  //     who answered twice (past the reask budget) indistinguishable from
  //     one who never replied at all — the same fairness problem §12's
  //     SuppressionNote exists to prevent, recreated here.
  //   B — pass through as 'reported', drop the bit. Rejected: discards the
  //     doubt instead of the value — the second, more final loss of the
  //     one signal Rule 3.5 promises ("flag for low-confidence PM
  //     review") but that nothing downstream has ever implemented
  //     (CLAUDE.md §10's PARSER DEBT entry). Losing it here closes that
  //     off for good, at the last layer before the owner sees the number.
  //   C (chosen) — carry both: keep status/value as the parser reported
  //     them, add this field as a THIRD, additive signal. Not a new
  //     concept — the same pattern CapturedCount already uses twice
  //     (status itself splits zero from absent; SuppressionNote splits
  //     suppressed from absent) applied a third time: reported-but-doubted
  //     is a different fact from reported-cleanly or not_captured, so it
  //     gets its own signal instead of collapsing into one of the other
  //     two. PAYOFF: a section carrying a low-confidence fact can honestly
  //     declare data_status 'partial' rather than either extreme, and this
  //     is the FIRST actual implementation of Rule 3.5's flag-for-PM-
  //     review promise, not another entry tracking that it doesn't exist.
  //     Two real follow-up gaps this surfaces, recorded (not solved) in
  //     CLAUDE.md §10 rather than here: the flag currently points at data
  //     the 019 correctable-column set has no path to fix, and the same
  //     shape recurs sharper in section 1 (evening_output_quantities).
  low_confidence?: true
}

export type CapturedNumberStatus = 'reported' | 'not_captured'
export interface CapturedNumber {
  status: CapturedNumberStatus
  value: number | null // decimal (hours, Rs); null iff status !== 'reported'
  low_confidence?: true // see CapturedCount's low_confidence for the full
  // reasoning — same field, same decision, applies here for
  // evening_equipment_utilisation's hours (available_hours/actual_hours).
}

// A section/item is 'not_captured' for one of two DIFFERENT reasons, and
// they must not collapse into the same shape any more than zero-vs-absent
// does: nobody ever reported it, OR the §12 rollup rule deliberately
// withheld a value that MULTIPLE engineers reported (project-day rollup:
// daily_logs is per-engineer, dprs is per-project — see
// docs/design-decisions-beta-feedback.md §12). SuppressionNote is present
// only in the second case.
export type SuppressionReason =
  | 'multi_engineer_manpower'
  | 'same_activity_overlap'
  | 'same_type_equipment'
  | 'multi_engineer_schedule'
export interface SuppressionNote {
  reason: SuppressionReason
  engineer_count: number // how many engineers' reports collided — what makes
  // the note renderable ("reported by 2 engineers — not aggregated") rather
  // than a bare marker.
}

// ---------------------------------------------------------------------------
// Facts — code-owned. Never sent as an output_config field to the model.
// ---------------------------------------------------------------------------

export interface ExecutionQuantityFact {
  activity: string
  unit: string
  quantity: CapturedNumber
  // Present only when quantity.status === 'not_captured' because MORE THAN
  // ONE engineer reported this SAME activity name (§12) — not because
  // nobody reported it. One item per distinct activity: two engineers both
  // reporting "slab pour" is ONE item with a suppressed quantity, never two
  // rows for the same real-world activity. Distinct activities are never
  // touched and never carry this field.
  suppressed?: SuppressionNote
}

export interface ExecutionOutputFacts {
  quantities: ExecutionQuantityFact[]
  // from daily_logs.evening_output_quantities.items — code pass-through,
  // untouched by the model. Numbers here are reported, not derived.
}

export interface ScheduleFacts {
  schedule_met: boolean | null // daily_logs.evening_schedule_met. null means
  // one of TWO DIFFERENT things, same distinction CapturedCount already
  // makes for zero vs absent: nobody answered, OR — see `suppressed` below
  // — more than one engineer answered and the rollup rule withheld a
  // single value. These must not collapse into the same unlabelled null.
  // No planned QUANTITY exists anywhere in the schema (§11's correction) —
  // this section has never had real arithmetic to guard against.
  //
  // CORRECTED 2026-08-10 (my own error, §12's original text): this section
  // was first written up as "unaffected" by the §12 rollup rule, on the
  // reasoning that schedule/tomorrow's-plan/accountability are "per-
  // engineer by nature." That reasoning doesn't hold here — schedule_met
  // is exactly as per-engineer as headcount is (one boolean per engineer,
  // one field to hold it), and suppresses the same way manpower does.
  // §12 in design-decisions-beta-feedback.md carries the dated correction;
  // this is where the actual behavior lives.
  //
  // Present whenever MORE THAN ONE engineer submitted for this project-day
  // — UNCONDITIONALLY, matching manpower's own rule and for the same
  // reason: even two engineers who happen to both answer 'true' can't be
  // safely collapsed into one boolean without losing which engineer said
  // what. Passing through only when engineers happen to agree would make
  // behavior depend on the data's CONTENT rather than its shape — the same
  // kind of accidental, undocumented mapping this whole low_confidence/
  // SuppressionNote effort exists to rule out.
  //
  // WHY `multi_engineer_schedule`, NEVER a disagreement-flavored reason:
  // Q2 asks whether THAT ENGINEER's own plan (following their own Q1) was
  // met. Two engineers answering differently are stating two SEPARATE
  // facts about two separate areas of the same project, not contradicting
  // each other. A `disagreement`-named reason would encode a misreading of
  // the underlying question into the type permanently.
  //
  // RECORDED, NOT BUILT: once multi-engineer projects exist, this section
  // should report something like "1 of 2 engineers met today's plan" —
  // true, useful, discards nothing. Suppression is the INTERIM answer only
  // because §12 defers the real shape until the case actually occurs (the
  // prod query in §12 found zero multi-engineer projects today).
  suppressed?: SuppressionNote
}

export interface ManpowerFacts {
  headcount: CapturedCount // evening_workers_on_site
  productive_count: CapturedCount // evening_productive_manpower.productive_count
  idle_count: CapturedCount // evening_productive_manpower.idle_count
  utilisation_pct: CapturedNumber // CODE-COMPUTED: productive_count / headcount.
  // not_captured if either input is not_captured — never divide through a gap.
  // Present whenever MORE THAN ONE engineer submitted for this project-day
  // (§12) — UNCONDITIONALLY, not contingent on the numbers actually
  // disagreeing. The ambiguity is in what the question SCOPES to ("workers
  // on site" doesn't distinguish "my crew" from "the whole site"), which a
  // coincidental numeric match between two engineers doesn't resolve
  // either. When present, all four fields above are 'not_captured' together.
  suppressed?: SuppressionNote
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
  // Present when this item's `type` was ALSO reported by another engineer
  // (§12) — distinct from ordinary not_captured (nobody reported it).
  // Distinct types across engineers are never touched. When present, the
  // four Captured* fields above are all 'not_captured' together — see §12
  // for why "is engineer A's JCB the same physical machine as engineer B's"
  // has no data to resolve it against today, hence suppress rather than
  // guess.
  suppressed?: SuppressionNote
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

// The fact assembler's output — one project-day's worth of Facts, code-owned,
// pre-model. `accountability` is DELIBERATELY ABSENT here: it needs its own
// 7-day-window aggregator (holiday/messaging_blocked exclusion, per
// AccountabilityEntry's own note) that doesn't exist yet — same blocker
// already tracked against golden case #2. lib/dpr/assemble.ts's
// mergeDprFacts computes everything below; accountability is assembled
// separately, later, not folded in here to avoid scope creep into an
// unbuilt aggregator.
export interface DprFacts {
  execution: ExecutionOutputFacts
  schedule: ScheduleFacts
  manpower: ManpowerFacts
  equipment: EquipmentFacts
  tomorrows_plan: TomorrowsPlanFacts
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
// 'not_captured') is exactly the papering-over-a-NULL failure mode
// lib/dpr/eval/cases/case-manpower-equipment-not-captured.ts exists to
// catch. If this field is ever "simplified away" because it looks redundant
// with information code already has, that check goes with it. The
// redundancy IS the mechanism — do not remove it to deduplicate.
//
// THE OTHER HALF OF THIS MECHANISM — decided 2026-08-09, while designing
// that case: a section whose FINAL data_status is 'not_captured' (code's
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
//
// §12 SUPPRESSION COMPOSES WITH THIS RULE — confirmed, with one required
// extension. Manpower AND schedule compose DIRECTLY (schedule joined this
// bucket 2026-08-10 — see ScheduleFacts's own CORRECTED note; it was first
// miscategorized as unaffected): a SuppressionNote on ManpowerFacts or
// ScheduleFacts always accompanies that section's data_status ===
// 'not_captured' (both suppress section-wide and unconditionally), so the
// render rule above already makes the model's note for that section
// unreachable — code renders "reported by N engineers — not aggregated"
// from the SuppressionNote instead of the generic "Not captured today.",
// and the owner never sees anything that reads like a missing submission
// (the product concern §12 raised: "not captured" on a section TWO people
// answered would misread as "the engineer didn't report," which is unfair
// to the engineer and undercuts section 6, the one place the DPR
// legitimately names people for missing submissions).
//
// Execution and equipment do NOT compose for free — they needed the rule
// EXTENDED to ITEM granularity, stated explicitly here because it doesn't
// follow automatically from the section-level version above: an execution-
// quantity item or an equipment item can be individually 'not_captured'
// (suppressed) while its SECTION is 'partial' or even 'complete' overall —
// unlike manpower, suppression there is per-item, not section-wide. So the
// render rule applies PER ITEM for these two sections: an item carrying a
// SuppressionNote renders code-side text for that item specifically
// ("slab pour — reported by 2 engineers, quantity not aggregated"),
// regardless of what the model wrote and regardless of the section's
// overall data_status. Residual, not fully structural: execution_narrative
// is a single free-text field for the WHOLE section (digits allowed,
// containment-checked, not banned — see the Judgment digit-rules note
// below), so nothing stops the model's OWN prose from stating an invented
// combined figure for a suppressed activity unless the prompt is built so
// the disallowed combined number never appears anywhere in the input text
// — at which point the containment check catches it as invention, same as
// any other uncontained digit. This is a prompt-construction discipline the
// schema cannot enforce by itself; flagged so it isn't assumed solved.

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
