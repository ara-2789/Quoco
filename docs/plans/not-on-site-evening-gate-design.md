# `not_on_site` evening gate — design pass (2026-09-10)

**STATUS: DESIGN PASS ONLY. No code, no SQL, no migration number reserved,
no copy finalized.** This document records findings and open decisions for
a real prod incident; it is not an implementation plan and should not be
read as one until the open items below are closed.

## The incident

An engineer answered "I was on leave" to the evening check-in's first
question (free text, never parse-gated). The bot didn't recognise it as an
absence signal, ran the full 5-question sequence anyway, and the engineer
answered with zeros/no across the rest — producing a completed evening
report reading as "site was open, nobody worked" when the truth was
"nobody was there to report." An all-clear lie.

## Decisions already made (Aravind) — design around these, not re-litigated here

1. **Morning "no" → dashboard notification only.** No email, no WhatsApp
   push. PM sees it on the dashboard with a note to collect DPR details
   himself. A PM-side entry surface for those details is explicitly a
   LATER feature, out of scope here.
2. **Evening flow gate is morning-only.** If morning was "yes," evening is
   completely unchanged — no new question, no behaviour change. Only a
   morning "no" triggers the new evening opener.
3. **Evening opener (morning-"no" case only):** "are you on site?" (working
   phrasing, not approved copy). Yes → normal evening flow. No → skip all
   remaining questions.
4. **Recorded state: `not_on_site`.** Not "on leave" — leave is one
   possible reason among several (site closed, no access, transferred,
   sick); naming the state after one reason would assert a cause the
   engineer never gave. No follow-up question asking why — friction at
   6:30pm for a detail the PM can get by calling. Reason stays unrecorded.

---

## (a) Current flow definitions — pasted, not described

**Morning** (`lib/whatsapp/flows/morning.ts`) — 4 in-scope steps + a holiday follow-up:

```
1: 'Good morning. Are you on site today? Reply yes or no.'
2: "What's your *plan of action* for today?"
3: 'How many *workers* today? ...'
4: 'Any *equipment / machinery* on site? ...'
5: 'Is it a site holiday? Reply yes or no.'   <- only reached from Q1's NO
```
Q1 NO -> Q5 (holiday follow-up). Q5 YES -> `attendance: 'site_holiday'`.
Q5 NO -> `attendance: 'absent'`. Both write `morning_submitted_at` and end
the flow -- no further morning questions on either branch.

**Evening** (`lib/whatsapp/flows/evening.ts`, migration 035) — 5 linear
questions, unconditional:
```
1: 'Evening check-in. What *work was completed* today? ...'
2: 'How many *workers* were on site today? ...'
3: 'Was anyone *idle* today? ... Reply *all working* if nobody was idle.'
4: (data-driven equipment-hours prompt, auto-skips if morning listed no equipment)
5: 'Anything that *slowed execution* today? Reply in a few words, or "none".'
```
No gate of any kind on `attendance`. Q1 is never parse-gated — any text is
accepted and the flow advances to Q2 regardless.

**Does morning already store a not-on-site state, and can evening read
it?** Yes to both, already: `daily_logs.attendance` already has the value
`'absent'` (Q1 NO + holiday-follow-up NO), already semantically close to
what `not_on_site` means. Evening can read it trivially — `apply_evening_
flow_turn` already has the `daily_logs` row in scope under its own lock;
nothing prevents an `attendance` check at flow-start today, it is simply
not done.

**Roster-level finding, load-bearing for decision 2:**
`lib/whatsapp/outbound/roster.ts`'s `filterEveningRoster` has a standing,
already-tested hard requirement NOT to gate the evening trigger SEND on
morning attendance or submission — the only exclusion is
`attendance='site_holiday'`. An `'absent'` engineer gets the evening
trigger sent exactly as today.

Consequence: **decision 2 is not a roster change.** The trigger still fires
unconditionally for `'absent'` engineers, same as today. The gate belongs
entirely inside `apply_evening_flow_turn`'s own flow-start logic, never in
who gets messaged.

**`docs/bot-flows.md` is stale, two layers deep.** Its own MORNING/EVENING
sections are already struck through, pointing to
`design-decisions-beta-feedback.md` §28(l) as "the live spec" — but §28(l)
predates migration 035's own restructuring (the by-trade/idle-hours/
equipment-hours shape above). Even the doc's own "corrected" pointer is
now one layer behind the actual code. The only current source of truth is
the flow files themselves.

## (b) What the DB actually stored — queried, not assumed

