# First successful delivery — 2026-08-31 08:30 IST morning trigger

**Recorded 2026-08-31, read-only against production, breadcrumbed
(`SELECT current_database(), now(), inet_server_addr()` → `postgres` /
`2026-08-31 03:58:08+00` / project `jvxwqignooseazzmwhvl`), re-linked to
test-db (`exfccwlrhoutkgrlikod`) after.** This is the closing artifact for
Pass 1's outbound-send primitive: the first time `app/api/cron/morning-trigger`
fired unattended, constructed a real WhatsApp template message, sent it through
Twilio's production WABA sender, and the message **stayed delivered** — no
synchronous rejection, no asynchronous status-callback flip, nothing left to
diagnose. Three real production failures preceded this one, each found only
after the previous was cleared; this record closes that sequence, not opens a
new one.

## 1. The ledger row

`outbound_sends WHERE event_key = 'morning_send:2026-08-31'`, printed in full,
checked twice four minutes apart (03:58 UTC and 04:02 UTC) to confirm no
late async flip:

| field | value |
|---|---|
| `id` | `5f9b4a3e-9b85-44e4-a700-ef1afe350a29` |
| `created_at` | `2026-08-31 03:00:48.316999+00` (08:30:48 IST) |
| `updated_at` | `2026-08-31 03:00:48.906+00` — **0.6 seconds after `created_at`, and unchanged on the second read four minutes later** |
| `tenant_id` | `adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0` |
| `project_id` | `acef67fe-e775-439d-82b8-5b8526868d6d` (Speed Mechatronics) |
| `recipient_user_id` | `3534756b-2a32-4b91-954b-0bab15c2dba1` (Vikram Rao) |
| `event_key` | `morning_send:2026-08-31` |
| `status` | **`sent`** |
| `content_sid` | `HXd4a896b66bfd7b237f53dc4dca77fb76` (`quoco_morning_checkin`) |
| `to_phone_number` | `+919176865600` |
| `twilio_sid` | `MM1178595975993ab9ba1fb3344da4dd26` |
| `error` | `NULL` |

