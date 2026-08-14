// DPR OUTPUT SCHEMA — the boundary between what code computes and what the
// model is asked to write. This module defines the shape lib/dpr/generate.ts
// uses to build the prompt and the output_config it sends, and the shape
// lib/dpr/render.ts merges the response into. The original spike script
// (scripts/spike-dpr-claude.mjs) proved the request/response wire shapes
// against live docs and was deleted once generate.ts superseded it — its
// schema also sent `accountability` to the model as an output field, which
// this file's own SECTION 6 IS ENTIRELY CODE decision (below) explicitly
// forbids; do not resurrect that shape from the spike's git history without
// re-reading why it was rejected. Built per
// docs/design-decisions-beta-feedback.md §11 and bot-flows.md's DPR
// GENERATION section.
//
// TWO DISJOINT POOLS, per section:
//   - Facts — every number, full stop. Parsed from daily_logs or computed in
//     code (idle cost, utilisation %; see bot-flows.md's "Compute IN CODE"
//     list). Injected into the prompt as context. NEVER part of the model's
//     output_config schema — there is no field for the model to put a number
//     in, so it structurally cannot emit one for these values.
//   - Judgment — the model's entire output_config schema (DPR_JUDGMENT_SCHEMA
//     below). Narrative synthesis + a handful of typed categorical fields.
//     Merged with Facts into the dprs row's TWO storage columns (023's
//     schema, NOT one "structured_content" field — CORRECTED 2026-08-11,
//     this comment previously named a single field that was never real):
//     `structured` JSONB (all 6 sections) and `content` TEXT (rendered
//     human-readable form). lib/dpr/render.ts produces both, after the call.
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
  type: string // HUMANIZED display label (lib/whatsapp/flows/parsers/
  // lexicon.ts's equipmentLabel(), applied by assemble.ts) — "Concrete
  // Mixer", not the raw canonical storage key "concrete_mixer". A label a
  // human reads is code-owned at the Facts layer, same discipline as every
  // other value here; render.ts and the model never touch it.
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

// A THIRD status alongside submitted/missing — same family as CapturedCount's
// zero-vs-absent split, SuppressionNote's suppressed-vs-absent, and
// low_confidence's shaky-vs-solid: 'unconfirmed' means no record exists AND
// there is specific reason to think this may be a legitimate absence, not
// just silence. Currently the only trigger is corroboration: another
// engineer on the SAME project, SAME day, reported is_holiday=true. Kept
// distinct from 'missing' (no record, no particular counter-evidence)
// deliberately — collapsing the two would either over-excuse (treat every
// silence as possibly-holiday) or under-protect (ignore real peer evidence).
export type AccountabilityHalfStatus = 'submitted' | 'missing' | 'unconfirmed'

export interface AccountabilityPattern {
  missed_count: number
  window_days: number
}

export interface AccountabilityEntry {
  // SECTION 6 IS ENTIRELY CODE. No model call, no Judgment counterpart —
  // bot-flows.md already fully specifies this shape; don't redesign it here.
  // Attendance-pattern arithmetic over a 7-day window is arithmetic like any
  // other in this schema; it happens to never touch the model because the
  // model has nothing qualitative to add to "did they submit or not."
  engineer_name: string
  // Per-half, not shared — bot-flows.md's own example ties a pattern to
  // whichever half is being reported ("evening not submitted today (missed
  // 3 of last 5...)"), so one shared status/pattern for both halves would
  // be ambiguous whenever they differ.
  morning_status: AccountabilityHalfStatus
  evening_status: AccountabilityHalfStatus
  // PATTERN FIELDS EXIST BUT ARE NOT COMPUTED — see
  // ACCOUNTABILITY_PATTERN_SUPPRESSED below for the full reasoning. Always
  // null in this build. Kept in the type (not deleted) so turning the
  // pattern on later is a fill-in at the aggregator, not a redesign of this
  // shape or of every consumer that reads it.
  morning_pattern: AccountabilityPattern | null
  evening_pattern: AccountabilityPattern | null
  // Worded as a fact about OUR RECORDS, never a claim about the person —
  // "No evening check-in recorded today," not "Rajesh missed evening
  // check-in" or any wording implying he ignored it. Decided 2026-08-10
  // after establishing that outbound delivery failures are entirely
  // unobserved (no Twilio status-callback endpoint exists) — "we never
  // delivered the question" is indistinguishable, in our data, from
  // silence, and Rule 5.3 requires ruling out legitimate absence before a
  // name appears at all. Code-templated. Never model-generated.
  status_note: string
}

