# Migration 022 — evening check-in flow Pass 1 (`apply_evening_flow_turn`) — review package

Evening flow's first pass: Q1 (work completed + quantities enrichment), Q2
(plan met? — parsed yes/no with a conditional branch), Q3 (miss reason,
**only** when Q2 = No). Ships alongside two changes to
`apply_morning_flow_turn`: its ELSE branch now returns `'wrong_flow'` instead
of `'idle'` when a different flow is active, so a mis-routed turn is reported
to the webhook instead of silently swallowed after its Twilio SID is already
consumed; and — added during reviewer round 2, see §9 — its two
context-writing sites (start, Q4 completion) now merge context instead of
replacing it, matching the rule evening's own two sites already followed.

- Migration: `supabase/migrations/022_evening_flow_apply_turn.sql`
- Flow modules: `lib/whatsapp/flows/evening.ts` (new),
  `lib/whatsapp/flows/morning.ts` (`wrong_flow` outcome +
  `dispatchMorningFlow` parity, round 2)
- Parsers: `lib/whatsapp/flows/parsers/quantities.ts` (new),
  `lib/whatsapp/flows/parsers/lexicon.ts` (evening additions —
  `canonicalUnit`, `QUANTITY_STOPWORDS`, `classifyYesNo`)
- Design record: `docs/design-decisions-beta-feedback.md` §10 (RESTART
  SEMANTICS — DECIDE-BEFORE-CRON-PR, round 2)
- Tests: `test/migration-022.test.ts` (13, +1 round 2),
  `test/unit/quantities-parser.test.ts` (14),
  `test/unit/yesno-classifier.test.ts` (35),
  `test/unit/morning-dispatch.test.ts` (15, +1 + 1 updated, round 2)

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts are pinned to source, never paraphrased.

**Self-correction, made while re-pinning for round 2:** the table below
originally attributed sha256 `ab1964b3…` to `test/migration-022.test.ts` and
`eaf52186…` to `test/unit/quantities-parser.test.ts`. Recomputing every hash
individually (filename and hash printed on the same line, no parallel-call
reassembly) for this round showed those two values were swapped —
`ab1964b3…` has always been `quantities-parser.test.ts`'s hash (unchanged
since its creation) and `eaf52186…` has always been
`test/unit/yesno-classifier.test.ts`'s (present in the repo since round 1 but
never listed in this table at all). Both are corrected below. Caught by the
same discipline this package asks of everything else — recorded rather than
quietly fixed, per §0.

| Artifact | Pin |
|---|---|
| Commit | `6bbbc598f8dc3f6a2ffcceef6337ea3e2fc46a30` |
| Branch | `feat/022-evening-flow-apply-turn` |
| `git status --porcelain` at that commit | `''` (empty — clean tree) |
| Migration file | `git show 6bbbc59:supabase/migrations/022_evening_flow_apply_turn.sql` — sha256 `f7e1ee6dfe76bfaed27a6af416c8fcaa9c31aa87d924a353bc95206f7b23acfb` |
| `evening.ts` | sha256 `7311bd7154f7dccd60a6a0fddc066e3f6ec7660cc07c68a111799d269d7ca10f` (unchanged since round 1) |
| `morning.ts` | sha256 `f8702bf4dbc2d1b3bcebb7b8a48f0c0575df106292cf44749f2c75d7e6196a04` (new this round) |
| `quantities.ts` | sha256 `450e3c73cb541f2120c6c919446442dec54e089766d52fcea531f08b9c82044b` (unchanged since round 1) |
| `lexicon.ts` | sha256 `5ef5c646e6697ae45a6b6d359ed4c840acd1812e8c7e3c25c02a5e4ab6c938d4` (unchanged since round 1) |
| `test/helpers/db.ts` | sha256 `fe0a40edc35cfa83629c44decb2276f4a604ca90d7cff8ec366c49dd17af12f6` (unchanged since round 1) |
| `test/migration-022.test.ts` | sha256 `cb23f0b4c312844b3196cf3ce4f0633ad832890f05a4bd1c5ae950f8ae3394fe` (new this round — T-022-13) |
| `test/unit/quantities-parser.test.ts` | sha256 `ab1964b36571cb470a7061f1b780bad8b0125c133e44596ffa958b8e66b84433` (corrected label, value unchanged since round 1) |
| `test/unit/yesno-classifier.test.ts` | sha256 `eaf52186a28da0dc8d6dc85c9b99ead72977b61df24c99b5b107d2dc574addcb` (now listed; value unchanged since round 1) |
| `test/unit/morning-dispatch.test.ts` | sha256 `ceb3510c6f2973eff0e331633ee0f816f1fb551fd0b3617e642f0f39ef6b42e9` (new this round) |
| `docs/design-decisions-beta-feedback.md` | sha256 `9283d87f0159b612f2251e3591c69a1c940a6c1b71efc1f793e81fe4bb9e9b57` (§10 added this round) |
| `CLAUDE.md` | sha256 `e5a7c3c568c30a67c9ee736bd183cff56910d31d364d2747a020b4c01fbcc519` (§7 testing lesson added this round) |

**RAW-CAPTURE STATUS: PARTIAL — read this before treating any section below as
equally weighted.**

- **§4 (final-state evidence, R5f Section 1) — LITERAL.** Pasted verbatim by
  the owner from the SQL Editor; reproduced verbatim below, unedited.
- **§3 (R5 turn-by-turn rehearsal: R5b/R5d/R5e) — NARRATIVE-CONFIRMED, not raw.**
  The assistant generated each turn's SQL from the production parsers (never
  hand-typed JSON), read test-db state read-only before/after each phase, and
  the owner confirmed each turn's outcome against the stated expectation. No
  individual turn's raw query result was pasted back into this conversation —
  only the aggregate final state was (§4), which is independently consistent
  with every value the narrative claims (cross-checked below, §5).
