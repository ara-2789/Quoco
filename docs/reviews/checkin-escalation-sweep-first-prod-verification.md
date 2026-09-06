# Check-in escalation sweep — first production verification attempt (2026-09-06)

**Recorded 2026-09-06.** This document records the first attempt to verify, against
production (`jvxwqignooseazzmwhvl`), whether PR #192's check-in escalation sweep is
actually running. It is a record, not a fix — nothing in `lib/checkin-escalations/`
or `app/api/jobs/tick/route.ts` was changed to produce it. Every check below was
read-only: no write, update, delete, or service-role session was made against
production at any point in this investigation.

## Verdict, stated precisely

**The sweep is DEPLOYED AND UNVERIFIED. Not broken, not confirmed working.** Both
halves of that claim are load-bearing — deployment succeeded and the tick pipeline
demonstrably runs, but today's data cannot show whether the escalation sweep segment
itself executed without error, because today's correct output and a silently-failed
output are indistinguishable from the outside.

## What was checked, and what it showed

**Deployment.** GitHub's Deployments API (Vercel's GitHub integration writes here;
no Vercel CLI/MCP credentials were available in this environment to check the
dashboard directly) shows deployment `6293693755`, commit `350d5714488f4e0ae4566b0bd8e395820cd86050`
(the exact #192 merge SHA), environment `Production`, created `2026-09-06T13:49:05Z`
— about one minute after the merge (`13:48:08Z`) — with `state: "success"`.

**The tick pipeline is alive.** `vercel.json` schedules `/api/jobs/tick` at `* * * * *`
(every minute), which confirms configuration but not execution on its own. Direct
evidence came from the `jobs` table on production:

```
type: dpr_generate, status: succeeded
created_at:   2026-09-06 14:15:04.983193+00
completed_at: 2026-09-06 14:15:22.079+00
```

This job was enqueued by `/api/cron/dpr-generate` (scheduled `15 14 * * *` = 14:15
UTC) and completed 18 seconds later. Completion only happens through `runJobsTick`'s
own `claimJobs`/`dispatchJob`/`completeJob` loop (`app/api/jobs/tick/route.ts`) — the
exact same function that calls `runCheckinEscalationTickSweep` immediately before
that loop, in the same invocation. A completed job is direct proof `runJobsTick`
executed post-deploy; no amount of correct cron configuration alone could have shown
that.

**`checkin_escalations` on production: zero rows, ever** (`count(*) = 0`,
`max(created_at) = null` — not just zero since the merge, zero unconditionally).

**Why zero is the CORRECT output today, not evidence of anything broken.** Production
has three `status = 'active'` projects. Two have no engineers on their roster at all.
The third (`Speed Mechatronics`) has exactly one: Vikram Rao (`role = 'engineer'`,
`status = 'active'` — checked directly, not assumed; this rules out the role/status
data-quality hypothesis that was live before this check). His `daily_logs` row for
`2026-09-06` has `is_holiday = true`. `fetchDueRoster`
(`lib/checkin-escalations/roster.ts:59-97`) excludes any engineer whose `daily_logs
.is_holiday === true` for that `log_date`, by design, independent of the
`role`/`status` filter. So today's due roster, across every active project on
production, is genuinely empty — a correctly-running sweep produces exactly the same
zero rows a silently-failing one would.

**Is the holiday flag itself trustworthy — checked, not assumed (the follow-up
question this record was asked to close).** Vikram Rao's `2026-09-06` row has
`morning_submitted_at = 03:06 UTC` (08:36 IST) alongside `is_holiday = true` — worth
checking directly rather than treating as an odd coincidence. Confirmed from the
morning flow's own source (`lib/whatsapp/flows/morning.ts:404-412`, the Q1b holiday
follow-up step): `attendance`, `is_holiday: attendance === 'site_holiday'`, and
`morning_submitted_at: now` are all set in **one single write object**, in the same
turn, when the engineer answers "yes" to "is it a site holiday?" — not two separate
steps. `daily_log_edits` for this exact row was also checked and is empty (zero
rows) — no correction ever touched it after the fact. **This is the designed path,
confirmed both from the source and from the absence of any correction record, not a
value set by a subsequent edit.** Closed.

## Why the zero can't distinguish "ran correctly" from "threw and was silently caught"

`runCheckinEscalationTickSweep` is wrapped in its own `try`/`catch`
(`app/api/jobs/tick/route.ts`), same isolation pattern as the other two sweeps in
that route — a failure there is caught by `reportCheckinEscalationSweepError` and
folded into the tick's own JSON response, which is not persisted to any table this
session can read. There is no Sentry access available in this environment to check
whether that error path fired. Given today's roster is empty regardless of whether
the sweep runs correctly or throws immediately, **the current data cannot separate
those two outcomes** — this is the residual, explicitly not resolved by this record.

## The decisive future check — stated here so nobody re-derives it

`sweepEngineerHalf`'s step 1 upserts an `'awaited'` baseline row **unconditionally**
for every engineer actually on the roster, before any status decision is made. So on
any day when (a) it is not a holiday for the qualifying engineer, and (b) at least
one engineer is due, a `checkin_escalations` row **must** appear — `'awaited'` before
the morning cutoff, `'escalated'` after it (10:30 IST) if he has not checked in, or
`'submitted'`-equivalent state once he does. **Zero rows on a day that has a
non-holiday, non-empty roster is the swallowed-error case** — that is the condition
to check next, not another read against today's (holiday) data.

## Not covered by this record

Whether the sweep's WRITES themselves are correct once it does run on a live roster
(status transitions, `updated_at` handling per migration 027's own design) is
untested here — this record only establishes whether the sweep executes at all.
