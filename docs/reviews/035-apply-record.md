# Migration 035 — production apply record (2026-09-03)

Companion to `docs/reviews/035-evening-flow-review-package.md` (the full review
package — spec, security assessment, disposable scaffold, written-AND-executed
rollback, test-db rehearsal, apply runbook §14.2's own S0–S6 sequence). Same
shape as `docs/reviews/030-apply-record.md`/`033-apply-record.md`/
`034-apply-record.md`. **Applied by Aravind, SQL Editor, by hand, ~09:05 IST —
this record documents the apply and the post-apply verification (S4–S6), it
did not perform the apply itself.**

## SHA provenance

- PR #157 (`worktree-evening-flow-plan-commit`) head at apply time:
  `d5d428266aad1c94b0325c25775a7570e5315d58` — all 7 CI checks confirmed
  `SUCCESS` on this exact head (re-verified via `gh pr view 157` immediately
  before the apply, not a stale rollup).
- Pasted SQL: `git show d5d4282...:docs/reviews/035_evening_flow_restructuring.sql`
  → `/tmp/035-to-paste.sql`, 945 lines, sha256
  `cae77de9bed877951cf34c35f9bb373d2c6ef281e219df46697d49f2a561cb6d`.
- **Hash re-verified at the ledger-repair step, same value** — the copy used
  for the SQL Editor paste and the copy placed for `migration repair` are
  byte-identical, confirmed both at generation and again at repair time.
- Aravind's own apply result: `"Success. No rows returned."` — consistent
  with the file's shape (function replacements, one `ALTER TABLE ADD COLUMN`
  pair, a grant re-declaration, a one-time session sweep — no `SELECT`).

## PITR observation (runbook step, before S0)

**Observed live, by Aravind, before any write step** — 7-day restore window,
latest restore point **03 Sep 2026 09:02:37 IST**. Per CLAUDE.md §0: verified
by direct observation, not a checklist line.

## S1 — apply window, run fresh at time of verification (not inherited)

- Linked project ref pasted immediately before each probe round, same output
  each time: `jvxwqignooseazzmwhvl` for the two production rounds below,
  `exfccwlrhoutkgrlikod` for the test-db check, switched back to test-db
  immediately after each production round.
- `SELECT current_flow, current_step, count(*) FROM whatsapp_sessions WHERE
  current_flow IS NOT NULL GROUP BY 1,2;` against production, run fresh
  ahead of the apply: **zero rows.** PROCEED condition met — Aravind's own
  morning-check-in session had closed, confirmed rather than assumed.
- Today's `daily_logs` (production): one row, `log_date: 2026-09-03`,
  `attendance: absent`, `morning_submitted_at: 2026-09-03 03:21:48 UTC`
  (08:51 IST), `evening_submitted_at: null` — morning check-in landed before
  the apply.
- `gh run list` immediately before the apply: all runs `completed`, nothing
  `in_progress`/`queued` — no CI contending for test-db at apply time.

## S4 — confirm live and tests green

**Vercel deployed the merge.** `gh api repos/ara-2789/Quoco/commits/e922847.../status`
→ `state: success`, Vercel context `"Deployment has completed"`, timestamped
`2026-09-03T03:35:29Z` (immediately after the `03:34:30Z` merge). The merge
commit's own CI run (`33711855779`) is fully green: File Size Lint, Migration
Lint, Typecheck, Lint, Test (real test-db) — all `success`.