- **§6 (ACL + function-body catalog check, both rounds) — NARRATIVE-CONFIRMED,
  not raw.** The assistant authored the catalog queries with predicted
  expected values (recomputed fresh, filename-and-hash printed on the same
  line, after the round-1 mislabelling above); the owner ran them and
  confirmed the results in prose, not by re-pasting rows. Queries are pinned
  and reproducible; the specific row values in this package are the owner's
  confirmation, not a raw capture. §6.2 also records a round the owner ran
  but never narrated a result for — stated explicitly as absent evidence,
  not filled in by assumption.
- **§7 (automated test suite) — LITERAL.** Re-run directly against this pinned
  commit while drafting this package; output captured below unedited.
- **§9 (CONTEXT DISCIPLINE finding) — MIXED.** The three-site table and the
  fix are LITERAL (drawn directly from the committed diff). The narrative of
  how T-022-13 caught it and B2 alone didn't is the assistant's own
  diagnosis, reviewed and accepted by the reviewer and the owner across
  several turns — not a raw capture, but not asserted unilaterally either.

---

## 1. Environment matrix

| | Project ref | State |
|---|---|---|
| **prod** | `jvxwqignooseazzmwhvl` | 022 **NOT APPLIED** as of this package |
| **test-db** | `exfccwlrhoutkgrlikod` | 022 applied; R5 rehearsed; ZZ Smoke fixtures cleaned (R5f) |

Rehearsed on the cleaned existing test-db per the CLAUDE.md §0 conditional
rule (fresh Supabase branch provisions were observed missing
`users.auth_id`).

---

## 2. What changed, structurally

**New function — `apply_evening_flow_turn`** (10 args): same transactional
shape as `apply_morning_flow_turn` (atomic acquire, BOT-07 next-day reset,
one `daily_logs` write per resolved question, unconditional session write) but
with two deliberate departures, both load-bearing:

- **Explicit next-step assignment, never `step + 1`.** Q3 is conditional
  (only reached when Q2 = No), so evening cannot use morning's
  `current_step = question number` shortcut.
- **One keyed `p_parse`/`p_parse_ok` JSONB pair, not one typed pair per
  question.** Both are computed unconditionally every turn and keyed by step
  id; the RPC selects the entry matching the step it resolves *under its
  lock*, because the caller cannot safely know the active step without an
  unlocked read that could race a concurrent turn.

**CONTEXT DISCIPLINE — one rule, four sites (final shape, after reviewer
round 2; §9 has the full finding).** The rule: *a flow's context write strips
only that flow's own in-flight counters and merges everything else — never a
bare replace or wipe.*

| Site | Behaviour | Status |
|---|---|---|
| Morning START | `context := context - 'q2_reask' - 'q3_reask'` | **Fixed round 2** — see §9 |
| Morning Q4 COMPLETE | `context := (context - 'q2_reask' - 'q3_reask') \|\| {'morning_submitted': true}` | **Fixed round 2 (B2)** — see §9 |
| Evening START | `context := context - 'e2_reask'` | Correct by design |
| Evening COMPLETE | `context := (context - 'e2_reask') \|\| {'evening_submitted': true}` | Correct by design |

Evening's two sites were never wrong: evening was *written into* the
two-flow world this migration creates, so it had no single-flow assumption
to unlearn. Morning's two sites inherited 018's assumption that it was the
only flow — safe in 018, silently wrong the moment evening could leave
something in context to destroy. §9 has the full finding, including why the
original single-line B2 fix (Q4 only) didn't close this and what caught the
second site.

**`apply_morning_flow_turn`'s wrong_flow change** — a *separate* kind of
change from CONTEXT DISCIPLINE, present since round 1: the final ELSE (a
different flow, i.e. evening, is active) returns `'wrong_flow'` instead of
018's `'idle'`, so the webhook can retry against the correct RPC instead of
silently dropping the engineer's answer after the Twilio SID is already
consumed. Round 2 also gave the TypeScript mirror (`morning.ts`) the same
outcome — `MorningOutcome` was missing it entirely, so `buildMorningReply`'s
switch was non-exhaustive against what the RPC could actually return; see §9.

**EXECUTE hardening applied inline, not as a follow-up.** `apply_evening_flow_turn`
is a new parameter-trusting SECURITY DEFINER function (`p_user_id`/`p_tenant_id`/
`p_project_id` all caller-supplied, no `auth.uid()` derivation) — exactly the
class 020 closed for the other three. 022 REVOKEs PUBLIC/anon/authenticated and
GRANTs only `service_role` on both functions in the same transaction that
creates it, rather than shipping open and hardening later.

---

## 3. R5 rehearsal — narrative-confirmed, turn-by-turn (test-db)

**Historical record, predates reviewer round 2 — read with that in mind.**
This rehearsal ran 2026-08-03, before B2 or the third CONTEXT DISCIPLINE fix
existed. Its Engineer C sequence (Part 2 below) exercises morning-completes-
then-evening-starts — the direction that was *already correct* before round
2 (evening's start already merged; see §2's table). It does **not** exercise
the reverse (evening completes, then morning starts and completes), which is
exactly the direction round 2's fix targets and where the third-site bug
lived. That gap is closed by the automated `T-022-13` (§9, §7), not by a
second manual rehearsal — the owner's explicit call, since the automated
test already drives the real RPC on real test-db and a hand-typed replay
would prove nothing beyond what it already proves. Left here unedited as the
original record of what round 1 actually tested; §9 is where the reverse
direction is proven.

Full functional smoke test, three fixture engineers on tenant
`00000000-0000-4000-a000-0000000e0022` / project `…e2022`:

- **A** (`+19995550922`) — evening only, Q2 = No branch
- **B** (`+19995550923`) — evening only, Q2 = Yes branch
- **C** (`+19995550924`) — morning, then evening; both `wrong_flow` directions

### R5b — Engineer A, Q2="no" → Q3 (the conditional edge)

Four turns: start → Q1 (`slab concrete 120 sqm, plastering 300 sft`) → Q2
(`no`) → Q3 (`RMC truck delayed 3 hours, concrete pump broke down after
lunch`). Confirmed: Turn 3 held `current_flow: 'evening'`, `current_step: 3`
(**not** completing) with `evening_submitted_at` still null; Turn 4 completed
cleanly with the merged marker and every `morning_*` column null.

