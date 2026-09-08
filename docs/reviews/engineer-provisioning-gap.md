# No production code path adds an engineer to `project_members` (2026-09-03)

Record only — surfaced during DASH-01 recon, unrelated to that recon's own
purpose. **Not fixed here.**

## The gap

Checked directly against the repo: twelve read sites across `app/`, `lib/`,
and `scripts/` select from `project_members` and, in several cases, filter
or join on `role = 'engineer'` — but exactly one `.insert()` into
`project_members` exists in non-test code, and it is not an engineer:

- `app/(dashboard)/projects/new/page.tsx:49` inserts the **project
  creator**, `role: 'pm'` — the only production write to this table.
- `scripts/provision-beta-owner.ts:168` explicitly notes it does *not*
  insert into `project_members` (an owner gets a `projects.owner_user_id`
  UPDATE instead).
- No other file under `app/`, `lib/`, or `scripts/` inserts into
  `project_members` — every remaining `.insert()` hit on this table lives
  in `test/*.ts` fixture setup.

Every read site that depends on an *engineer* `project_members` row
existing assumes it, rather than creating it:
`lib/daily-logs/query.ts` (`getDailyLogsBoard`'s roster),
`lib/dpr/accountability.ts` (`assembleAccountability`'s roster),
`lib/checkin-escalations/roster.ts` (`fetchDueRoster`),
`lib/whatsapp/outbound/roster.ts` (the outbound-send roster), and
`app/api/cron/dpr-generate/route.ts`'s own roster query. None of them
create the row they read; nothing in the repo does.

## Consequence, stated plainly

Every engineer `project_members` row in production was inserted by hand,
outside this codebase — there is no in-repo mechanism that produced it.
Concretely: `project_members.created_at` for an engineer records **when
someone ran an INSERT**, not when that engineer joined the project or
site. `lib/dpr/dispatch.ts:319`'s "joined-late" check
(`membership.created_at`, compared against a checkpoint send-time to
decide whether a half is `not_applicable` for an engineer who joined mid-
day) reads exactly this column — its correctness for a real engineer
depends entirely on whatever out-of-repo process performs that INSERT
having set (or defaulted) `created_at` to something meaningful, which
this record cannot confirm one way or the other.

Not investigated further, not fixed here.

## Update (2026-09-08): the same gap means `full_name` can be null on a live, notifiable engineer

Surfaced during DASH-07 Phase 2 Stage 2 (PM Acknowledge/Undo, PR #244),
answering a review question about whether `HindranceAckControls`' Undo
consequence-line first-name interpolation could ever see an unnamed
reporter. **Not fixed here either** — recorded so the next reader of this
file has the full consequence, not just the provisioning gap in isolation.

Because no in-repo path creates OR validates an engineer row (per the gap
above), nothing requires `full_name` to be set — and `users.full_name` has
no DB-level `NOT NULL` constraint either (checked directly against prod's
`information_schema.columns`: `is_nullable: YES`). Separately, the existing
outbound-send infrastructure already tolerates this: `lib/whatsapp/
outbound/roster.ts`'s `resolveRosterEngineer` excludes an engineer from the
send roster only for `missing_whatsapp_number` or `missing_tenant_id` —
never for a missing name — and already falls back to `'Unnamed engineer'`
for message copy (`roster.ts:125`); `trigger.ts`'s actual send call
addresses purely by `whatsappNumber`, never by name.

**Consequence:** any future feature that sends a real notification to an
engineer and displays/interpolates that engineer's name (the DASH-07 Stage
3 WhatsApp sender being the concrete near-term case — it will set
`hindrances.ack_notified_at`) can genuinely encounter a `NULL full_name` on
an engineer it is actively, successfully notifying. This is not a
theoretical edge case to code defensively against "just in case" — it is a
reachable outcome of the provisioning gap above, empirically consistent
with prod today (checked live: 0 of 1 hindrances have a null-named
reporter, 0 of 1 engineers have a null `full_name` — small numbers, not
evidence it can't happen, only that it hasn't yet). Any UI copy that
interpolates an engineer's name needs an explicit fallback, not an
assumption that `full_name` is populated.

Whether to actually fix the provisioning gap itself (an in-repo path that
creates engineer rows, presumably requiring `full_name`) remains open and
out of scope for both this note and the PR that surfaced it.
