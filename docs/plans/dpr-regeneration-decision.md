# DPR regeneration after PM edits — decision (2026-09-05)

Decided 2026-09-05. Settles **what** and **why**. The **how** lives in
`docs/plans/dpr-regeneration-build-spec.md`.

> **CORRECTIONS, 2026-09-06/07.** Recon against `origin/main` refined three
> things. They are struck through and corrected in place rather than rewritten.
> 1. Hole 2's citation was wrong — the substance survives, the sentence did not.
> 2. "Nothing new needed" was too optimistic: a prerequisite wiring PR in
>    `lib/dpr/` is required before the button can work at all.
> 3. The staleness query must be scoped **per engineer**, not per project.

---

## The problem this closes

Two holes, both verified against `origin/main`, neither previously recorded:

**1. Nothing tells the PM the report is ready.** `cutoffs.ts:65` describes 19:45
as *"evening close AND DPR generation AND PM notification, all one moment."*
There is no code that sends that notification. It exists only as a phrase in
that comment. (`delivery_status` even has a `pm_notified` value, added in 034 —
the state was defined and never reached.)

**2. Correcting a log does not change the report.**
~~`lib/daily-logs/dpr-delivery-note.ts:8` states it plainly: "no write, no
regeneration, no resend." The correction Server Action calls `revalidatePath`
and nothing else.~~

**CORRECTED 2026-09-06.** That citation conflated two files.
`dpr-delivery-note.ts:8` describes **its own read-only helper**
(`getDprDeliveryState` / `deriveDprDeliveryCopy`) for the DASH-03 correction
page — not a Server Action. The real correction action is `correctDailyLogField`
in `app/(dashboard)/daily-logs/actions.ts`, and it **does** write: it calls the
`correct_daily_log` RPC, then `revalidatePath('/daily-logs/<id>')`. The hole is
real and unchanged in substance — **the correction writes the daily log and
revalidates that page, and never touches the DPR** — but the sentence describing
it was wrong.

**Consequence:** the 19:45 -> 20:30 window exists on paper, nobody is told it
has opened, and a PM who fills a gap at 20:00 has fixed the daily log while the
owner still receives the 19:45 version at 20:30. **The edit window is currently
decorative.**

This decision closes hole 2. Hole 1 is separate and still open.

---

## The decision

### A "Regenerate the report" button, gated on delivery status

**Regenerate, not "generate and send".** A send button was considered and
rejected:

- `cutoffs.ts` already decided the owner send is *"automatic, unconditional …
  Never gated on a PM action — the PM's edit window is an opportunity, never a
  gate."*
- A manual send plus the 20:30 cron means the owner gets **two reports for one
  day**, unless you add "already sent manually" suppression state.
- Suppressing the cron instead means the night a manual send fails, nothing goes
  at all — the automatic path disarmed by a manual one.
- The owner should never have to work out which version is current. One report
  per site per night is the promise.

**Delivery stays automatic and unconditional at 20:30, and sends whatever the
latest version is.**

**A button rather than auto-regenerate-on-edit.** Five field corrections would
mean five regenerations and five Claude calls. A button is a natural debounce,
controlled by the person who knows when he has finished editing. It also gives
the PM the thing the window is actually for: he can *read* the corrected report
before his boss does.

### Gate on delivery state, not on the clock

If the send is late or fails, the window is honestly still open. Keying on
`delivery_status` self-corrects; keying on 20:30 lies.

**Show the button when all four hold:**

1. A `dprs` row exists for this project and date
2. `delivery_status` in `{ pending, pm_notified, skipped_no_data }` — the owner
   has not received it
3. At least one `daily_log_edits` row ~~for this project/date~~ **for this
   project, date AND engineer** with
   `created_at > COALESCE(last_regenerated_at, generated_at)`
4. The viewer is a PM — same gate as the correction itself (`canEditLog`)

**CORRECTED 2026-09-06 — condition 3 must be per-engineer.** DPRs are keyed
`(project_id, engineer_id, log_date)`, but `daily_log_edits` has no
`engineer_id` — only `daily_logs_id`. A project-scoped staleness read would mark
**every** engineer's DPR on that date stale when one engineer's log is
corrected, spending a Claude call per engineer to reproduce identical reports
and appending a junk version row to each. Join
`daily_log_edits.daily_logs_id -> daily_logs.engineer_id` and scope to the DPR's
own engineer. Moot at one engineer per project; wrong at any larger roster, and
the join costs one hop.

