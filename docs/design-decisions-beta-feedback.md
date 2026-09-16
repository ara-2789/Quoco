# Design Decisions — Beta-Customer Feedback (INDEX)

> Product/design decisions and parked items captured from beta-customer feedback
> and schema analysis. **These are DECISIONS and PARKED ITEMS — no implementation
> is authorised by this document.** Nothing here touches migration 007 (auth
> surgery); implementation rides in later migrations/passes as noted per item.
>
> Last updated: 2026-07-28 (§7 ad-hoc flow menu trigger; §8 engineer stream).

---

**SPLIT 2026-09-14 (docs-rescue/split pass) — THIS FILE IS NOW AN INDEX, NOT THE
CONTENT.** At 224,410 chars (87% over the 120,000-char warn threshold —
CLAUDE.md's own "FILE SIZE LIMITS" rule), the file was split by theme into five
files under `docs/design-decisions/`. **Every section's number is UNCHANGED** —
`§6` is still `§6`, `§41` is still `§41`, `§43` is still `§43` — only which
*file* holds it changed. Content moved verbatim: no re-wording, no
condensing, no "tidying." Strike-throughs and dated corrections moved with
their sections intact.

**Why this file stays at this exact path, as an index, instead of being
deleted:** every existing citation across this repo — `CLAUDE.md`, other
docs, code comments, and (unchangeably) applied migration `COMMENT ON
COLUMN`s already live on prod — names `docs/design-decisions-beta-feedback.md
§N`. Deleting or moving this path would turn every one of those into a
dangling reference, the exact failure class `adhoc-menu-spec.md`'s own `§g`
collision (2026-09-06) already produced once from a section letter being
reused while its origin sat unmerged — see that file's own `§g` and `§h` for
the full incident. A reader arriving here from any old citation finds the
right file below, every time, with no guessing.

## Where each section now lives

| § | Subject | File |
|---|---|---|
| 1 | Absence handling — "Are you on site today?" → No | `check-in-flow-decisions.md` |
| 2 | Engineer number change / departure | `check-in-flow-decisions.md` |
| 3 | Nudges & escalation | `check-in-flow-decisions.md` |
| 4 | Disappearing messages | `check-in-flow-decisions.md` |
| 5 | GPS / photo attendance — PARKED | `check-in-flow-decisions.md` |
| 6 | Weekly work reviews — capture-gap decisions | `parsing-and-data-capture.md` |
| 7 | Ad-hoc flow menu — trigger condition (2026-07-28) | `check-in-flow-decisions.md` |
| 8 | Engineer STREAM (discipline) — CLOSED (2026-07-28) | `check-in-flow-decisions.md` |
| 9 | Evening flow Q4 — v1 scope (2026-07-28) | `check-in-flow-decisions.md` |
| 10 | RESTART SEMANTICS — DECIDED 2026-08-15: refuse-when-submitted | `check-in-flow-decisions.md` |
| 11 | DPR section 5 decision — narrowed to what's derivable, no 7th question | `dpr-generation-and-reporting.md` |
| 12 | DPR rollup rule — DECIDED: suppress narrowly, not by section | `dpr-generation-and-reporting.md` |
| 13 | Accountability (§6) — ship per-day status, suppress the 7-day pattern | `dpr-generation-and-reporting.md` |
| 14 | Does Q5 need to ask for available hours at all? | `dpr-generation-and-reporting.md` |
| 15 | Q4b prompt could anchor to headcount — recorded, not built | `dpr-generation-and-reporting.md` |
| 16 | `assemble.ts` copies raw equipment `type` into DprFacts — a Facts/Judgment issue | `dpr-generation-and-reporting.md` |
| 17 | `numbers_discarded` isn't persisted — a low confidence can't be recovered | `dpr-generation-and-reporting.md` |
| 18 | Containment Reading A resolved as (c): raw text stays prompt input | `dpr-generation-and-reporting.md` |
| 19 | Containment's named limitation: identifier-digit blessing within one message | `dpr-generation-and-reporting.md` |
| 20 | First real generator run: decision (c) cost nothing measurable | `dpr-generation-and-reporting.md` |
| 21 | Impersonal narrative — no named individuals in the DPR (2026-08-11) | `dpr-generation-and-reporting.md` |
| 22 | "What this report does not know" — a blank field's CAUSE, not just its absence | `dpr-generation-and-reporting.md` |
| 23 | Rejected: restricting beta to one engineer per project (2026-08-11) | `dpr-generation-and-reporting.md` |
| 24 | Per-engineer reporting replaces §12 suppression — APPROVED IN DESIGN | `dpr-generation-and-reporting.md` |
| 25 | TEMPLATES and a PRODUCTION SENDER are two separate Meta dependencies | `outbound-infra-and-auth.md` |
| 26 | AUTH DECISIONS — recorded as a SEPARATE workstream, NOT planned or built here (2026-08-15) | `outbound-infra-and-auth.md` |
| 27 | PP2 — check-ins are CRON-TRIGGERED, not inbound-triggered (2026-08-20) | `check-in-architecture-and-triggers.md` |
| 28 | Seven follow-on decisions to §27 (2026-08-21) — DECIDED, not built | `check-in-architecture-and-triggers.md` |
| 29 | Pass 1 outbound send primitive — five decisions (2026-08-22) — DECIDED, not built | `outbound-infra-and-auth.md` |
| 30 | Flow migration re-scope — nine decisions (2026-08-22) — DECIDED, not built | `check-in-architecture-and-triggers.md` |
| 31 | Stable-signature refactor for the flow-turn RPCs (2026-08-23) | `check-in-architecture-and-triggers.md` |
| 32 | Parse-attempt corpus + self-improving parsing prerequisites (2026-08-23) | `parsing-and-data-capture.md` |
| 33 | Equipment captures units, not hire rate — seven decisions (2026-08-25) | `parsing-and-data-capture.md` |
| 34 | `checkin_escalations` cannot distinguish "asked, no answer" from "never asked" — OPEN | `check-in-flow-decisions.md` |
| 35 | Check-in window rules — DECIDED and built, 2026-08-26 | `check-in-flow-decisions.md` |
| 36 | UNIQUE index on `project_members(user_id)` — DECIDED IN PRINCIPLE, NOT SCHEDULED | `outbound-infra-and-auth.md` |
| 37 | Evening delivery gates on evening data, not morning submission — six decisions | `dpr-generation-and-reporting.md` |
| 38 | Inbound-start retirement — the two missing acknowledgement strings, DECIDED | `check-in-architecture-and-triggers.md` |
| 39 | `EVENING_AWAITING_TRIGGER_REPLY` promises a message that will never come | `check-in-architecture-and-triggers.md` |
| 40 | ONE evening template — {{3}}, the morning-plan echo, is REMOVED — supersedes §28(s) | `check-in-architecture-and-triggers.md` |
| 41 | Photos are a first-customer requirement, not a Fast-Follow — DECIDED, not built | `outbound-infra-and-auth.md` |
| 43 | Engineer-side correction of a submitted morning check-in: APPEND, never overwrite | `check-in-flow-decisions.md` |

**No §42** — reserved elsewhere (`docs/plans/evening-flow-restructuring-scope.md`'s
unmatched-parse-token capture rule, migration 035); this file's own §43 entry
explains why it skips §42 deliberately, not by accident.

All five files live under `docs/design-decisions/`:
- `docs/design-decisions/check-in-flow-decisions.md`
- `docs/design-decisions/check-in-architecture-and-triggers.md`
- `docs/design-decisions/dpr-generation-and-reporting.md`
- `docs/design-decisions/parsing-and-data-capture.md`
- `docs/design-decisions/outbound-infra-and-auth.md`
