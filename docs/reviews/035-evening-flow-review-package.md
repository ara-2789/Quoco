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

### 5a. TRI-STATE FINDING — NULL is not false (recorded because it generalizes, not because it was asked for)

The same test run's `borewell_rig` item (an equipment keyword
`morning_equipment` never listed) came back `"implausible": null`, not
`false` — SQL confirms "nothing to check the plausibility bound against" is
a different claim from "checked and found plausible," per the migration's
own `CASE WHEN v_morning_count_for_type IS NULL THEN NULL` branch.

**Why this is worth keeping as its own finding, not just a scaffold-run
footnote:** `implausible` is a three-state field (`true` / `false` / `null`),
and the third state carries real, distinct meaning — "no denominator was
available to check against," never collapsed into either "plausible" or
"implausible." Absence of a denominator is recorded as absence. A reader (or
a future consumer of this column, e.g. a DPR narrative pass) that treats
`implausible` as a boolean and reads `null` as falsy would silently
mis-render "nothing to check" as "checked and fine" — the exact kind of
unearned confidence §17's "the DPR reports, the reader judges" principle
exists to prevent. This is a general shape (a flag computed FROM an
optional denominator should be nullable, not boolean, whenever the
denominator can itself be absent), not specific to equipment hours — worth
carrying forward to any future flag built the same way.

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

