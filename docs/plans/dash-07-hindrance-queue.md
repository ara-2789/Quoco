# DASH-07 — PM hindrance queue with acknowledgement (2026-09-07)

Design and copy, approved before code. Written after recon against
`origin/main` (`481d872`).

**Status: DESIGN APPROVED, NOT BUILT.** No route, no page, no action exists yet.

**Scope split.** This document owns the route, the page, the list, the
acknowledge write, and the RLS/auth it needs. It does NOT own the migration
adding the acknowledgement columns, the WhatsApp template, or the outbound
message — a separate track owns those. The two meet at the columns named in
§Columns required.

---

## Why this exists

The WhatsApp ad-hoc menu's item 1 went live 2026-09-07 (#241). A site engineer
answers two questions and a row lands in `hindrances`; `lib/hindrance/pm-notify.ts`
emails his PM. **That email is the only surface.** A PM with several open items
has no list, no way to see them together, and no way to signal he has seen one.

The table had **zero rows before 2026-09-07**. This is new ground.

---

## DECISION — resolution is deferred to DASH-10, deliberately (2026-09-07)

**Recorded as a decision, not a caveat, because this project has repeatedly
found decisions that were correctly recorded and never built.**

**What is deferred.** Nothing anywhere writes `hindrances.status`,
`resolved_at` or `resolved_by`. Verified: grep across `app/`, `lib/` and every
migration returns only the DDL in `001_core_schema.sql`, where `resolved_at`
and `resolved_by` sit under a literal `-- future:` comment. Every hindrance
ever reported is `status = 'open'` and always will be. **DASH-07 ships without
changing that.**

**Where it lands.** `docs/bot-flows.md:513-514` already scopes it:
*"FAST-FOLLOW (do not build yet): … DASH-10 accountability view + resolve
action."* The resolve action is DASH-10's, not DASH-07's. The plan always
paired a tracker with a closure mechanism; it numbered them separately.

**Why ship anyway.** The list is useful before closure exists because ordering
carries the weight: `active` first, oldest first, so a genuinely long-running
blocker rises rather than sinks. A PM gets a shared view and the engineer gets
an acknowledgement — both are real today. Waiting for DASH-10 means the loop
stays open while data accumulates unseen.

**When this stops being true — and the honesty about the estimate.** The list
grows without bound. It stops being readable somewhere around the point a PM
must scroll past items he has already dealt with to find new ones. **A
three-week estimate was offered in discussion; it has no data behind it** —
the table had zero rows until the day this was written, so no arrival rate has
ever been observed. Treat it as a prompt to measure, not a forecast.

**The one datapoint that exists.** As of the morning of 2026-09-07 the table
held **exactly one row**, created that day by the first real end-to-end test.
Arrival rate is genuinely unknown; one observation is not a rate.

**The measurement that settles it.** Once real hindrances have accrued for a
week, count rows per project per week. At roughly one per project per week the
list is fine for a quarter; at five it is unreadable within a month. **Run that
count before deciding DASH-10's priority.** Nothing else about DASH-07 needs to
change first.

**What must NOT happen in the meantime.** Acknowledgement must not become the
de facto closure filter — see §Acknowledgement is state, never a filter. Nor may
the 14-day window be used to hide the growth: `active` items are exempt from it
by decision (§The window), so an unresolved blocker stays visible at any age.
The list getting long is the closure gap becoming legible, which is the point.

---

## Acknowledgement is state, never a filter

Acknowledged items **stay in the list**, de-emphasised. They are never hidden.

If acknowledging removed an item from view, the only way for a PM to clear his
screen would be to press a button that sends the engineer "your PM has seen
it." He would learn to press it to tidy up rather than to communicate, and the
one signal the engineer receives would be corrupted within a fortnight.

Worse: an acknowledged-but-still-blocking hindrance would disappear while the
site is still stopped. That inverts `docs/design-principles.md` Rule 4.1, which
makes the dashboard an exceptions queue.

Acknowledgement answers *"has a human seen this?"*. Resolution answers *"is the
site unblocked?"*. They are different questions and only one of them is built.

---

## Columns required from the other track

```
acknowledged_at  TIMESTAMPTZ            -- nullable, no default
acknowledged_by  UUID                   -- nullable, no default
```

