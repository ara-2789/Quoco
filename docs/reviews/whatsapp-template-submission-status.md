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

## Spare-activation policy

A `_v2` spare is submitted to Meta **alongside** its primary, not held back until the
primary is rejected — the whole point is having an approved fallback ready without a
second review round-trip. It is **not activated for live sending** unless its primary is
rejected or later disabled. Activating a spare (switching production to send it instead
of the primary) is a code change (the outbound-send call site's template name), tracked
separately from this log — this file only tracks Meta's own review state per template
name.

## Open questions — not resolved in this pass, flagged for Aravind

1. **Pre-verification submission (unresolved, referenced earlier this session as "GG2"
   but never written down anywhere in this repo or the claude.ai project as visible from
   here):** can templates be submitted to Meta before Business verification completes, or
   does submission require a verified WABA first? Not something this repo can answer —
   needs either Meta's own documentation for the current WABA state, or Aravind's direct
   knowledge from the Business Manager console. **Blocks starting the actual submission
   run for all 17 rows above**, not just a detail to fill in later.
   - Related: per `git show`/repo state at the time HH1/HH2 were written, the CLAUDE.md
     Week 2 checklist (§10, items 5–6) still literally reads "BLOCKED ~2 weeks on company
     registration" / "BLOCKED, same dependency" — text that predates both the WABA/
     production-sender existing (per HH1's own premise) and the Y1–Y5 template redesign
     (still says "12 WhatsApp templates," not 13+4). **This is stale and should be
     corrected once the current WABA/verification state is confirmed** — not corrected
     blind in this pass, since guessing the replacement text risks recording the wrong
     resolution date.
2. **WhatsApp Business display-name approval status:** not checkable from this repo —
   Meta's own Business Manager console is the only source of truth, and a rejected
   display name caps sends at 250 conversations/24h regardless of template approval
   state. Needs a direct check in the console (or a `claude-in-chrome` session against
   it, if Aravind wants that route) before relying on template approval alone as the
   readiness signal for production sending.

Neither open question blocks writing/committing the spare templates or this log — both
block the actual submission run, which stays unstarted until they're answered.