// SEVENTH-DAY PATTERN FORCED SUPPRESSED — decided 2026-08-10, not a
// temporary implementation gap. Two prerequisites, BOTH required before a
// pattern is trustworthy enough to ship:
//   1. DELIVERY-STATUS OBSERVABILITY — there is no Twilio status-callback
//      endpoint (app/api/whatsapp/ has exactly one route, inbound only).
//      An outbound 7pm prompt that silently failed to deliver leaves
//      EXACTLY the same evidence — no daily_logs row — as an engineer who
//      saw the message and ignored it. A 7-day count built on that
//      evidence isn't a measurement, it's a guess wearing a number.
//   2. BLOCK HISTORY — messaging_blocked has no per-day record (bot-flows.md's
//      own CROSS-DATE CONSTRAINT; design-decisions-beta-feedback.md §3.1).
//      MOOT AS OF 2026-08-10 IN PRACTICE (CLAUDE.md §10: no code path
//      anywhere ever sets messaging_blocked=true, so no historical block
//      data exists to contaminate a pattern today) — but a real
//      prerequisite once that set-half is built (tracked pre-launch,
//      CLAUDE.md §10, separate from this DPR item), since an undetected
//      STOP is the SAME missing-evidence problem as #1, one layer up.
// A blanket suppression, not a per-engineer SuppressionNote: every pattern
// is withheld, unconditionally, for the same two reasons, which is why this
// is a forced constant (matching TOMORROWS_PLAN_DATA_STATUS_FORCED's own
// shape below) rather than a per-instance marker. The PER-DAY status still
// ships — "no check-in recorded" needs neither prerequisite, it's a fact
// about records, not an aggregate claim. The pattern is what turns that
// fact into an accusation with a number attached, and a wrong number is
// harder to argue with than an honest absence of one — same shape as idle
// cost suppressed on an untrusted hire rate, or productive_count left
// not_captured rather than fabricated. Full reasoning + the two blockers as
// tracked items: docs/design-decisions-beta-feedback.md §13.
export const ACCOUNTABILITY_PATTERN_SUPPRESSED = true