### R5d — Engineer B, Q2="yes" → complete at step 2 (the other edge)

Mirror of R5b with the opposite Q2 answer. Confirmed: Turn 3 returned
`current_step: 0` (not 3) — Q3 genuinely skipped, `evening_schedule_miss_reason`
null. A fourth, optional post-completion turn (`"thanks"`) confirmed
`already_complete` with `evening_submitted_at` unchanged — the idempotency
proof. Cross-engineer check at this point showed A and B's rows cleanly
separated by `engineer_id` on the same project/date.

### R5e — Engineer C, morning regression + both `wrong_flow` directions

**Part 1:** full 4-question morning flow run end-to-end under 022's
re-created `apply_morning_flow_turn` body (regression check — 022 does
`CREATE OR REPLACE` on this function too). Mid-flow, Turn 3 called
`apply_evening_flow_turn` while morning was active at step 2: returned
`'wrong_flow'` with morning's `current_flow`/`current_step` completely
unchanged and no `evening_*` column written. Turns 4–6 then resumed morning
from exactly where it left off and completed normally, proving the
`wrong_flow` turn didn't corrupt state.

**Part 2 — the direction 022 actually changed:** Turn 7 started evening
*after* morning had already completed on the same session, and confirmed
`context` still carried `{"morning_submitted": true}` — the context-merge
proof, direction A (survives evening's own start). Turn 8 then called
`apply_morning_flow_turn` while evening was active at step 1:

> **`outcome = 'wrong_flow'`, not `'idle'` — this is the direct behavioral
> proof that 022's one-line edit to morning's ELSE branch is live on
> test-db, not 018's original body.** `morning_plan` was confirmed unchanged
> (the wrong_flow turn wrote nothing).

---

## 4. Final-state evidence — LITERAL (R5f Section 1, pasted verbatim by the owner)

```
=== 1a — daily_logs final state ===
full_name,engineer_id,log_date,morning_plan,morning_manpower_planned,morning_equipment,morning_execution_plan,morning_submitted_at,evening_output,evening_output_quantities,evening_schedule_met,evening_schedule_miss_reason,evening_submitted_at
"ZZ Smoke Engineer A (evening, plan NOT met)",00000000-0000-4000-a000-0000000e1022,2026-08-03,null,null,null,null,null,"slab concrete 120 sqm, plastering 300 sft","{""items"":[{""raw"":""slab concrete 120 sqm"",""unit"":""sqm"",""activity"":""slab concrete"",""quantity"":120},{""raw"":""plastering 300 sft"",""unit"":""sqft"",""activity"":""plastering"",""quantity"":300}],""raw_text"":""slab concrete 120 sqm, plastering 300 sft""}",false,"RMC truck delayed 3 hours, concrete pump broke down after lunch",2026-08-03 13:36:00+00
"ZZ Smoke Engineer B (evening, plan met)",00000000-0000-4000-a000-0000000e1023,2026-08-03,null,null,null,null,null,"column casting 8 nos, brickwork 250 sqft","{""items"":[{""raw"":""column casting 8 nos"",""unit"":""nos"",""activity"":""column casting"",""quantity"":8},{""raw"":""brickwork 250 sqft"",""unit"":""sqft"",""activity"":""brickwork"",""quantity"":250}],""raw_text"":""column casting 8 nos, brickwork 250 sqft""}",true,null,2026-08-03 13:44:00+00
ZZ Smoke Engineer C (morning + wrong_flow),00000000-0000-4000-a000-0000000e1024,2026-08-03,column casting grid 5 to 8 and slab prep for tomorrow pour,"{""by_trade"":[{""trade"":""mason"",""planned_count"":4}],""raw_text"":""18 workers, 4 masons"",""planned_total"":22}","{""none"":false,""items"":[{""raw"":""1 JCB"",""type"":""jcb"",""count"":null,""owned_or_hired"":null,""daily_hire_cost"":1},{""raw"":""2 mixers"",""type"":""mixers"",""count"":null,""owned_or_hired"":null,""daily_hire_cost"":2}],""raw_text"":""1 JCB, 2 mixers""}","pour starts 7am, finish slab by 2pm",2026-08-03 14:00:00+00,null,null,null,null,null

=== 1b — session final state ===
phone_number,current_flow,current_step,context,updated_at,expires_at
+19995550922,null,0,"{""evening_submitted"":true}",2026-08-03 13:36:00+00,2026-08-03 14:06:00+00
+19995550923,null,0,"{""evening_submitted"":true}",2026-08-03 13:46:00+00,2026-08-03 14:16:00+00
+19995550924,evening,1,"{""morning_submitted"":true}",2026-08-03 14:04:00+00,2026-08-03 14:34:00+00

=== 1c — row inventory before deletion ===
table_name,rows
daily_logs,3
project_members,3
projects,1
tenants,1
users,3
whatsapp_sessions,3

=== Section 2/3 post-cleanup verification ===
table_name,remaining
daily_logs,0
project_members,0
projects,0
tenants,0
users,0
whatsapp_sessions,0

stray_sessions
0
```

## 5. Cross-check — literal §4 against the §3 narrative

Every value the §3 narrative claimed is independently reproduced by the
literal capture above, converting UTC → IST (+05:30):

| Claim (§3) | §4 literal value | IST |
|---|---|---|
| A: Turn 4 completes, `met=false`, reason set | `evening_schedule_met=false`, `evening_schedule_miss_reason` set, `evening_submitted_at` `13:36:00+00` | 19:06 |
| B: Turn 3 completes at step 2, no reason | `evening_schedule_met=true`, `evening_schedule_miss_reason=null`, `evening_submitted_at` `13:44:00+00` | 19:14 |
| B: Turn 4 (post-complete) bumps `updated_at`, writes nothing | session `updated_at` `13:46:00+00` ≠ `evening_submitted_at` `13:44:00+00` — moved, but the log timestamp didn't | 19:16 vs 19:14 |
| C: morning completes | `morning_submitted_at` `14:00:00+00`, all `morning_*` populated | 19:30 |
| C: Turn 8 (mirror wrong_flow) leaves evening mid-flow | session `current_flow='evening'`, `current_step=1`, `context={"morning_submitted":true}`, `updated_at` `14:04:00+00` | 19:34 |

No discrepancy anywhere. B's session `updated_at` (19:16) reading later than
its `daily_logs.evening_submitted_at` (19:14) is itself a proof point, not an
anomaly — it's the already_complete write-nothing path bumping session TTL
while leaving the log timestamp frozen, exactly as designed.

---

## 6. Catalog check — closing the two gaps R5's initial state verification left open

### 6.0 Round 1 (original apply, 2026-08-03)

Before R5b/d/e, an initial read-only pass (PostgREST OpenAPI probing) found
`apply_evening_flow_turn` present, correctly shaped (10 args), and absent
from the **anon** OpenAPI (no `PUBLIC`/`anon` grant) — but two things
PostgREST cannot see: the **`authenticated`** grant, and whether the deployed
function **body** actually differs from 018 (arity alone can't distinguish
018 from 022, since 022 re-creates `apply_morning_flow_turn` with the *same*
12-arg signature).

**A1 — ACL, via `pg_proc.proacl`/`aclexplode`:** both functions confirmed
`acl_is_default_public = false` (i.e. not left on PostgreSQL's default PUBLIC
EXECUTE — the exact hole 020 closed), single overload each, grantees limited
to the owner and `service_role` only. No `authenticated`, no `anon`, no
`PUBLIC` row on either function.

**A2 — body identity, via `pg_proc.prosrc`:** `prosrc_len`/`md5` for both
functions matched values computed independently from the local file exactly
(evening: 8978 chars / `76b109605214d5749d58b834cd3b7897`; morning: 7324
chars / `10a209bd3a23067245ab6bf2955786da`). `body_has_wrong_flow = true` for
**both** — confirming the deployed morning body is 022's, not 018's
`'idle'`-returning version, independently of the R5e Turn 8 behavioral proof
in §3.

### 6.1 Round 2 (post-B2-only, Q4 merge without the third-site fix) — RUN, RESULT NOT NARRATED

A recheck query was generated and handed to the owner to run after the
Q4-only merge fix landed (before the morning-start third site was found).
The owner said they would run it; no numeric result was reported back before
the conversation moved on to applying the third fix. **Stated explicitly as
absent evidence rather than filled in from the predicted values** — the
predicted expected hashes for that intermediate state were `morning`:
8184 chars / `deace412e2c1a657d1c9b963c0d680ae`, `evening`: unchanged
(8978 / `76b109605214d5749d58b834cd3b7897`), but nothing here claims those
were observed. Round 6.2 below supersedes this state entirely, so nothing is
lost by the gap — it is recorded only so this package never implies evidence
that was not actually confirmed.

### 6.2 Round 3 (post-third-change, current — final state)

Re-run after the third CONTEXT DISCIPLINE fix (morning START) was applied —
the **second** `CREATE OR REPLACE` on both functions since the original
apply, so this round is stronger evidence for 020 discipline than round 1
alone (ACL survives REPLACE, confirmed twice, not once).

**A1 — ACL:** both functions still `acl_is_default_public = false`, single
overload each, grantees limited to owner + `service_role` only. No
`authenticated`, no `anon`, no `PUBLIC` row on either function — unchanged
shape from round 1, now confirmed across two REPLACEs.

**A2 — body identity, both bodies changed this round** (unlike round 1→2,
where only morning's body changed — the round-2→3 site-numbering comments
touch evening's body too, since they live inside its `$fn$...$fn$`):

| Function | `prosrc_len` | `prosrc_md5` |
|---|---|---|
| `apply_morning_flow_turn` | 8263 | `fe6cc6c01f10b7e0c4d701ff8dfe66a5` |
| `apply_evening_flow_turn` | 9016 | `08ac80270b431ddf3d94feae219fee2b` |

`morning_start_has_site1_fix = true` (probe for
`context - 'q2_reask' - 'q3_reask';` inside the START branch specifically,
distinguishing it from the same substring appearing in the Q4 branch).
Owner-confirmed narratively, matching the predicted values exactly.

---

## 7. Automated test evidence — LITERAL

**62 new tests across three new files, plus one existing file brought back
into sync (round 2).** `test/migration-022.test.ts` converts the R5 manual
proof into committed, repeatable RPC-level coverage: both Q2 conditional
edges (T-022-03/05), the completion-timing guard in both directions
(submitted_at null-then-set vs. set-same-turn, folded into
T-022-03/04/05), context-merge in both directions (T-022-07 on start,
T-022-08 on complete — the latter goes further than R5e by driving evening to
*full* completion and asserting both markers coexist, which R5e's Part 2
didn't reach), `already_complete` idempotency (T-022-06), `wrong_flow` in
both directions with a resumability continuation after each (T-022-09,
T-022-10), and — added round 2 — **T-022-13**, the reverse-order test that
found the third CONTEXT DISCIPLINE site (§9).

```
✓ test/migration-022.test.ts (13 tests)
   ✓ T-022-01: start — asks Q1, no daily_logs row materialised yet
   ✓ T-022-02: Q1 — writes evening_output + quantities enrichment, advances to Q2
   ✓ T-022-03: Q2="no" — the conditional edge: advances to Q3, does not complete
   ✓ T-022-04: Q3 (miss reason) — completes: writes reason + submitted_at, session resets
   ✓ T-022-05: Q2="yes" — the other conditional edge: completes at step 2, Q3 skipped
   ✓ T-022-06: already_complete — post-completion inbound writes nothing, timestamp frozen
   ✓ T-022-07: context-merge on start — morning_submitted survives evening starting
   ✓ T-022-08: context-merge on complete — both markers coexist after morning AND evening complete
   ✓ T-022-09: wrong_flow — evening RPC during an active morning flow leaves morning untouched and resumable
   ✓ T-022-10: wrong_flow mirror — morning RPC during an active evening flow returns wrong_flow, not idle
   ✓ T-022-11: reask — whitespace-only answer re-asks, no write
   ✓ T-022-12: idle — startFlow:false on an idle session -> idle, no write
   ✓ T-022-13: context-merge REVERSE — evening completes first, then morning; both markers coexist

✓ test/unit/quantities-parser.test.ts (14 tests)
✓ test/unit/yesno-classifier.test.ts (35 tests)
✓ test/unit/morning-dispatch.test.ts (15 tests — round 2: +1 new (Q4 merge
  with pre-existing context), +1 updated (non-morning-active now asserts
  wrong_flow, not the stale idle))
```

T-022-13's own history is itself evidence, not just its final green: run
against the migration with **only** B2 (Q4 merge) applied, it failed —
`expected { morning_submitted: true } to deeply equal { evening_submitted:
true, …(1) }`, `evening_submitted` missing entirely — pinpointing the
third-site bug (§9) before the fix for it existed. Re-run after the third
fix, green with **no change to the test itself**: same file, same
assertion, only the migration underneath it moved. Left red and unmodified
in the interim, per explicit instruction, rather than skipped or weakened.

**Full suite, pinned:**

```
=== PINNED SUITE RUN — migration 022, round 2 (all three CONTEXT DISCIPLINE fixes) ===
commit:  6bbbc598f8dc3f6a2ffcceef6337ea3e2fc46a30
branch:  feat/022-evening-flow-apply-turn
porcelain: ''  <- empty between quotes = clean tree
date:    2026-08-05
sha256(022 migration): f7e1ee6dfe76bfaed27a6af416c8fcaa9c31aa87d924a353bc95206f7b23acfb
sha256(morning.ts):     f8702bf4dbc2d1b3bcebb7b8a48f0c0575df106292cf44749f2c75d7e6196a04
sha256(evening.ts):     7311bd7154f7dccd60a6a0fddc066e3f6ec7660cc07c68a111799d269d7ca10f
==========================================
 Test Files  21 passed (21)
      Tests  232 passed (232)
   Duration  124.12s
```

No regression: `labour-parser.test.ts` (12) and `equipment-parser.test.ts`
(18) re-ran unchanged and green both rounds (§8 explains why they were at
risk in round 1; round 2 touched neither file, `git diff --stat` on both
empty at the round-2 commit too).

---

## 8. Two parser defects — caught empirically, fixed pre-commit (not shipped debt)

While writing `quantities-parser.test.ts`, running real inputs through
`parseQuantities` (not hand-guessing expected output) surfaced two defects in
`quantities.ts` — **brand-new code written this session, never committed**:

1. **Decimal truncation.** `"12.5 cum concrete"` parsed to `quantity: 12`
   with a stray `"."` leaking into `activity`. Cause: the shared
   `splitDigitBoundaries` pattern (borrowed from `labour.ts`/`equipment.ts`)
   inserts a space at every digit↔non-digit boundary, splitting `"12.5"` into
   `"12"`/`"."`/`"5"` before the decimal-aware number regex ever saw it as
   one token — directly contradicting the function's own comment ("Decimals
   are real on site … so they parse rather than truncating").
2. **Ordinal collision.** `"block work 2nd floor 45 sqm"` captured
   `quantity: 2` (from "2nd") instead of the real measurement, `45` — "first
   number in the chunk wins" colliding with a highly plausible real answer
   (floor/level/grid references).

**Fixed before the first commit of this file** (not shipped and documented as
debt): `splitDigitBoundaries` now protects a decimal point sitting between
two digits via lookahead/lookbehind (`quantities.ts:42-47`); a number token
immediately followed by an ordinal suffix token (`st`/`nd`/`rd`/`th`) is
detected post-tokenization and folded into the activity name instead of
competing for the quantity slot (`quantities.ts:49-72`). Both changes are
scoped to `quantities.ts`'s own private copy of `splitDigitBoundaries` —
`labour.ts` and `equipment.ts` each hold independent private copies
(confirmed: `grep -n "function splitDigitBoundaries" lib/whatsapp/flows/parsers/*.ts`
shows three separate definitions, none imported across files) and are
byte-unchanged (`git diff --stat` on both = empty at this commit); their 30
existing tests re-ran green with no edits.

Post-fix, `"12.5 cum concrete"` → `{activity: "concrete", quantity: 12.5,
unit: "cum"}` and `"block work 2nd floor 45 sqm"` → `{activity: "block 2nd
floor", quantity: 45, unit: "sqm"}`. Both fixes are covered by dedicated
tests (`quantities-parser.test.ts`), including generalization beyond "2nd" to
21st/3rd/4th.

**This is deliberately NOT the same class of finding as the equipment
`daily_hire_cost` quirk** (§10) — that one is pre-existing 018-era code,
untouched by this PR, correctly left alone as inherited debt. These two are
new code from this session; per the owner's explicit call, fixing them now
(before anything depends on the current behavior, before any production data
is written against it) is the cheapest this fix will ever be, and shipping a
comment that makes a false claim about code that hasn't landed yet would be
creating debt, not inheriting it. Point in favor of write-tests-first: empirically
testing new parser code against real inputs — not just the happy path used to
build it — caught both before they ever reached test-db or prod.

---

## 9. CONTEXT DISCIPLINE — the third site, found by the reverse-order test

**One rule, four sites, two of them wrong until this round.** The rule: *a
flow's context write strips only that flow's own in-flight counters and
merges everything else — never a bare replace or wipe.*

| Site | Behaviour | Status |
|---|---|---|
| Morning START | `context := '{}'::jsonb` → **fixed to** `context - 'q2_reask' - 'q3_reask'` | **Fixed round 2, third change** |
| Morning Q4 COMPLETE | `context := {'morning_submitted': true}` → **fixed to** `(context - 'q2_reask' - 'q3_reask') \|\| {'morning_submitted': true}` | **Fixed round 2 (B2)** |
| Evening START | `context := context - 'e2_reask'` | Correct by design |
| Evening COMPLETE | `context := (context - 'e2_reask') \|\| {'evening_submitted': true}` | Correct by design |

**Why evening was never wrong.** Morning's two violations are inherited
from 018, where a bare replace/wipe was harmless — morning was the ONLY
flow, so nothing else ever lived in context for a wipe to destroy. Evening's
author had no such history and no single-flow assumption to unlearn:
evening was written INTO the two-flow world this migration creates, so both
its sites obey the rule from their first line. That is the exact trap for
whoever adds a fifth site (Q5, a future flow, anything touching context):
copying the nearest existing line of code instead of the stated rule.

**The review sequence, in order:**

1. **B2 (round 2, first pass)** — the reviewer named the completion site:
   morning's Q4 did a bare `context := {'morning_submitted': true}`, which
   would silently destroy `evening_submitted` if evening had already
   completed earlier the same day. Fixed to merge, mirroring evening's own
   completion. The reviewer's framing, recorded verbatim because it settles
   whether this is "pre-existing, left alone" debt or a fix: *the code
   pre-exists (018 shipped the replace), but the bug is BORN in 022 — under
   018 the replace was unreachable in a way that mattered, because no second
   flow existed to destroy. "Pre-existing, deliberately left alone" doesn't
   hold once a second flow exists to collide with.*

2. **T-022-13 added** — the regression guard for the B2 fix, but built as a
   reverse-order test (evening completes → morning starts → morning
   completes → assert both markers coexist) rather than a test asserting the
   predicted mechanism directly. Run against the **B2-only** migration
   (start branch still wiping), it failed:
   `expected { morning_submitted: true } to deeply equal { evening_submitted:
   true, …(1) }` — `evening_submitted` missing entirely.

3. **Root-caused to a third site B2 never touched.** Morning's START branch
   (`v_session.context := '{}'::jsonb;`) fires before Q4 ever runs and wiped
   `evening_submitted` at the very first action of the reverse sequence — so
   by the time the (correct) Q4 merge ran, there was nothing left to
   preserve. The Q4-only fix was necessary but not sufficient.

4. **Why the targeted fix couldn't have caught this, and the reverse-order
   test did.** A test asserting the *predicted mechanism* — "after morning
   completes, is evening's marker still there?" — goes green the instant
   completion is fixed, regardless of what start does, because completion is
   the last write in that sequence. T-022-13 doesn't assert a mechanism; it
   drives the full realistic sequence and checks only the end state. That
   shape is what exposed the start-branch wipe, three RPC calls before the
   fix anyone was looking at. **This is now recorded as a general testing
   principle, not a 022-specific note — CLAUDE.md §7, "Tests are required,
   not optional": for a state-loss regression, assert the end state of the
   full realistic sequence, not the mechanism the fix targeted.**

5. **T-022-13 left red, unmodified, unskipped** for the entire period this
   was under review — no weakened assertion, no skip, per explicit
   instruction: a red test naming a real defect is the correct state of the
   suite while the fix is undecided.

6. **Third change, reviewer-approved:** `v_session.context := '{}'::jsonb;`
   → `v_session.context := v_session.context - 'q2_reask' - 'q3_reask';` at
   morning's START branch — symmetric with the Q4 fix and with evening's own
   START branch. T-022-13 went green **by this fix alone**, no test edits
   (§7).

**Consequence the fix introduces — restart semantics (flagged, not
resolved here).** Morning's START branch fires on `p_start_flow` AND
`current_flow IS NULL` — it does **not** check `morning_submitted`, before
or after this fix. So a second start trigger on an already-completed day
restarts the flow; that was already true. What changes is only what a
restart does to the marker: under the old wipe, restarting destroyed
`morning_submitted`, and a later inbound before the flow re-completed could
misread `already_complete` as `idle`. Under the fix, the marker survives a
restart — strictly better, but a genuine change to the restart path, not
merely a preservation fix. **Nothing has decided whether a start trigger
should restart an already-completed flow at all.** Recorded as a
DECIDE-BEFORE-CRON-PR item: `docs/design-decisions-beta-feedback.md` §10
(RESTART SEMANTICS), which names the three candidate semantics
(fire-and-start / start-on-reply / refuse-when-submitted) for whichever PR
first wires a real trigger to `p_start_flow`.

**The header rewrite.** The migration file's own header no longer counts
lines changed ("exactly ONE line," then "TWO deliberate changes," both fell
false within two reviewer rounds). It states the rule, the four-site
inventory, and the evening diagnosis once, canonically — every site in the
function bodies carries a `CONTEXT DISCIPLINE, site N of 4` pointer back to
it rather than restating the reasoning. Three patches would have taught
three special cases; one stated invariant teaches why a fifth site must
follow it too.

**`morning.ts` parity, same round.** `MorningOutcome` was missing
`'wrong_flow'` entirely — the RPC has returned it since round 1, but the
TypeScript mirror's outcome union, and `buildMorningReply`'s switch over it,
were five-for-six. The file's own AUTHORITY NOTE says the mirror tracks the
RPC; fixing the type without fixing `dispatchMorningFlow`'s own ELSE branch
(still returning `'idle'`) and its own Q4 completion (still a bare replace)
would have left the mirror claiming a fidelity the code didn't have — so
both were brought into line, and `test/unit/morning-dispatch.test.ts` gained
a merge-specific test (pre-existing `evening_submitted` + unrelated key
survive a morning Q4 completion) and had its stale wrong_flow-as-idle
assertion corrected.

---

## 10. Explicitly out of scope / known follow-ups

Recorded so none of these reads as an oversight.

**R6 (types regeneration) — DEFERRED BY DESIGN, not an unresolved §7
violation.** `npx supabase gen types typescript --linked --schema public`
targets **prod** (`--linked`), and prod does not have 022 applied. Running it
now would either fail to pick up `apply_evening_flow_turn` (types stay stale)
or require applying 022 to prod *before* this package is reviewed — reversing
the intended apply-after-review ordering. `tsc --noEmit` therefore currently
reports 2 errors, both in `evening.ts`, both **solely** because
`types/database.ts` doesn't yet know `apply_evening_flow_turn` exists:

```
lib/whatsapp/flows/evening.ts(278,46): error TS2345: Argument of type '"apply_evening_flow_turn"' is not assignable to parameter of type '"acquire_and_transition_session" | "apply_morning_flow_turn" | "complete_onboarding" | "correct_daily_log" | "drain_next_pending_flow" | "get_user_tenant_id" | "quoco_same_ist_day"'.
lib/whatsapp/flows/evening.ts(298,18): error TS2352: Conversion of type 'boolean' to type '{ outcome: EveningOutcome; current_flow: SessionFlow | null; current_step: number; log_date: string; }' may be a mistake because neither type sufficiently overlaps with the other.
```

Both clear automatically the moment R6 runs post-apply (§11 step F) — no
workaround, no ambient type patch. "Zero TypeScript errors" (§7) is satisfied
*after* R6, and R6 is sequenced deliberately after the prod apply to keep
review-before-apply ordering intact, exactly as the owner decided when this
was raised mid-session. Not a deviation needing tracking; the causality is
stated here so a reviewer isn't left wondering why `tsc` is red.

**`apply_evening_flow_turn` is structurally unreachable on prod today — the
load-bearing argument, and it does NOT depend on an environment variable.**
Corrected mid-review: the reviewer's point was originally relayed as resting
on `ENABLE_TEST_FLOW_TRIGGER`'s prod value, but that's not actually where
the safety comes from. The webhook (`app/api/whatsapp/webhook/route.ts`)
contains **zero calls** to `apply_evening_flow_turn` — not gated by an env
var, simply absent. Pinned, not asserted:

```
$ grep -n "apply_evening_flow_turn\|applyEveningFlowTurn" app/api/whatsapp/webhook/route.ts
$ echo "exit: $?"
exit: 1

$ grep -rn "apply_evening_flow_turn\|applyEveningFlowTurn" app/
$ echo "exit: $?"
exit: 1
```

No match, exit code 1, either way — the code path to start or advance an
evening flow via the deployed webhook does not exist yet, on any
environment running this commit, env var or no env var. So `current_flow`
can never become `'evening'` on prod today, and the `wrong_flow` branches in
both RPCs are currently unreachable there by construction, not by
configuration. `ENABLE_TEST_FLOW_TRIGGER`'s value is real but *separate* and
**not load-bearing for this claim** — it only gates whether the webhook can
force-start **morning**, and even set to `'true'` in prod it still could not
reach evening. Kept as its own standing checklist item below because the
reviewer is right that it has never been affirmatively confirmed in any
review package, and — his note — **it will become load-bearing the day
webhook wiring lands**, at which point this whole argument needs re-deriving
from the new code, not inherited from here.

- [ ] **Standing checklist item (independent of this PR):** confirm
  `ENABLE_TEST_FLOW_TRIGGER` is absent (or not `'true'`) in Vercel → Project
  → Settings → Environment Variables → Production. `test-trigger.ts`'s own
  comment already states it "MUST NOT be set in production Vercel"; this has
  never been observed and pinned in a review package before.

**Webhook-wiring — named future deliverable, not resolved by this PR.**
`apply_evening_flow_turn` has no caller anywhere in `app/` yet (same grep as
above). Whoever wires a cron or the webhook to call it must implement the
retry-once contract the migration's own header describes ("call the OTHER
rpc exactly once. Bounded by construction: one retry, never a loop") —
concretely:

1. Call the RPC matching the currently-known `current_flow` (or morning, if
   idle/unknown).
2. If the result is `'wrong_flow'`, call the **other** RPC exactly once.
3. **The edge that was previously undefined, now specified:** if that second
   call **also** returns `'wrong_flow'`, the flow genuinely moved twice
   within the span of one turn — vanishingly rare (it requires two
   completions/starts to race the same inbound), but not impossible. Reply
   with a fixed message (e.g. "Sorry, something interrupted your check-in —
   please resend your last message.") and **stop** — never a third call,
   never throw, never silence. Silence is the exact failure mode
   `wrong_flow` exists to prevent (the Twilio SID is already consumed by
   this point); a third call risks a real loop if the race is somehow
   sustained; a thrown error surfaces as a 500 the engineer never sees.
   Telling the engineer something and stopping is the only response that is
   safe under all three failure readings.

This is also where `ENABLE_TEST_FLOW_TRIGGER`'s value becomes load-bearing
(above) — the PR that implements this is what first makes `current_flow =
'evening'` reachable on prod, and it inherits the restart-semantics decision
too (§9, `design-decisions-beta-feedback.md` §10).

**`service_role`'s real caller path — unproven by this rehearsal.** The SQL
Editor (used for §3/§6) connects as `postgres` (table/function owner), which
has EXECUTE by ownership — it never exercises the `service_role` grant path
at all. `apply_evening_flow_turn` needs the same proof `apply_morning_flow_turn`
already has: a real webhook-triggered call end-to-end on prod (HMAC validate →
SID dedup → engineer resolution → `service_role` RPC → DB write), the way
020's Step 6 closed for morning (`020-review-package.md` §8 Step 6, a full
Q1–Q4 flow through the real webhook). This one genuinely waits on the
webhook-wiring deliverable above — there is no way to trigger evening via
the real webhook until that lands. Scheduled for the prod-apply runbook
below, §11 step E — not yet executed.

**Equipment `daily_hire_cost` quirk — pre-existing, unrelated to 022, left
alone, now tracked as a named debt entry.** Visible in §4's literal capture
for engineer C: `"1 JCB, 2 mixers"` parsed to `daily_hire_cost: 1` /
`daily_hire_cost: 2` with `count: null` on both — `equipment.ts`'s
`parseChunk` (018-era, untouched by this PR) reads the first number in a
chunk as a daily hire *rate*, not a count (`equipment.ts:50-54`, by design —
"the field gives rates ('JCB 1500'), not counts"). Correctly out of scope
for this PR: unlike the two `quantities.ts` defects in §8, this is shipped
behavior inherited from a prior migration, and touching it here would be
scope creep into parser-correctness work this PR doesn't own. The consumer
risk — a **count sitting in a money-semantic field**, with two named future
consumers (`design-decisions-beta-feedback.md` §6's costing calc and
`bot-flows.md`'s DPR idle-cost formula, both of which would compute a
currency figure from what is sometimes actually a count) — is now recorded
as its own debt-register entry: **CLAUDE.md §10, "EQUIPMENT
`daily_hire_cost`"**. Not restated here; read the full entry there.

---

## 11. PROD apply — runbook (NOT YET EXECUTED)

Instance of `docs/migration-runbook-template.md`. Strict alternation; owner
confirms at each step. Point the SQL Editor at **prod** (`jvxwqignooseazzmwhvl`)
and confirm the project ref before any write step.

**A. PITR observation** — required before any prod apply per CLAUDE.md §0.
Observe the restore window directly (dashboard), not by trusting a prior
"enabled" note.

**B. Pre-apply state probe (read-only).** Confirm `apply_evening_flow_turn`
absent on prod; confirm `apply_morning_flow_turn`'s current `prosrc` still
matches 018 (not already 022) — the §6.2 A2 query, re-run on prod.

**C. Apply (write).** Fresh tab, full paste of the pinned body:
`git show 6bbbc59:supabase/migrations/022_evening_flow_apply_turn.sql | pbcopy`
(clipboard hash must equal `f7e1ee6d…23acfb`). Deselect before running.

**D. Post-apply probes (read-only).** Re-run §6.2's A1/A2 queries on prod;
assert the same ACL shape, `body_has_wrong_flow = true` for both functions,
and `morning_start_has_site1_fix = true`. Re-run the §4-shape queries
against a throwaway/disposable phone, NOT the ZZ Smoke fixtures (those were
deliberately deleted, R5f) — never seed permanent prod test data without the
standing artifact-disposal discipline (020 precedent: deactivation only,
never delete a row with an irreversible FK).

**E. Real webhook-triggered `apply_evening_flow_turn` on PROD.** Blocked on
the webhook-wiring deliverable, §10 — cannot execute until that lands
(nothing can reach evening's RPC via the real webhook before then). Tracked
here so the runbook doesn't silently skip it once wiring does land: same
discipline as 020 Step 6, a real inbound through the production webhook,
`service_role` end-to-end, a disposable/deactivated test engineer per the
standing artifact discipline.

**F. Post-apply types regen (R6).** `npx supabase gen types typescript
--linked --schema public`; expect `apply_evening_flow_turn` to appear in
`types/database.ts`'s `Database['public']['Functions']`; commit the diff;
confirm `tsc --noEmit` goes clean (both §10 errors should disappear).

**G. `schema.md` / CLAUDE.md §10.** Update the 022 entry from "pending" to
applied only after C+D confirm — no "applied" line asserted before it's true.
(This is CLAUDE.md's own §10, a different document's numbering from this
package's §10/§11 — not to be confused with either.)

**H. Merge ordering — explicit, because reversing it breaks the production
build.** The PR must **not** merge before F confirms. Correct order:
**apply (C) → R6 regen + commit (F) → CI/build green → merge.** The reason
this needs to be a named step rather than assumed: PR #20's Vercel preview
is **currently red**, and it's red for the exact known cause in §10 —
`types/database.ts` doesn't know `apply_evening_flow_turn` exists yet, so
the same two `tsc` errors that show locally fail the preview build.
Merging before F would put that same failure on `main`'s production build,
not just a preview. The red preview is expected and explained, not a
separate problem to chase — it clears at F, and F cannot run before C. The
PR body carries a line stating this explicitly, so it isn't mistaken for an
unrelated CI break by anyone reviewing the checks tab.

---

## 12. Summary

| | |
|---|---|
| Risk | Moderate — new parameter-trusting SECURITY DEFINER function (hardened inline), behavioral changes to an existing hot-path RPC (wrong_flow outcome + CONTEXT DISCIPLINE, both rounds) |
| Reversibility | DOWN block restores 018's morning body + drops the evening function; no data-mutating statement to reverse |
| Evidence | R5 rehearsal (narrative-confirmed, cross-checked against one literal final-state capture, §5) + 62 new automated tests + 1 file brought into sync (literal, §7) + ACL/body catalog check, 2 rounds (narrative-confirmed, §6) |
| Two parser defects (quantities.ts) | Found and fixed pre-commit during test authoring (§8) — not shipped as debt |
| Third-site CONTEXT DISCIPLINE defect | Found by the reverse-order test T-022-13, not named by the original review; fixed, reviewer-approved (§9) |
| Restart-semantics consequence | Flagged, not resolved — DECIDE-BEFORE-CRON-PR in `design-decisions-beta-feedback.md` §10 (§9) |
| Equipment `daily_hire_cost` quirk | Pre-existing 018-era debt, out of scope for this PR, now tracked as its own CLAUDE.md §10 entry (§10) |
| Known follow-ups | R6 types regen (deferred by design, §10); structural evening-unreachability pinned by grep, `ENABLE_TEST_FLOW_TRIGGER` prod value as a separate standing checklist item (§10); webhook-wiring deliverable with the double-wrong_flow edge defined (§10); `service_role` real-webhook proof, blocked on webhook-wiring (§11 step E) |
| Test suite | 232/232, zero regressions, pinned to commit `6bbbc59` |
| `tsc --noEmit` | 2 errors, both explained and expected per §10 — resolves automatically after R6 |
| Merge ordering | apply → R6 regen + commit → CI green → merge (§11 step H) — do not merge on a red preview without confirming the cause matches §10 |
| Prod status | **NOT APPLIED.** Runbook ready (§11); requires owner go-ahead |
