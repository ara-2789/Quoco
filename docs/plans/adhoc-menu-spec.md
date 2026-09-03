# Ad-hoc menu — spec (docs only, no code, no schema, no migration)

**No spec has ever existed for this.** Decisions are scattered across `design-decisions-
beta-feedback.md` §7 (2026-07-28, trigger condition), §28(x)/(y)/(aa) (2026-08-21, delivery
mechanism, positioning, consequences), §29(b) (2026-08-22, opt-out), §37 (2026-08-27,
evening/inbound-gap context), and §38 (2026-08-28, the two retirement replies). This file
is the first place all of it is assembled against one decided item list and checked
against the actual current code.

**Status: SPEC ONLY. Nothing here is built.** Read alongside `lib/whatsapp/inbound-start.ts`
as it now stands post-retirement (2026-08-28) — every citation to that file below was
checked directly against the real file, not recalled.

---

## The seven items — DECIDED (Aravind, 2026-08-28)

1. **Hindrance** — MERGED with dependency. Active-vs-potential is captured in the ANSWERS,
   not as separate menu items. **Must be a stored FIELD**, not left inside free text — a PM
   filtering "what needs action before tomorrow" has to query it.
2. **Safety incident** — needs interrupt semantics per BOT-19; see §e below.
3. **Site expense** — cash spent on site.
4. **Material received** — delivery challan at the gate, arrives WITH the goods.
5. **Invoice** — the bill for an EARLIER delivery, must be matched back to its challan. 4
   and 5 stay separate deliberately: the reconciliation between them is a real workflow,
   the only item here that is not pure capture.
6. **Site document** — test report, permit, RFI, pour card, MOM.
7. **Stop messages** — §29(b)'s opt-out. Once this ships, it is the ONLY opt-out path that
   will exist in the product — BOT-27's SET-half (a STOP keyword) was retracted, not
   deferred, by §29(a); WhatsApp's own Block is outside the product entirely (invisible,
   irreversible, counts against the sender's own quality rating).

**Explicitly excluded, and why:**
- **Morning DPR / Evening DPR / Update DPR** (from a comparable bot the cofounder runs) —
  all three are inbound STARTING or EDITING a check-in. Retirement removed exactly that
  capability: `lib/whatsapp/inbound-start.ts`'s own header states the cron is now the only
  flow-starter, and correction is a PM function via migration 019's edit RPC
  (§30(e)/`design-principles.md`), never an engineer-initiated one. These three items are
  not "not yet built," they are the specific capability this project spent 2026-08-28
  removing.
- **Attendance** is morning Q1 — already captured, already the flow's own first question,
  not an ad-hoc item.
- **Standalone site photos** are §6's compulsory-photo work (team/site/machinery photos
  attached to the existing morning/evening flow), a different feature with its own
  decided shape, not a menu item.

**Note, not a contradiction:** §28(x)'s own "Initial set" text (2026-08-21) names
"hindrance, dependency, invoice, delivery note, site cash" — five items, dependency listed
separately from hindrance. **Superseded by this entry's own item 1** (merge decided
2026-08-28) and widened to seven total (safety incident and site document added; stop
messages formalised as the seventh, per §29(b)). §28(x) is not wrong, it is the prior,
narrower iteration this spec replaces.

---

## a. Trigger — which replies the menu touches, verified against the actual code

`routeInboundMessage`'s idle branch (no active session) returns exactly **six** distinct
static replies today, not four — checked directly against `lib/whatsapp/inbound-start.ts`
as it stands post-retirement. They fall into two groups:

**Group 1 — "day fully done," pre-dates retirement, unrelated to the two window guards:**
- `REPORT_READY_REPLY` — after `eveningClose` (19:45 IST), any submission state.
- `EVENING_ALREADY_COMPLETE_REPLY` — both morning and evening submitted, any time before
  `eveningClose`.

**Group 2 — the four checkpoint-window replies §38's retirement work actually produced**
(two pre-existing guards, now unconditional; two new acknowledgement strings):
- `MORNING_AWAITING_TRIGGER_REPLY` — before `morningCutoff`, morning not submitted.
- `MORNING_WINDOW_CLOSED_REPLY` — at/after `morningCutoff`, morning not submitted.
- `EVENING_WINDOW_NOT_OPEN_REPLY` — morning submitted, evening not, before `eveningSend`.
- `EVENING_AWAITING_TRIGGER_REPLY` — morning submitted, evening not, at/after `eveningSend`.

**Decision, proposed here for confirmation — "a check-in-window message is not the same
as a menu request" resolved as:**

- **Group 1 is REPLACED by the menu.** Both replies mean literally nothing else is pending
  for the day — exactly §28(x)'s own framing, "whenever he opens the thread outside a
  check-in." There is nothing these two replies say that a menu doesn't say better; showing
  the menu here is the uncontested case.
- **Group 2 SURVIVES, primary, with an appended pointer to the menu on demand — not
  replaced outright.** These four replies answer "where is my check-in," a genuinely
  different question from "what else can I report," and §28(y)'s own positioning
  ("hindrances, dependencies, site cash, invoices... are work the engineer ALREADY does")
  argues the menu should stay reachable whenever the need arises, not only at day's end.
  Full replacement here would suppress useful, time-specific information the engineer is
  actively waiting on; no access at all would contradict §28(y). Proposed middle ground:
  each Group 2 reply keeps its own text, with one short, fixed sentence appended pointing
  at how to reach the menu on demand (e.g., a recognized keyword). **The exact wording and
  keyword are NOT decided here** — real product copy needs `design-principles.md`
  consultation before finalizing, per this project's own standing rule (§37(e) applies the
  same discipline to a comparable render decision) — flagged as open, not freelanced.

~~**DECIDED (Aravind, 2026-08-28) — accepted as proposed.** Both groups resolve as
above: Group 1 (`REPORT_READY_REPLY`, `EVENING_ALREADY_COMPLETE_REPLY`) replaced by the
menu; Group 2 (`MORNING_AWAITING_TRIGGER_REPLY`, `MORNING_WINDOW_CLOSED_REPLY`,
`EVENING_WINDOW_NOT_OPEN_REPLY`, `EVENING_AWAITING_TRIGGER_REPLY`) survives with an
appended pointer. All six of the idle branch's own static replies are accounted for,
none left unresolved. Exact pointer wording/keyword remains its own open copy question
(below).~~

