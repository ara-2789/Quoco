# DPR regeneration — build spec (2026-09-07)

Companion to `docs/plans/dpr-regeneration-decision.md`, which settles **what**
and **why**. This settles **how**, and splits the work across two tracks.
Written after recon against `origin/main` (`a918350`).

**Read this first if you are implementing.** Everything marked VERIFIED was read
from source on 2026-09-07. Everything marked DESIGN is a ruling made here.
Everything under Open is genuinely undecided and must not be guessed.

---

# Part A — Wiring PR (DPR track, not dashboard)

**This blocks Part B entirely. Nothing in Part B works until this lands.**

## The problem

VERIFIED. `runDprGenerateTrigger` (`app/api/cron/dpr-generate/route.ts`) does not
generate inline — it calls
`enqueueJob('dpr_generate', {project_id, engineer_id, log_date})`. The work
happens in `handleDprGenerateJob` (`lib/dpr/dispatch.ts`): assemble facts ->
narrative context -> verdict -> `renderEngineerReport` -> **upsert `dprs`
directly**.

That direct upsert never calls `write_dpr_version`, so `last_regenerated_at` is
never stamped. Confirmed: `last_regenerated_at` appears in `types/database.ts`
(Row/Insert/Update) and in **no file under `app/` or `lib/`**.

Migration 029's own header anticipates this exact PR:

> "grepped app/, lib/, scripts/ for any caller of write_dpr_version — NONE
> exists yet (dispatch.ts and generate-one-dpr.ts both still upsert dprs
> directly; the RPC has no application-code caller until a separate wiring PR
> lands, not part of this migration)."

## What the wiring PR does

`handleDprGenerateJob` writes its result through `write_dpr_version` instead of
upserting `dprs` directly. VERIFIED behaviour of that RPC on a second call:
locks the `dprs` row `FOR UPDATE`, computes `current_version + 1`, INSERTs a new
`dpr_versions` row, then UPDATEs `dprs` (content, structured, `current_version`,
`generated_by`, `generated_by_user`, `last_regenerated_at = now()`) — one
transaction, append-only history, no silent overwrite.

`scripts/generate-one-dpr.ts` upserts directly too and should move with it, or
be explicitly left behind with a stated reason.

**No schema change.** The RPC and both tables already exist.

## Why the alternative was rejected

DESIGN. Stamping `last_regenerated_at` from the dashboard Server Action at
*request* time was considered and rejected. It must be stamped when generation
**completes**. Stamp on request and a failed regeneration silently clears the
staleness gate — the button disappears, the PM believes the report was rebuilt,
and the owner receives the stale version at 20:30 with nothing indicating it.

## Acceptance

A second generation for the same `(project_id, engineer_id, log_date)` leaves:
`dpr_versions` with two rows, `dprs.current_version = 2`, and
`dprs.last_regenerated_at` non-null and later than `generated_at`.

---

# Part B — The button (dashboard track)

## Which surface — CHANGED from the decision record

DESIGN. The decision record assumed the DPR detail page. Recon changes that.

**The button belongs on the DASH-03 correction page (`daily-logs/[id]`), not the
DPR detail page.** Three reasons:

1. That page **already reads DPR delivery state** —
   `lib/daily-logs/dpr-delivery-note.ts`'s `getDprDeliveryState` /
   `deriveDprDeliveryCopy` run there today to render the delivery note. The gate
   needs almost exactly that data. The button costs no new page query.
2. It is where the PM **is** at the moment he wants it — he has just finished
   correcting a field. Sending him to another route to press rebuild is friction
   at precisely the wrong second.
3. `app/(dashboard)/dprs/[id]/page.tsx` is VERIFIED pure read-only — no
   `'use server'` anywhere under `dprs/`. Putting the app's first mutation into
   its read-only reporting surface is a worse fit than putting it beside the
   correction that caused the need.

The action therefore goes beside `correctDailyLogField` in
`app/(dashboard)/daily-logs/actions.ts`.

