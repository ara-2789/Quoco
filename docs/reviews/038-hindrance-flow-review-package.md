# Migration 038 — external review package

**Repo-state header** (CLAUDE.md's own standing rule, 019/020/021/022-tier):
`main @ a918350` (`a9183505cfaee331ce19944a4994d5e44195c897`).
`supabase migration list --linked`: local and remote both show 001–037, in
lockstep, no gap. Migration 038 is correctly absent from both — it has not
been applied anywhere. Last runbook executed: 036/037's own prod apply,
2026-09-06 (`docs/reviews/route-ts-naive-project-pick.md`'s sibling record
and PR #214 both reference it).

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

```
git show 3ecbbb4:docs/reviews/038_hindrance_flow_and_collision_fix.sql
```

sha256, reproduce directly — never trust a working-tree hash for a
specific commit:

```
$ git show 3ecbbb4:docs/reviews/038_hindrance_flow_and_collision_fix.sql | shasum -a 256
ad44d7ceaade391146c760d62e416757a78b5b37c307d74605cdfcc9120b4489  -
```

That commit is the FIXED version — it supersedes `3f376f6` (the same file's
first draft, pushed to the same branch minutes earlier), which had a real,
serious authoring bug described in full below. Do not review `3f376f6`;
only `3ecbbb4` is certified.

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
