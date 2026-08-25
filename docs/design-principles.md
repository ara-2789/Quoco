0. CORE THESIS
The burden of structure never falls on the site engineer. The engineer gives raw reality in the easiest possible way; Quoco (parsers, DPR generation, PM corrections) converts it into structure. Any time a design makes the engineer's input "cleaner," that work moves up the chain instead — to the PM surface or into system logic.
Corollary: the six-question ceiling is a design law, not a preference. Any new capture must replace or piggyback, never append. Engineer-burden feature requests get rerouted to PM-side or system-side capture (the weather-API decision is the template).
 
1. PERSONAS & ACCESS MODEL
Canonical persona names — use these EVERYWHERE (design docs, product copy, code, schema). The WhatsApp field persona is "Site Engineer" (matches role='engineer' in the schema and all existing docs). The earlier draft's "Contract Developer (CW)" is retired; persona-name drift is the client → owner problem again — do not reintroduce it.
Persona    Surface    Comfort    Core need    Default view
CEO / Owner    Push delivery (WhatsApp + email DPR); web view later, optional    Low    "Is everything okay? Who do I talk to?"    The DPR itself. No app view in Phase 1.
Project Manager    Web dashboard, mobile-responsive    Medium    "What's blocking me, what does today cost, what needs my action?"    Exception-first operational dashboard per project
Site Engineer    WhatsApp ONLY    Very low / none    "Tell me what to answer, let me answer fast"    No UI at all — conversational only
Rule 1.1 — Persona-scoped modules, not role-gated screens. Each persona gets a different information architecture, not the same screens with buttons hidden. A PM's Daily Logs module and the Owner's DPR are different products sharing one data source.
Rule 1.2 — Cost note (solo-builder constraint). The cheapest way to honor "distinct CEO view" in Phase 1 is to not build a CEO app view at all. The DPR IS the CEO view. Owner web surface stays push-only for as long as possible; when it ships, it is magic-link, zero-configuration, zero-password.
 
2. CORE UX PRINCIPLES (all non-engineer surfaces)
1.    Plain language over system language. "Who hasn't checked in today," never "Pending check-in records (status = null)." No jargon or technical error codes surfaced to Owner/PM. UI copy at ~6th-grade reading level; bot copy shorter still.
2.    One primary action per screen. Exactly one obvious next step; secondary actions are de-emphasized text links, never competing buttons.
3.    Status over data. Lead with red/amber/green + one-line summary; numbers and tables are one tap away, never the first thing shown.
4.    Zero training assumption. If a first-time user can't understand the screen without explanation, the screen has failed.
5.    Trust chain visible. Every DPR line and dashboard metric traceable to who said it and when ("as reported by Rajesh, 6:42 PM"). Quoco is honest plumbing, not an opinion.
6.    Degrade gracefully, visibly. Every failure state (no data, parse failure, delivery failure) has a designed message per persona. No persona ever sees a raw error or an unexplained gap.
 
