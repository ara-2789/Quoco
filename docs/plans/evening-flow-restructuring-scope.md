# Evening flow restructuring + §33 equipment count fix — scoping plan

**Status: PLAN ONLY through §18. Written 2026-08-31, revised same day
across several rounds (see §12/§13 for two self-caught corrections, §15-18
for reviewer-independent decisions folded in mid-day). REVIEWER RETURNED
SCOPE APPROVED WITH FINDINGS, same day — all 8 findings folded in at their
relevant sections (§0(a), §6, §8, §11, §13, §15, §17), not collected in one
place, so read this as a live document, not a single-pass draft. SQL
authoring begins after this fold-in, in a separate work product from this
plan.**

Scope: §28(l)'s evening redesign (5 questions, all unconditional except the
existing equipment auto-skip) and §33's equipment-captures-units decision,
shipped as **one migration** — per Aravind's explicit instruction overriding
§33(f)'s "not decided" sequencing question. **Working migration number:
CORRECTED to 035** (re-verified at SQL-authoring time, per CLAUDE.md §6 —
the "034" figure this plan originally used went stale the same day it was
written: migration 034, an unrelated owner-email-delivery change, was
proposed, reviewed, rehearsed, and APPLIED TO PROD later the same
2026-08-31 session, per `docs/reviews/034-apply-record.md`. Confirmed by
reading `origin/main` directly, not inferred from this plan's own earlier
text — exactly the "session notes describe the past, the repo describes
the present" trap CLAUDE.md names, caught here before it caused a
collision.).

Repo state at SQL-authoring time (re-checked, not carried over from this
plan's original writing): `origin/main` includes migrations through 033 in
`supabase/migrations/` (no 008–010, no 026 — pre-existing gaps) plus
migration 034 (owner email delivery), which is applied to prod and
ledgered but whose `.sql` file lives in `docs/reviews/034_owner_email_
delivery.sql`, never moved into `supabase/migrations/` — a possible
process gap, out of scope for this plan to fix, noted only so the next
reader isn't confused by its absence from the numbered directory.

---

## 0. Two items reported, not decided (asked first, per instruction)

### a. THE SILENT REASK — what the parser knows, what it would cost to surface

At the moment `equipment-hours.ts`'s `parseChunk` rejects a chunk (the
arithmetic guard, lines 128–131), it knows **exactly** which of two things
happened:
- `available_hours > 24` (impossible for one calendar day), or
- `actual_hours > available_hours` (ran more than was on site) — the guard
  that fired on both of tonight's replies (`"2 JCB 8"` → 8>2; `"2 8"` → 8>2
  again).

It also still has the raw numbers, the recognized `canonical_type` (if any),
and the label (if any) at that exact point. **None of this is retained.**
`parseChunk` returns bare `null` on rejection — the specific reason is
discarded inside the function, before it ever reaches `evening.ts`, the RPC,
or the reply text. `buildEveningReply`'s reask branch (lines 204–206) then
calls `buildEquipmentHoursPrompt` with no arguments describing what went
wrong — it is a pure function of the machine list only, incapable of
carrying a reason even if one existed upstream.

**What surfacing it would cost, concretely:**
- `EquipmentHoursItem | null`'s return shape needs to become a discriminated
  result (e.g. `{ok: true, item} | {ok: false, reason, raw}`) so a reason
  survives past `parseChunk`. This is a **pure, local, TS-only change** —
  `equipment-hours.ts` has zero Supabase/IO today and would keep that
  property.
- The reason can be derived **entirely client-side, independently of the
  RPC**: `applyEveningFlowTurn` already computes `parseEquipmentHours(message)`
  before calling the RPC (to build `p_parse`/`p_parse_ok`), so the reask
  copy can be built from that same parse result in the webhook/route layer
  without the RPC ever needing to know a reason exists. **This means the fix
  does not have to touch `apply_evening_flow_turn`'s SQL at all** — no
  migration, no CLAUDE.md §0 external-review trip, no signature risk. It is
  fully decoupled from this migration and could ship earlier and separately.
