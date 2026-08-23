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
- **Default-on-exhausted-reask direction**: pessimistic, matching
  `lexicon.ts`'s own stated principle for `classifyYesNo` ("the pessimistic
  reading is the one that asks Q3 and captures the reason" — i.e., ambiguity
  resolves toward MORE downstream capture, not less). Applied here: an
  unparseable attendance answer defaults to **NO** (routes to the holiday
  follow-up, asking more rather than silently assuming presence); an
  unparseable holiday-follow-up answer defaults to **`absent`**, not
  `site_holiday` — `absent` keeps the evening trigger and PM handoff alive,
  `site_holiday` would silently cancel them. This is a genuinely new
  direction judgement, not derivable from §30(b)'s text alone — flagged
  explicitly for reviewer sign-off, not asserted as decided.
- **Reply copy for the two NO-path completions is UNDECIDED** — §30(b) gives
  the two follow-up QUESTIONS their copy but not the completion messages
  (does a `site_holiday` completion say something different from an `absent`
  one, or from the YES-path's `MORNING_COMPLETE_REPLY`?). Not resolved here;
  flagged so it isn't silently defaulted to the generic completion string
  without a decision.

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
| F4 | (new) | — | — | **1 → 5** | **NEW: `!ok`, budget exhausted → accept as NO (pessimistic default), same as F2.** | Same as F2. Reset `q1_reask := 0`. |
| G | 187-192 (moves here) | 2 | `q2_reask`-tracked labour parse | **2** | **Free text → `morning_plan`, advance to 3.** (old step 1's logic, moved) | Write `morning_plan`. |
| H | 193-205 | 2 | `q2_reask`-tracked labour parse → advance to 3 | **3** | **Parsed labour (old step-2 logic, moved), reask key renamed `q2_reask`→`q3_reask`** | Write `morning_manpower` (renamed column, JSONB keys `planned_count`→`count`, `planned_total`→`total` — see plan §d; data-migration `UPDATE` over existing rows required, not covered by this table). |
| I | 206-217 | 3 | `q3_reask`-tracked equipment parse → advance to 4 | **4** | **Parsed equipment (old step-3 logic, moved), reask key renamed `q3_reask`→`q4_reask`** | Write `morning_equipment` (column unchanged). |
| J1 | (new, replaces 219-230's role) | — | — | **5 → 0 (complete)** | **NEW: holiday follow-up, `ok && met` (YES = site holiday).** | Write `attendance = 'site_holiday'`, `is_holiday = true`, `morning_submitted_at = p_now`. Merge `context.morning_submitted := true` (strip all reask keys) — same merge discipline as the existing Q4 completion (022's CONTEXT DISCIPLINE site 2). |
| J2 | (new) | — | — | **5 → 0 (complete)** | **NEW: `ok && !met` (NO = absent).** | Write `attendance = 'absent'`, `morning_submitted_at = p_now`. Same context merge as J1. (`is_holiday` stays `false`, its default.) |
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
| F1-F4 | `morning.ts:199-203` (`current_step === 1` branch, currently free-text → `morning_plan`) | Replaced entirely | New `classifyYesNo`-driven branch, structurally mirroring evening's own step-2 handling (`evening.ts:447-462`) — reask via a new `q1_reask` context key, `MORNING_PARSE_REASK_CAP`, advance to 2 (YES) or 5 (NO / exhausted-reask default) | `MorningDailyLogWrite` type gains `attendance?: 'present' \| 'absent' \| 'site_holiday'` and `is_holiday?: boolean`. |
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

## 5. Evidence artifacts — PENDING

The five pieces of empirical evidence this package cannot produce because no
migration file or code exists yet. Listed so the package's eventual shape is
visible now and the gap is explicit, not silently absent.

1. **PENDING** — Full before/after body diff for `apply_morning_flow_turn`
   (old vs. new SQL), keyed line-by-line to §2's table above.
2. **PENDING** — Disposable dry-run scaffold output (real `pg_dump`-based
   schema, per CLAUDE.md §7's standing rule) proving the new SQL parses and
   executes against a structurally accurate Postgres before any real database
   sees it.
3. **PENDING** — Test-db rehearsal transcript exercising every renumbered
   step in sequence: the YES path (1→2→3→4→complete) AND both NO sub-paths
   (1→5→complete as `site_holiday`, 1→5→complete as `absent`), as real
   multi-turn RPC calls, not unit tests of the RPC in isolation.
4. **PENDING** — TS/SQL pure-mirror agreement test, extending
   `test/productivity-reconciliation-mirror.test.ts`'s own pattern to
   morning's renumbered flow, proving `dispatchMorningFlow` and
   `apply_morning_flow_turn` agree on every branch in §2's table — including
   the two new ones — not just individually correct.
5. **PENDING** — GATE 1's live observation itself (§3 above): the
   `daily_logs` query output and the `MORNING_QUESTIONS[1]`-vs-template-1
   string diff, captured post-apply with the migration's SHA and an empty
   `git status --porcelain`, per this project's ARTIFACT PROVENANCE rule.
