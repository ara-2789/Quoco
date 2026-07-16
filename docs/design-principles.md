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
Rule 3.11 — Language. Bot questions stay English (template constraint); confirmations MAY echo the engineer's reply language (Tamil/Hindi phrases). Meet the reply language, don't demand one. Per-user bot language configurability is the adoption lever long-term (PHASE 2).
 
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