- Real cost is in `evening.ts` (thread the reason into `buildEveningReply`/
  `buildEquipmentHoursPrompt`, an optional parameter), new copy for each
  reason case (needs the same cofounder/tone review this project already
  requires for vernacular and copy — design-principles.md's rules), and new
  unit tests per reason branch.
- Note this is the one parser in the flow with an outright-**rejecting**
  guard on an otherwise well-formed-looking answer (two numbers present).
  Every other reask trigger in this flow (empty, no digit at all,
  unclassifiable yes/no) is "there was nothing here" — self-evident on a
  repeat. This one is sharper: the engineer believes they answered correctly
  and got silence back indistinguishable from "you said nothing."

**UPDATE, 2026-08-31, Decision 1 (§6, §13):** this specific guard is now
moot, not merely improvable. Evening Q4 asks for one number per type, not
two — there is nothing left to compare, so the exact failure mode analyzed
above (two numbers, arithmetically impossible together, rejected with no
explanation) cannot recur. The general cost/benefit analysis above still
applies to whatever failure modes remain for a single-number answer (no
number found at all; possibly a new upper-bound guard, §6's Consequence
1(a) flags this as undecided) — the PRINCIPLE (a rejection should be able
to say why) is not resolved by this decision, only the specific incident
that prompted recording it.

### b. BUDGET EXHAUSTION FORCE-ADVANCES — the alternative, and what actually breaks

**What already works correctly, checked directly:** the empty Case-B
placeholder (`available_hours: null, actual_hours: null`) does NOT lie
downstream. `lib/dpr/assemble.ts`'s `wrapNumber(value, confidence)`
(line 86) returns `notCapturedNumber` whenever `value === null`,
**regardless of confidence** — so a genuinely-empty forced-advance item
degrades to `{status: 'not_captured'}` at the DPR Facts layer, same as if
nothing had ever been asked. The DPR does not fabricate a false "0 hours"
or a false "high confidence" reading from tonight's row. That part of the
safety net holds.

**What actually breaks is on the engineer/session side, not the DPR:**
1. `evening_submitted_at` is stamped and `current_step` resets to 0 — the
   flow is marked **permanently complete**. Per §28(t)'s already-decided
   irreversibility posture (check-in windows are a data-integrity boundary,
   not a convenience limit), there is no engineer-side route back.
2. Unlike `evening_workers_on_site` (a 019-correctable scalar), 
   `evening_equipment_utilisation` is JSONB — **not** in 019's CHECK/CASE
   whitelist (verified, §4 below). So this is a dead end **twice over**:
   the engineer cannot redo it, and the PM cannot correct it either, short
   of a direct DB edit. Every other force-advance in this flow (headcount,
   productivity) hits at least one correctable scalar; equipment hours hits
   neither.
3. The engineer receives `EVENING_COMPLETE_REPLY` ("✅ Evening check-in
   complete. Thanks — rest well!") — an unqualified success message, on a
   turn where the system just silently discarded their second attempt.
   Nothing distinguishes "answered, low confidence" from "gave up, recorded
   nothing" at the point the engineer actually sees a reply.
4. `confidence: 'low'` is the **only** signal carried forward, and it means
   two different things today: "we extracted a guess, don't fully trust
   it" and (this case) "we extracted nothing at all." A downstream
   reader — including the §32 parse-attempt-corpus work already recorded as
   a prerequisite for anything self-improving — cannot currently tell these
   apart without also checking whether every item's fields happen to be
   null.

**The alternative (recording as genuinely unanswered) would mean:** not
conflating "exhausted-with-a-guess" and "exhausted-with-nothing" under one
`confidence: 'low'` flag — e.g., a distinct marker (`exhausted: true`, or a
`'unanswered'` status distinct from `'low'`) that a corpus/PM-review surface
could query specifically. This is **not the same question** as "should the
flow still complete" — Rule 3.5's one-reask-then-advance design exists
specifically so a real engineer is never trapped in a reask loop, and
nothing here argues for reopening that. The two are separable: the flow can
still advance and complete on budget exhaustion (as it does now) while
still recording, distinguishably, that nothing was actually captured. That
distinction is what's missing today, not the advance-on-exhaustion policy
itself.

Both (a) and (b) are pre-existing patterns of this flow's design (Rule 3.5,
the reask-cap mechanism), not introduced by this restructuring — but §33(b)'s
redesign (below) touches this exact code path, so this is the natural moment
to decide whether either ships alongside it.

---

## 1. RPC bodies, TS mirrors, signatures

**`apply_evening_flow_turn`** — live body is in
`supabase/migrations/025_evening_productivity_reconciliation.sql:147-`
(most recent `CREATE OR REPLACE`; 022 defined it first, 024 replaced it for
evening's old Q4/Q5 (headcount/productivity and equipment, old numbering —
see §2's naming note), 025 replaced it again for the productivity-inversion
fix). Confirmed
against `bot-flows.md:148-149`'s own citation, independently. Current
10-parameter signature, **must be preserved verbatim**:
```
apply_evening_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_parse         JSONB DEFAULT NULL,   -- per-step parses, keyed by step id
  p_parse_ok      JSONB DEFAULT NULL,   -- per-step conclusiveness, keyed by step id
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER DEFAULT NULL
)
```
**This is good news for this migration specifically**: because per-turn
values already live inside `p_parse`/`p_parse_ok` JSONB keyed by step id
(not named SQL parameters), adding/removing/renumbering QUESTIONS does not
require touching the argument list at all — new step keys just appear in
the same JSONB. This restructuring is naturally compatible with the
signature-stability concern CLAUDE.md's "CREATE OR REPLACE only preserves
grants when the signature is unchanged" rule names, and with §31's
longer-term stable-signature proposal (this migration doesn't need §31 done
first — it's already shaped correctly). **Still must be checked explicitly
before merge** — do not assume; confirm the final CREATE OR REPLACE
statement's parameter list is byte-identical to the above.

**`apply_morning_flow_turn`** — live body is in
`supabase/migrations/030_morning_flow_attendance.sql:321-` (most recent
replace). §33(a)'s equipment change **does not touch this RPC's SQL at
all** — see §6 below; flagged now because it affects whether this really
needs to be "one migration" touching two functions, or one migration
touching one function plus a documentation-only equipment note.

**TS mirrors:**
- `dispatchEveningFlow` (`lib/whatsapp/flows/evening.ts:400-700`) — explicitly
  documented as NOT authoritative, and per the file's own tracked note has
  **zero test coverage and zero production callers** (unlike
  `dispatchMorningFlow`, which has 15 dedicated tests). This restructuring
  is a full rewrite of this function's body regardless of what's decided
  below — **decide, don't silently carry forward:** either give it the same
  dedicated-test treatment morning's mirror has, or delete it as dead code.
  **DECIDED, 2026-08-31 (Aravind): delete it.** Zero tests, zero production
  callers — dead code the restructuring would otherwise faithfully rewrite a
  third time. Do not give it the morning mirror's test treatment.
- `applyEveningFlowTurn` (`lib/whatsapp/flows/evening.ts:715-800`) — the real
  production wrapper. Needs updating regardless: new parser calls, new
  `p_parse`/`p_parse_ok` keys for the new step numbers.

---

## 2. Branch map — current vs. target

**CURRENT (steps 1–6, conditional):**

| Step | Question | Parser | Reask cap | Writes | Next |
|---|---|---|---|---|---|
| 1 | Work completed + qty | `parseQuantities` | none (ungated) | `evening_output`, `evening_output_quantities` | → 2 |
| 2 | Plan met? | `classifyYesNo` | 1 | `evening_schedule_met` | met→4, not met→3 |
| 3 | Why not (CONDITIONAL) | none (verbatim) | none | `evening_schedule_miss_reason` | → 4 |
| 4 | Headcount | `parseLabourCount` | 1 | *(held in context only)* | → 5 |
| 5 | Productivity/idle | `parseProductivity` | 1 | `evening_workers_on_site`, `evening_productive_manpower` | empty morning equip → complete; else → 6 |
| 6 | Equipment hours | `parseEquipmentHours` | 1 | `evening_equipment_utilisation`, `evening_submitted_at` | → complete |

**TARGET (§28(l), 5 questions, fully linear except the existing equipment
auto-skip — no more answer-dependent branching at all):**

| Step | Question | Parser | Reask cap | Writes | Next |
|---|---|---|---|---|---|
| 1 | Work completed + qty | `parseQuantities` (unchanged) | none | `evening_output`, `evening_output_quantities` (unchanged) | → 2 |
| 2 | Workers by trade | NEW (enrichment of `parseLabourCount`'s existing by-trade shape) | 1 | NEW `evening_manpower` | → 3 |
| 3 | Idle hours by trade | **NEW parser, does not exist today** | 1 | NEW `evening_idle_hours` | → 4 |
| 4 | **Evening Q4** — equipment hours used, one number per type (**DECIDED, §6/§13**; NOT morning's Q4, which asks units, §33(a)) | `parseEquipmentHours`, **redesigned to by-type, single-number** (§6) | 1 (trigger narrower now — no arithmetic guard, §6 Consequence 1(a)) | `evening_equipment_utilisation` (reshaped, §6: `{type, hours_used, raw, confidence, matched}`) | empty morning equip → skip to 5; else ask/reask → 5 |
| 5 | Hindrance (UNCONDITIONAL) | none (verbatim, same shape as old step 3) | none | `evening_schedule_miss_reason` — **DECIDED: REUSED**, with a dated annotation, see §3/§4 | → complete |

**Structural simplification worth naming plainly:** deleting "plan met?"
removes the ONLY answer-dependent branch this flow ever had (met→skip Q3
vs. not-met→ask Q3). The target flow has exactly one conditional edge left
— the pre-existing equipment auto-skip (BOT-22, unchanged trigger:
`jsonb_array_length(morning_equipment->'items') = 0`) — everything else is
a straight line. This is a real reduction in the RPC's `CASE` complexity,
not just a renumbering.

**Reask keys.** Current: `e2_reask`, `e4_reask` + `e4_headcount` (the
two-part evening Q4 handoff — old evening numbering, headcount/
productivity, NOT the equipment question; see the naming note below),
`e5_reask`, `e6_reask`. Target needs reask keys for steps 2, 3, 4 only
(steps 1 and 5 are ungated, same as today's steps 1 and 3) — **one fewer
gated step** than today (old evening Q4's headcount+productivity split
collapses into one single-step "workers by trade" question, so the
`e4_headcount` context-passing mechanism disappears entirely — a genuine
simplification, not just a rename). `EVENING_IN_FLIGHT_KEYS` must be
rebuilt to match the new key set exactly, same discipline the current file
already documents for why the full set must be stripped, not just one key.

**Naming note, per instruction (2026-08-31): "Q4" is disambiguated
throughout this plan from here on.** Old evening numbering used "Q4" for
headcount/productivity (two sub-steps) and "Q5" for equipment
(`evening.ts`'s own header comments) — already unambiguous against
morning's Q4 (equipment, units) purely by accident of the old numbering.
**The restructuring itself creates the real ambiguity**: the TARGET design
renumbers evening's equipment question to Q4 too, so "Q4" now names
equipment in BOTH flows, with different questions and different answer
shapes. From here, **"Morning Q4"** always means the units question
(§33(a)); **"Evening Q4"** always means the hours-used question
(§6/§13/Decision 1). Neither is ever written as bare "Q4" below.

---

## 3. Columns

**Newly written (confirmed genuinely new — zero hits for either name across
`supabase/migrations/*.sql`, `types/database.ts`, `lib/`, `app/`):**
- `evening_manpower` — JSONB. Shape TBD but should mirror
  `morning_manpower`'s post-030 shape (`{total, by_trade:[{trade,count}],
  raw_text}`) for consistency — not decided here. **§42 applies (added
  2026-08-31, see §15): `by_trade` entries for an unrecognised token are
  NOT dropped — captured as `{trade: <raw token>, count, matched: false}`,
  same as morning manpower and equipment. `total` still sums every number
  found, matched or not, same as today.**
- `evening_idle_hours` — JSONB, by-trade. Shape is **genuinely undesigned**:
  no existing parser produces `{trade, idle_hours}` pairs. `parseLabourCount`
  pairs a NUMBER with an adjacent trade token for a *headcount*; this needs
  the same pairing mechanism for *hours*, and must accept "none idle" /
  "all working" as a valid zero-value answer for a question that's now
  unconditional (asked every day, not just on a bad day). New parser, not a
  reuse. Also inherits §28(r)'s already-named vocabulary risk (single-token
  positional trade matching, Civil-biased coverage, multi-word trades unmatchable) —
  this migration makes that gap load-bearing for a THIRD field (after
  morning Q3 and evening Q2), not just the two it already was. **§42
  applies here too** — an unrecognised trade in the idle-hours answer is
  captured with `matched: false`, not dropped; this is the field where §42
  matters most, since it's brand new with no existing drop-then-total
  behavior to compare against.

**Newly unread** (§28(p)'s list, checked against this migration specifically):
- `evening_schedule_met` — unread (Q2-old deleted).
- `evening_workers_on_site` — unread (replaced by `evening_manpower.total`).
- `evening_productive_manpower` — unread (aggregate productive/idle deleted
  entirely; replaced by `evening_idle_hours`).
- `evening_schedule_miss_reason` — **NOT unread. DECIDED, 2026-08-31
  (Aravind): REUSED** for the new unconditional Q5 hindrance capture, with
  a dated annotation on the column recording that the name predates the
  unconditional question (it was named for the old conditional "why not"
  follow-up). This is a deliberate choice over a fresh column specifically
  because it keeps 019's CHECK/CASE entry for this column live and
  *correct* rather than creating a third dead-but-wired whitelist entry —
  see §4, now resolved.
- `daily_hire_cost` — **correction to §28(p)'s own addendum, which calls
  this a "column."** Checked directly: it is a **JSONB key inside
  `morning_equipment.items[]`** (confirmed via `docs/schema.md:187,886` and
  `equipment.ts`'s own `EquipmentItem` interface), not a table column at
  all. No schema object to leave unread — the addendum's "kept, no longer
  written" treatment is correct in substance, just imprecisely worded.
  Flagging per this project's own cross-reference-audit discipline
  (CLAUDE.md, "assertions of nonexistent/mischaracterized artifacts").
- `computeIdleCost` (`lib/dpr/idle-cost.ts`) — code, not a column, stays
  unread per §33(e). No new finding here, restated for completeness.

**Do not drop anything** — confirmed hard constraint, same as morning's
precedent.

**§33's `morning_equipment` shape question, answered directly, not
assumed:** `count` is **already a JSONB key** in the live `EquipmentItem`
shape (`equipment.ts:19-25` — `{type, count, owned_or_hired,
daily_hire_cost, raw}`), always written `null` today by `parseChunk`'s
current rule (first number → `daily_hire_cost`). **No new column, no new
JSONB key, and no CHECK constraint exists on `morning_equipment`'s shape**
(grepped `supabase/migrations/*.sql` for a `CHECK` on `morning_equipment` —
zero hits). §33(a) is a **one-line rule change** inside `parseChunk`:
assign the first number to `count` instead of `daily_hire_cost`, and stop
writing `daily_hire_cost` (leave it `null` going forward, per §33(e)).
`daily_hire_cost` stays present in the object shape, permanently null on
every row written after this ships.

**No backfill for historical rows, and this should be stated as a decision,
not an oversight:** existing `morning_equipment` rows have `daily_hire_cost`
populated (a rate) and `count: null`. There is no sound transform from a
stored rate back into a unit count — the two numbers are not related by any
recoverable formula. Historical rows keep their old (rate-shaped, no count)
data permanently; only rows written after this ships get a real `count`.
Not a migration decision to make silently — record it as accepted, the same
way §33 already accepts other stated costs.

---

## 4. The 019 sync surface — verified column by column

Checked directly against `019_daily_log_corrections.sql`'s own CHECK
(lines 88-100) and CASE (lines 183-195), and `lib/dpr/assemble.ts`'s
`CORRECTABLE_SCALAR_COLUMNS` (lines 334-344):

| Column | In 019 CHECK? | In 019 CASE? | In `CORRECTABLE_SCALAR_COLUMNS`? | Affected by this migration? |
|---|---|---|---|---|
| `evening_output` | YES (line 99) | (not separately grepped, scalar TEXT presumed same as always) | YES | Unaffected — Q1 unchanged. |
| `evening_schedule_met` | **YES** (line 99) | **YES**, `'boolean'` (line 188) | **YES** | **Column deleted from the live flow. DECIDED, 2026-08-31 (Aravind): leave the whitelist entry wired**, matching §28(p)'s own precedent for `morning_execution_plan` — harmless to leave, worth a reviewer noting rather than a silent drop. No longer a recommendation; settled. |
| `evening_workers_on_site` | **YES** (line 99-100) | **YES**, `'integer'` (line 189) | **YES** | Same as above — **DECIDED: leave wired**, same precedent, same reasoning. |
| `evening_schedule_miss_reason` | **YES** (line 100) | **YES**, `'text'` (line 195) | YES | **DECIDED, 2026-08-31 (Aravind): REUSED** for the new unconditional Q5 hindrance, with a dated column annotation. The CHECK/CASE entry stays live and *correct* — a PM can still correct a hindrance note through the exact same path — rather than becoming a third dead-but-wired entry. No longer open. |
| `evening_productive_manpower` | NO (JSONB, never in 019's scalar-only scope) | NO | NO | Unaffected — was never correctable, stays that way, consistent with `evening_equipment_utilisation` never being correctable either (§0(b) above). |
| `evening_manpower`, `evening_idle_hours` (new) | N/A | N/A | N/A | New JSONB columns, out of 019's scalar-only scope by construction — same treatment as `morning_manpower`/`evening_productive_manpower`. No 019 change needed for the new columns themselves. |

**RESOLVED, 2026-08-31 (Aravind).** The naming tension this table surfaced
— §28(p)'s "if hindrance capture reuses it, the name will mislead — rename
or annotate deliberately" — is decided: **reuse, with a dated annotation**,
not a rename. This keeps 019's CHECK/CASE entry live and *correct* rather
than adding a third dead-but-wired whitelist entry, and it settles all
three 019 rows in this table at once — two (`evening_schedule_met`,
`evening_workers_on_site`) stay wired to a now-unread column per §28(p)'s
own precedent, one (`evening_schedule_miss_reason`) stays wired to a
column that is still genuinely written, just for a different question than
its name suggests.

---

## 5. Tests asserting on evening step numbers or affected columns — file:line

**Scope note (2026-08-31): this section's title is now under-inclusive.**
§42(d) brings morning's `parseLabourCount`/`morning_manpower` into this
migration's scope. The "Not affected, confirmed" close this section
originally had for morning's test files is corrected below, not restated
as still true.

**`EVENING_QUESTIONS[N]` / step-number assertions (break on renumbering):**
- `test/dispatch.test.ts:113,137,144,145,174` — `EVENING_QUESTIONS[2]`,
  `current_flow`/`current_step` literals.
- `test/webhook.test.ts:360,368,407` — `current_step` literals,
  `EVENING_QUESTIONS[2]`.
- `test/migration-022.test.ts:71,72,87,96,108,109,111,112,126,127,130,134,135,
  147,148,151,152,156,188+` — extensive step-number and
  `evening_schedule_met`/`evening_schedule_miss_reason` assertions; this file
  predates 024/025 and already carries "NOT 0 — hands off" / "NOT 3" style
  comments about step semantics that this restructuring invalidates wholesale.
- `test/migration-024.test.ts:35-42,81,169,172,174,184,188,199,215,226,230,
  241,256,268,288,293,323,326` — the single largest affected file. Asserts
  `current_step` values 4/5/6, `evening_workers_on_site`,
  `evening_productive_manpower`, `evening_equipment_utilisation` shapes
  (including the exact MATCH TIERS item shape this plan's §6 replaces).
  **This file needs a near-total rewrite, not a patch** — it is testing the
  per-machine matching algorithm §6 retires.
- `test/productivity-reconciliation-mirror.test.ts:115,116,130,165` —
  `current_step: 5` fixture (evening step space), `evening_productive_manpower`
  reads. Entire file tests logic being deleted (aggregate productive/idle
  reconciliation) — **retired outright, confirmed, not migrated.** This is
  also the ONLY file importing `dispatchEveningFlow`
  (`test/productivity-reconciliation-mirror.test.ts:3,129` — `import {
  dispatchEveningFlow, ... }`, `describe('UNIT — dispatchEveningFlow ...')`)
  — deleting this file and deleting `dispatchEveningFlow` (§1, DECIDED) are
  the same event, not two independent removals to sequence.
  **CHECKED, review round (2026-08-31): `test/outbound-trigger.test.ts:88`'s
  reference to "dispatchMorningFlow/dispatchEveningFlow" is a COMMENT only —
  no import, no call. Confirmed inert.** Safe to delete `dispatchEveningFlow`
  without breaking that file's tests, but its comment will then name a
  function that no longer exists — update the comment in the same change,
  not left as a dangling reference for the next reader.
  **LEDGER CONSEQUENCE, review round (2026-08-31):** if a conventions
  ledger or review-package entry elsewhere records this file as the
  dual-copy enforcement test for migration 025's productivity-reconciliation
  logic (the reviewer's own citation: "convention 11"), that entry must be
  struck with a dated note when this file is deleted. **Searched this repo
  directly for that citation — `grep -rn "onvention 11" docs/ CLAUDE.md` —
  zero hits.** Either it lives in a document not yet in this repo (the
  reviewer's own working notes, or a future review package this migration
  hasn't generated yet) or the citation number belongs to a numbering
  scheme not currently grep-able here. Not fabricated or guessed at — recorded
  as a checklist item for whoever assembles this migration's actual review
  package: locate and strike whatever ledger entry cites this test, dated,
  before that package is considered complete.

**Renamed/deleted-column assertions:**
- `test/helpers/db.ts:369,422,426,552,564,579-581,597-622` — fixture types
  for `current_step`, the full `evening_*` column list (line 622's raw
  SELECT string literally spells every old column name — needs the same
  "fixture helper, needs the rename" treatment morning's plan flagged for
  its own `db.ts` hits).
- `test/migration-019.test.ts:32,145,180,182` — corrects
  `evening_workers_on_site` directly; needs revisiting once §4's naming
  decision lands (does this test move to a new column, or does it correctly
  keep testing a still-wired-but-unread correction path?).
- `test/unit/yesno-classifier.test.ts:1-20` — **the file's own header
  already documents itself as testing evening Q2's classifier "for the
  one-migration window before evening Q2 is deleted."** This migration is
  that window closing: `classifyYesNo`'s schedule-met tuning becomes
  entirely dead for evening (only morning Q1/holiday remain consumers).
  Not a bug to fix, but the file's own self-description means this is the
  expected, named moment to either strip the evening-specific test cases or
  leave them as a historical record — flagged, not decided.
- `test/dpr-generate-job.test.ts:130,174,222,340` — `evening_schedule_met`
  fixture values feeding `assembleEngineerDprFacts` (the live per-engineer
  path). Needs updating once the DPR-side consumers (§7) settle on their
  target shape.
- `test/unit/assemble-dpr-facts.test.ts` (whole file) — tests
  `mergeDprFacts` against the OLDER project-level `evening_schedule_met`/
  `evening_workers_on_site`/`evening_productive_manpower` shape. This
  assembler is a separate, parallel path from the live per-engineer one
  (§7) — confirm whether it's still exercised by anything live before
  deciding whether this file needs updating or can be left as historical
  coverage for a path nothing calls.

**Still not affected, confirmed:** `test/inbound-start.test.ts` — no
`morning_manpower`/`by_trade`/`planned_count` hits at all; genuinely
untouched. Morning's STEP NUMBERING (§28(c): attendance/plan/labour/
equipment) is also genuinely untouched by §42 — only the by-trade shape
inside step 3's write changes, not which step it lives on.

**Morning test surface for §42(d) — added 2026-08-31, same file:line depth
as evening's audit above:**

- `test/unit/morning-dispatch.test.ts:191-200,223-225` — **WILL BREAK, not
  just needs new coverage.** Both use `.toEqual()` (exact deep equality,
  not `.toMatchObject()`) against `dispatchMorningFlow`'s
  `morning_manpower` output — line 191-200 asserts the full by-trade object
  for `'12 mason 8 helper'` with exactly `{trade, count}` keys per element;
  line 223-225 asserts the reask-exhaustion case (`{total: null, by_trade:
  [], raw_text: 'still no number'}`). Adding a `matched` field to each
  element makes both `toEqual` calls fail immediately — these must be
  updated in the same change that adds the field, not after. `morning.ts`'s
  `dispatchMorningFlow` mirror itself also reshapes `planned_count`→`count`
  independently of the RPC (per its own comment at lines 183-186,
  mirroring the RPC's boundary-rename) — meaning §42's morning half touches
  **three** places in lockstep: `parseLabourCount` (the source), the RPC's
  SQL reshape (§15(e)), and this TS mirror's own reshape — not just the two
  named in §15(e).
- `test/morning-flow.test.ts:233-249,253-269,271-287` — integration-level,
  uses `.toMatchObject()` throughout (lines 241, 267, 287) — **tolerant of
  an added `matched` key, will keep passing unchanged.** This is a coverage
  gap, not a break: none of these three cases exercises an unmatched trade
  token at all (the only inputs tested are `'12 mason 8 helper'`, `'some
  workers'`/`'still no number'` — no-number cases — and equipment's `'JCB
  1500'`), so §42's actual target behavior (an unmatched token like "PEB")
  has zero test coverage today and needs a genuinely NEW test case, not an
  edit to these three.
- `test/migration-019.test.ts:199-205` (`T-019-05`) — **unaffected,
  confirmed.** This is a negative test asserting `morning_manpower`
  (JSONB) is REJECTED (`42501`) as a correctable column — the payload
  shape used (`[{role: 'mason', count: 3}]`) is incidental to what's being
  tested (rejection), not a positive assertion on the shape itself. No
  change needed regardless of what `by_trade` elements look like.

---

## 6. §33(b)'s real scope — this is bigger than "fix the count/rate mixup"

**Central finding of this pass, checked directly against both the SQL RPC
and the TS mirror, not inferred from §33's prose alone:** §33(b) states
equipment mirrors manpower — "captures hours by TYPE... Not per individual
machine." Checked what the CURRENT matching algorithm actually keys on:
`matchEquipmentHoursItems` (`evening.ts:308-395`) takes
`morningItems: ReadonlyArray<{type: string}>` — **`count` is never read
by the matcher, in either the TS mirror or the SQL RPC** (grepped
`024_evening_flow_q4_q5.sql` for `count`/`->'count'` inside the MATCH TIERS
block — zero hits; the whole tier system operates on `type` string and
list-position only). This means:

**§33(a) alone (fixing what `count` means) does NOT fix tonight's defect
class.** Even with `count` correctly populated, "2 JCB" is still stored as
**one** `morning_equipment.items` entry — the matcher's `morningItems.length`
stays 1, Tier 1's label bound (`label <= morningItems.length`) still rejects
a label of "2," and an engineer referencing "machine 2" still resolves to
nothing. Tonight's row is therefore not just a §33(a) rate/count instance —
it's a live demonstration of exactly the per-machine indexing model §33(b)
is replacing outright.

**§33(a) is required for a SECOND, independent reason, not only the rupee
figure — added 2026-08-31, UPDATED same day per §13's parking decision.**
§33's own text (§33(c)) frames §33(a) as fixing "a count in a money field,"
the fabricated-rupee defect class. That's real, but it undersells why
`count` matters beyond that fix: `count` is what makes a by-type aggregate
legible at all ("2 JCBs ran 16 hours total" needs `count` to mean anything
as a sentence, independent of whether any percentage is ever computed from
it), it's what §42's by-type capture scheme is built around, and it's what
the eventual invoice-reconciliation report (§13) will need once it exists.
**Originally this paragraph framed §33(a) as urgently required because the
UTILISATION denominator needed it immediately — that urgency is gone now
that §13 parks the denominator computation for this migration entirely.**
§33(a) is still required for this migration to ship at all (the
fabricated-rupee defect and the by-type legibility reason both stand on
their own), just not because a same-migration idle/utilisation figure is
waiting on it.

**What §33(b) actually requires, scoped concretely:**
- The entire per-machine apparatus — `morning_item_index`, the numbered
  echo (`buildEquipmentHoursPrompt`'s "1) JCB" / "2) Mixer" format), Tier
  1/2/3 label-and-type matching, the Case-B "not reported" placeholder, the
  `EquipmentEchoItem`/`EquipmentUtilisationItem` shapes keyed by index — is
  retired, not patched. Confirmed nothing else in the codebase depends on
  `morning_item_index` surviving except the DPR-side consumers named in §7
  below (which, per Decision 1(b)'s dropped `idle_reason` field, now lose
  that narrative-context input entirely rather than merely needing a
  re-key from index to type) and the cross-engineer suppression logic in
  `assemble.ts` (§7) — both need their own pass once the new shape is
  fixed.
- **DECIDED, 2026-08-31 (Aravind), FINAL SHAPE — supersedes every earlier
  draft of this bullet, including this same day's own "parking" language.**
  Evening Q4 asks for ONE number per type: hours used. "JCB used 13 hours.
  Mixer used 4 hours." — the morning equipment list echoed, one number
  each. `available_hours`/"hours on site" is **DROPPED — there is no
  second number, ever, by this question.** Replacement shape:
  `{type, hours_used, raw, confidence, matched, implausible}` (last field
  name per the plausibility ruling below — added, not yet in a prior draft
  of this bullet) keyed by `type` string directly (the same join key
  `canonicalEquipment` already produces), no positional index, no
  `available_hours` field, no `idle_reason` field —
  the prompt no longer asks about idle at all, so there is nothing to
  capture a reason for (whether a parser opportunistically keeps trailing
  free text as a note is a small implementation detail, not decided here).
  **§42 applies (added 2026-08-31, see §15):** add `matched: boolean` to
  this shape. An unrecognised equipment keyword today already survives
  (via `firstNameWord`/`'equipment'` fallback naming in `parseChunk` — it
  isn't dropped the way an unmatched trade is), but nothing marks it as
  non-canonical, and §42 requires that distinction explicitly, the same as
  morning manpower and the two new by-trade fields.
- **CONSEQUENCE 1(a) — the arithmetic guard is eliminated by construction,
  not fixed.** `equipment-hours.ts`'s guard (§0(a)'s subject — `actual_hours
  > available_hours`, the exact guard that rejected both of tonight's real
  replies and re-asked with no explanation) has nothing left to compare
  once there is only one number. This is the cleanest possible resolution
  to §0(a)'s cost/benefit analysis: not "make the rejection explain
  itself" (§0(a)'s own proposal, still valid for whatever failure modes
  remain) but "remove the comparison that produced the silent rejection in
  the first place." **RULED, review round (2026-08-31): the plausibility
  bound is a FLAG, never a GATE.** Above 24 hours × `count`, the number is
  still CAPTURED verbatim, marked implausible, and rendered marked — it is
  never rejected, never triggers a reask, and is never silently converted
  into an unflagged acceptance. This closes the residual left open above by
  ruling out all three failure shapes the 2026-08-31 incident actually
  contained in sequence — reject, explain nothing, then (on budget
  exhaustion) convert silence into unflagged acceptance — a flag commits
  none of the three: nothing is rejected, so nothing needs explaining, and
  what's captured is never presented as more trustworthy than it is.
  **This is the confidence-field shape Rule 3.5 has owed since migration
  024** (§32(c)'s own prerequisite list: "A CONFIDENCE FIELD... nothing
  marks which parses were guesses") — same ruling shape as
  `attendance_defaulted` (`030_morning_flow_attendance.sql:163,353,448,
  525,551-556`): evidence captured at write time, judgment rendered to the
  reader, never enforced by the system itself. Add the equivalent flag
  (exact key name not decided here) to Evening Q4's shape (§6's shape
  bullet above) alongside `matched`.
- **CONSEQUENCE 1(b) — §33(b) is SUPERSEDED, not deferred, dated correction
  here (this plan's own copy; the source decision in
  `design-decisions-beta-feedback.md` is untouched by this plan).**
  §33(b) reads as though a derived idle figure (`available − actual`)
  arrives later, once something computes a denominator, from data the
  system is collecting in the meantime. **That is no longer true, and not
  merely postponed:** with `available_hours` dropped from the question
  entirely, that data will never exist in the daily record. Derived idle
  is not deferred pending a denominator — it is **structurally
  uncapturable from daily check-in data as this migration leaves it.**
  **SOFTENED, review round (2026-08-31), per finding: "permanently" overstated
  this.** What this decision removes is the SUBSTRATE — the daily record no
  longer contains a second number for anything to divide against. That is
  not an irreversible law of the product; a future decision could
  reintroduce a second question and start collecting `available_hours`
  again, exactly as deliberately as this one stopped collecting it. Nothing
  here forecloses that future decision — it only means today's migration
  does not leave the data lying around unused, and reintroduction is a new
  decision requiring new collection, not a switch to flip on data already
  sitting in the table.
  §33(b)'s SEPARATE claim — type-level aggregation, "aggregates are sums,"
  not per-machine — is **unaffected and still stands**; only its
  idle-derivation half is superseded. §13 (below) previously called this
  "deferred, not reversed" — that was accurate as of this same day's
  earlier round and is now itself superseded by this later decision; not
  rewritten there, corrected in place with its own dated note.
- **CONSEQUENCE 1(c):** the DPR shows hours used, as collected — no
  derived figure, no percentage, ever, from this data source. See the new
  §17 ("The DPR reports, the reader judges") for the design reasoning this
  is part of.
- The auto-skip trigger (`jsonb_array_length(morning_equipment->'items') =
  0`, BOT-22) is unaffected by any of this — it only checks list emptiness,
  never per-item shape.

**Confirmed separately: `apply_morning_flow_turn`'s SQL body needs zero
change for §33(a) alone.** Checked both write sites directly — 018's
original (`018_morning_flow_parsers.sql:211-215`) and 030's current live
version (`030_morning_flow_attendance.sql:612-618`) — both write
`morning_equipment` via a plain `INSERT ... ON CONFLICT ... SET
morning_equipment = EXCLUDED.morning_equipment`, passing the TS-computed
JSONB straight through with no cost/count-aware SQL logic anywhere. §33(f)'s
own framing ("the write path is the morning RPC, so this needs a migration")
overstates the technical dependency — correcting it here per this project's
own cross-reference-audit discipline. The **evening** side is where a real
RPC body change is unavoidable (the MATCH TIERS rewrite above); bundling
§33(a)'s one-line TS parser change into the same release is a sequencing
convenience (ship the whole equipment story together), not a technical
requirement on `apply_morning_flow_turn`.

---

## 7. Downstream DPR consumers — surveyed, not exhaustively audited

Two parallel assemblers exist and both read the columns this migration
touches:

- **Per-engineer path (`assembleEngineerDprFacts`, `lib/dpr/assemble.ts:457+`)
  — the live one**, per tonight's own evidence (migration 028's engineer_id
  column, this project's actual DPR generation target). Reads
  `evening_schedule_met`, `evening_workers_on_site`,
  `evening_productive_manpower`, `evening_equipment_utilisation` directly
  (lines 468-484, 545-576, 628-767) and is 019-correction-aware for the two
  correctable scalars among them.
- **Project-level path (`mergeDprFacts`/`assembleDprFacts`, same file,
  lines 35-455)** — an older, parallel assembler for a different
  (deferred, per CLAUDE.md's Fast-Follow framing of the accountability
  engine) report shape. Same four columns, same shapes. **Not confirmed
  whether this path has any live caller today** — flagged for the
  implementer to check before deciding whether it needs updating or can be
  left as dead-but-tested code.
- `lib/dpr/schema.ts` — `ScheduleFacts.schedule_met`, `ManpowerFacts.headcount/
  productive_count/idle_count`, `EquipmentItemFacts` all model the shapes
  being deleted/reshaped.
- `lib/dpr/narrative-context.ts` — both `fetchNarrativeContext` and
  `fetchEngineerNarrativeContext` select `evening_schedule_miss_reason,
  evening_productive_manpower, evening_equipment_utilisation` directly
  (lines 50, 95) and read `.idle_reason`/`.items[].idle_reason` off shapes
  this migration reshapes. **UPDATED per Decision 1(b) (2026-08-31):** this
  is no longer "needs updating to key on `type`" — Evening Q4's new shape
  (§6) has no `idle_reason` field at all, so `EquipmentIdleReason`
  (`narrative-context.ts:22-25`) and the `equipment_idle_reasons` mapping
  (lines 34, 63-65, 108-111) lose their equipment-side input entirely, not
  just their join key. `manpower_idle_reason` (from
  `evening_productive_manpower`) is a separate, still-relevant field —
  unaffected by this, since that column is unread for a different reason
  (§3, the aggregate productive/idle deletion), not by Decision 1.
- `lib/dpr/eval/cases/case-morning-missing-evening-present.ts`,
  `case-manpower-equipment-not-captured.ts`, `case-complete-two-engineer-day.ts`
  — the DPR eval golden-set cases. Per CLAUDE.md §7, the eval harness is a
  **required deliverable**, not optional — these almost certainly encode
  fixture data in the old shapes and need regenerating, not just patching,
  once the new columns/shapes exist.

**This is a real, large downstream surface that has NOT been given the same
file:line depth as §5's flow/webhook test audit** — recommend a dedicated
follow-up pass on the DPR consumer surface specifically (mirroring the
morning rescoping plan's own precedent of flagging this rather than
skipping it silently) before the migration is actually written, given how
much of §28(m)'s "no plan-vs-actual" and this migration's column deletions
land squarely inside `assemble.ts`/`schema.ts`.

**§42 adds a NEW rendering requirement to this surface (added 2026-08-31,
see §15).** An unmatched by-trade/by-type entry must render in the DPR as
**reported** (not suppressed, not silently folded into a total) while being
**excluded from the efficiency/utilisation metric** it has no standard to
compute against, with the exclusion stated, not implied. This is a new
`DataStatus`-adjacent case `schema.ts` does not have today — its existing
statuses (`complete`/`partial`/`not_captured`, per §7 above) all describe
whether data was CAPTURED; §42(b) needs a status that describes captured
data being EXCLUDED FROM A COMPUTATION for a different reason (no standard
exists for it yet). Flagged for the DPR consumer follow-up pass named
above, not designed here — no schema/code decision made in this plan.

---

## 8. In-flight sessions at deploy

**Checked live, read-only, against prod (`jvxwqignooseazzmwhvl`), this
session:** `SELECT current_flow, current_step, count(*) FROM
whatsapp_sessions WHERE current_flow IS NOT NULL GROUP BY current_flow,
current_step` → **zero rows.** No session mid-flow at the moment of writing
— **and this already covered morning, not just evening.** The query
filters on `current_flow IS NOT NULL` with no flow-name restriction, so the
zero-row result is a single check spanning both flows, not an evening-only
finding that needs a separate re-run now that §42(d) brings morning's RPC
into this migration's scope.

**Morning's own risk profile here is materially lower than evening's, and
worth stating precisely rather than assumed equal.** §42's morning change
(§15(e)) does not touch step ROUTING or step MEANING at all — step 3 is
"workers by trade" before and after this migration, unchanged. This is the
opposite of evening's hazard, where old step 2 ("plan met?") and new step 2
("workers by trade") are different QUESTIONS under the same number — the
exact silent-misinterpretation risk this section's option 2 rejects for
evening. A morning session genuinely mid-flow at the deploy instant would,
worst case, have its step-3 answer written with or without the `matched`
field depending on which RPC version happens to process it — a data-
completeness inconsistency (one row missing `matched` while later rows
carry it), not a misattribution. Still worth covering by the same
quiet-window deploy below, for free, but the underlying exposure this
migration adds to morning specifically is smaller in kind, not just in
count, than the exposure it already carried for evening.

**This number means something different than it did for morning's own
rescoping plan (2026-08-22).** That plan's identical check also returned
zero, but explicitly caveated it as meaningless because "the outbound-send
primitive that would put real engineers into real flows on a schedule
doesn't exist yet." **That caveat no longer holds.** Per tonight's own
evidence, the evening cron delivered a real, live check-in for the first
time today (2026-08-31, `evening_submitted_at 13:04:55 UTC`) — the
outbound-send primitive and both trigger crons are live in production
(CLAUDE.md §3). Zero in-flight sessions right now is a real, current
observation of a genuinely-live system with a small (3-engineer) beta
cohort, not an artifact of nothing running yet. Blast radius is small but
no longer structurally zero-by-construction.

**Additional gap, not present in morning's equivalent analysis:** migration
033 built a dedicated cutoff sweep for **morning only**
(`033_sweep_stale_morning_sessions.sql`, fires at `morningCutoff` 15:00
IST). **No equivalent sweep exists for evening.** `eveningClose` (19:45
IST) closes an unsubmitted evening day at DPR-generation READ time
(`dpr-generate/route.ts`'s own zero-data/partial handling), not by
resetting `whatsapp_sessions`. A stuck evening session past `eveningClose`
today has no atomic sweep resetting it — only BOT-07's lazy next-IST-day
wipe eventually clears it. This is a pre-existing gap, not introduced by
this migration, but it means evening's "nothing should be mid-flow at
deploy time" story is *weaker* than morning's was even after 033 shipped.

**Options (same three morning's plan named, re-evaluated for evening's
current, less-than-zero-risk-by-construction situation):**
1. **Migration-time sweep** — reset any `current_flow='evening'` row as
   part of applying this migration. Cost: an engineer genuinely mid-flow at
   the exact deploy moment loses in-progress answers unless the sweep
   preserves partial data (same shape §29(d)'s morning fix already solved
   once — reusable pattern, not new design).
2. **Accept it** (let an in-flight session's next reply be silently
   misinterpreted against the new step semantics) — **reject, same reasoning
   as morning's plan**: this is exactly the silent-wrong-data class this
   whole compliance apparatus exists to prevent.
3. **Deploy in the quiet window** (after `eveningClose` 19:45 IST, before
   `morningSend` 08:30 IST).

**REVISED, review round (2026-08-31): option 3 alone is NOT sufficient for
evening, and this changes the apply plan, not just this section's
framing.** The original text below option 3 called the sweep (option 1)
"belt-and-suspenders" on top of a "recommended" quiet-window deploy — that
ordering is backwards for evening specifically. Morning's quiet-window
guarantee is REAL because 033's sweep forces every morning session closed
by 15:00 IST regardless of engineer behaviour — the window is safe BECAUSE
a sweep already runs on a fixed clock. **Evening has no such sweep.** A
session abandoned mid-flow days or weeks ago — not merely "still open
tonight" — stays `current_flow='evening'` indefinitely, since only BOT-07's
LAZY next-IST-day wipe ever touches it, and that wipe's own triggering
condition is not a guarantee it fires before any given deploy. A read-only
check immediately before deploy (as this session ran, showing zero) proves
nothing was stuck AT THAT MOMENT; it does not prove the window itself is
safe by construction the way morning's is. **Consequence: the apply plan
for THIS migration MUST include an explicit sweep/reset of both flows'
in-flight sessions as a required step of the apply itself — not an optional
belt-and-suspenders layered on a sufficient window, because for evening the
window alone is not sufficient.** The migration-time sweep (option 1) is
promoted from "one of three options" to "required for evening, and cheap
to extend to morning at the same time since the SQL shape is identical."
The quiet-window deploy timing is still worth keeping — it minimizes how
much in-flight data the sweep might have to preserve/discard — but it is
no longer standing in as the safety mechanism.

**This same window still covers morning on its own, independently of this
change:** 19:45–08:30 sits entirely after morning's own `morningCutoff`
(15:00 IST, enforced by 033's sweep) and before `morningSend` (08:30 IST) —
by construction, no morning session should be open anywhere inside it. That
finding is unchanged by this revision; it just no longer implies evening
gets the same guarantee for free.

**Runbook consequence, named explicitly:** whoever writes the apply runbook
for this migration includes a sweep step (reset/close any lingering
`current_flow IN ('morning','evening')` session, preserving whatever
partial data §29(d)'s morning precedent already established how to
preserve) as part of the apply sequence — not as a contingency, as a
standing step, since evening's exposure is open-ended in time, not bounded
to "the deploy window" the way morning's is.

---

## 9. Template / bot-flows.md coupling

**No blocker.** Per §40 (2026-08-31, same day as the rest of this record),
the evening template already dropped `{{3}}` and `quoco_evening_checkin_v3`
(no morning-plan echo) is already the single-template design going forward
— Q1's template body was already unaffected by the plan-vs-actual removal
(§30(a) already noted "Evening's own Q1 (work + quantity) is already
correct today"). Q2-Q5's content changes are all in the flow's *own*
reply text (`EVENING_QUESTIONS`), sent as free-form replies inside the
24-hour session window opened by the template send — not inside any
Meta-approved template body. No new template submission is required by
this migration; only `EVENING_QUESTIONS[2..5]`'s in-repo copy changes.

`bot-flows.md`'s own `## EVENING CHECK-IN (6 questions...)` section
(line 218) is the stale spec §28(l) already supersedes — partially struck
through already (line 194). Confirm this section is fully struck/updated as
part of this migration's documentation pass, not left half-corrected.

---

## 10. External review gate — trips, both conditions

Per CLAUDE.md §0's trigger conditions: this migration **creates or modifies
a live function's logic** (condition (a)) on **both** RPCs, not one —
`apply_evening_flow_turn`'s entire branch structure changes, beyond any
doubt, and **CORRECTED 2026-08-31 (§15(e), §15(d)): `apply_morning_flow_turn`
is also modified**, not left untouched as this section originally stated.
§42's morning half requires editing the `v_col = 'manpower'` branch's
`jsonb_build_object` reshape to carry a `matched` field — a real logic
change trips condition (a) on morning's RPC directly. §33(a)'s own
equipment change (§6) is still confirmed SQL-free on the morning side (the
`v_col = 'equipment'` branch is a true pass-through) — the two changes to
the SAME function differ in this exact respect, which is worth carrying
into the review package precisely rather than treating "the morning RPC"
as one undifferentiated yes/no. Either way, full external review package
required for both RPCs — this was already true via the "if ANY migration
in the PR trips a trigger, the WHOLE PR needs the package" rule even under
the original (wrong) claim; it's simply no longer true that morning only
rides along on that rule rather than tripping condition (a) on its own
account.

Per the disposable-dry-run requirement (CLAUDE.md §7): build the scaffold
from a real `supabase db dump --linked --schema public --dry-run` against
test-db (matching Postgres major version — re-check `SELECT version()`
against prod/test-db before relying on the version pinned in that rule, per
its own instruction), not hand-built — this migration's ordering
(`apply_evening_flow_turn`'s CREATE OR REPLACE relative to any new
column DDL) is exactly the class of defect that check exists to catch.

Per the REHEARSAL REQUIREMENT (CLAUDE.md §0/§7): no new table is created
here (both new columns are JSONB columns added to the existing `daily_logs`
table), so the `service_role` negative-capability probe applies to the
*existing* `daily_logs` grants, not a fresh table — confirm those grants
were already probed when `daily_logs` itself was created (017/019-era) and
are not being reopened by this migration's `ALTER TABLE ... ADD COLUMN`
statements (an `ADD COLUMN` on an existing table does not reset table-level
grants, but this should be verified against the live grants at apply time,
not assumed).

---

## 11. Recommendation / sequencing

1. ~~One open design gap remains before writing SQL: the UTILISATION
   denominator question~~ — **FULLY RESOLVED, 2026-08-31 (§13, superseding
   this same day's earlier "parked" framing): no gap, no residual.**
   Evening Q4 asks for exactly one number per type, hours used — no
   `available_hours`, ever, from this source (Decision 1). There is no
   longer even the small residual this item previously named ("does Evening
   Q4 still ask for a paired number") — that's answered: no. The
   `evening_schedule_miss_reason` reuse-vs-rename question this item
   previously paired it with is also **DECIDED** (reuse, §3/§4). Both drop
   off this list.
2. **Decide the two open items from §0** (silent reask, budget-exhaustion
   force-advance) — note (a) is fully decoupled and could ship independently
   of this migration, before or after, with no RPC/schema change; (b) is
   more naturally decided alongside this migration since §6 already rewrites
   the exact code path it lives in.
3. ~~Decide `dispatchEveningFlow`'s fate~~ — **DECIDED, 2026-08-31: delete
   it** (§1). Drops off this list.
4. **Give the DPR consumer surface (§7) its own file:line audit pass**,
   matching §5's depth, before the migration is written — it is at least as
   large a surface as the flow/webhook tests and has not had the same
   scrutiny in this pass. **§42 (§15) adds to this surface**: the new
   captured-but-excluded rendering case is unaudited/undesigned, same
   status as the rest of §7.
5. **§42 (§15) is DECIDED as part of this migration's scope, covering both
   flows — not a confirmation still needed.** It touches morning's
   already-shipped `parseLabourCount`/`morning_manpower` behavior (stop
   dropping unmatched trades), and — **corrected 2026-08-31, §15(e)** —
   this is a real SQL change to `apply_morning_flow_turn`'s `v_col =
   'manpower'` branch, not a TS-only change that happens to pass through
   unmodified SQL. Three places move together: `parseLabourCount`, the
   RPC's SQL reshape, and `dispatchMorningFlow`'s own mirrored reshape
   (§5's morning test-surface audit). Two existing tests
   (`test/unit/morning-dispatch.test.ts:191-200,223-225`) use exact
   (`toEqual`) matching and will fail the moment `matched` is added —
   update them in the same change, not after.
6. **§43 (§16) is explicitly NOT in scope for this migration** — recorded as
   a named prerequisite (moving the lexicon from `lexicon.ts` to data), not
   scheduled, not designed here. Do not let it creep into this migration's
   scope; §43(f) says so directly.
7. **CHECKLIST, review round (2026-08-31) — explicit line, not folded into
   prose:** re-verify the full context-write site inventory in
   `apply_evening_flow_turn`'s live body
   (`025_evening_productivity_reconciliation.sql`) AFTER renumbering, not
   before. Confirmed concretely: `e4_headcount`/`e5_reask` are written by
   LITERAL step-numbered keys at `025:501-502` (`(v_session.context -
   'e4_headcount') || jsonb_build_object('e5_reask', 0)`) and `025:511`
   (`jsonb_build_object('e5_reask', v_reask + 1)`) — these are not read
   from a shared constant, so renumbering steps does not automatically
   rename them. Every such literal-keyed context write in the live body
   must be found fresh against the ACTUAL file at build time and matched to
   its NEW step number — this plan's own §2 reask-key table is the starting
   map, not a substitute for re-grepping the real file.
8. **TESTS PROVEN RED FIRST, review round (2026-08-31) — required before
   this migration is considered done, sequenced ahead of the SQL being
   treated as complete.** A seeded unmatched-token case (e.g. the real
   `docs/reviews/field-samples.md` sample 1 evidence, "Civil - 25 Nos,
   P.EB - 11 Nos") must be asserted to produce the exact `{trade, count,
   matched: false}` capture (or whatever the final key names are) in BOTH
   flows (morning manpower, evening manpower, evening idle hours) and, for
   equipment, the by-type `matched` case — at BOTH layers: the TS parser
   function called directly, AND a live RPC call with the resulting
   `daily_logs` row read back, the same integration-test shape
   `morning-flow.test.ts`/`migration-024.test.ts` already use. **The
   RPC-layer half is not optional** — it is what would have caught §15(e)'s
   own finding this session (the SQL reshape silently dropping an extra
   JSONB key) if it had existed before that finding was made by manual
   inspection instead. Every one of these assertions must be run and
   confirmed RED against CURRENT code before any implementation lands, not
   written alongside it. **Shared fixture corpus across all four call
   sites** (morning manpower, evening manpower, evening idle hours,
   equipment), mirroring `test/helpers/yesno-corpus.ts`'s own precedent —
   one corpus, checked against every implementation that claims to honor
   the same contract, so the four cannot drift from each other the way nothing
   currently prevents. This is TS-side test-writing, not SQL — the next
   phase after the checkpoint this turn reports at (below), not part of
   "write the SQL."
9. Then: one migration, one external review package (§10), dry-run scaffold
   built from a real schema dump, apply in the evening quiet window WITH the
   required session sweep (§8, revised — no longer optional for evening),
   and a fresh in-flight-session check immediately beforehand.

---

## 12. Verification check performed (2026-08-31) — a revision considered and dropped

A revision to this plan's Evening Q4 handling was drafted, proposing an
"idle-hours-by-type, cumulative" capture for equipment — mirroring
labour's idle-hours-by-trade question (Evening Q3). Before folding it in,
it was checked against the record rather than argued on its own merits.
§33(b) (2026-08-25, `design-decisions-beta-feedback.md:2502-2512`) had
already decided this, and decided it differently: Evening Q4 stays a
RUN-HOURS question, type-level, aggregated as sums, with idle DERIVED
(`available − actual`) rather than separately captured — itself since
superseded by Decision 1 (§6/§13), which this section predates. §33(b)'s
own words ruled out the drafted revision directly — "idle is the
complement, not a new concept." The revision would have replaced an
already-considered decision with a worse one (reintroducing a captured
idle-equipment-hours concept §33(b) explicitly declined to create) had it
gone in unchecked.

**Dropped. §6 above is correct as originally scoped on this point** — it
already documented equipment idle as derived, not captured, consistent with
§33(b) — and was not changed for this reason. §6 *was* corrected on a
narrower, adjacent point (the aggregate-vs-per-unit overstatement, see the
CORRECTED note inserted there) — a real error, but a different one than the
drafted revision would have introduced, and caught the same way: by reading
the dated record before writing, not by re-deriving the design from
principle.

**What this prevented, stated plainly:** not a code bug — a documentation
regression. Had the revision shipped into this plan, a future implementer
reading it instead of §33(b) directly would have built the wrong Evening
Q4, discovered the conflict only at review time (tripping CLAUDE.md's own
external-review gate on a design already settled twelve days earlier), or
worse, not discovered it at all and shipped an Evening Q4 that duplicates
Evening Q3's concept under a different name. The check cost one read of
§33(b) and one grep sweep; the alternative was re-litigating a decision
that had already absorbed its own design discussion.

---

## 13. §14 — RESOLVED, 2026-08-31 (Aravind): superseded by Decision 1, not merely parked

**Second correction to this section in one day, recorded rather than
silently overwritten.** This section first presented three denominator
options as open (morning), then corrected that to "PARKED — no convention
chosen now, revisit once invoices exist" (afternoon). **Decision 1 (this
round) goes further: the residual this section's "parked" framing left
open is now closed, and the framing itself needs one more correction.**
Evening Q4 asks for exactly one number per type — hours used. There is no
`available_hours`/"hours on site" question at all, not now, not from this
source under this migration's design. §14's original 2026-08-10 question
("does Q5 need to ask for available hours at all?") is answered: no.

**Why "parked" was still too weak, stated precisely.** "Parked" implied a
convention would eventually be CHOSEN and applied to data this system is
already collecting — pick a standard, multiply by `count`, revisit later.
Decision 1(b) forecloses that path AS THIS MIGRATION LEAVES IT:
`available_hours` is not asked, so there is no daily-record field for ANY
convention (constant, configurable standard, or otherwise) to apply itself
to today. **Softened per the review round (2026-08-31), same correction as
§6's Consequence 1(b) above:** this removes the substrate, not the
possibility — a later decision could reintroduce a second question and
start collecting it again; nothing here rules that out, it just isn't
collected now.

**HONESTY CORRECTION, review round (2026-08-31) — the supersession pointed
at nothing, and that gap is fixed here rather than papered over.** Earlier
drafts of this section named "a future weekly cost/efficiency report,
reconciled against the invoice" as where the denominator eventually comes
from. **That report does not exist. No owner is assigned to it. No
migration, plan, or roadmap entry schedules it.** Naming it as the
destination was prose describing an artifact that isn't real — exactly the
gap §17's "the reader judges" principle depends on staying honest about.
**Stated plainly instead: idle/utilisation economics for equipment live
NOWHERE in this product today, and will continue to live nowhere until
someone schedules and builds that report.** This is not a defect this
migration needs to fix — §17 already establishes that showing raw numbers
with no computed figure is the deliberate, permanent design for the DAILY
report, independent of whether a WEEKLY report ever exists — but the
WEEKLY report itself is a real gap, unowned, unscheduled, and this plan
does not get to treat it as already accounted for by gesturing at it.
Whoever schedules that work names an owner and a closer at that time; this
plan does not invent one to make the sentence above read more finished
than it is.

**Consequence for §6, §7, §15 — now settled, not conditional:** the
equipment redesign's write shape (§6) is `{type, hours_used, raw,
confidence, matched, implausible}` — no `available_hours`, no
`idle_reason`, no denominator field of any kind. §33(a) (`count`, not
`daily_hire_cost`) remains required — for its original reason (§33(c), the
fabricated-rupee defect) and because `count` makes a by-type aggregate
legible as a sentence regardless of any computation — but, as already
noted before this round, not because a same-migration idle/utilisation
figure is waiting on it, and (per the honesty correction just above) not
because a specific future report is already scheduled to consume it either.
See §17 for why this design (observed numbers, no computed metric) is the
DELIBERATE shape, not a fallback pending future capability.

---

## 14. docs/schema.md correction — applied, pushed, not yet merged

Per instruction, `docs/schema.md`'s `evening_equipment_utilisation` passage
was corrected: the sentence describing `morning_item_index` as "the ACTUAL
join key... POSITION, not `type`," with its differing-hire-rate rationale,
is struck through (not deleted or silently rewritten) with a dated
correction (2026-08-31) recording that §33(b) (2026-08-25, later) supersedes
the design goal that sentence served, and that §33(a) removes the field
(`daily_hire_cost`) the old rationale depended on. The correction is
explicit that this records a DECISION, not a shipped schema change — the
live `daily_logs.evening_equipment_utilisation` shape, `morning_item_index`
included, is unchanged until this migration actually ships.

Committed and pushed to `worktree-evening-schema-dated-correction`
(commit `676c2c6`), **not yet merged to `main`** — a PR link was offered by
the push; merge is a decision for Aravind, not taken here.

---

## 15. §42 — unmatched parse tokens are captured, not dropped (DECIDED, 2026-08-31 — expands this migration's scope beyond evening)

**DECIDED (Aravind).** Applies to ALL by-trade and by-type fields this
migration touches or creates: morning manpower (`morning_manpower`,
already live), evening manpower (`evening_manpower`, new), evening idle
hours (`evening_idle_hours`, new), and equipment (`morning_equipment` /
`evening_equipment_utilisation`, both reshaped by §33/§6).

**a. The problem, as decided.** Today an unrecognised trade token is
DROPPED from the by-trade breakdown while still counting toward the total
— `parseLabourCount` (`lib/whatsapp/flows/parsers/labour.ts:47-58`) only
pushes to `by_trade` `if (trade)`, where `trade = canonicalTrade(after) ??
canonicalTrade(before)`; an unmatched token contributes to `total` via
`sawNumber`/`total += n` regardless, but never appears in `by_trade` at
all. "Civil 25, PEB 11" yields `total: 36` with 25 attributed to a
recognised trade and 11 vanished — nothing in the row says so, even though
`raw_text` preserves the original text verbatim. **Real evidence, not a
hypothetical:** `docs/reviews/field-samples.md` sample 1, a real engineer
writing "Civil - 25 Nos, P.EB - 11 Nos" — disciplines, not the
mason/helper/carpenter/bar_bender/electrician/plumber/painter vocabulary
`TRADE_ALIASES` (`lexicon.ts:14-48`) actually recognises. Today's parser
would eat "P.EB" silently.

**TARGET:** the token is preserved as a NAMED ITEM with an explicit
unmatched marker — `{trade: "PEB", count: 11, matched: false}` (exact key
names not decided here — schema design is out of scope for this record) —
so the total still reconciles against the sum of visible items, the DPR can
show the item as reported, and it stops being invisible. Same treatment for
equipment (§6's redesign already needs a `matched` flag added, see the
edit there) and for the two brand-new evening by-trade fields, which have
no existing drop-then-total behavior to fix — they simply must not
introduce it.

**PRESERVATION REQUIREMENT, review round (2026-08-31): the captured token
must be AS HEARD, pre-normalisation — or the normalisation applied must be
named, not silently assumed absent.** §43's future PM-teaching surface
(§16) needs to see what the engineer actually typed to make an informed
mapping decision; a normalized form can hide the exact spelling/punctuation
a real mapping decision depends on ("P.EB" vs "peb" vs "PEB" are different
evidence of the same underlying gap). **This is not automatic today —
checked directly, not assumed:** `parseLabourCount`
(`lib/whatsapp/flows/parsers/labour.ts:39`) lowercases and tokenizes the
ENTIRE input — `splitDigitBoundaries(raw_text.toLowerCase())` — before
`canonicalTrade` ever runs. Whatever an unmatched capture grabs at that
point in the current tokenizing pipeline is already lowercased, with digit
boundaries split; it is not the original surface form. Building §42's
unmatched capture on top of the EXISTING tokens (the cheap, obvious
implementation) would silently violate this requirement. Whoever builds
this must either (a) capture a substring of the ORIGINAL `raw_text` at the
matching token's position, before lowercasing, or (b) if that's not
practical, name explicitly which normalisation was applied (lowercase,
digit-boundary split) so a later reader of the corpus knows the string in
front of them has already been transformed and by how much. Not decided
here which of (a)/(b) — recorded as a requirement whichever way it's built,
because "the raw text survives somewhere in `raw_text`" (true today) is not
the same claim as "the unmatched item's own token is unnormalized" (not
true today, and not automatic to make true).

**b. DPR consequence, decided, not designed.** An unmatched trade/type
cannot count toward EFFICIENCY (§28(m)) or UTILISATION, because no
`productivity_standards` entry exists for it. The DPR shows it as reported
and EXCLUDES it from the metric, stating the exclusion explicitly — strictly
better than today, where it is excluded from the metric AND invisible in
the report. This is a new rendering case for `lib/dpr/schema.ts`/
`assemble.ts` — flagged in §7 above as part of that section's follow-up
audit, not designed here.

**c. The corpus consequence — record this precisely.** Every unmatched
token is real engineer vocabulary, and capturing it (rather than dropping
it) is what makes §32's self-improving-parsing corpus (`design-decisions-
beta-feedback.md` §32, "RECORD ONLY, NOT SCHEDULED", 2026-08-23) an actual
DATA SOURCE rather than an aspiration. §32(a) already decided to retain raw
inbound text; §32(c)'s own prerequisite list names "GROUND TRUTH... the
only source is a human correction" and "A CONFIDENCE FIELD... nothing marks
which parses were guesses" as still-missing. §42 is the decision that
produces the first of those two for trade/type vocabulary specifically: an
unmatched, retained, explicitly-flagged item is exactly the labelled
"parser failed here" record §32(b) says the corpus needs. **Record plainly:
this decision is what makes that corpus exist for trade/type vocabulary —
it does not exist today**, because today's drop-silently behavior destroys
the signal at parse time, before anything could ever be logged against it.

**d. SCOPE, DECIDED 2026-08-31 (Aravind): §42 covers BOTH flows in this
migration. Morning is included, not deferred.** Rationale, as given: an
unmatched trade is dropped identically in morning's `parseLabourCount`/
`morning_manpower`. Splitting it into two migrations on two RPCs for one
behaviour makes the second depend on someone remembering — recorded
below as the specific failure shape this project already names a standing
rule for.

**e. VERIFIED, NOT ASSUMED: `apply_morning_flow_turn`'s SQL body DOES need
to change for the morning half of §42 — correcting this plan's own earlier
claim.** §15's first draft (this same day) asserted morning's write path
"passes the TS-computed `morning_manpower` JSONB through verbatim, same as
`morning_equipment`... not independently re-verified here" — hedged
correctly, and wrong when checked. Read directly,
`030_morning_flow_attendance.sql`'s live `v_col = 'manpower'` branch
(lines 583-606) is NOT a verbatim pass-through — it reshapes `by_trade`
element-by-element in SQL:
```sql
jsonb_agg(
  jsonb_build_object('trade', t->>'trade', 'count', (t->>'planned_count')::int)
)
```
This explicitly selects exactly two keys (`trade`, `planned_count`,
renamed to `count`) from each TS-provided element and reconstructs a NEW
object from only those two — any additional key the TS parser produces
(a `matched` flag included) is **silently dropped** by this reshape, not
passed through. This is a genuinely different shape from `morning_equipment`'s
write (same file, `v_col = 'equipment'` branch, lines 608+): equipment
writes `EXCLUDED.morning_equipment` against the whole caller-supplied JSONB
object directly, no per-element reconstruction — a true pass-through. **The
same RPC body treats its two JSONB columns differently, and §42 needs the
one that reshapes.** Per this file's own header comment (`030:583-587`),
the reshape exists specifically so the RENAME (`planned_count`→`count`,
`planned_total`→`total`) happens at the RPC boundary rather than in the
shared `parseLabourCount` parser itself — deliberate, because evening's old
Q4a headcount step also called that same parser and depended on its
original field names. **Consequence:** shipping §42's morning half means
editing this `jsonb_build_object` call to also carry a `matched` field
(e.g. `'matched', (t->>'matched')::boolean`), a real change to
`apply_morning_flow_turn`'s LOGIC — trips CLAUDE.md §0(a) on the morning
RPC directly, not only on the rename question. Same signature, no overload
risk (only the JSONB construction inside the body changes) — but a logic
change nonetheless. **Worth noting for whoever builds this, not decided
here:** the reshape's own stated reason (preserve `parseLabourCount`'s
field names for evening's old Q4a) becomes moot once this same migration
deletes evening's old Q4a (§2) — whether the boundary-rename is still worth
keeping once the only remaining caller is morning Q3 is a real question,
not answered by this plan.

**f. DATED CARVE-OUT TO §30, review round (2026-08-31) — recorded as a rule
applied, not a discipline eroded.** Stated as a rule, the way CLAUDE.md
states its own: **a migration may cross flows when the change is
DEFECT-SYMMETRIC — the same bug, in the same shared pattern, present in
both flows independently of anything else being built. A migration may
NOT cross flows for an IMPROVEMENT spotted in one flow while working on
the other — that case stays exactly as separate as §30(a) already
requires.** This carve-out is grounded in the STRONGER of the two
precedents available, deliberately: not analogy to this migration's own
reasoning, but CLAUDE.md's own standing rule, "WHEN A DEFECT IS FIXED
STRUCTURALLY, GREP THE REPOSITORY FOR THE SAME PATTERN BEFORE CLOSING IT"
— born from the `test/morning-flow.test.ts` timeline (a race-condition fix
landing in one file, the identical shape left live in a sibling for eleven
hours until CI caught it on an unrelated PR). Applying §30(a)'s split
mechanically here — evening-only, defer morning — would not honor that
rule, it would DELIBERATELY MANUFACTURE the exact finding that rule exists
to prevent, at flow level instead of file level. Full reasoning below,
predating this carve-out's formal statement:

§30(a) (`design-decisions-beta-feedback.md`,
2026-08-22) split morning and evening into separate migrations specifically
so a bug found in evening's restructuring could never block morning's
already-scoped, simpler change from shipping — "Bundled, a bug found in the
evening half blocks the morning half from shipping." That rule protects
against reopening one flow's shipped code because a DIFFERENT, PARALLEL
improvement was spotted while working on the other flow — evening's
redesign and morning's attendance-first renumbering were two different
changes that happened to ship close together in time, and §30(a) correctly
kept them apart. **§42 is not that shape.** It is not a parallel
improvement noticed in morning while working on evening — it is **the
identical defect, in the identical shared parsing pattern, present in both
flows independently of anything else this migration does.** Deferring
morning here would not preserve §30(a)'s protection; it would recreate the
exact failure this project's own standing rule already names and warns
against — CLAUDE.md's "WHEN A DEFECT IS FIXED STRUCTURALLY, GREP THE
REPOSITORY FOR THE SAME PATTERN BEFORE CLOSING IT" entry, whose own
evidence (`test/morning-flow.test.ts`'s stale race-condition pattern,
fixed in one file and left live in a sibling for eleven hours until CI
caught it) is precisely "a fix solved once, left unfixed everywhere else it
also lives, because closing a fix never asked whether the shape exists
elsewhere." Splitting §42 across two migrations creates the same shape
deliberately, with a name attached to why it's wrong. The exception is
scoped narrowly: it applies because this is the SAME BUG in both flows, not
a license to fold future parallel-but-different morning improvements into
evening's migration going forward.

**g. Change surface, additive, blast radius contained.** The change itself
is additive at the shape level (a `matched` flag, an unmatched bucket) —
no existing field is removed or reinterpreted, so callers reading only the
fields they already read see no behavior change. The surface that widens is
which RPC bodies this migration edits (both, not one) and which existing
test files it touches (§5, re-audited below) — not the blast radius of the
change itself on data already in production.

---

## 16. §43 — the lexicon becomes a Quoco-wide standard, PM-taught (RECORDED, explicit non-goal for THIS migration)

**DECIDED IN PRINCIPLE (Aravind), NOT SCHEDULED, NOT IN SCOPE HERE** — same
posture this project already uses for §31/§32-class entries. Recorded in
full because §42 (§15) is what generates the corpus this depends on, but
**§43(f) is explicit that none of it is scoped into the evening
restructuring**, and this plan follows that instruction to the letter — no
schema design, no migration, no code, below.

**a.** Unmatched tokens (§42) accumulate into a PM-facing surface. The PM
either maps one to an existing canonical trade/type or creates a new
canonical one. The correction IS the training signal — supervised, not a
model guessing unsupervised.

**b. SCOPE: mappings are GLOBAL** — across all Quoco tenants, not
per-tenant, not per-project. Rationale, recorded as given: this makes the
lexicon a standard. Every PM correction improves parsing for every
customer and compounds — the tenth contractor onboards onto a lexicon nine
others have already taught.

**c. TENANT OVERRIDE WINS LOCALLY.** A tenant that disagrees maps the token
themselves and their version takes precedence for them — the standard plus
an escape hatch, so one customer's vocabulary cannot overrule another's.

**d. PROVENANCE ON EVERY MAPPING:** which tenant, which PM, when, and how
many times the token has been seen. This is what makes an attribution
shift auditable, and it is also the corpus itself.

**e. ACCEPTED KNOWINGLY:** a wrong global mapping propagates to every
tenant silently and FORWARD ONLY. Not data loss — raw tokens are always
retained (per §42/§32(a)) and historical rows are never reparsed — but
attribution shifts without anyone acting on it. Consequence, decided:
adding an ALIAS to an existing trade is low-risk and can be a PM action
directly; CREATING A NEW CANONICAL TRADE changes what the efficiency
metric is computed against and needs a review step. The distinction is
stated here as decided; the mechanism (what review, by whom) is explicitly
NOT designed in this record.

**f. STRUCTURAL CONSEQUENCE, named plainly — why this cannot ride with the
evening migration.** The lexicon is a hardcoded TypeScript file today
(`lib/whatsapp/flows/parsers/lexicon.ts` — `TRADE_ALIASES`,
`EQUIPMENT_ALIASES`, `UNIT_ALIASES`, all plain `Record<string,string>`
literals). None of §43(a)-(e) is possible until it moves to data — a
PM-facing mapping UI needs something to read and write, and a hardcoded
source file compiled into the deployed bundle is neither. **That is its own
schema change and its own migration** (a new table, presumably
tenant-scoped with a global-default tier per (b)/(c), plus the read-path
change everywhere `canonicalTrade`/`canonicalEquipment`/`canonicalUnit` are
called today — `labour.ts`, `equipment.ts`, `equipment-hours.ts`,
`quantities.ts`, and by extension every parser this evening migration
touches or creates). **Recorded here as a named prerequisite for whenever
§43 is actually scheduled — deliberately NOT scoped into the evening
restructuring**, per instruction (e). The evening migration's new parsers
(§3, §15) should be written against the CURRENT hardcoded-lexicon
`canonicalTrade`/`canonicalEquipment` functions, unmodified in kind, just
extended with §42's `matched` flag — not against a data-backed lexicon that
does not exist yet.

---

## 17. THE DPR REPORTS, THE READER JUDGES — design philosophy behind Decision 1's shape (recorded 2026-08-31, Aravind)

**Recorded as the reasoning behind the DPR's shape, because "why doesn't
the report just tell us the efficiency" will be asked.** A PM or owner who
has run twenty excavation jobs knows what 13 hours of JCB use should
plausibly yield. Put hours and output side by side — Evening Q4's hours
used next to Evening Q1's work-completed-plus-quantity — and his own
experience does the interpretive work the system does not attempt. No
standard, no benchmark, no computed percentage.

**This is not modesty — it is what avoids being confidently wrong.** A
computed utilisation figure needs a denominator this system does not have
(§13: Decision 1 removes it from the daily record as this migration ships
— the substrate, not a permanent prohibition, per §6/§13's softened
language), applied to trades whose `productivity_standards`
do not exist (§28(r), §32(c)'s own prerequisite list), computed from parsed
data that — absent this session's own §42/§33(a) fixes — carries no
confidence signal distinguishing a clean parse from a guess. **Every one of
those three is a place to assert something false with a straight face.**
Two observed numbers, printed side by side with no arithmetic performed on
them, cannot be wrong in that way — they can only be wrong if the
CAPTURE was wrong, which is a different, narrower failure to defend against.

**What this demands in return, stated as an obligation, not a nicety: the
numbers must be right.** Mental math performed by a PM or owner on wrong
inputs produces false alarms — an efficiency judgment made in someone's
head off a fabricated `daily_hire_cost` or a silently-dropped trade is just
as wrong as a computed percentage would have been, with the added cost that
nobody built a safeguard for it because the system never claimed to be
computing anything. And a PM who is burned by a false alarm on Monday
stops trusting Thursday's real one — three correct days don't recover the
credibility one wrong day spends. **Record plainly what this decision
actually asks of the rest of this migration: §42's unmatched-token capture
(§15) and §33(a)'s count-not-rate fix are not in service of a metric —
there is no metric left in this design for them to feed. They are in
service of THE READER'S TRUST IN THE RAW NUMBERS THEMSELVES**, which is the
entire load-bearing surface once the system stops computing anything on
the reader's behalf.

**BOUNDARY CONDITION, review round (2026-08-31) — named so this principle
is not overclaimed.** The argument above assumes an EXPERT reader: a PM who
has personally run twenty excavation jobs and can convert "13 hours" into
an expectation without help. Per CLAUDE.md §1/§5, the OWNER receives this
same report (WhatsApp + email) and is not guaranteed to have that
experience — an owner may have no independent basis for judging whether 13
JCB-hours against a given output is good, bad, or unremarkable. **This
design survives that gap only because the product's claim is FAITHFUL
REPORTING, not judgment.** The system promises an honest record of what was
captured; it does not promise that every reader can interpret it usefully.
An owner who cannot make sense of raw hours-and-output is experiencing a
limit of the report's USEFULNESS to them, not a false or misleading claim
made TO them — the two are different failures, and only the second is what
§17's design is actually built to avoid. Stated plainly rather than left
implicit: this section's reasoning is strongest for the PM and weaker,
honestly, for an inexperienced owner — the report is still truthful for
that reader, just not necessarily illuminating.

---

## 18. THE WEEKLY REPORT AS ERROR-DETECTOR — AND ITS LIMIT (recorded 2026-08-31, Aravind's mechanism)

**The mechanism, as given.** A single wrong day is invisible — one bad
number sitting alone in a daily report has nothing to look wrong against.
A WEEK of accumulated output set against a week of hours makes an outlier
stand out to a PM reading it, the same way any anomaly-against-a-baseline
detection works. The PM correcting that outlier is the same correction
signal §43 (§16) already designs the lexicon-teaching loop around — one
mechanism serves both jobs, catching the day AND training the vocabulary,
when it works.

**Record the limit plainly, because "the weekly report will catch it" is
exactly the sentence that later defers a fix it structurally cannot
perform.** A week-over-week comparison catches **INCONSISTENT** errors —
one day's number that doesn't look like the others. It does **NOT** catch
**SYSTEMATIC** errors — an error that is wrong the same way every single
day, and therefore produces a perfectly smooth, internally-consistent week
with nothing in it that stands out as an outlier to anyone. **Both defects
this project found this week are systematic, not inconsistent, and would
have sailed through seven days of weekly review untouched:**
- `daily_hire_cost: 2` on every "2 JCB" reply (§33's own origin) — wrong
  the identical way on every single occurrence, because the parser rule
  producing it never varies. Seven days of "2 JCB" all produce the same
  wrong number; nothing in that week looks like an anomaly.
- Unmatched trades dropped silently on every occurrence (§42's own origin,
  `docs/reviews/field-samples.md` sample 1) — the SAME token ("PEB",
  "Civil") vanishes from `by_trade` the same way every time it appears,
  producing a total that always reconciles internally (because the total
  was computed before the drop) and a week that never flags itself.

**Conclusion, stated as the division of labour it actually is:** the
weekly report catches NOISY errors — the day that doesn't match its own
week. §42 and §33(a) catch QUIET errors — the day that matches every other
day, because the mechanism producing the error never varies. These are
different jobs, and neither substitutes for the other. A design that relies
on the weekly report to eventually surface a systematic parsing defect is
relying on a detector that is structurally blind to exactly that class of
defect — not slow to catch it, incapable of it.
