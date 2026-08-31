# Migration 035 — evening flow restructuring + morning §42 — external review package

Companion to `docs/plans/evening-flow-restructuring-scope.md` (18 sections,
one reviewer SCOPE-APPROVED round already folded in). That document is the
scope/design half, already reviewed and approved; this one is the SQL round
— the actual RPC bodies, the disposable-scaffold evidence, the executed
rollback, and the apply runbook. Not a re-argument of scope.

**Status: WRITTEN, NOT REVIEWED, NOT APPLIED ANYWHERE.** No PR opened yet.
Branch `worktree-evening-flow-plan-commit`, pushed to `origin`, not merged.

## 0. Repo-state header

- Branch HEAD: `185ac6b` (`worktree-evening-flow-plan-commit`, pushed to
  `origin`).
- `origin/main`: `b659d81`. This branch is fully caught up to that commit
  (0 commits behind) plus its own 4 commits on top (plan, findings fold-in,
  number correction, SQL + scaffold evidence, the reservation fix this
  package's own §-checking round required — see §-note below).
- `supabase migration list --linked` (test-db, `exfccwlrhoutkgrlikod`),
  captured fresh for this package, not carried over from an earlier round:
  ```
  local/remote agree through every entry: 001-007, 011-025, 027-033.
  {"local":"","remote":"034"} -- 034 is ledgered on test-db (rehearsed,
  per docs/reviews/034-apply-record.md) but its file lives only in
  docs/reviews/034_owner_email_delivery.sql, never moved into
  supabase/migrations/ -- a pre-existing gap, not introduced by this
  migration, named in the plan's own §-note at authoring time.
  ```
  **035 is NOT on this list at all** — genuinely unapplied anywhere,
  consistent with this package's own status line.
- Last runbook executed: migration 034's production apply
  (`docs/reviews/034-apply-record.md`, 2026-08-31, same day as this
  package — SQL Editor, by hand, ledger-repaired same session per that
  record's own §2).
- **Migration-lint checked against this exact branch, for real, before this
  package was written** — see §-note immediately below; not asserted from
  memory or from the plan's own text.

### 0a. Migration-lint reservation check — run for real, not reasoned about

Before writing this package, the plan's own history was checked against
`PR #148`'s held-migration-reservation-required rule (merged to `main`
2026-08-31, same day this migration was drafted):

1. **Reconstructed the actual collision this session almost shipped.** The
   scoping plan originally carried "034" as this migration's working
   number before self-correcting to 035 later the same day (migration 034
   turned out to be a real, unrelated, already-applied owner-email
   change). A file named `docs/reviews/034_evening_flow_restructuring.sql`
   was reconstructed (this migration's real content, under the stale
   number) in a disposable worktree checked out from `origin/main`, placed
   alongside the real `docs/reviews/034_owner_email_delivery.sql`, and the
   lint was run for real: **RED, exit code 1**, two violations —
   `unique-migration-prefix` (both files flagged for sharing prefix 034)
   and `held-migration-reservation-required` (`reservation-mismatch-034` —
   the existing reservation's `claimedBy` points at the real file, not the
   reconstructed one). **The rule catches this incident class cleanly.**
2. **Important asymmetry, stated precisely so it isn't overclaimed:** the
   actual mistake THIS session made was never a `.sql` file — "034" was
   only ever a number in the scoping plan's own prose (a `.md` file). The
   lint scans `docs/reviews/*.sql` matching `^\d+_.*\.sql$`; a markdown
   plan referencing a wrong number in prose is outside its scan surface by
   construction, no matter how the rule is tuned. **The tool would not
   literally have caught this session's own mistake, because that mistake
   never took the shape the tool watches for — but it robustly catches the
   shape the reviewer named (a real held file colliding with a taken
   number), which is the more important fact for anyone hitting the next
   instance of this class.**
3. **That same test run surfaced a second, live problem**: this branch's
   REAL `docs/reviews/035_evening_flow_restructuring.sql` was itself
   `unreserved-035` — the reservation manifest had NOT been updated when
   the number was corrected from 034 to 035 earlier. **Fixed in commit
   `185ac6b`** (this branch's current HEAD), verified clean afterward
   (`migration-lint: clean. 86 known violation(s), all exempted.`). Recorded
   in the reservation entry's own `note` field that it was added only after
   being caught by the tool, not proactively — see
   `scripts/migration-number-reservations.json`.

---

## 1. The functions in full, and the byte-identical signature proof

Full bodies: `docs/reviews/035_evening_flow_restructuring.sql` (this
migration) and `docs/reviews/035-rollback.sql` (the exact inverse). Not
reproduced a third time in this document — read the file directly, per
this project's own artifact-provenance discipline (pin the source, don't
retype it).

**Signature proof, done two ways, not one:**

1. **Textual diff against the live source files**, done before either
   `CREATE OR REPLACE` statement was written:
   - `apply_evening_flow_turn`: `supabase/migrations/
     025_evening_productivity_reconciliation.sql:147-158`'s parameter list
     copied verbatim into `035`'s own declaration — 10 params, same names,
     same types, same defaults, same order.
   - `apply_morning_flow_turn`: `supabase/migrations/
     030_morning_flow_attendance.sql:325-338`'s parameter list copied
     verbatim — 12 params, same treatment.
2. **Live confirmation against a real Postgres instance** (§8's scaffold,
   captured BEFORE `035` was applied to it):
   ```
   apply_evening_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid,
     p_project_id uuid, p_message text, p_start_flow boolean,
     p_parse jsonb DEFAULT NULL::jsonb, p_parse_ok jsonb DEFAULT NULL::jsonb,
     p_now timestamp with time zone DEFAULT now(),
     p_test_sleep_ms integer DEFAULT NULL::integer)

   apply_morning_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid,
     p_project_id uuid, p_message text, p_start_flow boolean,
     p_manpower jsonb DEFAULT NULL::jsonb, p_manpower_ok boolean DEFAULT NULL::boolean,
     p_equipment jsonb DEFAULT NULL::jsonb, p_equipment_ok boolean DEFAULT NULL::boolean,
     p_now timestamp with time zone DEFAULT now(),
     p_test_sleep_ms integer DEFAULT NULL::integer)
   ```
   Read via `\df` against the scaffold's loaded test-db dump, matching
   `035`'s own `CREATE OR REPLACE` argument lists exactly. **No overload
   risk** — `CREATE OR REPLACE` genuinely replaces both functions, per the
   030-first-draft/CLAUDE.md §0 lesson this project already learned once.

---

## 2. CLAUDE.md §0 gating assessment

**Trips condition (a) on BOTH functions, not one.**
- `apply_evening_flow_turn`: full branch-structure rewrite, beyond any
  doubt.
- `apply_morning_flow_turn`: **correction made mid-session, recorded in
  the plan (§15(e))** — this was first assumed to be untouched (matching
  §33(a)'s equipment finding, where the morning RPC genuinely needs no SQL
  change). Verified directly against `030`'s live body instead of
  assuming the same held for manpower: the `v_col = 'manpower'` branch
  does a per-element `jsonb_build_object` reshape
  (`030:592-604`, `trade`/`count` reconstructed from each `by_trade`
  element), which would silently drop an added `matched` key rather than
  pass it through. That branch genuinely changes — condition (a) trips on
  this function too, independently.

**Full external review package required, no judgment call available** —
already true even under the earlier, since-corrected belief that only one
RPC changed (per CLAUDE.md's "if ANY migration in the PR trips a trigger,
the WHOLE PR needs the package" rule); now doubly true since both do.

**Condition (b)** (grants/RLS on an existing object) does **not** trip —
no grant or RLS policy changes for either function (both re-assert their
existing EXECUTE grant, unchanged, belt-and-braces per every prior
migration's own convention) or for `daily_logs` (§7 below — the two new
columns inherit the table's existing RLS policies and grants; nothing
column-specific is added or removed at the RLS layer).

---

## 3. Branch map — current vs. target, and what MATCH TIERS removal removes

Full table already in the plan (§2); restated here only for the
consequence that matters to a reviewer reading SQL, not re-derived:

**Evening goes from 6 steps (one conditional branch: "plan met?") to 5
steps (zero conditional branches beyond the pre-existing equipment
auto-skip).** The retired MATCH TIERS apparatus
(`025:387-531`) — `v_claimed`, `v_chunk_morning_idx`, `v_chunk_confidence`,
the three-tier label/canonical-type/positional matching loop, the
1-indexed/0-indexed inconsistency the file's own comments flag as a live
misjoin risk — is **gone entirely** from `035`'s Evening Q4 branch. It is
replaced by a single `SELECT SUM(...) ... WHERE elem->>'type' = v_reply_type`
per reply item. This is not a simplification of the old algorithm; it is a
different algorithm, made possible only because Decision 1 (the plan's
§6/§13) removed the thing MATCH TIERS existed to solve — matching a reply
chunk back to ONE SPECIFIC machine. A type-level aggregate has no
individual machines to distinguish, so there is nothing left for a
positional/label system to resolve.

**Reask key changes:** `e4_headcount` (the old two-part Q4 handoff) is
gone — no replacement, since the new Q2 is a single step. `e5_reask`/
`e6_reask` (old) become `e3_reask`/`e4_reask` (new), attached to the steps
their logic now lives at, same renaming convention `030` already used for
morning's own `q2_reask`→`q3_reask`.

---

## 4. §42's matched capture at all three coupled sites

**Site 1 — the TS parser (`parseLabourCount`, `lib/whatsapp/flows/
parsers/labour.ts`). NOT BUILT. Pending** (§11 below has the full list).
This SQL file's header states explicitly what shape it assumes:
`{trade, planned_count, matched}` per `by_trade` element, `matched` true
when `canonicalTrade` resolved the token, false when the raw token
survives unmatched instead of being dropped (today's live behavior, per
`labour.ts:47-58`: `if (trade) by_trade.push(...)` — an unmatched token
contributes to the total but never reaches `by_trade` at all).

**Site 2 — `apply_morning_flow_turn`'s `v_col = 'manpower'` reshape. BUILT
and scaffold-verified.** `035_evening_flow_restructuring.sql`'s only
edited branch:
```sql
jsonb_build_object(
  'trade',   t->>'trade',
  'count',   (t->>'planned_count')::int,
  'matched', COALESCE((t->>'matched')::boolean, true)
)
```
`COALESCE(..., true)` is deliberate, not a guess: every `by_trade` element
this function has ever received, on every call before this migration, WAS
a matched trade (the pre-migration parser never pushed an unmatched one at
all) — so a caller not yet updated to emit `matched` (mid-deploy, or a
stale client) degrades to "assume matched," the historically-accurate
default, not "assume worst." Scaffold-verified BOTH ways (§8): a call
supplying `matched` explicitly, and a call omitting the key entirely.

**Site 3 — `dispatchMorningFlow` (the TS mirror, `lib/whatsapp/flows/
morning.ts`). NOT BUILT. Pending.** Per the file's own header comment
(`030:583-587`, restated in `035`'s SQL comments), this mirror performs
the IDENTICAL `planned_count`→`count` reshape independently, in TypeScript,
for tests and documentation — not authoritative, but real, dedicated,
15-test-covered code (unlike `dispatchEveningFlow`, which this session
decided to delete rather than maintain a mirror for, §1 of the plan). This
mirror needs the identical `matched` addition, in lockstep with Site 2, or
it silently diverges from the RPC it claims to mirror. Named as its own
line item in §11 (Pending) below, not folded into "TypeScript work" as an
undifferentiated blob.

---

## 5. The plausibility flag — captured, marked, never re-asked

**Ruling (review round, this session): a FLAG, never a GATE.** Above 24
hours × `count` for a given equipment type, the reported `hours_used` is
still stored verbatim, marked `implausible: true`, and rendered — never
rejected, never converted into a reask trigger. This is the direct fix for
the 2026-08-31 incident's actual failure sequence (reject the arithmetically-
impossible answer, explain nothing, then on budget exhaustion convert
silence into an unflagged, empty acceptance) — a flag commits none of the
three sins in that sequence. Same shape as `attendance_defaulted`
(`030:163,353,448,525,551-556`): evidence captured at write, judgment
rendered to the reader, never enforced by the system.

**Scaffold evidence (§8), not hypothetical:** the disposable scaffold's
test run seeded exactly this case — morning listed 2 JCBs
(`{"type":"jcb","count":2,...}`), evening reported "JCB used 50 hours."
`50 > 24 × 2 = 48`. The stored row:
```json
{"raw": "JCB used 50 hours", "type": "jcb", "matched": true,
 "hours_used": 50, "implausible": true}
```
`hours_used: 50` is preserved exactly as reported — not clamped, not
nulled, not rejected. `implausible: true` is the only consequence. The
turn advanced normally (`outcome: "advance"`, current_step moved to 5) —
no reask fired, confirming the "never a gate" half of the ruling was
actually exercised, not just written into a comment.

**NULL, not false, when the count is unknown:** the same test run's
`borewell_rig` item (an equipment keyword `morning_equipment` never
listed) came back `"implausible": null`, not `false` — SQL confirms
"nothing to check the plausibility bound against" is a different claim
from "checked and found plausible," per the migration's own `CASE WHEN
v_morning_count_for_type IS NULL THEN NULL` branch.

---

## 6. The one-time session sweep — why evening needs it and morning did not

**Not a new function** — a plain `UPDATE` statement inside this
migration's own transaction (`035_evening_flow_restructuring.sql`, STEP
3), run once, at apply time. Deliberately NOT modeled on migration 033's
recurring cron sweep (`sweep_stale_morning_sessions`, called every tick
from `morningCutoff` onward) — that function's entire design (per-step
data preservation, the B1 prior-day-backlog fix, the missing-row guard)
exists to serve a RECURRING daily cutoff with well-understood, STABLE
step semantics. A migration-deploy sweep faces the opposite problem: the
step semantics THEMSELVES are what's changing mid-flight, so there is no
safe way to "complete" a caught session's current step on the engineer's
behalf — the simplest correct behavior is 033's own step-1 precedent
(unanswered → no write, session just closes), applied uniformly regardless
of which step a session is caught on.

**Why evening specifically needs this, and morning's own history does
not excuse skipping it:** migration 033 built a cutoff sweep for morning
only. No equivalent has ever existed for evening — `eveningClose` (19:45
IST) closes an unsubmitted evening day at DPR-generation READ time, never
by touching `whatsapp_sessions`. A session abandoned mid-evening-flow
relies solely on BOT-07's lazy next-IST-day wipe, which is not a
deploy-time guarantee — it fires on the ENGINEER's next inbound message,
whenever that happens to be, not on a schedule this migration can rely on.
Read-only checks against prod immediately before this migration was
written showed zero sessions in either flow (plan §8) — but that is a
snapshot, not a standing guarantee the way morning's 033-backed cutoff is.

**Scaffold evidence:** one session was deliberately seeded mid-flow
(`current_flow='evening', current_step=3, context={"e3_reask":1}`) and the
sweep statement, run standalone, reset it to idle with an empty context.
**More informative than the seeded case**: the same statement, run after
the test suite's other flow-exercise calls, affected **3 rows**, not 1 —
two morning sessions genuinely left mid-flow by the test script's own
incomplete call sequences were caught by the identical `WHERE current_flow
IN ('morning','evening')` clause, unprompted. The sweep does not
distinguish "deliberately seeded" from "accidentally accumulated" — it
catches both, which is exactly the property being verified.

---

## 7. Grants and RLS evidence on the two new columns

**No new grant statements needed for RLS itself.** `daily_logs`'s existing
row-level policies (`supabase/migrations/002_rls_policies.sql:172-194` —
SELECT: tenant-scoped; INSERT: own `engineer_id`; UPDATE: own row or
pm/admin/qs) operate at the ROW level, not per-column — `evening_manpower`
and `evening_idle_hours` are covered by these policies automatically, the
moment the columns exist, with no additional statement required. Verified
directly against the scaffold (§8): the loaded dump's `\d daily_logs`
output showed these exact three policies already attached before `035`
was ever applied.

**Column-bound `UPDATE` grant to `authenticated`** (a SEPARATE, broader
mechanism from RLS — direct dashboard-editability, not the audited
`correct_daily_log`/019 path): `035`'s STEP 2 re-declares this grant
(`REVOKE`+`GRANT` on the exact column list `017`/`030` already
established) with `evening_manpower`/`evening_idle_hours` appended,
nothing removed — same "leave the old list wired, add the new" precedent
`030` itself set when it added `evening_dependencies` to this same list.

**`service_role`, explicitly checked, not assumed clean by omission:**
this migration does not `CREATE TABLE daily_logs` — it `ALTER TABLE ...
ADD COLUMN` on an existing one. `ADD COLUMN` does not touch table-level
GRANT/REVOKE state at all; whatever `service_role`'s privilege set on
`daily_logs` is TODAY is EXACTLY what it remains after this migration,
unchanged in either direction. CLAUDE.md's own service-role-table-grants
finding (2026-08-26) names `daily_logs` as one of three tables
**"suspected to carry the same gap... unverified against a live probe,"**
not confirmed clean — this migration neither introduces nor repairs that
suspected gap; it is a pre-existing condition, out of this migration's
scope, restated here so it is not silently assumed resolved by proximity.
The migration-lint's `service-role-grant-required` rule (Rule 6) correctly
does not fire on this file, because that rule only checks tables a file
`CREATE`s — this file creates none.

---

## 8. Scaffold evidence — real RPC calls, not a compile

**Setup:** local Postgres 17.11 (matching prod/test-db's major version),
schema dumped from test-db via `supabase db dump --linked --schema public
--dry-run`, `auth` schema + five roles stubbed per CLAUDE.md §7's own
NAMED STUBS list. Migration applied cleanly (`CREATE FUNCTION` x2, zero
errors) — this alone is the class of defect (parse/ordering/executability)
the dry-run scaffold exists to catch before a reviewer's attention is
spent on anything else.

**Then exercised directly, four separate test sequences, not just
recompiled:**
1. **Full 5-step evening flow, one engineer, seeded morning equipment (2
   JCB + 1 mixer).** Every step advanced correctly in order. Final row
   confirmed: `evening_manpower` with an unmatched trade (§42, "PEB",
   `matched: false`, `total: 36` still reconciling against 25+11);
   `evening_idle_hours` written; `evening_equipment_utilisation` with the
   implausible JCB reading (§5), an unmatched equipment keyword
   (`borewell_rig`), AND a Case-B "not reported" entry for the mixer
   (listed in the morning row, never mentioned in the reply); `evening_
   schedule_miss_reason` holding the NEW hindrance text, not the old
   miss-reason semantics; `evening_submitted_at` stamped once, at step 5.
2. **Auto-skip path, second engineer, no morning equipment row at all.**
   Step 3 correctly routed to step 5 directly (not step 4, not
   completion) — confirming hindrance's unconditional status post-Decision-1:
   the auto-skip no longer ends the flow, it only removes one question from
   it. The skip's own write (`idle_hours_skip_equipment` branch) correctly
   produced BOTH the idle-hours write and the explicit-empty equipment
   placeholder in one transaction, then step 5 completed normally
   afterward.
3. **Morning §42, both call shapes.** A `by_trade` payload with an explicit
   `matched: false` PEB entry stored exactly as given; a payload with NO
   `matched` key at all (simulating a not-yet-updated caller) correctly
   defaulted every element to `matched: true` via the `COALESCE`.
4. **The session sweep** — §6 above.

**Rollback executed against the same scaffold, not asserted:**
`035-rollback.sql` applied cleanly (`CREATE FUNCTION` x2, zero errors).
Verified two ways:
- **Data preservation**: every column `035` had written (`evening_
  manpower`, `evening_idle_hours`, `evening_equipment_utilisation`,
  `evening_schedule_miss_reason`) queried again post-rollback — byte-
  identical to the pre-rollback values. The restored old RPCs simply stop
  reading these columns; nothing already written is touched.
- **Real branching restored, not just a recompile of the same logic**: a
  fresh session against the restored `apply_evening_flow_turn`, given a
  "met" answer at step 2, correctly advanced to **step 4** — the OLD
  behavior ("Plan met -> Q3 skipped, route to Q4," `025`'s own comment).
  Under `035`'s NEW logic, step 2 is an entirely different question
  (workers by trade) with no such branch at all — reaching step 4 on this
  input is only possible if the OLD branching genuinely came back, not
  merely the old-looking source text.

---

## 9. Apply runbook (not executed — for the eventual apply, once reviewed)

Numbered, per this project's own runbook-template convention. **S3 is a
DEDICATED step** — the ledger-repair pattern this session's own reading of
migration 032's incident (`docs/reviews/032-ledger-repair-record.md`)
showed is easy to fold silently into "the apply" and then forget to verify
independently.

- **S0 — Pre-flight.** Confirm `main`'s current HEAD and re-read
  `supabase/migrations/` + `docs/reviews/*.sql` directly (not from this
  package's own §0, which is already stale by the time of a real apply).
  **Re-verify the migration number at THIS moment** — 035 was corrected
  once already this same day; a second collision between drafting and
  applying is exactly the failure class §0a's test targeted. Re-run
  `npm run lint:migrations` fresh.
- **S1 — Companion TypeScript merged first.** This migration's `p_parse`
  shapes are contracts, not guesses — do not apply against a caller that
  doesn't yet emit them (§11, Pending). Confirm the parser/mirror PRs are
  merged and deployed before touching any database.
- **S2 — Apply window: BOTH flows' sessions cleared, not one.** Per §6,
  evening has no cutoff-sweep guarantee the way morning does — do not
  reuse morning's "any quiet window works" reasoning uncritically. Run a
  direct read-only session check (`SELECT current_flow, current_step,
  count(*) FROM whatsapp_sessions WHERE current_flow IS NOT NULL GROUP BY
  1,2`) immediately before applying, on the TARGET database, not carried
  over from an earlier check.
- **S3 — Apply, and ledger-repair as its own verified step, not folded
  into S2.** `supabase db query --linked -f docs/reviews/
  035_evening_flow_restructuring.sql` (or the SQL Editor, per CLAUDE.md
  §0's accepted apply paths) against test-db first, prod second — never
  `db push`. Immediately after EACH apply: run `supabase migration list
  --linked` against that same database and confirm 035 appears on BOTH
  `local` and `remote` — if the ledger doesn't reflect the apply (034's own
  precedent: applied and rehearsed, still shows an empty `local` column
  today), repair it explicitly (`supabase migration repair`) as a
  verified sub-step here, not assumed to have happened because the SQL
  ran without error.
- **S4 — Post-apply fingerprint.** Re-probe both function bodies'
  `prosrc` hash and both signatures against the live database, compare to
  the values pinned in §1 of this package. Confirm the two new columns
  exist with the expected type and the column-bound grant list from §7.
- **S5 — Merge the file into `main`.** Per CLAUDE.md's own "a migration is
  not done when applied and ledgered — it is done when the file is on
  `main`" rule — confirmed by reading `main` directly
  (`git show origin/main:supabase/migrations/035_...`), not trusted from a
  merge button.

---

## 10. PENDING — no TypeScript exists yet, stated plainly

**Nothing in this section is a gap in the SQL round above — it is the
declared boundary of what this round covers.** Three TypeScript artifacts
this migration's own `p_parse` shapes assume, none built:

1. **`parseLabourCount` extended with `matched`** (§4, Site 1) — the
   source of truth for whether a `by_trade` token canonicalized. Also
   needs finding 5's preservation requirement from the plan's own review
   round: the captured unmatched token must be the pre-normalisation
   surface form (or the applied normalisation must be named) — checked at
   plan time that today's tokenizer lowercases before matching
   (`labour.ts:39`), so this is not automatic and needs deliberate
   handling in whatever this parser change turns out to be.
2. **A new idle-hours-by-trade parser** — does not exist today in any
   form, unlike Site 1 which extends something live. Needs to accept
   "nobody idle" as a valid, common, ANSWERED response (the question is
   unconditional now), and needs the same `matched` capture discipline.
3. **A redesigned equipment-hours parser** — the single-number-per-type
   Evening Q4 shape (`{items:[{type,hours_used,matched,raw}],raw_text}`),
   replacing `parseEquipmentHours`'s current two-number, per-machine
   design entirely. `dispatchMorningFlow`'s own `matched` extension (§4,
   Site 3) rides with item 1 above, not this one.

**Once these three exist:** a test-db rehearsal becomes possible for the
first time (today's scaffold evidence, §8, is Postgres-level only — it
proves the SQL is syntactically and behaviorally correct against
hand-built JSONB, not that the real webhook pipeline produces that JSONB
correctly). At that point the rehearsal package should contain: the
shared fixture corpus this session's own review round required (finding
8 — one corpus, checked against all four by-trade/by-type call sites, so
they cannot silently diverge), RED-before-GREEN proof for each seeded
unmatched-token case at BOTH the TS-parser layer and the post-RPC
row-read-back layer, and a CI run exercising the real webhook → RPC →
`daily_logs` path end to end. **None of that exists yet, and no test-db
rehearsal or CI run can honestly be called end-to-end until it does** —
today's scaffold evidence is real, valuable, and insufficient on its own
for an apply decision.
