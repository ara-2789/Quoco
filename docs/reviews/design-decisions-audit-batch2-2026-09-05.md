# design-decisions-beta-feedback.md audit — Batch 2 (§11–§20)

Same method as Batch 1: every section read in full, verified against the
current codebase, no claim taken from the doc's own label.

**Headline finding, spans most of this batch**: §11, §12, §13, §16, §17,
§18(partial), §19(partial), §20 all describe the **project-level** DPR
pipeline (`mergeDprFacts`, `generateDprJudgment`, `renderDpr`,
`assembleAccountability`) — not the pipeline that actually runs in
production. Confirmed directly: `lib/dpr/dispatch.ts` (the live
`dpr_generate` job handler, called from `app/api/jobs/tick/route.ts`) only
imports the **per-engineer** functions (`assembleEngineerDprFacts`,
`generateEngineerVerdict`, `renderEngineerBody`). Its own header states this
plainly:

> Rewired in place (2026-08-14, plan revision 8 implementation) from the OLD
> project-level handler this same function name and job type used to be...
> The OLD project-level pipeline... is NOT deleted and NOT modified — it
> stays fully intact, exported, and tested... for the deferred project-level
> report (docs/dpr-engineer-report-spec.md's "Deferred decisions" section).

And that spec's own "Deferred decisions" section (dated 2026-08-13, one day
before the rewire) gives the real reason: *"Not being built now. Beta is
single-engineer per project, where none of this arises."* — matching §12's
own prod query in this very document (zero multi-engineer projects, checked
2026-08-09).

**This is not the same failure shape as Finding A/B/C from Batch 1.** Those
were silent — no record of the reversal anywhere. This one has a real,
dated, well-reasoned decision, just recorded in a *different* file
(`dpr-engineer-report-spec.md`), with **zero pointer back** from any of the
seven design-decisions-beta-feedback.md sections it makes stale. A reader of
§11–13/§16-20 alone has no way to know they describe a pipeline that stopped
shipping DPRs on 2026-08-14. Same missing-cross-reference problem as §7/§9 in
Batch 1, at a much larger scale.

| # | Section | Self-label | Verified status | Evidence |
|---|---|---|---|---|
| 11 | DPR section 5 (no 7th question) | DECIDED | **Stale — describes the deferred project-level pipeline** | `dispatch.ts` header; `dpr-engineer-report-spec.md` |
| 12 | DPR rollup/suppression rule | DECIDED | **Stale — same reason** | same |
| 13 | Accountability §6 | DECIDED | **Stale — `assembleAccountability` explicitly named as deferred** | `dispatch.ts:21` |
| 14 | Q5 available_hours question | NOT DECIDED (recorded open) | **Resolved de facto by migration 035** — `available_hours` removed from the flow entirely, not defaulted | see Finding F |
| 15 | Q4b anchor-to-headcount idea | Recorded, not built | **Superseded de facto by 035's redesign** — current idle-hours question doesn't anchor to headcount, asks trade+hours directly instead | see Finding F |
| 16 | equipmentLabel Facts/Judgment boundary | Recorded, not fixed (pipeline didn't exist yet) | **Fixed in the live path** — `assemble.ts:640` calls `equipmentLabel()` directly | good outcome, see below |
| 17 | numbers_discarded not persisted | Recorded, not a bug (at the time) | **Moot** — `evening_productive_manpower.confidence`, the column this is about, no longer exists post-035 | confirmed batch 1 |
| 18 | Containment Reading A (no-digit fields) | DECIDED (c) | **Still live** — `containment.ts` is shared infra, used by `generateEngineerVerdict` too — needs a follow-up confirm against the current `hindrance_note` field, not fully re-verified this pass | `generate.ts` imports `checkContainment` |
| 19 | Containment identifier-digit gap | Recorded, not fixed | **Still live, confirmed still unfixed** — same `checkContainment`, same limitation, still narrow/unobserved as filed | `lib/dpr/containment.ts` unchanged |
| 20 | First generator run cost | Recorded (n=2 data points) | **Describes the dead pipeline's golden cases** — no live-path (per-engineer) cost figure exists anywhere in this document | `case-complete-two-engineer-day.ts` still calls `generateDprJudgment` directly, per its own test |

## Finding F — two more "migration quietly resolved an open question" instances

Same pattern as Batch 1's §9 (the headline finding there), now confirmed
twice more in this batch, both against the same migration (035):

- **§14** (2026-08-10, explicitly recorded "NOT decided") asked whether Q5
  should stop asking for `available_hours` at all, given it rarely varies,
  and named the risk of defaulting it wrong. Migration 035 didn't decide
  between the options this section weighed — it **removed the concept
  entirely**. Confirmed directly against the live question text
  (`lib/whatsapp/flows/evening.ts:159`): *"How many hours was each used
  today?"* — no `available_hours`, no default, nothing. A real third option
  neither §14 nor anyone else recorded choosing.
- **§15** (2026-08-10, "recorded, not built") proposed anchoring the Q4b
  idle-hours prompt to a previously-stated headcount ("Of the 18 on site,
  how many were idle?"). 035's redesign didn't adopt this — the current
  question (`evening.ts:94`) asks trade+hours directly ("Was anyone idle
  today? Tell us which trade and for how long"), sidestepping the original
  headcount-split ambiguity through a different mechanism (per-trade
  attribution instead of a productive/idle split of one number).

Neither section is marked resolved, superseded, or closed. Both describe a
flow shape that migration 035 replaced wholesale five weeks after they were
written.

## Good outcome, worth recording precisely (§16)

§16's own finding — `assemble.ts` copying a raw canonical key
("concrete_mixer") straight into `DprFacts` instead of humanizing it — was
correctly fixed by the time it mattered. Verified: `assemble.ts:640` calls
`equipmentLabel(morningItem.type)` directly when building the live
per-engineer `items` array. Not every stale section in this batch is a
problem: this is what "recorded, not fixed yet, fixed when the actual
consumer was built" is supposed to look like, and it's worth naming as the
positive case alongside the negative ones.

## File-split note, continued from Batch 1

Batch 1 named §8/§9's root cause: nothing forces a revisit when a later
migration overtakes a decision. This batch adds a second, related but
distinct shape — **an entire pipeline swap (7+ sections) that WAS
deliberately decided and recorded, just in a different document, with zero
pointer from the sections it made stale.** Both are the same underlying gap
at different scales: this project's "migration consumer-check" standing
rule (added earlier tonight) catches a changed column's *code* consumers; it
does not catch a changed column or architecture's *decision-text* consumers
— the design-decisions doc itself. Worth naming as its own standing rule at
the end of this audit, per your instruction — now with four supporting
instances (§9, §14, §15, and the seven-section pipeline swap), not one.

## Batch 3 preview

§21–30 next, on approval. §23 (per-engineer reporting, "APPROVED IN DESIGN")
is very likely where the 2026-08-14 pivot this batch found gets its own,
explicit treatment inside design-decisions-beta-feedback.md itself — if so,
that would mean the document DOES eventually catch up with itself, just ~15
sections and several weeks later than the sections it affects, with no
back-reference the other direction either. Checking that directly is first
on the list for batch 3.
