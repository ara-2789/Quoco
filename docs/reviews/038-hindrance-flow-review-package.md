# Migration 038 — external review package

**Repo-state header** (CLAUDE.md's own standing rule, 019/020/021/022-tier):
`main @ a918350` (`a9183505cfaee331ce19944a4994d5e44195c897`).
`supabase migration list --linked`: local and remote both show 001–037, in
lockstep, no gap. Migration 038 is correctly absent from both — it has not
been applied anywhere. Last runbook executed: 036/037's own prod apply,
2026-09-06 (`docs/reviews/route-ts-naive-project-pick.md`'s sibling record
and PR #214 both reference it).

## Round 2 (2026-09-07) — B1, blocking, resolved; S-set, all six done

Your STOP verdict on the `3fc8a93` package: one blocking finding at three
sites (B1), plus six secondary findings (S-set a–f). Independently
verified before any fix was written, per your own instruction. Full delta
below; new certified commit at the end of this section.

### B1 verification — every cited line checked against the file directly

| Your claim | Found at | Verdict |
|---|---|---|
| Morning completion writes the marker | lines 460/483 | Exact match, both sites |
| Force-reset branch location | line 389 | Exact |
| `already_complete` guard lives only in the `IS NULL` branch | line 407 | Exact |
| Bare wipe | "line 397" | Actually line 400 — a comment sits at 397. Citation off by 3, substance unaffected |
| Per-step upsert overwrites the real row | lines 510–518 | Exact — `ON CONFLICT ... DO UPDATE`, ends at `morning_submitted_at = EXCLUDED.morning_submitted_at` |
| Evening mirror | 681–688 vs gate at 694 | Exact — 681 (branch), 687 (wipe), 694 (gate) |
| Evening's disciplined strip sits four lines above | 676–679 | Off by one (statement is 677–679; 676 is its trailing comment) |
| DOWN sweep, third site | (implied) | Line 1827 (pre-fix numbering): identical bare-wipe pattern, confirmed |

Also checked, not stated by you but load-bearing: `already_complete` is
already a real, modeled `MorningOutcome`/`EveningOutcome` value, and
`trigger.ts` already treats any non-`'start'` return from a `startFlow:
true` call as a genuine-race Sentry alert — it never sends the RPC's text
reply (the template already went out before this call). So returning
`already_complete` from the new branch reuses an existing signal path,
not a new one.

**B1 confirmed real, exactly as serious as described, at all three sites.**

### The fix

Two-clause branch, both morning's and evening's collision handlers:
check the flow's own submitted marker BEFORE choosing an outcome.
Submitted → clear the hindrance session (subtract-only: `context -
'q2_reask' - 'description'`) and return `already_complete`, never
`start`. Genuinely unsubmitted → force-reset survives unchanged in
behavior, but the wipe is now subtract-only too (the flow's own reask
keys plus hindrance's leftover keys — never a bare replace), so any
cross-flow marker survives by construction. The DOWN block's bulk sweep
gets the identical subtract-only treatment — no branching needed there,
since it has no outcome to decide, just uniform state cleanup.

### Scenario 5 — RED before, GREEN after (your own bar: its absence is how this passed twice)

Real Postgres 17, same scaffold discipline as scenarios 1–4 (prod schema
dump + named stubs). Sequence: real morning submission (present,
complete) → engineer taps "1", starts hindrance, abandons at Q2 →
scheduled trigger fires `startFlow:true` → engineer's *next* reply drives
a second, bogus completion.

**RED, against the pre-fix file (certified `3fc8a93`):**
```
STEP 3: force_reset_turn -> {"outcome": "start", "current_flow": "morning", "current_step": 1}
STEP 3: morning_submitted_survived -> (null)
STEP 4: second_q5 -> {"outcome": "advance", "attendance": "site_holiday", "current_flow": null}
FINAL VERDICT: final_attendance -> site_holiday
```
The engineer's real `attendance='present'` row was silently overwritten
to `site_holiday` — exact reproduction of your trace.

**GREEN, after the fix:**
```
STEP 3: force_reset_turn -> {"outcome": "already_complete", "hindrance_discarded": true, "hindrance_had_description": true, "current_flow": null}
STEP 3: morning_submitted_survived -> t
STEP 4: second_q1 -> {"outcome": "already_complete", ...}  -- idempotent, no daily_logs write
FINAL VERDICT: final_attendance -> present
```
The marker survives; the second "completion" attempt is correctly
refused (`already_complete`, no write); the real row is untouched.

**Four additional regression checks, zero failures:**
- A genuinely-unsubmitted engineer's hindrance-collision still force-resets
  to `start` (evening), unchanged behavior, now with `hindrance_discarded:
  true`.
- The DOWN sweep on an unsubmitted hindrance session clears to `{}` — no
  fabricated marker.
- The DOWN sweep on a session carrying `morning_submitted` preserves it
  while clearing hindrance state — the fix, verified at the third site too.
- Hindrance's own resolved happy path (original Scenario 1) is byte-for-byte
  unaffected.

### S-set — all six

**(a) Discard observability.** Both RPCs' `RETURN` now carry
`hindrance_discarded`/`hindrance_had_description` (`NULL` unless the
collision branch fired this turn, never `false` as a default — so a
caller can tell "didn't happen" from "happened, nothing to discard").
`trigger.ts` consumes them into a `Sentry.captureMessage` at `info` level
with a FIXED fingerprint (`['outbound-send', 'hindrance_discarded']`,
deliberately no per-engineer/per-day component, unlike every other
fingerprint in that file) — so every occurrence aggregates into one
issue's count instead of fragmenting into per-event noise. Answers your
own framing directly: "does this fire never or nightly" is now a number
in Sentry, not a question nobody could answer.

**(b) "Stale" overclaim.** Corrected throughout the file's own header —
there is no age check anywhere in either collision branch; it fires
identically on a session abandoned three seconds ago or three hours ago.
Independently checked, not just corrected on your say-so: the ACTUAL
live trigger window today is two events, not five — `morningSend` (08:30
IST) and `eveningSend` (18:30 IST), the only real `startFlow:true`
callers found by grep (`lib/whatsapp/outbound/trigger.ts`).
`CHECKIN_CHECKPOINTS` also *defines* `morningNudge` (10:00) and
`eveningNudge` (19:15), but neither has a cron route wired to it yet
(confirmed: no `vercel.json` entry, no route file) — they don't fire
today. The file's own prose now states this precisely rather than
repeating "five" or any other unverified count.

**(c) Cross-tenant.** Recommended and built: composite same-tenant FKs
(`hindrances.project_id, tenant_id -> projects(id, tenant_id)`;
`hindrances.reported_by, tenant_id -> users(id, tenant_id)`), mirroring
migration 017's own `project_members` precedent exactly — the parent
composite uniques (`users_id_tenant_id_key`, `projects_id_tenant_id_key`)
already exist, so this is a pure FK swap, no new constraint scaffolding.
**Why composite over the 019-style citation**, the alternative
considered and rejected: 019's own "plain FKs are safe" argument depends
on a table having exactly ONE writer, forever, deriving its values
through an already-verified chain. That doesn't durably hold for
`hindrances` — BOT-30 (Q6-hindrance promotion) and DASH-07 (the
hindrance tracker) are both future writers this table's own roadmap
already names, per CLAUDE.md's SPINE/FAST-FOLLOW split. A citation would
need re-verifying against every new writer; a composite FK is structural
and survives regardless. And it's genuinely free right now: grepped, zero
`INSERT INTO hindrances` anywhere in this codebase before this migration
— this is confirmed the table's first-ever writer, so there is no
existing-data risk 017 itself had to work around. Verified directly, not
asserted: a cross-tenant insert (`tenant_id` from tenant A, `project_id`
from a real project in tenant B) is **rejected** by the new constraint; a
same-tenant insert succeeds; the DOWN's own reversal restores the exact
plain FK (confirmed: the identical cross-tenant insert that was rejected
pre-DOWN **succeeds** after it, matching pre-038 behavior exactly, and no
existing row can ever violate the DOWN's own restore since a composite
FK is strictly more restrictive than the plain one it replaces).

**(d) 022's inventory.** `docs/reviews/022-review-package.md` §9 gained a
new §9.1 — the seven new/modified context-write sites from this
migration, in the same table shape, same rule citation, explaining why
the three genuinely-new sites (both collision branches, the DOWN sweep)
were the only ones that could get it wrong: they're the only sites with
no existing sibling line to copy the rule from correctly.

**(e) DOWN runbook ordering.** The DOWN section's own header now opens
with an explicit, imperative line — "REVERT THE TYPESCRIPT ROUTING
FIRST, THEN RUN THIS DOWN" — as a checkable runbook step, not just prose
buried in the existing risk paragraph a few lines below it.

**(f) Divergence guard.** `docs/reviews/038-collision-divergence-guard.test.ts`
— written, type-checked, linted, NOT moved into `test/` yet, deliberately:
migration 038 isn't applied to test-db, so a live vitest file calling
`apply_hindrance_flow_turn` there would fail CI on every future PR until
it is — the exact 035-lockstep hazard this project's own history already
names. Moves into `test/` in the same session that applies 038 to
test-db. Three scenarios (cross-day-stale, same-day-live-submitted,
same-day-live-unsubmitted), each driving BOTH morning and evening through
the identical seeded shape and asserting matching post-states — guards
against the two independently-written collision branches drifting apart
in a future edit, the same failure shape 022's own §9 already
demonstrated once. Helper extraction explicitly deferred, recorded as a
rider on whichever migration next touches either RPC.

## What this migration does, in one paragraph

Ad-hoc menu item 1 (a WhatsApp-driven hindrance report) needs its own
locked-turn RPC, `apply_hindrance_flow_turn`, same architecture as
morning/evening. Building it surfaced a real bug: if an engineer abandons
a hindrance report mid-flow and a scheduled check-in trigger (morning or
evening) fires that same day, the trigger's own `startFlow:true` call
previously fell into the generic "some other flow is active" branch and
returned `'reask'` — the check-in message still went out (send happens
before the RPC call), but the session never transitioned, and the
engineer's real check-in answer would have been swallowed by the still-
active hindrance flow. This migration fixes that by adding one new branch
each to `apply_morning_flow_turn` and `apply_evening_flow_turn`: a stale
`'hindrance'` session is now force-resettable by either trigger's
`startFlow:true` call, while a genuine morning-vs-evening collision keeps
its existing, unchanged `'reask'` handling.

## The certified file

**ROUND 2 AMENDMENT, 2026-09-07 — cite `b35b68d` (on `main`), the CURRENT
and ONLY commit to sign off on.** This is the commit containing B1's fix
(all three sites) and the full S-set (a–f) — see this document's own
"Round 2" section above for the complete writeup. Every earlier reference
below (`3fc8a93`, `3ecbbb4`, `3f376f6`) is now superseded and kept only
for traceability of what each round actually fixed; do not review or sign
off on any of them.

```
git show b35b68d:docs/reviews/038_hindrance_flow_and_collision_fix.sql
```

sha256, reproduce directly — never trust a working-tree hash for a
specific commit:

```
$ git show b35b68d:docs/reviews/038_hindrance_flow_and_collision_fix.sql | shasum -a 256
32d360e0e5b49c055db12c1ccea5fee4ed2851da31a6f42f3b115ebebf2f6438  -
```

### Prior rounds, kept for traceability only — do not sign off on any of these

**Round 1 amendment — `3fc8a93` (on `main`), superseded by `b35b68d`
above.** The `TEST-DB REHEARSAL -- NOT YET RUN` addition was authored and
first committed as `bd7147b`, on a feature branch
(`docs/038-test-db-rehearsal-gap-note`, PR #228) — that branch has since
been squash-merged and deleted, same as every other PR this session.
`bd7147b` itself is no longer reachable by a normal `git fetch`/clone
(confirmed directly: it does not appear in `gh api repos/.../branches`,
and `git branch -r --contains bd7147b` returns nothing once the remote is
pruned) — `3fc8a93` was the squash commit actually on `main` at the time.
File CONTENT was identical between the two (confirmed: same sha256 both
ways) — that was a reference correction, not a second content change.

`3fc8a93` added exactly one new comment block (`TEST-DB REHEARSAL -- NOT
YET RUN`, naming the scaffold-vs-test-db gap and the missing anon-refusal
check) on top of `3ecbbb4` and changed nothing else — confirmed by a
direct diff against `3ecbbb4` at the time, not asserted.

```
$ git show 3fc8a93:docs/reviews/038_hindrance_flow_and_collision_fix.sql | shasum -a 256
b2dee5606065e8fb81e028f152328292e1b468aaef5604b4e3a48dfb6353fd7a  -
```

The record below (superseded commit, sha256) is kept only for
traceability of the original authoring-bug fix it documents:

```
git show 3ecbbb4:docs/reviews/038_hindrance_flow_and_collision_fix.sql
```

```
$ git show 3ecbbb4:docs/reviews/038_hindrance_flow_and_collision_fix.sql | shasum -a 256
ad44d7ceaade391146c760d62e416757a78b5b37c307d74605cdfcc9120b4489  -
```

`3ecbbb4` was itself the FIXED version — it supersedes `3f376f6` (the same
file's first draft, pushed to the same branch minutes earlier), which had a
real, serious authoring bug described in full below. Do not review
`3f376f6` either. As stated at the top of this section: only `b35b68d` is
certified now.

## What you don't have without reading this section first

The migration file's own header explains the collision and the fix
mechanically. Three things it states as conclusions that this section
gives you the evidence trail for, since a reviewer should be able to
check the claim, not just read it:

1. **The force-reset only fires for `'hindrance'`, nothing else.** The new
   branch in both functions is an `ELSIF v_session.current_flow =
   'hindrance' THEN`, not a catch-all — any other non-null, non-self flow
   value still falls through to the pre-existing `ELSE v_outcome :=
   'reask'`. Verified directly (Scenario 4b, below): a live `'morning'`
   session is completely untouched by an evening trigger's `startFlow:true`
   call, exact same outcome and state as before this migration existed.

2. **The abandoned Q1 text is discarded, not written, on purpose.** No
   `hindrances` row is ever created for a force-reset session — verified
   directly (Scenario 3, below): zero matching rows after the collision
   fires. This is a deliberate reading of the pairing CHECK
   (`hindrances_timing_raw_pairing_check`, migration 036): `timing=
   'unspecified'` requires a non-NULL `timing_raw`, and an abandoned Q2 has
   no such text to hold — the engineer never answered it, so there is
   nothing to preserve without fabricating it.

3. **The two modified RPCs' new branches are currently identical in shape,
   and that's a real risk named below, not assumed safe.** Both branches do
   exactly: set `current_flow` to the RPC's own flow name, `current_step
   := 1`, `context := '{}'::jsonb`, `outcome := 'start'`. See attack point
   (c).

## The four scenarios, in full — real state, not summarized

All four run against a real Postgres 17 instance loaded from an actual
prod schema dump (`supabase db dump --linked --schema public --dry-run`,
CLAUDE.md §7's own dry-run-scaffold discipline), with the two named stubs
(`auth.users`/`auth.uid()`, roles) and `pgvector`, then migration 038
itself applied on top. Fixture tenant/project/engineer created once;
each scenario uses its own phone number so they don't interact.

### Scenario 1 — the resolved happy path

Before: no session, no `hindrances` row.

```sql
-- start
SELECT apply_hindrance_flow_turn('+919990000001', ..., '', true);
-- {"outcome": "start", "current_flow": "hindrance", "current_step": 1}

-- Q1
SELECT apply_hindrance_flow_turn('+919990000001', ..., 'Crane access blocked at the north gate', false);
-- {"outcome": "advance", "current_flow": "hindrance", "current_step": 2}

-- Q2, "1"
SELECT apply_hindrance_flow_turn('+919990000001', ..., '1', false, 'active', true);
-- {"outcome": "advance", "current_flow": null, "current_step": 0}
```

After:

```
 description                             | timing | timing_raw | submitted_via
 Crane access blocked at the north gate  | active |            | whatsapp_adhoc

 current_flow | current_step | context
               |            0 | {}
```

### Scenario 2 — the exhausted-reask branch

Before: no session, no `hindrances` row (different phone).

```sql
SELECT apply_hindrance_flow_turn('+919990000002', ..., '', true);
-- start
SELECT apply_hindrance_flow_turn('+919990000002', ..., 'Water pump not working', false);
-- advance to step 2

-- Q2, first unparseable answer
SELECT apply_hindrance_flow_turn('+919990000002', ..., 'maybe', false, NULL, false);
-- {"outcome": "reask", "current_flow": "hindrance", "current_step": 2}

-- Q2, second unparseable answer -- budget exhausted
SELECT apply_hindrance_flow_turn('+919990000002', ..., 'not sure honestly', false, NULL, false);
-- {"outcome": "advance", "current_flow": null, "current_step": 0}
```

After:

```
 description             | timing      | timing_raw          | submitted_via
 Water pump not working  | unspecified | not sure honestly   | whatsapp_adhoc
```

`timing_raw` is `'not sure honestly'` — the SECOND (resolving) turn's
literal text, not the first `'maybe'`. Matches `attendance_raw`'s own
established precedent (`030_morning_flow_attendance.sql`: `v_attendance_raw
:= v_text` set "on the resolving turn, either way").

### Scenario 3 — the collision fix itself, in full

Before: no session, no `hindrances` row, no `daily_logs` row for this
engineer/project/date (different phone).

```sql
SELECT apply_hindrance_flow_turn('+919990000003', ..., '', true);
-- start
SELECT apply_hindrance_flow_turn('+919990000003', ..., 'Generator fuel ran out', false);
-- {"outcome": "advance", "current_flow": "hindrance", "current_step": 2}
```

Session mid-abandonment (he never answers Q2):

```
 current_flow | current_step | context
 hindrance    |            2 | {"description": "Generator fuel ran out"}
```

The evening trigger fires into this live session:

```sql
SELECT apply_evening_flow_turn('+919990000003', ..., '', true);
-- {"outcome": "start", "log_date": "2026-09-07", "current_flow": "evening",
--  "current_step": 1, "equipment_echo": null}
```

His next reply, now genuinely read as a real evening Q1 answer:

```sql
SELECT apply_evening_flow_turn('+919990000003', ..., 'Poured slab on level 2', false);
-- {"outcome": "advance", "log_date": "2026-09-07", "current_flow": "evening",
--  "current_step": 2, "equipment_echo": null}
```

After, both confirmed directly, not inferred from the outcome alone:

```sql
SELECT count(*) FROM hindrances WHERE reported_by = '...' AND description = 'Generator fuel ran out';
-- 0

SELECT evening_output FROM daily_logs WHERE project_id = '...' AND engineer_id = '...';
-- 'Poured slab on level 2'
```

Zero hindrance rows for the discarded description; the real evening
answer landed in `daily_logs` exactly where it should have.

### Scenario 4 — the CHECK constraint, and the untouched collision path

**4a — the pairing CHECK genuinely rejects a fabricated row**, not just
documented as doing so:

```sql
INSERT INTO hindrances (..., timing, timing_raw, ...)
VALUES (..., 'unspecified', NULL, 'whatsapp_adhoc');
-- ERROR: check_violation — hindrances_timing_raw_pairing_check
```

Caught directly in a `DO` block via `EXCEPTION WHEN check_violation`, not
assumed from reading the constraint definition.

**4b — a genuine morning/evening collision, completely untouched**:

```sql
SELECT apply_morning_flow_turn('+919990000004', ..., '', true);
-- {"outcome": "start", "log_date": "2026-09-07", "attendance": null,
--  "current_flow": "morning", "current_step": 1}

-- evening trigger fires into the LIVE MORNING session
SELECT apply_evening_flow_turn('+919990000004', ..., '', true);
-- {"outcome": "reask", "log_date": "2026-09-07", "current_flow": "morning",
--  "current_step": 1, "equipment_echo": null}
```

After:

```
 current_flow | current_step
 morning      |            1
```

Identical outcome and state to what this exact scenario would have
produced before migration 038 existed — the new branch never fires for a
genuine two-real-flow collision, only for a stale `'hindrance'` one.

## Specific things to attack, named directly

**(a) Can the force-reset fire on a session it shouldn't?**
The branch condition is `v_session.current_flow = 'hindrance'` exactly —
not a catch-all, not a negation of `'morning'`/`'evening'`. The only way
this fires wrongly is if some future code writes `current_flow=
'hindrance'` for a reason that isn't "the ad-hoc hindrance flow is
genuinely active" — nothing in this migration does that, and
`apply_hindrance_flow_turn` is the only writer of that value anywhere in
the codebase (grepped: zero other write sites). Attack this by asking
whether anything else could ever set `current_flow='hindrance'` without
going through that RPC's own lock.

**(b) Is the discard recoverable if this decision is later judged wrong?**
No, and that's stated plainly, not hidden: once force-reset fires,
`context.description` is gone — `'{}'::jsonb` replaces it in the same
statement that starts the new flow. There is no soft-delete, no shadow
copy, no `hindrances` row with a `discarded` flag. If a future decision
reverses the §42 boundary call (Aravind's ruling: discard, not write with a
fabricated `timing_raw`), THIS migration provides no path back to the
original text — a new design would need to change what happens at
force-reset time going forward; it could not recover anything already
discarded under this behavior. Attack this by asking whether "recoverable
by resending '1'" is actually true for every case, or only the common one
— e.g., does the engineer even know his report was discarded? (Per the
design record: no, deliberately — the trigger's own prompt is unchanged,
see the migration's own header for why.)

**(c) Can the two modified RPCs' branches diverge over time, now that the
same logic exists in three places (morning, evening, and implicitly
hindrance's own absence of a "someone else started while I was running"
branch)?**
Yes, structurally, and nothing in this migration prevents it. The two new
branches are hand-copied, not shared via a common function or macro —
`apply_morning_flow_turn`'s and `apply_evening_flow_turn`'s versions are
identical today (verified: both are `current_flow := <own name>;
current_step := 1; context := '{}'::jsonb; outcome := 'start';`), but a
future edit to one (say, a reason to preserve some context field instead
of wiping it entirely) has no mechanism forcing the other to match. This is
the same class of risk this codebase already accepted for the REST of
these two functions' bodies, which have never been factored into a shared
helper despite being extremely similar in shape (matching manpower/
equipment parsing, the `quoco_same_ist_day` reset, the session-upsert
preamble) — not a new risk this migration introduces, but worth naming
since it just added a third near-duplicate. Attack this by asking whether
it's worth extracting a shared helper now, before a third near-identical
copy makes divergence more likely, or whether that's premature given the
existing precedent of tolerating this duplication elsewhere in the same
functions.

## The DOWN block — including a real bug found rehearsing it, not assumed safe

**First draft had a serious authoring bug, caught by re-running the whole
file, not by reading it.** The DOWN section was originally uncommented,
live SQL — applying the migration file via `psql -f` ran the forward
migration AND immediately reverted it in the same batch. Confirmed
directly: re-running the full file against the scaffold left
`apply_hindrance_flow_turn` not existing afterward, and the session log
showed two complete `BEGIN...COMMIT` transactions where one was expected.
Fixed in the certified commit (`3ecbbb4`) — the entire DOWN section is now
`--`-commented, matching 036/037's own convention exactly, with an
explicit note that reverting requires stripping the comment prefixes and
running it as its own deliberate operation, never by re-running this file.

**Second, more serious finding, from rehearsing the DOWN once it could
actually be isolated**: the very question you asked before the reviewer
had to. A first-draft DOWN (revert the two functions, drop
`apply_hindrance_flow_turn`, nothing else) leaves a same-day `'hindrance'`
session **permanently stuck**, not merely unresettable. Rehearsed
directly:

```sql
-- seed a live hindrance session at step 2
-- run the first-draft DOWN
-- then:
SELECT apply_hindrance_flow_turn(...);
-- ERROR: undefined_function -- the RPC that could process it is gone

SELECT apply_morning_flow_turn('<same phone>', ..., '', true);
-- {"outcome": "reask", ..., "current_flow": "hindrance", "current_step": 2}
-- completely unchanged -- the reverted body no longer force-resets it,
-- and quoco_same_ist_day doesn't fire (same calendar day)
```

Worse than "stuck": if the TypeScript routing fix (`dispatch.ts`'s `Flow`
extension, `inbound-start.ts`'s delegation) is still deployed when this
DOWN runs on the database — a real possibility, since a DB rollback and an
app rollback are not the same operation — every future inbound from that
phone number calls a function that no longer exists at the DB layer: a
hard, uncaught error, not a graceful reply.

**Fixed, and rehearsed again after the fix**: the DOWN now clears any live
`'hindrance'` session to idle before dropping the function:

```sql
UPDATE whatsapp_sessions
   SET current_flow = NULL, current_step = 0, context = '{}'::jsonb, pending_flows = '[]'::jsonb
 WHERE current_flow = 'hindrance';
```

Re-rehearsed: same seed, same DOWN (now with this line), then confirmed
directly —

```sql
SELECT current_flow, current_step, context FROM whatsapp_sessions WHERE phone_number = '<same phone>';
--               |            0 | {}
```

Idle, confirmed by direct query, not assumed from the `UPDATE`'s own
affected-row count alone (though that also read `UPDATE 1`, matching the
one seeded session).

**Answering your question directly: no, reverting 038 (with the fix
applied) does NOT leave a stale hindrance session unresettable — it costs
the same thing force-reset already costs going forward (the abandoned Q1
text, discarded), which is the accepted trade-off, not a new one.**
Without the fix, the answer would have been yes, and worse than
"unresettable" — genuinely stuck with a live crash risk attached.
