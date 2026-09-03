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