**SUPERSEDED (Aravind, 2026-08-30) — THE MENU IS THE ONLY REPLY TO AN IDLE INBOUND, WITH
A STATE-COMPUTED HEADER. The 2026-08-28 decision above (Group 2 survives, primary, with
a pointer appended) is now wrong and is replaced, not amended.**

**The rule: an inbound at idle ALWAYS gets the menu.** Check-ins are always
cron-triggered and never reachable by inbound — one rule the engineer holds: *what I
send is for reporting things; check-ins come to me.* Splitting idle replies into "some
get the menu, some get their own text with a pointer" (the 2026-08-28 shape) asked the
engineer to hold a second, narrower rule on top of that — this collapses the two.

**The four Group 2 replies are not deleted — they are DEMOTED to a header line above the
list**, computed from the same state each reply already keyed off. Same information,
better placement: the engineer gets the door AND an answer to whatever prompted him to
message, in one reply instead of a choice between them. **Group 1's own resolution is
unchanged** — those two replies were already fully replaced, nothing about that changes
here.

**THE HEADER MUST BE COMPUTED FROM STATE, NOT FROM THE CLOCK — this is the whole point,
not a refinement.** `design-decisions-beta-feedback.md` §39 (2026-08-30) recorded why:
`EVENING_AWAITING_TRIGGER_REPLY` promised an evening check-in that would never arrive on
a site-holiday day, because the reply inferred "a check-in is coming" from the clock
(morning submitted, evening not, past `eveningSend`) rather than from whether one
actually would. **A header computed the same clock-inferring way has the identical bug,
just relocated one line up.** `routeInboundMessage` already reads today's `daily_logs`
row for this exact purpose — the header is computed from that plus the roster, the same
fix §39 already named, now applied at the header's own construction site instead of
independently.

**Rough shape, approved — refine wording in the copy pass, not decided here:**

| Condition | Header |
|---|---|
| Before `morningSend`, nothing recorded | "Your check-in will arrive shortly." |
| After `morningCutoff`, morning missed | "The morning window has closed for today." |
| `attendance = 'site_holiday'` | "Site holiday recorded — nothing further today." |
| Both halves submitted | "Today's check-in is complete." |
| Nothing notable | No header — just the list. |

