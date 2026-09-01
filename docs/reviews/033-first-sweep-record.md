# Migration 033 (B3) — first real sweep of a genuinely parked session

**Recorded 2026-09-01, read-only against production (`jvxwqignooseazzmwhvl`, linked and
confirmed via `supabase link --project-ref` before every query in this record), all
timestamps taken from the database itself, not asserted from memory of a WhatsApp thread.**
This is the closing artifact `docs/reviews/033-apply-record.md`'s own "Open items — status"
section marked **PENDING** on 2026-08-25: *"The first real 15:00 IST production run of
`sweep_stale_morning_sessions`, triggered by the live `jobs/tick` cron, has not happened yet
as of this record."* It has now happened, on a real parked session, for the first time. This
record closes that item — with one sub-part still open, named precisely in §4 below, not
silently marked done.

**Correcting a mislabeled citation before anything else, per this project's own "audit every
cross-reference" rule:** the PENDING closing artifact lives in `033-apply-record.md`'s "Open
items — status" section, not in `docs/reviews/first-cron-fire-record.md` (that file records a
different mechanism entirely — the outbound-send *trigger* cron's 2026-08-29 Twilio failures
— and never mentions the morning-cutoff sweep at all). Filed here under the correct name.

## 0. The correction this record exists to make

The premise this investigation started from — that B3 "did not fire" today — was wrong, and
it was wrong for a specific, useful-to-name reason: **the correction came from the reply
text, not from the data.** At 18:16 IST the engineer sent "No" and received
`EVENING_WINDOW_NOT_OPEN_REPLY` ("It's not yet time for your evening check-in — it will be
sent automatically.") rather than having "No" accepted as an answer to Q4 (equipment). Read
against `lib/whatsapp/inbound-start.ts`'s `routeInboundMessage`, that specific reply string is
diagnostic, not incidental: it is returned *only* from the branch reached when
`readCurrentFlow` returns `null` (no active session) **and** `morningSubmitted` is true
**and** the clock sits before `CHECKIN_CHECKPOINTS.eveningSend` (18:30 IST). Had the session
still been parked at morning step 4, `currentFlow` would have read `'morning'`,
`routeInboundMessage` would have delegated to `dispatchInboundTurn` instead of returning any
of the four static idle replies, and "No" would have landed as morning Q4's own answer — most
likely classified as "no equipment," not idle-flow copy. **The exact reply string proves the
session was already closed; the underlying `daily_logs`/session data, read without
correlating it against `inbound-start.ts`'s own branch logic, would not by itself have
distinguished a genuinely-swept session from other superficially similar states.** That
correlation is what this record verifies end to end below.

## 1. Today's `daily_logs` row, printed in full

`log_date = '2026-09-01'`, `project_id = acef67fe-e775-439d-82b8-5b8526868d6d` (Speed
Mechatronics), `engineer_id = 3534756b-2a32-4b91-954b-0bab15c2dba1` (Vikram Rao, the sole
real production user across every record in this directory to date — confirmed for this
record too, §3):

| field | value |
|---|---|
| `attendance` | `present` |
| `attendance_defaulted` | **`false`** |
| `attendance_raw` | `"Yes"` |
| `morning_plan` | `"Cement work in factory phase 2"` |
| `morning_manpower` | `{"by_trade": [], "raw_text": "12", "total": 12}` |
| `morning_equipment` | **`null`** |
| `morning_submitted_at` | `2026-09-01 09:30:13.677637+00` |
| `evening_submitted_at` | `2026-09-01 13:02:02.104713+00` |

**`morning_submitted_at` converts to 15:00:13 IST** (`09:30:13 UTC + 5:30`) — inside the same
second as B3's own `p_now` argument at the cutoff, not merely "sometime that afternoon."
`attendance_defaulted = false` confirms the engineer answered Q1 (attendance) himself; only
the *closing* of the session — advancing it past wherever it was genuinely stuck — was
automatic. `morning_plan` (Q2) and `morning_manpower` (Q3) are both populated and untouched by
the sweep; `morning_equipment` (Q4) is `null`. Per migration 033's own per-step behaviour
table (`033-sweep-review-package.md` §2), this shape — plan answered, workers answered,
equipment absent — is the signature of a session parked at **`current_step = 4`**: the
`UPDATE ... morning_submitted_at` branch, which stamps the timestamp and writes nothing else,
never touching `attendance`/`morning_plan`/`morning_manpower`. This is a truncated flow, not
lost data — nothing here was overwritten or discarded, Q4 (equipment) was simply never
reached before the 15:00 cutoff swept the session closed.

## 2. The session row, and why it can no longer show the sweep's own intermediate state

```json
{
  "phone_number": "+919176865600",
  "current_flow": null,
  "current_step": 0,
  "context": {"evening_submitted": true, "morning_submitted": true},
  "updated_at": "2026-09-01 13:02:02.104713+00"
}
```

This is the session's **current** state — not a state captured at 15:00 IST. `updated_at`
here is byte-identical to `evening_submitted_at` above (13:02:02.104713+00 = 18:32:02 IST):
the evening flow completed on this same row later the same day and overwrote whatever the
sweep itself had written at 15:00 (`current_flow: 'morning' → null`, `current_step: 4 → 0`,
`context` gaining `morning_submitted: true`) with its own completion write (`context` gaining
`evening_submitted: true`, a fresh `updated_at`). **The sweep's own intermediate row state
— what `whatsapp_sessions` looked like between 15:00:13 IST and the 18:30 IST evening
trigger — was never captured live and cannot be reconstructed from the current row; that
specific window has closed.** What *can* be shown, and is shown here, is the sweep's
*effect*, reconstructed from `daily_logs` (§1) and from the reply behaviour it produced
downstream (§0, §3) — a different, indirect evidence path, correctly distinguished from a
live before/after bracket rather than presented as one.

**Ruling out the multi-project skip path, checked, not assumed:**

```sql
SELECT count(*), array_agg(project_id) FROM project_members WHERE user_id = '...';
-- {"project_count": 1, "project_ids": ["acef67fe-e775-439d-82b8-5b8526868d6d"]}
```

Exactly one membership — this session could never have hit migration 033's `skippedSessions`
branch (§5 of the review package), independent of anything else in this record.

**Confirming this is the only session in the table**, so "the sweep" for today means exactly
this one row:

```sql
SELECT phone_number, current_flow, current_step, updated_at FROM whatsapp_sessions;
-- one row: +919176865600, current_flow: null, current_step: 0
```

## 3. The sweep's own tick return, and Sentry — what is and isn't closed here

**The literal `morningSweep` JSON object `runJobsTick` returned on the 15:00 IST tick was
never captured and is not recoverable now.** This environment has no Vercel CLI/dashboard
access (a standing, repeated limitation elsewhere in this project's own records), so the
tick's raw HTTP response — the exact artifact `033-apply-record.md`'s PENDING note asked for
"exactly as returned, not paraphrased" — is not available for this record. What is available
instead, and is a materially different evidence class, is every externally-observable
consequence of that return value: the `morning_submitted_at` stamp (§1), the session close
(§2), and the downstream reply behaviour (§0) — all consistent with `swept_count: 1,
skipped_count: 0, missing_daily_logs_rows: [], skipped_sessions: []`, but reconstructed, not
read directly off the return value itself. **This sub-item of the PENDING note stays open, not
silently closed** — see §4.

**Sentry: not directly queried this record (no authenticated Sentry MCP session here, and
completing that OAuth flow requires a live human round-trip out of scope for a read-only
capture) — reasoned instead from the code against the confirmed data, a weaker evidence class
than a direct query, stated as such rather than reported as observed.** `033`'s own external
review round 1 (§13.2, B2) wired exactly two `Sentry.captureMessage` triggers:
`skippedSessions` entries and `missingDailyLogsRows` entries. Neither condition was met here
— §2 confirms exactly one project membership (not skipped), and §1's `morning_submitted_at`
being populated proves the `UPDATE` affected a real row (`GET DIAGNOSTICS ... ROW_COUNT`
would have been `0` and populated `missing_daily_logs_rows` otherwise — it wasn't). By the
code's own construction, no Sentry event should exist for this row. Not confirmed by reading
Sentry directly; confirmed by the two conditions that would have produced one both being
false.

## 4. Evening template selection — the WITH-plan variant, confirmed by `content_sid`

`morning_plan` was preserved through the sweep (§1: `"Cement work in factory phase 2"`, never
`null`), so per `design-decisions-beta-feedback.md` §28(s) the WITH-plan evening template
should have been selected at the 18:30 IST trigger. Checked directly against `outbound_sends`:

```json
{
  "event_key": "evening_send:2026-09-01",
  "status": "sent",
  "content_sid": "HX48e6eab79b422dd4351071f67827881c",
  "twilio_sid": "MM3fedcfa460329f6243682892245c4068",
  "error": null,
  "created_at": "2026-09-01 13:00:13.798588+00"
}
```

`HX48e6eab79b422dd4351071f67827881c` is `EVENING_CHECKIN_SID` in
`lib/whatsapp/outbound/templates.ts:13` — `quoco_evening_checkin`, the **WITH-plan** variant
(`{{1}}` name, `{{2}}` project, `{{3}}` morning plan), not `EVENING_CHECKIN_NO_PLAN_SID`
(`HX29c10ebad1290a1787e8ef14142ef4fc`). Confirmed, not assumed. `created_at` converts to
18:30:13.798588 IST — inside the same second as the 18:30 IST trigger checkpoint — and
`status: 'sent'` with a real `twilio_sid` and no `error` is a clean synchronous accept.

## 5. The productive/idle answer — recorded as field evidence, third sample

"No , no work for 4" — the engineer's own evening Q4-step-2 answer — is captured in full,
traced against the live `parseProductivity` parser and `evening.ts`'s own reconciliation
logic, as **Sample 3** in `docs/reviews/field-samples.md` (added this record, same session).
Not duplicated here; see that file for the full trace of how `idle_count: 4`, `idle_reason:
"work for"`, and the derived `productive_count: 12` were each produced, code-verified line by
line rather than assumed from the stored JSON's shape alone.

## Summary — what's closed, what isn't

**Closed, directly observed:** the 15:00 IST cutoff stamped the correct historical row
(§1, to the second); `attendance_defaulted: false` confirms only the *close* was automatic,
not the attendance answer; the truncation is at step 4 exactly as the migration's own
per-step table predicts; the session is closed today (§2); no multi-project skip applies
(§2); no anomaly condition that would raise Sentry was met, reasoned from code against
confirmed data (§3); the WITH-plan evening template was correctly selected and sent (§4); a
real productive/idle answer was captured and now lives in the field-samples corpus (§5).

**Still open, named rather than papered over:** the literal `morningSweep` tick-return JSON
object was never captured and cannot be recovered retroactively (§3); a live
before/after `whatsapp_sessions` bracket around the 15:00 IST run specifically was not taken
in real time and can no longer be taken now that the row has been overwritten by the evening
completion (§2); the "no Sentry event" conclusion is a code-level deduction, not a direct
Sentry query (§3). `033-apply-record.md`'s PENDING item is updated to reflect this split
rather than marked fully CLOSED.

## What this record does not do

No code changed. Nothing here alters migration 033's design, `parseProductivity`'s
AGGREGATE-ONLY v1 decision, or any open item elsewhere in this directory — this is a
read-only capture, same discipline as every other finding-not-fix record here.