// The fact assembler's output — one project-day's worth of Facts, code-owned,
// pre-model. `accountability` is DELIBERATELY ABSENT here, still — not
// because it's unbuilt (lib/dpr/accountability.ts now exists) but because
// its fetch shape is genuinely different from mergeDprFacts's: a
// project_members-driven roster + absence check, not a set of already-
// fetched daily_logs rows (see accountability.ts's own header). A future
// top-level orchestrator combines both; DprFacts itself stays scoped to
// what mergeDprFacts computes.
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
//   - Sections 2, 3, 4 & 5 notes: NO-DIGIT pattern. Sections 3 & 4 sit
//     directly next to code-computed arithmetic (utilisation %, idle cost) —
//     a digit here is almost certainly the model recomputing or restating a
//     number it was never given a field for. Sections 2 & 5
//     (schedule_miss_reason_note, tomorrows_plan_carry_forward_note) joined
//     this bucket 2026-08-11 — see the DATED AMENDMENT below; they were
//     originally digits-allowed+containment-checked.
//   - Section 1's narrative only: digits ALLOWED. Qualitative synthesis of
//     execution Facts that may legitimately carry identifiers ("M25",
//     "Tower 2", "level 3") — a blanket digit ban makes them unreproducible
//     without banning arithmetic, since identifiers aren't arithmetic.
//     Guarded by a CONTAINMENT check (lib/dpr/containment.ts): every
//     digit-bearing token in this field must appear in that SECTION's own
//     Facts (execution Facts + project/date framing) — SECTION-SCOPED, not
//     whole-prompt. A real equipment hire-rate number echoed into
//     execution_narrative is a fabrication wearing a real number; only
//     section-scoping catches it, since a whole-prompt or whole-Facts corpus
//     would pass it as "contained" purely because it's real somewhere else.
//     This field does NOT double as a whole-day summary — if it needs to
//     gesture at a cause from another section, it does so in words, zero
//     digits; the reader sees that section's own numbers rendered separately,
//     right beside that section's own note.
//
//   DATED AMENDMENT (2026-08-11, Aravind's decision): schedule_miss_reason_note
//   and tomorrows_plan_carry_forward_note were originally digits-allowed,
//   containment-checked against "the input text it was given" — i.e. the
//   engineer's own raw free text (evening_schedule_miss_reason), which is
//   NOT a DprFacts value. That was Reading B of the containment rule (contain
//   against the whole prompt) narrowed to two fields, not a different thing
//   from it: an engineer writing "only 40 of 100 done" in free text would
//   produce a DPR number that never passed through the quantity pipeline,
//   able to directly contradict the code-owned execution Facts in the same
//   report. RESOLVED: raw text is still fed to the model as PROMPT INPUT for
//   these two fields (the Facts/Judgment split governs what the model may
//   OUTPUT, never what it may READ) — but the fields themselves moved to
//   NO-DIGIT, the same rule already governing sections 3 & 4's notes. Not a
//   third category; consistency with the existing rule, not a compromise.
//   Specificity is lost ("delayed by 3 hours" becomes "delayed") — recorded,
//   with the accepted recovery path, in
//   docs/design-decisions-beta-feedback.md §18.
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
  execution_narrative: string // digits allowed, containment-checked (section-scoped
  // against execution Facts — see the Judgment digit-rules note above)
  execution_data_status: DataStatus

  schedule_miss_reason_note: string // no-digit (moved 2026-08-11 from digits-
  // allowed — see the DATED AMENDMENT above); meaningful only when
  // schedule_met === false. Raw miss-reason text still reaches the model as
  // prompt input, just never as permitted output.
  schedule_data_status: DataStatus

  manpower_idle_reason_note: string // no-digit
  manpower_data_status: DataStatus

  equipment_items: EquipmentItemJudgment[] // no-digit per item
  equipment_data_status: DataStatus

  tomorrows_plan_carry_forward_note: string // no-digit (moved 2026-08-11,
  // same amendment as schedule_miss_reason_note — shares the same raw
  // source text, evening Q2/Q3)
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
// output must appear in that FIELD'S OWN SECTION Facts — SECTION-SCOPED, not
// whole-prompt; see lib/dpr/containment.ts) rather than by a schema-level
// pattern. This check runs in code after the response — it isn't expressible
// as a JSON Schema constraint, and it is NOT a per-golden-case prose
// assertion: it's a structural invariant.
//
// Down to ONE field as of the 2026-08-11 amendment above — schedule_miss_
// reason_note and tomorrows_plan_carry_forward_note moved to NO_DIGIT_
// JUDGMENT_FIELDS below. This is the correct, narrowed result of that
// change, not a sign the mechanism collapsed.
export const CONTAINMENT_CHECKED_JUDGMENT_FIELDS = ['execution_narrative'] as const