3. SITE ENGINEER — WhatsApp CONVERSATION RULES
Highest-stakes surface: the only entry point for field truth, competing with the engineer's actual job for attention. Context: one thumb, sun glare, Tamil/English mix, terse replies without quantities, ~30 seconds of patience.
Rule 3.1 — Structured prompts as default; typed numbers are the primary path, buttons the enhancement. Closed questions use numbered options ("Reply 1 for JCB, 2 for Mixer, 3 for Crane"). WhatsApp quick-reply buttons / list messages MAY be layered on where the session window and template rules allow — but every buttoned question MUST also accept a typed number, because:
•    buttons have hard limits (3 quick replies, 10 list rows),
•    the sandbox cannot test interactive types (production sender only),
•    engineers on old phones / poor connectivity / late replies will type. Free text is reserved for the CONTENT of an answer (describing a blocker), never for routing or classification.
Rule 3.2 — One question per message, always. A two-part question is two messages (Q4 headcount/productivity is the existing template). Hard rule for every future flow.
Rule 3.3 — Two fixed daily touchpoints, time-boxed. Morning + evening check-ins at fixed IST times. Target: morning flow ≤ 90 seconds end-to-end. Instrument completion time; a creeping median is a P1 product bug.
Rule 3.4 — Accept the terse answer, echo the interpretation. "8 mason 12 helper" → "✓ Masons: 8, Helpers: 12. Next question…" Confirmation by silence, correction by exception. Never force a "yes" to proceed — that doubles his message count.
Rule 3.5 — Never punish, never dead-end. Unparseable reply → show one example, re-ask ONCE, then accept whatever comes and flag it low-confidence for PM review. The engineer must never feel he failed a question.
Rule 3.6 — Progress visibility. "Question 3 of 6" in every prompt. Resume messages state what's LEFT ("2 more questions to finish"), not what's done.
Rule 3.7 — Ad-hoc flows: one keyword, immediate intent confirmation. "SAFETY" → "Reporting a safety incident — correct?" A stray word never traps him in the wrong flow. Mid-flow interruptions queue silently via pending_flows — the engineer never sees flow machinery. Context (project, module) is attached automatically from his assignment; if he's on multiple projects, ask once, briefly — never a menu tree.
Rule 3.8 — Always acknowledge, always close the loop. Every inbound gets an immediate acknowledgment; every completed flow gets a one-line closure ("Morning check-in done. Have a good day.").
Rule 3.9 — Media-first for expenses/invoices. (FAST-FOLLOW) Photo is the primary action; the bot extracts amount/date/vendor and asks for confirmation. Never require typed data entry where a photo will do. Recorded now so the principle shapes the OCR flow when it ships — does NOT pull invoice work into the Spine.
Rule 3.10 — Correction window. (SCOPED FEATURE, not free copy) "Reply CORRECT to fix your last answer" requires a step-back transition in the session state machine. It pairs naturally with Rule 3.4's confirm-by-silence. Scope it deliberately into a Morning Flow pass (candidate: Pass 3 alongside the multi-item follow-up pattern) — do not assume it exists until the state machine supports it.
Rule 3.11 — Language. Bot output — questions AND confirmations — stays SIMPLE ENGLISH ONLY (revised, see dated correction below). Input accepts any language: English, Tamil, or a mix, with no penalty and no gate. Meet the reply language on the input side; do not demand a preference on the output side. Per-user bot language configurability remains the long-term adoption lever, PHASE 2, gated on `docs/language-observation-plan.md`'s inbound-script telemetry actually showing demand for it, not built ahead of that evidence.

~~Bot questions stay English (template constraint); confirmations MAY echo the engineer's reply language (Tamil/Hindi phrases).~~ DATED CORRECTION (2026-08-20, Y-round template redesign, revised AA2 same day — the first version of this correction gave the right conclusion for an insufficient reason and was itself corrected): the struck clause conflicts with echo-back staying English. The reason is not that a newer instruction overrides an older rule — that is a timestamp, not an argument, and does not survive anyone asking why. **The actual argument: the echo-back confirms what goes into the REPORT, and the report is English.** A Tamil echo-back would confirm an INTERMEDIATE representation — something that still has to be translated again before it reaches the report — and that second translation is exactly where a misreading hides, after the engineer has already approved the (Tamil) echo as correct. Echoing in English means he approves the artifact itself, not a stand-in for it that a later step could still get wrong unreviewed. The obvious objection — that a comprehension check belongs in the language the reader is most confident in — does not apply here, because Rule 3.12's whole design rests on simple English being something he can already read; the echo-back doesn't need a comprehension accommodation the rest of the flow doesn't also need.

Rule 3.12 — Simple-English output rules, tiered by audience. Every engineer-facing string in the flow — not just the 13 submitted templates (`docs/whatsapp-templates.md`) — follows these: (1) short sentences, one idea each; (2) the question goes last; (3) the SAME WORD for the same thing, every time — never vary for style, since varying vocabulary is good English prose and bad L2 communication; (4) no idioms, no phrasal verbs where a plain verb exists; (5) concrete over abstract; (6) numbers as digits; (7) cut politeness scaffolding that carries no meaning. Register is TIERED, not flattened uniformly: engineer-facing strings (morning/evening flow questions, templates 1–4/8) take the strictest simplification; PM- and owner-facing strings (templates 5/6/9/10/11/12, dashboard copy, the DPR itself) can carry more structure — do not flatten PM copy to the point of curtness, which reads as unprofessional to the audience actually paying for the product.