- Set and cleared **together**. A CHECK that both are NULL or both NOT NULL,
  mirroring the `timing` / `timing_raw` pairing discipline migration 036 already
  established on this same table.
- `acknowledged_by` wants the **composite same-tenant FK**
  (`acknowledged_by, tenant_id -> users(id, tenant_id)`), exactly as migration
  038's own review package argued for `reported_by`: the parent composite
  uniques already exist, so it is a pure FK swap.

### The send-once marker — prevents a real spam bug

Un-acknowledging must not re-arm the engineer's WhatsApp. Undo → re-acknowledge
must **not** send a second "your PM has seen it". Two of those for one hindrance
is worse than the misclick that caused it.

So the notification needs its own marker, independent of `acknowledged_at`, and
the send must be **once per hindrance, ever**. The marker and the send belong to
the other track; naming the requirement belongs here. **If this is not handled,
the undo affordance in §Un-acknowledge creates a spam bug.**

### KNOWN SHAPE QUESTION — do not design now

With `pm_notified_at` already present, this puts **four** columns on
`hindrances` tracking who-told-whom: `pm_notified_at`, `acknowledged_at`,
`acknowledged_by`, plus the send-once marker.

For one item that is acceptable and a table would be over-building. **But
DASH-05 (invoice queue) and DASH-06 (safety log) are the same shape of item and
will want the same events.** If either lands with these needs, a `notifications`
table keyed by (entity, entity_id, event) is the right structure and a
column-per-event is not. Flagged so the third occurrence is recognised as a
pattern rather than absorbed as another column.

---

## Route, nav, and shape

**Route:** `/hindrances`. **Nav label:** "Hindrances", after "Daily Logs".

**Restore ONLY the Hindrances nav item.** `app/(dashboard)/layout.tsx`'s own
header says each of Safety, Invoices and Hindrances returns individually once
its route exists — *"do not batch them back in together."* Safety (DASH-06) and
Invoices (DASH-05) still have no route.

**Cards, not a table.** `dprs/page.tsx` is a table because it is structured rows
to scan. This is free text plus one action per item — the DASH-01 tile pattern.

### Route access — no hard gate, but three empty states

The route is **not** role-gated. Nothing else in this app redirects by role:
`daily-logs` and `dprs` are open to any `project_members` role and simply show
an empty view when the user has no matching projects. `canEditLog` gates a
*write*, not page access. Introducing a redirect here would be a new pattern for
one page.

**But the natural empty state would lie.** A QS or admin with no `role = 'pm'`
memberships would be told *"Nothing reported"* when plenty may have been
reported — they just cannot see it. That is the same class of error as showing
one empty-state string for two different empties. Hence the third string above.

**Deliberately not addressed:** whether a QS on a project should see that
project's hindrances at all. The brief scopes this page to PMs. Raised, not
acted on.

---

## Status roles — no fifth role, no new colour

| `timing` | StatusChip variant | Label |
|---|---|---|
| `active` | `blocked` (red) | **Blocking now** |
| `unspecified` | `risk` (amber) | **Timing unclear** |
| `potential` | `risk` (amber) | **Could block** |
| acknowledged | `muted` (grey) | **Seen** |

**This is the product's first legitimate red, and it is deliberate.** DASH-01
uses no red because absence has innocent explanations — a missing check-in
proves nothing. An `active` hindrance is different: an engineer has explicitly
said work is blocked. That is what `docs/design-tokens.md` §1 reserves red for,
and a red that is never used carries no meaning the day it is needed.

The two amber chips are separated by **label, not colour**. "Could block" and
"timing unclear" are both honestly *at risk, not confirmed blocked*.

## Ordering

`active` -> `unspecified` -> `potential`. **Oldest first within each group.**

`unspecified` sits above `potential` on purpose: it means the engineer's answer
could not be classified, so the item **might** be blocking right now. Unknown
urgency belongs nearer the top than known-not-yet-urgent. Burying a possible
active blocker below items confirmed as future risks is the wrong default.

Acknowledged rows keep their position, de-emphasised. They do not sink and they
do not disappear.

---

## The window — DECIDED 2026-09-07

**An `active` hindrance never falls out of the window. It shows at any age.**
`potential` and acknowledged items get the 14-day window.

