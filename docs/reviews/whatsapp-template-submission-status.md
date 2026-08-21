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
| 1 | `quoco_morning_checkin` | Utility | primary | — | not submitted | |
| 1v2 | `quoco_morning_checkin_v2` | Utility | spare (II5) | — | not submitted | Shadows #1. Hold in reserve; see "Spare-activation policy" below. |
| 2 | `quoco_evening_checkin` | Utility | primary | — | not submitted | |
| 2v2 | `quoco_evening_checkin_v2` | Utility | spare (II5) | — | not submitted | Shadows #2. |
| 2b | `quoco_evening_checkin_no_plan` | Utility | primary (NEW, 2026-08-21, §28(s)) | — | not submitted | No `{{3}}` — the no-morning-plan case. No `_v2` spare, decided (lower frequency, real volume unknown). |
| 3 | `quoco_morning_nudge` | Utility | primary | — | not submitted | |
| 3v2 | `quoco_morning_nudge_v2` | Utility | spare (II5) | — | not submitted | Shadows #3. |
| 4 | `quoco_evening_nudge` | Utility | primary | — | not submitted | |
| 4v2 | `quoco_evening_nudge_v2` | Utility | spare (II5) | — | not submitted | Shadows #4. |
| 5 | `quoco_manager_missed` | Utility | primary | — | not submitted | |
| 6 | `quoco_dpr_ready_pm` | Utility | primary | — | not submitted | Has a CTA URL button (Y5) — verify button component renders correctly in Meta's preview before submitting, not assumed from the markdown. |
| 7 | `quoco_dpr_owner_email_sent` | Utility | primary | — | not submitted | Renamed from `quoco_dpr_owner` — owner receives DPR by email, not WhatsApp (#67 revision 3). Confirm this template is still needed at all before submitting; if the owner-delivery channel is fully email, this WhatsApp template may be dead copy. **Flagged, not resolved here.** |
| 8 | `quoco_engineer_optin` | Utility | primary | — | not submitted | Carries the written "reply STOP" promise (Y5). CLAUDE.md's BOT-27 entry names the missing set-half (`messaging_blocked` is never set true) a pre-launch blocker tied specifically to this template — do not submit/activate live sending on this template until that gap closes, since the promise it makes would be false in production today. |
| 9 | `quoco_dpr_silent_day` | Utility | primary | — | not submitted | |
| 10 | `quoco_dpr_delayed` | Utility | primary | — | not submitted | |
| 11 | `quoco_dpr_pause_expired` | Utility | primary | — | not submitted | |
| 12 | `quoco_safety_alert_pm` | Utility | primary | — | not submitted | Fast-Follow — do not submit ahead of the Fast-Follow build; submitting a template for a flow that doesn't exist yet risks an unused-template quality-signal issue with Meta. |
| 13 | `quoco_login_otp` | Authentication | primary | — | not submitted | Different review track from Utility (Authentication category). VERIFY the 10-minute expiry figure against the real OTP config before submitting — copy deck flags this as unsourced from a repo constant. |

## Submit / hold list (2026-08-21) — corrects an assumed count, not just states one

**Checked against this log's own existing Notes column before answering — the expected
"16 submit, template 12 holds" does not hold as stated.** Two templates are already
recorded as holds, not one: this log's own row 8 already reads *"do not submit/activate
live sending on this template until that gap closes"* (the BOT-27 set-half gap) — a
genuine pre-existing hold, not new. **16 is still the right submit COUNT, but only
because the batch itself grew by one (the new 2b template) in the same pass this
question was asked — 18 total, 2 hold, 16 submit — not 17 total with only 1 hold.**

**HOLD (2):**
- **8 `quoco_engineer_optin`** — pre-launch blocker, already recorded above: the
  template's own written "Reply STOP" promise is false in production today
  (`messaging_blocked` is never set `true` by any code path except test fixtures).
- **12 `quoco_safety_alert_pm`** — Fast-Follow, unbuilt; additionally, its CTA button
  has no URL to give Meta at all (checked directly this pass — no dashboard route
  exists for a safety-report detail view).

**SUBMIT (16):** 1, 1v2, 2, 2b, 2v2, 3, 3v2, 4, 4v2, 5, 6, 7, 9, 10, 11, 13.

**Not a hold, but worth carrying into the submission decision — row 7's own existing
open question:** *"Confirm this template is still needed at all before submitting;
if the owner-delivery channel is fully email, this WhatsApp template may be dead
copy."* Nothing in this pass resolved that question one way or the other; it's on the
submit list because nothing explicitly says "do not submit," not because the question
was answered.

## Spare-activation policy

A `_v2` spare is submitted to Meta **alongside** its primary, not held back until the
primary is rejected — the whole point is having an approved fallback ready without a
second review round-trip. It is **not activated for live sending** unless its primary is
rejected or later disabled. Activating a spare (switching production to send it instead
of the primary) is a code change (the outbound-send call site's template name), tracked
separately from this log — this file only tracks Meta's own review state per template
name.

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

| Item | How it's answered | Result (fill in on attempt) |
|---|---|---|
| Pre-verification submission | Attempt submitting one template in WhatsApp Manager. Free, non-destructive — a block returns an error naming the reason. | — |
| Display-name approval status | Read the status field directly in WhatsApp Manager. | — |
| Messaging tier | Read from WhatsApp Manager at the same time as the two rows above — determines when the recipient cap (250/24h if display name is rejected, or the tier's own cap otherwise) starts mattering, worth capturing at the same moment rather than as a separate check later. | — |

Related staleness, unresolved by this table but recorded so it isn't lost: per `git
show`/repo state at the time HH1/HH2 were written, CLAUDE.md's Week 2 checklist (§10,
items 5–6) still literally reads "BLOCKED ~2 weeks on company registration" / "BLOCKED,
same dependency" — text that predates both the WABA/production-sender existing (per
HH1's own premise) and the Y1–Y5 template redesign (still says "12 WhatsApp templates,"
not 13+4). Correct that once the three rows above are filled in — not guessed at here,
since a wrong replacement date is worse than a stale-but-honest one.
