# WhatsApp templates — copy v2 (English-only output, any-language input)

**Status: v2, replaces the cancelled bilingual (English+Tamil) template plan.**

## HARD GATES (2026-08-21, GATE 2 corrected same day — see below) — read before
submitting OR sending anything

**These two gates are not the same kind of gate. GATE 1 blocks SENDING only; GATE 2
blocks SUBMISSION itself, before Meta ever sees the template.**

**GATE 1 (a SEND gate) — no template may be SENT until the flow migration matches the
submitted copy.** Template 1 (`quoco_morning_checkin`) embeds attendance as Q1 — "Are
you on site today? Reply yes or no." **SHARPENED, 2026-08-23 — this gate's own premise
changed underneath it and the entry needs to say so plainly, not just cite a design
doc:**

- **Template 1 is now APPROVED** — confirmed live via the Twilio Content API on
  2026-08-23 (`docs/reviews/whatsapp-template-submission-status.md`'s "Log" table,
  row 1). Meta has no further say over whether this template can be sent; approval is
  permanent (barring a future Meta policy action), and no further submission-side event
  changes that.
- **Template 1 is SENDABLE the moment outbound-send code exists.** No code in this
  repo can construct an outbound WhatsApp message today (CLAUDE.md §3's STANDING
  ARCHITECTURAL FACT — the #69/031 outbound-send primitive is unbuilt), so nothing can
  send it yet regardless of approval. The instant that primitive ships, template 1
  becomes something any send path — cron, a manual test, an onboarding route — can
  actually dispatch. Approval removed the Meta-side obstacle; it did not remove this
  one.
- **The BUILT RPC still asks the plan question at step 1, unchanged as of 2026-08-23.**
  `apply_morning_flow_turn` (live in migration 022; the attendance-first rework,
  migration `030_morning_flow_attendance.sql`, is written, fixed, and reviewed —
  `docs/reviews/morning-flow-migration-review-package.md` §10/§10.1/§10.2 — but **NOT
  YET APPLIED to test-db or prod**, per that package's own §5 evidence-status list).
  Its actual step 1 is still the plan question (**CORRECTED 2026-08-25, pointer only —
  this was `MORNING_QUESTIONS[1]` under the pre-030 numbering; the same plan-question text
  lives at `MORNING_QUESTIONS[2]` now that migration 030 has shipped, per 030's own
  attendance-first renumbering**, in `lib/whatsapp/flows/morning.ts`, "What's your *plan
  of action* for today?"). If
  template 1 is sent before migration 030 is applied, an engineer's "yes"/"no" reply to
  the APPROVED template's attendance question would be stored as their `morning_plan`
  free-text answer — wrong data, silently, exactly as this gate has always warned.
- **The gate is now the ONLY thing standing between an approved template and a wrong
  write.** Before 2026-08-23, an unapproved template meant GATE 1 had two independent
  reasons to hold: Meta hadn't approved the copy, AND the RPC didn't match it. Approval
  removed the first reason. The second — migration 030 unapplied — is now the SOLE
  remaining barrier, and unlike Meta's review, nothing external enforces it; it holds
  only as long as this document (and whoever ships the outbound-send primitive) reads
  it and checks. Cite: `design-decisions-beta-feedback.md` §28(l) (the decided flow)
  against the currently built one. This gate lifts only when migration 030 ships to
  prod and is verified live (the review package's own §3 GATE 1 verification plan),
  not when Meta approves the copy — approval already happened and did not lift it.

**GATE 1: LIFTED, 2026-08-25 — recorded 2026-08-26 (Pass 1's own freshness check,
before any Pass 1 code was written).** The condition the paragraph above still
describes as pending has been met. Evidence, fresh, not assumed (re-verified live
against production the night this was recorded, breadcrumb-confirmed
`jvxwqignooseazzmwhvl`): `schema_migrations` carries `030` (`morning_flow_
attendance`); `apply_morning_flow_turn`'s live signature is byte-identical to 030's
12-arg signature and its body references `attendance`; `daily_logs.attendance`
exists. And from code on `main`: `MORNING_QUESTIONS[1]` = `'Good morning. Are you
on site today? Reply yes or no.'` — matches this template's approved copy verbatim.
Both halves of this gate's own condition are satisfied. Full record:
`docs/plans/pass1-outbound-send-plan.md`'s own matching correction, same date.

**GATE 2 (a SUBMISSION gate, corrected 2026-08-21 — was drafted as a send-only gate,
that was wrong) — template 8 (`quoco_engineer_optin`) is NOT SUBMITTED to Meta until
`messaging_blocked` is set `true` in application code (BOT-27 SET-HALF).**

**Reason:** the template's body promises the engineer they may reply STOP. The send
path respects `messaging_blocked`, but no application code ever sets it — so a STOP
reply is currently ignored and the engineer is messaged again at 08:30 the next day.
Beyond the broken promise, opt-out non-compliance affects the number's quality rating
under Meta's own rules.

**Why submission and not send:** an approved template sits in the account and any send
path — cron, onboarding route, a manual test — can reach for it. Leaving it unapproved
makes the gate self-enforcing rather than dependent on everyone remembering.

## Design change, stated plainly (Y1/Y2)

**Output is simple English only. Input accepts any language — English, Tamil, or a mix.**
Reading a second language is far easier than writing it, so the freedom belongs on the
input side. This is fewer templates, not more: no `en`/`ta` pair per template, no
`users.preferred_language` column, no per-language approval fallback.

**Cancelled outright (Y1), not deferred:**
- `users.preferred_language` — no output language to select.
- A message catalogue for Q2–Q6, echo-backs, confirmations, error paths, BOT-20, BOT-24 —
  one set of strings, written simply, in English.
- Per-language template approval fallback — single language, nothing to fall back from.

**What replaces asking:** observe, don't ask. See `docs/language-observation-plan.md` for
the design (Y2) — logging the language of each inbound reply, for free, rather than adding
a conversational turn to ask for a preference nobody has committed to yet.

**A Tamil-language template set was drafted under the now-cancelled bilingual plan.** Per
Y1, it is not being submitted to Meta. It is not reproduced here.

## COUNT DISCREPANCY — RESOLVED (AA1, corrected same day)

This section originally flagged a 13-vs-12 mismatch as unresolved: this repo's own
baseline showed 12 templates, and grepping the repo for whatever established 13 (or 26,
pre-redesign) found nothing. **Correction: the 13th template is real —
`quoco_login_otp`, AUTHENTICATION category, `{{1}}` numeric code.** It originates in
`auth-and-session-decisions.md`, which lives in the claude.ai PROJECT, not this repo —
not something a repo-wide grep could ever find, regardless of thoroughness, because it
was never here to find. Flagging "not found in repo" was correct as far as it went;
concluding it therefore didn't exist was the overreach — the honest report for a
not-found reference is "not found in repo, may be project-side," not "does not exist."
Recorded here as the standing lesson, not just fixed in place: this repo holds code and
`bot-flows.md`; design decisions and session records live in the claude.ai project. Full
copy for template 13 is below; the count was 13 as of this correction.

**Superseded (2026-08-21): the count is now 14 (see the Total section at the bottom of
this file) — `quoco_evening_checkin_no_plan` (2b) added per §28(s).** Not rewriting the
"13" above; the count-history is the point of this section, and it keeps moving.

## Simple-English rules applied throughout (Y3)

Per `docs/design-principles.md` Rule 3.11 (revised this pass) and the new Rule 3.12: short
sentences, one idea each; the question goes last; the same word for the same thing every
time; no idioms or phrasal verbs where a plain verb exists; concrete over abstract; numbers
as digits; cut politeness scaffolding that carries no meaning. **Register is tiered by
audience** — engineer-facing templates (1–4, 8, and 2b added 2026-08-21) take the
strictest simplification; PM/owner templates (5, 6, 9, 10, 11, 12) carry more structure,
since a PM/owner reads more fluently and over-flattening reads as curt, not clear.

---

## Spine templates

## Category basis (2026-08-21) — recorded explicitly, was previously only inferable

**Before this pass, only template 13 stated its own category individually** — the other
16 relied on two blanket statements (the spare-variants section's "(Utility)" for
1-4/1v2-4v2, and template 13's own aside that "the other 12 templates" follow Utility
rules). Every template below now carries its own explicit `Category:` line. Default
reasoning, stated once here rather than repeated 16 times: **Utility** applies to every
template that is a transactional update tied to an existing account/service the
recipient (engineer, PM, or owner-notification-to-PM) already has an active
relationship with — a daily operational process already opted into, not an offer, a
promotion, or unsolicited re-engagement. Each template's own line below states only what
departs from this default or is worth flagging.

## Compliance audit (2026-08-21) — Twilio/Meta 6-rule check, fixes applied

Six rules checked against all 18 template bodies (button-component lines excluded — a
Meta button is a separate component, not body text): (1) no `{{n}}` at the very start or
end of the body, (2) at least `2x+1` non-variable words for `x` variables, (3) variables
numbered `1..n` with no gaps, (4) no two variables immediately adjacent, (5) fewer than 10
emoji, (6) category defensible.

**Result: 12 of 18 failed at least one rule; 6 passed as written (1, 2, 2b, 1v2, 2v2,
11).** Excluding the two templates already on hold (8, 12 — see the submit/hold list),
that is **10 of 16 submittable templates needing a copy fix**, all applied below: 3, 4,
3v2, 4v2, 5, 6, 7, 9, 10, 13 (fixed on the submit list) plus 8 and 12 (fixed too, so both
are submission-ready the moment their own holds lift). Rule 3 (sequential numbering) and
rule 5 (emoji) had zero failures across all 18 — not restated per-template below. Full
per-rule breakdown lives in this session's own audit record; the fixes themselves are
inline at each template.

**Re-audited after fixes: 18/18 pass all six rules.** Re-run against the corrected bodies
below, same script, same rules — no template still fails.

## Sample values (2026-08-21) — concrete, not placeholder

**Meta reviews against samples, not variable descriptions — every template previously
gave only an abstract label ("name", "project") with no concrete example.** Every
template below now carries a `Sample values:` line.

**CORRECTED (2026-08-21, same day, Twilio/Meta compliance audit item 2): all real-fixture
sample values below are replaced with fictional-but-realistic equivalents.** The original
policy — reuse this session's real, live-verified prod fixtures — is struck through, not
silently rewritten:

~~Reused directly from this session's own real, live-verified fixtures rather than
invented, where they fit:~~
~~- Engineer name → **Vikram Rao** (`users.full_name`, id `3534756b-2a32-4b91-954b-
  0bab15c2dba1` — read directly off prod this session).~~
~~- Project → **Speed Mechatronics** (`projects.name`, id `acef67fe-e775-439d-82b8-
  5b8526868d6d`).~~
~~- Tenant/company (template 8's `{{2}}`) → **Rajamani Constructions Pvt Ltd**
  (`tenants.name`, id `adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0`).~~
~~- DPR id (template 6's button URL) → **3f3c3aff-0519-4a71-88cb-4e53f4f0934a**, a real
  row (`log_date` 2026-08-20, same project) — read directly off prod, not invented.~~

**Rationale for the reversal:** Twilio documents that a Content API template's sample
values also serve as **fallback text** — rendered in a live send when the real content
variable is undefined at send time. A real fixture used as a sample is therefore not
merely an approval-etiquette question; it is a live cross-tenant data-leak vector with a
plausible trigger — a real engineer's name or a real tenant's registered company name
could render, unprompted, inside a message sent to an unrelated recipient on a genuine
undefined-variable send.

**New policy: one consistent fictional identity set, reused across the whole batch, so
the samples read coherently to a reviewer** — realistic Indian construction context, not
descriptive placeholder tokens (a token like `engineer_name` reads as unfinished copy to
Meta's reviewers, which is its own rejection risk):
- Engineer name → **Arjun Nair** (fictional).
- Project → **Emerald Heights** (fictional).
- Tenant/company (template 8's `{{2}}`) → **Shivalik Infraprojects Pvt Ltd** (fictional).
- DPR id (template 6's button URL) → **a1b2c3d4-5e6f-4a3b-8c9d-1e2f3a4b5c6d** — a
  syntactically valid UUID, deliberately not tied to any real `dprs` row, replacing the
  prior real prod id for the same fallback-text reason above.
- PM name — **unaffected by this correction.** `project_members` has no `role='pm'` row
  for this (fictional, post-correction) project either, and the existing sample, **Suresh
  Iyer**, was already invented and clearly labelled as such — not a real-fixture value
  this correction needed to touch.
- Safety-report specifics (template 12) — unaffected; already illustrative-only (no real
  `safety_incidents` data exists, Fast-Follow, unbuilt), except its `{{1}}`/`{{2}}`
  (project/engineer) follow the new fictional identity set below for consistency. This
  template is held regardless (see the submit/hold list below).

### 1. `quoco_morning_checkin`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Good morning {{1}}. This is Quoco for {{2}}.
> Are you on site today? Reply yes or no.

**RE-CUT (2026-08-21, §28(a)/(j)):** was a bare "reply to start" invite with no embedded
question. Per §28(a) (`design-decisions-beta-feedback.md`), the cron now sends ONE
message that already carries Q1 directly — no separate handshake. Q1 is attendance
(§28(c)), not the old plan question. §28(j) records this precisely as a BEHAVIOUR
CHANGE, not a confirmation of prior copy — an earlier review round quoted this
template's body as ending "...What work is planned today?", which was never actually on
`main`; corrected in place, not silently. "Reply yes or no" reuses the exact register
`EVENING_QUESTIONS[2]` already uses ("Reply *yes* or *no*") — consistent vocabulary
across the flow, not a new phrasing.

*(Prior copy, struck through per this project's own correction discipline, not deleted:
~~Good morning {{1}}. This is Quoco for {{2}}. Reply to start today's morning
check-in.~~ — written fresh against the simple-English rules at the time; superseded by
§28(a)'s single-message design.)*

### 2. `quoco_evening_checkin`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project, `{{3}}` morning plan
(≤150 chars).
**Sample values (fictional, 2026-08-21 correction; word-boundary truncation, 2026-08-22):**
`{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights", `{{3}}` =
"Continue shuttering work for the second floor slab near grid lines D4 to D9, finish
rebar tying for the retaining wall on the north side..." (a fictional plan, 259 characters
full length; truncated to 139 characters at the last word boundary before 150, with an
ellipsis, rather than mid-word).

*(Prior sample value for `{{3}}`, struck through, not deleted — truncated mid-word
("...coordinate w"), found reading the dry-run payloads 2026-08-22: ~~"Continue
shuttering work for the second floor slab near grid lines D4 to D9, finish rebar tying
for the retaining wall on the north side, coordinate w" (a fictional plan, 259 characters
full length; this is the actual 150-character truncation of it — shown truncated
deliberately, mid-word, so the sample demonstrates the real behaviour rather than a short
string that never exercises the limit).~~)*

*(Prior sample values, struck through, not deleted — used the real, live-verified
prod morning plan rather than a fictional one; corrected per the same-day fallback-text
leak finding, see the "Sample values" section intro above: ~~`{{1}}` = "Vikram Rao",
`{{2}}` = "Speed Mechatronics", `{{3}}` = "Continue RCC column casting for grid lines C1
to C6 on the third floor, complete shuttering for beam B12, coordinate with the
ready-mix supplier for t" (the real morning plan runs 246 characters; this is the actual
150-character truncation of it — shown truncated deliberately, mid-word, so the sample
demonstrates the real behaviour rather than a short string that never exercises the
limit).~~)*

> Good evening {{1}}. This morning you planned: {{3}}
> What *work was completed* today for {{2}}? Add the quantity if you can — e.g. "slab
> concrete 120 sqm".

**RE-CUT (2026-08-21, §28(h)):** same reasoning as template 1's re-cut — the 18:30 cron
now sends ONE message carrying evening Q1 directly, no separate handshake. Reuses
`EVENING_QUESTIONS[1]`'s own vocabulary verbatim ("what *work was completed* today",
"Add the quantity if you can", the same example) rather than paraphrasing.
**Only fires when `{{3}}` (a real morning plan) exists.** Per §28(s), the no-morning-plan
case is a SEPARATE template (drafted, not yet added to this file — pending approval),
not a fallback string substituted into this one.

*(Prior copy, struck through, not deleted: ~~Good evening {{1}}. This morning you
planned: {{3}} Reply to start today's evening check-in for {{2}}.~~ — superseded by
§28(h)'s single-message design.)*

### 2b. `quoco_evening_checkin_no_plan`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights". **NEW (2026-08-21,
§28(s)).** No `{{3}}` — this variant exists specifically because there is no morning plan
to reference.

> Good evening {{1}}. This is Quoco for {{2}}.
> What *work was completed* today? Add the quantity if you can — e.g. "slab concrete
> 120 sqm".

**Decided per §28(s):** a Meta template body is fixed at approval and only variable
values substitute — `bot-flows.md:211`'s "omit the morning-plan echo" has no
template-side equivalent, and a filler value in `{{3}}` would render as "This morning
you planned: no morning check-in," which reads as a system message about a person. This
separate template is the fix: no `{{3}}` slot to fill at all. Fires whenever
`morning_plan` is null for the day — the pre-existing never-engaged case, and, per
§28(d), the new attendance="No" case.

**No `_v2` spare, decided.** Lower frequency than template 2 (most days have a plan, so
a rejection here leaves the majority of evening sends — template 2, with its own
approved spare — unaffected); real send volume is unknown for a brand-new template. The
established 1-4 spare policy was scoped to those four specifically, not a general rule;
not unilaterally extended here. Revisit if/when this template's actual incidence is
observed.

### 3. `quoco_morning_nudge`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Hi {{1}}, you have not sent today's morning check-in for {{2}} yet.
> Reply to start now.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** body previously started with
`{{1}}` directly (rule 1 violation — no variable at the very start of the body). Added
"Hi" as a real leading word.

*(Prior copy, struck through, not deleted: ~~{{1}}, you have not sent today's morning
check-in for {{2}} yet. Reply to start now.~~)*

### 4. `quoco_evening_nudge`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Hi {{1}}, you have not sent today's evening check-in for {{2}} yet.
> Reply to start now.

**AUDIT FIX (2026-08-21):** same rule-1 fix as template 3 (started with `{{1}}`).

*(Prior copy, struck through, not deleted: ~~{{1}}, you have not sent today's evening
check-in for {{2}} yet. Reply to start now.~~)*

## Spare variants (II5) — one alternate wording per engineer-facing send template

**Purpose, stated plainly: these are Meta-submission fallbacks, not a second live
template set.** If Meta rejects one of templates 1–4 (category miscall, banned-phrase
match, or any other automated-review reason), resubmitting a near-identical string
against the same rejection often fails the same way — Meta's own guidance is to vary
wording, not just resubmit. Submitting a spare alongside the primary means an approved
fallback exists without waiting through a second review round-trip. **Same audience, same
variables, same category (Utility) as the template each one shadows — wording only.**
Only templates 1–4 get a spare: these are the four time-sensitive engineer sends where a
rejected primary with no approved fallback would silently stop reaching engineers; 5–13
are PM/owner-facing, lower-frequency, or (13) Authentication-category and out of scope
for this pass.

**Do not activate a spare without a reason.** These exist to be submitted to Meta now, so
an approved fallback is on hand if needed later — not to run instead of 1–4 by default.

### 1v2. `quoco_morning_checkin_v2`
**Audience:** engineer. **Category: Utility** (shadows template 1's category). **Variables:** `{{1}}` name, `{{2}}` project. **Shadows:** template 1.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Good morning {{1}}.
> Are you on site today for {{2}}? Reply yes or no.

**RE-CUT (2026-08-21, §28(a)):** same reasoning as template 1's own re-cut note above —
not restated here to avoid drift between two copies.

*(Prior copy, struck through: ~~Good morning {{1}}. Time for today's morning check-in
for {{2}}. Reply to start.~~)*

### 2v2. `quoco_evening_checkin_v2`
**Audience:** engineer. **Category: Utility** (shadows template 2's category). **Variables:** `{{1}}` name, `{{2}}` project, `{{3}}` morning plan
(≤150 chars). **Shadows:** template 2.
**Sample values (fictional, 2026-08-21 correction; word-boundary truncation, 2026-08-22):**
same as template 2 — `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights", `{{3}}` =
"Continue shuttering work for the second floor slab near grid lines D4 to D9, finish
rebar tying for the retaining wall on the north side..." (the same fictional truncation,
139 characters, word-boundary + ellipsis).

*(Prior sample value for `{{3}}`, struck through, not deleted — truncated mid-word, same
correction as template 2's own: ~~"Continue shuttering work for the second floor slab near
grid lines D4 to D9, finish rebar tying for the retaining wall on the north side,
coordinate w" (the same fictional 150-char truncation).~~)*

*(Prior sample values, struck through, not deleted, same correction as template 2's own:
~~same as template 2 — `{{1}}` = "Vikram Rao", `{{2}}` = "Speed Mechatronics", `{{3}}` =
"Continue RCC column casting for grid lines C1 to C6 on the third floor, complete
shuttering for beam B12, coordinate with the ready-mix supplier for t" (the same real
150-char truncation).~~)*

> Good evening {{1}}. Your morning plan was: {{3}}
> For {{2}}, what *work was completed* today? Add the quantity if you can — e.g. "slab
> concrete 120 sqm".

**RE-CUT (2026-08-21, §28(h)):** same reasoning as template 2's own re-cut note above —
not restated here to avoid drift between two copies.

*(Prior copy, struck through: ~~Good evening {{1}}. Your morning plan was: {{3}} Time for
today's evening check-in for {{2}}. Reply to start.~~)*

### 3v2. `quoco_morning_nudge_v2`
**Audience:** engineer. **Category: Utility** (shadows template 3's category). **Variables:** `{{1}}` name, `{{2}}` project. **Shadows:** template 3.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Hi {{1}}, today's morning check-in for {{2}} is not done yet.
> Reply now to start.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** body previously started with
`{{1}}` (rule 1). Added "Hi" as a real leading word.

*(Prior copy, struck through, not deleted: ~~{{1}}, today's morning check-in for {{2}} is
not done yet. Reply now to start.~~)*

### 4v2. `quoco_evening_nudge_v2`
**Audience:** engineer. **Category: Utility** (shadows template 4's category). **Variables:** `{{1}}` name, `{{2}}` project. **Shadows:** template 4.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Hi {{1}}, today's evening check-in for {{2}} is not done yet.
> Reply now to start.

**AUDIT FIX (2026-08-21):** same rule-1 fix as 3v2 (started with `{{1}}`).

*(Prior copy, struck through, not deleted: ~~{{1}}, today's evening check-in for {{2}} is
not done yet. Reply now to start.~~)*

**Checked against Rule 3.12, same bar as 1–4:** each is two short sentences; no idiom;
"check-in"/"reply"/"start" reused verbatim from 1–4, not swapped for synonyms, so a swap
to the spare mid-flow would not introduce new vocabulary an engineer hasn't seen; no
digits to render; no politeness scaffolding. Differs from its primary in sentence
structure and word order only, which is the minimum change Meta's own guidance asks for
without drifting from this project's own consistent-vocabulary rule.

### 5. `quoco_manager_missed`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` engineer, `{{2}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` = "Emerald Heights".

> Reminder: {{1}} has not submitted today's check-in for {{2}}.
> The window for a nudge has closed. Please follow up directly if needed.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** body previously started with
`{{1}}` (rule 1). Prepended "Reminder:".

*(Prior copy, struck through, not deleted: ~~{{1}} has not submitted today's check-in for
{{2}}. The window for a nudge has closed. Please follow up directly if needed.~~)*

### 6. `quoco_dpr_ready_pm`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` date. **CTA URL button** (Y5 —
drop the body-variable link, add a dashboard-link button component).
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Emerald Heights", `{{2}}` = "21 Aug 2026".

> Today's Daily Progress Report for {{1}}, dated {{2}}, is ready to review.
> You have until 8:30 PM to make any corrections before it is sent to the owner.
> [Button: View report]

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** `{{1}} ({{2}})` placed the two
variables immediately adjacent, separated only by a parenthesis (rule 4). Replaced the
parenthetical with "project {{2}}," which reads naturally and breaks the adjacency.

*(Prior copy, struck through, not deleted: ~~Today's Daily Progress Report for {{1}}
({{2}}) is ready to review. You have until 8:30 PM to make any corrections before it is
sent to the owner.~~)*

**SEMANTIC FIX (2026-08-22, found reading the dry-run payloads):** the audit fix above was
itself wrong — `{{1}}` is the PROJECT and `{{2}}` is the DATE, so "project {{2}}" mislabels
the date as a second project, rendering as "for Emerald Heights, project 21 Aug 2026" —
nonsense. Corrected to "dated {{2}}," which still breaks the `{{1}} ({{2}})` adjacency the
original fix was for, without mislabeling either variable.

*(Prior (rule-4) copy, struck through, not deleted: ~~Today's Daily Progress Report for
{{1}}, project {{2}}, is ready to review. You have until 8:30 PM to make any corrections
before it is sent to the owner.~~)*

**CTA button URL (2026-08-21, item 4) — real, confirmed to exist:** a per-DPR detail
route now exists — `app/(dashboard)/dprs/[id]/page.tsx`, confirmed live in this repo
(this contradicts an earlier entry elsewhere in this project's history claiming the DPR
archive was list-only; checked fresh against the current codebase, not assumed from that
older note). Button URL: **`https://app.quoco.co.in/dprs/{{3}}`**. **Sample value for the
button's `{{3}}`: `a1b2c3d4-5e6f-4a3b-8c9d-1e2f3a4b5c6d`** — a fictional, syntactically
valid UUID, not tied to any real `dprs` row (2026-08-21 correction, same fallback-text
leak reasoning as the body's own samples above — see the "Sample values" section intro).
Note: this route requires the viewing PM to be logged in (standard dashboard auth, same
as every other route under `app/(dashboard)/`) — not separately re-verified here beyond
confirming the route itself exists and is real code, not a stub.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit, button numbering corrected):** the
button variable was originally documented as its own `{{1}}`, "independent of the body's
`{{1}}`/`{{2}}`" — wrong. Twilio's Content API `variables` map is flat and shared across
a template's body and its call-to-action button; the button's variable continues the
body's own sequence, so it must be `{{3}}`, not a second `{{1}}`. As originally
documented, `{{1}}` collided with the body's own `{{1}}` (project name) in that shared
map — confirmed live in a dry run of `scripts/submit-templates.ts`, where the button's
DPR-id sample overwrote the body's project-name sample under the shared key `"1"`.

*(Prior text, struck through, not deleted: ~~Button URL: **`https://app.quoco.co.in/
dprs/{{1}}`** (dynamic suffix, the button's own variable numbering, independent of the
body's `{{1}}`/`{{2}}`). **Sample value for the button's `{{1}}`:
`3f3c3aff-0519-4a71-88cb-4e53f4f0934a`** — a real `dprs` row (`log_date` 2026-08-20, same
project), read directly off prod, not invented.~~)*

**8:30 PM verified against `CHECKIN_CHECKPOINTS` (Y5), not assumed:** `eveningClose` —
the moment the DPR is generated and the PM is notified, matching THIS template's own send
trigger — is **19:45 (7:45 PM)**, not 8:30 PM. The PM's edit window then runs until
`ownerSend` at **20:30 (8:30 PM)**, when the report goes to the owner automatically. **8:30
PM is correct here specifically as the edit-window deadline** ("you have until 8:30 PM"),
not as when the report became ready (that's 7:45 PM, correctly not stated as 8:30 in this
copy). If an earlier draft used 8:30 PM to mean "report ready," that was wrong by 45
minutes — worth checking against whatever was actually submitted before, since Y5 warned
this costs a full re-approval round if wrong.

### 7. `quoco_dpr_owner_email_sent`
**Category: Utility.**
**Audience:** PM (notification that owner delivery happened — NOT the owner; owner
delivery is email, per the #67 decision, `docs/dpr-delivery-versioning-plan.md`).
**Variables:** `{{1}}` project, `{{2}}` date. **Replaces `quoco_dpr_owner`** — the old
template sent a 3-line summary directly to the owner over WhatsApp; that content now goes
by email, so this template only confirms the send happened.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Emerald Heights", `{{2}}` = "21 Aug 2026".

> The Daily Progress Report for {{1}}, dated {{2}}, has been emailed to the owner.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** same `{{1}} ({{2}})` adjacency
fix as template 6 (rule 4).

*(Prior copy, struck through, not deleted: ~~The Daily Progress Report for {{1}} ({{2}})
has been emailed to the owner.~~)*

**SEMANTIC FIX (2026-08-22, found reading the dry-run payloads):** same error as template
6's own — "project {{2}}" mislabelled the date as a second project. Corrected to
"dated {{2}}," same reasoning as template 6.

*(Prior (rule-4) copy, struck through, not deleted: ~~The Daily Progress Report for {{1}},
project {{2}}, has been emailed to the owner.~~)*

**Dated supersession, `docs/bot-flows.md`:** see the note added to that file's template
section — `quoco_dpr_owner` is retired, not deleted from history; the reason is the #67
owner-delivery-by-email decision, not a copy-quality change.

### 8. `quoco_engineer_optin`
**Audience:** engineer. **Category: Utility, but FLAGGED as a recategorisation risk
(2026-08-21).** This is an onboarding/welcome message ("has added you to Quoco... Reply
YES to start") — its own opt-in framing reads similarly to an invitation, which is
exactly the kind of language Meta's automated review is known to redirect toward
Marketing even when the underlying relationship (the engineer's account already exists
before this send) is genuinely transactional. Submit as Utility as drafted, but expect
this one specifically to be the most likely rejection/recategorisation in the batch —
not a reason to reword it, just a heads-up on where review friction is most likely to
land. **Variables:** `{{1}}` name, `{{2}}` company, `{{3}}` project.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Arjun Nair", `{{2}}` =
"Shivalik Infraprojects Pvt Ltd", `{{3}}` = "Emerald Heights".

*(Prior sample values, struck through, not deleted, same fallback-text leak correction as
elsewhere in this file — this template is hard-excluded from submission (GATE 2) but its
recorded samples are corrected too, for consistency: ~~`{{1}}` = "Vikram Rao", `{{2}}` =
"Rajamani Constructions Pvt Ltd" (the real tenant name, `tenants.name`), `{{3}}` = "Speed
Mechatronics".~~)*
**This is the template carrying the two written commitments (Y4/Y5) — both must be kept by
the code, not just promised in copy.**

> Hello {{1}}. Your team at {{2}} has added you to Quoco for daily check-ins on {{3}}.
> Reply YES to start.
> You can reply in any language — English, Tamil, or a mix.
> Reply STOP at any time to stop these messages.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** `{{1}}. {{2}}` placed the two
variables immediately adjacent, separated only by a period (rule 4). Inserted "Your team
at" between them — kept `{{2}}` as the company/tenant name it actually is (not
recast as a person), since the sample value is "Rajamani Constructions Pvt Ltd," not an
individual's name.

*(Prior copy, struck through, not deleted: ~~Hello {{1}}. {{2}} has added you to Quoco
for daily check-ins on {{3}}. Reply YES to start. You can reply in any language — English,
Tamil, or a mix. Reply STOP at any time to stop these messages.~~)*

**Two commitments this template makes, both requiring code, not just copy (Y4/Y5):**
1. "You can reply in any language" — verified against real parsing behavior, see
   `docs/bot-flows.md`'s new MIXED-LANGUAGE INPUT section (Y4). Holds today: extraction is
   graceful (never crashes, never blocks) on mixed Tamil-script/English input, though
   activity-name extraction folds unrecognised words in as raw text rather than
   translating them — an accuracy limitation, not a promise-breaking one, since the raw
   answer is always preserved regardless.
2. "Reply STOP" — **does NOT hold today.** `messaging_blocked` is never set `true` by any
   code path in this repo except test fixtures (CLAUDE.md's own "BOT-27's SET-HALF DOES
   NOT EXIST" entry, open since 2026-08-10). This template writes that promise into an
   approved, Meta-facing artifact — raising the set-half from a design gap to a **named
   pre-launch blocker**, since the promise is now in writing. **Do not remove the STOP
   line** — it is the right promise and helps approval — **make the code keep it** before
   the production sender carries real traffic. See CLAUDE.md's dated addendum to the
   existing BOT-27 entry.

### 9. `quoco_dpr_silent_day`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` PM name.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Emerald Heights", `{{2}}` =
"Suresh Iyer" (`{{2}}` unaffected by this correction — already invented, not a
real-fixture value; see the "Sample values" section intro above).

> Note for {{2}}: no check-in data was received for {{1}} today.
> No report was generated. Please confirm the site status if needed.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** body previously started with
`{{2}}` (rule 1 — the start-of-body check applies to any variable, not only `{{1}}`).
Prepended "Note for" so the body opens with real words.

*(Prior copy, struck through, not deleted: ~~{{2}}, no check-in data was received for
{{1}} today. No report was generated. Please confirm the site status if needed.~~)*

**8:30 PM checked here too (Y5), same finding as template 6:** this notification fires at
the same `eveningClose` moment (19:45 / 7:45 PM) per Rule 7.2's "closes AT REPORT TIME" —
this copy makes no time claim at all, so there is nothing to correct, but flagging that any
future edit adding a time reference here should use 7:45 PM, not 8:30 PM, for the same
reason as template 6.

### 10. `quoco_dpr_delayed`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` PM name.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Emerald Heights", `{{2}}` =
"Suresh Iyer" (`{{2}}` unaffected, same caveat as template 9).

> Note for {{2}}: today's report for {{1}} is taking longer than usual to generate.
> We will notify you when it is ready.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** same rule-1 fix as template 9
(started with `{{2}}`).

*(Prior copy, struck through, not deleted: ~~{{2}}, today's report for {{1}} is taking
longer than usual to generate. We will notify you when it is ready.~~)*

### 11. `quoco_dpr_pause_expired`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` date.
**Sample values (fictional, 2026-08-21 correction):** `{{1}}` = "Emerald Heights", `{{2}}` = "21 Aug 2026".

> Your check-in pause for {{1}} ended on {{2}}.
> Daily check-ins have resumed.

---

## Fast-Follow template

### 12. `quoco_safety_alert_pm`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` engineer, `{{3}}` type/location,
`{{4}}` injury status. **CTA URL button** (Y5 — drop the body-variable link).
**Sample values (illustrative only — no real `safety_incidents` data exists, the
feature is Fast-Follow and unbuilt; `{{1}}`/`{{2}}` also updated 2026-08-21 for
consistency with the rest of this file's fictional identity set):** `{{1}}` =
"Emerald Heights", `{{2}}` = "Arjun Nair", `{{3}}` = "a fall from height near the
scaffolding on level 2", `{{4}}` = "minor injury, first aid given".

> Safety report for site {{1}}: engineer {{2}} reported an incident described as {{3}}.
> Current injury status is recorded as {{4}}. Please review immediately.
> [Button: View details]

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** the original body failed three
ways at once — ended the body on `{{4}}.` (rule 1), carried only 6 non-variable words
against a 4-variable, 9-word minimum (rule 2), and placed `{{1}}: {{2}}` immediately
adjacent with only a colon between them (rule 4). Rewritten with "site"/"engineer" before
each variable, a closing sentence ("Please review immediately.") so the body no longer
ends on a variable, and enough real words to clear the ratio (19 non-variable words
against a required minimum of 9). This template is on hold regardless (Fast-Follow,
unbuilt, no CTA URL — see below) — fixed now so it is submission-ready the moment the
hold lifts, not reopened as a second pass later.

*(Prior copy, struck through, not deleted: ~~Safety report for {{1}}: {{2}} reported
{{3}}. Injury status: {{4}}.~~)*

**CTA button URL (2026-08-21, item 4) — NOT KNOWN, cannot be submitted.** Checked
directly: `find app -iname "*safety*"` returns zero results — no dashboard route exists
for a safety-report detail view at all (matches this template's own Fast-Follow status;
`DASH-06` safety log is unbuilt per CLAUDE.md §2). There is no URL to record, real or
placeholder. **This template holds regardless of the button question** — see the
submit/hold list below — but naming the button gap explicitly rather than leaving it
implied by the Fast-Follow label alone.

---

## Authentication template

### 13. `quoco_login_otp`
**Audience:** whoever authenticates via OTP (per `auth-and-session-decisions.md`, claude.ai
project — not fully visible to this repo; PM/admin web login is the known candidate, since
engineer/owner have no web login at all per CLAUDE.md §5). **Variables:** `{{1}}` numeric
code, bare — no surrounding words, no baked-in formatting, so WhatsApp's tap-to-copy works.
**AUTHENTICATION category** (Meta's own template class, not Utility) — different rules
apply, not the Utility rules the other 12 templates follow.
**Sample value:** `{{1}}` = "482913" (a plausible 6-digit code — not a real generated
OTP, since none exists to reuse; Authentication-category samples don't need to
correspond to a real code, only a realistic format).

> Your Quoco login code is {{1}}. This code expires in 10 minutes.

**Category rules checked against this copy:** purely functional wording, no greeting, no
branding (present); mandatory validity/expiry line (present — "expires in 10 minutes,"
figure not sourced from a repo constant since none was found for OTP expiry; VERIFY the
actual expiry window before submission, do not assume 10 minutes is correct); bare numeric
`{{1}}` (present); billed on every send including in-window, unlike the Utility templates'
free-in-window exception — budget for this differently than templates 1–12.

**AUDIT FIX (2026-08-21, Twilio/Meta compliance audit):** body previously started with
`{{1}}` (rule 1). Reworded so the code sits mid-sentence instead of leading the body.
**Caveat, not resolved by this fix:** Meta's Authentication category uses a materially
different, more constrained template structure in WhatsApp Manager than Utility/Marketing
— the code is typically delivered inside a largely fixed boilerplate zone with an
auto-added "Copy code" button and a disclaimer Meta appends itself, not free body text
subject to the same composition rules this 6-rule audit was built for. Verify this fix is
even the right unit of change against WhatsApp Manager's actual Authentication template
editor before submission — it may not accept free-text restructuring the same way, or may
not need it at all.

*(Prior copy, struck through, not deleted: ~~{{1}} is your Quoco login code. This code
expires in 10 minutes.~~)*

---

## Total (2026-08-21): 14 templates (12 Spine + 1 Fast-Follow + 1 Authentication) + 4 spare variants = 18

**Changed from the 13+4=17 recorded earlier — the new `quoco_evening_checkin_no_plan`
(2b, §28(s)) adds one Spine template with no spare.** Of these 18: 2 hold (8, 12 — see
`docs/reviews/whatsapp-template-submission-status.md`'s submit/hold list), 16 clear to
submit.

Submission tracking (dates, per-template status, Meta review outcomes) lives in
`docs/reviews/whatsapp-template-submission-status.md`, not here — this file is the copy
deck; that one is the durable submission log, updated as each submission event happens
rather than re-derived from this file's own edit history.