// Fields where the no-digit rule applies. The RULE has not changed since the
// 2026-08-11 amendment above — these four fields still may not contain a
// digit. What changed (also 2026-08-11, same day, discovered running the
// first real golden-case batch) is WHERE it's enforced.
//
// DATED CORRECTION: this file previously enforced no-digit via a JSON Schema
// `pattern: '^[^0-9]*$'` on each of these four fields (three scalar fields
// plus one inside an array item, so effectively four separate compiled
// constraints). That schema is NOT what ships — every real call using it
// returned `400 Schema is too complex for compilation. Try reducing the
// number of tools or simplifying tool schemas.` Confirmed by direct test,
// not assumed: an identical request with every `pattern` key stripped and
// nothing else changed succeeded. An unbounded negated character class
// (`^[^0-9]*$`) has to compile into a constrained-decoding grammar, and four
// of them was enough to cross whatever complexity limit the API enforces —
// the 2026-08-11 decision (c) that moved two MORE fields onto this pattern
// (schedule_miss_reason_note, tomorrows_plan_carry_forward_note, on top of
// the pre-existing manpower_idle_reason_note and the array-item idle_reason_
// note) is what pushed the schema over that limit; it worked before that
// change added the third and fourth pattern site.
//
// RESOLVED: enforcement moved to code, in lib/dpr/validate.ts's
// validateJudgment() — run AFTER the response, in the same pass as the
// containment check, both checks reporting every violation together rather
// than stopping at the first. This is not merely a workaround for the 400:
// code-side checking is also STRICTLY BETTER for prose quality. Constrained
// decoding cannot backtrack — if the model is already mid-sentence when it
// would otherwise write a digit, the grammar forces it to contort the
// sentence to avoid one it's already committed to, rather than write the
// digit and let a downstream check catch it. A code-side check accepts that
// tradeoff explicitly: a violation now costs a wasted call (the response is
// generated, then rejected) rather than being structurally impossible to
// produce. That cost is accepted, not hidden.
//
// One deliberate exception to "no field is typed number", unaffected by any
// of this: equipment_items[].morning_item_index is an integer, but it's an
// identity echo of an index the model was itself given, not a computed
// value — the generator validates the returned indices are a subset of the
// ones it sent (generate.ts), a different check from validateJudgment(),
// closing the one place a number could otherwise leak through as model
// output.
export const NO_DIGIT_JUDGMENT_FIELDS = [
  'schedule_miss_reason_note',
  'manpower_idle_reason_note',
  'equipment_items[].idle_reason_note',
  'tomorrows_plan_carry_forward_note',
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

// ---------------------------------------------------------------------------
// PER-ENGINEER REPORT (docs/dpr-engineer-report-spec.md) — a second, parallel
// design for a different report, added alongside everything above, not a
// replacement for it. DprFacts/DprJudgment/DPR_JUDGMENT_SCHEMA above are
// UNCHANGED and stay live for the deferred project-level report and its own
// tests (lib/dpr/eval/cases/case-complete-two-engineer-day.ts,
// dpr-validate.test.ts, dpr-generate-schema.test.ts) — same "leave the old
// path alone, add a new one beside it" principle assemble.ts's retained
// multi-row mergeDprFacts/assembleDprFacts already applies.
// ---------------------------------------------------------------------------

// Two-way status, matching CapturedNumber not CapturedCount — no meaningful
// 'zero' state for free text (a blank plan and a missing plan are the same
// fact), same precedent CapturedNumber already set. Rule 2b: a 'reported'
// CapturedText renders EXACTLY as stored, in quotes, never paraphrased —
// by code as much as by the model. No formatter for this type may trim,
// re-case, or reorder.
export type CapturedTextStatus = 'reported' | 'not_captured'
export interface CapturedText {
  status: CapturedTextStatus
  value: string | null // null iff status !== 'reported'
}

// Spec Rule 7. 'not_applicable' covers BOTH directions: joined after that
// half's send time (spec's original case) and left the project before a
// LATER half's send time while real data exists earlier the same day
// (round-3 NIT, reviewer's own finding) — same status value, different
// reason string, no new vocabulary either way.
export type CheckInStatus = 'complete' | 'partial' | 'not_received' | 'not_applicable'

export interface CheckInHalfStatus {
  status: CheckInStatus
  // Present only when status === 'not_applicable' — plain-language reason,
  // spec's exact copy: "joined this project today" / "left this project
  // during the day".
  reason?: string
}

// §1 Work. planned = morning_plan verbatim (CapturedText); actual is a
// COMPOSITE of evening_output (verbatim CapturedText) + the matched
// evening_output_quantities entry (CapturedNumber + unit) — spec's sample:
// `done: "excavation done" — 850 sq m`. unit is '' when no quantity item
// matched (structured number entirely absent), not a separate not_captured
// marker — same "empty string composes to nothing" convention the old
// render.ts already uses for execution items.
export interface EngineerWorkFacts {
  planned: CapturedText
  done_text: CapturedText
  done_quantity: CapturedNumber
  unit: string
}

// §2 Schedule — no planned side at all (spec's binding table). Boolean,
// not a status wrapper: null means not_captured, same as the project-level
// ScheduleFacts.schedule_met already does.
export interface EngineerScheduleFacts {
  met: boolean | null
}

// §3 Manpower. planned = morning_manpower_planned.planned_total
// (CapturedCount — a real, small integer that CAN legitimately be a
// reported zero, matching CapturedCount's existing zero/not_captured
// split). actual is a composite: on_site (evening_workers_on_site) +
// working (evening_productive_manpower.productive_count) — spec's sample:
// `on site: 18, working: 15`.
export interface EngineerManpowerFacts {
  planned: CapturedCount
  on_site: CapturedCount
  working: CapturedCount
}

// §4 Equipment. planned needs NO NEW TYPE — per the spec's binding table
// and the round-1 resolution, it's a render-layer composition of `type`
// (already-humanized string) + `daily_hire_cost` (CapturedNumber), both
// already the right shape. actual = actual_hours alone (spec: "used: 6
// hours") — asymmetric with planned by design (no planned-hours field
// exists upstream; see the spec's own "Known data gap" section).
// available_hours/idle_cost are carried for NEEDS ATTENTION's idle-cost
// line (existing computeIdleCost, lib/dpr/idle-cost.ts, unchanged), never
// for the Equipment pair line itself.
export interface EngineerEquipmentItemFacts {
  type: string
  daily_hire_cost: CapturedNumber
  actual_hours: CapturedNumber
  available_hours: CapturedNumber
  idle_cost: CapturedNumber
}

export interface EngineerEquipmentFacts {
  items: EngineerEquipmentItemFacts[]
}

// One engineer, one project-day. Never an array of rows — the whole point
// of this report is "straight from that engineer's check-ins, no
// aggregation" (spec Scope). No SuppressionNote anywhere in this shape:
// suppression exists only for the multi-engineer collision problem the
// per-engineer report doesn't have.
export interface EngineerDprFacts {
  morning_status: CheckInHalfStatus
  evening_status: CheckInHalfStatus
  work: EngineerWorkFacts
  schedule: EngineerScheduleFacts
  manpower: EngineerManpowerFacts
  equipment: EngineerEquipmentFacts
}

// The model's ENTIRE output (spec Rule 2) — one field. Digits allowed
// (unlike the old DprJudgment's no-digit notes) because this sentence is a
// whole-day verdict citing real quantities ("850 of 1000 sq m done"), but
// containment-checked against the rendered BODY's own digits (see
// containment.ts's buildBodyCorpus, added alongside buildExecutionCorpus —
// S1/S9), not Facts, and not the old section-scoped execution-only corpus.
export interface EngineerDprJudgment {
  verdict: string
}

export const ENGINEER_DPR_JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      // ~60-70 words headroom, same maxLength convention the old schema's
      // note fields already use — generous for one sentence, not runaway.
      maxLength: 400,
      description:
        'One sentence summarising today for this engineer, from the Facts given. Digits are allowed only when they trace to a number that appears in this report\'s own rendered body — never a number invented or borrowed from elsewhere. Never attribute anything to a named person other than describing what was done.',
    },
  },
  required: ['verdict'],
  additionalProperties: false,
} as const

