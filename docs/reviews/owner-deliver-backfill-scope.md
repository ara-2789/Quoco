# Owner-deliver backfill — scope only, not built (2026-09-03)

19 `dprs` rows sit at `delivery_status='pending'` for one real project
(`acef67fe-e775-439d-82b8-5b8526868d6d`, 2026-08-13 through 2026-09-01 —
`docs/reviews/first-owner-delivery-record.md` §2). Checked directly: the
`ownerSend` cron (`app/api/cron/owner-send/route.ts`) only ever enqueues an
`owner_deliver` job for **today's** `log_date` — its handler
(`lib/dpr/owner-deliver-dispatch.ts:327`, `.eq('log_date', payload.log_date)`)
is hard-scoped to the one date it was enqueued for. There is no sweep for
historical `pending` rows. This backlog will not clear itself, on any
timeline, without a deliberate backfill — and it outranks the menu once the
Resend domain is verified, since these are 19 finished reports a customer
would pay for, sitting done and undelivered.

This document names the shape. **Nothing here is built.**

## One script, not 19 repeated inserts

A small, hand-invoked TypeScript script, matching the existing precedent
(`scripts/generate-one-dpr.ts`'s own house style: `.env.local` config,
deliberately bypasses nothing it doesn't need to, run by hand, provable by
reading the row back afterward) — not 19 separately hand-typed
`INSERT INTO jobs` statements. Repeating a manual insert 19 times is exactly
the shape that produces a transcription error on row 14 with no validation
to catch it; a script can validate every row the same way, print what it's
about to do before doing it, and report a clean summary at the end.

Proposed signature: `npx tsx scripts/backfill-owner-deliver.ts <project_id>`
— operates on every eligible `pending` row for ONE project (matching this
backlog's actual shape: one project, 19 dates), not a blanket "every
project" sweep. A blanket version is a different, larger tool with a much
bigger blast radius if something about eligibility is wrong; this backlog
doesn't need it.

## What it validates before enqueuing each (project_id, log_date) pair

Read-only checks, in this order, each one a reason to SKIP that date (never
a reason to guess or force a write):

1. **The project has an owner.** `projects.owner_user_id IS NOT NULL` —
   the exact same precondition `runOwnerSendTrigger` already checks
   (`skipped_no_owner`), reused here rather than re-derived.
2. **The DPR content is actually ready.** `dprs.generation_status = 'idle'`
   (not `pending`/`running`/`stale` — this project's own schema already
   distinguishes the compute-job lifecycle from the delivery lifecycle,
   `docs/schema.md`'s own "ORTHOGONAL lifecycles" note) AND
   `dprs.structured IS NOT NULL`. A row that's still generating, or stale,
   is not safe to enqueue for delivery — skip it, don't wait on it inside
   this script.
3. **`delivery_status` is still `'pending'` at read time**, re-checked
   immediately before enqueueing, not read once at the top of the script
   and trusted — the same "re-derive the pin at apply time" discipline
   CLAUDE.md's own migration §6 rule already applies to destructive/
   additive statements, applied here to a backfill script instead.
4. **No `owner_deliver` job already `pending`/`running` for that
   `(project_id, log_date)`.** The identical check `runOwnerSendTrigger`
   already performs (`app/api/cron/owner-send/route.ts`'s own
   `.eq('type','owner_deliver').in('status',['pending','running']).contains('payload', {project_id, log_date})`)
   — reused, not reinvented, so this script's own idea of "already queued"
   can never drift from the real trigger's.

Only after all four pass does the script call `enqueueJob('owner_deliver',
{project_id, log_date})` — the exact same call shape `runOwnerSendTrigger`
already uses, nothing script-specific about the payload.

## Partial failure — skip and continue, report at the end, never stop the batch

Matches `runOwnerSendTrigger`'s own per-project try/catch reasoning
(`app/api/cron/owner-send/route.ts`'s own header): a thrown error on date 7
of 19 must not silently drop dates 8 through 19 — those are 12 more real,
finished reports with no other path to the owner. Each of the 19 dates gets
its own try/catch; a failure is recorded (date, reason) and the loop moves
on. **No automatic retry inside the script** — a failed row is reported in
the final summary for a human to look at, not silently re-attempted, since
an unattended retry loop against a real send path is exactly the kind of
thing that needs a human glance first (matching CLAUDE.md's own "no
database-altering command is ever backgrounded" spirit — a retry loop with
nobody watching is the same shape). Re-running the script after a fix is
safe (see below), so "report and stop retrying automatically" costs
nothing.

## Double-send safety if the script runs twice — verified against the real code, not assumed

**Two independent layers, not one — checked directly, both matter:**

1. **Enqueue-time dedup** (validation step 4 above): prevents a second
   `owner_deliver` job from being queued for a date whose job is still
   `pending`/`running`. This alone is NOT sufficient on its own — it only
   covers the window while the first job hasn't finished yet.
2. **The real backstop: `dprs.delivery_status`, checked inside the job
   handler itself.** `classifyDprRowForStage2`
   (`lib/dpr/owner-deliver-dispatch.ts:213-224`) buckets every row by its
   CURRENT `delivery_status` at the moment the job actually runs:
   `STAGE_2_ELIGIBLE = {'pending','pm_notified','skipped_no_template','failed'}`
   vs. `STAGE_2_TERMINAL = {'delivered','owner_send_failed','no_report_sent','no_report_failed','skipped_unverified'}`
   (lines 186, 195). A row already `'delivered'` is `already_terminal` —
   **skipped unconditionally**, independent of how many `owner_deliver`
   jobs ever ran for that project/date. There is no `event_key`-style
   ledger for `owner_deliver` the way `outbound_sends` has one for WhatsApp
   sends (migration 031) — that convention doesn't exist for this job
   type. The protection here is structurally different but just as real:
   the DPR ROW's own terminal state, not a dedicated dedup ledger.

**Consequence: running the backfill script twice — even hours apart, even
after the first run's jobs fully completed — cannot double-send.** Every
date that succeeded the first time reads `delivery_status='delivered'` on
the second run and is skipped by validation step 3 before a job is ever
enqueued for it; even in the hypothetical where step 3 were skipped, the
job handler's own STAGE_2 classification would catch it again on the
handler side. Two independent gates, not one, is what makes this safe to
re-run without a special "did I already do this" tracking mechanism of the
script's own.