On success, offer a link to the DPR detail page so the PM can **read** the
rebuilt report — the decision record is explicit that reading it before the
owner does is half the point of the window.

## Gate — show the button when all four hold

1. A `dprs` row exists for this project, engineer and date
2. `delivery_status` in `{ pending, pm_notified, skipped_no_data }`
3. At least one `daily_log_edits` row **for this project, date AND engineer**
   with `created_at > COALESCE(last_regenerated_at, generated_at)`
4. `canEditLog(profile.role)` — VERIFIED as `role === 'pm'`, strict equality
   (`lib/daily-logs/correction.ts:123`)

**Condition 3 must join.** VERIFIED: `daily_log_edits` has `project_id`,
`log_date`, `created_at`, `daily_logs_id` — and **no `engineer_id`**. DPRs are
keyed `(project_id, engineer_id, log_date)`. A project-scoped read marks every
engineer's DPR on that date stale when one engineer's log is corrected — a
Claude call each to regenerate identical reports, plus a junk version row on
each. Join `daily_log_edits.daily_logs_id -> daily_logs.engineer_id`. Moot today
at one engineer per project; wrong at any larger roster.

## Copy per state

Unchanged from the decision record.

| State | What the PM sees |
|---|---|
| Before 19:45, no DPR row | "Tonight's report builds at 7:45 pm." |
| DPR current, no edits since | nothing — there is nothing to regenerate |
| `delivered` | "Suresh has tonight's report. This correction is on the record." |
| Regeneration in flight | disabled, showing state — no double-press |
| Regeneration failed | button returns, failure named |

## Async behaviour — the button enqueues, it does not await

VERIFIED: generation is a queued job claimed by `runJobsTick`, not an inline
call. So the Server Action enqueues and returns immediately; the UI is a client
component that polls.

DESIGN — **poll the `jobs` row, not `dprs.generation_status`.** The action
returns the enqueued job id; the client polls that row's `status`. Reason:
`dispatch.ts` sets `generation_status` to `running` on claim and back to `idle`
on **both success and failure**, so `idle` alone cannot tell the two apart. The
`jobs` row distinguishes `succeeded` from `failed` directly.
(`last_regenerated_at` moving is a valid secondary discriminator, but only after
Part A lands, and it is indirect.)

**Double-press guard:** refuse to enqueue when a `dpr_generate` job for this
`(project, engineer, date)` is already queued or running. Do not rely on the
button's disabled state alone — two tabs defeat it.

## Failure, stated as a rule

**If regeneration fails, the owner still gets the last good version.** A failed
rebuild must never cost him his report. Log loudly, send what exists.

---

# Open — do not guess these

1. **Can a PM's user-scoped client insert into `jobs`?** The cron path uses a
   service client. `correctDailyLogField` uses `createClient()` (user-scoped,
   RLS applies). If RLS forbids a PM inserting a `jobs` row, the action needs a
   different path, and "use the service role in a user-triggered action" is a
   **security decision, not an implementation detail** — it stops and goes to
   Aravind. Recon this before writing the action.
2. **How long does a generation actually take?** Nobody has ever measured it.
   `dispatch.ts` logs `{event: 'dpr_generate_timing', steps_ms, total_ms}` on
   every real run; `docs/build-status.md`'s 2026-08-12 entry still records the
   measurement as outstanding, and no number appears anywhere in `docs/`. The
   polling interval, the timeout, and the in-flight copy all depend on it. Read
   one real log line before finalising them.
3. **The failure delivery states** — `failed`, `owner_send_failed`. Deliberately
   excluded from the gate for now. "Retries exhausted" is not "not tried yet"
   and may want a different affordance. Add after seeing one in production.

# Not in this work

- **The 20:30 send-time backstop** in `owner-send`. Decided in the record, but
  it is a send-path change, not a screen. Separate PR, DPR track. Shipping the
  button alone regresses nothing: a PM who edits and forgets to press it lands
  exactly where he lands today.
- **Hole 1, the 19:45 PM notification.** Still open.
- **Correcting after delivery.** Its own feature, its own decision — never a
  side effect of an edit button.
