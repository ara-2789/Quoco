# Morning flow migration — review package (SPEC HALF ONLY)

**No migration file. No code.** This package contains the four artifacts that do
not depend on the migration existing: the repo-state header, the step-mapping
spec, the GATE 1 verification plan, and the B3-sequencing/open-items record.
Written deliberately BEFORE the SQL/TS, per this project's own dry-run/mirror
discipline: a spec derived from the finished code would only describe the
implementation, not test it.

Source: `docs/plans/flow-migration-rescoping-plan.md`, and
`design-decisions-beta-feedback.md` §28(l), §29, §30 on `main`.
**§30(b) supersedes the plan's morning question set** — the plan predates the
attendance follow-up and scopes a straightforward 4-question morning on a single
YES/NO Q1, no branch on the NO answer. This package's step-mapping table (§2
below) is the first place the NO-path branch and its own reask/dispatch logic
are worked out in the same rigor as the YES path — the re-scoping plan's own
item (i)#10 names this as an explicit gap ("the review package must cover the
NO-path branch with the same rigor as the YES-path table... which this document
does not yet provide"). Anywhere this package introduces a design not already
decided in §30 itself, it is marked **PROPOSED, NOT YET IN §30** so it is not
mistaken for an already-settled decision.

**RESOLVED — a real finding, caught pre-apply, fixed the same day (§10 below
has the full record, kept as-found, not deleted).** The first draft of
`030_morning_flow_attendance.sql` appended two new trailing parameters
(`p_yesno_met`, `p_yesno_ok`) to `apply_morning_flow_turn` via `CREATE OR
REPLACE FUNCTION`. That does **NOT** replace the existing function —
Postgres treats an appended parameter list as a different function
identity — so that draft left **two live, separately-callable overloads**:
the stale pre-030 12-arg body stayed live and `service_role`-executable,
and any caller omitting the two new named args (e.g.
`test/migration-020.test.ts`'s `APPLY_ARGS`) got `function
apply_morning_flow_turn(...) is not unique` instead of the ACL result it's
testing for. **Fixed 2026-08-23 (Aravind's decision):** the RPC's signature
is now byte-identical to the pre-migration one — zero new parameters — and
the Q1/holiday-follow-up yes/no classification happens INSIDE the function
(`quoco_classify_yes_no`, new this migration) instead. Re-verified live:
exactly one `apply_morning_flow_turn` exists post-migration, the pre- and
post-migration signatures are byte-identical, and the previously-ambiguous
partial call now resolves cleanly again. Full before/after evidence: §10.

---

## 1. Repo-state header

Per CLAUDE.md §0's standing rule (every review request at this tier opens with
a two-line repo-state header) — raw output, not summarised.

**`main @` sha:**
```
9456fdcdcec67fdc13c76eeaadf9561ed4b1b292
```

**`supabase migration list` (local vs. remote), run live against the linked
project, this session:**
```
Initialising login role...
Connecting to remote database...
{"migrations":[{"local":"001","remote":"001","time":"001"},{"local":"002","remote":"002","time":"002"},{"local":"003","remote":"003","time":"003"},{"local":"004","remote":"004","time":"004"},{"local":"005","remote":"005","time":"005"},{"local":"006","remote":"006","time":"006"},{"local":"007","remote":"007","time":"007"},{"local":"011","remote":"011","time":"011"},{"local":"012","remote":"012","time":"012"},{"local":"013","remote":"013","time":"013"},{"local":"014","remote":"014","time":"014"},{"local":"015","remote":"015","time":"015"},{"local":"016","remote":"016","time":"016"},{"local":"017","remote":"017","time":"017"},{"local":"018","remote":"018","time":"018"},{"local":"019","remote":"019","time":"019"},{"local":"020","remote":"020","time":"020"},{"local":"021","remote":"021","time":"021"},{"local":"022","remote":"022","time":"022"},{"local":"023","remote":"023","time":"023"},{"local":"024","remote":"024","time":"024"},{"local":"025","remote":"025","time":"025"},{"local":"027","remote":"027","time":"027"},{"local":"028","remote":"028","time":"028"},{"local":"029","remote":"029","time":"029"}],"message":"Migrations listed"}
```
Local and remote agree on every entry. Known gap at 008-010 (never created,
documented elsewhere in CLAUDE.md's migration-numbering history) and 026 (never
built — the `dprs.generation_claimed_at` design, superseded by direct sweep
work) — neither is a drift, both are pre-existing, accounted-for absences.

**Last runbook executed, and date:** migration 029's apply runbook
(`docs/reviews/029-dpr-versioning-review-package.md` §9-§13), executed
**2026-08-20**. Raw excerpt, that file's own §9/§13 headings and outcome lines:
```
## 9. Apply runbook
...
**Test-db: A-E all run and confirmed (2026-08-20, full rehearsal, commit `6c2cabf`).**
...
**Prod: APPLIED (2026-08-20, Aravind's explicit GO, S0-S6).** Linked ref pasted fresh
...
## 13. PROD APPLY — S0-S6, then a live security finding, found and closed (U1-U5, 2026-08-20)
```
Confirmed via `git log` for `supabase/migrations/029_dpr_versioning.sql`:
commit `4bdb1ba` — "029 DPR versioning: applied to prod 2026-08-20, aligning
repo with database."

---

## 2. The step-mapping table — the spec the migration must satisfy

Live body: `supabase/migrations/022_evening_flow_apply_turn.sql:100-306`
(`apply_morning_flow_turn`). TS mirror: `lib/whatsapp/flows/morning.ts`
(`dispatchMorningFlow`). Line numbers below are read fresh against `main @
9456fdc`, not carried over from the re-scoping plan (which cites the same
function and, at the two lines this package rechecked, agrees — 022:169 strips
`q2_reask`/`q3_reask` on restart, 022:259/263 write `morning_manpower_planned`
— both confirmed live in this session, not assumed).

### New step-numbering design (PROPOSED, NOT YET IN §30)

§30(b) specifies the CONVERSATION shape (Q1 attendance → YES: Q2/Q3/Q4 normal
route; NO: a second question, splitting into `site_holiday`/`absent`) but does
not assign `current_step` values to the NO-path follow-up — it isn't reachable
by simply continuing the YES path's 1→2→3→4 sequence. This package proposes:

- **Step 5 = "holiday follow-up"** — reachable ONLY from step 1's NO answer,
  never from the normal sequential advance. Keeps the YES-path numbering
  exactly as the re-scoping plan's own table already scoped it (1 attendance /
  2 plan / 3 workers / 4 equipment) — no further renumbering needed there.
- **New reask keys, same step-number-keyed naming convention the re-scoping
  plan recommends for the existing rename**: `q1_reask` (attendance, step 1)
  and `q5_reask` (holiday follow-up, step 5). Both reuse the existing
  `MORNING_PARSE_REASK_CAP = 1` budget — no new cap value proposed.
- **Parser**: reuse `classifyYesNo` (`lib/whatsapp/flows/parsers/lexicon.ts:319`)
  for both yes/no questions — it is already a generic word-level yes/no
  classifier (`{met, ok}`) despite the evening-Q2-flavoured field name, already
  proven on real messy input via evening's own Q2. Whoever writes the code may
  wrap it in a thin semantic alias (`classifyAttendance`/`classifyHolidayAnswer`)
  for readability; not required.
- **Default-on-exhausted-reask direction — DECIDED by Aravind, 2026-08-23**
  (this package's first draft proposed the wrong application of the right
  principle; corrected here, not silently). **The rule, stated explicitly so
  the next reader applies it rather than re-deriving it: default to
  whichever branch preserves MORE downstream capture, not less.** That
  principle is unchanged from the first draft. What was wrong was applying
  it to attendance (step 1) the same way evening's Q2 applies it — on
  evening Q2, "no" OPENS an extra question (Q3, the miss-reason), so
  defaulting to "no" captures more. **Morning Q1 is the reverse: NO is the
  SHORTER path** (one follow-up question, then the flow ends), and YES is
  the LONGER one (continues to plan/workers/equipment). Defaulting an
  unparseable attendance answer to NO therefore captures LESS, the opposite
  of the rule's intent — carried over from evening's shape without checking
  it still pointed the same direction.
  **Decided: attendance's exhausted-reask default is YES, not NO.**
  Asymmetry of consequence, which is the actual justification, not just the
  restated principle:
    - Default to YES when the engineer is actually absent → three questions
      (plan/workers/equipment) go unanswered, the session sits at whatever
      step it stalls at, and B3's 15:00 sweep closes it as a partial
      submission. **Visible and recoverable** — a PM looking at that day's
      log sees three blank fields, not a false "present" with real data
      behind it.
    - Default to NO when the engineer is actually present and willing →
      `attendance = 'absent'` is written, the flow ends immediately, and
      plan/manpower/equipment are **never captured at all** from someone who
      was on site and answering. **Silent, and indistinguishable from a
      real absence** — nothing downstream can tell the difference between
      "genuinely absent" and "answered ambiguously, defaulted wrong."
  With `MORNING_PARSE_REASK_CAP = 1`, this default fires after only two
  unparseable attempts — not a rare tail case.
  **The holiday follow-up's own default stays `absent`** (unchanged from the
  first draft) — already correct under the SAME rule, correctly applied
  there the first time: `absent` keeps the evening trigger and PM handoff
  alive (more capture), `site_holiday` would silently cancel both (less).
  See row F4 in the SQL table and its TS mirror row below for the corrected
  branch target.
- **Completion copy for the two NO-path endings — DECIDED, 2026-08-23**
  (§2.1) — §30(b) gives the two follow-up QUESTIONS their copy but not the
  completion messages. Drafted here rather than left undecided (one round of
  revision on the absent-path string — see §2.1), since a spec that leaves
  reply copy open invites it to be silently defaulted to the generic
  `MORNING_COMPLETE_REPLY` string at build time without anyone deciding
  that's right.

### 2.1 Completion copy — DECIDED by Aravind, 2026-08-23

Matching `MORNING_COMPLETE_REPLY`'s existing register (✅ prefix, short,
warm, plain sentence) — and, per instruction, **not promising PM
notification on the absent path**: nothing can notify a PM until Pass 2's
escalation send exists (§30(e)) — a promise here would be the same defect as
template 8's "Reply STOP" (a written commitment the code cannot yet keep).

**`MORNING_SITE_HOLIDAY_REPLY`** — **APPROVED as drafted.** Site holiday:
acknowledges the closure, confirms nothing further will be asked today:
> ✅ Got it — site holiday recorded. No further check-ins needed today.

**`MORNING_ABSENT_REPLY`** — **REVISED and APPROVED, 2026-08-23.** First
draft ("Today's check-in is recorded.") read as closure, which is wrong on
this path: §30(b) keeps the evening trigger alive for `absent` (half-day and
late-arrival cases are real — the engineer, or someone else, may still be
working, and this engineer may arrive later), so telling him he's done and
then messaging him again at 18:30 contradicts the reply he was just given.
The contrast with the holiday string is what sharpens this: one explicitly
says nothing more is coming, the other, as first drafted, implied the same
thing without meaning to.
> ✅ Got it, thanks for letting us know. We'll still check in this evening.

**Reason the revision matters, recorded alongside the string, not just the
string itself:** the reply must set the correct expectation because the
evening trigger genuinely still fires for `absent` (§30(b)) — and stating
this explicitly is also useful as a SIGNAL, not just an accurate promise: an
engineer who reaches site later in the day still has an evening capture
coming, and this line is what tells him that.

Both PROPOSED, not yet approved — carried into §2's table (rows J1/J2) as
the completion reply for those two branches, pending sign-off.

### SQL — `apply_morning_flow_turn` (`022_evening_flow_apply_turn.sql:100-306`)

| # | Current line(s) | Current step # | Current meaning | TARGET step # | TARGET meaning | What changes in the write |
|---|---|---|---|---|---|---|
| A | 157-160, 169-170 | — (start) | `p_start_flow`, no active flow → `current_step := 1`, strip `q2_reask`/`q3_reask` | — (start) | Same mechanism; strip list becomes `q1_reask`/`q3_reask`/`q4_reask`/`q5_reask` (every parsed-step reask key, not just two) | No `daily_logs` write on start (unchanged). Step 1's MEANING changes from plan to attendance — no write-path change here, only downstream. |
| B | 171-172 | — (start) | `p_start_flow`, flow already active → `reask` | — (start) | Unchanged | None. |
| C | 175-177 | — (idle check) | flow NULL, `morning_submitted` context flag true → `already_complete` | — (idle check) | Unchanged mechanically, but now must also be true after EITHER NO-path completion (J1/J2 below), not only the YES-path Q4 completion — see those rows for the flag write. | None here; depends on J1/J2 setting the flag correctly. |
| D | 178-179 | — (idle check) | flow NULL, not submitted → `idle` | — (idle check) | Unchanged | None. |
| E | 184-185 | any | `v_text = ''` → `reask`, unlimited, no write | any (incl. new 1, 5) | Unchanged — applies at every step including the two new ones | None. |
| F1 | 187-192 (becomes new logic) | 1 | Free text → `morning_plan`, advance to 2 | **1** | **NEW: parse attendance via `classifyYesNo`. `ok && met` (YES) → advance to 2.** | Write `attendance = 'present'`, materialises the row (replaces old step-1's row-materialising role — same UPSERT shape, new column). `morning_plan` is NOT written here anymore. |
| F2 | (new) | — | — | **1 → 5** | **NEW: `ok && !met` (NO) → advance to 5 (holiday follow-up).** | No `daily_logs` write yet — attendance isn't known until the follow-up resolves. Reset `q1_reask := 0`. |
| F3 | (new) | — | — | **1 (unchanged)** | **NEW: `!ok`, `q1_reask` budget available → `reask`.** | None. Increment `q1_reask`. |
| F4 | (new) | — | — | **1 → 2** | **NEW: `!ok`, budget exhausted → default to YES (DECIDED 2026-08-23, corrected from this package's first draft — see the note above), same as F1.** | Write `attendance = 'present'`, same as F1. Reset `q1_reask := 0`. |
| G | 187-192 (moves here) | 2 | `q2_reask`-tracked labour parse | **2** | **Free text → `morning_plan`, advance to 3.** (old step 1's logic, moved) | Write `morning_plan`. |
| H | 193-205 | 2 | `q2_reask`-tracked labour parse → advance to 3 | **3** | **Parsed labour (old step-2 logic, moved), reask key renamed `q2_reask`→`q3_reask`** | Write `morning_manpower` (renamed column, JSONB keys `planned_count`→`count`, `planned_total`→`total` — see plan §d; data-migration `UPDATE` over existing rows required, not covered by this table). |
| I | 206-217 | 3 | `q3_reask`-tracked equipment parse → advance to 4 | **4** | **Parsed equipment (old step-3 logic, moved), reask key renamed `q3_reask`→`q4_reask`** | Write `morning_equipment` (column unchanged). |
| J1 | (new, replaces 219-230's role) | — | — | **5 → 0 (complete)** | **NEW: holiday follow-up, `ok && met` (YES = site holiday).** | Write `attendance = 'site_holiday'`, `is_holiday = true`, `morning_submitted_at = p_now`. Merge `context.morning_submitted := true` (strip all reask keys) — same merge discipline as the existing Q4 completion (022's CONTEXT DISCIPLINE site 2). Reply: `MORNING_SITE_HOLIDAY_REPLY` (§2.1, DECIDED). |
| J2 | (new) | — | — | **5 → 0 (complete)** | **NEW: `ok && !met` (NO = absent).** | Write `attendance = 'absent'`, `morning_submitted_at = p_now`. Same context merge as J1. (`is_holiday` stays `false`, its default.) Reply: `MORNING_ABSENT_REPLY` (§2.1, DECIDED). |
| J3 | (new) | — | — | **5 (unchanged)** | **NEW: `!ok`, `q5_reask` budget available → `reask`.** | None. Increment `q5_reask`. |
| J4 | (new) | — | — | **5 → 0 (complete)** | **NEW: `!ok`, budget exhausted → accept as `absent` (pessimistic default), same as J2.** | Same as J2. |
| K | 219-230 (role removed) | 4 | Free text → `morning_execution_plan`, complete | **4 → 0 (complete, moves to I above)** | Equipment (I) now completes the flow directly — this branch's ORIGINAL role (free-text execution plan) is retired. | `morning_execution_plan` is **no longer written** by this RPC (becomes unread, per plan §d / §28(p) — column stays, historical rows stay readable, just no new writes). |
| L | 231-232 | else | `reask` catch-all | else (incl. new step values) | Unchanged | None. |
| M | 235-242 | — | different flow active → `wrong_flow` | — | Unchanged | None. |

Row K is listed to make the retirement of the old step-4 write explicit, not
because it survives as its own branch — its numeric slot (old step 4) is
reused by row I (equipment), and its logic (free-text → `morning_execution_plan`
+ complete) has no target branch at all.

**Net step count: 4 on the YES path (unchanged from the plan's own scoping),
plus a 5th value reachable only via the NO branch — five distinct
`current_step` values now exist in morning's step space (1,2,3,4,5), not four.**
This is a structural difference from the re-scoping plan's own table, which
this package's superseding note (top of file) already flags.

### TypeScript mirror — `dispatchMorningFlow` (`lib/whatsapp/flows/morning.ts`)

Same rows, same letters, checked against the SQL table above rather than
derived independently — this is the whole point of keying both to one table
(mirrors this project's own `test/productivity-reconciliation-mirror.test.ts`
discipline: the TS mirror and the SQL body are changed together, tested for
agreement, not independently).

| # | Current line(s) | Current TS logic | TARGET TS logic | Notes |
|---|---|---|---|---|
| A | `morning.ts:188` — `sessionUpdate = { current_step: 1, context: {} }` | Bare wipe on start | Same site — **also closes the pre-existing TS/SQL divergence CLAUDE.md already tracks** ("morning.ts:188 TS/SQL MIRROR DIVERGENCE", opened 2026-08-19): must become a STRIP of the reask keys (`q1_reask`/`q3_reask`/`q4_reask`/`q5_reask`), matching the SQL's `context - ...` behaviour, not a bare `{}` replace. Per the re-scoping plan's own instruction, this migration should close that divergence in the same pass, not leave a third inconsistent pattern. | Not new scope — an already-open, already-tracked item this migration is the natural place to close. |
| B | (mirror of RPC's already-active-flow branch, `startFlow` + `session.current_flow !== null` → `outcome = 'reask'`) | Unchanged | Unchanged | — |
| C | `morning.ts:195` (`submitted ? 'already_complete' : 'idle'`) | Reads `context['morning_submitted']` | Unchanged mechanically; depends on J1/J2 setting the flag (below) | — |
| D | same line as C | — | Unchanged | — |
| E | `morning.ts:196-198` (`text === ''` → `reask`) | Unchanged | Unchanged — applies at new steps 1 and 5 too | — |
| F1-F4 | `morning.ts:199-203` (`current_step === 1` branch, currently free-text → `morning_plan`) | Replaced entirely | New `classifyYesNo`-driven branch, structurally mirroring evening's own step-2 handling (`evening.ts:447-462`) — reask via a new `q1_reask` context key, `MORNING_PARSE_REASK_CAP`, advance to **2 on YES, and on the exhausted-reask default (DECIDED 2026-08-23 — see §2's note)**; advance to 5 only on a genuinely parsed NO | `MorningDailyLogWrite` type gains `attendance?: 'present' \| 'absent' \| 'site_holiday'` and `is_holiday?: boolean`. |
| G | `morning.ts:204-210` (`current_step === 2`, parsed labour) | Moves to step 3's handling | Step 2's handling becomes free-text `morning_plan`, mirroring OLD step-1 logic (`morning.ts:199-203`'s current shape) | — |
| H | `morning.ts:211-217` (`current_step === 3`, parsed equipment) | Moves to step 4's handling | Step 3's handling becomes parsed labour (old step-2 logic, moved); `REASK_KEY[3]` renamed from tracking step 2 to being the ACTUAL key at step 3 — see rename note below | `decideParsedStep(3, ...)` call site unchanged in shape, `REASK_KEY` map's `2:` entry becomes `3: 'q3_reask'`. |
| I | (new — equipment becomes the completion branch) | — | Step 4's handling becomes parsed equipment (old step-3 logic, moved) AND completes the flow (context merge, `current_step: 0`, `morning_submitted: true`) — absorbs old step-4's completion mechanics, not its content | `REASK_KEY`'s `3:` entry becomes `4: 'q4_reask'`. `dailyLogWrite` becomes `{ morning_equipment: parse, morning_submitted_at: now }`. |
| J1-J4 | (new — step 5) | — | New branch: `classifyYesNo` on the holiday follow-up, `q5_reask` context key, `MORNING_PARSE_REASK_CAP`, YES → `attendance: 'site_holiday', is_holiday: true`, NO/exhausted → `attendance: 'absent'`; both complete the flow (same merge shape as I) | — |
| K | `morning.ts:218-229` (`current_step === 4`, free-text execution plan + complete) | Retired — logic moves to I, content does not survive | `morning_execution_plan` dropped from `MorningDailyLogWrite`'s active write paths (type may keep the field for historical-read call sites; not written by `dispatchMorningFlow` going forward) | — |
| L | `morning.ts:229-231` (`else → reask`) | Unchanged | Unchanged | — |
| M | `morning.ts:232-236` (`wrong_flow`) | Unchanged | Unchanged | — |

**Reask-key rename, with rationale (`REASK_KEY`, `morning.ts:58-61`):**
`{2: 'q2_reask', 3: 'q3_reask'}` → `{3: 'q3_reask', 4: 'q4_reask'}` (plus the two
new entries `{1: 'q1_reask', 5: 'q5_reask'}` from this package's own new
branches). The re-scoping plan considered two options: (i) keep the NAMES
`q2_reask`/`q3_reask` literally, now attached to steps 3/4 (functionally
correct, confusingly named — "q2" would track step 3's reask count); (ii)
rename to match the step the logic now lives at. **The plan recommends (ii)
and this package carries that forward** — matches this project's own standing
preference against a representation that requires a reader to remember a
historical mapping to understand current code (the same reasoning as
`morning_manpower_planned` → `morning_manpower`, plan §d: don't leave a name
that encodes an assumption no longer true).

**`MORNING_QUESTIONS` (`morning.ts:67-72`)** — all values move to new keys;
key `1` becomes the new attendance question ("Are you on site today? Reply yes
or no." — literally template 1's Q1 line, per §3 below); a new key `5` is
added for the holiday follow-up ("Is it a site holiday? Reply yes or no.",
§30(b)'s own copy).

**`MORNING_STEP_ORDER` (`morning.ts:52`)** — currently `[1, 2, 3, 4]`, and
currently unused anywhere else in the repo (`grep -rn "MORNING_STEP_ORDER"
lib/ test/ app/` returns only its own declaration and header comment) — no
functional consumer to break. **Proposed: leave as `[1, 2, 3, 4]`**,
documenting the YES-path sequential order only, with a comment noting step 5
is a NO-path branch state, not part of the sequential progression. Flagged as
an implementer's documentation choice, not a functional requirement.

---

## 3. GATE 1 verification plan

Per `docs/whatsapp-templates.md`'s own GATE 1 text: template 1 already embeds
attendance as Q1 ("Are you on site today? Reply yes or no.") and is
pending-submitted; the RPC's real step 1 is still the plan question. **GATE 1
lifts when the flow migration ships AND is verified live** — not on a
design-time argument that the copy "should" now agree, an OBSERVED one.

**Primary check — behavioural, the actual write path, not the reply string.**
The risk GATE 1 exists to close is silent miswrite (an engineer's "yes"/"no"
landing in `morning_plan` as free text instead of `attendance`), so the
observation must prove the WRITE, not just the prompt text:

1. Start a session at step 1 the same way this project's established smoke
   checks do (migrations 020/025/027's own precedent): reactivate a test
   engineer, either via a real WhatsApp message through the live webhook (per
   CLAUDE.md §7's "exercise it end-to-end against the Twilio sandbox on a real
   handset" rule) or, if no handset is available at verification time, a
   direct `apply_morning_flow_turn(p_start_flow=true, ...)` RPC call against
   prod with a real test engineer/phone.
2. Send the literal reply an engineer would send to template 1's actual
   question — `"yes"` — through the SAME path production will use (the real
   webhook, for the live-handset case).
3. **The query that produces the evidence:**
   ```sql
   SELECT attendance, morning_plan, is_holiday, morning_submitted_at
   FROM daily_logs
   WHERE engineer_id = '<test engineer id>'
     AND project_id  = '<test project id>'
     AND log_date    = '<today, IST>';
   ```
   **PASS condition:** `attendance = 'present'`, `morning_plan IS NULL` (Q2
   not yet answered). Pre-migration, this exact test would show `morning_plan
   = 'yes'` and no `attendance` column at all — that contrast IS the proof.
4. Repeat with `"no"` → `"yes"` (site holiday) and `"no"` → `"no"` (absent),
   confirming `attendance = 'site_holiday'`/`'absent'` respectively via the
   same query, and `is_holiday = true` only on the site-holiday case.
5. Test engineer deactivated and session reset afterward, per this project's
   standing artifact-hygiene discipline (020/025/027's own close-out pattern).

**Secondary check — static, string-level, run in the same post-apply pass
(not before — CLAUDE.md §0's observation-over-checklist rule applies to this
too):** diff `MORNING_QUESTIONS[1]` (`morning.ts`) against template 1's
committed Q1 line (`docs/whatsapp-templates.md`, "Are you on site today? Reply
yes or no."). This does not on its own prove GATE 1 (a matching STRING with a
mismatched WRITE PATH would still be the silent-miswrite bug) — it's a cheap
second signal, not a substitute for the behavioural check above.

**Evidence artifact:** the query output (step 3/4 above) plus the string diff,
both captured with the migration's SHA and an empty `git status --porcelain`
alongside, per CLAUDE.md's ARTIFACT PROVENANCE rule — not yet run; see §5.

---

## 4. B3 sequencing + open items

**Sequencing, per §30(i) (`design-decisions-beta-feedback.md`):** this
migration ships FIRST; B3's sweep (the 15:00 IST stuck-session sweep, per
`docs/plans/pass1-outbound-send-plan.md` §29(d)'s widened fix) is written
SECOND, once against this migration's final step numbering; Pass 1's two
`vercel.json` cron entries are added THIRD, only once both of the above are
done. **Why:** B3's sweep needs to know, for a session parked at some
`current_step` value, which morning question that step corresponds to, in
order to correctly interpret and preserve whatever partial answer already
exists. Under the OLD numbering, step 2 = workers; under the numbering THIS
migration introduces (§2's table above), step 2 = plan, step 3 = workers, and
a session can now also be parked at the entirely new step 5. If B3 is written
against the old shape and this migration ships afterward, the sweep's own
logic silently breaks the same way the RPC itself would — a session parked at
`current_step=2` would be treated as "mid-workers" under old-B3-logic when
it's actually "mid-plan" under the new flow. §30(i) itself is a correction to
§29, which had originally listed GATE 1 and B3 as two independent,
parallelizable preconditions on Pass 1's cron entries — they are ordered, not
parallel, and this migration is the thing B3 is ordered behind.

**Step 5 is a new parked state B3 must specifically know about — spec'd here
so it's in the shape B3 is built from, not discovered later.** §2's proposed
step 5 (the holiday follow-up) is reachable only from step 1's NO answer
(row F2), and — unlike steps 2/3/4 — a session parked there corresponds to a
`daily_logs` row that may not even exist yet: per row F1/F2, `attendance`
(and the row itself, if this is the first answer of the day) is only written
on a YES at step 1; a NO advances to step 5 with **no `daily_logs` write at
all**. So a session B3 finds stuck at `current_step=5` has answered Q1 = NO
(that much is known — the engineer replied, and it parsed as NO) but has
never resolved holiday-vs-absent, and possibly has no row for that
engineer/date yet.
**PROPOSED, same "more capture" rule as the exhausted-reask defaults above,
not yet decided:** B3's sweep should treat a stuck step-5 session the same
way the exhausted-reask default at that step already does — stamp
`attendance = 'absent'` (INSERT the row if none exists yet), not
`site_holiday` and not left fully unresolved. Reasoning: the engineer is
KNOWN to have replied and to have said NO to being on site — that is real
signal, not silence — and `absent` is the branch that keeps the evening
trigger and PM handoff alive, the same asymmetry-of-consequence argument
made for the exhausted-reask default in §2. Whoever writes B3's sweep should
confirm this against §2's rule explicitly, not re-derive it from scratch.

**Dated statement of what this migration does NOT cover (2026-08-23):**
- **Evening's restructuring** — a separate migration, per §30(a) (morning and
  evening ship as two migrations, not one bundled change; morning is a
  mechanical renumber, evening deletes/restructures/adds questions and has its
  own not-yet-audited test surface).
- **The PM edit UI** — §30(e)'s "PM handoff on the absent path" depends on a
  web UI over migration 019's `correct_daily_log` RPC, which has existed with
  **zero frontend callers** since 019 shipped. This migration writes
  `attendance = 'absent'` correctly; nothing surfaces that fact to a PM, or
  lets one fill in the missing plan/manpower/equipment for that engineer's
  scope. Known gap, not solved here, per §30(e)'s own text: "nothing can
  currently NOTIFY the PM that a handoff is needed."
- **DPR site-closed rendering** — §30(f): a site-holiday day should render as
  "SITE CLOSED" in the generated DPR, not "evening check-in not received."
  This is an `assemble.ts` change, explicitly recorded in §30(f) as its own
  work item, separate from both flow migrations.
- **Evening's test surface** — the re-scoping plan's own §f explicitly did not
  audit evening's test files line-by-line ("out of the literal ask... flagged
  so it isn't missed... recommend a follow-up pass specifically for evening's
  test surface before that half of the migration is written"). Carried
  forward here as still open, unaffected by this migration since evening ships
  separately (§30(a) above).
- **Recorded, not fixed — the exhausted-reask attendance default carries no
  confidence marker (2026-08-23).** F4's default (§2's table; `030_
  morning_flow_attendance.sql:237-263`) writes `attendance = 'present'` for
  an engineer who never actually stated he was on site — an unclassifiable
  answer, reasked once, still unclassifiable, guessed as YES per the
  asymmetry-of-consequence argument above. That write is stored **identically**
  to a genuine, cleanly-parsed "yes" — nothing on the row, or anywhere
  downstream, distinguishes a confident answer from a default guess. Same
  shape as the 2026-08-21 equipment defect ("Cement, ₹1000/day" stored as a
  confident parse with no hedge). This is **not new scope for this
  migration** — it is this project's own standing, already-tracked PARSER
  DEBT: Rule 3.5 (`docs/design-principles.md:31`) promises "accept whatever
  comes and flag it low-confidence for PM review," and `docs/build-status.md`'s
  PARSER DEBT entry (opened 2026-07-28) already records that the flag half of
  that promise was never built — `LabourParse`/`EquipmentParse` carry no
  `confidence` field, and the only place a `confidence` field exists anywhere
  in the schema today is `evening_productive_manpower` (migration 024,
  `docs/schema.md:237-238`). `attendance` (this migration's own new column)
  is a second, un-flagged instance of the identical gap, not a new one this
  migration introduces or is asked to close. Named here so the reviewer sees
  it recorded rather than rediscovering it.

**Finding (j), carried forward from the re-scoping plan
(`docs/plans/flow-migration-rescoping-plan.md` §j) — relevant to B3
specifically:** `whatsapp_sessions.expires_at` is written by every
session-generating RPC (`p_now + INTERVAL '30 minutes'`) and read by nothing,
anywhere, in `lib/`, `app/`, or either of this project's two scheduled routes
(`app/api/cron/dpr-generate/route.ts`, `app/api/jobs/tick/route.ts`) —
verified live in that plan, not inherited on trust. **Sessions do not actually
expire.** The only real reset is BOT-07's next-IST-day wipe
(`quoco_same_ist_day`, compared lazily against `updated_at` on the next
inbound message, not on any background timer). Consequence for B3, stated
precisely: B3's sweep is not one of two independent safety nets at deploy
time (a TTL plus a sweep) — **it is the ONLY thing, short of the lazy
day-boundary wipe, that ever closes a stale session at all.** A session
started and abandoned mid-flow sits at whatever `current_flow`/`current_step`
it was last left at all day, at every clock time, until either the same
engineer messages again or B3's sweep runs. This is the normal, by-design
condition the system is in for most of every day once real usage exists, not
a marginal edge case — B3 cannot lean on any implicit TTL as a backstop,
because none exists.

---

## 5. Evidence artifacts — status (updated 2026-08-23, widened same day)

Two of the five remain PENDING — both genuinely require an apply, which this
pass does not do. The other three are attached below (§§7–9), not merely
described.

1. **DONE — §9 below.** Full before/after body diff for
   `apply_morning_flow_turn` (old vs. new SQL), keyed to §2's table rows.
2. **DONE — §8 below, full transcript at `/tmp/dry-run-evidence.txt` (369
   lines, regenerated 2026-08-23 twice same day — first widened from the
   original 268-line capture, then regenerated again against the §10.1
   rework).** Disposable dry-run scaffold output (real `pg_dump`-based
   schema) proving the new SQL parses and executes against a structurally
   accurate Postgres — covers the YES path, both NO-path completions, both
   exhausted-reask defaults, the JSONB transform (including the
   untouched-NULL-row case), the `attendance` CHECK constraint, every grant
   probe, the renamed `q3_reask`/`q4_reask` keys exercised with the session
   context printed after each reask (proving the rename landed on the
   correct step, not just that the code parses), **and, from the §10.1
   rework: the pre/post-migration signature diff (byte-identical, `t`) and
   the `pg_proc` overload count (exactly 1, both before and after) as
   first-class checks.**
3. **DONE, THEN ROLLED BACK — §10.3 below.** Test-db rehearsal ran for real
   (2026-08-23, `/tmp/030-testdb-rehearsal.txt`) — every catalog and
   behavioral check the local dry-run covered, re-run against a real
   `apply_morning_flow_turn` on test-db, all passing. The rehearsal itself
   surfaced two real findings (18 stale-assumption test failures across
   three OTHER migrations' test files, and one apparent test-authoring
   contradiction, neither of them defects in 030's own SQL) and one
   unanticipated operational cost: leaving 030 applied on the ONE shared
   test-db broke CI for every unrelated branch/PR, not just this one.
   Rolled back 2026-08-24 (`docs/reviews/030-rollback.sql`), verified
   byte-identical restoration by direct observation — see §10.3. Migration
   030 itself is not weakened by this: the rehearsal already proved every
   check it needed to prove before the rollback undid it.
4. **DONE — test built and proven capable of catching drift; §7 below.**
   `test/unit/morning-flow-mirror.test.ts` + the shared fixture table
   `test/helpers/morning-mirror-cases.ts` extend
   `test/productivity-reconciliation-mirror.test.ts`'s pattern to morning's
   renumbered flow. Not yet run for real against test-db (needs the apply,
   same as 3 above) — but capability is proven, not asserted: §7 shows the
   identical fixture logic actually catching a deliberately-introduced
   SQL/TS divergence (RED) and passing once reverted (GREEN), against the
   dry-run scaffold.
5. **PENDING — needs a real apply.** GATE 1's live observation itself (§3
   above): the `daily_logs` query output and the
   `MORNING_QUESTIONS[1]`-vs-template-1 string diff, captured post-apply
   with the migration's SHA and an empty `git status --porcelain`, per this
   project's ARTIFACT PROVENANCE rule. Cannot be produced without a real
   webhook-driven turn against a database carrying this migration.

---

## 6. New gaps found during implementation — spec widened (2026-08-23)

§2's step-mapping table was satisfiable exactly as written — no row required
adjusting. But building the migration surfaced three things the table did
not examine at all, because they sit outside what a per-branch table can
show: a cross-cutting return-value problem, a shared-code blast-radius
decision, and a grant statement in an unrelated, older migration file. Each
was resolved during the build, not left for review to discover. All three
are now also documented in `030_morning_flow_attendance.sql`'s own header
and in `lib/whatsapp/flows/morning.ts`'s comments — this section is the
consolidated version for the reviewer, not a duplicate invention.

### 6a. The attendance return field

**The problem.** Three distinct completions now produce the identical
`(outcome: 'advance', current_step: 0)` pair: the YES path's Q4 (equipment)
completion, the NO path's `site_holiday` completion, and the NO path's
`absent` completion. §2's table names which reply belongs to which branch
(`MORNING_COMPLETE_REPLY`, `MORNING_SITE_HOLIDAY_REPLY`,
`MORNING_ABSENT_REPLY`) but never specifies how the caller is supposed to
tell the three apart — `buildMorningReply`'s pre-migration signature took
only `(outcome, currentStep)`, which is not enough information.

**The precedent followed, not invented.** `apply_evening_flow_turn` already
solves the identical class of problem for step 6's data-driven prompt:

```
supabase/migrations/024_evening_flow_q4_q5.sql:284
RETURNS jsonb   -- { outcome, current_flow, current_step, log_date, equipment_echo }

supabase/migrations/024_evening_flow_q4_q5.sql:851
    'equipment_echo', v_equipment_echo
```

`buildEveningReply` (`lib/whatsapp/flows/evening.ts:195,202,205`) takes
`equipmentEcho` as an extra parameter for exactly this reason — the RPC's
`(outcome, currentStep)` pair alone can't tell it what to render. Morning's
fix mirrors this shape precisely, with `attendance` in place of
`equipment_echo`.

**Every changed signature and call site:**

| File:line | Change |
|---|---|
| `supabase/migrations/030_morning_flow_attendance.sql` (RETURN block, near EOF) | `RETURN jsonb_build_object(...)` gains `'attendance', v_attendance` |
| `lib/whatsapp/flows/morning.ts:142` | `buildMorningReply(outcome, currentStep, attendance?)` — new optional third parameter |
| `lib/whatsapp/flows/morning.ts:423-431` | `MorningTurnResult` gains `attendance: 'present' \| 'absent' \| 'site_holiday' \| null` |
| `lib/whatsapp/flows/morning.ts:498,506` | `applyMorningFlowTurn`'s RPC-result cast and return object both carry `attendance` through from the RPC's JSONB response |
| `lib/whatsapp/flows/morning.ts:408-412` | `dispatchMorningFlow` (the pure mirror) computes `attendanceForReply` from its own `dailyLogWrite` and passes it to `buildMorningReply`, so the mirror and the RPC use the same disambiguation mechanism |
| `lib/whatsapp/dispatch.ts:54-60` | `Attempt`'s `'morning'` variant gains `attendance` (evening's variant already carries the analogous `equipmentEcho`) |
| `lib/whatsapp/dispatch.ts:163` | `buildMorningReply(a.outcome, a.currentStep, a.attendance)` |
| `lib/whatsapp/inbound-start.ts:194` | `buildMorningReply(result.outcome, result.currentStep, result.attendance)` |
| `app/api/whatsapp/webhook/route.ts:292` | `buildMorningReply(result.outcome, result.currentStep, result.attendance)` |

`attendance` is optional on `buildMorningReply` and falls back to
`MORNING_COMPLETE_REPLY` when omitted — an un-updated caller fails toward
the ORIGINAL reply, not a broken one. Every real call site in this codebase
has been updated regardless; the fallback is a safety margin, not a
sanctioned way to skip passing it.

### 6b. The parser scope decision

**The problem.** §2 row H specs `morning_manpower`'s stored JSONB shape as
`{total, by_trade:[{trade,count}], raw_text}` — renamed from
`{planned_total, by_trade:[{trade,planned_count}], raw_text}`. The obvious
place to make that rename is the parser that produces the shape,
`parseLabourCount`/`LabourParse` (`lib/whatsapp/flows/parsers/labour.ts`).
That parser is **shared** — evening's Q4a headcount reuses it verbatim
(`lib/whatsapp/flows/evening.ts:476`, `const parse = parseLabourCount(text)`,
then `evening.ts:486` reads `parse.planned_total` directly into
`EVENING_Q4_HEADCOUNT_KEY`). Renaming the parser's own field names would
have forced edits into `evening.ts` — squarely out of scope, since §4 above
(and §30(a)) place evening's restructuring in a separate, later migration.

**The decision.** `parseLabourCount`/`LabourParse` are **unchanged** —
still `{planned_total, by_trade:[{trade,planned_count}], raw_text}`,
exactly as evening depends on. The `total`/`count` reshape happens only at
the two points that actually write `morning_manpower`:

- SQL: `supabase/migrations/030_morning_flow_attendance.sql`'s `v_col =
  'manpower'` branch (`jsonb_build_object('total', p_manpower->'planned_total',
  ...)`), around line 381 of the migration file.
- TS mirror: `lib/whatsapp/flows/morning.ts`'s `reshapeLabourForStorage()`
  helper, called only from the step-3 branch of `dispatchMorningFlow`.

Neither `labour.ts` nor `evening.ts` was touched. Comments recording this
decision were added at three points a future reader might otherwise be
confused by the asymmetry: `labour.ts` is never mentioned, but
`lib/whatsapp/flows/parsers/lexicon.ts:11-13` and `lib/dpr/assemble.ts:548`
both now note explicitly that the parser's own field names survive the
rename.

### 6c. Migration 017's stale grant

**Why this one gets its own entry, not folded into the table.** This was
genuinely invisible to §2's step-mapping table — the table describes
`apply_morning_flow_turn`'s decision logic and daily_logs *writes*; it has
no row for a *grant* statement sitting in an entirely different, much
older migration file. Nothing about implementing §2's rows would have
surfaced this on its own; it was found only by tracing every existing
reference to `morning_manpower_planned` across the repo, including
migration files, which is not something a row-by-row implementation of §2
would do by default.

**The exposure, if missed.** `017_rls_column_bounding.sql` grants
`authenticated` (PM/admin/qs) column-bound `UPDATE` on `daily_logs`,
naming every correctable column explicitly:

```sql
-- 017_rls_column_bounding.sql, original (still live, never edited):
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower_planned, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;
```

Renaming the column without touching this grant would have left
`authenticated` holding an `UPDATE` grant that names a column
(`morning_manpower_planned`) which no longer exists on the table after this
migration runs — at best inert (Postgres does not retroactively validate a
previously-granted column name once it's gone, so this would not itself
error), at worst a silent, permanent loss of PM write access to the
(renamed) column, discovered only when someone tried to correct it and
found `authenticated` could no longer touch `morning_manpower` at all.

**The fix — re-declared in the new migration** (`030_morning_flow_attendance.sql`, STEP 3):

```sql
-- 030_morning_flow_attendance.sql:
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;
```

Only `morning_manpower_planned` → `morning_manpower` changed in that list.
**`attendance` is deliberately NOT added** — PM correction of attendance
depends on the PM edit UI, which §4 above already names as out of this
migration's scope (`correct_daily_log` has zero frontend callers; nothing
surfaces an `absent` day to a PM yet). Adding `attendance` to this grant
now would grant a capability with no UI to exercise it and no decision on
record that it should exist yet — the column-bound grant intentionally
tracks what §4 already decided is and isn't in scope, not what's merely
possible to grant.

Verified directly against the dry-run scaffold, not asserted: §8 below
shows `has_column_privilege('authenticated','daily_logs','morning_manpower',
'UPDATE')` returning `true` and the same probe for `attendance` returning
`false`, post-migration.

---

## 7. Mirror-agreement test — proof it can fail

A green test that has never gone red is not evidence. SQL/TS drift is this
migration's central risk — the exact shape of bug Aravind's own
2026-08-23 correction round caught (the exhausted-reask default direction,
first drafted backwards) — so the test built to catch that class of bug
needed to be shown catching it, not just shown passing.

**What was built.** `test/helpers/morning-mirror-cases.ts` — one shared
fixture table, ten cases, one per distinct branch in §2's step-mapping
table (not exhaustive edge cases; the two dedicated suites,
`test/morning-flow.test.ts` and `test/unit/morning-dispatch.test.ts`,
already exhaust those separately on each side). `test/unit/
morning-flow-mirror.test.ts` runs every case through BOTH
`apply_morning_flow_turn` (SQL, via test-db) and `dispatchMorningFlow` (the
TS mirror), each checked against the case's own `expected` value — exactly
`test/productivity-reconciliation-mirror.test.ts`'s established pattern,
extended to morning. **Not yet runnable against test-db** (migration 030
isn't applied there) — the proof below uses the identical fixture table and
comparison logic, run against the disposable dry-run scaffold instead (a
standalone script, not committed — the committed test file is the
permanent artifact; the script existed only to prove the fixture table
actually discriminates a real bug from a real fix).

**The one-line divergence introduced.** In
`030_morning_flow_attendance.sql`'s Q1 branch, the line that routes a
genuine "yes" (or the exhausted-reask default) to step 2:

```diff
       ELSE
         -- YES, or the exhausted-reask default (DECIDED: YES, not NO).
-        v_session.current_step := 2;
+        v_session.current_step := 5;
```

Chosen deliberately: this is the SAME branch Aravind's own correction round
touched (the exhausted-reask default direction), so the demonstration
exercises this migration's actual, real risk — not a synthetic one. The TS
mirror (`morning.ts`) was left untouched, so this is a genuine SQL-only
divergence from the TS copy of the same decision.

**RED — the divergence, caught:**

```
[FAIL] Q1 yes -> attendance=present, advances to step 2
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=5 attendance=present <-- MISMATCH
   TS:       outcome=advance nextStep=2 attendance=present 
[PASS] Q1 no -> advances to step 5 (holiday follow-up), no write
   expected: outcome=advance nextStep=5 attendance=null
   SQL:      outcome=advance nextStep=5 attendance=null 
   TS:       outcome=advance nextStep=5 attendance=null 
[PASS] Q1 unclassifiable -> reask, step unchanged
   expected: outcome=reask nextStep=1 attendance=null
   SQL:      outcome=reask nextStep=1 attendance=null 
   TS:       outcome=reask nextStep=1 attendance=null 
[FAIL] Q1 unclassifiable, budget exhausted -> DEFAULTS TO YES (DECIDED 2026-08-23)
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=5 attendance=present <-- MISMATCH
   TS:       outcome=advance nextStep=2 attendance=present 
[PASS] Holiday follow-up yes -> attendance=site_holiday, completes
[PASS] Holiday follow-up no -> attendance=absent, completes
[PASS] Holiday follow-up unclassifiable, budget exhausted -> DEFAULTS TO absent (unchanged direction)
[PASS] Q2 (plan, free text) -> advances to step 3
[PASS] Q3 (parsed labour) -> advances to step 4
[PASS] Q4 (parsed equipment) -> completes directly (not step 5)

RESULT: FAIL (at least one case mismatched)
```
Exit code: `1`.

Exactly the two cases that exercise the buggy `ELSE` branch failed (`Q1
yes`, `Q1 unclassifiable, budget exhausted` — both routes reach the same
line); every other case, untouched by the divergence, still passed — the
table isolates the actual defect rather than failing wholesale.

**Reverted** (`v_session.current_step := 2;` restored — `git diff` against
the committed migration file confirmed empty before re-testing, i.e. back to
exactly the committed state, not a different fix).

**GREEN — after revert:**

```
[PASS] Q1 yes -> attendance=present, advances to step 2
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=2 attendance=present 
   TS:       outcome=advance nextStep=2 attendance=present 
[PASS] Q1 no -> advances to step 5 (holiday follow-up), no write
[PASS] Q1 unclassifiable -> reask, step unchanged
[PASS] Q1 unclassifiable, budget exhausted -> DEFAULTS TO YES (DECIDED 2026-08-23)
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=2 attendance=present 
   TS:       outcome=advance nextStep=2 attendance=present 
[PASS] Holiday follow-up yes -> attendance=site_holiday, completes
[PASS] Holiday follow-up no -> attendance=absent, completes
[PASS] Holiday follow-up unclassifiable, budget exhausted -> DEFAULTS TO absent (unchanged direction)
[PASS] Q2 (plan, free text) -> advances to step 3
[PASS] Q3 (parsed labour) -> advances to step 4
[PASS] Q4 (parsed equipment) -> completes directly (not step 5)

RESULT: PASS (all cases agree)
```
Exit code: `0`.

---

## 8. Dry-run scaffold evidence

Full literal transcript: **`/tmp/dry-run-evidence.txt`** (369 lines,
regenerated 2026-08-23 twice same day — first widened to add items 9-10
below, then regenerated again against the §10.1 rework, which is why item 4
below describes an identical-signature check rather than the overload it
originally found — see §10/§10.1 for that history) — every query and its
raw result, in execution order, per this project's ARTIFACT PROVENANCE
convention (query text visible above its result). Captured against a
disposable local PG17 instance (real `pg_dump` schema from the linked
project, `auth`/roles stubbed per CLAUDE.md §7's standing rule), never
test-db or prod. Torn down after capture — nothing persists.

What it contains, in order:
1. **Pre-migration state** — confirms the OLD column
   (`morning_manpower_planned`) and the OLD 12-parameter RPC signature,
   before 030 runs.
2. **Migration 030 applied** to the scaffold.
3. **The JSONB transform, including the untouched-NULL row** —
   `morning_manpower` for the three seeded historical rows shows
   `total`/`count` (not `planned_total`/`planned_count`); the fourth row
   (no morning submission at all, `morning_manpower_planned` genuinely
   `NULL`) is confirmed still `NULL` afterward — the transform's `WHERE
   morning_manpower IS NOT NULL` predicate correctly left it alone.
4. **Post-migration function signature — identity check (rewritten
   2026-08-23 to match the §10.1 rework; this item originally caught the
   overload finding §10 documents — see that section for the full incident).**
   `pg_proc` is queried both before and after migration 030 runs, counting
   how many functions are named `apply_morning_flow_turn` (1, both times —
   captured as `pre_migration_overload_count`/`post_migration_overload_count`)
   and capturing each side's `pg_get_function_identity_arguments` into a
   psql variable so the two can be diffed directly in-database
   (`signatures_are_byte_identical` → `t`). The exact partial named-argument
   call that broke under the FIRST draft (only the original 6 required
   parameters — the shape `test/migration-020.test.ts`'s `APPLY_ARGS` uses)
   is re-run and shown resolving cleanly (`outcome: "start"`), not failing
   with `function ... is not unique`. A grant probe on the (now-only) OID
   immediately follows, confirming `CREATE OR REPLACE` carried the ACL
   through automatically. Full incident + fix narrative: §10/§10.1 below.
5. **The `attendance` CHECK constraint** rejecting an invalid value
   (`'bogus'`) with the real Postgres error text.
6. **Every grant probe**: `anon` denied `EXECUTE` on
   `apply_morning_flow_turn`, `service_role` allowed, `authenticated`
   column-bound correctly (`morning_manpower`/`morning_plan` grantable,
   `attendance` not — the §6c fix, verified live). Repeated here via the
   explicit 12-arg signature string (not `::regproc`), as a second,
   independent check on top of item 4's `::regproc`-based probe.
7. **The YES path**, start through Q4 completion, with the resulting
   `daily_logs` row printed in full.
8. **Both NO-path completions** (`site_holiday`, `absent`), including the
   confirmation that no row is written between Q1's "no" and the holiday
   follow-up resolving.
9. **Both exhausted-reask defaults** — Q1's (now YES) and the holiday
   follow-up's (still `absent`) — each shown reaching the reask state first
   (`q1_reask`/`q5_reask` incremented, visible in the session `context`),
   then resolving on the second unclassifiable answer.
10. **NEW (2026-08-23) — the renamed `q3_reask`/`q4_reask` keys, each
    exercised at the step they actually now belong to.** A single session
    runs Q1→Q2 normally, then hits one unparseable answer at Q3 (workers) —
    the session `context` is printed immediately after, showing `{"q1_reask":
    0, "q3_reask": 1}` and `current_step` still `3` (the reask genuinely
    lands on Q3, not silently on the wrong step). The same session then
    answers past the Q3 budget (advances to step 4, context resets to
    `q3_reask: 0`), hits one unparseable answer at Q4 (equipment) — context
    printed again, showing `{"q1_reask": 0, "q3_reask": 0, "q4_reask": 1}`
    (both renamed keys visible together, `q3_reask` provably untouched by
    Q4's reask), then completes on the second attempt. Closes the gap the
    original capture left: it exercised the two *new* keys (`q1_reask`,
    `q5_reask`) but never the two *renamed* ones.

---

## 9. Before/after body diff — `apply_morning_flow_turn`

**SUPERSEDED LINE NUMBERS, NOT SUPERSEDED CONTENT — read this note before the
table.** This diff and its row index were generated against `030_morning_
flow_attendance.sql`'s FIRST DRAFT (the one with `p_yesno_met`/`p_yesno_ok`
appended — see §10). That draft was reworked 2026-08-23 per §10.1: the
signature reverted to the original 12 parameters, a new helper function
(`quoco_classify_yes_no`) was inserted before `apply_morning_flow_turn`, and
the Q1/step-5 branches now call it instead of reading precomputed
parameters. Every line NUMBER below the row-index table is therefore off by
the length of the inserted helper (STEP 4a — see the current file directly:
`supabase/migrations/030_morning_flow_attendance.sql`'s own `STEP 4a`/`STEP
4b` headers). The BRANCH STRUCTURE and semantics the diff documents (which
row does what, in what order, writing which column) are UNCHANGED by the
§10.1 rework — only the mechanism for obtaining `v_yesno`'s `met`/`ok`
changed (an internal function call now, a parameter read before), which is
not itself a row in this table. Not regenerated line-by-line here (out of
this pass's requested scope, §10.1 already carries the substantive
before/after for what changed); do not treat the line numbers below as
current without checking the live file first.

Old body: `supabase/migrations/022_evening_flow_apply_turn.sql:100-306`
(git `HEAD`, unedited — CLAUDE.md §6 forbids editing a live migration file).
New body (AS OF THE FIRST DRAFT — see note above): `supabase/migrations/
030_morning_flow_attendance.sql:151-440`.

**Row index — jump to a row's new-file location before reading the diff,**
so branches are checked against §2's table rather than re-derived from the
diff alone (LINE NUMBERS ARE STALE — see note above):

| Row | §2 meaning | New file line(s) (decide) | New file line(s) (write) |
|---|---|---|---|
| A | start | 211-224 | — (no write on start) |
| B | start, already active → reask | 221-222 | — |
| C | idle check → already_complete | 225,227 | — |
| D | idle check → idle | 225,228-229 | — |
| E | empty text → reask (any step) | 233-235 | — |
| F1-F4 | Q1 attendance (yes / no / reask / exhausted-default) | 237-263 | 349-359 (`v_col='attendance'`) |
| G | Q2 plan (free text) | 265-270 | 373-380 (`v_col='plan'`) |
| H | Q3 workers by trade (parsed labour) | 272-285 | 381-404 (`v_col='manpower'`) |
| I | Q4 equipment (parsed, completes) | 287-308 | 406-415 (`v_col='equipment'`) |
| J1-J4 | Holiday follow-up (site_holiday / absent / reask / exhausted-default) | 310-333 | 360-372 (`v_col='attendance_complete'`) |
| K | retired — old step-4 free-text execution-plan role | — (no target branch; see diff) | — (`morning_execution_plan` no longer written) |
| L | else catch-all → reask | 335-336 | — |
| M | different flow active → wrong_flow | 339-343 | — |

**Full unified diff:**

```diff

--- /tmp/old-body.sql	2026-08-23 09:25:06
+++ /tmp/new-body.sql	2026-08-23 09:25:06
@@ -5,25 +5,28 @@
   p_project_id    UUID,        -- engineer's single active project (project_members)
   p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
   p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
-  p_manpower      JSONB    DEFAULT NULL,  -- Q2 parse (labour); stored verbatim when step 2 advances
-  p_manpower_ok   BOOLEAN  DEFAULT NULL,  -- Q2 parse acceptable? (a number was found)
-  p_equipment     JSONB    DEFAULT NULL,  -- Q3 parse (equipment); stored verbatim when step 3 advances
-  p_equipment_ok  BOOLEAN  DEFAULT NULL,  -- Q3 parse acceptable? (explicit none, or >=1 item)
+  p_manpower      JSONB    DEFAULT NULL,  -- Q3 parse (labour); reshaped+stored when step 3 advances
+  p_manpower_ok   BOOLEAN  DEFAULT NULL,  -- Q3 parse acceptable? (a number was found)
+  p_equipment     JSONB    DEFAULT NULL,  -- Q4 parse (equipment); stored verbatim when step 4 advances
+  p_equipment_ok  BOOLEAN  DEFAULT NULL,  -- Q4 parse acceptable? (explicit none, or >=1 item)
   p_now           TIMESTAMPTZ DEFAULT now(),
-  p_test_sleep_ms INTEGER     DEFAULT NULL  -- TEST-ONLY: pause after lock to force an interleave. NULL/no-op in prod.
+  p_test_sleep_ms INTEGER     DEFAULT NULL,  -- TEST-ONLY: pause after lock to force an interleave. NULL/no-op in prod.
+  p_yesno_met     BOOLEAN  DEFAULT NULL,  -- classifyYesNo(p_message).met -- shared by Q1 attendance (step 1) and the holiday follow-up (step 5). APPENDED (see file header on why).
+  p_yesno_ok      BOOLEAN  DEFAULT NULL   -- classifyYesNo(p_message).ok
 )
-RETURNS jsonb   -- { outcome, current_flow, current_step, log_date }
+RETURNS jsonb   -- { outcome, current_flow, current_step, log_date, attendance }
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
 AS $fn$
 DECLARE
-  v_session  whatsapp_sessions;
-  v_text     TEXT;
-  v_log_date DATE;
-  v_outcome  TEXT;
-  v_col      TEXT := NULL;      -- which daily_logs column this turn writes (NULL = no write)
-  v_reask    INTEGER;           -- current per-step reask counter (parsed steps)
+  v_session    whatsapp_sessions;
+  v_text       TEXT;
+  v_log_date   DATE;
+  v_outcome    TEXT;
+  v_col        TEXT := NULL;      -- which daily_logs write this turn performs (NULL = no write)
+  v_reask      INTEGER;           -- current per-step reask counter (parsed steps)
+  v_attendance TEXT := NULL;      -- resolved attendance value this turn writes, if any -- also echoed in the return value (see file header)
 BEGIN
   -- log_date in IST, same Asia/Kolkata discipline as quoco_same_ist_day.
   v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;
@@ -43,7 +46,7 @@
   END IF;
 
   -- (2) BOT-07 next-day reset. A previous-IST-day session (mid-flow OR completed)
-  -- is wiped to idle: context := '{}' also drops any q2_reask/q3_reask counters.
+  -- is wiped to idle: context := '{}' also drops every parsed-step reask counter.
   IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
     v_session.current_flow  := NULL;
     v_session.current_step  := 0;
@@ -59,15 +62,11 @@
     IF v_session.current_flow IS NULL THEN
       v_session.current_flow := 'morning';
       v_session.current_step := 1;
-      -- CONTEXT DISCIPLINE, site 1 of 4 (see file header) -- 022's THIRD
-      -- change, added after the reviewer's second pass. 018 wiped context to
-      -- '{}' here; harmless then (morning was the only flow), but this is the
-      -- FIRST write of a restart, and a restart on an already-completed day
-      -- would otherwise destroy evening_submitted before Q4 ever runs -- the
-      -- exact gap T-022-13 (reverse-order) caught and a completion-only fix
-      -- could not. Strip only morning's own counters; see RESTART SEMANTICS
-      -- in the file header for the behaviour change this implies.
-      v_session.context      := v_session.context - 'q2_reask' - 'q3_reask';
+      -- CONTEXT DISCIPLINE (022's site 1, extended by this migration): strip
+      -- EVERY parsed-step reask key morning now has -- q1/q3/q4/q5, not just
+      -- the original two -- so a stray counter from before a same-day restart
+      -- never leaks into a fresh start.
+      v_session.context      := v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask';
       v_outcome := 'start';
     ELSE
       v_outcome := 'reask';
@@ -86,68 +85,143 @@
       v_outcome := 'reask';
 
     ELSIF v_session.current_step = 1 THEN
-      -- Q1 (free text) -> morning_plan, advance to Q2.
-      v_session.current_step := 2;
-      v_outcome := 'advance';
-      v_col     := 'plan';
-
-    ELSIF v_session.current_step = 2 THEN
-      -- Q2 (parsed labour). Accept on a number; else reask once then accept raw.
-      v_reask := COALESCE((v_session.context->>'q2_reask')::int, 0);
-      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
-        v_session.current_step := 3;
-        v_session.context := v_session.context || jsonb_build_object('q2_reask', 0);
+      -- Q1 Attendance (classifyYesNo, computed in TS, passed in as
+      -- p_yesno_met/p_yesno_ok). One reask on an unclassifiable answer.
+      -- Exhausted-reask default is YES -- DECIDED 2026-08-23 (review package
+      -- §2): default-YES-when-actually-absent leaves three questions
+      -- unanswered, visible and B3-recoverable; default-NO-when-actually-
+      -- present silently drops all three from an engineer who was on site
+      -- and answering. The opposite of evening Q2's own default direction,
+      -- because on THIS question NO is the shorter path, not the longer one.
+      v_reask := COALESCE((v_session.context->>'q1_reask')::int, 0);
+      IF NOT COALESCE(p_yesno_ok, false) AND v_reask < 1 THEN
+        v_session.context := v_session.context || jsonb_build_object('q1_reask', v_reask + 1);
+        v_outcome := 'reask';   -- step unchanged (1)
+      ELSIF COALESCE(p_yesno_ok, false) AND NOT p_yesno_met THEN
+        -- Genuinely parsed NO -> holiday follow-up (step 5). No daily_logs
+        -- write yet -- attendance isn't known until the follow-up resolves.
+        v_session.current_step := 5;
+        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
         v_outcome := 'advance';
-        v_col     := 'manpower';
       ELSE
-        v_session.context := v_session.context || jsonb_build_object('q2_reask', v_reask + 1);
-        v_outcome := 'reask';   -- step unchanged (2)
+        -- YES, or the exhausted-reask default (DECIDED: YES, not NO).
+        v_session.current_step := 2;
+        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
+        v_attendance := 'present';
+        v_col        := 'attendance';
+        v_outcome    := 'advance';
       END IF;
 
+    ELSIF v_session.current_step = 2 THEN
+      -- Q2 (free text) -> morning_plan, advance to Q3. (Old step 1's logic,
+      -- moved here verbatim -- free text needs no reask handling.)
+      v_session.current_step := 3;
+      v_outcome := 'advance';
+      v_col     := 'plan';
+
     ELSIF v_session.current_step = 3 THEN
-      -- Q3 (parsed equipment). Accept on none/known item; else reask once.
+      -- Q3 (parsed labour, workers by trade). Accept on a number; else reask
+      -- once then accept raw. Reask key renamed q2_reask -> q3_reask (now
+      -- attached to the step this logic actually lives at).
       v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
-      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
+      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
         v_session.current_step := 4;
         v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
         v_outcome := 'advance';
-        v_col     := 'equipment';
+        v_col     := 'manpower';
       ELSE
         v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
         v_outcome := 'reask';   -- step unchanged (3)
       END IF;
 
     ELSIF v_session.current_step = 4 THEN
-      -- Q4 (free text) -> execution plan + submitted_at, COMPLETE.
-      -- CONTEXT DISCIPLINE, site 2 of 4 (see file header) -- reviewer B2.
-      -- 018's bare replace was safe only while morning was the only flow;
-      -- this merges instead, mirroring evening's own completion exactly.
-      v_session.current_flow := NULL;
-      v_session.current_step := 0;
-      v_session.context      := (v_session.context - 'q2_reask' - 'q3_reask')
-                                || jsonb_build_object('morning_submitted', true);
-      v_outcome := 'advance';
-      v_col     := 'execution';
+      -- Q4 (parsed equipment). Accept on none/known item; else reask once.
+      -- Equipment is now the LAST question -- completes the flow directly
+      -- (old step 4's free-text execution-plan role is retired; that column
+      -- stops being written, per §28(p)/review package row K -- it stays in
+      -- the table with its historical data, not dropped). Reask key renamed
+      -- q3_reask -> q4_reask.
+      v_reask := COALESCE((v_session.context->>'q4_reask')::int, 0);
+      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
+        -- CONTEXT DISCIPLINE (022's site 2, extended): merge, never replace
+        -- -- a bare replace would wipe evening_submitted if evening ran
+        -- earlier the same day (T-022-13's own reverse-order regression).
+        v_session.current_flow := NULL;
+        v_session.current_step := 0;
+        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
+                                    || jsonb_build_object('morning_submitted', true);
+        v_outcome := 'advance';
+        v_col     := 'equipment';
+      ELSE
+        v_session.context := v_session.context || jsonb_build_object('q4_reask', v_reask + 1);
+        v_outcome := 'reask';   -- step unchanged (4)
+      END IF;
 
+    ELSIF v_session.current_step = 5 THEN
+      -- Holiday follow-up (classifyYesNo again -- same p_yesno_met/p_yesno_ok
+      -- params, this question's own reask key q5_reask). Exhausted-reask
+      -- default stays `absent` (unchanged from the exhausted-attendance
+      -- default reasoning above -- `absent` keeps the evening trigger and PM
+      -- handoff alive, `site_holiday` would silently cancel both).
+      v_reask := COALESCE((v_session.context->>'q5_reask')::int, 0);
+      IF NOT COALESCE(p_yesno_ok, false) AND v_reask < 1 THEN
+        v_session.context := v_session.context || jsonb_build_object('q5_reask', v_reask + 1);
+        v_outcome := 'reask';   -- step unchanged (5)
+      ELSE
+        IF COALESCE(p_yesno_ok, false) AND p_yesno_met THEN
+          v_attendance := 'site_holiday';
+        ELSE
+          -- NO, or the exhausted-reask default.
+          v_attendance := 'absent';
+        END IF;
+        v_session.current_flow := NULL;
+        v_session.current_step := 0;
+        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
+                                    || jsonb_build_object('morning_submitted', true);
+        v_col     := 'attendance_complete';
+        v_outcome := 'advance';
+      END IF;
+
     ELSE
       v_outcome := 'reask';
     END IF;
 
   ELSE
     -- A DIFFERENT flow is active (evening). Report it as its OWN outcome so the
-    -- webhook can retry against the correct RPC. Returning 'idle' here would make
-    -- a mis-routed turn indistinguishable from a genuine no-flow inbound, and the
-    -- engineer's answer would be silently swallowed (the SID is already consumed).
-    -- The wrong_flow ELSE-branch change -- see WHY 'wrong_flow' EXISTS in the
-    -- file header (a separate kind of change from CONTEXT DISCIPLINE, above).
+    -- webhook can retry against the correct RPC (unchanged from 022 -- see
+    -- that migration's own header for WHY 'wrong_flow' exists).
     v_outcome := 'wrong_flow';
   END IF;
 
-  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a column
-  -- was resolved above. UNIQUE(project_id, engineer_id, log_date) backs the upsert.
-  IF v_col = 'plan' THEN
-    -- Q1: first answer of the day materialises the row.
+  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a
+  -- write was resolved above. UNIQUE(project_id, engineer_id, log_date)
+  -- backs every upsert.
+  IF v_col = 'attendance' THEN
+    -- Step 1 YES (or exhausted-reask default): 'present'. Materialises the
+    -- row (replaces old step-1's row-materialising role) -- flow continues,
+    -- no submission stamp yet.
     INSERT INTO daily_logs AS d
+      (tenant_id, project_id, engineer_id, log_date, attendance)
+    VALUES
+      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance)
+    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
+      SET attendance = EXCLUDED.attendance;
+
+  ELSIF v_col = 'attendance_complete' THEN
+    -- Step 5 resolves the NO branch: 'site_holiday' or 'absent', completes
+    -- the flow. is_holiday mirrors 'site_holiday' per §30(c) so existing
+    -- readers of is_holiday keep working unchanged.
+    INSERT INTO daily_logs AS d
+      (tenant_id, project_id, engineer_id, log_date, attendance, is_holiday, morning_submitted_at)
+    VALUES
+      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, (v_attendance = 'site_holiday'), p_now)
+    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
+      SET attendance           = EXCLUDED.attendance,
+          is_holiday           = EXCLUDED.is_holiday,
+          morning_submitted_at = EXCLUDED.morning_submitted_at;
+
+  ELSIF v_col = 'plan' THEN
+    INSERT INTO daily_logs AS d
       (tenant_id, project_id, engineer_id, log_date, morning_plan)
     VALUES
       (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
@@ -155,32 +229,40 @@
       SET morning_plan = EXCLUDED.morning_plan;
 
   ELSIF v_col = 'manpower' THEN
-    -- Q2: store the labour parse verbatim (raw text embedded inside p_manpower).
+    -- morning_manpower stores the RESHAPED parse (total/count) -- NOT
+    -- parseLabourCount's own planned_total/planned_count field names. See
+    -- this file's header for why the rename stops here and doesn't touch
+    -- the shared parser (evening's Q4a headcount depends on it unchanged).
     INSERT INTO daily_logs AS d
-      (tenant_id, project_id, engineer_id, log_date, morning_manpower_planned)
+      (tenant_id, project_id, engineer_id, log_date, morning_manpower)
     VALUES
-      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_manpower)
+      (p_tenant_id, p_project_id, p_user_id, v_log_date,
+       jsonb_build_object(
+         'total', p_manpower->'planned_total',
+         'by_trade', (
+           SELECT COALESCE(
+                    jsonb_agg(
+                      jsonb_build_object('trade', t->>'trade', 'count', (t->>'planned_count')::int)
+                    ),
+                    '[]'::jsonb
+                  )
+           FROM jsonb_array_elements(COALESCE(p_manpower->'by_trade', '[]'::jsonb)) AS t
+         ),
+         'raw_text', p_manpower->'raw_text'
+       ))
     ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
-      SET morning_manpower_planned = EXCLUDED.morning_manpower_planned;
+      SET morning_manpower = EXCLUDED.morning_manpower;
 
   ELSIF v_col = 'equipment' THEN
-    -- Q3: store the equipment parse verbatim (none -> {items:[],none:true,...}).
+    -- Q4: store the equipment parse verbatim (none -> {items:[],none:true,...})
+    -- AND stamp submission -- equipment now completes the flow.
     INSERT INTO daily_logs AS d
-      (tenant_id, project_id, engineer_id, log_date, morning_equipment)
+      (tenant_id, project_id, engineer_id, log_date, morning_equipment, morning_submitted_at)
     VALUES
-      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment)
+      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment, p_now)
     ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
-      SET morning_equipment = EXCLUDED.morning_equipment;
-
-  ELSIF v_col = 'execution' THEN
-    -- Q4: update the same row + stamp submission.
-    INSERT INTO daily_logs AS d
-      (tenant_id, project_id, engineer_id, log_date, morning_execution_plan, morning_submitted_at)
-    VALUES
-      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
-    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
-      SET morning_execution_plan = EXCLUDED.morning_execution_plan,
-          morning_submitted_at   = EXCLUDED.morning_submitted_at;
+      SET morning_equipment    = EXCLUDED.morning_equipment,
+          morning_submitted_at = EXCLUDED.morning_submitted_at;
   END IF;
 
   -- (4b) SESSION WRITE -- ALWAYS. Refreshes TTL + updated_at and persists the
@@ -201,7 +283,8 @@
     'outcome',      v_outcome,
     'current_flow', v_session.current_flow,
     'current_step', v_session.current_step,
-    'log_date',     v_log_date
+    'log_date',     v_log_date,
+    'attendance',   v_attendance
   );
 END;
 $fn$;
```

---

## 10. FINDING (RESOLVED) — `CREATE OR REPLACE` with appended parameters
did not replace `apply_morning_flow_turn`; it overloaded it
(found 2026-08-23, fixed same day)

**Status: RESOLVED, 2026-08-23 — see §10.1 below for the fix, the
verification that it worked, and why the finding is kept in full rather
than deleted now that it's fixed.** Everything below this line, up to
§10.1, is the finding AS FOUND — unedited, because it is the most valuable
thing this evidence pass produced and a "we caught this, then fixed it and
moved on" summary would erase exactly the detail a future author needs to
avoid the same mistake with some OTHER function's signature.

**Found while completing item 2 of this pass's requested widening** (print
the post-migration function signature, state whether it changed). The
honest answer to "did it change" turned out to be more than a yes/no —
pinned evidence below.

**The mechanism.** `030_morning_flow_attendance.sql`'s STEP 4 is `CREATE OR
REPLACE FUNCTION apply_morning_flow_turn(...)` with `p_yesno_met` and
`p_yesno_ok` appended after `p_test_sleep_ms` (the file's own header
explains why they're appended rather than inserted mid-list — see that
header, "WHY p_yesno_met/p_yesno_ok ARE APPENDED"). That header's
justification is: *"`CREATE OR REPLACE FUNCTION` only allows adding NEW
trailing DEFAULT-valued parameters -- not inserting them mid-list -- without
Postgres treating it as a different function."* **That premise is false.**
A function's identity in Postgres is its name **plus its full parameter
type list** — appending parameters, even trailing ones with `DEFAULT`
values, changes that type list, which makes `CREATE OR REPLACE` create a
**new, additional, separately-callable function** rather than replacing the
old one. Confirmed directly against a real Postgres 17 instance, not
inferred from documentation:

```
--- apply_morning_flow_turn: EVERY function named this, post-migration ---
  oid  |                                                            args
-------+-----------------------------------------------------------------
 20707 | p_phone_number text, ..., p_test_sleep_ms integer
 21513 | p_phone_number text, ..., p_test_sleep_ms integer, p_yesno_met boolean, p_yesno_ok boolean
(2 rows)
```

Both rows are real, live, independently-callable functions after 030 runs.
The OLD body (022's logic — step 1 is still free-text → `morning_plan`, no
attendance branch at all) was never removed.

**Why this is not inert.**
1. **The stale body is still `service_role`-executable.** 030's own STEP 5
   `REVOKE`/`GRANT` block names the NEW 14-arg signature explicitly — it
   never touches the OLD 12-arg signature's grants, so whatever that
   signature was grantable to before this migration remains grantable to it
   after. Probed live, post-migration:
   ```
    anon_can_execute_OLD_body | authenticated_can_execute_OLD_body | service_role_can_execute_OLD_body
   ---------------------------+-------------------------------------+------------------------------------
    f                         | f                                   | t
   ```
   Not a newly-opened public hole (`anon`/`authenticated` are still denied,
   matching this project's own migration-020 hardening) — but `service_role`
   can still invoke a function that writes `morning_plan` at step 1 as if
   this migration never shipped, against the **current**, post-030 database
   and its renumbered step space. A service-role caller that reaches this
   overload by accident (see point 2) gets 022-era behavior silently.
2. **A partial named-argument call is now genuinely ambiguous**, not merely
   stale-routed. Any caller passing fewer than all 14 named parameters, where
   the omitted set is satisfied by *both* overloads' defaults, no longer
   resolves — Postgres reports "not unique" instead of picking either body:
   ```sql
   SELECT apply_morning_flow_turn(
     p_phone_number => '+19995559999', p_tenant_id => '<uuid>',
     p_user_id => '<uuid>', p_project_id => '<uuid>',
     p_message => 'hello old caller', p_start_flow => true
   );
   -- ERROR:  function apply_morning_flow_turn(...) is not unique
   -- HINT:  Could not choose a best candidate function.
   ```
   `test/migration-020.test.ts`'s `APPLY_ARGS` (`p_phone_number`,
   `p_tenant_id`, `p_user_id`, `p_project_id`, `p_message`, `p_start_flow` —
   six keys, no `p_yesno_met`/`p_yesno_ok`) is **exactly this shape**. Those
   tests assert `error?.code === '42501'` (ACL denial) for `anon`/
   `authenticated` — after this migration, against a real database, that
   call instead fails ambiguity resolution before ACL is ever checked. The
   test would no longer be testing what it claims to test, and would need
   its own investigation to know whether it still fails for the *right*
   reason.
3. **Every real production/test-helper caller is unaffected** —
   `lib/whatsapp/flows/morning.ts:483-484` and `test/helpers/db.ts:305-306`
   both always pass `p_yesno_met`/`p_yesno_ok` by name alongside the full
   original parameter set, so they resolve unambiguously to the new 14-arg
   overload. This is a landmine for any *partial* or future caller, not a
   currently-firing production bug — which is exactly the "caught in a file
   nobody has run yet" shape this project's own external-review-gate entry
   (migration 027) already established as the cheapest place to catch a
   defect like this.

**Recommended fix, AS ORIGINALLY WRITTEN (superseded — kept for the record,
see §10.1 for what was actually decided and why it's a different, better
fix, not this one).** Per this pass's original scope (record findings,
regenerate evidence; migration-file changes flagged as a separate decision),
`030_morning_flow_attendance.sql` itself was initially left untouched, with
this proposed shape offered for whoever made the call:
```sql
DROP FUNCTION IF EXISTS public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
);
```
placed immediately before STEP 4's `CREATE OR REPLACE`. This is **not** the
DROP+CREATE this project's migration-020 incident forbade for this exact
function — that prohibition was about DROP+CREATE silently reverting to
default (public) grants; STEP 5 of 030 already re-declares this function's
full grant set explicitly and unconditionally (`REVOKE ... FROM PUBLIC,
anon, authenticated; GRANT ... TO service_role;`), so nothing here depends
on `CREATE OR REPLACE` preserving an ACL implicitly. Dropping the old
signature first would leave exactly one `apply_morning_flow_turn` in the
catalog, matching what this migration's own header already believes is
true. **Aravind's actual decision (§10.1) does not use this fix** — it goes
one step further and removes the SIGNATURE CHANGE itself, so there is no
old overload to drop in the first place. This DROP FUNCTION shape remains a
correct, safe fix for the general case (a genuine signature change that
must ship); it just wasn't the right call for THIS specific change, where
the parameters could be avoided entirely.

---

## 10.1 THE FIX ACTUALLY APPLIED — Option 1, byte-identical signature,
classification moved inside the RPC (Aravind's decision, 2026-08-23)

**Decision.** Not the DROP FUNCTION fix proposed above. Instead: keep
`apply_morning_flow_turn`'s signature **byte-identical** to the live
pre-migration one — remove `p_yesno_met`/`p_yesno_ok` entirely — and
classify the Q1/holiday-follow-up yes/no answer **inside** the function via
a new helper, `quoco_classify_yes_no(text)`, which ports `classifyYesNo`'s
exact word lists (`lib/whatsapp/flows/parsers/lexicon.ts`) into PL/pgSQL.

**Rationale, in Aravind's own words, recorded verbatim because it's the
part worth remembering:** *"CREATE OR REPLACE then genuinely replaces, so
no second overload is created, no grants are re-declared by hand (avoiding
migration 020's mechanism), and no call site changes. The precomputed-parse
pattern exists to avoid race conditions on unlocked reads — a yes/no
classification has no read to race against, so the reason for that pattern
does not apply here."* That last sentence is the part that generalises
beyond this one fix: the precomputed-parse pattern (`p_manpower`/
`p_manpower_ok`, `p_equipment`/`p_equipment_ok` — still precomputed in TS,
UNCHANGED by this fix) exists for a specific reason — avoiding a stale read
racing the locked transaction — and that reason genuinely doesn't apply to
classifying the CURRENT turn's own message text. Applying the pattern to
yes/no in the first draft was over-generalising a pattern past the
condition that justifies it.

**What changed, concretely:**
- `030_morning_flow_attendance.sql`: `apply_morning_flow_turn`'s signature
  reverted to the original 12 parameters (no `p_yesno_met`/`p_yesno_ok`).
  New helper `quoco_classify_yes_no(text) RETURNS jsonb` added (STEP 4a,
  plain SQL logic, not `SECURITY DEFINER` — same precedent as
  `quoco_same_ist_day`, no explicit grant needed). Called inline at step 1
  and step 5. STEP 5's grant re-assertion reverted to the original 12-arg
  signature string.
- `lib/whatsapp/flows/morning.ts`: the `classifyYesNo`/`p_yesno_met`/
  `p_yesno_ok` block removed from `applyMorningFlowTurn`'s RPC call (the
  import and the two internal `dispatchMorningFlow` call sites, lines 328
  and 381, are UNCHANGED — the pure TS mirror always classified locally for
  its own purposes, independent of what the RPC call needed).
- `test/helpers/db.ts`: the equivalent block removed from its
  `applyMorningFlowTurn` test wrapper. The comment documenting the RPC's
  parameter list updated to match (12 params, not 14).
- `tsc --noEmit`: clean. `node scripts/lint-migrations.mjs`: clean (the new
  helper needs no grant declarations; `apply_morning_flow_turn` still has
  both, matching the no-orphan-security-definer rule).

**Verification — re-run live against a fresh disposable scaffold, not
assumed from the fix's own logic:**
```
--- apply_morning_flow_turn: how many functions carry this name, pre-migration (expect 1) ---
 pre_migration_overload_count
------------------------------
                            1

--- apply_morning_flow_turn: how many functions carry this name, post-migration (expect exactly 1) ---
 post_migration_overload_count
-------------------------------
                             1

--- SIGNATURE DIFF: pre-migration vs post-migration, byte-for-byte (expect t) ---
 signatures_are_byte_identical
-------------------------------
 t

--- consequence check: the exact partial named-argument call that broke under the first draft now resolves unambiguously again ---
 partial_call_outcome
----------------------
 start
```
The partial call is the SAME six-key shape as `test/migration-020.test.ts`'s
`APPLY_ARGS` that broke under the first draft (§10 above, point 2) — it now
returns a real outcome instead of `function ... is not unique`. Full
transcript: `/tmp/dry-run-evidence.txt`, regenerated 2026-08-23 (369 lines).

**Mirror-agreement RED/GREEN re-run — the earlier proof (§7) no longer
applies, since it exercised the abandoned two-parameter shape.** Re-run as a
standalone script (same pattern as §7: not a committed test, exercises the
identical `MORNING_MIRROR_CASES` fixture against the reworked SQL and the
unchanged TS mirror) against the disposable scaffold:

GREEN (unmodified, reworked migration):
```
[PASS] Q1 yes -> attendance=present, advances to step 2
[PASS] Q1 no -> advances to step 5 (holiday follow-up), no write
[PASS] Q1 unclassifiable -> reask, step unchanged
[PASS] Q1 unclassifiable, budget exhausted -> DEFAULTS TO YES (DECIDED 2026-08-23)
[PASS] Holiday follow-up yes -> attendance=site_holiday, completes
[PASS] Holiday follow-up no -> attendance=absent, completes
[PASS] Holiday follow-up unclassifiable, budget exhausted -> DEFAULTS TO absent (unchanged direction)
[PASS] Q2 (plan, free text) -> advances to step 3
[PASS] Q3 (parsed labour) -> advances to step 4
[PASS] Q4 (parsed equipment) -> completes directly (not step 5)

RESULT: PASS (all cases agree)
```
Exit code `0`.

Same deliberate one-line divergence as §7 (the `ELSE` branch that routes a
genuine "yes"/exhausted-default to step 2 — Aravind's own correction round
touched this exact branch, so it's still this migration's real risk, not a
synthetic one), reintroduced (`v_session.current_step := 2;` →
`v_session.current_step := 5;`), fresh scaffold, RED:
```
[FAIL] Q1 yes -> attendance=present, advances to step 2
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=5 attendance=present <-- MISMATCH
   TS:       outcome=advance nextStep=2 attendance=present
[PASS] Q1 no -> advances to step 5 (holiday follow-up), no write
[PASS] Q1 unclassifiable -> reask, step unchanged
[FAIL] Q1 unclassifiable, budget exhausted -> DEFAULTS TO YES (DECIDED 2026-08-23)
   expected: outcome=advance nextStep=2 attendance=present
   SQL:      outcome=advance nextStep=5 attendance=present <-- MISMATCH
   TS:       outcome=advance nextStep=2 attendance=present
[PASS] Holiday follow-up yes -> attendance=site_holiday, completes
[PASS] Holiday follow-up no -> attendance=absent, completes
[PASS] Holiday follow-up unclassifiable, budget exhausted -> DEFAULTS TO absent (unchanged direction)
[PASS] Q2 (plan, free text) -> advances to step 3
[PASS] Q3 (parsed labour) -> advances to step 4
[PASS] Q4 (parsed equipment) -> completes directly (not step 5)

RESULT: FAIL (at least one case mismatched)
```
Exit code `1`. Exactly the two cases exercising the buggy `ELSE` branch
failed — same isolation property as §7. Reverted (`git diff`-equivalent
confirmed by rebuilding a fresh scaffold from the reverted file and
re-running — GREEN again, identical to the run above), re-verified against
a fresh scaffold, not just the same live one the bug was injected into.

**Why the finding above (§10) is kept in full, not replaced by this
section.** The mistake itself — believing appended trailing DEFAULT
parameters don't change a function's identity — is a general Postgres fact,
not specific to this migration or this fix. The NEXT migration that needs
to add a parameter to an existing `SECURITY DEFINER` function can make the
identical mistake regardless of how THIS one was resolved. §10's mechanism,
evidence, and blast-radius analysis are what make that mistake
recognisable next time; §10.1 only records which of the (at least two) valid
fixes got chosen here and why.

---

## 10.2 FINDING — §10.1's fix trades an overload hazard for a duplicate-logic
hazard; the yes/no corpus test is what contains the new one (found and
contained 2026-08-23)

**The trade, stated explicitly, not left implicit.** §10.1's fix removed the
overload risk by moving Q1/holiday-follow-up yes/no classification INSIDE
`apply_morning_flow_turn`, via a new function, `quoco_classify_yes_no`, that
ports `classifyYesNo`'s (`lib/whatsapp/flows/parsers/lexicon.ts`) word lists
into PL/pgSQL. That means TWO independently-maintained implementations of
the identical classification now exist in this product simultaneously and
must agree FOREVER, not just at the moment `quoco_classify_yes_no` was
written:
- `classifyYesNo` (TypeScript) — still used directly by evening Q2, via a
  precomputed parse passed into `apply_evening_flow_turn` as
  `p_parse['2']`/`p_parse_ok['2']` (`test/helpers/db.ts:351,364,371`,
  `lib/whatsapp/flows/evening.ts:745,752,759`) — UNCHANGED by this migration,
  and still calls the TS lexicon directly, not the new SQL helper.
- `quoco_classify_yes_no` (PL/pgSQL, new) — used only by
  `apply_morning_flow_turn`'s Q1 and holiday-follow-up branches.

**Why this is the SAME class of defect the migration itself closes, one
layer down.** `morning.ts:188`'s TS/SQL MIRROR DIVERGENCE (opened
2026-08-19, closed by THIS migration per §2's TypeScript-mirror table, row
A) was exactly this shape: two hand-maintained copies of one decision,
free to drift silently because nothing forced them to agree. §10.1's fix,
by design, recreates that same shape at the vocabulary level instead of the
control-flow level — a word added to (or removed from) one lexicon and not
the other produces a WRONG `attendance` value, not an error, not a crash,
nothing that surfaces on its own. `test/unit/morning-flow-mirror.test.ts`
(§7) only catches divergence on inputs it happens to exercise — the ten
cases in `test/helpers/morning-mirror-cases.ts` all use `"yes"`/`"no"`,
never a vernacular form — so it would NOT have caught a lexicon drift on,
say, `"aama"` or `"illa"`.

**Containment: a shared corpus, checked against both implementations.**
`test/helpers/yesno-corpus.ts` (new) — 60 cases, one per word in
`YES_WORDS`/`NO_WORDS`/`NONE_WORDS` as of 2026-08-23, plus compound answers
(`"yes fully done"`, `"no, half only"` — `classifyYesNo`'s own documented
token-wise/negative-wins behaviour), case/whitespace normalisation, and
unclassifiable inputs. `test/unit/yesno-mirror.test.ts` (new) runs every
case through BOTH `classifyYesNo` (direct call, no DB) and
`quoco_classify_yes_no` (via `db.rpc`, test-db), each asserted against the
SAME `expected` value — identical structure to §7's own mirror test, and to
this project's established `test/productivity-reconciliation-mirror.test.ts`
pattern. Not yet runnable against test-db (migration 030 isn't applied
there) — same status as §7's committed test.

**TRANSLITERATED TAMIL COVERAGE — named as a finding in its own right, not
buried inside the corpus.** The lexicon recognises exactly SIX vernacular
words: `aama`/`ama`/`aam` (yes) and `illa`/`ille`/`illai`/`illae`/
`kidaiyathu`/`kedaiyathu` (no) — all six ported to `quoco_classify_yes_no`
and all six covered in the corpus. `lexicon.ts`'s own header states this is
a "Chennai-region beta: answers are terse, transliterated Tamil common" —
against that stated user base, a six-word yes/no vocabulary is thin. This
is a PRE-EXISTING gap in `classifyYesNo` itself, not something this
migration introduced or is in scope to fix — flagged here because building
the corpus is what made the gap visible in one place, and CLAUDE.md's own
"document submitted for review is audited for asserted-but-nonexistent
artifacts" standing rule cuts both ways: an omission a reviewer would
reasonably expect to see named should be named, not left for them to
discover.

**Proof the corpus test can fail** — same "a green test that has never gone
red is not evidence" standard §7 already applies to the decision-logic
mirror. `'surely'` was added to `YES_WORDS` (`lexicon.ts`, TS side only,
simulating a real future mistake: new vocabulary added where a human
naturally adds it, forgotten on the SQL side) plus one matching corpus
case; `quoco_classify_yes_no` was left untouched. Full transcript:
`/tmp/yesno-corpus-proof.txt`.

RED (one case, `surely`, isolated — the other 59 unaffected):
```
[FAIL] "surely"
   expected: met=true ok=true
   SQL:      met=false ok=false <-- MISMATCH
   TS:       met=true ok=true
```
`RESULT: FAIL (at least one case mismatched)`, exit code `1`.

Reverted (`'surely'` removed from `YES_WORDS` — `git status` confirms
`lexicon.ts` returns to exactly its committed state; the corpus's temporary
case removed too). GREEN, all 60 cases:
```
RESULT: PASS (all 60 cases agree)
```
Exit code `0`.

**Why this trade was still the right call, not a reason to revisit §10.1.**
An overload hazard is invisible until someone calls the RPC with the wrong
partial argument set — as §10 showed, that can be a committed test file
nobody thinks to re-examine. A duplicate-logic hazard is visible,
enumerable, and finite: the vocabulary either lexicon can recognise is a
closed, small, human-readable list, and the corpus test makes "did both
sides stay in sync" a single command instead of a thing someone has to
remember to check. Finite and testable beats invisible and untestable, even
though "testable" here means a NEW test must exist and stay maintained —
§10.1's fix is not free, and this section is where that cost is paid down
into something contained rather than left as an unstated assumption.

**This duplication is TEMPORARY BY DESIGN, not a permanent fixture.**
`design-decisions-beta-feedback.md` §31 (DECIDED IN PRINCIPLE, NOT
SCHEDULED) proposes a stable-signature (JSONB payload) refactor for both
`apply_morning_flow_turn` and `apply_evening_flow_turn`. Under that shape,
Q1/holiday-follow-up classification could move BACK to a single TypeScript
implementation, passed into the RPC as a precomputed field inside
`p_input` — exactly the pattern `p_manpower`/`p_equipment` already use, and
the pattern evening's Q2 already uses for this identical classification.
§10.1's SQL-side duplication exists only because §31 is not yet scheduled;
once it ships, `quoco_classify_yes_no` and the corpus test that guards it
both become removable, and classification returns to living in exactly one
place. Recorded here so that connection isn't lost: §31 is not just a
general maintainability improvement, it is specifically the fix that
retires §10.2's own hazard.

---

## 10.3 TEST-DB REHEARSAL — DONE, then rolled back (2026-08-23 / 2026-08-24)

**The rehearsal (2026-08-23), full transcript `/tmp/030-testdb-rehearsal.txt`.**
Migration 030 applied for real to test-db (`exfccwlrhoutkgrlikod`). Every
check the local dry-run scaffold covered was re-run for real: signature
diff pre/post (byte-identical), `pg_proc` overload count (exactly 1,
before and after), the JSONB transform including the untouched NULL row,
the CHECK constraint rejecting an invalid value, every grant probe, the
YES path, both NO-path completions, both exhausted-reask defaults, and
both renamed reask keys — all passed against the real RPC, not a scaffold.
`test/unit/morning-flow-mirror.test.ts` and `test/unit/yesno-mirror.test.ts`
both passed in the same run.

**What the rehearsal found, beyond what it was checking for.** The FULL
test suite then surfaced 18 failures across `test/migration-017/022/
024.test.ts` — traced to hardcoded turn sequences in those files (a local,
never-updated helper, or an inline sequence) still assuming morning's
PRE-030 step order, not a defect in 030's own logic. A further two
failures inside `test/morning-flow.test.ts` itself (the file written FOR
030) were flagged for separate investigation rather than dismissed — see
below. None of this blocked 030; it's exactly the class of finding a real
rehearsal exists to surface, distinct from the SQL-correctness checks
above.

**The unanticipated cost: a rehearsal on the ONLY shared test-db blocks CI
for every OTHER branch, not just this one.** Discovered when PR #98 (an
unrelated docs-only change against `main`) came back with `Test (real
test-db)` failing — not from anything in that PR's diff, but because
`main`'s code has none of 030's changes while test-db, left applied from
this rehearsal, was running 030's new RPC. Confirmed directly: re-running
the suite against `main`'s own unmodified code, pointed at test-db still
carrying 030, failed far more broadly than the 18 already catalogued —
`test/dispatch.test.ts` and `test/inbound-start.test.ts`, and ALL of
`migration-022.test.ts` rather than 4 cases, because `main` is missing not
just the follow-up fixes but migration 030's entire changeset. Recorded as
a known, recurring cost of the shared-test-db model in
`docs/build-status.md`'s 2026-08-24 entry, not proposed as something to
fix in this pass.

**Rolled back 2026-08-24 (Aravind's decision).** `docs/reviews/
030-rollback.sql` — NOT a numbered migration (this project's
`supabase/migrations/` holds forward migrations only; a rollback here
would confuse migration-lint and the ledger). Reverses 030 in mirrored
order: restores `apply_morning_flow_turn`'s ORIGINAL 022 body (`CREATE OR
REPLACE`, byte-identical 12-arg signature — 030 never changed it, review
package §10.1), drops `quoco_classify_yes_no`, reverses the
`morning_manpower` JSONB key transform (general predicate + in-transaction
structural assertion, same discipline as 030's own forward transform),
renames the column back to `morning_manpower_planned`, restores migration
017's original column-bound grant, drops the `attendance` column (its
CHECK constraint drops with it). `is_holiday` untouched throughout — it
predates 030.

**Verified by direct observation, not merely written — full transcript
`/tmp/030-rollback-verification.txt`:**
- Dry-run first, on a disposable local scaffold (030 applied forward, then
  this rollback applied on top): zero errors, and the resulting
  `morning_manpower_planned` byte-identical to the original pre-030 seed.
- Then for real on test-db: a row was seeded in the EXACT post-030 shape
  the local scaffold had just proven 030's forward transform produces from
  a known pre-030 original, the rollback applied, and the result compared
  — **byte-identical** to that known original (`{"planned_total": 20,
  "by_trade": [{"trade": "mason", "planned_count": 12}, {"trade": "helper",
  "planned_count": 8}], "raw_text": "12 mason 8 helper"}`), NULL row still
  NULL. (`/tmp/030-testdb-rehearsal.txt` itself never captured the raw
  pre-030 JSONB as a literal — only a narrative description plus the
  post-transform result — flagged rather than silently treated as
  sufficient; the byte-identical proof above is grounded in the seed
  script's own known literals instead, cross-checked against the local
  scaffold's identical baseline.)
- Structural: signature back to the exact 12-arg original, `pg_proc` count
  exactly 1, `attendance` column absent, `morning_manpower_planned`
  present, `schema_migrations` count unchanged at 25 throughout (neither
  030's apply nor this rollback ever touched the ledger — both were
  applied via `supabase db query --linked -f`, which is ledger-agnostic by
  design).
- **The full test suite, on `main`'s own unmodified code, against the
  now-reverted test-db: 47 files, 586 tests, 0 failures.** This is the
  check that actually closes the loop — proof the rollback didn't just
  look structurally right, it restored the exact state every other
  branch's CI already depends on.

**Status: migration 030 is NOT currently applied anywhere** (test-db or
prod) as of 2026-08-24 — back to PENDING for artifact 3, same as before
the rehearsal, but now backed by a rehearsal that already ran clean once
and a rollback proven to restore cleanly. The next real apply to test-db
(for the final rehearsal before an actual merge) can reuse
`docs/reviews/030-rollback.sql` as its own teardown step afterward,
closing the same loop rather than leaving test-db locked to one branch
again.

**Post-fix re-run, same day (2026-08-24), full transcript
`/tmp/030-testdb-rehearsal-v2.txt`.** The 16 stale-helper failures and the
one genuine `{}`-context assumption v1 found were fixed (commit `573ee20`
— stale local turn-sequence helpers in `test/migration-017/022/024.test.ts`
consolidated onto the shared, correctly-updated `completeMorningWithEquipment`/
`completeMorningNoEquipment`; the `{}`-context assertion updated to
`{q1_reask: 0}`, a genuine consequence of Q1 becoming reask-tracked, not a
stale assumption). 030 re-applied to test-db, the full suite re-run: **48
of 49 files, 679 of 681 tests passed** — the sole remaining failure is the
"restart strip" test (§ above, investigated, deliberately not touched
pending a decision on how to handle it). Test-db rolled back again
immediately after, confirmed restored (`morning_manpower_planned` present,
`attendance` absent) — not left blocking other branches' CI a second time.

---