**This closes §39, not merely narrows it.** §39's finding is `design-decisions-beta-
feedback.md`'s own — marked resolved-by-design there, dated 2026-08-30, cross-
referencing this decision; not re-litigated here beyond restating why: the false
promise disappears because the header is computed from `attendance` (and the rest of
today's `daily_logs` row), never from the clock alone.

**This also simplifies the spec — the "which replies survive, which are replaced"
question in this section is gone entirely.** Six idle replies collapse to one message
(the menu) with a variable header. There is no longer a Group 1/Group 2 split to
maintain — every idle inbound gets the identical structural reply (header + list),
differing only in which header line, or none, applies.

**OPEN, must be checked before the copy pass — the header's own delivery mechanism,
verified here against both Twilio's and Meta's current docs, not assumed:**

Fetched directly, 2026-08-30, not recalled: **Twilio's own `twilio/list-picker` Content
API type — the actual mechanism this project sends through, per §b's own verified
delivery path — has NO separate header field at all.** Full parameter table, confirmed
(`twilio.com/docs/content/twiliolist-picker`): `body` (required, max **1,024
characters**), `button` (required, no stated max), `items` (required, 1–10, each with
`item` max 24 chars and `description` max 72 chars — consistent with §b's own
Meta-sourced row-title/row-description numbers above). **No header or title parameter
exists in Twilio's schema for this content type.**

This is a stronger answer than "which field is the better home" — **there is no choice
to make; `body` is the only field available on the mechanism this project actually
uses.** Meta's own raw Cloud API interactive-list object DOES expose a separate header
field, plain text, no markdown — commonly cited at a **~60-character limit** (third-
party BSP sources, e.g. wati.io, the same class of independent source §b's own table
already relies on; not independently corroborated by a second organization the way §b's
10-row number was, and Meta's own primary docs pages fetched for this check did not
state a numeric limit directly) — but that field is **not exposed through Twilio's
Content API abstraction for `twilio/list-picker`**, so it is not reachable by this
project's own send path regardless of its real limit. **Consequence: the header line
goes into `body`, prepended before whatever intro/prompt text the menu's body already
carries, separated by a line break — not a length concern (1,024 chars is not a binding
constraint for any of the five lines above, all well under 60 characters as drafted),
only a copy-pass question of ordering and visual separation within one field.**

---

## b. Delivery — verified against Twilio's/Meta's current docs, not the decision text

§28(x)'s claim checked directly, not trusted: **confirmed live** against Twilio's Content
API docs — WhatsApp's List Picker content type is explicitly **"❌ Not supported" for
business-initiated (out-of-session) messages**, and **"✅ Can reply to inbound messages"**
within the 24-hour customer-service window only. §28(x)'s own text — "a WhatsApp
interactive list sent as a FREE-FORM session reply... his inbound opens the 24-hour
window. No template, no Meta approval needed" — is correct as verified today. Consequence
restated precisely: the menu can only ever be the ROUTER's own reply to an inbound
message, never something the outbound-send primitive (items B–F/D/E) could push
unprompted — a structurally different code path from every trigger-cron send this project
has built so far.

**Structural limits — RE-VERIFIED (2026-08-28) against a genuinely independent second
source per number, not just a second fetch of the same page.** The first pass single-
sourced three of these against one Meta doc page; each was re-checked here, either against
a second, different Meta page or an independent third-party WhatsApp BSP's own public
documentation (not Meta's, not Twilio's):

| Constraint | Value | Confidence, after re-verification |
|---|---|---|
| Sections | up to 10 | Confirmed, Meta's own reference (unchanged, not contested) |
| Rows, **total across all sections combined** | up to 10 | **CONFIRMED — two independent organizations agree**: Meta's own Cloud API reference ("up to 10 sections, with up to 10 rows for all sections combined") AND a third-party WhatsApp BSP's own public docs, independently ("a maximum of 10 rows in total across all sections... 10 items combined, not per section") |
| List button (CTA) text | max 20 characters | Confirmed by two separate Meta documentation pages (`cloud-api/messages/interactive-list-messages` and `guides/interactive-messages`, different URLs, matching text) — **not yet corroborated by a third-party source**; the one third-party page checked for this number didn't state it |
| Section title | max 24 characters | Cross-checked against two independent fetches of Meta's own reference — both agree |
| Row title | max 24 characters | **Cross-checked three ways** — two Meta fetches plus the same independent third-party BSP source, all agreeing |
| Row description | max 72 characters | Confirmed by two separate Meta documentation pages (same two as button text) — **not yet corroborated by a third-party source**, same caveat |

**Honest bottom line:** the number that actually shapes the menu — **10 rows total,
combined** — is now confirmed by two independent organizations, not one. Button text (20)
and row description (72) remain confirmed only within Meta's own documentation (two
different pages, not two different companies) — a real, smaller residual uncertainty,
named rather than smoothed over, but not the number the menu's own shape depends on.

**Consequence for naming the seven items:** 7 rows (six items + stop-messages) fits well
inside the confirmed 10-row combined ceiling, with **3 rows of headroom, not more**.
Checked each proposed name against the 24-character row-title limit directly (character
count, not estimated):

| Item | Proposed row title | Length |
|---|---|---|
| 1 | `Hindrance / Dependency` | 22 |
| 2 | `Safety incident` | 16 |
| 3 | `Site expense` | 12 |
| 4 | `Material received` | 18 |
| 5 | `Invoice` | 7 |
| 6 | `Site document` | 13 |
| 7 | `Stop messages` | 13 |

All seven fit. Row descriptions (72-char ceiling) are not drafted here — copy needs the
same `design-principles.md` pass as the trigger pointer text above, not freelanced in a
spec.

**What happens at an eighth item — real, not hypothetical, since §28(x)'s own "Initial
set" framing anticipates growth and only 3 rows of headroom exist.** Sections do NOT
create more capacity — confirmed directly above, the 10-row cap is combined across every
section, not per-section, so adding sections re-organizes the existing budget rather than
expanding it. Three options, not decided here:
1. **A second list message, reached via a "More options" row** on the first list — the
   standard pattern for a menu exceeding a single platform message's own row cap. Preserves
   every item, costs one extra tap for whatever gets pushed to page two.
2. **A hard cap on scope** — the menu stays at however many rows fit; a genuinely new
   capture type either replaces/retires an existing item or gets folded into one, the same
   way hindrance and dependency were merged into one row today specifically to stay inside
   budget.
3. **A hybrid**: the fixed list carries the most common items, with a final "something
   else" row that opens free text a PM triages manually — trades structure (item 1's own
   stored-field requirement, generalised) for headroom.
No recommendation between these three — genuinely open, flagged so it is decided
deliberately whenever an eighth item is actually proposed, not discovered as a surprise
against a menu already believed to have room.

---

## c. Per-item flow

Each entry: what's asked, in what order, what's stored, and whether it's buildable without
inbound media handling (`§28(aa)(1)` — confirmed via grep this codebase has NEVER
downloaded, stored, or referenced a Twilio media URL anywhere; media handling does not
exist in any form today, matching CLAUDE.md §6's webhook-specifics rule that a Twilio media
URL must be re-uploaded to Supabase Storage before use — the mechanism to do that first
download has never been built).

**1. Hindrance / Dependency (merged).**
- Q1: free text — what is the issue (existing `hindrances.description`, `area_affected`
  shape already covers this).
- Q2: **active or potential** — a structured pick (buttons/numbered options, per §6's own
  "fixed trade/equipment/activity list... not free text" discipline extended here), never
  inferred from Q1's free text. This is the field Aravind's own decision calls CRITICAL.
- Buildable without media: **yes**. Neither question requires a photo; the existing
  `hindrances.photo_url` column can stay optional/unset for this item exactly as it
  already does for text-only submissions from other channels.

**2. Safety incident.**
- Q1: what happened (free text → `safety_incidents.description`).
- Q2: location (free text → `location`).
- Q3: injury status — structured pick (`injury_status`, existing column).
- Buildable without media: **yes**, and confirmed by the schema itself —
  `safety_incidents.submitted_via` already has a `whatsapp_adhoc` value in its own CHECK
  constraint (`docs/schema.md`), meaning this exact flow was anticipated before this spec
  was ever written. A photo (`photo_url`, existing column) is real-world valuable for a
  safety incident but not required for the flow to function; ships text-only, photo added
  once media handling exists (§f).

**3. Site expense.**
- Q1: what was it for (free text).
- Q2: how much, in rupees (parsed as a number).
- Q3: **confirmation echo** — "You spent ₹X on Y, is that right?" — required per
  `§28(aa)(2)`'s own evidence: "Cement micsur 1000" was stored as equipment type "cement"
  at `daily_hire_cost` ₹1000 and rendered in a real DPR, the exact parser-class failure a
  bare accept-and-advance on a rupee figure repeats. Only on explicit confirmation does the
  write happen; "no" re-asks Q1/Q2 rather than storing a guess.
- Buildable without media: **yes** — petty cash has no photographable source document by
  nature (unlike 4/5/6, which are all photographs of something), so this item is
  text-only by its own shape, not merely by sequencing choice.

**4. Material received.**
- Q1: photo of the challan (**required** — the challan itself is the artifact; without it
  there is nothing distinguishing this capture from an unverifiable free-text claim).
- Q2: brief free text — what/how much, supplier if visible.
- Buildable without media: **no**. Blocked on `§28(aa)(1)`.

**5. Invoice.**
- Q1: photo of the invoice bill (**required**, same reasoning as item 4).
- Q2: which earlier delivery this matches — the reconciliation step, and the one part of
  this whole spec that is a genuine workflow rather than pure capture. Two shapes
  considered, neither decided here: (i) show a short interactive list of recent
  `material_received`-equivalent entries for this project to pick from, reusing the same
  list-picker mechanism this whole menu already depends on; (ii) free-text reference
  (challan number/date) with PM-side manual matching. **Left open — needs its own design
  pass, not decided in this spec.**
- Buildable without media: **no** — blocked on `§28(aa)(1)` directly (its own photo) AND
  structurally on item 4 (nothing to reconcile against until material-received capture
  exists).

**6. Site document.**
- Q1: which type — structured pick (test report / permit / RFI / pour card / MOM).
- Q2: photo/scan of the document (**required** — the document IS the artifact).
- Buildable without media: **no**. Blocked on `§28(aa)(1)`.

**7. Stop messages.**
- Q1: free text — why (per `§29(b)`'s own decided design: "captures WHY the engineer wants
  out, which distinguishes 'I've left this project'... from 'too many messages'... two
  situations with OPPOSITE correct PM responses").
- Routes to the PM as a REQUEST, never a silent removal — `§29(b)` is explicit this is not
  an automatic opt-out. **The mechanism itself is still open** (no PM-facing inbox exists
  today for this or any of the other six items), but the SURFACE question — where would a
  PM ever see it — has an answer, checked directly rather than left open: **DASH-01
  (`app/(dashboard)/dashboard/page.tsx`) is the right home, conditionally.** Read directly
  for this addition: DASH-01 today is a plain welcome + project grid, scoped by
  `project_members` joined to `projects` filtered by the signed-in PM's `user_id` — no
  exceptions/notifications section of any kind exists yet, confirmed by grep (zero hits for
  "exception"). That absence is not a dead end for this question, it is precedent in the
  right shape: `bot-flows.md` already dated-noted (2026-08-12) that DASH-01 "gains an
  EXCEPTIONS section" — never built, but proposed for the same general purpose (surfacing
  things a PM needs to act on, outside the routine daily-log/DPR views) and scoped the same
  way (the PM's own projects, via the same `project_members` join DASH-01 already uses).
  A stop-message request is a natural member of that same exceptions surface, not a
  reason to invent a separate page. **What it would need, named without designing it:** a
  query scoped to the PM's own projects (the existing `project_members` join, unchanged),
  some UI treatment for an outstanding request (list, banner, or badge — a design-principles
  question, not this spec's), and a resolved-by/resolved-at-style status column on
  whatever table stores the request (§d), matching the convention every other Fast-Follow
  table here already uses. **Conditional on:** this only answers WHERE a PM would see it,
  not WHEN DASH-01's own exceptions section actually gets built — if that section remains
  unbuilt when item 7 ships, item 7 still has nowhere to surface, and the "ships
  successfully and uselessly" risk stands exactly as flagged. Storage can capture the
  request today regardless; the surface is the precondition for it mattering.
- Buildable without media: **yes**.

---

## d. Storage — shape and open questions, not a migration

**Checked directly against `docs/schema.md` before writing this — three of the seven items
already have a live table; four do not.**

**1. Hindrance/Dependency** — `hindrances` table **already exists** (Fast-Follow, "table
exists, flow ships later"): `hindrance_type`, `area_affected`, `description`,
`impact_level`, `photo_url`, `submitted_via`, `dpr_included`, `status`. **Open, real gap
found while writing this spec, not previously named anywhere:** this table has NO column
for active-vs-potential — its own CHECK constraints cover `hindrance_type`
(material_delay/weather/equipment/labour/design/utility/other) and `impact_level`
(minor/moderate/major), neither of which is the active/potential axis Aravind's own item 1
requires as a stored field. A new column is needed once this is built; not designed here.
Separately: no standalone `dependencies` table exists at all today — dependencies
currently live only as `morning_dependencies`/`evening_dependencies` JSONB columns on
`daily_logs`. Whether the merged menu item writes into `hindrances` (with the new
active/potential column absorbing what "dependency" used to mean) or needs its own new
table is an open design question this spec does not resolve.

**2. Safety incident** — `safety_incidents` table **already exists**, already anticipates
`submitted_via='whatsapp_adhoc'` in its own CHECK constraint. No new table needed for text
capture; `photo_url` already present for when media handling ships.

**3. Site expense** — **no existing table.** Checked: nothing in `docs/schema.md` covers
site cash/petty-cash capture (`invoices` is vendor bills, a different fact). Needs a new
table — shape, not migration: amount (`DECIMAL(12,2)`, per CLAUDE.md's own money-column
rule, never `(10,2)`), description, engineer, project, tenant, submitted date, and
whatever the confirmation-echo flow (§c) needs to record (was it confirmed, on which
attempt).

**4. Material received** — **no existing table.** Needs a new table: photo/image URL
(Supabase Storage, matching every other photo column in this schema — never a Twilio URL,
per CLAUDE.md's own webhook-specifics rule), free-text material/quantity description,
supplier if captured, project, tenant, date.

**5. Invoice** — `invoices` table **already exists**: `vendor_name`, `invoice_date`,
`invoice_number`, `amount DECIMAL(12,2)`, `line_items`, `cost_head`, `image_url`,
`ocr_confidence`, `submitted_via`, `status`, `reviewed_by`/`reviewed_at`. **Open, real gap
found while writing this spec:** no column referencing a `material_received` record —
the reconciliation Aravind names as "the only item here that is not pure capture" has no
schema support today. A reference column (once item 4's own table exists) is needed; not
designed here.

**6. Site document** — **no existing table.** Needs a new table: document type
(structured, matching §c's Q1 pick — test_report/permit/rfi/pour_card/mom), photo/scan
URL, project, tenant, date, submitted-by.

**7. Stop messages** — **no existing table.** Needs a new table (or, if the "routes to the
PM" mechanism above gets resolved as some general request/notification queue rather than a
dedicated table, could ride that instead — genuinely open, tied to the same unresolved
question in §c item 7): free-text reason, engineer, project, tenant, requested-at,
resolved-at/resolved-by (mirroring the `open/in_progress/resolved`-shaped status column
every other Fast-Follow table in this schema already uses).

**Cutting across all seven:** `daily_logs.current_flow`'s own CHECK constraint already
anticipates `safety`/`invoice`/`hindrance` as flow values (`docs/schema.md`, confirmed
directly) — but not `dependency`, `site_expense`, `material_received`, `site_document`, or
whatever internal name the opt-out flow takes. Widening that CHECK constraint is itself a
migration-worthy fact to carry into whenever this gets built — named here, not designed.

**Also cutting across all seven, verified directly against production
(`jvxwqignooseazzmwhvl`) rather than assumed — a gap in this section's own original
writing, closed here:** none of the three tables with an existing live schema —
`hindrances`, `safety_incidents`, `invoices` — has any foreign key to `daily_logs`, and
none has a NOT NULL column that could only be satisfied by one. Their only NOT NULL columns
are `tenant_id`, `project_id`, and the reporter column (`reported_by` on the first two,
`submitted_by` on invoices). **All three can already be written on a day with zero
`daily_logs` activity** — exactly the case a hindrance blocking the check-in itself would
produce. This was never stated above, and should have been: item 1 exists specifically to
capture the reason a check-in didn't happen, so a design that silently assumed a check-in
precondition would have been self-defeating before it shipped. No schema or migration
consequence follows — the no-parent-row case is already supported — this is a
documentation gap being closed, not a new requirement. The same should hold for items
3/4/6/7's own new tables once designed: nothing in §c's per-item flow implies a
`daily_logs` dependency for any of the seven, and none should be introduced when those
tables are eventually built.

---

## Project resolution — an open problem this spec does not address

**All three tables with a live schema require `project_id` NOT NULL** (confirmed against
production, same investigation as above) — and, by the same logic, so will whatever new
tables items 3/4/6/7 eventually get. The ad-hoc menu is reached from an inbound WhatsApp
message, which the webhook resolves only to a phone number. **Nothing in this spec's
trigger (§a) or per-item flow (§c) states how a write resolves WHICH project it belongs
to.** That is an omission, not a decided answer, and it applies to every one of the seven
items, not just the three with existing tables.

**This is not a new problem for this codebase — it is the identical ambiguity two existing
pieces of code already navigate, in opposite directions, for reasons that do not
automatically transfer here.** `project_members` permits multiple rows per `user_id`
today; "one engineer belongs to exactly one project" is a DECIDED product rule
(`design-decisions-beta-feedback.md` §36, 2026-08-26) but not a database-enforced one — no
UNIQUE index exists yet.

- **Migration 033's sweep** (`sweep_stale_morning_sessions`) COUNTS an engineer's
  `project_members` rows and, when the count isn't exactly 1, SKIPS — writes nothing,
  increments a counter, alerts via Sentry (`docs/reviews/033-sweep-review-package.md`
  §13.2/§13.4) — rather than guessing.
- **Migration 031's outbound-send ledger** TRUSTS the rule outright, with no defensive
  count, on the argument that a wrong guess there only misattributes `project_id` on one
  send-ledger row — `event_key`'s own UNIQUE constraint excludes `project_id` entirely, so
  a wrong guess can't fabricate a duplicate send or a double charge
  (`docs/reviews/031-outbound-send-ledger-review-package.md` §4, its own calibration note).

**Argued, not assumed, which side of that split this menu falls on:** a hindrance, safety
incident, or invoice written against the wrong project is not a misattributed metadata
field on an otherwise-correct row — it is a FABRICATED FACT with real downstream
consumers. DPR generation and PM visibility are both strictly project-scoped (CLAUDE.md
§4's own cross-project-scope rule), so a wrong `project_id` here means one PM sees a
hindrance that never happened on their project while the PM who should see it never does —
the same failure shape 033's own review escalated over ("a write, with downstream
consumers... that treat the fabricated row as real data; guessing wrong there creates a
false fact that outlives the bug that caused it"). This is closer to 033's case than to
031's: 031's blast radius is attribution on one row with no data fabrication, because
`event_key` structurally excludes `project_id` from ever causing a duplicate or a false
event; nothing in this menu's own design gives it an equivalent structural backstop.

**Consequence: the menu should skip-and-surface on ambiguous project resolution, not
best-guess** — the same behavior 033 already established and tested (`project_members`
count != 1 → no write, count it, alert), not a new mechanism to invent. What the engineer
actually sees when this happens, and whether it differs per item, is not designed here —
only the required BEHAVIOR is being named, per this section's own scope.

**This closes permanently, not just for the menu, once `design-decisions-beta-feedback.md`
§36's proposed `UNIQUE INDEX ON project_members(user_id)` ships** — DECIDED IN PRINCIPLE,
NOT SCHEDULED as of 2026-08-26, still true as of this spec (2026-08-28). Until then, every
one of the seven menu items inherits the same unresolved ambiguity 033 and 031 already each
had to make their own call about — the menu is simply the FIRST inbound-path writer to hit
it for these three (and, eventually, four new) tables specifically.

---

## Attribution day — none of the three existing tables has one, and the consequence is undecided

**Verified directly against production, full column list for each (same investigation as
above) — printed here rather than assumed:**

- `hindrances`: `id, created_at, tenant_id, project_id, reported_by, hindrance_type,
  area_affected, description, impact_level, photo_url, submitted_via, dpr_included, status,
  resolved_at, resolved_by`. **No date column besides `created_at`.**
- `safety_incidents`: `id, created_at, tenant_id, project_id, reported_by, incident_type,
  location, description, injury_status, photo_url, ocr_confidence, pm_notified_at, status,
  submitted_via, resolved_at, resolved_by, investigation_notes`. **No date column besides
  `created_at`.**
- `invoices`: `id, created_at, tenant_id, project_id, submitted_by, vendor_name, amount,
  invoice_date, invoice_number, line_items, cost_head, image_url, ocr_confidence,
  submitted_via, status, reviewed_by, reviewed_at, vendor_id, gstin_extracted`.
  **Correction to the premise this check started from: invoices is not a clean third
  instance of "only `created_at` exists."** It also carries `invoice_date` (nullable
  `date`) — but that column is the date printed on the vendor's own invoice document
  (OCR-extracted or engineer-entered), not a system-derived attribution day. It can be
  missing, wrong, or genuinely different from the calendar day the WhatsApp submission
  should be grouped under for a PM view or DPR — a vendor invoice dated three days ago,
  submitted today, is not a bug, it's normal. `invoice_date` doesn't solve the same problem
  `log_date` solves on `daily_logs`; it just means invoices' gap is a validation/trust
  question about an existing field, not a wholly missing one.

**Two of three — `hindrances` and `safety_incidents` — confirmed: no attribution-day column
exists at all, only `created_at`.**

**The consequence:** `created_at` is the timestamp of the WRITE, not necessarily the day
the event belongs to. A hindrance reported at 00:30 IST for the previous working day
attributes to the wrong day the moment anything groups by `created_at::date` directly —
the same IST-day problem `log_date` solves on `daily_logs`, and the same one `event_key`
solves on `outbound_sends` via `istDateString` rather than a raw UTC timestamp
(`docs/reviews/031-outbound-send-ledger-review-package.md` §3). Any PM view or DPR section
that eventually groups these seven items' rows by day inherits exactly the problem
`daily_logs` would have had without `log_date`.

**Needs deciding before anything is built on these tables — options only, no choice made:**

1. A `log_date`-equivalent column on each table (or the new tables items 3/4/6/7 eventually
   get), computed the same way `daily_logs.log_date` and `outbound_sends.event_key` already
   are — `istDateString` at write time.
2. Derive the attribution day from `created_at` at READ time, in whatever view/query
   eventually consumes these rows, converting to IST on the fly rather than storing it.
3. Ask the engineer which day the event belongs to, as its own flow question — a real UX
   cost added to every one of the seven items' flows, weighed against correctness, not a
   free option.

Do NOT build any of these without the decision this list is deferring — named here so it
isn't discovered mid-migration the way item 1's active/potential gap (§f) was.

---

## e. Safety interrupt — §7's open question, DECIDED

**§7's own text, verbatim:** "Should `hindrance` (or similar keywords) be able to interrupt
an ACTIVE flow the way safety does, instead of only firing at idle?... Revisit when the
ad-hoc flows are actually being built — not before." This spec is that moment.

**DECIDED (Aravind, 2026-08-28): no — hindrance (and every other item in this menu) stays
idle-only, no `pending_flows` entry, no interrupt or queue treatment. Safety alone keeps
its existing BOT-19 mechanism, unchanged.**

**Argued, not merely asserted:** even safety — the one category §7 itself calls
genuinely time-critical — does not TRUE-interrupt an active flow today. Per §7's own
"mechanism nuance" note, BOT-19 *queues* safety via `pending_flows` and processes it
*after* the current flow completes, with BOT-26 priority 0 only meaning it jumps ahead of
OTHER queued work, not that it preempts an in-progress turn. If safety itself — physical
harm, the most urgent category this product handles — doesn't preempt an active flow
mid-turn, extending even QUEUEING treatment to hindrance (a strictly less urgent category:
"potential" hindrances are explicitly not urgent by definition, and "active" hindrances are
typically already visibly blocking work on-site, a documentation action rather than an
emergency signal) would be inconsistent with the ordering §7 itself already reasons about.
A hindrance reported two or three minutes late, after the active check-in finishes
naturally, costs nothing real.

**The counter-argument, stated fairly:** §28(y)'s own positioning frames hindrances as
"work the engineer ALREADY does... routing it through Quoco is substitution, not
additional burden" — an engineer mid-flow who hits a real blocker right then might
reasonably want to report it immediately rather than finish four more check-in questions
first. This is a real cost of the recommendation above, not one this entry dismisses —
just one judged smaller than the cost of building a second interrupt mechanism (its own
`pending_flows` entry type, its own priority-order decision against BOT-26's existing
`safety=0, scheduled_trigger=1, other=2`) for a category that, unlike safety, has no
irreversible-harm argument forcing the build.

**DECIDED (Aravind, 2026-08-28) — accepted as proposed.** Hindrance (and every other item
in this menu) stays idle-only; no `pending_flows` entry, no interrupt or queue treatment.
Safety alone keeps its existing BOT-19 mechanism, unchanged.

---

## f. What ships first — corrected: "text-only" is not "migration-free"

**Correction (Aravind, 2026-08-28): the ship-first set is text-only PLUS one migration, not
"no migration."** The original framing conflated two different questions — "does this item
need photo/media handling" and "does this item need a schema change" — and answered only
the first. Item 1 answers NO to the first and YES to the second, and the decision itself
(item 1's active/potential distinction, per Aravind's seven-item list) makes that column
REQUIRED, not optional groundwork that could slip to a later pass.

**Confirmed: items 1, 2, 3, and 7 are text-only (no photo/media capture) and items 4, 5, and
6 are photograph-dependent, waiting on `§28(aa)(1)`'s media handling** — that grouping,
from §d's storage findings, is unchanged. What changes is what "text-only" is allowed to
imply: it describes the WhatsApp-flow shape (no image upload step), not the database
readiness. Checked per item, not assumed from the grouping alone:

- **1 (Hindrance/Dependency):** no photo required by the flow in §c — confirmed text-only
  in flow shape. **Not confirmed migration-free — the opposite.** Per §d, the `hindrances`
  table (docs/schema.md) has no column distinguishing an active hindrance (blocking work
  now) from a potential one (may block later) — the exact distinction Aravind's own
  seven-item decision names as load-bearing for this merged item. That field does not
  exist today and is required by the decision, not an enhancement that can wait. Naming
  the REQUIREMENT, not designing it (per this addition's own instruction): a new column on
  `hindrances`, TEXT + CHECK constraint (per CLAUDE.md §6's own status-column convention —
  "always TEXT + CHECK constraint, never ENUM"), with at minimum the two values the
  decision itself requires (active / potential). Exact column name, full value set, and
  default/nullability are migration-design work, out of scope for this spec. This migration
  trips none of §0's external-review-gate conditions on its own reading — additive, one
  new column, no function/grant/RLS/auth/money surface — so it is a normal migration, not
  one requiring the external-review package; named here only so it isn't mistaken for
  optional or deferrable.
  **Consequence for sequencing:** item 1 cannot ship before this migration lands, even
  though its WhatsApp flow itself is pure text. "Ships first" for item 1 specifically means
  "ships first once its own migration is written, rehearsed per §7's dry-run/rehearsal
  discipline, and applied" — not "ships first, unconditionally, tonight."
- **2 (Safety incident):** `photo_url` exists on the table but is not required for the flow
  to function; `submitted_via='whatsapp_adhoc'` already anticipated in schema — confirmed
  text-only-capable, photo as a later enhancement.
- **3 (Site expense):** no physical source document by nature (petty cash isn't
  photographable the way a challan or invoice is) — confirmed text-only, not merely
  sequenced that way.
- **7 (Stop messages):** pure free text — confirmed text-only.
- **4 (Material received):** the challan photo is not optional to the item's own purpose —
  a text-only capture without it loses the evidentiary value the whole item exists for.
  Confirmed blocked on media.
- **5 (Invoice):** blocked on media directly (its own photo) AND structurally on item 4
  existing first (nothing to reconcile against otherwise) — confirmed blocked, with the
  added note that 5 cannot ship even after media handling lands unless 4 has already
  shipped too; this is a real ordering dependency between two items in the "wait" group,
  not just a shared blocker.
- **6 (Site document):** the document image is the entire point of the capture — confirmed
  blocked on media.

**One addition to "what ships first," found while writing this section, not part of the
original four-item split:** §c item 7's own open question (what "routes to the PM"
mechanically means) is itself a precondition for item 7 shipping usefully, independent of
media handling — a stop-messages request nobody on the PM side ever sees is worse than no
opt-out path at all, since it would read as handled when it isn't. Naming this so it
doesn't surface as a surprise once 1/2/3/7 are actually being built.

---

## §28(t) — closed, not left open (proposed rewrite, for review)

The plan/decisions doc's own §28(t) is currently written as "OPEN, NOT DECIDED —
attendance 'No' is currently irreversible," framed as an unresolved restart-semantics
question. Per this session's own instruction, it is not open — proposed rewrite below,
not yet applied to `design-decisions-beta-feedback.md`:

> ### t. DECIDED (2026-08-28) — attendance "No" stays irreversible; check-in windows are a
> data-integrity boundary, not a convenience limit
>
> **The scenario that raised this, unchanged from the original entry:** "No" stamps
> completion and ends the morning flow (§28(d)), so an engineer who answers no at 08:30 and
> reaches site at 11:00 has no route back to Q2-Q4 despite the 15:00 cutoff still being
> open. Evening then asks what was completed with no plan captured.
>
> **DECIDED: no route back is built. The irreversibility is correct behaviour, not a gap.**
> Check-in windows (`morningCutoff`, `eveningSend`, `eveningClose`) are a DATA-INTEGRITY
> boundary, not a convenience limit that exists only to nudge timely submission. Late data
> is not merely late — it is data whose date nobody can trust: an engineer answering
> morning questions at 11:00, or amending a "No" after the fact, produces a record dated
> to a day that, from the system's point of view, was never actually observed in real
> time. A DPR built from it misrepresents a day already closed as if it had been captured
> as it happened. Flexible update windows do not recover lost data faithfully — they
> attract bad data (answered from memory, hours or days later, un-verifiable against what
> was actually true at the time) and produce date misattribution (today's correction
> silently rewriting yesterday's record). The correct response to a missed or wrong
> morning answer is the same one this codebase already applies everywhere else state needs
> correcting after the fact: the PM edit RPC (migration 019), a human-reviewed correction
> with its own audit trail — never a reopened engineer-facing window.
>
> This closes the "restart-semantics question arriving through a side door" the original
> entry named — it does not belong with the outbound-send primitive as unresolved
> plumbing; it is resolved, and the resolution is that no plumbing gets built for it.

---

## Summary of open items this spec does NOT resolve

**a and e are DECIDED (2026-08-28, accepted as proposed) and removed from this list** — see
§a and §e above for the final text. What remains open:

- **a (superseded, 2026-08-30).** No more Group 1/Group 2 split, no more pointer concept —
  every idle inbound gets the menu, with a state-computed header line. What's open now: the
  five header lines' exact wording (rough shape approved, not final copy), and confirming the
  header's own placement inside the list-picker `body` field (prepended, line-break-separated
  — not a length concern, Twilio's own `body` field caps at 1,024 characters) reads well once
  drafted alongside the menu's own intro text.
- **b.** Row-description copy for all seven items (character-budgeted, not drafted); which of
  the three "eighth item" options (second page, hard cap, hybrid free-text row) to take if/when
  an eighth item is ever needed — explicitly not decided, no recommendation given.
- **c(5).** The invoice-to-delivery reconciliation UX shape (list-pick vs. free-text
  reference).
- **c(7)/d(7) — narrowed.** The mechanical meaning of "routes to the PM" is still open, but
  the SURFACE question is answered: DASH-01 is the right home, conditional on its own
  not-yet-built exceptions section actually getting built (see §c item 7 above). What's left
  open is the request/notification mechanism itself and whether DASH-01's exceptions section
  ships before or after item 7.
- **d(1)/(5).** Whether the merged hindrance/dependency item writes into the existing
  `hindrances` table (widened) or needs a new one; the exact reference shape linking
  invoices back to material-received records.
- **f (new).** Item 1's own migration: the exact column name, full CHECK value set, and
  default/nullability for the `hindrances` active/potential column — the REQUIREMENT is
  decided (§f above), the column's own design is not.
- **Project resolution (new, 2026-08-28).** Which project a menu-triggered write belongs
  to, when `project_members` is ambiguous for the sending engineer — argued toward
  skip-and-surface, matching migration 033's own mechanism, not toward best-guessing; the
  exact skip-time UX (what the engineer sees) is not designed. Closes permanently once
  §36's `project_members(user_id)` UNIQUE index ships — still not scheduled.
- **Attribution day (new, 2026-08-28).** Whether `hindrances`/`safety_incidents` (and the
  new tables for items 3/4/6/7) need a `log_date`-equivalent column, a read-time derivation
  from `created_at`, or an engineer-asked day — three options named, none chosen. Also
  flags `invoices.invoice_date` as an existing-but-different-semantics field, not a ready
  answer.

---

## g. Phase-one build-order and scope decisions (2026-09-03) — recorded, none built

Six decisions made while planning the build order for PR 1/PR 2, before any flow code was
written. This section records them WITH the reasoning that produced them, matching this
file's own convention elsewhere — none of this authorizes writing the flow code itself.

**1. Build order is menu-first, media-last, registration-UI-third.** The menu (items 1, 2,
3, 7 — text-only) ships first; media handling (unblocking 4, 5, 6) ships second; a real
registration UI ships third. Reasoning: `lib/whatsapp/inbound-start.ts`'s own retirement
header already frames the menu as a LAUNCH PREREQUISITE — "must ship before the first real
engineer is onboarded, because at that point inbound becomes his only surface." Registration
today is SQL-only (a PM runs a direct INSERT — confirmed no registration UI exists anywhere
under `app/`) and the menu does not depend on that changing; a real registration UI is its
own, larger, unrelated workstream (auth, onboarding UX) that does not block or get blocked
by the menu. Media handling unblocks real value (items 4-6) but the menu proves the
mechanism and ships value (1, 2, 3, 7) without waiting on it.

**2. Items 4, 5, 6 are OMITTED from the rendered list, never shown disabled.** A tapped row
that does nothing — or replies "not available yet" — teaches a low-comfort-user engineer
(this project's own persona, `design-principles.md`) that the bot is unreliable, which is a
worse outcome than the row simply not existing yet. Their row numbers (4 = material
received, 5 = invoice, 6 = site document) stay PERMANENTLY RESERVED per this file's own §a
numbering rule — when media handling ships, they slot into the list at the same numbers,
never renumbered, never colliding with whatever an engineer already learned from 1/2/3/7.

**3. The photo question joins item 1 AFTER media handling ships, as a follow-on invitation,
not a sixth question inserted into the flow.** Item 1 ships (§c) as the two-question flow
already specified there (Q1 free-text description, Q2 timing) — not restructured to insert
a photo step ahead of completion, which would couple the flow's own completion to
infrastructure (media handling) that doesn't exist at ship time, and would complicate 036's
own "the row is always written once Q1 has content" invariant. Once media handling exists,
the photo becomes a separate, optional message the engineer can send AFTER the confirmation
— e.g. "if you have a photo, you can send it now" — the same "reply anytime" framing this
session's own item 2 (§e below) explicitly REMOVES from any current mock-up, precisely
because it isn't true until media handling ships; it becomes true, and the copy can return,
at that point. `hindrances.photo_url` already exists as a column (confirmed live against
production's actual column list, `docs/reviews/036_hindrance_timing_column.sql`'s own
evidence trail) — attaching a photo later is an UPDATE on the existing row, not a new
migration.

**4. Voice notes are out of scope for capture, but must not be told they're a photo.** An
inbound voice note hits the exact same "has media" branch (`NumMedia !== '0'`) this
session's own build-plan report proposed for the photo-idle-reply case — but Twilio's
webhook payload also carries `MediaContentType0` (and further-indexed siblings) per media
item, which distinguishes an audio MIME type from an image one. Telling an engineer who
sent a voice note "I can't receive photos yet" is wrong on its face, not just imprecise —
the media-idle-reply branch must inspect the content-type prefix (`audio/` vs `image/`) and
return a distinct string for each, not one generic "no media" reply. Low marginal cost:
the same webhook payload already carries the field this needs: nothing further to build to
detect it, only to branch on it.

**5. NOT phase one, recorded with reasoning, none scheduled:**
   - **Update-an-existing-hindrance flow.** No design work has happened on this; it is not
     implied by anything decided so far.
   - **Hindrance closure (marking a row resolved).** Checked directly, not assumed: `grep`
     across `lib/`, `app/`, and every migration file's runtime SQL for any `UPDATE` (or
     `.update(`) touching `hindrances` returns zero hits outside one COMMENTED-OUT DDL line
     in migration 016's own rollback block. **`hindrances.status`, `resolved_at`, and
     `resolved_by` have no writer anywhere in this codebase after the initial INSERT** —
     every row this project has ever written stays at whatever `status` it was created
     with, permanently, today. Any future "open hindrances" surface (a PM dashboard view,
     an exceptions list) would degrade BY DESIGN the moment it ships, showing every
     hindrance ever captured as perpetually open, until a closure writer exists. Named so
     the next person building that surface doesn't discover this the hard way.
   - **Morning-hindrance duplicate detection** (an ad-hoc hindrance report that duplicates
     what the same engineer already free-texted into `morning_hindrances` that day). Not
     designed; no dedup mechanism proposed.

**6. OPEN, deliberately not resolved here:**
   - Whether `hindrance_type` (the existing CHECK'd column —
     material_delay/weather/equipment/labour/design/utility/other) earns its own structured
     question in the ad-hoc flow, or stays derived/unset, since it's largely recoverable
     from the free-text description a PM or future classifier could read.
   - Whether `responsible_party` should be captured. Checked directly: the SCHEDULED flows
     already capture this exact field for the same subject — `morning_hindrances JSONB —
     [{description, responsible_party}]` and `morning_dependencies`/`evening_dependencies`
     (`docs/schema.md`, `lib/dpr/schema.ts:227`) all carry it. The ad-hoc path, as specified
     in §c today (Q1 description, Q2 timing only), captures LESS than the scheduled flows
     already do for the equivalent free-text hindrance/dependency report — a real gap
     between the two capture surfaces, named here, not resolved.
