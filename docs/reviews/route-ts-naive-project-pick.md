# `route.ts`'s gate lookup guesses the project on 2+ memberships (2026-09-06)

**FIXED 2026-09-07.** `route.ts:234`'s naive `project_members[0]` pick is
gone -- `handleWebhookPost` now calls `resolveEngineerProject` (this doc's
own "The fix shape" section, unchanged from what was proposed) as the
single choke point for project resolution across the whole request, before
the test-start sentinel or `routeInboundMessage` ever run. `noProjectResponse()`
is retired; both the zero- and multiple-membership replies are now the
shared `ZERO_MEMBERSHIPS_REPLY`/`MULTIPLE_MEMBERSHIPS_REPLY` copy (unified
on Aravind's own instruction -- two different messages for the same
condition is how docs drift). Covered by `test/webhook.test.ts` T-WH-06
(zero, updated) and T-WH-16 (new -- multiple, proves the fix directly:
before this fix the same fixture would have silently proceeded on
whichever project came back first).

**Why this was brought forward from "expires soon" to fixed now, not
later**: found again while designing the ad-hoc menu's step 5 wiring (PR 2)
-- migration 038's `apply_hindrance_flow_turn` writes `p_project_id`
straight into the `hindrances` INSERT on the *completing* turn, sourced
from whatever this exact line resolves for that specific webhook request.
An ambiguous engineer's flow-start turn and completing turn are separate
HTTP requests, each with its own independent resolution -- with the old
naive pick, nothing guaranteed they'd agree, meaning a single hindrance
report could genuinely be written to a DIFFERENT project than the one the
engineer was told about at Q1. Named "a fabrication with no signal, same
class as the 113 workers and the Rs 14 crane" (Aravind) -- the "expires
soon" framing became "expires this week" the moment that concrete failure
mode was traced.

Originally recorded 2026-09-06, before the ad-hoc menu's own step 3
(`docs/plans/adhoc-menu-spec.md`, "Project resolution") had built the fix
this needed. The rest of this document, below, is that original record --
kept as written, not rewritten around the fix now that it exists.

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

This is exactly the shape built 2026-09-07 -- see the FIXED note at the top
of this document.

## Residual risk, accepted and documented, not fixed (2026-09-07)

Fixing `route.ts`'s single choke point closes the *fabrication* risk
completely: an ambiguous (2+ membership) engineer can no longer reach any
RPC at all, on any turn, for any flow, so two turns of the same
conversation can never silently disagree on which project a write belongs
to. What it does NOT close: an engineer who starts a flow while
unambiguous (exactly one `project_members` row, resolves cleanly), whose
membership then genuinely changes to 2+ *mid-conversation* (a PM adds him
to a second project between, say, Q1 and Q2). His next turn re-resolves
independently, finds 2+ rows, and is refused with
`MULTIPLE_MEMBERSHIPS_REPLY` -- correct, no fabrication, but his
in-progress flow is now stuck: every subsequent turn re-resolves the same
way and is refused the same way, with no path back to completing it short
of his membership becoming unambiguous again.

**Not hindrance-specific.** This applies identically to morning's and
evening's own multi-question turns (Q1 through Q6) -- their writes are
sourced from the same per-request `route.ts` resolution, the same way
hindrance's completing INSERT is. Confirmed by reading their bodies in
migration 038 directly, not assumed: `p_project_id` is used fresh in every
INSERT/UPDATE across every question, not carried from a session-remembered
value.

**The fix, if this is ever worth closing**: carry the flow-start's resolved
`project_id` in `whatsapp_sessions.context` and have the relevant RPC read
it from there for every write after start, instead of trusting each
individual turn's fresh (now correctly-refusing, but still per-request)
resolution. Deliberately NOT built now -- 038 is already sent to external
review at a pinned SHA/hash; touching it to add this would invalidate that
citation and require a new round, for a risk this narrow (a mid-conversation
membership change, presumably rare) when the actual named risk (fabrication)
is already fully closed by the choke-point fix above. **Fold this in only
if 038 is reopened for another reason anyway** -- at that point it becomes
free to include, not a reason to reopen on its own.
