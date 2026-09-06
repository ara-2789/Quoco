# `route.ts`'s gate lookup guesses the project on 2+ memberships (2026-09-06)

Record only, tracked before the ad-hoc menu's own step 3
(`docs/plans/adhoc-menu-spec.md`, "Project resolution") built the fix this
needs. **Not fixed here.**

## The bug

`app/api/whatsapp/webhook/route.ts:234`:

```ts
const projectId = user.project_members[0]?.project_id
```

The gate lookup embeds `project_members(project_id)` in the same query as
the user row (line 132) and takes index 0 with no length or count check.
`?.` only guards the zero-membership case (already caught earlier by
`noProjectResponse()` when the array is empty) — a 2+-membership engineer
is never detected as ambiguous. He gets an arbitrary project silently,
picked by whatever order Postgres happened to return the rows in, not by
any rule this codebase controls.

**Introduced 2026-07-07** (`61d8b39`, "WhatsApp morning check-in flow —
Pass 1 skeleton"), the very first commit of the check-in flow. Two months
live as of this record.

**The only engineer→project lookup in the codebase.** Grepped every
reference to `project_members` in `lib/` and `app/` (excluding tests):
`roster.ts`, `dpr/accountability.ts`, `dpr/dispatch.ts`, and the
DPR-generate cron route all query `project_members` filtered by an
already-known `project_id` — project→members, never the other direction.
This line is the one place that goes engineer→project and guesses.
Everything else is unaffected by construction, not by a check.

## Current exposure: zero, confirmed by a live read-only query

Queried prod (`jvxwqignooseazzmwhvl`) directly, 2026-09-06:

```sql
SELECT user_id, count(*) FROM project_members GROUP BY user_id HAVING count(*) > 1;
```

Exactly one `user_id` has 2+ rows. Traced fully before concluding
anything from the raw count:

- Both memberships are `role: 'pm'`, on two different projects.
- The user row: `role: admin`, `full_name: "Aravindan Rajamani"`,
  **`whatsapp_number` is null.**

This is Aravind's own admin account, not an engineer, and it has no
WhatsApp number — `route.ts`'s gate lookup is keyed strictly on
`.eq('whatsapp_number', fromNumber)`, so this account can never reach the
webhook at all. The naive pick has never fired for a real inbound message.
No `daily_logs`, `dprs`, or `hindrances` row has been misattributed by this
bug to date — the aggregate query above returned the complete population
(one row), not a sample, so there is no other ambiguous engineer to check.

**Why this is safe today by coincidence, not by design**: nothing in the
schema or the code prevents a real `engineer`-role user with a
`whatsapp_number` from acquiring a second `project_members` row. The
account that happens to have 2+ rows today just isn't one.

## Why this expires soon, not eventually

Aravind is socialising check-ins with a real site next week. An engineer
covering two projects at once is ordinary in Indian SMB construction — not
an edge case this project can assume away. The first such engineer to get
a second `project_members` row will have every check-in silently
attributed to whichever project came back first in an unordered query,
with no error, no log, no signal to anyone that it happened.

## The fix shape

`lib/whatsapp/project-resolution.ts`'s `resolveEngineerProject` (built for
the ad-hoc menu's own step 3, same day as this record) is the exact
function this line needs: a fresh, independent `COUNT` on
`project_members` for the user, skip-and-surface on 0 or 2+, never a
best guess. **The fix here is a call-site change, not new logic** — replace
`user.project_members[0]?.project_id` with a call to
`resolveEngineerProject(user.id, supabase)` and branch on its outcome
(reusing `ZERO_MEMBERSHIPS_REPLY`/`MULTIPLE_MEMBERSHIPS_REPLY` would need
its own copy pass first, since those two strings were written for the
ad-hoc menu's own voice, not necessarily the check-in gate's).

Not built here. Tracked so it isn't rediscovered from scratch when it does
get built, and so the exposure window is dated instead of assumed.