**Why.** The ordering argument is that a two-week-old blocking item rises to the
top. A window that hides it on day fifteen inverts exactly that — and it fails
**silently**: the PM sees a shorter list and reads it as things being under
control. A six-week-old utility approval still stopping work is the most
important row on the page, not the least.

**The cost, accepted deliberately.** If `active` items are never resolved, the
list is unbounded. That cost belongs to the closure gap, and this is the right
place for it to hurt: **a growing list of things genuinely blocking work is a
true signal, not a UI problem.** Hiding it behind a date filter would convert a
real operational fact into a clean-looking screen. The pressure this creates is
the pressure to build DASH-10, which is correct.

**How to build it.** One named predicate over **IST calendar days**
(`istDateString()`), never a UTC subtraction — UTC drifts by 5h30m and drops
items on the wrong day. The predicate takes the `active` exemption as an
explicit clause, not as an accident of query structure, so both the window and
the exemption are one edit to change.

---

## Copy — approved strings

| Where | String |
|---|---|
| Page title | Hindrances |
| Subtitle, with items | "{n} things reported from your sites." |
| Subtitle, one item | "1 thing reported from your sites." |
| Empty — none ever | "Nothing reported. Your engineers can flag a blockage any time from WhatsApp." |
| Empty — none in window | "Nothing reported in the last two weeks." |
| Empty — viewer is not a PM anywhere | "You're not the PM on any project. Hindrances appear here for projects you manage." |
| Primary action | Acknowledge |
| Acknowledged chip | Seen |
| Acknowledged attribution, self | "Seen by you, {time}" |
| Acknowledged attribution, other | "Seen by {full name}, {time}" |
| Undo affordance | Undo |
| Undo consequence line | "Marked unseen. {first name} was already told you'd seen it — that message can't be recalled." |
| Unspecified prefix | "He answered:" |
| Save failure | "Couldn't save that. Try again." |

**Blunt by design:** the undo consequence line states plainly that the message
cannot be recalled. Softening it would let a PM believe he had taken something
back that is already on the engineer's phone.

---

## Row anatomy

Four parts, always in this order — project, chip, the engineer's words, then
attribution and action.

```
Speed Mechatronics                         [!] Blocking now
Cement lorry not arrived, slab pour stopped
Vikram Rao · 2 days ago
                                            [ Acknowledge ]
```

`timing = 'unspecified'` adds one line carrying his literal answer:

```
Speed Mechatronics                       [!] Timing unclear
Scaffolding not cleared from the east face
He answered: "after tomorrow maybe"
Vikram Rao · 4 hours ago
                                            [ Acknowledge ]
```

Acknowledged:

```
Speed Mechatronics                              [·] Seen
Cement lorry not arrived, slab pour stopped
Vikram Rao · 2 days ago
Seen by you, 4:10 pm                                  Undo
```

---

## Rendering rules

**`timing_raw` verbatim.** It is the engineer's literal text and the entire
reason the column exists — his words survive a failed classification. Render it
in quotes, prefixed "He answered:", as plain text. Never truncate it, never
normalise casing or punctuation, never interpret it. It is user-supplied content
and must be escaped as text, never rendered as markup.

**Empty `timing_raw`.** The CHECK pairs `timing`/`timing_raw` but does not
guarantee non-empty content — 038 writes whatever the engineer's turn contained.
If it is empty or whitespace, omit the line entirely rather than rendering
`He answered: ""`. The chip already says the timing is unclear.

**Attribution.** `acknowledged_by` is a `users.id`. Resolve to a display name.
A project can have more than one PM (`project_members.role = 'pm'`), so it may
not be the viewer — say "Seen by you" only when the ids match, otherwise the
person's name.

**Never `[0]` off a multi-row result** to resolve an ambiguous relationship.
`docs/reviews/route-ts-naive-project-pick.md` tracks a live bug of exactly that
shape. Where a lookup could return zero or several rows, skip and surface.

---

## Un-acknowledge — quiet, but not hidden

**Quiet.** A small text link on the row, not a button. It is a correction path,
not a workflow step. Given equal weight to Acknowledge, it invites toggling —
and every toggle is a decision the engineer cannot see.

**Not hidden.** Never behind a menu, hover state, or second click. A PM who has
just misclicked must find it in a second without hunting. Visible at rest, in
the tertiary treatment already shipped for "Open project" on DASH-01
(`text-blue-600`, no border, `py-3 sm:py-1` so it stays a real tap target on a
phone).

