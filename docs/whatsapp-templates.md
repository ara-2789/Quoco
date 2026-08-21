# WhatsApp templates — copy v2 (English-only output, any-language input)

**Status: v2, replaces the cancelled bilingual (English+Tamil) template plan.**

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
copy for template 13 is below; the count is 13 throughout this file and `bot-flows.md`
from here on.

## Simple-English rules applied throughout (Y3)

Per `docs/design-principles.md` Rule 3.11 (revised this pass) and the new Rule 3.12: short
sentences, one idea each; the question goes last; the same word for the same thing every
time; no idioms or phrasal verbs where a plain verb exists; concrete over abstract; numbers
as digits; cut politeness scaffolding that carries no meaning. **Register is tiered by
audience** — engineer-facing templates (1–4, 8) take the strictest simplification; PM/owner
templates (5, 6, 9, 10, 11, 12) carry more structure, since a PM/owner reads more fluently
and over-flattening reads as curt, not clear.

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

### 1. `quoco_morning_checkin`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.

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
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project. **NEW (2026-08-21,
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

> {{1}}, you have not sent today's morning check-in for {{2}} yet.
> Reply to start now.

### 4. `quoco_evening_nudge`
**Audience:** engineer. **Category: Utility.** **Variables:** `{{1}}` name, `{{2}}` project.

> {{1}}, you have not sent today's evening check-in for {{2}} yet.
> Reply to start now.

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

> Good morning {{1}}.
> Are you on site today for {{2}}? Reply yes or no.

**RE-CUT (2026-08-21, §28(a)):** same reasoning as template 1's own re-cut note above —
not restated here to avoid drift between two copies.

*(Prior copy, struck through: ~~Good morning {{1}}. Time for today's morning check-in
for {{2}}. Reply to start.~~)*

### 2v2. `quoco_evening_checkin_v2`
**Audience:** engineer. **Category: Utility** (shadows template 2's category). **Variables:** `{{1}}` name, `{{2}}` project, `{{3}}` morning plan
(≤150 chars). **Shadows:** template 2.

> Good evening {{1}}. Your morning plan was: {{3}}
> For {{2}}, what *work was completed* today? Add the quantity if you can — e.g. "slab
> concrete 120 sqm".

**RE-CUT (2026-08-21, §28(h)):** same reasoning as template 2's own re-cut note above —
not restated here to avoid drift between two copies.

*(Prior copy, struck through: ~~Good evening {{1}}. Your morning plan was: {{3}} Time for
today's evening check-in for {{2}}. Reply to start.~~)*

### 3v2. `quoco_morning_nudge_v2`
**Audience:** engineer. **Category: Utility** (shadows template 3's category). **Variables:** `{{1}}` name, `{{2}}` project. **Shadows:** template 3.

> {{1}}, today's morning check-in for {{2}} is not done yet.
> Reply now to start.

### 4v2. `quoco_evening_nudge_v2`
**Audience:** engineer. **Category: Utility** (shadows template 4's category). **Variables:** `{{1}}` name, `{{2}}` project. **Shadows:** template 4.

> {{1}}, today's evening check-in for {{2}} is not done yet.
> Reply now to start.

**Checked against Rule 3.12, same bar as 1–4:** each is two short sentences; no idiom;
"check-in"/"reply"/"start" reused verbatim from 1–4, not swapped for synonyms, so a swap
to the spare mid-flow would not introduce new vocabulary an engineer hasn't seen; no
digits to render; no politeness scaffolding. Differs from its primary in sentence
structure and word order only, which is the minimum change Meta's own guidance asks for
without drifting from this project's own consistent-vocabulary rule.

### 5. `quoco_manager_missed`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` engineer, `{{2}}` project.

> {{1}} has not submitted today's check-in for {{2}}.
> The window for a nudge has closed. Please follow up directly if needed.

### 6. `quoco_dpr_ready_pm`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` date. **CTA URL button** (Y5 —
drop the body-variable link, add a dashboard-link button component).

> Today's Daily Progress Report for {{1}} ({{2}}) is ready to review.
> You have until 8:30 PM to make any corrections before it is sent to the owner.
> [Button: View report]

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

> The Daily Progress Report for {{1}} ({{2}}) has been emailed to the owner.

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
**This is the template carrying the two written commitments (Y4/Y5) — both must be kept by
the code, not just promised in copy.**

> Hello {{1}}. {{2}} has added you to Quoco for daily check-ins on {{3}}.
> Reply YES to start.
> You can reply in any language — English, Tamil, or a mix.
> Reply STOP at any time to stop these messages.

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

> {{2}}, no check-in data was received for {{1}} today.
> No report was generated. Please confirm the site status if needed.

**8:30 PM checked here too (Y5), same finding as template 6:** this notification fires at
the same `eveningClose` moment (19:45 / 7:45 PM) per Rule 7.2's "closes AT REPORT TIME" —
this copy makes no time claim at all, so there is nothing to correct, but flagging that any
future edit adding a time reference here should use 7:45 PM, not 8:30 PM, for the same
reason as template 6.

### 10. `quoco_dpr_delayed`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` PM name.

> {{2}}, today's report for {{1}} is taking longer than usual to generate.
> We will notify you when it is ready.

### 11. `quoco_dpr_pause_expired`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` date.

> Your check-in pause for {{1}} ended on {{2}}.
> Daily check-ins have resumed.

---

## Fast-Follow template

### 12. `quoco_safety_alert_pm`
**Audience:** PM. **Category: Utility.** **Variables:** `{{1}}` project, `{{2}}` engineer, `{{3}}` type/location,
`{{4}}` injury status. **CTA URL button** (Y5 — drop the body-variable link).

> Safety report for {{1}}: {{2}} reported {{3}}.
> Injury status: {{4}}.
> [Button: View details]

---

## Authentication template

### 13. `quoco_login_otp`
**Audience:** whoever authenticates via OTP (per `auth-and-session-decisions.md`, claude.ai
project — not fully visible to this repo; PM/admin web login is the known candidate, since
engineer/owner have no web login at all per CLAUDE.md §5). **Variables:** `{{1}}` numeric
code, bare — no surrounding words, no baked-in formatting, so WhatsApp's tap-to-copy works.
**AUTHENTICATION category** (Meta's own template class, not Utility) — different rules
apply, not the Utility rules the other 12 templates follow:

> {{1}} is your Quoco login code. This code expires in 10 minutes.

**Category rules checked against this copy:** purely functional wording, no greeting, no
branding (present); mandatory validity/expiry line (present — "expires in 10 minutes,"
figure not sourced from a repo constant since none was found for OTP expiry; VERIFY the
actual expiry window before submission, do not assume 10 minutes is correct); bare numeric
`{{1}}` (present); billed on every send including in-window, unlike the Utility templates'
free-in-window exception — budget for this differently than templates 1–12.

---

## Total: 13 templates (11 Spine + 1 Fast-Follow + 1 Authentication) + 4 spare variants (II5)

Submission tracking (dates, per-template status, Meta review outcomes) lives in
`docs/reviews/whatsapp-template-submission-status.md`, not here — this file is the copy
deck; that one is the durable submission log, updated as each submission event happens
rather than re-derived from this file's own edit history.
