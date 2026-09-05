# design-decisions-beta-feedback.md audit — Batch 3 (§21–§30)

Same method as batches 1–2. §23/§24 were pre-checked before this batch,
per instruction, to answer whether the document ever catches up with its
own 2026-08-14 pipeline pivot on its own — see "§23/§24" below; short
answer, no.

| # | Section | Self-label | Verified status | Evidence |
|---|---|---|---|---|
| 21 | Impersonal narrative (no named individuals) | DECIDED | **Live and correct** — carried into the current generator | `ENGINEER_SYSTEM_PROMPT` (generate.ts:405): *"Never attribute anything to a named person, crew, or contractor"*, verbatim equivalent of §21's rule |
| 22 | Blank field's cause, not just presence | Finding, partly solved | **Generalizes to the live path, not independently re-checked this pass** | causes 1–3 map onto `CapturedText`/`CapturedNumber`'s existing not_captured/suppressed distinctions in the live schema too; cause 4 (raw-text forensics) not re-verified per-field this batch |
| 23 | Rejected: one-engineer-per-project restriction | Rejected, recorded | **Confirmed rejected, never enforced** — matches: no engineer-count cap anywhere in schema/RPC/dashboard | — |
| 24 | Per-engineer reporting replaces §12 suppression | APPROVED IN DESIGN, DEFERRED IN BUILD, gated | **A different "per-engineer" than the real 2026-08-14 pivot** — see note below | gate gate condition ("first two-engineer project") still unmet; not built, correctly so |
| 25 | Templates vs. production sender, two separate Meta deps | Verified against Meta/Twilio docs | **Not re-verified this pass** — a live external-dependency status question, better answered from `docs/reviews/whatsapp-template-submission-status.md` directly than re-derived here | — |
| 26 | Auth decisions (WhatsApp OTP, sliding session) | Recorded only, not built | **Confirmed still not built** | zero OTP-related code anywhere in `lib/`/`app/api/`; CLAUDE.md §3 still says magic-link only |
| 27 | PP2 — cron-triggered check-ins, inbound-start is scaffolding | Decided, not built (at the time) | **Confirmed BUILT since** — matches Batch 1's own finding | `routeInboundMessage`'s no-session branch returns static acknowledgements today, not a flow start — retired exactly as this section describes, per CLAUDE.md's own "RETIRED, 2026-08-28" note |
| 28 | Seven follow-on decisions to §27 | DECIDED, not built (2026-08-21) | **Mixed — see (d) and (f) below** | — |
| 29 | Pass 1 outbound send primitive, five decisions | DECIDED, not built | **Confirmed still not built**, consistent with own label; no code contradicts any of the five | — |
| 30 | Flow migration re-scope, nine decisions | DECIDED, not built (2026-08-22) | **Mixed — (b)/(c) built, (e) still open** | — |

## §23/§24 — checked first, per instruction: a false lead, not the reconciliation

§23 (rejects a one-engineer-per-project restriction) and §24 ("per-engineer
reporting replaces §12 suppression") are both dated 2026-08-11 — **two days
before** `docs/dpr-engineer-report-spec.md`'s "Deferred decisions" section
(2026-08-13) and **three days before** the actual `dispatch.ts` rewire
(2026-08-14). §24's "per-engineer reporting" means something narrower and
different: showing per-engineer *attribution within one project-level
report* on a multi-engineer day, explicitly gated on "the first project
with two active engineers" — a gate still unmet (zero such projects,
confirmed again this batch). It is not the same decision as replacing the
project-level report with one-report-per-engineer entirely, and it does not
mention or anticipate that change. As reported before batch 2's disposition
fix: the only place the actual pivot gets mentioned anywhere in this
document is an incidental aside in §38, two weeks later. §23/§24 are not
that reconciliation.

## Finding G — §28(d) already confirms Batch 1's Finding C, five weeks ago, uncross-referenced

§28(d) (2026-08-21) states plainly: *"§1's own decision... 'DECISION:
Option A (hierarchy handoff)' is DEFERRED, not built... recorded explicitly
so it isn't assumed built: 'No' currently terminates the flow with no
hierarchy handoff."* This is the exact gap Batch 1's Finding C found by
reading the code fresh — except it was already known and written down here,
five weeks before this audit. The problem isn't that Finding C was
undocumented; it's that §1 itself carries no forward pointer to §28(d), so
a reader who stops at §1 (as this audit initially did, before reading this
far) has no way to know the gap was already reconfirmed later. Correction
to Batch 1: Finding C's live-gap claim stands, but "silently unbuilt" should
read "unbuilt, and already reconfirmed once, just not cross-referenced from
where a reader would first look."