**Behaviour.** Clears `acknowledged_at` and `acknowledged_by`, sends nothing,
returns the row to unacknowledged. The consequence line above tells the truth
about the message already sent.

---

## Smallest useful version — what is deliberately left out

**In:** one route, one list, `description` verbatim, `timing` chipped honestly,
`timing_raw` verbatim when unspecified, reporter name, relative age, Acknowledge,
acknowledged state with attribution, Undo.

**Out, and why:**

- **Filters, search, sort controls, pagination, project grouping.** Ordering
  does the work; controls are for lists too long to read, which this is not yet.
- **Counts, charts, per-project rollups.** Not the question a PM asks here.
- **A hindrance detail page.** Everything the row holds is already on the row.
- **Photos.** `photo_url` exists and is never written.
- **`hindrance_type`, `impact_level`, `area_affected`.** All three have CHECK
  constraints and **none is ever populated** by 038's INSERT. A "filter by
  cause" control would be an empty dropdown pretending to be a feature.
- **Resolution.** See the dated decision above. DASH-10.

---

## Also part of this work

`CLAUDE.md:948` and `docs/bot-flows.md:513` both still list DASH-07 under
**FAST-FOLLOW — DO NOT build yet**. Building it makes both stale. Correct them
in the same PR, with dated strike-throughs rather than silent rewrites, per this
project's own correction discipline.

---

## RLS findings — recorded 2026-09-07, NOT blockers for Phase 1

Verified directly from `supabase/migrations/002_rls_policies.sql:249-268`, under
the header comment *"hindrances — full CRUD within tenant"*:

```sql
CREATE POLICY "hindrances_select" ON hindrances
  FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "hindrances_update" ON hindrances
  FOR UPDATE TO authenticated USING (tenant_id = get_user_tenant_id())
                              WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "hindrances_delete" ON hindrances
  FOR DELETE TO authenticated USING (tenant_id = get_user_tenant_id());
```

**Every one of these is tenant-wide, with no project scoping.**

**Why this does not block Phase 1.** `daily_logs_select` is byte-identical in
shape (`002_rls_policies.sql:172-174`, verified — not taken on trust), and
`daily-logs/page.tsx` ships in production today relying entirely on app-layer
`project_members` filtering for cross-project scoping. Newer tables — `dprs`
(023), `checkin_escalations` (027) — were built with DB-layer project scoping;
the migration-002-era core tables were never retrofitted. So this is the
established shipped pattern, not a gap unique to `hindrances`, and app-layer
filtering is in any case the only lever available here: the policies live in
`supabase/migrations/`, which this track does not own.

**Two findings for the migration track, recorded rather than waved through:**

1. **`hindrances_delete` is tenant-wide.** Any authenticated user in the tenant
   can delete any hindrance, with no audit trail. For a table holding an
   engineer's report that work is blocked, that is a stronger permission than
   anything the product needs. Nothing in the app deletes hindrances today.
2. **`hindrances_update` is tenant-wide**, which matters for **Phase 2**: the
   acknowledgement write will be DB-permitted for any tenant user, not only the
   project's PM. Phase 2's authorization is therefore entirely app-layer, and
   that is a weaker guarantee for a write than for a read. Worth a project-scoped
   UPDATE policy alongside the acknowledgement columns.

Neither is introduced by this work; both predate it by every migration since 002.

---

## Open — recon before code, do not guess

1. **RLS on `hindrances` — RESOLVED 2026-09-07, and it produced two findings
   for the other track. See §RLS findings below.**
2. **PM identity — RESOLVED.** `lib/hindrance/pm-notify.ts:137-141`
   (`resolveProjectPMEmails`) already queries `project_members` filtered on
   `.eq('role', 'pm')`. This page inverts it: given `profile.id`, fetch that
   user's `project_members` rows where `role = 'pm'` to get their project set.
   Note `dprs/page.tsx` reads `project_members` with NO role filter, because
   that page is open to any membership role — hindrances needs the filter.
3. **Existing read path — RESOLVED.** `from('hindrances')` appears three times
   repo-wide, all in `lib/hindrance/pm-notify.ts`. **This page is the table's
   first reader for display.**
4. **The 14-day window — DECIDED, see §The window below.** Nothing open here;
   build it as specified.
