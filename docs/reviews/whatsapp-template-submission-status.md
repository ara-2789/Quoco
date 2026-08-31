# WhatsApp template submission status (II5)

**Purpose:** the durable, per-template submission log for Meta review. `docs/whatsapp-
templates.md` is the copy deck (what each template says); this file is the log of what
was actually submitted, when, and with what outcome — updated as each submission event
happens, not re-derived from the copy deck's own edit history.

## Status legend

- `not submitted` — copy exists in `docs/whatsapp-templates.md`, no submission event yet.
- `pending` — submitted to Meta, awaiting review.
- `approved` — Meta approved; live/available to send.
- `rejected` — Meta rejected; reason recorded in Notes, resubmission (or spare
  activation) tracked as a new row, not an edit to this one.

## Log

| # | Template name | Category | Variant | Submitted | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | `quoco_morning_checkin` | Utility | primary | 2026-08-22 | approved | HX SID `HXd4a896b66bfd7b237f53dc4dca77fb76`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 1v2 | `quoco_morning_checkin_v2` | Utility | spare (II5) | 2026-08-22 | approved | Shadows #1. Hold in reserve; see "Spare-activation policy" below. HX SID `HX313e502ef1bddf70cd458e86dd2ef152`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 2 | `quoco_evening_checkin` | Utility | primary | 2026-08-22 | approved | HX SID `HX48e6eab79b422dd4351071f67827881c`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 2v2 | `quoco_evening_checkin_v2` | Utility | spare (II5) | 2026-08-22 | approved | Shadows #2. HX SID `HXd23e81336fd4def59c4a8d3935b755ff`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 2b | `quoco_evening_checkin_no_plan` | Utility | primary (NEW, 2026-08-21, §28(s)) | 2026-08-22 | approved | No `{{3}}` — the no-morning-plan case. No `_v2` spare, decided (lower frequency, real volume unknown). HX SID `HX29c10ebad1290a1787e8ef14142ef4fc`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 3 | `quoco_morning_nudge` | Utility | primary | 2026-08-22 | approved | HX SID `HX2f27f49f21a78bcbaa5979b3814a74ee`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 3v2 | `quoco_morning_nudge_v2` | Utility | spare (II5) | 2026-08-22 | approved | Shadows #3. HX SID `HXde34b57ee3cacc6992d824a5fb5aaeca`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 4 | `quoco_evening_nudge` | Utility | primary | 2026-08-22 | approved | HX SID `HX924ac2ad140714650e335b4080cc70f7`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 4v2 | `quoco_evening_nudge_v2` | Utility | spare (II5) | 2026-08-22 | approved | Shadows #4. HX SID `HXc491d3066c4d96363102913684a1e100`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 5 | `quoco_manager_missed` | Utility | primary | 2026-08-22 | approved | HX SID `HXb1cbd3a369bc35066b16594fb1f4605d`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 6 | `quoco_dpr_ready_pm` | Utility | primary | 2026-08-22 | approved | Has a CTA URL button (Y5) — verify button component renders correctly in Meta's preview before submitting, not assumed from the markdown. HX SID `HX4157f93a43a8e368dee0d65e4c7cd1b9`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 7 | `quoco_dpr_owner_email_sent` | Utility | primary | 2026-08-22 | approved | Renamed from `quoco_dpr_owner` — owner receives DPR by email, not WhatsApp (#67 revision 3). Confirm this template is still needed at all before submitting; if the owner-delivery channel is fully email, this WhatsApp template may be dead copy. **Flagged, not resolved here.** HX SID `HX05db0248db95bfe2c0d15130ae318ce3`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 8 | `quoco_engineer_optin` | Utility | primary | — | **NOT SUBMITTED — hard gate (2026-08-21, confirmed)** | Carries the written "reply STOP" promise (Y5). The send path respects `messaging_blocked`, but no application code ever sets it `true` (BOT-27 SET-HALF, CLAUDE.md, open since 2026-08-10) — a STOP reply is currently ignored and the engineer is messaged again at 08:30 the next day. Beyond the broken promise, opt-out non-compliance affects the number's quality rating under Meta's own rules. **This is a SUBMISSION gate, not a send gate**: an approved template sits in the account and any send path (cron, onboarding route, a manual test) can reach for it, so leaving it unapproved is what makes the gate self-enforcing rather than dependent on everyone remembering. See `docs/whatsapp-templates.md`'s own HARD GATES section (GATE 2), same wording. |
| 9 | `quoco_dpr_silent_day` | Utility | primary | 2026-08-22 | approved | HX SID `HX7656906f093f11a4089a67ead44b579a`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 10 | `quoco_dpr_delayed` | Utility | primary | 2026-08-22 | approved | HX SID `HXd21b3079006f846f05df3b9e04fb1c41`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 11 | `quoco_dpr_pause_expired` | Utility | primary | 2026-08-22 | approved | HX SID `HXd4aedad0f2755c9b400bc1bf74fb6c4c`, approval request status `approved` (2026-08-23, ~20h after submission) |
| 14 | `quoco_dpr_owner_no_report` | Utility | primary (NEW, 2026-08-31, §37(d)) | — | not submitted | First owner-facing WhatsApp template in the product. Second sentence is load-bearing (`whatsapp-templates.md`'s own note) — without it the body ends on `{{2}}`, an automatic-rejection condition. Compliance audit: 6/6 pass. Dry run only this pass (`npx tsx scripts/submit-templates.ts`, no `--submit`) — Aravind submits, credentials are on his machine. |
| 12 | `quoco_safety_alert_pm` | Utility | primary | — | not submitted | Fast-Follow — do not submit ahead of the Fast-Follow build; submitting a template for a flow that doesn't exist yet risks an unused-template quality-signal issue with Meta. |
| 13 | `quoco_login_otp` | Authentication | primary | — | not submitted (orphaned Content resource deleted 2026-08-22) | VERIFY the 10-minute expiry figure against the real OTP config before submitting — copy deck flags this as unsourced from a repo constant. **2026-08-22 real submission attempt**: Content created successfully — HX SID `HXff09a18d330a110d879380fcc7a85c0f` (`twilio/text` type, per this script's current build) — but the `ApprovalRequests/whatsapp` call failed, HTTP 400: `"Only whatsapp/authentication is valid for category AUTHENTICATION, but provided content is for the twilio/text type"`. Confirms, with a real API response, the caveat already flagged in this template's own copy-deck entry. **DELETED, same day**: `DELETE https://content.twilio.com/v1/Content/HXff09a18d330a110d879380fcc7a85c0f` returned `204`; a follow-up `GET` on the same SID confirmed `404` — the resource is gone and `quoco_login_otp` is free to re-create under that same `friendly_name`, since it was never actually submitted to Meta (no 30-day lock). **Root cause is deeper than a script bug, researched 2026-08-22 (see Twilio's `whatsapp/authentication` docs):** this content type's body is **not author-supplied at all** — Meta provides fixed, pre-approved boilerplate. The real create payload shape is `types: { "whatsapp/authentication": { add_security_recommendation: bool, code_expiration_minutes: 1-90, actions: [{ type: "COPY_CODE", copy_code_text: string }] } }` — no `body` field exists to hold this template's current copy ("Your Quoco login code is {{1}}. This code expires in 10 minutes."). The OTP value itself is never part of create/approval; it's supplied at *send* time via `ContentVariables={"1": "..."}` (must be <15 chars). **Consequence: template 13's design in `docs/whatsapp-templates.md`, not just `scripts/submit-templates.ts`'s code, needs revisiting before any resubmission** — decide `add_security_recommendation` (likely `true`, matching Meta's own recommended safety line), set `code_expiration_minutes: 10` (reproduces this template's stated intent structurally instead of in prose), and pick `copy_code_text` wording. **Not fixed here — research and record only, per explicit instruction; no code or copy-deck change made in this pass.** **KNOWN SCRIPT FALSE POSITIVE (2026-08-31), FLAGGED FOR WHOEVER RESUBMITS THIS ROW:** the deleted `HXff09a18d...` SID quoted above, sitting in this row's own Notes, currently causes `scripts/submit-templates.ts`'s `loadAlreadySubmitted` to treat template 13 as already-submitted and silently skip it on every future `--submit` run — the skip's own HX-pattern regex can't tell "a live submission" from "an SID merely mentioned in this row's prose." Harmless while 13 stays correctly un-submitted for the design reasons above, but when this row IS actually ready to resubmit, that skip will need to be understood and worked around, not just trusted. Full finding and the argued fix (key on the Status cell, not a regex over Notes): `loadAlreadySubmitted`'s own comment in `scripts/submit-templates.ts`. |
| 1v3 | `quoco_morning_checkin_v3` | Utility | re-cut (2026-08-31, not a spare) | 2026-08-31 | received | Re-cuts #1 with approved copy from Aravind. Compliance audit: 6/6 pass. `docs/whatsapp-templates.md`'s "Re-cut variants" section has the full copy and audit detail. Does not repoint `templates.ts` — #1's own SID keeps sending live traffic until a separate change. HX SID `HXbb534f41c814a2c3a32b5682713579df`, approval request status `received` (submitted 2026-08-31) |
| 2v3 | `quoco_evening_checkin_v3` | Utility | re-cut (2026-08-31, not a spare) | 2026-08-31 | received | Re-cuts #2 with approved copy from Aravind; drops `{{3}}` (morning-plan echo) per `design-decisions-beta-feedback.md` §40, which supersedes §28(s). Compliance audit: 6/6 pass. Retires #2b going forward (2b's own approval and SID are untouched — it just stops being the design once the repoint happens). HX SID `HX8fb39a251eee9bfb2ec075086cd7800a`, approval request status `received` (submitted 2026-08-31) |
| 8v2 | `quoco_engineer_optin_v2` | Utility | re-cut (2026-08-31, not a spare) | 2026-08-31 | received | Re-cuts #8 with the false "Reply STOP" promise (§29(a)) removed, per direct instruction. **The STOP line is omitted, not replaced** — checked directly against `docs/plans/adhoc-menu-spec.md`: the ad-hoc menu (§29(b)'s real opt-out route) is decided, not built, so nothing true can be said about an opt-out route yet. Compliance audit: 6/6 pass. Not blocked by GATE 2's literal name match (`quoco_engineer_optin` ≠ `quoco_engineer_optin_v2`); #8 itself remains held under GATE 2, unchanged. **Rejection contingency, recorded before submission (Aravind, 2026-08-31):** this template carries no opt-out language at all — honest, and expected to clear review as business-initiated onboarding, not marketing. If Meta rejects it wanting an opt-out line, the fix is building §28(x)/§29(b)'s ad-hoc menu first, then re-cutting the copy again — never inventing a promise ahead of the mechanism that keeps it. Full text: `docs/whatsapp-templates.md`'s 8v2 section. HX SID `HX40923a2de0fa55ea4e7335607c9a1bb9`, approval request status `received` (submitted 2026-08-31) |

## Pre-submission compliance audit — why it happened before this batch, not after
(recorded 2026-08-23, on the strength of a zero-rejection result)

**The audit (2026-08-21, "Twilio/Meta compliance audit" — visible today as the
"AUDIT FIX" annotations throughout `docs/whatsapp-templates.md`) prevented **10 of
the 16 submitted templates** from being rejected by Meta**, catching three
distinct rule violations before any template ever reached a real review:
start/end-variable placement (a body may not open or close on a `{{n}}`
variable), variable adjacency (`{{1}} ({{2}})` and similar — two variables with
no literal text separating them), and the variable-to-text word ratio. Real,
grep-able evidence of the fixes this produced: 13 separate "AUDIT FIX
(2026-08-21, Twilio/Meta compliance audit)" annotations across the templates in
`docs/whatsapp-templates.md`, each naming the specific rule the original copy
violated and the corrected wording.

**Why this is worth keeping as a standing justification, not just a one-time
note:** a Meta rejection **locks the rejected template's `friendly_name` for
30 days** — a genuine cost, not an inconvenience-only failure, since the name
can't simply be resubmitted with a fix under the same identity; it either sits
locked for a month or ships permanently under a different name (a real
consequence for anything already referenced by that name in code, copy decks,
or this log). Weighed against that, the audit's own cost was one review pass
before submission, and the payoff was directly observed: **all 16 real
submission attempts avoided a start/end-variable, adjacency, or word-ratio
rejection, and 15 of them went on to real Meta approval with zero rejections of
any kind** (§ "Log" above; the sixteenth, template 13, failed on an unrelated
content-type/category mismatch the audit's three rules don't cover — see its
own row). Whether every one of the 10 would in fact have been rejected without
the fix isn't independently re-provable after the fact (the audit ran before
submission, by design — there is no un-fixed control group to submit and
check), but the batch's own zero-rejection outcome is the strongest available
evidence the audit worked as intended. **Run this same audit before any future
template batch, not after a rejection makes it necessary.**

## Submit / hold list (2026-08-21, GATE 2 confirmed as a submission gate same day)

**Checked against this log's own existing Notes column before answering — the expected
"16 submit, template 12 holds" does not hold as stated.** Two templates are already
recorded as holds, not one: this log's own row 8 already reads *"do not submit/activate
live sending on this template until that gap closes"* (the BOT-27 set-half gap) — a
genuine pre-existing hold, not new. **16 is still the right submit COUNT, but only
because the batch itself grew by one (the new 2b template) in the same pass this
question was asked — 18 total, 2 hold, 16 submit — not 17 total with only 1 hold.**

**HOLD (2):**
- **8 `quoco_engineer_optin`** — **NOT SUBMITTED** (confirmed 2026-08-21 as a
  submission gate, not merely a send gate — an approved template sits in the account
  and any send path can reach for it, so gating submission is what makes this
  self-enforcing). The template's body promises "reply STOP"; the send path respects
  `messaging_blocked`, but no application code ever sets it `true`, so a STOP reply is
  currently ignored and the engineer is messaged again the next day — beyond the
  broken promise, this affects the number's quality rating under Meta's own rules.
  Lifts when the BOT-27 SET-HALF is built and verified.
- **12 `quoco_safety_alert_pm`** — Fast-Follow, unbuilt; additionally, its CTA button
  has no URL to give Meta at all (checked directly this pass — no dashboard route
  exists for a safety-report detail view).

**SUBMIT (16):** 1, 1v2, 2, 2b, 2v2, 3, 3v2, 4, 4v2, 5, 6, 7, 9, 10, 11, 13.

**REAL SUBMISSION RUN, 2026-08-22 (`npx tsx scripts/submit-templates.ts --submit`):** 15 of
the 16 fully succeeded (Content created + approval request accepted, status `received`
for each — see their individual rows above for HX SIDs). **Template 13 (`quoco_login_otp`)
did not** — its Content resource was created but the approval request was rejected by a
real content-type mismatch (see row 13 above). Hard exclusion held throughout: templates 8
and 12 never appeared as a create/approval attempt anywhere in the run, only as their
expected `SKIP (hard-excluded in code)` lines. The batch stopped immediately at template
13's failure, per this script's own design — nothing after it in submission order was
attempted (there was nothing after it; 13 is last in this batch's processing order).

**REAL APPROVAL-STATUS CHECK, 2026-08-22, same day** (`GET
https://content.twilio.com/v1/Content/{HX}/ApprovalRequests` for each of the 15 real HX
SIDs above — read-only, no mutation): **all 15 show `whatsapp.status: "pending"`, empty
`rejection_reason`.** None approved, none rejected yet — every one of them, including
templates 9 (`quoco_dpr_silent_day`) and 10 (`quoco_dpr_delayed`), whose bodies place
`{{2}}` before `{{1}}` in reading order, is still awaiting Meta's review with **no
rejection drawn so far**. Recorded as a point-in-time reading, not a final outcome — Meta
review is asynchronous; re-check later for the actual approve/reject verdicts.

**RE-CHECKED, 2026-08-22 (same read-only query, re-run):** unchanged — all 15 still
`status: "pending"`, `rejection_reason` empty for every one. Zero approved, zero rejected.
No rejection to analyze against the six-rule compliance audit or otherwise. This check is
re-runnable at any time; re-run again once Meta's review actually resolves.

**RE-CHECKED AGAIN, 2026-08-22 (same read-only query, re-run):** still unchanged — all 15
still `status: "pending"`, `rejection_reason` empty for every one. Zero approved, zero
rejected. Meta's review has not resolved for any of the 15 as of this check.

**FINAL RE-CHECK, 2026-08-23 (same read-only query, re-run against all 15 real HX SIDs
— not re-derived from a screenshot or an earlier reading):**

```
template_name | status | rejection_reason
quoco_morning_checkin | approved | -
quoco_morning_checkin_v2 | approved | -
quoco_evening_checkin | approved | -
quoco_evening_checkin_v2 | approved | -
quoco_evening_checkin_no_plan | approved | -
quoco_morning_nudge | approved | -
quoco_morning_nudge_v2 | approved | -
quoco_evening_nudge | approved | -
quoco_evening_nudge_v2 | approved | -
quoco_manager_missed | approved | -
quoco_dpr_ready_pm | approved | -
quoco_dpr_owner_email_sent | approved | -
quoco_dpr_silent_day | approved | -
quoco_dpr_delayed | approved | -
quoco_dpr_pause_expired | approved | -

approved=15 pending=0 rejected=0 other=0 total=15
```

**All 15 APPROVED.** Zero rejections, zero still-pending. Elapsed time from the real
submission run (2026-08-22, the batch this log's own "REAL SUBMISSION RUN" entry
above records) to this final approved reading (2026-08-23): **~20 hours** —
recorded as a data point for sizing the review-wait on any future submission batch,
not a guaranteed turnaround (Meta review is asynchronous and this is a sample size
of one batch).

**Not a hold, but worth carrying into the submission decision — row 7's own existing
open question:** *"Confirm this template is still needed at all before submitting;
if the owner-delivery channel is fully email, this WhatsApp template may be dead
copy."* Nothing in this pass resolved that question one way or the other; it's on the
submit list because nothing explicitly says "do not submit," not because the question
was answered.

## No outbound-send code exists — GATE 1 is self-enforcing (2026-08-21)

**Grepped `app/`, `lib/` directly: `TWILIO_ACCOUNT_SID` has zero readers anywhere in this
repo.** The only two Twilio env vars any code path reads are `TWILIO_AUTH_TOKEN`
(inbound webhook signature validation, `app/api/whatsapp/webhook/route.ts:122`) and
`TWILIO_WHATSAPP_NUMBER` (cosmetic CTA display only, `app/(dashboard)/daily-logs/
page.tsx:69`) — full trace in `docs/twilio-sender-swap-runbook.md` §1. Neither
constructs or sends an outbound WhatsApp message; this system can only reply inside a
webhook's own HTTP response (CLAUDE.md §3's STANDING ARCHITECTURAL FACT).

**Consequence for this log: an approved Meta template cannot actually be SENT by
anything in this codebase today, submission notwithstanding.** No `dpr_generate`
template-send call, no cron-triggered template initiation, no code path anywhere
constructs a Twilio outbound API call at all — that capability is the #69/031
outbound-send primitive, not yet built. This makes `docs/whatsapp-templates.md`'s own
GATE 1 (no template may be SENT until the flow migration matches submitted copy)
**currently self-enforcing for every template in this log, not just template 1**: there
is no send path for ANY of them to reach yet, so nothing here can violate GATE 1 by
accident before #69/031 ships. Submission (Meta review) is unaffected by this — Meta
approval is a WABA-account-level operation, independent of whether this app's own code
can yet call it (see CLAUDE.md §0's provider-console-is-source-of-truth rule, same day).
Approval now, followed by the outbound-send primitive shipping later, is the intended
order — not a reason to hold submission back.

## Spare-activation policy

A `_v2` spare is submitted to Meta **alongside** its primary, not held back until the
primary is rejected — the whole point is having an approved fallback ready without a
second review round-trip. It is **not activated for live sending** unless its primary is
rejected or later disabled. Activating a spare (switching production to send it instead
of the primary) is a code change (the outbound-send call site's template name), tracked
separately from this log — this file only tracks Meta's own review state per template
name.

## Production WABA sender — exists in Twilio, not wired to the app (2026-08-21)

**Correction to an earlier same-day reading:** a repo-only check concluded "the sandbox is
still the only configured sender" — correct about what this app is wired to reach
(§ above; `TWILIO_WHATSAPP_NUMBER`/`TWILIO_AUTH_TOKEN` are the sandbox's), **wrong about
what the Twilio account actually holds.** The Twilio console shows a registered production
WABA sender already provisioned: `+919940875600`, display name "Quoco", status Online, WABA
ID present. See CLAUDE.md §0's new standing rule (provider console is the source of truth
for third-party account state) — this correction is its origin case.

**Consequence for this log specifically: template submission is unblocked.** Meta template
review/approval is a WABA-account-level operation (Twilio Content API), independent of
which number the app currently sends live traffic through — the sandbox-vs-production
wiring question (`docs/twilio-sender-swap-runbook.md`, still "WRITTEN, NOT EXECUTED") is a
separate, later step from submitting these 18 templates for approval now.

## Answered-on-attempt — resolved by console action, not research

**Correction (this pass): the two items below were originally logged as "open questions"
requiring research before submission could start. That framing was wrong.** Both are
answered by attempting the action in WhatsApp Manager, not by looking anything up first
— submission is free and non-destructive, and a block returns an error naming the
reason, which is a more precise answer than any documentation search would give (Meta's
own docs give a general answer; pre-verification behavior varies by account tier and
region, so only this account's console has the specific one). Neither blocks writing or
committing template copy; the action to take is already fully known — only the result is
outstanding, and it gets filled in the moment Aravind runs it, not before.

| Item | How it's answered | Result |
|---|---|---|
| Pre-verification submission | Attempt submitting one template in WhatsApp Manager. Free, non-destructive — a block returns an error naming the reason. | **CLOSED, 2026-08-23: YES, submission (and full approval) is permitted pre-verification.** Strengthened from the 2026-08-22 reading (15 accepted, `status: received`) to the strongest possible evidence: **all 15 templates reached `status: "approved"` on 2026-08-23, with no business verification completed on this account at any point in between.** Not merely "not blocked at submission" — proven all the way through to a real Meta approval. |
| Display-name approval status | Read the status field directly in WhatsApp Manager. | **CLOSED, 2026-08-23: APPROVED.** Confirmed directly in WhatsApp Manager, Profile tab, per Aravind's own console check (not observable via the Content API — its `Content`/`ApprovalRequests` endpoints are per-template and carry no account-level display-name field, confirmed again this pass). Display name "Quoco" is the approved, live name for the production WABA sender (`+919940875600`, per this log's own "Production WABA sender" section above). |
| Messaging tier | Read from WhatsApp Manager at the same time as the two rows above — determines when the recipient cap (250/24h if display name is rejected, or the tier's own cap otherwise) starts mattering, worth capturing at the same moment rather than as a separate check later. | **CLOSED, 2026-08-23: 250 business-initiated conversations per rolling 24 hours** (the unverified-business tier — confirmed in WhatsApp Manager, same console check as display-name status above). Business verification raises this to **2,000 within 24 hours** — recorded as a **cofounder task, not engineering** (WhatsApp Business Manager account-level verification, outside anything this codebase or its API credentials can do). **The limit counts CONVERSATIONS, not messages** — a 24-hour window opens on the first business-initiated message to a given recipient, and every business-initiated message to that same recipient inside that window is the SAME conversation, not an additional one against the cap. Consequence for this project specifically: the 08:30 IST morning trigger and the 18:30 IST evening trigger, sent to the same engineer on the same day, fall inside **ONE** conversation, not two — the second send does not open a new 24-hour window or consume a second unit of the 250 cap. **§29's cost model assumes per-message billing — flag that assumption for re-checking against a real Twilio invoice once the outbound-send primitive (#69/031) actually sends traffic; per-conversation billing and per-message billing produce materially different cost curves at scale, and this log cannot verify which one the real invoice reflects.** |

**All three rows CLOSED as of 2026-08-23** — none open. `Pre-verification submission` was
already answered as of the prior pass and is restated above with the stronger, final
evidence (approval, not just acceptance); `Display-name approval status` and
`Messaging tier` were the two genuinely open items this section's own header text refers
to, both closed this pass via the same WhatsApp Manager console check.

Related staleness, unresolved by this table but recorded so it isn't lost: per `git
show`/repo state at the time HH1/HH2 were written, CLAUDE.md's Week 2 checklist (§10,
items 5–6) still literally reads "BLOCKED ~2 weeks on company registration" / "BLOCKED,
same dependency" — text that predates both the WABA/production-sender existing (per
HH1's own premise) and the Y1–Y5 template redesign (still says "12 WhatsApp templates,"
not 13+4). Correct that once the three rows above are filled in — not guessed at here,
since a wrong replacement date is worse than a stale-but-honest one.
