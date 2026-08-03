# Migration 022 — evening check-in flow Pass 1 (`apply_evening_flow_turn`) — review package

Evening flow's first pass: Q1 (work completed + quantities enrichment), Q2
(plan met? — parsed yes/no with a conditional branch), Q3 (miss reason,
**only** when Q2 = No). Ships alongside a one-line change to
`apply_morning_flow_turn`'s ELSE branch — it now returns `'wrong_flow'`
instead of `'idle'` when a different flow is active, so a mis-routed turn is
reported to the webhook instead of silently swallowed after its Twilio SID is
already consumed.

- Migration: `supabase/migrations/022_evening_flow_apply_turn.sql`
- Flow module: `lib/whatsapp/flows/evening.ts`
- Parsers: `lib/whatsapp/flows/parsers/quantities.ts` (new),
  `lib/whatsapp/flows/parsers/lexicon.ts` (evening additions —
  `canonicalUnit`, `QUANTITY_STOPWORDS`, `classifyYesNo`)
- Tests: `test/migration-022.test.ts` (12), `test/unit/quantities-parser.test.ts`
  (14), `test/unit/yesno-classifier.test.ts` (35)

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts are pinned to source, never paraphrased.

| Artifact | Pin |
|---|---|
| Commit | `88d60ca581b96c699a8c0fc1c18386635ea784ad` |
| Branch | `feat/022-evening-flow-apply-turn` |
| `git status --porcelain` at that commit | `''` (empty — clean tree) |
| Migration file | `git show 88d60ca:supabase/migrations/022_evening_flow_apply_turn.sql` — sha256 `71f9af87dce03bd319ffd02574717c7f257dbc990269e0602e662bd6e6ecece9` |
| `evening.ts` | sha256 `7311bd7154f7dccd60a6a0fddc066e3f6ec7660cc07c68a111799d269d7ca10f` |
| `quantities.ts` | sha256 `450e3c73cb541f2120c6c919446442dec54e089766d52fcea531f08b9c82044b` |
| `lexicon.ts` | sha256 `5ef5c646e6697ae45a6b6d359ed4c840acd1812e8c7e3c25c02a5e4ab6c938d4` |
| `test/helpers/db.ts` | sha256 `fe0a40edc35cfa83629c44decb2276f4a604ca90d7cff8ec366c49dd17af12f6` |
| `test/migration-022.test.ts` | sha256 `ab1964b36571cb470a7061f1b780bad8b0125c133e44596ffa958b8e66b84433` |
| `test/unit/quantities-parser.test.ts` | sha256 `eaf52186a28da0dc8d6dc85c9b99ead72977b61df24c99b5b107d2dc574addcb` |

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
- **§6 (ACL + function-body catalog check) — NARRATIVE-CONFIRMED, not raw.**
  The assistant authored the catalog queries with predicted expected values;
  the owner ran them and confirmed the results in prose, not by re-pasting
  rows. Queries are pinned and reproducible; the specific row values in this
  package are the owner's confirmation, not a raw capture.
- **§7 (automated test suite) — LITERAL.** Re-run directly against this pinned
  commit while drafting this package; output captured below unedited.

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

**Context discipline — MERGE, never REPLACE.** Morning's own completion does
a full `context := jsonb_build_object(...)` replace (018's shipped behavior,
deliberately left alone). Evening cannot copy that: it would wipe
`morning_submitted` and a later inbound would misread `already_complete` as
`idle`. Evening's start clears only its own `e2_reask` key; its completion
merges `evening_submitted: true` in and strips only its own counter.

**`apply_morning_flow_turn`'s one-line change** — the final ELSE (a different
flow, i.e. evening, is active) now returns `'wrong_flow'` instead of 018's
`'idle'`, so the webhook can retry against the correct RPC instead of
silently dropping the engineer's answer after the Twilio SID is already
consumed.

