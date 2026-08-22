# Flow migration re-scoping — plan only (2026-08-22)

**PLAN ONLY. No code, no migration file, no branch.**

Target state: `docs/design-decisions-beta-feedback.md` §28(l) on `main`. The earlier
Q4-removal scope (§28(b)'s original framing) does NOT cover this — attendance-as-Q1
renumbers every morning step, and evening's own question set is more than renumbered
(two questions deleted, two restructured into by-trade pairs, one moved, one added).

**SUPERSEDED IN PART, 2026-08-22 (`design-decisions-beta-feedback.md` §30):** this
plan predates §30's attendance-follow-up decision. Section (b) below scopes morning
as a straightforward 4-question flow on a single YES/NO Q1, with no branch on the NO
answer — §30(b) replaces that with a real branch: Q1 NO leads to a second question
("Is it a site holiday?"), splitting into `site_holiday` (flow ends, no PM handoff,
every remaining trigger for that engineer that day is cancelled) and `absent` (flow
ends, evening trigger still fires, PM handoff applies). Read (b) below as the
YES-path scoping only (still accurate: Q1 attendance / Q2 plan / Q3 workers by trade
/ Q4 equipment) — the NO-path handling it describes as "the flow just ends" is
superseded by §30(b)-(h) in full. The renumbering table in (b), the column work in
(c)/(d), the test list in (e)/(f), and (g)/(h)/(i) below are UNCHANGED by §30 and
still apply as written — §30 adds a NO-path branch and a new `daily_logs.attendance`
column; it does not alter the YES-path renumbering this plan already worked out.

---

## a. Which migration holds the live body, right now

**Corrected mid-research, not silently — an earlier pass in this same investigation
first (wrongly) concluded migration 018 holds `apply_morning_flow_turn`'s live body.
That is false: migration 022 ALSO redefines it, and 022 is the higher-numbered,
therefore-live one.** Recorded here so the same mistake isn't repeated by whoever
writes the actual migration.

Full `grep -l "CREATE OR REPLACE FUNCTION apply_morning_flow_turn"` across
`supabase/migrations/*.sql`, in order: `014`, `018`, `022`. **022 is live.**
Full `grep -l "CREATE OR REPLACE FUNCTION apply_evening_flow_turn"`, in order: `022`,
`024`, `025`. **025 is live.** (Migration `020` also references
`apply_morning_flow_turn` but only in a `REVOKE`/`GRANT` — confirmed by direct read,
not the body — so it doesn't change which file is the live decision-maker.)

- **`apply_morning_flow_turn`** — live body: **`supabase/migrations/022_evening_flow_apply_turn.sql:100-306`**
  (`CREATE OR REPLACE FUNCTION` at line 100, closing `$fn$;` at line 306). Yes, the
  morning function's live body sits inside the file named for the EVENING flow —
  022 introduced both in one migration.
- **`apply_evening_flow_turn`** — live body: **`supabase/migrations/025_evening_productivity_reconciliation.sql:147-813`**
  (`CREATE OR REPLACE FUNCTION` at line 147, closing `$fn$;` at line 813).

**Both must use `CREATE OR REPLACE`, never `DROP FUNCTION` + `CREATE`** — migration
020's own incident (grants silently reset to Postgres defaults after a bare
`DROP`/`CREATE` cycle) is exactly the failure class this avoids. `CREATE OR REPLACE`
preserves existing grants; the flow migration should follow 018's/022's/024's/025's
own precedent of always using it for these two functions.

---

## b. Step renumbering

**MORNING — every step-number site, current file/line, current meaning, target
meaning.** All in `supabase/migrations/022_evening_flow_apply_turn.sql`, lines
100-306 (relative offsets converted to absolute):

| Line | Current code | Current meaning | Target meaning |
|---|---|---|---|
| 148 | `v_session.current_step := 0;` | reset/idle | unchanged (idle) |
| 160 | `v_session.current_step := 1;` (on start) | jumps straight to Q1 = plan | must jump to Q1 = ATTENDANCE (new logic, not a shift) |
| 169 | strips `q2_reask`/`q3_reask` on restart | — | key names themselves need revisiting, see below |
| 187 | `ELSIF current_step = 1 THEN` | handle PLAN answer, advance to 2 | must become: handle ATTENDANCE answer (new: parse yes/no; "no" ends flow + stamps completion per §28(d); "yes" advances to 2) |
| 189 | `current_step := 2;` | → old Q2 (workers) | → new Q2 (plan) |
| 193 | `ELSIF current_step = 2 THEN` (uses `q2_reask`) | handle WORKERS answer | must become: handle PLAN answer (free text, no reask needed — same as old Q1's handling, which must MOVE here) |
| 197 | `current_step := 3;` | → old Q3 (equipment) | → new Q3 (workers by trade) |
| 206 | `ELSIF current_step = 3 THEN` (uses `q3_reask`) | handle EQUIPMENT answer | must become: handle WORKERS-BY-TRADE answer (the OLD step-2 workers logic MOVES here; reask key should logically become `q3_reask` if kept step-number-aligned — see naming note below) |
| 210 | `current_step := 4;` | → old Q4 (execution plan) | → new Q4 (equipment) |
| 219 | `ELSIF current_step = 4 THEN` | handle EXECUTION-PLAN answer, complete flow | must become: handle EQUIPMENT answer (the OLD step-3 equipment logic MOVES here, reask key logically `q4_reask`), THEN complete the flow (equipment is now the last question, same as execution-plan was) |
| 225 | `current_step := 0;` (complete) | — | unchanged mechanically — still "step count exhausted → 0" |

**Net step count stays at 4 in both old and new flows — only the number→question
mapping changes** (old: plan/workers/equipment/execution-plan; new:
attendance/plan/workers/equipment). A test or reviewer skimming "still 4 steps" could
wrongly conclude nothing structural changed; it did — every number except the total
count moved. **(Per §30(b): the NO path off Q1 now branches into a second question
rather than simply ending the flow — see the superseding note at the top of this
file. The YES-path table above, and the reask-key/mirror discussion below, are
unaffected by that branch.)**

**Reask key naming, a real decision, not just a rename:** `REASK_KEY` in
`lib/whatsapp/flows/morning.ts:58-61` (`{2: 'q2_reask', 3: 'q3_reask'}`) is currently
keyed by CURRENT step number. Two options: (i) keep the key NAMES `q2_reask`/`q3_reask`
literally, now attached to steps 3/4 respectively (functionally correct — a context key
is just a string — but confusingly named, since "q2" will track step 3's reask count);
(ii) rename to `q3_reask`/`q4_reask` to match the new step numbers the logic actually
lives at. **Recommend (ii)** — matches this project's own standing preference for a
representation that doesn't require a reader to remember a historical mapping to
understand current code (same reasoning as `morning_manpower_planned` →
`morning_manpower` in (d) below: don't leave a name that encodes an assumption no
longer true).

**MORNING — TypeScript mirror, same shifts, `lib/whatsapp/flows/morning.ts`:**
- `MORNING_STEP_ORDER` (line 51): `[1, 2, 3, 4]` — count unchanged, meaning of each
  entry changes per the table above.
- `REASK_KEY` (lines 58-61) — as above.
- `MORNING_QUESTIONS` (lines 63-72) — all four string values must move to new keys;
  key `1` becomes a NEW attendance question (not present today).
- Dispatch branches `session.current_step === 1/2/3/4` (lines 199, 204, 211, 218) —
  same shift as the SQL's `ELSIF` chain, must move in lockstep with it (this is the
  pure-mirror half of the same logic; the project's own standing discipline — see
  `test/productivity-reconciliation-mirror.test.ts`'s existence — is that the TS
  mirror and the SQL body must be changed TOGETHER and tested for agreement, not
  independently).
- `sessionUpdate = { current_step: 1, context: {} }` at flow start (line 188) — must
  change to reflect starting at the new attendance step, and — per an already-tracked,
  pre-existing finding (`CLAUDE.md`'s "morning.ts:188 TS/SQL MIRROR DIVERGENCE" entry,
  opened 2026-08-19, still open) — this exact line ALREADY diverges from the SQL's own
  `context - 'q2_reask' - 'q3_reask'` STRIP behavior (line 169 above) by doing a bare
  wipe instead. **This migration should close that pre-existing divergence in the same
  pass**, not leave a third inconsistent pattern where two are already meant to agree.

**EVENING — more than a renumbering; two questions deleted, two restructured, one
moved, one added.** Current (`lib/whatsapp/flows/evening.ts:116-121`,
`EVENING_QUESTIONS`): Q1 work+quantity, Q2 plan-met (yes/no), Q3 conditional
why-not-met, Q4 workers count, Q5 productive/idle count, (Q6, not in this map, built
dynamically: equipment hours, auto-skip). Target (§28(l)): Q1 work+quantity (UNCHANGED
— template 2 already targets this, no renumbering needed here at all), Q2 workers BY
TRADE (new column `evening_manpower`, replaces old Q4's bare count), Q3 idle hours BY
TRADE (new column `evening_idle_hours`, replaces old Q5's productive/idle count), Q4
equipment hours auto-skip (same behaviour as old Q6, moved from position 6 to
position 4), Q5 hindrance, UNCONDITIONAL (entirely new — replaces the deleted
plan-met/why-not pair, not a rename of it).

Evening reask keys (`evening.ts:90-94`): `EVENING_Q2_REASK_KEY` ('e2_reask', tracked
plan-met — **question deleted, key becomes dead**), `EVENING_Q4_REASK_KEY` +
`EVENING_Q4_HEADCOUNT_KEY` ('e4_reask'/'e4_headcount', tracked workers-count — question
restructured to by-trade, at a NEW position (2), needs new reask semantics for a
by-trade parse, not a bare count), `EVENING_Q5_REASK_KEY` ('e5_reask', tracked
productive/idle — restructured to idle-hours-by-trade, new position 3),
`EVENING_Q6_REASK_KEY` ('e6_reask', tracked equipment-hours — same question, new
position 4). `EVENING_IN_FLIGHT_KEYS` (evening.ts:102-108) must drop the dead e2 key
and rename/reposition the rest to match. A brand new reask key is needed for Q5
(hindrance) if it needs one at all (open text, may not — matching morning Q2's own
no-reask-needed precedent for free text).

**Every step-number dispatch branch in `apply_evening_flow_turn`
(`supabase/migrations/025_evening_productivity_reconciliation.sql`, current_step
comparisons at lines 258, 264, 292, 299, 319, 516) needs re-deriving from scratch
against the NEW 5-question shape** — this is not a mechanical shift like morning's,
because the underlying QUESTIONS change, not just their position.

---

## c. In-flight sessions at deploy

**Checked live, this moment, read-only, against prod (`jvxwqignooseazzmwhvl`):**
`SELECT current_flow, current_step, count(*) FROM whatsapp_sessions WHERE
current_flow IS NOT NULL GROUP BY current_flow, current_step` → **zero rows.** No
session is mid-flow right now. This is a real, current fact, not a guess — but it
reflects today's near-zero real usage (this session's own history: the outbound-send
primitive that would put real engineers into real flows on a schedule doesn't exist
yet), not a property that holds once the product is actually live. Blast radius is
currently 0 by observation, but **that number is only meaningful because nothing is
really running yet** — it says nothing about the risk once Pass 1's cron (or any
future trigger) is live and engineers are genuinely mid-flow at arbitrary times.

**Options, for when this DOES matter (post-Pass-1):**
1. **Migration-time sweep** — as part of applying this migration, reset any row still
   `current_flow='morning'`/`'evening'` to idle (or, more precisely, force-complete
   them per whatever partial-data-preservation rule is in force — see §28(d)'s
   "morning cutoff submits as-is" if this migration lands after that logic exists).
   Cost: a real engineer mid-flow at the exact deploy moment loses their in-progress
   answers unless the sweep is written to preserve them (same shape of problem as
   §29(d)'s widened B3 fix).
2. **Accept it** — let any in-flight session simply hit a step number that means
   something different post-migration; whatever they answer next is misinterpreted by
   the NEW code as an answer to the NEW step's question, silently. **Rejected** — this
   is exactly the class of silent-wrong-data bug the whole session's compliance work
   (GATE 1 itself) exists to prevent; doing it to a live engineer's real answer is the
   same defect in a different location.
3. **Deploy at a time when no session can be open** — e.g., between `eveningClose`
   (19:45 IST, per `CHECKIN_CHECKPOINTS`) and the next day's `morningSend` (08:30
   IST), when by construction (once B3's cutoff-close sweep exists) no session should
   be mid-flow. **Recommended** — this is the cheapest option (no new sweep code
   needed for the migration itself), it's a deploy-timing discipline this project
   already exercises elsewhere (CLAUDE.md's own migration-runbook timing rules), and
   it composes cleanly with option 1 as a belt-and-suspenders: deploy in the quiet
   window AND run a defensive sweep as part of the migration, so a session that
   somehow is still open (e.g., BOT-07's TTL/resume behaviour keeping something open
   past a naive expectation) doesn't silently corrupt.

---

## d. Columns

**Newly written:**
- `evening_manpower` (JSONB, by-trade workers) — new.
- `evening_idle_hours` (JSONB, by-trade idle hours) — new.
Confirmed genuinely new: `grep -rn "evening_manpower\|evening_idle_hours"
supabase/migrations/*.sql types/database.ts` → zero hits anywhere.

**Become unread** (§28(p), confirmed list, **not dropped in this migration**):
`morning_execution_plan`, `evening_schedule_met`, `evening_schedule_miss_reason`,
`evening_workers_on_site`, `evening_productive_manpower`, plus the addendum
`morning_dependencies`, `morning_hindrances`.

**Renamed** (§28(o)):
- `morning_manpower_planned` → `morning_manpower`.
- JSONB keys inside it: `planned_count` → `count`, `planned_total` → `total` —
  **confirmed live key names directly, not assumed:** §28(o)'s own text cites a real
  `daily_logs` row read off prod the same day:
  `morning_manpower_planned: {"planned_total":22,"by_trade":[{"trade":"mason",
  "planned_count":12},...]}`. **This is a DATA MIGRATION over existing rows, not an
  `ALTER TABLE ... RENAME` alone** — every existing row's JSONB payload has the OLD
  key names inside it; renaming only the column leaves `planned_count`/`planned_total`
  as dead keys inside every historical row unless a companion `UPDATE ... SET
  morning_manpower = jsonb-key-rename-transform(morning_manpower)` runs over all
  existing rows in the same migration. Per this project's own additive-vs-destructive
  migration convention (CLAUDE.md §6): this is an in-place value transform, not a
  delete, so it can use a general predicate (every row), not an enumerated pin — but
  it must still be a real, tested `UPDATE`, not assumed to follow from the column
  rename.

**Do not drop anything in this migration** — confirmed as a hard constraint from the
instruction; the "become unread" list stays as real columns with real historical data,
just no longer written by the new flow.

---

## e. The 019 sync surface — verified column by column, not inferred

**Checked directly against `supabase/migrations/019_daily_log_corrections.sql`'s own
CHECK constraint (line 98) and CASE mapping (lines 192-193), and against
`lib/dpr/assemble.ts`'s `CORRECTABLE_SCALAR_COLUMNS`:**

| Column | In 019's CHECK? | In 019's CASE? | In `CORRECTABLE_SCALAR_COLUMNS`? | Affected by this migration? |
|---|---|---|---|---|
| `morning_plan` | YES (line 98) | YES, `'text'` (line 192) | (scalar, presumably yes — same as always) | Content/position changes (step 1→2) but COLUMN itself unchanged — 019 unaffected. |
| `morning_execution_plan` | YES (line 98) | YES, `'text'` (line 193) | scalar, yes | Becomes unread (§28(p)) but NOT dropped — stays in 019's list; a PM could still theoretically correct a historical value. Harmless to leave, worth a reviewer noting, not a required change. |
| `morning_manpower_planned` / `morning_manpower` | **NO — zero hits, confirmed by direct grep** | **NO** | **NO — zero hits, confirmed** | Rename (d) does NOT touch 019 at all — it was never in scope there (JSONB, 019 is scalar-only by design). **This corrects an earlier same-day claim that it WAS in this sync surface — that claim was false, verified here again independently, not re-asserted from memory.** |
| `evening_manpower`, `evening_idle_hours` (new) | N/A (don't exist yet) | N/A | N/A | New JSONB columns — same as `morning_manpower`, out of 019's scalar-only scope by construction, no 019 change needed. |

**The REAL sync surface for the `morning_manpower_planned`→`morning_manpower`
rename, confirmed by direct grep, not assumed:** the RPC write site
(`supabase/migrations/022_evening_flow_apply_turn.sql:259,263` — note: this is inside
`apply_morning_flow_turn`'s own body per (a) above, despite the filename), 
`types/database.ts:364,395,426`, and four test files: `test/migration-019.test.ts`,
`test/morning-flow.test.ts`, `test/unit/morning-dispatch.test.ts`,
`test/helpers/db.ts` — full list in (f) below, with exact lines.

---

## f. Tests — every file:line asserting on a step number or a renamed column

**Step-number / `MORNING_QUESTIONS[N]` assertions (break when the map's content
shifts):**
- `test/dispatch.test.ts:90,168` — `MORNING_QUESTIONS[2]`
- `test/inbound-start.test.ts:74,83,163` — `MORNING_QUESTIONS[1]`, `MORNING_QUESTIONS[2]`
- `test/morning-flow.test.ts:70,81,94` — `MORNING_QUESTIONS[1]`, `[2]`, `[3]`
- `test/unit/morning-dispatch.test.ts:30,44,52,57,62,66,70` — `current_step: 0/1/2`
  literals plus `MORNING_QUESTIONS[1]`, `[2]`, `[3]`
- `test/webhook.test.ts:358,388,429` — `MORNING_QUESTIONS[2]`, `MORNING_QUESTIONS[1]`

**Renamed-column (`morning_manpower_planned`) assertions:**
- `test/helpers/db.ts:454,485` — fixture type + a raw column list string (the SELECT
  string at 485 literally spells the old name; a fixture helper, needs the rename)
- `test/migration-019.test.ts:200` — corrects `'morning_manpower_planned'` with a
  `count`-shaped payload already (`[{ role: 'mason', count: 3 }]`) — worth checking
  whether this test's OWN payload shape already anticipated the `count`/`total`
  rename or needs updating too; not resolved here, flagged for the implementer.
- `test/morning-flow.test.ts:84,88,96,114,121` — five separate assertions on
  `morning_manpower_planned`, including one that checks the OLD JSONB key shape
  directly (`{ planned_total: null, raw_text: 'still no number' }` at line 121) —
  this specific assertion needs both the column rename AND the key rename applied
  together, or it will pass against stale key names by accident.
- `test/unit/morning-dispatch.test.ts:66` — `morning_manpower_planned:
  parseLabourCount(...)` fixture construction.

**Not affected by morning's renumbering, confirmed distinct:**
`test/productivity-reconciliation-mirror.test.ts:116`'s `current_step: 5` is an
EVENING fixture (evening's own step space goes up to 6) — unaffected by morning's
shift, but WILL need its own pass once evening's restructuring (b) is implemented,
since evening step 5 changes meaning too (old: productive/idle; new: idle-hours by
trade, actually still position-adjacent but content-different).

**Evening test files not yet individually line-audited in this pass** (out of the
literal ask, which named morning's coupling most precisely, but flagged so it isn't
missed): any test asserting `EVENING_QUESTIONS[2..5]` content or `evening_schedule_met`
/`evening_workers_on_site`/`evening_productive_manpower` values will need the same
treatment as morning's list above, once evening's own restructuring is scoped in
equal depth — recommend a follow-up pass specifically for evening's test surface
before that half of the migration is written, given how much more evening changes
than morning does.

---

## g. Template coupling — confirmed directly against `main`

**Template 1** (`docs/whatsapp-templates.md`, current committed body): *"Good morning
{{1}}. This is Quoco for {{2}}.\nAre you on site today? Reply yes or no."* — this is
ATTENDANCE, matching target morning Q1 exactly, word for word ("Are you on site
today? Reply yes or no.").

**Template 2** (same file): *"Good evening {{1}}. This morning you planned:
{{3}}\nWhat *work was completed* today for {{2}}? Add the quantity if you can — e.g.
'slab concrete 120 sqm'."* — matches target evening Q1 (work + quantity) exactly, and
this position is UNCHANGED by the evening restructuring in (b) — evening Q1 was
already correct and stays correct.

**Confirmed: once this migration ships (both flows' step-1 logic matching what's
above), template 1's and template 2's already-submitted, already-pending copy will
agree with the live RPCs' actual Q1 for the first time.** This is precisely what
GATE 1 requires to lift — not Meta's approval (already noted elsewhere: GATE 1 lifts
on the flow migration shipping and being verified live, independent of Meta's own
review timeline, which is still `pending` for all 15 templates as of today's own
separate check).

---

## h. B3 interaction — which parts depend on this migration's final step numbering

§29(d) (`design-decisions-beta-feedback.md`) widened B3's fix: the 15:00 sweep must
both close a stuck `current_flow='morning'` session AND stamp whatever partial
answers exist as submitted real data (not merely reset state, per the original B3
decision in `outbound-send-primitive-plan.md` §"B3").

**Dependency, stated precisely so B3 is written once, not twice:** B3's sweep needs
to know, for a session parked at some `current_step` value, WHICH morning question
that step number corresponds to, in order to correctly interpret/preserve whatever
was already answered. Under the OLD numbering, step 2 = workers, step 3 = equipment;
under the NEW numbering (this migration), step 2 = plan, step 3 = workers, step 4 =
equipment. **If B3's sweep is written against the OLD step meanings and this flow
migration ships afterward, the sweep's own logic silently breaks the same way the RPC
itself would** — a session parked at `current_step=2` would be treated as "mid-workers"
under old-B3-logic when it's actually "mid-plan" under the new flow.

**Sequencing implication, not resolved here, flagged for whoever schedules the actual
build:** either (i) this flow migration ships FIRST, and B3's sweep is written once,
directly against the NEW step numbering, never having to support the old shape at
all; or (ii) B3 ships first (against old numbering) and must be REWRITTEN once this
migration lands. Given Pass 1's own two hard preconditions (GATE 1 AND B3, both
required before `vercel.json`'s cron entries go live, per the outbound-send plan) —
**recommend (i): this flow migration ships before B3's sweep is written**, so B3 is
built once, against the shape it will actually run against in production, rather
than built once and revised. This also means GATE 1's lift (this migration + template
agreement) and B3's build are NOT independent, parallelizable workstreams as Pass 1's
plan implicitly assumed by listing them as two separate preconditions — B3 has a real
ordering dependency on THIS migration landing first.

**CONFIRMED AS DECIDED, 2026-08-22 (`design-decisions-beta-feedback.md` §30(i) /
§29's own corrected close):** the recommendation above is no longer just a
recommendation — it's the decided order: morning flow migration ships first, then
B3's sweep is written once against the final shape, then Pass 1's two `vercel.json`
cron entries may be added.

---

## i. External review package requirements

This migration modifies live function logic (`apply_morning_flow_turn`,
`apply_evening_flow_turn`) and renames a column with an in-place JSONB data
transform — trips CLAUDE.md §0(a) (logic change) and arguably (d)/(e) depending on
how the data transform is executed (a `DELETE`-free `UPDATE` over existing rows is
additive-in-spirit but touches real historical data, worth a reviewer's explicit
read either way). Per the standing external-review gate and this project's own
established package shape:

1. **Repo-state header** — `main @ <sha>`, `supabase migration list`
   (local/remote), last runbook executed + date.
2. **Full before/after body diffs** for both RPCs, keyed to the exact line-number
   table in (b) above — a reviewer should be able to check every `ELSIF` branch
   against this table, not re-derive the mapping themselves.
3. **The `morning_manpower_planned`→`morning_manpower` data-migration `UPDATE`**,
   tested against a real pre-migration snapshot of existing JSONB shapes (not just
   the one row already read off prod) — confirm the transform is total (handles
   every row, including any with unexpected/malformed existing JSONB) before it's
   trusted to run for real.
4. **The disposable dry-run scaffold** (standing rule: every new migration gets one
   before review) — this migration is unusually well-suited to catching ordering
   bugs precisely because it's mostly `ELSIF` branch reshuffling, exactly the class
   of intra-file ordering defect the dry-run rule was created to catch (migration
   029's own origin incident).
5. **Test-db rehearsal** exercising EVERY renumbered step in sequence, both flows,
   plus the in-flight-session sweep (c) if built as part of this migration —
   real multi-turn conversations through the new step numbers, not unit tests of
   the RPC in isolation, mirroring this project's own "state-loss regression" testing
   rule (assert the END STATE of a full realistic sequence, not the mechanism).
6. **The pure-mirror/RPC agreement test**
   (`test/productivity-reconciliation-mirror.test.ts`'s own pattern) extended or
   duplicated for morning's renumbered flow — the TS mirror and the SQL body must be
   proven to agree on the new step meanings, not just individually correct.
7. **Confirmation that GATE 1 lifts** — template 1/2's copy (already committed,
   already pending Meta review) verified against the new RPC's actual Q1 output, live,
   post-apply — not a design-time argument (item g above), an observed one.
8. **The B3 sequencing decision from (h)**, recorded explicitly in the package: which
   ships first, and why, so the two workstreams don't silently diverge on step-number
   assumptions the way this file's own item (h) found could happen.
9. **A dated statement of what remains unrenumbered/unresolved** — evening's
   per-test-file audit (f) is explicitly incomplete in this pass; the package should
   either close that gap or carry it forward as a named, dated open item, not let it
   quietly vanish between this scoping pass and the real migration review.
10. **§30's attendance follow-up** (site-holiday vs. absent branch, new
    `daily_logs.attendance` column, the roster-filter amendment to
    `docs/plans/pass1-outbound-send-plan.md`) — a real addition to this migration's
    own scope, not a separate migration; the review package must cover the NO-path
    branch with the same rigor as the YES-path table in (b), including its own
    dispatch-branch/reask-key analysis, which this document does not yet provide
    (recorded as a gap here, same as evening's test-surface gap in item 9).

---

## Amendments (2026-08-22) — two findings rescued from CLAUDE.md before its split

Origin: a pre-split audit found `CLAUDE.md`'s "RECORDED, NOT FIXED (2026-08-15,
MVP schedule freeze pass)" entry (two small findings, deliberately left alone)
falls past CLAUDE.md's ~150,000-character read window and is not duplicated
anywhere else in the repo — see the tail-audit at
`/tmp/claude-md-tail-audit.md`, block 74. CLAUDE.md itself is unedited by this
rescue. Both items below were re-verified live against the current repo, not
carried forward on trust.

### j. `whatsapp_sessions.expires_at` — verified dead column, relevant to (c) and (h)

**Verification, run fresh, not inherited from the original 2026-08-15 finding:**

```
$ grep -rn "expires_at" lib/ app/
lib/whatsapp/session.ts:31:  expires_at: string
```

One hit, and it is a TypeScript interface field declaration
(`lib/whatsapp/session.ts:31`), not a read of the column's value — nothing in
`lib/` or `app/` ever branches, filters, or compares on `expires_at`.

```
$ grep -rln "expires_at" app/api/cron/ app/api/jobs/
(no output)
$ find app/api/cron app/api/jobs -type f
app/api/cron/dpr-generate/route.ts
app/api/jobs/tick/route.ts
```

Both of this project's only two scheduled/queue routes were checked directly;
neither references `expires_at`. The finding stands, re-confirmed: the column
is written by every session-generating RPC (`p_now + INTERVAL '30 minutes'`)
and read by nothing, anywhere, ever. Sessions do NOT actually expire 30
minutes after `expires_at` would suggest — the only real reset is BOT-07's
next-IST-day wipe (`quoco_same_ist_day`, compared lazily against
`updated_at` on the next inbound message, not on any background timer).

**Why this matters here, specifically — re-reading (c) and (h) above with this
in mind.** Section (c)'s "in-flight sessions at deploy" analysis leans on an
assumption that during the 19:45→08:30 IST quiet window, "no session should be
mid-flow... **once B3's cutoff-close sweep exists**" — and separately flags,
as a residual risk to guard against with a defensive sweep, "a session that
somehow is still open (e.g., BOT-07's TTL/resume behaviour keeping something
open past a naive expectation)." That parenthetical was more right than it
knew: there is no TTL/resume behaviour of that kind to keep anything open
past a naive expectation, because there is no TTL enforcement at all. A
session started at, say, 09:00 IST and abandoned mid-flow does not
self-close at 09:30 IST, at 15:00 IST, at 19:45 IST, or at any other clock
time — it sits at whatever `current_flow`/`current_step` it was last left at
until either (a) the same engineer messages again and the RPC's lazy
same-day check fires, or (b) B3's sweep (§29(d)'s widened version — reset
AND stamp partial answers as submitted, per `docs/plans/
pass1-outbound-send-plan.md` §(d)) actually runs.

That is not a marginal edge case — it is the **normal, by-design condition**
this system is in for most of every day once real usage exists: stale
morning sessions persisting all day, with nothing but B3's 15:00 (`morningCutoff`,
`lib/daily-logs/cutoffs.ts:50`) sweep and the next-day wipe standing between
"abandoned" and "silently misinterpreted by a renumbered flow." Section (c)'s
recommended option 3 (deploy during the quiet window, "belt-and-suspenders"
with a defensive migration-time sweep) is still the right call, but its
safety margin should be read as resting entirely on B3's sweep actually having
run before deploy and on the calendar-day wipe having already fired for
anything older — not on any implicit TTL, because none exists. Section (h)'s
sequencing recommendation ("this flow migration ships before B3's sweep is
written") is unaffected by this finding, but the STAKES of getting that
sequencing right are higher than (h) states on its own: without a TTL as a
backstop, B3's sweep is not one of two independent safety nets at deploy
time, it is the ONLY thing (short of the lazy day-boundary wipe) that ever
closes a stale session at all.

**Options, unchanged and unchosen — carried forward, not decided here:**
1. Read `expires_at` for real (wire an actual TTL check somewhere in the
   session-read path).
2. Drop the column (stop writing a value nothing will ever honor).

Neither is chosen in this pass. This document's own scope is the flow
migration and its interaction with B3 (item h) — a decision on `expires_at`
belongs with whoever owns B3's sweep or a future schema-cleanup pass, not
here.

### k. `lib/whatsapp/dispatch.ts`'s stale cross-reference — already fixed, CLAUDE.md's entry is stale

CLAUDE.md's paired finding #2 ("`lib/whatsapp/dispatch.ts:8-14` cites
'design-decisions §11' for the restart-start note. The restart note is §10...
not fixed in this pass") is **no longer accurate** — verified against the file
as it exists on `main` today, not assumed from the CLAUDE.md text:

```
$ sed -n '8,19p' lib/whatsapp/dispatch.ts
// Webhook-wiring deliverable named in migration 022's review package (§10).
// Implements the retry contract from that migration's own header ("call the
// OTHER rpc exactly once. Bounded by construction: one retry, never a
// loop") for ORDINARY inbound replies only -- starting a flow is a separate,
// explicit directive and is deliberately NOT handled here. Two starters
// exist above this module, neither inside it: the env-gated test-start
// sentinel (route.ts, morning-only, deterministic smoke seeding) and, as of
// the II3 build, lib/whatsapp/inbound-start.ts's routeInboundMessage (both
// flows, real production traffic, no flag -- see that file's own header).
// design-decisions-beta-feedback.md §10 (corrected cross-reference — was
// mis-cited as §11) is the restart-semantics record this build's (b)
// submitted-check mitigates around, not fixes.
```

The cross-reference already reads "§10 (corrected cross-reference — was
mis-cited as §11)". PR #76 (`feat/inbound-start-trigger`, merged
2026-08-20T16:28:00Z) fixed it as a side effect of touching that header — its
own PR body states this explicitly under "Also in this PR": *"Fixes
`dispatch.ts`'s stale cross-reference (was §11, is §10 — a previously-recorded-
but-unfixed CLAUDE.md finding, closed as a side effect of touching that
header)."* CLAUDE.md's own entry was never updated to reflect this, and is
now itself an instance of the exact failure pattern CLAUDE.md elsewhere warns
about (§0, "session notes and handover documents describe the past; the repo
describes the present").

**Doubly-checked against the "doubly stale" concern:** `design-decisions-
beta-feedback.md` §10 ("RESTART SEMANTICS — DECIDED 2026-08-15:
refuse-when-submitted", line 400) is still the correct target — §29 and §30
(both added 2026-08-22, outbound-send primitive and this flow migration,
respectively) cover unrelated topics and do not supersede §10 as the
restart-semantics record. No further fix is needed in `dispatch.ts`; the
cross-reference is correct as it stands.

**No code change made here** — `dispatch.ts` requires no edit; this section
exists only to record, with fresh verification, that the underlying finding
is resolved and CLAUDE.md's copy of it is what's out of date.