**CORRECTION, this addendum (2026-09-01), before the numbered steps: the
original S1 below ("Companion TypeScript merged first... before touching
any database") had the ordering backwards and must not be followed.**
Reviewer ruling this round named two coupling hazards this migration's own
S1 never accounted for — recorded here explicitly rather than silently
reordering the list, per this project's own audit-the-package discipline
(CLAUDE.md, "a document submitted for external review is audited for
asserted-but-nonexistent artifacts"): a stale ordering claim is the same
species of problem, just in the opposite direction (an artifact that DOES
exist, described wrong).

**Finding A — evening requires a true lockstep, not "TS first."**
`apply_evening_flow_turn` is a FULL rewrite (5 linear steps replacing 6,
the only branch deleted). Unlike migration 029/034 (an inert schema
addition; nothing live reads the new shape until something is told to),
the DEPLOYED `evening.ts` today constructs and sends the OLD `p_parse`
shape on every single evening turn. There is no safe one-directional
order:
  - **New SQL, old TS still deployed** — the live webhook keeps sending the
    OLD 6-question shape into a body that no longer has those steps.
    Breaks immediately, for every engineer messaging during the window.
  - **New TS deployed, old SQL still live** — the reverse break: the new
    `evening.ts` sends the NEW 5-step shape into a body still expecting the
    old one. Equally broken, same population.
Both directions fail LOUDLY and immediately — this is NOT the morning
case (Finding B) where the wrong order fails silently. The fix is 030's
own precedent, S4's own words ("Merge-is-deploy for this project... must
land in one motion, not two separated by any observable gap"): apply the
SQL, then merge the TS PR immediately after, with no gap — see the
renumbered S2→S3 pair below. **This is the OPPOSITE of 034's ordering** —
034's file sat applied-but-unmerged-to-`main` for a real stretch with
nothing breaking in the gap, because nothing live depended on the file
being on `main` yet. Inheriting that pattern here — apply now, merge the
TS "sometime after" — would break every evening check-in for the entire
length of the gap.

**Finding B — morning's coupling is the reverse shape: one-directional,
and silent rather than loud.** Only the `v_col = 'manpower'` branch
changes, and its `COALESCE((t->>'matched')::boolean, true)` (§4, Site 2)
was deliberately written to tolerate an old caller that never sends
`matched` at all — scaffold-verified both ways (§8, test sequence 3). So:
  - **New SQL, old TS (labour.ts without `matched`)** — SAFE. Every
    `by_trade` element defaults to `matched: true`, byte-identical to
    today's behavior. This can persist indefinitely with no observable
    effect.
  - **New TS (labour.ts emitting `matched: false` for an unrecognised
    trade), old SQL still live** — SILENTLY INEFFECTIVE, not broken. The
    OLD reshape (`030_morning_flow_attendance.sql:596`,
    `jsonb_build_object('trade', ..., 'count', ...)`) has no `matched` key
    in it at all — it simply doesn't read the field TS is now sending, and
    the unmatched token vanishes exactly as it does today. Nothing errors,
    nothing pages anyone, and §42's own fix silently isn't real yet — the
    disease this migration exists to cure, reproduced by shipping the two
    halves in the wrong order.
  **SQL-FIRST IS THEREFORE REQUIRED for morning specifically** — not
  because reversing it breaks anything visibly, but because reversing it
  means the fix ships invisibly inert, which is worse to discover later
  than an immediate break would be. In practice this collapses to the
  SAME procedure as Finding A's lockstep (apply once, for both RPCs in one
  file, then merge immediately) — recorded as its own finding because the
  REASON differs (a visible two-directional break vs. a silent
  one-directional no-op), even though the resulting runbook step is
  identical for both.

Numbered steps, per this project's own runbook-template convention. **S3 is
a DEDICATED step** — the ledger-repair pattern this session's own reading of
migration 032's incident (`docs/reviews/032-ledger-repair-record.md`)
showed is easy to fold silently into "the apply" and then forget to verify
independently; per 030's own S6 precedent, ledger repair is placed LAST so
it never competes with S2→S3's lockstep urgency.

- **S0 — Pre-flight.** Confirm `main`'s current HEAD and re-read
  `supabase/migrations/` + `docs/reviews/*.sql` directly (not from this
  package's own §0, which is already stale by the time of a real apply).
  **Re-verify the migration number at THIS moment** — 035 was corrected
  once already this same day; a second collision between drafting and
  applying is exactly the failure class §0a's test targeted. Re-run
  `npm run lint:migrations` fresh. Confirm the companion TypeScript PR
  (§10/§11's pending parsers + mirror + `evening.ts` rewrite) is open,
  reviewed, and ready to merge on a keystroke — NOT already merged (Finding
  A/B above: merging it before this point is itself the hazard).
- **S1 — Apply window: BOTH flows' sessions cleared, not one.** Per §6,
  evening has no cutoff-sweep guarantee the way morning does — do not
  reuse morning's "any quiet window works" reasoning uncritically. Run a
  direct read-only session check (`SELECT current_flow, current_step,
  count(*) FROM whatsapp_sessions WHERE current_flow IS NOT NULL GROUP BY
  1,2`) immediately before applying, on the TARGET database, not carried
  over from an earlier check. **PROCEED condition: `count = 0`** (or,
  failing that, confirmation the migration's own built-in sweep, STEP 3 of
  the SQL file, will correctly close whatever it finds — §6's scaffold
  evidence already proved this for a seeded session, not just asserted it).
- **S2 — Apply, ONE sitting, no gap to S3.** Fresh linked-project
  breadcrumb pasted immediately before the apply (CLAUDE.md §0's PROD
  APPLIES rule), `supabase db query --linked -f docs/reviews/
  035_evening_flow_restructuring.sql` (never `db push`) against test-db
  first, prod second. This single statement replaces both RPCs and runs
  the one-time session sweep together, inside the file's own
  `BEGIN`/`COMMIT` — there is no intermediate state where one RPC is new
  and the other is old.
- **S3 — Merge — THE LOCKSTEP CLAUSE, per Findings A and B above.** The
  companion TypeScript PR (parsers + mirror + `evening.ts` rewrite) merges
  IMMEDIATELY after S2 confirms, not "sometime after" — Vercel deploys on
  merge to `main` for this project, so merging is the deploy. Do not
  proceed to S4 until the merge/deploy is confirmed live.
- **S4 — Confirm live + tests green — the FIRST real run, a NAMED step.**
  Once the companion parsers exist (§10/§11), their rehearsal/mirror test
  suites get their first real execution against the now-live RPCs here —
  matching 030's own S5 precedent that this is a named, required step, not
  an assumed side effect of S2/S3.
- **S5 — Post-apply fingerprint.** Re-probe both function bodies'
  `prosrc` hash and both signatures against the live database, compare to
  the values pinned in §1 of this package. Confirm the two new columns
  exist with the expected type and the column-bound grant list from §7.
- **S6 — Ledger repair + confirm the file is on `main` — LAST, deliberately
  (030's own S6 reasoning: neither carries S2/S3's lockstep-timing
  urgency).** Run `supabase migration list --linked` against each database
  applied to and confirm 035 appears on BOTH `local` and `remote` — if the
  ledger doesn't reflect the apply (034's own precedent: applied and
  rehearsed, still showed an empty `local` column at one point), repair it
  explicitly (`supabase migration repair`) as a verified sub-step, not
  assumed to have happened because the SQL ran without error. Then confirm
  the migration file itself is reachable from `main` by reading `main`
  directly (`git show origin/main:supabase/migrations/035_...`), per
  CLAUDE.md's "a migration is not done when applied and ledgered — it is
  done when the file is on `main`" rule — never trusted from a merge
  button's result alone.

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

---

## 11. §42 RED tests — committed as expected-fail, run for real (2026-09-01 addendum)

Per Aravind's instruction this round: write the §42 tests NOW, against
CURRENT (pre-035, pre-parser) behaviour, so the capture gap is a failing
test list that cannot be forgotten, rather than something someone has to
remember. **All numbers below are from an actual run, not asserted** — see
the command lines under each result.

**Shared fixture corpus** — `test/helpers/section-42-corpus.ts`. ONE corpus
(`SECTION_42_CORPUS`), three cases (`manpower`, `idle_hours`,
`equipment_hours`), referenced by name from both test layers below so they
cannot silently diverge on what "an unmatched token" means — same
discipline as `test/helpers/yesno-corpus.ts`'s existing role for the
yes/no classifier. The `manpower` case reuses "PEB" directly from
`docs/reviews/field-samples.md`'s own sample 1 ("Civil - 25 Nos, P.EB - 11
Nos") and from this package's own §4/§8 scaffold evidence, rather than
inventing a fourth spelling of the same real discipline.

**How "expected-fail without turning CI red" actually works** — Vitest's
`it.fails` / `test.fails`, confirmed present in the installed
`vitest@3.2.7` (`ChainableTestAPI` includes `"fails"` —
`node_modules/@vitest/runner/dist/tasks.d-CkscK4of.d.ts:314`, checked
directly, not assumed from memory). `it.fails` inverts the pass/fail
signal: a test body that throws is reported PASSED; a test body that
stops throwing is reported FAILED. **This was sanity-checked both
directions, not just asserted:** a throwaway test wrapping
`expect(1).toBe(1)` in `it.fails` was run and confirmed to exit 1 (a
real CI failure) — proving the mechanism doesn't just look like it works,
it actually flips red the moment an assertion it's supposed to be
protecting starts passing for real. This is exactly the property needed:
CI stays green today, and CI going RED later is the signal that a pending
§42 item shipped and the `.fails` wrapper needs removing — the opposite of
`.skip`/`.todo`, which would let the gap go quiet with no signal either
way.

**Site coverage, matched honestly to what §10 says is actually pending —
not "every by-trade/by-type field in the product":**

| Site | TS-parser layer | Post-RPC row-read-back layer |
|---|---|---|
| `manpower` (shared, morning Q2 + evening step 2) | `test/unit/section-42-unmatched-capture.test.ts` — real `parseLabourCount`, RED | `test/section-42-row-readback.test.ts` — real `apply_morning_flow_turn` on live test-db, RED |
| `idle_hours` (evening step 3, new) | same file — no parser exists; dynamic `import()` of the future path rejects at runtime, caught by `.fails` | **not achievable today** — no parser AND no RPC step exist |
| `equipment_hours` (evening step 4 redesign) | same file — real `parseEquipmentHours`, asserts the TARGET shape (`type`/`hours_used`/`matched`) against the current two-number shape, RED | **not achievable today** — the live `apply_evening_flow_turn` has no step reading a type-joined single-number payload; calling it with a target-shape payload would prove nothing about §42 |

**The asymmetry is named, not hidden**, matching this project's own
"state limits, don't overclaim" habit: `manpower` is the only site with
BOTH a live parser and a live RPC branch to drive end-to-end through the
real webhook path today, so it is the only site with a post-RPC proof.
The other two sites' row-read-back proof waits on the TypeScript round
(§10) and, for evening specifically, on 035 actually applying — restated
in both new test files' own headers, not just here.

**Actual run output, this session, against this exact worktree:**
```
$ npx tsc --noEmit
(exit 0, zero errors — the three new files, including the dynamic-import
 pattern used for not-yet-existing modules, type-check clean)

$ npx vitest run test/unit/section-42-unmatched-capture.test.ts
 ✓ site 1: manpower > TARGET: ... matched:false          (it.fails — PASS, throws as expected)
 ✓ site 1: manpower > TODAY: the token silently vanishes  (ordinary — PASS, documents the gap)
 ✓ idle_hours > TARGET: parseIdleHoursByTrade exists ...  (it.fails — PASS, module import rejects)
 ✓ idle_hours > TODAY: the module does not exist at all   (ordinary — PASS)
 ✓ equipment_hours > TARGET: {type, hours_used, matched}  (it.fails — PASS, fields undefined today)
 ✓ equipment_hours > TODAY: old two-number shape           (ordinary — PASS)
 Test Files  1 passed (1)   Tests  6 passed (6)

$ npx vitest run test/section-42-row-readback.test.ts   # real test-db, exfccwlrhoutkgrlikod
 ✓ TARGET: daily_logs.morning_manpower.by_trade ... matched:false   (it.fails — PASS, 1806ms)
 ✓ TODAY: the row stores the matched trade, drops the unmatched one (ordinary — PASS, 1899ms)
 Test Files  1 passed (1)   Tests  2 passed (2)
```
Zero errors, zero unexpected failures, both new files exit 0 — CI stays
green with these files committed, exactly as required. The full existing
suite was also run afterward (`npx vitest run`, no path filter) to confirm
no interference with pre-existing tests or leftover test-db rows from the
new `testPhone('305')` slot (confirmed unclaimed via the required
`grep -rohE "testPhone\('[0-9]+'\)|\+19995550[0-9]{3}" test/` check, per
`test/helpers/db.ts`'s own registry instructions, before it was used).

**What happens to these tests once the pending TypeScript ships (§10):**
each TARGET test's `it.fails` wrapper is removed and the assertion becomes
an ordinary, permanently-green test; each paired "TODAY" test is deleted
(it documents behavior that will no longer exist, not a regression worth
guarding). The `idle_hours` and `equipment_hours` row-read-back gap in the
table above closes at that point too, once 035 is applied — new tests
get added to `test/section-42-row-readback.test.ts` then, not retrofitted
onto today's manpower-only file.


---

## 12. TypeScript round 3 — all three parsers built, §42 RED tests flipped GREEN (2026-09-01)

Per Aravind's round-3 instructions: the lowercasing fix approved as designed
(§4's own "checked at plan time" caveat is now closed); reusing
`classifyYesNo` for idle-hours' "all working" detection REJECTED, replaced
with a purpose-built sentinel; a NEW tri-state requirement (unparseable
idle-hours records UNKNOWN, never a fabricated zero) designed and built,
including a necessary SQL amendment; then all three parsers built, plus a
scope discovery mid-build that changed how the equipment-hours redesign
actually ships.

### 12.1 The lowercasing fix, applied identically across all three sites

Every parser that reshapes an unmatched token used to lowercase the whole
input string before tokenising, so a captured token would come back
`"peb"`, never `"PEB"` — violating finding 5's as-heard requirement.
Fixed by tokenising on ORIGINAL-CASE text and pushing `.toLowerCase()`
into the lookup call only (`canonicalTrade`/`canonicalEquipment` already
lowercase internally). Applied to `labour.ts`, `idle-hours.ts` (new), and
`equipment-hours.ts`'s redesign — verified, not assumed, by every §42 test
below asserting the exact-case literal `'PEB'`/`'hydra'`, which would fail
on a re-cased capture.

### 12.2 REJECTED: classifyYesNo for idle-hours' "all working" — purpose-built sentinel instead

`classifyYesNo`'s vocabulary already carries two loaded semantics
(schedule-met, then attendance — `morning-flow-migration-review-package.md`
§11.5). Its attendance-tuned present-side forms ("half day", "late",
"coming late", "reached site") mean the OPPOSITE thing on an idle-hours
question — "half day" reads `met:true` (present) on attendance, but
plausibly means HALF THE DAY WAS IDLE on this question. Reusing it would
have been a third semantic loaded onto one lexicon, the same risk pattern
§11.5 already recorded once.

Built instead: `isAllWorkingSentinel` (`lexicon.ts`), a small, purpose-built
phrase list ("all working", "everyone working", "all productive", "everyone
productive", "fully productive", "full productivity", "nobody idle", "no
one idle") checked as a substring match against the whole normalised
answer — plain negatives ("no idle", "none") remain covered by the existing,
generic `isNoneSentinel`, reused unchanged since negation isn't
question-specific.

A forward-pointing comment was added directly above `classifyYesNo`'s own
definition recording this rejection, so the next person reaching for it for
a THIRD question sees the warning before writing the code, not after.
**Citation audit caught mid-write**: an early draft of that comment cited
`design-decisions-beta-feedback.md §32`, which turned out to be about the
parse-attempt corpus, not this — checked against the actual file before
commit (not assumed), corrected in place to cite
`morning-flow-migration-review-package.md §11.5`, the real source.

**Regression guard, run for real** (`test/unit/idle-hours-parser.test.ts`):
`"half day"` on the idle-hours question resolves to `unknown:true,
all_working:false` — never a confident zero. Also checked: `"late"`,
`"coming late"`, `"reached site"` — none resolve `all_working:true`.

### 12.3 NEW: tri-state idle-hours (`by_trade` / `all_working` / `unknown`) — a necessary SQL amendment, not just a TS one

**The requirement**: an unparseable idle-hours answer must record UNKNOWN,
never a fabricated zero — the same discipline as the plausibility flag's
NULL-not-false ruling (§5a), and the same discipline migration 024 already
applied once at the SQL layer (`T-024-23`, "unclassifiable after budget ->
NULL, never a fabricated 0").

**Shape, `IdleHoursParse`** (`lib/whatsapp/flows/parsers/idle-hours.ts`):
```
{ by_trade: [{trade, idle_hours, matched}], all_working: boolean,
  unknown: boolean, raw_text: string }
```
Exactly one of three states holds: real `by_trade` data; `all_working:true`
(a confident zero, an explicit sentinel recognised); `unknown:true`
(nothing recognisable at all — no number, no trade, no sentinel). `unknown`
is the ONLY state that gates a reask (`isIdleHoursAnswered`).

**Why this could not stay TS-only, traced not assumed**: the SQL branches
this file already wrote (`v_col = 'idle_hours'` / `'idle_hours_skip_
equipment'`) only ever read `by_trade` and `raw_text` from `p_parse->'3'` —
they would have silently dropped `all_working`/`unknown` at the write
boundary, collapsing a confident zero and a genuine unknown into the
IDENTICAL stored shape (`{by_trade:[], raw_text:...}`), indistinguishable
to any later reader — the exact §42 disease, recurring at a different
field. `035_evening_flow_restructuring.sql`'s two `idle_hours` branches now
also write `'all_working', COALESCE((p_parse->'3'->>'all_working')::
boolean, false)` and `'unknown', COALESCE(...,false)`, read straight from
the TS parser's own tri-state rather than re-derived in SQL, so the two
layers can never disagree about which state applies.

**Verified for real, standalone, before committing** — not the full
disposable scaffold (that's the test-db rehearsal, next), a lighter,
targeted check: a throwaway local Postgres instance, the EXACT
`jsonb_build_object` expression from the amended branch, against four
representative `p_parse->'3'` payloads (real data; `all_working`; `unknown`;
a caller omitting both fields, the defensive-COALESCE edge). All four
produced the correct, distinct stored shape — real data preserved
including the unmatched `PEB` entry; `all_working` and `unknown` correctly
mutually exclusive and distinct from each other. Instance destroyed after.

**Reviewer-approval amendment, stated where it can't be missed**: the
reviewer approved this SQL file with no findings against it; this same
session then found the tri-state gap and amended the file AFTER that
approval. `035_evening_flow_restructuring.sql`'s own header now carries an
explicit **AMENDED AFTER REVIEWER APPROVAL** note naming exactly what
changed (two branches' internal JSONB construction) and what did NOT
(neither RPC's signature) — re-review of this specific delta is owed
before the file is treated as re-approved wholesale.

### 12.4 SCOPE DISCOVERY mid-build: the equipment-hours redesign ships ADDITIVELY, not in place

The design record throughout this migration (plan §6, this package's own
§10/§11) always described this as "`parseEquipmentHours`, redesigned" — an
in-place replacement. Tracing the actual blast radius before touching
anything found that doesn't hold today:

- `dispatchEveningFlow` (evening.ts, the PURE mirror) calls the old
  `parseEquipmentHours` — safe to delete, already a settled decision
  (plan §1), not production-connected (`dispatchInboundTurn`/`route.ts`
  call `applyEveningFlowTurn` directly, per that file's own header note).
- **`applyEveningFlowTurn`** (evening.ts:715–796) — the REAL, LIVE,
  production RPC-calling wrapper, used by `lib/whatsapp/outbound/
  trigger.ts` — independently calls `parseEquipmentHours(params.message)`
  (line 748) and sends it keyed as `p_parse['6']` (the OLD 6-step
  numbering) into the CURRENTLY-LIVE `apply_evening_flow_turn` (025's
  body) on every real evening turn.

Redesigning `parseEquipmentHours` in place, before 035 applies AND
`applyEveningFlowTurn` is rewritten to match, would ship exactly this
package's own §9 Finding A: new-shaped TS data into an old-shaped live RPC
body, breaking every live evening check-in from the moment it merges — not
hypothetical, a traced, confirmed dependency chain. Rewriting
`applyEveningFlowTurn` for the new 5-step design and new `p_parse` keying
is itself a large, separate task (the "companion TypeScript" this
package's own runbook S0/S1 already named as not-yet-started) — well
beyond this round's asked scope of three parsers + a mirror + fixtures.

**Resolution**: the redesign ships as NEW, additive exports in the SAME
file — `parseEquipmentHoursByType`, `EquipmentHoursByTypeItem`,
`EquipmentHoursByTypeParse`, `isEquipmentHoursByTypeAnswered` — leaving
`parseEquipmentHours`/`isEquipmentHoursAnswered`/`EquipmentHoursItem`/
`EquipmentHoursParse` (the OLD design) fully untouched, so `evening.ts`
keeps compiling and PRODUCTION STAYS SAFE. `equipment-hours.ts`'s own
header now documents this in full, including the eventual consolidation:
when `evening.ts` gets its real rewrite (lockstep with 035's apply, §9
Finding A), the OLD exports are deleted and `parseEquipmentHoursByType` is
renamed back to the clean `parseEquipmentHours` name.

**Named precedent, not a new pattern**: this is the SAME transitional shape
migration 030's own §10.2 finding already named and accepted once — "an
overload hazard traded for a duplicate-logic hazard." Two implementations
coexisting for a bounded window is the deliberately-chosen alternative to
shipping a live break, not a compromise invented for this round.

**Verified, not assumed**: `npx tsc --noEmit` — zero errors, confirming
`evening.ts` (and everything it touches: `outbound/trigger.ts`,
`test/dispatch.test.ts`, `test/inbound-start.test.ts`,
`test/productivity-reconciliation-mirror.test.ts`,
`test/unit/equipment-label.test.ts`, `test/webhook.test.ts`,
`test/helpers/db.ts`) compiles unchanged.

### 12.5 A latent bug found and fixed while tracing the real behaviour (labour.ts)

Building the tri-state/§42 capture correctly required tracing
`parseLabourCount`'s exact token-by-token behaviour against the corpus's
own `"25 mason 11 PEB"` case — which surfaced a pre-existing bug the OLD
code already had: the "after ?? before" trade tie-break could attribute a
SECOND number to a trade word already consumed by an EARLIER number.
`"25 mason 11 PEB"`, under the OLD code, actually produced `by_trade:
[{trade:'mason',planned_count:25},{trade:'mason',planned_count:11}]` — a
double-attribution, not a clean drop of PEB — invisible in a prior round's
own RED test only because that test used `.find()`, which silently picked
the first matching entry. Fixed with `consumedTradeTokens`, a set of token
indices already attributed, checked before either tie-break candidate is
used — verified via a dedicated regression test
(`test/unit/labour-parser.test.ts`, "two numbers, one matched one not — no
double-attribution").

A second, smaller gap found the same way: the first `§42` capture draft
would have wrongly swept generic filler words ("per", "aalu" — the exact
words `test/unit/labour-parser.test.ts`'s own pre-existing "mixed
Tamil/English" test uses) into `by_trade` as fake unmatched trades. Fixed
with a small, dedicated `LABOUR_FILLER_WORDS` set (not borrowed from
`RATE_STOPWORDS`/`QUANTITY_STOPWORDS`, which serve different questions) and
a Unicode-letter check (`\p{L}`, not `[a-zA-Z]`) so a transliterated or
Tamil-script trade word is still captured as unmatched while punctuation
remnants and filler are not. The same two fixes (filler exclusion,
Unicode-letter check) were applied to `idle-hours.ts` and the
`equipment-hours.ts` redesign for consistency across all three sites.

### 12.6 Test results — what flipped GREEN, what correctly stayed RED, run for real

**tsc**: `npx tsc --noEmit` — zero errors throughout every step of this
round, including after the equipment-hours additive change.

**§42 TS-parser layer** (`test/unit/section-42-unmatched-capture.test.ts`)
— ALL THREE sites flipped GREEN, `it.fails` wrappers removed (the
assertions now genuinely pass), the paired "TODAY" documentation tests
DELETED per the plan this file's own header already stated ("documents
behaviour that will no longer exist"). Confirmed by reading the actual
diff, not assumed: each TARGET assertion is now an ordinary `it(...)`.

**Dedicated new parser test files, run for real**:
- `test/unit/idle-hours-parser.test.ts` — 15/15 passed, including both
  named regression guards ("half day" ≠ zero idle; unparseable = unknown
  ≠ zero) and a mutual-exclusivity check (`by_trade`/`all_working`/
  `unknown` — exactly one true, every case).
- `test/unit/equipment-hours-by-type-parser.test.ts` — 10/10 passed,
  including the ORIGINAL 2026-08-31 incident input (`"2 JCB 8"`) now
  parsing cleanly with no rejection, and a large-hours case (`"JCB used 50
  hours"`) stored as-is with no guard firing.
- `test/unit/labour-parser.test.ts` — 13/13 passed (existing 11 updated for
  the new `matched` field and one corrected expectation; 2 new regression
  tests added).
- `test/unit/morning-dispatch.test.ts` — 24/24 passed (existing manpower
  reshape assertion updated for `matched`; 1 new §42 mirror test added).

**§42 post-RPC row-read-back layer** (`test/section-42-row-readback.test.ts`,
against LIVE test-db) — **correctly did NOT flip green**, and confirming
that by actually running it (not assuming) surfaced something the original
"TODAY" test had wrong: the OLD, still-live SQL reshape does an
UNCONDITIONAL per-element map with no filter on matched status, so once
`parseLabourCount` started including the unmatched `PEB` entry, the OLD RPC
started carrying it through TOO — just with no `matched` key on any
element (confirmed live: `{"count": 11, "trade": "PEB"}` already present
in the stored row, pre-035). The bug was entirely a TS-layer drop, never an
SQL-layer filter. The TARGET test (still `.fails`) correctly still throws —
it specifically checks for the `matched` key, which only 035's own reshape
will ever write — and the TODAY companion test was corrected to document
this real, verified three-tier state instead of the wrong assumption it
replaced. **This is the "none flipped for the wrong reason" check,
performed for real**: the manpower row-readback TARGET staying red, for
the RIGHT reason (RPC unchanged), is exactly as correct as the TS-layer
tests going green for the right reason (parsers built) — flipping this one
green now would have been the wrong-reason failure mode Aravind's
instruction named.

**Lints**: `npm run lint:migrations` — clean (86 known violations, all
exempted, unchanged). `npm run lint:filesize` — clean, this package still
well under the 120,000-char warn threshold.

**Full suite** (`npx vitest run`, no path filter) — run TWICE, not once,
because the FIRST run surfaced something that needed investigating rather
than reporting as-is:

- **Run 1**: 63 failed, 843 passed, 27 skipped, 1 todo (934 total) — 12
  files, ALL failures a foreign-key violation on `daily_logs_project_id_
  fkey` / `users_tenant_id_fkey`, the shared-fixture chain
  (`ensureMorningFixtures`/`removeMorningFixtures`, `test/helpers/db.ts`)
  every migration-numbered integration test file depends on.
- **Investigated before reporting, per this file's own standing discipline
  ("test for real, don't reason about it")**: `test/morning-flow.test.ts`
  run STANDALONE (the file with the most failures in run 1) passed
  CLEANLY, 19/19 — proving the round-3 parser changes were not the cause; a
  real code regression would fail the same way in isolation. A direct
  read-only probe of `tenants`/`projects` confirmed the shared fixture rows
  were correctly absent (the normal post-teardown state, not corruption).
- **Run 2, immediately after**: 1 failed, 932 passed, 1 todo (934 total) —
  the SAME single known flake this package's earlier evidence (§0a's own
  session context) already names (`test/session-transition.test.ts`'s
  Test B, the documented sandbox lock-wait limitation,
  `docs/reviews/session-transition-lock-wait-flake.md`, CLAUDE.md's
  "CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY" rule). Nothing else
  failed.
- **Conclusion, not assumed**: run 1's 63 failures were a transient event
  in the shared-fixture lifecycle under this round's added file count (four
  new files, each with their own `beforeAll`/`afterAll` touching the same
  hardcoded `TEST_TENANT_ID`/`TEST_PROJECT_ID`), consistent with this
  project's own already-documented test-db fragility findings (`docs/
  reviews/test-db-reliability-workstream.md`,
  `sandbox-cannot-test-concurrency.md`) — not a defect in this round's
  parser code, confirmed two independent ways (standalone isolation, and a
  clean full-suite reproduction) rather than dismissed on the first
  reasonable-sounding explanation.

---

## 13. DELTA FOR REVIEWER — idle-hours amended AFTER your approval (2026-09-01)

**You approved `035_evening_flow_restructuring.sql` with no findings against
the SQL.** The same session then found a real gap the approved version
carried, and fixed it. This section is the delta — what changed, why the
version you approved was wrong, and how the fix was verified — so re-review
can be scoped to exactly this, not the whole file again. Full round-3
context (unrelated TypeScript work) is §12; this section is self-contained
and does not require reading that one.

### What changed

Two branches — `v_col = 'idle_hours'` and `v_col = 'idle_hours_skip_
equipment'` — each gained two new keys in the `evening_idle_hours` JSONB
they write:

```sql
'all_working', COALESCE((p_parse->'3'->>'all_working')::boolean, false),
'unknown',     COALESCE((p_parse->'3'->>'unknown')::boolean, false),
```

Nothing else changed. Both RPCs' signatures (the byte-identical-to-live
parameter lists you already reviewed in §1) are untouched — this is
entirely internal to two branches' JSONB construction.

### Why the approved version was wrong

The approved version only ever wrote `by_trade` and `raw_text` from
`p_parse->'3'`. A downstream requirement surfaced after your approval: an
UNPARSEABLE idle-hours answer (garbled text, no number, no recognisable
signal) must be stored as UNKNOWN, never coerced into a zero — the same
principle already in this file for the plausibility flag (§5a, NULL when
there's nothing to check, never `false`).

The approved version had no way to express that. A genuine "nobody was
idle" answer and a genuinely unparseable one BOTH stored as `{by_trade:
[], raw_text: "..."}` — identical shapes, no field distinguishing them.
That is a live recurrence of §42 itself (the thing this whole migration
exists to fix): information the TS layer can tell apart collapses to the
same value at the write boundary, indistinguishable to anything reading
the column afterward — a DPR narrative pass, a PM dashboard, anyone.

The fix: `parseIdleHoursByTrade` (new, `lib/whatsapp/flows/parsers/idle-
hours.ts`) now produces a genuine tri-state — `by_trade` non-empty (real
data), `all_working: true` (a confident, explicit zero), or `unknown: true`
(nothing recognisable — never a fabricated zero). The two new SQL keys
read that tri-state straight through rather than re-deriving it, so the
TS and SQL layers can never disagree about which of the three states
applies.

### Verification — four cases, against a real Postgres instance, not reasoned about

Before committing, the exact `jsonb_build_object` expression from the
amended branch was run — standalone, not the full scaffold — against a
throwaway local Postgres instance (`initdb`/`pg_ctl`, destroyed
immediately after), with four representative `p_parse->'3'` payloads:

| Case | Input | Stored result |
|---|---|---|
| Real data | `{by_trade:[{trade:mason,...},{trade:PEB,matched:false,...}],all_working:false,unknown:false}` | `by_trade` preserved (including the unmatched `PEB` entry, §42), `all_working:false`, `unknown:false` |
| Confident zero | `{by_trade:[],all_working:true,unknown:false}` | `by_trade:[]`, `all_working:true`, `unknown:false` |
| Genuinely unknown | `{by_trade:[],all_working:false,unknown:true}` | `by_trade:[]`, `all_working:false`, `unknown:true` |
| Caller omits both fields (defensive `COALESCE` edge) | `{by_trade:[]}` | `all_working:false`, `unknown:false` (degrades to neither confident-zero nor unknown — a hypothetical malformed-caller case only, never produced by the real parser, which always sets both fields) |

All four produced the correct, distinct stored shape. The confident-zero
and genuinely-unknown cases are the ones that matter: they now store
DIFFERENTLY, which is the entire point of the fix — under the approved
version they would have been identical.

### What this does NOT change

- Neither RPC's argument list — the byte-identical signature proof in §1
  still holds as reviewed.
- The `manpower` branch's `matched` addition (§4 Site 2) — unrelated to
  this delta, unchanged since your approval.
- The equipment-hours (step 4) branch — unrelated to this delta, unchanged.
- Nothing has been applied anywhere. This file is still WRITTEN, NOT
  APPLIED (its own header). The test-db rehearsal has not started.

**Ask**: re-review the two changed branches (the diff above, in full in
`docs/reviews/035_evening_flow_restructuring.sql`'s `idle_hours` /
`idle_hours_skip_equipment` sections) and the SQL file's own header note
under **AMENDED AFTER REVIEWER APPROVAL**. Not asking you to re-review the
file wholesale — the rest is unchanged from what you already approved.