**EXECUTE hardening applied inline, not as a follow-up.** `apply_evening_flow_turn`
is a new parameter-trusting SECURITY DEFINER function (`p_user_id`/`p_tenant_id`/
`p_project_id` all caller-supplied, no `auth.uid()` derivation) — exactly the
class 020 closed for the other three. 022 REVOKEs PUBLIC/anon/authenticated and
GRANTs only `service_role` on both functions in the same transaction that
creates it, rather than shipping open and hardening later.

---

## 3. R5 rehearsal — narrative-confirmed, turn-by-turn (test-db)

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

---

## 7. Automated test evidence — LITERAL

**61 new tests, three files.** `test/migration-022.test.ts` converts the R5
manual proof into committed, repeatable RPC-level coverage: both Q2
conditional edges (T-022-03/05), the completion-timing guard in both
directions (submitted_at null-then-set vs. set-same-turn, folded into
T-022-03/04/05), context-merge in both directions (T-022-07 on start,
T-022-08 on complete — the latter goes further than R5e by driving evening to
*full* completion and asserting both markers coexist, which R5e's Part 2
didn't reach), `already_complete` idempotency (T-022-06), and `wrong_flow` in
both directions with a resumability continuation after each (T-022-09,
T-022-10).

```
✓ test/migration-022.test.ts (12 tests)
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

✓ test/unit/quantities-parser.test.ts (14 tests)
✓ test/unit/yesno-classifier.test.ts (35 tests)
```

**Full suite, pinned:**

```
=== PINNED SUITE RUN — migration 022 ===
commit:  88d60ca581b96c699a8c0fc1c18386635ea784ad
branch:  feat/022-evening-flow-apply-turn
porcelain: ''  <- empty between quotes = clean tree
date:    2026-08-03T11:42:11Z
sha256(022 migration): 71f9af87dce03bd319ffd02574717c7f257dbc990269e0602e662bd6e6ecece9
sha256(evening.ts):    7311bd7154f7dccd60a6a0fddc066e3f6ec7660cc07c68a111799d269d7ca10f
sha256(quantities.ts): 450e3c73cb541f2120c6c919446442dec54e089766d52fcea531f08b9c82044b
==========================================
 Test Files  21 passed (21)
      Tests  230 passed (230)
   Duration  127.06s
```

No regression: `labour-parser.test.ts` (12) and `equipment-parser.test.ts`
(18) re-ran unchanged and green (§8 explains why they were at risk).

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
`daily_hire_cost` quirk** (§9) — that one is pre-existing 018-era code,
untouched by this PR, correctly left alone as inherited debt. These two are
new code from this session; per the owner's explicit call, fixing them now
(before anything depends on the current behavior, before any production data
is written against it) is the cheapest this fix will ever be, and shipping a
comment that makes a false claim about code that hasn't landed yet would be
creating debt, not inheriting it. Point in favor of write-tests-first: empirically
testing new parser code against real inputs — not just the happy path used to
build it — caught both before they ever reached test-db or prod.

---

## 9. Explicitly out of scope / known follow-ups

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

Both clear automatically the moment R6 runs post-apply (§10 step F) — no
workaround, no ambient type patch. "Zero TypeScript errors" (§7) is satisfied
*after* R6, and R6 is sequenced deliberately after the prod apply to keep
review-before-apply ordering intact, exactly as the owner decided when this
was raised mid-session. Not a deviation needing tracking; the causality is
stated here so a reviewer isn't left wondering why `tsc` is red.

**`service_role`'s real caller path — unproven by this rehearsal.** The SQL
Editor (used for §3/§6) connects as `postgres` (table/function owner), which
has EXECUTE by ownership — it never exercises the `service_role` grant path
at all. `apply_evening_flow_turn` needs the same proof `apply_morning_flow_turn`
already has: a real webhook-triggered call end-to-end on prod (HMAC validate →
SID dedup → engineer resolution → `service_role` RPC → DB write), the way
020's Step 6 closed for morning (`020-review-package.md` §8 Step 6, a full
Q1–Q4 flow through the real webhook). Scheduled for the prod-apply runbook
below, §10 step E — not yet executed.