export const DPR_JUDGMENT_SCHEMA = {
  type: 'object',
  properties: {
    execution_narrative: {
      type: 'string',
      description:
        'Narrative synthesis of what was done today, for THIS section only. Digits allowed only for identifiers/quantities present in this section\'s own Facts (e.g. "M25", "Tower 2", "level 3") — every digit-bearing token must be traceable to execution Facts specifically, not any other section. Do not compute, invent, or borrow a number from elsewhere.',
    },
    execution_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    schedule_miss_reason_note: {
      type: 'string',
      // maxLength 400 (~60-70 words): a real reason here is a short phrase
      // or one or two sentences ("delayed, cement shortage") — generous
      // headroom over that without permitting runaway generation. No-digit
      // enforced in code (validateJudgment, lib/dpr/validate.ts), not here
      // — see the NO_DIGIT_JUDGMENT_FIELDS comment above for why.
      maxLength: 400,
      description:
        'Qualitative reason why plan and actual diverged, when they did. No digits — if a duration or count matters, describe it in words (e.g. "delayed" not "delayed by 3 hours"); nothing here is computed or injected separately, so there is no code-owned number for a digit to trace to.',
    },
    schedule_data_status: { type: 'string', enum: ['complete', 'partial', 'not_captured'] },

    manpower_idle_reason_note: {
      type: 'string',
      // maxLength 400 — same reasoning as schedule_miss_reason_note above.
      // No-digit enforced in code, not here.
      maxLength: 400,
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
            // maxLength 400 — same reasoning as the other no-digit fields.
            // No-digit enforced in code, not here.
            maxLength: 400,
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
      // maxLength 400 — same reasoning as the other no-digit fields.
      // No-digit enforced in code, not here.
      maxLength: 400,
      description:
        'Qualitative carry-forward of the plan-not-met reason (evening Q2/Q3), applied forward. No digits and no derived quantity — none exists in the source data, and nothing here is computed or injected separately.',
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