**THE it.fails WRAPPERS HAVE NOT FLIPPED — FOUND, NOT ASSUMED AWAY, REPORTED
BEFORE ANYTHING ELSE.** Per direct instruction ("report anything that does
not match"): **035 was applied to production only. Test-db does not have
it.** Confirmed three independent ways, not inferred from one:

1. **Ledger.** `supabase migration list --linked` against test-db
   (`exfccwlrhoutkgrlikod`): ends at `034` (remote-only, the known pre-
   existing gap), no `035` entry anywhere.
2. **Live function body.** `SELECT md5(prosrc), length(prosrc) FROM pg_proc
   WHERE proname = 'apply_evening_flow_turn'` against test-db returns
   `6c4c486a09a0bd2906edbf1984b3d765` / `17137` chars — this is the review
   package's own §14.4 **POST-ROLLBACK** value from the 2026-08-31 rehearsal,
   not the post-apply value (`b2e53ed4...`/`19438`). Test-db is sitting
   exactly where the rehearsal's own rollback left it.
3. **Direct empirical run.** `test/evening-flow.test.ts` run against test-db
   on the merged code: all 19 tests report `✓ PASS`, including every
   `it.fails(...)`-wrapped case under "needs 035 applied" — read correctly,
   an `it.fails` reporting PASS means its own body FAILED as expected (the
   wrapper has not been removed and could not have been, since the
   underlying assertions about `evening_manpower`/`evening_idle_hours`
   genuinely cannot succeed against a database that doesn't have those
   columns or the new RPC body). This is exactly why the merge's own CI run
   is green: CI never tested the post-035 shape at all — it tested the
   pre-035 shape, correctly, because that is what test-db has always been
   throughout this apply.

**Consequence:** the `it.fails` suites named in S4 (`test/evening-flow.test.ts`,
`test/section-42-row-readback.test.ts`, the write-boundary-distinctness
cases) **cannot be run to demonstrate a flip today** — not "ran and failed,"
genuinely cannot demonstrate the thing S4 asks them to demonstrate, because
their one dependency (035 on test-db) does not exist. Not run further after
the first file confirmed the root cause — re-running the others would only
reconfirm the identical precondition gap. **Nothing altered on test-db to
try to fix this** — that decision is explicitly yours, per "do not fix
production without telling me first," extended here to test-db on the same
reasoning (a database write needs the same explicit go-ahead regardless of
which database).

## S5 — post-apply fingerprint, against production, live

| Check | Pinned expected (review package §1/§14.2) | Live result (production, this session) | Verdict |
|---|---|---|---|
| `apply_evening_flow_turn` body md5 | `b2e53ed4265f9ad215728c3a4ff081bc` (rehearsal's own post-apply value) | `b2e53ed4265f9ad215728c3a4ff081bc` | **PASS** |
| `apply_morning_flow_turn` body md5 | `5c1ad1403b8aad1b350b93d7cdb13c5c` | `5c1ad1403b8aad1b350b93d7cdb13c5c` | **PASS** |
| `apply_evening_flow_turn` signature | `p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_parse jsonb, p_parse_ok jsonb, p_now timestamptz, p_test_sleep_ms integer` | identical, `pg_get_function_identity_arguments` | **PASS** |
| `apply_morning_flow_turn` signature | `p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_manpower jsonb, p_manpower_ok boolean, p_equipment jsonb, p_equipment_ok boolean, p_now timestamptz, p_test_sleep_ms integer` | identical | **PASS** |
| `daily_logs.evening_manpower` | `jsonb` | `jsonb` | **PASS** |
| `daily_logs.evening_idle_hours` | `jsonb` | `jsonb` | **PASS** |
| `authenticated` UPDATE grant, `evening_manpower`/`evening_idle_hours` | present | `has_column_privilege(...) = true` for both | **PASS** |
| `authenticated` UPDATE grant, prior columns unchanged | `evening_dependencies`/`morning_plan` still granted | both `true` | **PASS** |

**NOTE ON PRE-APPLY BASELINE, stated precisely so it isn't misread as
something checked here:** the pre-apply hashes cited in the review package's
own §14.2 (`9bd64d28.../35150`, `dfab64f6.../15106`) are the REHEARSAL's own
pre-apply capture, on TEST-DB, 2026-08-31 — not a value this session
re-probed on production before Aravind's apply, since this verification
round began after the apply had already happened. Production's own pre-apply
body was never independently re-captured by this session; its post-apply
state matching the rehearsal's own recorded post-apply value (above) is the
evidence this apply behaved identically to the rehearsed one, which is the
strongest available proof in the absence of a prod-specific pre-apply
snapshot.

**Every S5 check: PASS. No anomaly on either function's body, either
signature, either new column, or any of the four grant probes.**

## S6 — ledger repair

**Absent on production too, confirmed before assuming otherwise:**
`supabase migration list --linked` (production) before repair: ends at `034`
(remote-only), no `035` row — the SQL genuinely ran (S5's fingerprints prove
it), the ledger simply didn't follow, matching this project's own repeated
"applied-but-unledgered" pattern (032's own still-open gap, 033's and 034's
own apply records).

**Repair, explicitly instructed, run:**
```
git show origin/main:docs/reviews/035_evening_flow_restructuring.sql > supabase/migrations/035_evening_flow_restructuring.sql
supabase link --project-ref jvxwqignooseazzmwhvl
supabase migration repair --status applied 035 --linked
# -> "Repaired migration history: [035] => applied"
supabase migration list --linked
# -> {"local":"035","remote":"035", ...} confirmed
rm supabase/migrations/035_evening_flow_restructuring.sql   # temporary copy removed, git status clean
```
sha256 of the copy used for repair re-checked against the paste file's own
hash immediately before running the command: identical (`cae77de9...`).

**A migration is not done when applied and ledgered — it is done when the
file is on `main`. FOUND, NOT CLOSED:** `git show origin/main:supabase/migrations/035_evening_flow_restructuring.sql`
→ does not exist at that path. The file IS reachable from `main`, but only
at `docs/reviews/035_evening_flow_restructuring.sql` — PR #157's merge did
not move it. **Same class of gap this project has already named once for
034** (034's own file also still sits in `docs/reviews/`, never moved). Not
fixed here — moving the file and committing to `main` is a real repo change
this record surfaces rather than performs unasked; the temporary copy used
for the repair step above was removed immediately after, exactly as it would
be for a rehearsal, precisely because this permanent move has not been
authorized yet.

## Apply method divergence, recorded as agreed

The runbook's own S2 specifies `supabase db query --linked -f`. The actual
apply used the **Supabase SQL Editor, by hand** — the fresh-tab/full-paste/
click-to-deselect ritual exists specifically because of migration 016's own
partial-selection incident, and four applies of muscle memory (030, 031,
032/033, 034) is itself part of the safety margin here, matching exactly the
same divergence 034's own apply record documented. Not a deviation from the
runbook's intent; a documented alternate path CLAUDE.md's own PROD APPLIES
rule already accepts.

## Follow-up round (2026-09-03, same session) — test-db apply, it.fails resolution, file moves, production incident

Both open items above are now resolved, in the order authorized: (1) test-db
apply, (2) it.fails wrapper removal, (3) file moves. A fourth, unplanned item
was found and fixed in the same window: a live production defect in the
Q4 equipment echo, deadline 18:30 IST same day.

### 1. Test-db apply

**Full-file apply FAILED, as found and reported before any fix:**
re-applying the complete pinned file (sha256 `cae77de9...`) to test-db hit
`42701: column "evening_manpower" of relation "daily_logs" already exists`.
Root cause: the 2026-08-31 rehearsal's own `docs/reviews/035-rollback.sql`
deliberately left the additive schema (`evening_manpower`/
`evening_idle_hours` columns, the `authenticated` UPDATE grant) in place on
rollback, per that file's own "real data is not migration scaffolding"
principle — see that file's own header, now updated with this exact gap and
its resolution. The failed transaction rolled back atomically: both
function body hashes (`md5(prosrc)`) were confirmed byte-identical
before and after the failed attempt — `6c4c486a.../17137` (evening),
`16d91836.../8784` (morning) — zero corruption, proven not assumed.

**Resolution, per explicit authorization (Option 1):** extracted only the
two `CREATE OR REPLACE FUNCTION` statements (each with its own trailing
EXECUTE grant reassertion) from the exact byte-identical pinned file —
line ranges 219–487 (morning) and 489–937 (evening), each independently
re-sliced and re-hashed from the pinned source to confirm no transcription
error (`dd075ae2.../269 lines` and `2dc3756d.../449 lines` respectively).
Wrapped in a fresh `BEGIN;`/`COMMIT;`, applied successfully.

**Acceptance test — test-db vs. production directly, not against a written
expectation:**

| Check | Production | Test-db (post-fix) | Verdict |
|---|---|---|---|
| `apply_evening_flow_turn` body md5 | `b2e53ed4265f9ad215728c3a4ff081bc` | `b2e53ed4265f9ad215728c3a4ff081bc` | **PASS** |
| `apply_morning_flow_turn` body md5 | `5c1ad1403b8aad1b350b93d7cdb13c5c` | `5c1ad1403b8aad1b350b93d7cdb13c5c` | **PASS** |
| Both function signatures | identical | identical | **PASS** |
| `evening_manpower`/`evening_idle_hours` column types | `jsonb`/`jsonb` | `jsonb`/`jsonb` | **PASS** |
| `authenticated` UPDATE grant, new + prior columns | present | present | **PASS** |
| `service_role`/`authenticated`/`anon` EXECUTE, both functions | `true`/`false`/`false` | `true`/`false`/`false` | **PASS** |

Test-db's final state is indistinguishable from production on every axis
checked. Ledgered (`supabase migration repair --status applied 035
--linked`); `supabase migration list --linked` confirms `{"local":"035",
"remote":"035"}`.

### 2. it.fails resolution — all 20 (15 + 5), full breakdown

Full re-verification, not a repeat of the earlier assumption: every
`it.fails` in `test/evening-flow.test.ts` (15) and
`test/section-42-row-readback.test.ts` (5) was run standalone, then the
whole of each file was bulk-unwrapped and run together in real file order
(catching order-dependent false positives a single-test run would miss).

**`test/section-42-row-readback.test.ts` — all 5 flipped cleanly, unwrapped.**

**`test/evening-flow.test.ts` — 13 flipped cleanly; 2 needed a real fix
first (both fixed, then flipped); all 15 now unwrapped, 0 remain wrapped:**

- **4 tests had a test-authoring bug**, not an RPC defect: three Q3
  idle-hours expected literals were missing a `raw_text` field the RPC
  correctly writes (confirmed by cross-reference — the sibling Q2/Q4 tests
  already expected it correctly). Fixed by adding the field to each literal.
- **2 Q5 tests shared a seeding bug**: both called
  `seedMorningEquipment([])` — an EMPTY items array triggers the SAME
  auto-skip as no submission at all
  (`035_evening_flow_restructuring.sql:629-630`,
  `IS NULL OR jsonb_array_length(...) = 0`), so Q3 auto-skipped straight to
  step 5 and `driveToStep`'s own hardcoded step-4 message landed as the Q5
  answer instead — completing the flow before the real hindrance message
  was ever sent. One of the two (`already_complete: post-completion inbound
  writes nothing...`) technically PASSED under this bug, but for the WRONG
  REASON: its assertions (outcome `already_complete`, frozen timestamp) hold
  regardless of which message actually completed the flow, so it asserted
  nothing about the behavior it was named for. **Both confirmed as false
  positives before being trusted — neither was unwrapped as-is.** Fixed by
  seeding non-empty equipment, matching what `driveToStep` already assumes.
- **1 assertion was DROPPED, not fixed** (`morning HAS equipment -> step 4`
  and the Q4 reask test): both asserted `equipment_echo` on the RPC's own
  return value, which this file's helper (`test/helpers/db.ts`) reads by
  calling the RPC DIRECTLY — bypassing `lib/whatsapp/flows/evening.ts`
  entirely. The RPC deliberately never populates that field (see the
  production incident below), so this file can never exercise the real fix
  regardless of wrapper state. Worse, the reask test's `toContain('JCB')`
  assertion was a SECOND false positive: `EVENING_REASK_MESSAGES[4]`
  hardcodes "JCB 6 hours" as its own static example text, so that assertion
  passed whether or not any real echo worked, before OR after any fix. Both
  assertions removed with an explanatory comment pointing to where the real
  coverage now lives (`test/dispatch.test.ts`).

**None flipped for the wrong reason in the FINAL committed state** — the
two genuine false positives above were caught and fixed before unwrapping,
not unwrapped and left standing.

### 3. Production incident — Q4 equipment echo, found and fixed same session

**Not part of the original plan; found while diagnosing the "morning HAS
equipment" test's non-flip, above.** `035_evening_flow_
restructuring.sql:524` declares `v_equipment_echo JSONB := NULL` and never
assigns it anywhere in the function body (confirmed by full grep). Per its
own comment (line ~911), this was deliberate — populating it was left to
"the caller's own prompt-building code," explicitly out of scope for the
SQL file. But `evening.ts`, shipped in the same PR, was never updated to
drop that dependency: its own docstring said `equipmentEcho` was "REQUIRED
to render step 4's prompt... the RPC returns it on both paths." From
~09:05 IST (this migration's own lockstep apply) until the fix, `dispatch.ts`
passed the RPC's permanently-null field straight into `buildEveningReply`,
so every real engineer reaching evening Q4 received: *"Equipment you listed
this morning: . How many *hours* was each used today?"* — an empty list,
live on production, with tonight's 18:30 IST trigger about to hit it again
for every engineer who reaches Q4.

**This is the SAME class of gap Finding A (§9 above) exists to prevent — a
disagreement between the SQL and TypeScript halves of one migration's
contract — just the other direction of the contract.** Finding A checked
that the two sides agreed on what the RPC RECEIVES; nothing checked they
agreed on what it RETURNS. A follow-up note is recorded directly after
Finding A's own text in `docs/reviews/035-evening-flow-review-package.md`
with the general lesson for future reviews.

**Fix: TypeScript only, no second SQL apply.** `lib/whatsapp/flows/
evening.ts`'s `applyEveningFlowTurn` now reads `morning_equipment` directly
from `daily_logs` (keyed on `project_id`/`engineer_id`/`log_date` — the same
unique key the RPC's own `ON CONFLICT` already relies on) whenever
`current_step === 4`, bypassing the RPC's dead `equipment_echo` field
entirely. One extra indexed read, only on turns that reach or are re-asked
at Q4 — not a per-turn cost. `EquipmentEchoItem`'s docstring,
`buildEveningReply`'s docstring, and `EveningTurnResult.equipmentEcho`'s
docstring all corrected to state this — the stale claims ("Populated by the
RPC") are exactly what let the mismatch through undetected.

**Tested against the real post-035 RPC, through the actual production
wrapper — not the RPC-only test helper that cannot exercise this fix at
all.** `test/dispatch.test.ts` gained a new suite,
`evening Q4 equipment echo — real morning_equipment, not the RPC`, going
through `dispatchInboundTurn` (the real webhook path):
  - engineer WITH morning equipment (`concrete_mixer` — deliberately not
    `jcb`, since the reask copy's own static example text contains "JCB"
    and would mask a fake pass) reaches Q4 and the reply starts with
    `"Equipment you listed this morning: Concrete Mixer."` — the real echo,
    exact-match asserted.
  - engineer with NO morning equipment auto-skips straight to Q5, reply
    equals `EVENING_QUESTIONS[5]` verbatim — no read even attempted.
  Both pass against the live post-035 RPC shape, on test-db, post the
  apply above.

**DATED CORRECTION (Aravind, 2026-09-03, same day) — the impact claim above
is FALSE IMPACT, not just imprecise wording, and is corrected here rather
than reinterpreted.** The commit that shipped this fix (`f632a5f`, own
message) states: *"every real engineer reaching evening Q4 received: 'Equipment
you listed this morning: . How many hours was each used today?' — an empty
list, live on production."* That sentence describes what the CODE would do,
conditionally — it is not a claim that anyone actually hit it, but it reads
as one, and was flagged as such rather than left to be misread later.

**Verified, live, against `outbound_sends` and `daily_logs` on production
(`jvxwqignooseazzmwhvl`) — the actual count is ZERO.** The bug window was
09:05 IST (this migration's own apply) to 10:28:35 IST (`f632a5f`'s own
commit time). The ONLY `evening_send` outbound trigger for 2026-09-03 fired
at `13:00:14 UTC` = **18:30:14 IST — over eight hours after the fix
landed**, per `outbound_sends`:
```
recipient_user_id                    event_key                status  created_at
3534756b-2a32-4b91-954b-0bab15c2dba1 evening_send:2026-09-03  sent    2026-09-03 13:00:14 UTC
```
The one real `engineer`-role user on production completed the full evening
flow, Q4 included, at `evening_submitted_at: 2026-09-03 13:02:41 UTC`
(18:32:41 IST) — two and a half minutes after that trigger, entirely on the
already-fixed RPC. No other session was active or lingering during the bug
window (`whatsapp_sessions` holds exactly one row for this project,
matching this same completion). **Zero real engineers received the broken
prompt.** The near-miss is real and worth keeping on record — the fix
landed hours before the one trigger that would have exercised it, not
after — but the sentence quoted above should be read as corrected to:
"the code, unfixed, would have sent this to every real engineer reaching
evening Q4 in the bug window; verified against `outbound_sends` and
`daily_logs`, nobody did."

### 4. Migration files moved to `supabase/migrations/`

Both files hash-verified against their own apply-record-pinned sha256
BEFORE and AFTER `git mv`:

- `034_owner_email_delivery.sql`: `13dfff1f3580f62b68db92722b4a12d891591c8092670dfade71e02f07188065`
  (matches `034-apply-record.md`'s own pin) — identical post-move.
- `035_evening_flow_restructuring.sql`: `cae77de9bed877951cf34c35f9bb373d2c6ef281e219df46697d49f2a561cb6d`
  (matches this record's own §"SHA provenance" pin) — identical post-move.

`npm run lint:migrations` after the move: `migration-lint: clean. 86 known
violation(s), all exempted.`

## Open items — status

**ALL CLOSED, this round:**
1. ~~Test-db does not have 035~~ — resolved above (function-only apply,
   acceptance test PASS on every axis, ledgered).
2. ~~The migration file has not moved to `supabase/migrations/`~~ —
   resolved above (both 034 and 035 moved, hash-verified, lint clean).

**CLOSED, prior round:** SHA provenance pinned and re-verified byte-identical
at two points; PITR observed live pre-apply by Aravind; S1's live
session/daily-log probes both run fresh and clean; Vercel confirmed
deployed; S5's seven fingerprint checks all PASS against production; S6's
ledger repair run and verified on production. PR #157 merged (`--merge`,
matching repo convention), not squashed.

**NEW, this round:** the Q4 equipment-echo production incident (§3 above) —
found, fixed, tested, and recorded in the same session, ahead of the 18:30
IST evening trigger.