**Equipment `daily_hire_cost` quirk — pre-existing, unrelated to 022, left
alone.** Visible in §4's literal capture for engineer C: `"1 JCB, 2 mixers"`
parsed to `daily_hire_cost: 1` / `daily_hire_cost: 2` with `count: null` on
both — `equipment.ts`'s `parseChunk` (018-era, untouched by this PR) reads
the first number in a chunk as a daily hire *rate*, not a count
(`equipment.ts:50-54`, by design — "the field gives rates ('JCB 1500'), not
counts"). Correctly out of scope for this PR: unlike the two quantities.ts
defects in §8, this is shipped behavior inherited from a prior migration, and
touching it here would be scope creep into parser-correctness work this PR
doesn't own.

---

## 10. PROD apply — runbook (NOT YET EXECUTED)

Instance of `docs/migration-runbook-template.md`. Strict alternation; owner
confirms at each step. Point the SQL Editor at **prod** (`jvxwqignooseazzmwhvl`)
and confirm the project ref before any write step.

**A. PITR observation** — required before any prod apply per CLAUDE.md §0.
Observe the restore window directly (dashboard), not by trusting a prior
"enabled" note.

**B. Pre-apply state probe (read-only).** Confirm `apply_evening_flow_turn`
absent on prod; confirm `apply_morning_flow_turn`'s current `prosrc` still
matches 018 (not already 022) — the §6 A2 queries, re-run on prod.

**C. Apply (write).** Fresh tab, full paste of the pinned body:
`git show 88d60ca:supabase/migrations/022_evening_flow_apply_turn.sql | pbcopy`
(clipboard hash must equal `71f9af87…ecece9`). Deselect before running.

**D. Post-apply probes (read-only).** Re-run §6's A1/A2 queries on prod;
assert the same ACL shape and `body_has_wrong_flow = true` for both
functions. Re-run the §4-shape queries against a throwaway/disposable phone,
NOT the ZZ Smoke fixtures (those were deliberately deleted, R5f) — never seed
permanent prod test data without the standing artifact-disposal discipline
(020 precedent: deactivation only, never delete a row with an irreversible
FK).

**E. Real webhook-triggered `apply_evening_flow_turn` on PROD.** Closes the
gap flagged in §9. Same discipline as 020 Step 6: a real inbound through the
production webhook, `service_role` end-to-end, a disposable/deactivated test
engineer per the standing artifact discipline.

**F. Post-apply types regen (R6).** `npx supabase gen types typescript
--linked --schema public`; expect `apply_evening_flow_turn` to appear in
`types/database.ts`'s `Database['public']['Functions']`; commit the diff;
confirm `tsc --noEmit` goes clean (both §9 errors should disappear).

**G. `schema.md` / CLAUDE.md §10.** Update the 022 entry from "pending" to
applied only after C+D confirm — no "applied" line asserted before it's true.

---

## 11. Summary

| | |
|---|---|
| Risk | Moderate — new parameter-trusting SECURITY DEFINER function (hardened inline), one-line behavioral change to an existing hot-path RPC |
| Reversibility | DOWN block restores 018's morning body + drops the evening function; no data-mutating statement to reverse |
| Evidence | R5 rehearsal (narrative-confirmed, cross-checked against one literal final-state capture, §5) + 61 new automated tests (literal, §7) + ACL/body catalog check (narrative-confirmed, §6) |
| Two parser defects | Found and fixed pre-commit during test authoring (§8) — not shipped as debt |
| Known follow-ups | R6 types regen (deferred by design, §9); `service_role` real-webhook proof (deferred to prod runbook §10 step E) |
| Test suite | 230/230, zero regressions, pinned to commit `88d60ca` |
| `tsc --noEmit` | 2 errors, both explained and expected per §9 — resolves automatically after R6 |
| Prod status | **NOT APPLIED.** Runbook ready (§10); requires owner go-ahead |