**Otherwise say the true thing rather than show a dead button:**

| State | What the PM sees |
|---|---|
| Before 19:45, no DPR row | "Tonight's report builds at 7:45 pm." |
| DPR current, no edits since | nothing — there is nothing to regenerate |
| `delivered` | "Suresh has tonight's report. This correction is on the record." |
| Regeneration in flight | disabled, showing state — no double-press |
| Regeneration failed | button returns, failure named |

### A send-time backstop

At 20:30, before sending, `owner-send` checks the same staleness condition. If
edits exist after `COALESCE(last_regenerated_at, generated_at)`, regenerate,
stamp `last_regenerated_at`, then send.

The button handles the normal case; the backstop handles the night the PM edits
and forgets to press it. Most nights the backstop finds nothing to do — which is
what a good safety net looks like.

**The rule most likely to be got wrong: if regeneration fails, send the last
good version anyway.** A failed regeneration must never cost the owner his
report. Log it loudly, send what exists.

---

## The case that justifies the feature

Not the tidy-up case — **`skipped_no_data`**. The engineer sent nothing, so no
report was generated and the owner gets silence that night. The PM fills the log
in by hand, and **now there is a report to send**. Without regeneration, that day
produces nothing for the owner even though the PM did the work.

---

## Schema — no change needed, but wiring is

~~Nothing new needed.~~ **CORRECTED 2026-09-06: no schema change is needed, but
application wiring is — see the build spec's Part A.** Every column below is
confirmed present in `types/database.ts`, not merely asserted from a migration
file.

- `dprs.last_regenerated_at` — **exists and is unused.** Its only writer
  anywhere is `write_dpr_version`'s own UPDATE, and nothing calls that RPC yet.
- `dprs.generated_at`, `dprs.delivery_status`, `dprs.delivered_owner_at`
- `dprs.generation_status` — `running` / `idle`, set by `handleDprGenerateJob`.
- `daily_log_edits` full Row: `column_name`, `comment`, `created_at`,
  `daily_logs_id`, `edited_by`, `id`, `log_date`, `new_value`, `old_value`,
  `project_id`, `source`, `tenant_id`. Note **no `engineer_id`** — hence the join
  in corrected condition 3.
- `dpr_versions` + the `write_dpr_version` RPC (migration 029). Verified
  behaviour on a second call: locks the `dprs` row `FOR UPDATE`, computes
  `current_version + 1`, **INSERTs a new `dpr_versions` row**, then UPDATEs
  `dprs` (content, structured, `current_version`, `generated_by`,
  `generated_by_user`, `last_regenerated_at = now()`) — one transaction,
  append-only history, no silent overwrite.
- `delivery_status` values after 034: `pending`, `pm_notified`, `delivered`,
  `paused`, `skipped_no_data`, `skipped_no_template`, `skipped_unverified`,
  `failed`, `no_report_sent`, `owner_send_failed`, `no_report_failed`
- `canEditLog` (`lib/daily-logs/correction.ts:123`) — `role === 'pm'`, strict
  equality, nothing else. Tested against `'qs'` and `'admin'` (both false).

---

## Deliberately left open

- **The failure states** — `failed`, `owner_send_failed`. The owner has not
  received the report, so regenerating is arguably right; but "retries
  exhausted" is a different situation from "not tried yet" and may want a
  different affordance. Start with the three states above; add failures
  deliberately after seeing one happen in production.
- **Hole 1, the 19:45 PM notification.** Regeneration makes the window
  *meaningful*; it does not make the PM *aware* it opened. DASH-01 covers
  awareness only if he happens to be looking. Still open.
- **Correcting after delivery.** Once the owner has the report, a correction is
  for the record. If a real "send a correction to the owner" path is ever
  wanted, it is a deliberate feature with its own copy and its own decision —
  never a side effect of an edit button.
- **Generation duration is unmeasured.** `dispatch.ts` logs
  `{event: 'dpr_generate_timing', steps_ms, total_ms}` on every real run, but no
  number has ever been captured durably (`docs/build-status.md`'s 2026-08-12
  note still records this as outstanding). The button's in-flight copy and any
  polling interval are being designed without knowing how long a regeneration
  takes. Read one real log line before finalising that copy.