AUDIT AGAINST RULE 3.12 (2026-08-20, Y3 — read directly from `lib/whatsapp/flows/morning.ts`
and `evening.ts`, the single source both the pure mirror and the webhook render from — a
rewrite candidate list, not rewrites made in this pass).

**INDICES CORRECTED (2026-08-25):** written against the pre-migration-030 numbering
(plan=Q1, workers=Q2, equipment=Q3). `030_morning_flow_attendance.sql` renumbered the
flow attendance-first — the critiques below are still substantively valid (the quoted
text is unchanged where quoted), only the index each one points at was wrong. Corrected
in place, not struck through, since these are pointer corrections, not a changed
analysis:
- `MORNING_QUESTIONS[2]` ("What's your *plan of action* for today?") — violates rule 3:
  `daily_logs.morning_plan` is referred to as "plan" everywhere else (the DB column, this
  audit, template 2's `{{3}}`); "plan of action" is a second word for the same concept.
  Rewrite candidate: "What's your plan for today?"
- `MORNING_QUESTIONS[3]` (workers) and `MORNING_QUESTIONS[4]` (equipment) — both violate
  rule 2: the question comes FIRST, followed by the instruction/example, not last. Rewrite
  candidate for Q3: "You can send a number, or a breakdown like '12 mason 8 helper'. How
  many workers today?"
- `MORNING_QUESTIONS[4]` — "equipment / machinery" offers two words for one thing in the
  same sentence (violates rule 3's spirit even though the DB column is `morning_equipment`
  and neither word is wrong on its own) — pick one. Rewrite candidate: "Any equipment on
  site?"
- `MORNING_QUESTIONS[4]` — "Got it." is politeness scaffolding carrying no information
  (violates rule 7). "How will the work be carried out" is passive-voice and wordier than
  needed (violates rule 4's spirit). "execution method / sequence" repeats Q3's
  two-words-for-one-thing pattern AND is abstract (violates rules 3 and 5). Rewrite
  candidate: "What are your steps for the work today?" — deliberately avoiding "plan"
  (already Q1's word) per rule 3.
- `EVENING_QUESTIONS[1]` (work completed) — same rule-2 shape as morning Q2/Q3: question
  first, example second. Otherwise clean — concrete, short.
- `EVENING_QUESTIONS[2]` ("Did you *meet today's plan*? Reply *yes* or *no*.") — clean
  against all seven rules; the reference model for the rest of this list.
- `EVENING_QUESTIONS[3]` — "Got it." repeats the same scaffolding issue as morning Q4.
- `EVENING_QUESTIONS[5]` (productive/idle) — the longest question in either flow, two
  examples chained with "or"; borderline on rule 1 (one idea each) but the two examples
  are genuinely two different valid answer shapes, not two ideas, so likely acceptable as
  written — flagged for a second read, not confidently a rewrite candidate.
- `MORNING_COMPLETE_REPLY` ("Have a productive day on site!") — "productive" is a
  moderately abstract word for a closing well-wish; low priority, minor.
- Every reask/reply pair between `morning.ts` and `evening.ts` already shares vocabulary
  correctly where it matters most (both flows use "check-in complete", "already sent
  today's ... check-in", "Nothing more needed" verbatim) — rule 3 is already well-observed
  ACROSS the two files, the violations found are all WITHIN a single question's own
  wording, not drift between flows.
Decision on whether to implement these rewrites is Aravind's — this is the audit Y3 asked
for, not an authorization to edit `morning.ts`/`evening.ts` in this pass.

MIXED-LANGUAGE INPUT — VERIFIED, NOT ASSUMED (Y4, 2026-08-20). Real test cases run through
the actual parser functions (`lib/whatsapp/flows/parsers/*.ts`), not reasoned about from
reading the code:

```
50 cubic meter concrete போட்டோம், shuttering pending
2 nos slab ready. labour 18 வந்திருக்காங்க
today rain, no work
```

(a) EXTRACTION. All three ran cleanly through every parser tested (quantities, labour,
equipment, yes/no) — zero crashes, zero exceptions, `raw_text` preserved verbatim in every
case (the one guarantee that actually matters: nothing is ever lost even when nothing is
understood). Findings, all found to be PRE-EXISTING and LANGUAGE-INDEPENDENT, not new
Tamil-specific defects:
  - `splitDigitBoundaries`'s digit/non-digit boundary regex treats Tamil-script characters
    exactly like English letters (both are `\D`), so a number embedded in Tamil script
    tokenises the same way "50sqm" already does in pure English — no special handling
    needed, none is missing.
  - Unrecognised words (Tamil script, or an unrecognised English word — same code path)
    fold into the `activity`/`type` field as raw text rather than being dropped or
    crashing — this reproduces the ALREADY-DOCUMENTED "Job 15oo" equipment-garbling class
    (CLAUDE.md's EQUIPMENT `daily_hire_cost` entry) with a Tamil word standing in for the
    unrecognised English one; confirms that bug's root cause is genuinely language-blind,
    not English-specific as it might have read before this test.
  - Case 2's second number ("18", after "2 nos" already claimed the quantity slot) was
    correctly DISCARDED-AND-FLAGGED (`numbers_discarded: true`), the same behaviour
    `quantities.ts`'s own doc comment already describes for "Poured 40 cum M25 slab
    level3" — again the identical mechanism, not something new.
  - One genuinely new, English-side finding, surfaced ONLY by testing "today rain, no
    work" as a mixed-language robustness check: `quantities.ts`'s `QUANTITY_STOPWORDS`
    spreads `Object.keys(UNIT_ALIASES)`, which includes `no` as the unit abbreviation for
    "nos" — so the word "no" (negation) is silently swallowed as a stopword in Q1's
    activity extraction, collapsing "no work" to nothing.
    **RE-RATED MODERATE, revised up from an initial LOW (AA3, same day) — traced through
    the live rendering path rather than reasoned about, and the mitigating half of the
    original rating survives, the dismissive half doesn't.** What still holds: "today
    rain, no work" is not an edge case — it's the most common no-work reply on an Indian
    site and monsoon makes it seasonal-frequent; "nos" genuinely means numbers in
    construction usage ("2 nos slab"), so the collision is real vocabulary overlap, not a
    theoretical corner case, and cannot be fixed by deleting "no" from the stopword list
    without checking what real "2 no slab"-style answers that would break; `raw_text` (and
    the RENDERED report's own `done_text`, confirmed by reading `assemble.ts:539` — it
    sources from `row.evening_output` verbatim, never the parsed activity string) DOES
    survive intact, so the free-text half of what a reader sees is never corrupted. What
    changes the rating: `render.ts:624-628` renders `done_text` and the PARSED
    `done_quantity`/`unit` on the SAME line — `${done_text} — ${quantity}${unit}`. If "no"
    sits adjacent to (or shares a chunk with) a real quantity, the swallowed "no" can shift
    which chunk claims the quantity slot, producing a rendered line where the verbatim
    text says one thing and the number printed right beside it belongs to a different
    chunk — the system's own structured view disagreeing with the text next to it, on the
    same line, in the shipped report. This is exactly the failure §7's containment check
    cannot catch: containment only verifies a digit is traceable to SOME Fact value
    (`buildExecutionCorpus`, `containment.ts`), never that the digit's MEANING matches the
    prose beside it — a real chunk's real quantity, misattributed, passes containment
    trivially. CONFIRMED UNAFFECTED, checked not assumed: `evening_schedule_met` (the
    plan-met status) is a fully separate field using `classifyYesNo`'s own vocabulary
    (`lexicon.ts`), never touching `QUANTITY_STOPWORDS` — the earlier test's own result
    (`{met:false, ok:true}` for this exact string) already confirmed this path is sound;
    this bug does not extend to schedule-level status determination, only to Q1's
    quantity/unit pairing specifically. **Fix approach, not implemented:** distinguishing
    "no" the negation from "no" the unit needs POSITIONAL CONTEXT, not a wordlist edit — a
    unit-sense "no" is adjacent to a digit token ("2 no", "no 2"); a negation-sense "no" is
    not. The fix belongs in `parseChunk`'s own tokenising loop (check adjacency before
    treating "no" as a unit alias), not in `QUANTITY_STOPWORDS`'s membership set, which has
    no concept of position.
(b) NUMERALS — decided, stated, not left an accident: only ASCII digits (`\d`) are
  recognised as numbers anywhere in `labour.ts`/`quantities.ts`/`equipment.ts`. Tamil
  numeral GLYPHS (௫௦) and Tamil (or English — "two", "ten") number WORDS are both
  IGNORED identically — folded into the unrecognised-token path, never parsed as a
  quantity. This is symmetric with English word-numbers, already unparsed today, not a
  new Tamil-specific gap.
(c) ECHO-BACK — confirmed correct per Rule 3.11's revision above; not re-litigated here.
(d) CONTAINMENT — `lib/dpr/containment.ts`'s `DIGIT_TOKEN` regex (`/\d[\d,]*(\.\d+)?/g`)
  matches ASCII digit runs ONLY, with zero sensitivity to surrounding script — the check
  is `Set<number>` membership on extracted values, never token-in-context matching, so a
  Tamil sentence and an English sentence carrying the same digit produce identical
  extraction and identical containment behaviour. **Confirmed language-independent by
  construction**, not merely by absence of a counter-example.
 
4. PROJECT MANAGER — DASHBOARD RULES
The PM's behavior determines whether the system gets fed. The dashboard's job: show what needs attention, in order.
Rule 4.1 — Home screen = exceptions, not data. Missing check-ins, failed opt-ins, low-confidence parses, unresolved items — a triage queue, not charts. If everything is fine, say so in one line. A PM knows within 10 seconds whether today needs action.
Rule 4.2 — Every alert carries its action. "Rajesh hasn't opted in — [Resend invite] [Call]." No read-only alerts anywhere on the PM surface.
Rule 4.3 — PM is a data steward, not data entry. The PM corrects and completes (fix a parsed trade name, fill a skipped gap) — never re-types the day. Correction UI is inline on the daily log card, two clicks max.
Rule 4.4 — Setup flows are wizards with visible completeness. Engineer registration shows its pipeline state ("Added ✓ → Opt-in pending → Receiving check-ins"). External blockers are named statuses ("Templates awaiting Meta approval"), never mysteries.
Rule 4.5 — Daily Logs mirror the site's mental model. One card per engineer per day, morning/evening halves. Missing halves highlighted AMBER, not red — absence has legitimate reasons (holiday, messaging_blocked), and the UI must encode the same fairness the DPR accountability logic does.
Rule 4.6 — Mobile-first responsive. Assume the dashboard is used at 6:45 PM on a phone as often as at a desk.
 
5. CEO / OWNER — REPORT & VIEW RULES
Rule 5.1 — Push, not pull. The owner never opens anything to know how the day went. DPR delivered automatically (WhatsApp + email) at day's end.
Rule 5.2 — Decisions first, detail second. Report order: (1) anything needing owner attention today, (2) key drivers at a glance (cost, progress, utilization), (3) flagged gaps with the accountable input named, (4) full detail behind a tap, never shown by default. The first three lines must stand alone: money lost (idle ₹), schedule status, today's headline output.
Rule 5.3 — Name the gap, never characterize the person. (Resolves the 5.3-vs-punitive-framing tension.) The report names WHOSE INPUT is missing, factually, with legitimate absences excluded BEFORE the name ever appears: holiday days and messaging_blocked days are removed from both numerator and denominator of any pattern. Template wording: "Rajesh — evening not submitted today (missed 3 of last 5 site-operating days)." Never red-banner shaming, never adjectives, never a name the exclusion logic hasn't already filtered.
Rule 5.4 — Rupees over percentages. "₹4,500 lost to idle JCB" lands; "62% utilisation" doesn't. Convert everything convertible to money or days.
Rule 5.5 — Trends over snapshots in any future owner web view: 7-day trajectory (schedule variance, cost leak, submission reliability) is the default, single-day numbers are the drill-down. (Applies when the owner web surface ships — see Rule 1.2.)
Rule 5.6 — Nothing empty, nothing stale, zero required interaction. DPR-17/24 generalized: the owner never receives a blank or silently outdated artifact; silence is always explained ("site closed today"). The owner never logs in, configures, or replies for core value to flow.
 
6. VISUAL DESIGN SYSTEM
Element    Rule
Color    4-color semantic system only: Red (blocked/missing-critical), Amber (at-risk / legitimate-gap), Green (on-track), Blue (informational). No decorative color in status contexts.
Typography    Max 3 sizes per screen (heading, body, caption), max 2 weights. Short lines and status rows, never dense paragraphs.
Iconography    One icon set across all surfaces. Icons ALWAYS paired with a text label — never icon-only.
Components    Status chips/badges are the primary UI atom for dashboards. Tables and detail views exist only behind a drill-down.
Empty states    Every empty list explains what's missing, who/what will populate it, and offers a nudge action.
 
7. DATA & AUTOMATION RULES
Rule 7.1 — Single source of truth per data type. Check-ins, ad-hoc submissions, and derived metrics each live in one canonical table. All three persona surfaces read from the same source, filtered/aggregated differently — never duplicated or independently entered.
Rule 7.2 — Escalation is time-based and role-aware, never skippable. Missed check-in → nudge (engineer) → escalate to PM at cutoff → flagged gap in the owner's report if unresolved by report time. Phase 1: timing is FIXED (IST trigger times in bot-flows.md). Per-organization configurability of thresholds is PHASE 2 — recorded here so it isn't mistaken for a Spine requirement.
Rule 7.3 — Safety incidents bypass the standard pipeline. Immediate PM notification, never batched into the nightly report cycle. (Flow ships FAST-FOLLOW; the bypass principle is law from day one of that flow.)
Rule 7.4 — Every metric has a path back to its source. No bare number without drill-down to the underlying check-in data (pairs with Rule 2.5, trust chain).
 
8. TRUST, ERROR HANDLING & ACCESSIBILITY
•    Never silently drop a message. Unparseable ad-hoc inbound → the bot says so and offers the explicit flow options; never fail silent or misfile.
•    Owner/PM error states are always actionable. "Report generation failed" is not acceptable. Correct shape: "3 engineers haven't checked in — report sends at 9 PM with current data unless you send now."
•    Fairness is structural. Holiday and blocked days are excluded from accountability math at the SYSTEM level (Rule 5.3), not left to copywriting.
•    Localization per Rule 3.11: meet the engineer's reply language; per-user bot language is the long-term adoption lever (PHASE 2).
 
9. FAILURE MODES — WHAT MAKES THIS SYSTEM FAIL
1.    One PM-style dashboard permission-gated for the CEO instead of a distinct simple (push-first) view.
2.    Treating WhatsApp as a lightweight app instead of the ONLY interface for one persona — over-designing it with menus and jargon.
3.    Free-text-first data entry where structured numbered options would work — the single biggest cause of low field compliance.
4.    Punitive framing of missing inputs (red banners naming individuals) instead of neutral, filtered, actionable gap-flagging (Rule 5.3).
5.    Metrics shown as bare numbers with no path back to underlying check-ins.
6.    CEO report as a data dump instead of a decisions-first summary.
7.    Engineer-burden creep past the six-question ceiling (§0 corollary).
8.    Persona-name drift across docs, copy, and code (§1).