```json
{
  "log_date": "2026-09-09",
  "engineer": "Vikram Rao",
  "project": "Speed Mechatronics",
  "attendance": "absent",
  "morning_submitted_at": "2026-09-09 04:36:20 UTC",
  "evening_submitted_at": "2026-09-09 13:01:45 UTC",
  "evening_output": "I was on leave",
  "evening_manpower": { "total": 0, "by_trade": [], "raw_text": "0" },
  "evening_idle_hours": { "all_working": true, "by_trade": [], "raw_text": "0" },
  "evening_equipment_utilisation": { "items": [], "raw_text": null },
  "evening_schedule_miss_reason": "0"
}
```
Zero-filled, not absence-marked. His literal words ("I was on leave") ARE
preserved verbatim in `evening_output`, not lost — but the row otherwise
reads as a normal, complete, real-data submission with nothing done and
zero workers. The fix needs both a flow change and a schema/rendering
change — the flow change alone doesn't fix how a `not_on_site` day gets
recorded and rendered.

## (c) Schema change, if needed — described, no SQL, no migration number

Two separable changes, not one:

1. **A new evening-side fact.** `attendance` is morning-owned and already
   `'absent'` by the time evening's opener would run, so the opener's "no"
   answer doesn't change `attendance` — it records a new, evening-side
   fact: did the evening check-in confirm it too. Natural shape, matching
   this project's own convention (nullable TEXT + CHECK constraint) —
   something like a new column recording `'not_on_site'`, written only on
   the "no" branch, null otherwise. Exact column name is an open naming
   decision, not picked here.
2. **An RPC decision-logic change, not just a column.** `apply_evening_
   flow_turn` would need to check `attendance` at `p_start_flow=true` and
   branch to the new gate question instead of Q1 when `attendance='absent'`
   — a change to the SQL function's own start-branch, the same class of
   change that trips this project's external-review gate (modifies a live
   function's logic).

## (d) Does DASH-01's `nobody-on-site` tile already cover requirement 1?

No — same-named, unrelated condition. From `app/(dashboard)/dashboard/page.tsx`:
```ts
if (b.engineers.length === 0) {
  tiles.push({ kind: 'nobody-on-site', chipLabel: 'Nobody on site', ... })
  continue
}
// tileTitle: case 'nobody-on-site': return 'No engineer set up on this project'
```
Fires when a project has ZERO engineers registered at all — a
`project_members`-level gap, nothing to do with a registered engineer
answering morning Q1 "no." Zero references to `attendance === 'absent'`
anywhere in the dashboard code (grepped). Requirement 1 is entirely
unbuilt.

**TILE NAMING — confirmed: do not reuse `'nobody-on-site'`.** That
`TileKind` already means "no engineer registered on this project." The new
tile for requirement 1 needs its own distinct name — not decided here.

## (e) DPR rendering — current, and what `not_on_site` needs

`deriveHalfCompleteness` (`lib/dpr/assemble.ts:710`) is purely
timestamp-based — `if (row.evening_submitted_at) return 'complete'`, no
content check. `resolveCheckInStatus` (`lib/dpr/dispatch.ts`) only overlays
`not_applicable` for three reasons: `holiday`, `joined_late`, `left_early`
— none for `attendance='absent'`. A zero-filled evening submission flows
through as `'complete'`, which sets `eveningNeedsModel = true`, which sends
the facts (`"done: I was on leave"`, 0 workers, "all working," nothing
idle) to the AI model to synthesize a verdict as if it were real site data.
This is the exact mechanism of the lie.

`not_on_site` needs a fourth `NotApplicableKind` alongside `holiday` /
`joined_late` / `left_early`, overlaid the same way holiday already is —
a clean extension of an existing, working pattern, not a new mechanism.
Same beneficial side effect holiday already gets: `eveningNeedsModel`
becomes `false`, `codeTemplatedVerdict` runs instead of the model — no AI
call, no synthesized-from-garbage verdict.

## (f) DATED CORRECTION (2026-09-10, Aravind)

**Struck through below, not rewritten, per this project's own correction
discipline.**

~~Flag plainly: under a morning-only gate, the screenshot's OWN
conversation would still produce the same misleading record — that
engineer volunteered "I was on leave" unprompted with no morning "no" in
play.~~

**The screenshot's conversation DID have `attendance='absent'`.** The
morning-only gate WOULD have caught it. The original flag above was wrong
— it came from framing (an assumption about how the conversation went),
not from checking the data, which the query in (b) already had sitting in
front of it.

**The real gap, confirmed by query (2026-09-10):** rows with
`morning_submitted_at IS NULL` and a real `evening_submitted_at` — no
morning check-in at all, so a gate keyed on `attendance='absent'` never
fires; the day still runs the full evening flow unconditionally.

```sql
SELECT
  count(*) FILTER (WHERE morning_submitted_at IS NULL AND evening_submitted_at IS NOT NULL) AS no_morning_but_evening_submitted,
  count(*) FILTER (WHERE evening_submitted_at IS NOT NULL) AS total_evening_submitted,
  count(*) AS total_daily_logs_rows
FROM public.daily_logs;
```
**Result, prod, all time: 1 out of 12** evening-submitted rows (18 total
`daily_logs` rows overall — this project has one real engineer on prod
today, so this is the full population, not a sample). The one row:

```json
{
  "log_date": "2026-08-11",
  "attendance": null,
  "morning_submitted_at": null,
  "evening_submitted_at": "2026-08-11 05:10:42 UTC",
  "evening_output": null,
  "evening_manpower": null,
  "evening_idle_hours": null,
  "evening_schedule_miss_reason": null
}
```
**Characterized honestly, not overclaimed:** every content field is NULL,
not zero-filled — `evening_submitted_at` got set with nothing behind it.
This looks more like leftover test/smoke-test data (this date falls inside
this project's own documented E2E-smoke-test window) than a confirmed
second field incident of the SAME all-clear-lie shape as Sept 9's real,
garbage-filled row. It would still render as `'complete'` today under the
same timestamp-only completeness rule (e) describes, so it IS the same
class of gap — just not independently confirmed as a real, non-test
occurrence. At n=1 against an 18-row total population, this number does
not yet support a claim about real-world frequency either way — it says
the gap exists and is checkable, not that it is common. Decide "handle now
vs. later" on that basis, not on a frequency this sample is too small to
establish.

## (g) Copy slots needed — listed, not written

1. The evening opener itself ("are you on site?" — working phrasing, final copy TBD).
2. The reask message for an unparseable answer to the opener.
3. The "no" branch's completion reply (evening's own equivalent of `MORNING_ABSENT_REPLY`).
4. A new WhatsApp template body — see the template-constraint finding below; likely required, not just in-app copy.
5. DASH-01's new tile: title + chip label (needs its own `TileKind` name, not `nobody-on-site`), plus the "collect details for the DPR" note text.
6. The DPR's `not_applicable` reason string for this kind (mirrors holiday's `'Site closed (holiday)'`).
7. The DPR's code-templated verdict sentence for a `not_on_site` day (mirrors `'Site closed today.'`).

**Load-bearing finding, not just a copy slot:** the evening trigger's
outbound message is a frozen, Meta-approved WhatsApp template
(`quoco_evening_checkin_v3`) whose approved body is literally *"Good
evening {{1}}. This is your evening check-in for {{2}}. What work was
completed today?..."* — Q1's text, hardcoded into the template.
`selectEveningTemplate` has no branching today (the old two-template
branch was deliberately retired). For a morning-`'absent'` engineer's
evening opener to actually say "are you on site?" as the cold-start
message, that requires a second, newly Meta-approved template — a real
external dependency with its own review lead time.

---

## Piece A / Piece B split (2026-09-10, Aravind's own framing)

**PIECE A — no template needed.** `not_on_site` recording + DPR rendering
(the fourth `NotApplicableKind`, code-templated verdict instead of the AI
call) + the DASH-01 tile for requirement 1. Fixes the lie, ships without
Meta.

**PIECE B — template-blocked.** The evening flow opener itself (the "are
you on site?" question, gated on morning `attendance='absent'`).

### Is the split actually clean? Checked directly, not assumed.

**Yes — with one named accuracy tradeoff, stated precisely so it isn't
mistaken for something stronger.**

The incident bundles two SEPARATE problems that read as one:
1. **The DPR lies** — renders "0 workers, nothing done" instead of "not
   applicable, not on site."
2. **The engineer is asked 5 pointless questions** despite having already
   told the morning bot he wasn't on site.

Piece A fixes problem 1 alone, and it does NOT need to ask anything new at
evening time to do it — `attendance='absent'` is already known, in the
`daily_logs` row, by the time the evening trigger even fires. Piece A can
overlay `not_applicable`/`not_on_site` in `resolveCheckInStatus` **purely
from the morning record**, exactly the same way the holiday overlay
already works today, with zero dependency on any evening answer existing.
So: **the answer to "is the only way to learn not_on_site to ask" is no —
we already know it from the morning check-in.** Piece A does not depend on
Piece B.

**The tradeoff, named:** without Piece B, Piece A's `not_on_site` marking
is an INFERENCE from a morning answer that could be up to ~12 hours stale
by evening (an engineer who was genuinely absent at 6am could, in
principle, have arrived on site later in the day) — not a same-evening
CONFIRMATION. Piece B's own re-ask exists specifically to catch that edge
case with a fresher answer. Piece A alone trades a small, real staleness
risk for fully removing the all-clear lie in the ordinary case.

**A second consequence of shipping A without B, worth naming plainly:**
without Piece B, the evening trigger still fires and the flow still asks
Q1–Q5 unconditionally (roster's own hard rule, (a) above) — the
CONVERSATION itself is unfixed; the engineer still gets 5 pointless
questions. If he answers them anyway, Piece A's morning-derived
`not_applicable` overlay would still win in the DPR render (matching how
holiday's overlay already overrides regardless of whatever data exists) —
so real garbage answers get correctly hidden from the report, but the
UX problem (asking them at all) stays open until Piece B ships.

**Net: Piece A is real, shippable, and independently useful — it closes
the lie. It does not close the "why is the bot still asking me this"
experience, which stays blocked on the template.**