**It stayed `sent`.** `updated_at` is the timestamp `trigger.ts`'s own
synchronous `'sent'` UPDATE writes at claim time — nothing has touched this
row since. No status-callback POST has flipped it to `failed`, and none of
this system's own async failure paths (`app/api/whatsapp/status-callback/
route.ts`) have fired against this `twilio_sid`. This is the first row in
this table's history to reach `'sent'` and remain there.

**Worth naming directly: the `twilio_sid` prefix is `MM`, not `SM`.** Every
prior send in this table's history — sandbox or otherwise — has also carried
an `MM` prefix (Twilio's WhatsApp/Messaging-channel message SID format); this
is not itself a new signal distinguishing sandbox from production sends, and
is recorded here only because it was checked, not assumed identical to the
`SM` prefix seen on `processed_messages` (an inbound webhook SID, a different
resource type entirely — not comparable).

## 2. Today's `daily_logs` row, in full

`log_date = '2026-08-31'`, `project_id = acef67fe-e775-439d-82b8-5b8526868d6d`,
`engineer_id = 3534756b-2a32-4b91-954b-0bab15c2dba1`:

- **`morning_equipment`** (input: **"2 JCB"**):
  ```json
  {"items": [{"count": null, "daily_hire_cost": 2, "owned_or_hired": null, "raw": "2 JCB", "type": "jcb"}], "none": false, "raw_text": "2 JCB"}
  ```
  **Confirmed, not refuted: `daily_hire_cost = 2`, `count = null`.** This is
  the §33 defect (`lib/whatsapp/flows/parsers/equipment.ts`'s `parseChunk`:
  "First number in the chunk is taken as the daily hire rate... count stays
  null", lines 50-54) meeting real data for a **third** time, after
  "Cement micsur 1000" (2026-08-21) and "Cement mixer - 1 1000" (2026-08-25)
  — both recorded in `design-decisions-beta-feedback.md` §33. Checked
  directly against the live parser code (`equipment.ts`), not inferred from
  the decision record: §33(a) **decided** the fix ("EQUIPMENT CAPTURES UNITS,
  NOT HIRE RATE") but is explicit that this pass was "Record only. No code,
  no migration" — the parser shipped unchanged, so this row's shape is
  exactly what the still-live code produces, not a surprise. A count of 2
  JCBs has been fabricated into a ₹2/day hire rate, live in production data,
  for the third consecutive real occurrence.
- **`morning_manpower`** (input: **"4 helpers"**):
  ```json
  {"by_trade": [{"count": 4, "trade": "helper"}], "raw_text": "4 helpers", "total": 4}
  ```
  Resolved correctly: `canonicalTrade('helpers')` maps to the canonical
  trade `helper` (`lexicon.ts:24`), `total = 4`. This is the post-migration-030
  shape (`morning_manpower`, renamed from `morning_manpower_planned`,
  `{total, by_trade: [{trade, count}], raw_text}`) — confirmed live, not the
  pre-030 `{planned_total, by_trade: [{trade, planned_count}]}` shape.
- **`attendance`**: `present`. **`attendance_defaulted`**: `false`.
  **`attendance_raw`**: `"Yes"` — a clean, non-defaulted classification;
  `classifyYesNo` resolved the engineer's own word with no fallback needed.
- **`morning_plan`**: `"Land excavation - 3 m3"`, stored verbatim (`.trim()`
  only, per `morning.ts`'s step-2 branch) — see §4 below; this is the second
  field sample of the same unprompted-quantity pattern §28(m) already names.
- **`morning_submitted_at`**: `2026-08-31 03:17:08.513756+00` (08:47:08 IST)
  — roughly 16.5 minutes after the 08:30 trigger fired, a real engineer's
  actual reply latency across all six morning questions, not a synthetic
  timing.

## 3. The template variables, rendering real values

`buildMorningTemplate` (`lib/whatsapp/outbound/templates.ts`) fills `{{1}}`
and `{{2}}` of `quoco_morning_checkin` from `users.full_name` /
`projects.name`, queried read-only for this record:

- `{{1}}` = **"Vikram Rao"**
- `{{2}}` = **"Speed Mechatronics"**

**Precision on what's actually new here, not overstated:** these variables
have carried real values on every attempt since the send primitive first
existed — `buildMorningTemplate` never had a placeholder path. What's new
today is not the variables; it's that a message carrying them left Twilio
successfully, was accepted by a production WABA sender rather than a
sandbox that structurally cannot serve custom templates, and — per the
ledger row above — has shown no sign of failing since. This is the first
time these real values were ever rendered on a screen a real engineer could
read, as opposed to being correctly constructed and then lost to one of the
three failures below.

## 4. The three failures that preceded it, in order

Full history, `outbound_sends` ordered by `created_at`, checked directly
against the table rather than reconstructed from memory:

| `event_key` | `status` | `twilio_sid` | `error` |
|---|---|---|---|
| `morning_send:2026-08-29` | `failed` | `NULL` | `Twilio returned 2xx with no "sid" field in the response body.` |
| `evening_send:2026-08-29` | `failed` | `NULL` | `Twilio returned 2xx with a body that is not valid JSON. [content-type=application/xml, bodyLength=1031, bodyHash=0486357c332f79e8, parsed=false]` |
| `morning_send:2026-08-30` | `failed` | `MMf8b1ec04ce3f975c13476288c2bc9a86` | `Twilio status callback: failed (ErrorCode 63027)` |
| `morning_send:2026-08-31` | **`sent`** | `MM1178595975993ab9ba1fb3344da4dd26` | `NULL` |

**Failure 1 — the XML-by-default parse bug (2026-08-29, both crons).**
`send.ts`'s request URL was `.../Messages`, with no `.json` suffix and no
`Accept` header. Twilio's classic 2010 API returns XML by default
(`twilio.com/docs/usage/twilios-response`) — every POST this system had ever
made received XML back, and every attempt to read a `sid` out of it failed.
The morning row's own error text ("2xx with no sid field") is this bug's
earliest, least-informative symptom, dated before PR #135's response-shape
capture existed to show the real `content-type`; the evening row's error
text, hours later, is the same bug with that capture already live, showing
`content-type=application/xml` directly. **This bug explains 100% of this
system's real send failures up to that point** — `outbound_sends` had never
once held a `status='sent'` row before the fix. Full record:
`docs/reviews/first-cron-fire-record.md`. Fixed same day, PR #139: `.json`
appended to the Messages URL.

**Failure 2 — 63015, sandbox join lapsed (found the same day, via Twilio's
own console, not via this system's own records).** Diagnosing the 2026-08-29
morning failure required going to Twilio's message log directly, because the
XML bug above meant this system's own parse of the response could show
nothing useful. Twilio's console showed the message was accepted, then
failed **asynchronously**: `Error 63015: Channel Sandbox can only send
messages to phone numbers that have joined the Sandbox` — the sandbox join
had lapsed under a minute before the cron fired. This finding could only be
made by looking past the parse bug, not by fixing it first; it surfaced
*alongside* Failure 1's diagnosis, not strictly after it. It established the
durable finding that a synchronous Twilio 2xx only ever certifies
*acceptance*, never delivery — a fact that mattered again for Failure 3.

**Failure 3 — 63027, sandbox cannot serve custom templates (2026-08-30,
found only after Failure 1 was fixed).** With the `.json` fix live, the
2026-08-30 morning row was the first to actually capture a real `twilio_sid`
synchronously and reach `status='sent'` — proving PR #139's fix worked. It
was then flipped to `status='failed'` by a real, signature-validated status
callback: `Twilio status callback: failed (ErrorCode 63027)`, "Template does
not exist for a language and locale." Diagnosis (Twilio's own sandbox docs,
confirmed directly: *"You can't use custom message templates with the
Sandbox. To set up and use custom message templates, you need to register a
WhatsApp sender."*) found this was not a template-language or
submission-batch problem — every one of this project's 15 approved templates
is a custom template, and **none of them will ever deliver from the
sandbox, unconditionally**. This failure was invisible until Failure 1 was
fixed, because before that fix, no send ever got far enough to reach a real
Twilio-side template check at all — the parse bug masked it completely.
Fixed 2026-08-30: the production WABA sender swap
(`docs/twilio-sender-swap-runbook.md`, executed and marked so the same day),
`TWILIO_WHATSAPP_NUMBER` → `whatsapp:+919940875600`, Production only.

**Each failure was found only after the previous was cleared, and only two
of the three were found in the order they were fixed** — Failure 2 (63015)
surfaced during Failure 1's own diagnosis, before Failure 1 had a fix, by
going around the parse bug to Twilio's console directly; Failure 3 (63027)
could only be seen at all once Failure 1's fix let a real `twilio_sid` and a
real status callback reach this system's own ledger for the first time.
Today's row is the first to clear all three: real `.json`-requested JSON
response, a production sender with no sandbox-join concept, a production
WABA sender that can actually serve a custom template.

## 5. What remains untested end to end, checked against the live code

**Owner delivery is not merely untested — it has no implementation.**
Checked directly, not inferred: `lib/queue/jobs.ts` declares `owner_deliver`
as a job type; `app/api/jobs/tick/route.ts`'s `dispatchJob` switch has an
explicit case for it that does nothing but
`throw new Error('No handler implemented yet for job type: owner_deliver')`.
Grepped across `lib/dpr/` and `app/api/cron/dpr-generate/route.ts`: nothing
in the DPR generation pipeline ever enqueues an `owner_deliver` job — the job
type exists in the type union and the dispatch stub, and nothing else.
`RESEND_API_KEY` (the env var CLAUDE.md §8 documents for this exact purpose)
has zero references anywhere in this codebase — grepped, confirmed.

**DPR generation itself is real and has been running nightly for over a
week** — `dprs`, checked read-only for this record, has one row per day for
`log_date` 2026-08-21 through 2026-08-30 (Speed Mechatronics), every one
`delivery_status='pending'`, `generated_at` populated within seconds of the
14:15 UTC (19:45 IST) `dpr-generate` cron firing each night. The generation
half of Pass 1's spine is real, exercised daily, and produces real content.
The delivery half — the report actually reaching the PM or the owner, by
WhatsApp or by email — has never been built, so it has never been exercised,
so `delivery_status` has never once left `pending` for a real day's DPR.

Today's own send path proves the check-in half of Pass 1 end to end for the
first time: trigger fires → template sends → engineer replies → all six
questions parse and land in `daily_logs`. Tonight's evening trigger (18:30
IST, not yet fired as of this record — the breadcrumb above is 09:28 IST)
is the next unexercised step in that same chain, on the now-proven send
path. Owner delivery sits downstream of both and remains the one link in
Pass 1's spine with no code behind it at all.

## What this record does not do

No code changed. The owner-delivery gap is named here as a fact checked
against the live code, not proposed as a fix or scoped as a task — any
build belongs to its own change, reviewed on its own terms, same discipline
as every other finding-not-fix record in this directory.