## Finding H — §28(f)'s decision was never implemented; live equipment rendering still risks the exact incident it names

§28(f) (2026-08-21) decides: an equipment item with no lexicon match
should render **as entered** (raw text), not through `equipmentLabel()`'s
humanized fallback — citing that night's own real incident: "Cement micsur
1000" (a concrete mixer) stored as `type: "cement"` and rendered as
"Cement, ₹1000/day," a fabricated-looking equipment name.

Verified directly against the current live path: `lib/whatsapp/flows/
parsers/equipment.ts:77` still computes `type = keyword ?? firstNameWord ??
'equipment'` — the exact same match-or-raw-fallback shape the incident
came from — and `EquipmentItem` carries no `matched` flag distinguishing
the two cases (unlike the newer idle-hours/equipment-hours parsers built
for migration 035, which do). `assemble.ts:640` calls
`equipmentLabel(morningItem.type)` unconditionally — there is no branch
anywhere that would render `morningItem.raw` (which does exist on the
type, confirmed) instead. §28(f)'s decision was never carried into code.

This is the same defect **class** as Finding A (§9, Batch 1) and the
matched-flag gap flagged for PR C4 tonight — an unrecognized token
rendering with full, unflagged confidence — just on the morning-equipment
side, decided earlier (2026-08-21), and never built at all rather than
built-then-regressed. Recommend folding this into PR C4's scope or a
direct follow-on: same fix shape (surface the low-confidence signal instead
of silently humanizing a guess), same root incident this project has
already paid for once.

## Finding I — §30(e) names the actual blocker for both §1 and §28(f), and it's still true today

§30(e) (2026-08-22) explicitly connects Finding G and Finding H: both §1's
PM handoff and §28(f)'s "the PM can correct a wrong equipment name" plan
depend on the same missing piece — a PM-facing daily-log edit UI, built on
migration 019's `correct_daily_log` RPC, which it states "has existed with
zero frontend callers since 2026-08."

Checked whether this is still true, two weeks later: **partially closed,
still blocked**. `app/(dashboard)/daily-logs/actions.ts` now wraps the RPC
in a real Server Action (`correctDailyLogField`) — this didn't exist when
§30(e) was written. But a repo-wide grep for that action's own name finds
exactly one occurrence: its own definition. No page or component in
`app/(dashboard)/daily-logs/` (or anywhere else) calls it. The plumbing
exists; the UI still doesn't. Same shape as this audit's other
plumbing-without-a-caller findings (§3's escalation sweep, §2's engineer-
management UI) — worth noting as a fourth instance of that specific pattern,
distinct from the "migration reversed a decision" pattern this audit is
also tracking.

## §28(c)/§30(b) — confirmed built, a clean result

Attendance-as-Q1 (§28(c)'s question-order decision, §30(b)'s full
present/holiday/absent branching) is live: `lib/whatsapp/flows/morning.ts`'s
own header comment states the exact shape decided — Q1 attendance, Q1b
holiday follow-up — matching migration 030's known attendance rebuild.
Worth recording as a clean case alongside the gaps: not everything this
batch touched is stale or unbuilt.

## Standing-rule case, per your reframing

Per your correction after Finding A/§14/§15 (Batch 1/2): the rule isn't
"decisions go stale," it's that **a single restructuring migration can
invalidate several unrelated decisions at once, and the migration's own
author has no reason to be reading the decisions file** — so the rule
should attach to the migration (same shape as the consumer-check rule
added tonight), not to the document. This batch adds a fourth *pipeline-
swap*-class instance (§28/§30's own attendance/equipment/PM-handoff web,
tangled together, none cross-referenced from §1 itself) and confirms the
running tally is now at minimum: §9, §14, §15 (all migration 035), plus
the seven-section 2026-08-14 dispatch.ts pivot, plus §28(d)/§28(f)/§30(e)'s
own tangle (migration/build-sequencing decisions from 2026-08-21/22, still
only partly built, cross-referenced to each other but not backward to §1).
Still collecting — batch 4 next.

## Batch 4 preview

§31–41 last. Given tonight's own build touched migration 035 directly
(evening restructuring) and the recent PRs (C1/C2/C3-parked) all sit right
at the edge of this section range chronologically, expect the highest
density yet of "does the document match what actually shipped tonight."
