# Review package — DPR engineer-report reformat (migration 028 + pipeline rewrite)

**Revision 6.** `docs/dpr-engineer-report-spec.md` was updated on disk to make Rule 7
(the `not_applicable` check-in status) spec-authoritative — this package now defers to
it instead of re-deriving the design, and corrects two errors in the previous draft: the
threshold used the wrong constant (a stale 10:30 cutoff, since corrected to 15:00 by PR
#59) AND the wrong kind of constant (a cutoff, when the question is "was this engineer on
the roster when the question went out," which needs the SEND time — 07:30/18:30 — not a
cutoff). **New prerequisite, verified not assumed: PR #59 must merge first**, since the
`CHECKIN_CHECKPOINTS` constant this depends on only exists on that branch — §8 (new)
covers the verification done before recommending that merge.

Status: PLAN ONLY. Nothing implemented, nothing committed, nothing applied. This package
is the request for external review Aravind asked for, per his own standing rule that
review before code runs is cheaper than review after (CLAUDE.md §0, migration 027's own
recorded lesson).

Repo-state header, per CLAUDE.md's own standing convention for review requests at this
tier: `main` at the commit current when this package was written; `supabase migration
list --linked` shows local/remote in sync through 027, with 026 present locally but
unapplied remotely (a pre-existing, unrelated, untracked file — not part of this work).
No runbook has been executed yet; this is the first one for this change.

---

## 1. What this change is

Replaces the DPR generation pipeline: one report per site engineer per day (not one per
project), a four-line body of planned/actual pairs sourced from a fixed question-to-field
binding, free text rendered verbatim in quotes, and the model restricted to writing one
containment-checked verdict sentence. Full spec: `docs/dpr-engineer-report-spec.md`.
Full design plan, all revisions folded in: see the accompanying plan document (this
package restates the load-bearing parts; the plan file has the full assembler audit with
line numbers, the pair Fact shape, and the constraint-by-constraint enforcement mapping).

Files touched (TypeScript, no migration function logic among them — confirmed by grep,
zero `.rpc()` calls anywhere in the current DPR pipeline):
`lib/dpr/{schema,assemble,containment,generate,render,narrative-context,dispatch}.ts`,
`lib/dpr/discarded-fields.ts` (retired), `app/api/cron/dpr-generate/route.ts`,
`app/(dashboard)/dprs/{page.tsx,[id]/page.tsx}`, plus the one migration below.

---

## 2. The migration — TWO OPTIONS, reviewer decides, not pre-decided here

**Pre-apply state, confirmed by direct query against prod, not assumed:**

| id | log_date | underlying `daily_logs` engineers | disposition |
|---|---|---|---|
| `35a2f41c-64ec-41f5-a763-4afe05940ca5` | 2026-08-12 | zero — `skipped_no_data`, `content IS NULL`, never delivered | **see options below** |
| `af7760e8-2457-4c11-bc35-52929a0bbf54` | 2026-08-13 | one — `3534756b-2a32-4b91-954b-0bab15c2dba1` | **backfill to that engineer_id — unconditional, same under both options** |

No multi-engineer project-day exists in prod today — confirmed by
`GROUP BY (project_id, log_date) HAVING count(DISTINCT engineer_id) > 1`, zero rows.

**Option A — DELETE `35a2f41c`, `engineer_id NOT NULL`, single unqualified
`UNIQUE (project_id, engineer_id, log_date)`.** Text: `028_dprs_engineer_id_option_a.sql` (attached,
same directory). Clean forever after — `engineer_id` is genuinely never null, no
downstream TypeScript type ever carries a defensive `| null` for a case that can't occur.
Cost: one destructive, irreversible-without-PITR operation against prod, on a row
confirmed worthless by direct query. **Trips §0 (d).**

**Option B — partial unique index, `engineer_id` stays nullable, `35a2f41c` untouched.**

```sql
ALTER TABLE public.dprs ADD COLUMN engineer_id UUID REFERENCES public.users(id);

UPDATE public.dprs d
SET engineer_id = (SELECT dl.engineer_id FROM public.daily_logs dl
                    WHERE dl.project_id = d.project_id AND dl.log_date = d.log_date LIMIT 1)
WHERE d.engineer_id IS NULL;
-- af7760e8 gets backfilled here regardless of which option is chosen — this
-- part is an UPDATE, not a DELETE, safe and correct either way.

CREATE UNIQUE INDEX dprs_project_engineer_date_key
  ON public.dprs (project_id, engineer_id, log_date)
  WHERE engineer_id IS NOT NULL;
-- 35a2f41c stays engineer_id IS NULL, permanently, outside this index,
-- never colliding with anything -- the new pipeline never again writes a
-- NULL engineer_id, so nothing will ever be protected incorrectly.
```

Every row the new pipeline ever writes carries a real `engineer_id`, so this protects
every real row exactly as fully as Option A's full constraint would. Zero irreversible
operations. **Does not trip §0 (d).** Cost: `engineer_id` stays nullable at the type
level forever, for a table that in practice will never have another null row — every
consumer (`dprs` page, detail page, any future code) carries a `| null` and a dead
defensive branch that can never fire, to accommodate one 2026-08-12 test artifact.

**Trade-off, stated honestly on both sides:** Option A is a one-time, well-documented,
PITR-backed operation on data already confirmed worthless, in exchange for permanent
schema/type cleanliness. Option B is zero risk in exchange for a permanent, small tax on
code clarity. **Recommendation: Option A** — the row's worthlessness is confirmed, not
assumed, and PITR here is a real, already-proven mechanism (025, 027), not a hypothetical
promise. **This is a recommendation, not a decision already made — §3's (d)-trips
conclusion below applies only if Option A is chosen.**

---

## 3. §0 external review gate — both readings kept intact, PLUS a correction

**Quoting condition (a) exactly, not paraphrased:**

> (a) CREATES OR MODIFIES a live function's LOGIC — what it computes, what it writes, who
> it lets do what. Narrowed to logic deliberately, not "any SQL touching a function"...

**Reading 1 — literal mechanism.** The gate's trigger is grammatically bound to "a
migration" throughout; (a)'s own contrast ("logic" vs. "any SQL touching a function") is
SQL-scoped on both sides. This migration modifies no Postgres function. Under this
reading, (a) does not trip.

**Reading 2 — bare wording, applied to the full change.** Taken out of the migration
framing, (a)'s wording ("modifies a live function's logic — what it computes, what it
writes") describes the TypeScript rewrite exactly: `generateDprJudgment`, `renderDpr`,
`handleDprGenerateJob`, `runDprGenerateTrigger`, `assembleDprFacts` all have their logic
substantially rewritten, writing a different artifact to `dprs.content`/`structured`,
reaching a real customer nightly. Under this reading, it trips.

**Both readings are presented, neither collapsed into the other, per Aravind's explicit
instruction.**

**CORRECTION, found while drafting the actual migration SQL for this package (not present
in the version Aravind already approved in substance) — condition (d) now trips
unambiguously, on its own, independent of either reading above.** The earlier version of
this evaluation concluded "(d) does not trip" on the reasoning that the migration was
purely additive (`ADD COLUMN` + widened `UNIQUE`). That was true of the migration as
originally sketched. It stopped being true the moment §3's backfill analysis (below)
concluded the honest resolution for `35a2f41c` is to **delete** it — there is no
`engineer_id` a backfill could correctly assign to a row with zero underlying engineers,
and inventing one would be worse than deleting a worthless marker. **A `DELETE` against a
production row is destructive by the plain meaning of condition (d), regardless of how
worthless the row is** — CLAUDE.md's own gate-history explicitly warns against exactly
the kind of self-serving minimization ("this row doesn't matter, so it doesn't count")
that would be required to argue otherwise, and I'm not going to make that argument.

**Corrected conclusion, now conditional on which of §2's two options is chosen** (this
package originally had only Option A, making the trip unconditional — see §2's revision):
**under Option A, this migration trips condition (d), formally, on the gate's own literal
terms — not just "warranted on the merits" as this package argues for the TypeScript
rewrite independent of the migration. Under Option B, (d) does not trip and the migration
is fully additive.** (b), (c), (e) do not trip under either option — no grant/RLS/auth/
money surface touched.

(b) restated for completeness: `dprs_select` RLS (project_members-scoped) needs no
change; grants (`REVOKE INSERT/UPDATE/DELETE`) untouched.

---

## 4. PITR — the runbook step, stated explicitly, before the delete (Option A only)

**Applies only if the reviewer picks Option A (§2).** Per CLAUDE.md §0's standing rule
("rollback mechanisms are verified by observation, never by checklist status"): **before
running the migration's `DELETE`, observe PITR directly** — `supabase backups list` (or
the dashboard's Backups → Point in time panel), confirm `pitr_enabled: true`,
`walg_enabled: true`, and note the actual restore window's upper bound at the moment of
the check. Pin that observed window in the applied runbook record (same discipline as
every prior apply this project has done — 025, 027). **Not done yet** — an apply-time
step, listed here so it can't be skipped or assumed from an earlier, unrelated check. Do
not run the migration file without this step immediately preceding it, in the same
session, observed live. **Moot under Option B** — no `DELETE`, no PITR dependency.

---

## 5. Holiday and mid-day-join engineers — explicit answers, not implied by the roster fix

**Holiday engineer: gets a report, no Claude call.** `is_holiday = true` on that
engineer's own `daily_logs` row is a fully-known fact — no synthesis needed, same reasoning
`schema.ts` already applies to any `not_captured` section ("the model's note is simply
unreachable at render time" for a section code already knows the answer to). The whole-day
verdict line is **code-templated** for this case ("Site closed — holiday" style, matching
`is_holiday`/`holiday_reason` the same way `lib/daily-logs/status.ts`'s existing holiday
handling already does), never sent to the model. This also means a holiday day costs
**zero** API tokens — relevant to §6.

Corroborated-but-unconfirmed holiday (no row at all, but a peer on the same project/day
reported `is_holiday = true`): reuse `accountability.ts`'s existing `'unconfirmed'` status
verbatim — the per-engineer report reads this as "may be a site closure, unconfirmed for
this engineer" rather than a flat "not received," per Rule 5.3's requirement to rule out
legitimate absence before a gap reads as one. Same no-Claude-call treatment — this is also
a fully-determined code state, nothing to synthesize.

**Mid-day join — now spec-authoritative, Rule 7 of `docs/dpr-engineer-report-spec.md`.**
Not restated in full here, to avoid two copies drifting; load-bearing points:
- Fourth check-in status, `not applicable`, evaluated per half independently; real data
  always wins over timing.
- **Threshold is the SEND time, not a cutoff** — `CHECKIN_CHECKPOINTS.morningSend`
  (07:30) / `.eveningSend` (18:30), from `lib/daily-logs/cutoffs.ts`, never hardcoded.
  This is a real correction from this package's own first draft, which used a cutoff
  (and the wrong, stale cutoff value at that) — recorded in §8 as the reason PR #59 is
  now a hard prerequisite, not a nice-to-have.
- Render string, spec's exact text: `Morning check-in: not applicable — joined this
  project today` (evening analogous).
- Does not count toward MISSING, does not lower completeness.
- A fully-`not_applicable` day (both halves) skips the Claude call entirely, same as
  holiday, above. A half-and-half day still calls the model.

---

## 6. Cost — stated with real measured figures, not invented ones

Measured baseline (`docs/design-decisions-beta-feedback.md`, "Cost per DPR, measured, not
estimated" — the old nine-field Judgment schema, standard $3/$15-per-MTok rate): **≈$0.0156
per DPR call** (n=2 golden cases, 1727–1887 input tokens, 473–880 output tokens).

**The new schema outputs one short sentence instead of five fields of prose — real
per-call cost should be lower, not higher, than this baseline. No measured figure exists
yet for the new schema (it doesn't exist until this ships), so the table below uses the
old-schema figure as a conservative upper bound, stated as such, not as a precise
prediction.**

**The scaling model changes, and this is the actual thing worth being visible about**: cost
was per PROJECT per day; it becomes per ENGINEER-WITH-REAL-EVENING-DATA per day — a holiday
or fully-silent engineer costs $0 in API calls (§5), so the numbers below are a worst case
(every roster engineer submits real evening data every day), not a typical case:

| Engineers per project | Daily cost (worst case, upper bound) | Monthly (×30) |
|---|---|---|
| 1 | ≈$0.0156 | ≈$0.47 (matches the existing measured "1 project" figure) |
| 5 | ≈$0.078 | ≈$2.34 |
| 20 | ≈$0.312 | ≈$9.36 |

Absolute numbers stay trivial even at 20 engineers. The point is the scaling axis changed
(project-count → engineer-count) and that's now visible before it ships, not discovered on
a bill, per Aravind's actual ask.

---

## 7. PR #59 — verified as the prerequisite, not assumed

**`CHECKIN_CHECKPOINTS` (the constant §5's `not_applicable` design depends on) only
exists on `feat/checkin-escalation-sweep`** — confirmed by reading the branch directly,
not assumed from its name. Not in `main`. **PR #59 must merge before this work starts.**

**Dashboard consequence, checked with the wider grep as instructed (including
`app/(dashboard)/`):** one direct importer of `cutoffs.ts` beyond the two already known —
**`app/(dashboard)/daily-logs/page.tsx`**, which passes `DEFAULT_CUTOFFS` into
`deriveHalfStatus` for both halves. Merging PR #59 moves `DEFAULT_CUTOFFS.morning` from
`'10:30'` to `'15:00'` — **this does move a live DASH-03 boundary immediately on merge.**
Per PR #59's own file header, this is intentional and correct: 15:00 is the already-
decided value from `docs/bot-flows.md` TRIGGER TIMES (2026-08-12), replacing a
customer-TBD placeholder that was never finalized — surfaced here before merge, not
discovered after.

**Tests verified against current `main`, not PR #59's stale base.** PR #59's merge-base
with `origin/main` was one merge behind current main (missing PR #60's dotenv-banner
fix). Verified in an isolated `git worktree` (no changes to the real working tree or to
PR #59's branch):
- `git merge origin/main`: clean, no conflicts.
- The three boundary-recalibrated cases in `daily-logs-status.test.ts`, plus its other
  13 tests: **16/16 pass.**
- PR #59's own four test files: **30/30 pass.**
- **46/46 total, `tsc --noEmit` clean.**
- **Full `npm test` run to completion: 567/568 passed, one timeout** —
  `test/migration-023.test.ts`'s `T-023-05: UNIQUE(project_id, log_date) rejects a
  duplicate` hit the 30s harness ceiling during the full run. **Named explicitly, not
  smoothed over, because it's the exact constraint this plan's migration replaces.**
  Re-ran that file alone immediately after: clean pass, 498ms, no assertion failure — a
  hard timeout with an immediate clean retry reads as test-db contention from the long
  concurrent run, not a logic regression. Doesn't change the merge recommendation; kept
  here because flagging and then quietly dropping it would defeat the point of this
  package.
- Worktree and throwaway branch removed after verification — nothing left on disk or on
  PR #59's own branch.

---

## 8. What to look hardest at

Aravind's list, kept in full:
1. **The roster-driven trigger** — can any engineer who owes a check-in fail to get a
   report? (`project_members JOIN users WHERE role='engineer' AND status='active'`,
   evaluated at 20:00 IST generation time.)
2. **`engineer_id NOT NULL` + the widened UNIQUE** — any path where the key stops
   protecting?
3. **The render-before-generate reorder** — anything that silently depended on the old
   order (model call before render)?
4. **Containment on rendered-body digits** — any way a verdict digit escapes the corpus
   built from the rendered body text?
5. **The retained multi-row assembler** — is `mergeDprFacts`/`assembleDprFacts` (kept,
   unused by the new per-engineer path, reserved for the deferred project report) still
   coherent as a caller-facing API once nothing in this codebase calls it?

Extending, from drafting this package:

6. **Option A vs. B for `35a2f41c` (§2).** Both fully written up, reviewer decides — look
   at whether the trade-off as stated (one-time PITR-backed delete vs. permanent nullable
   + dead defensive branch) is complete, or whether there's a third shape neither option
   considered.
7. **The no-Claude-call skip for holiday/fully-blank days (§5).** New logic this package
   introduces to answer Aravind's cost question — verify the trigger condition for
   skipping the model call is exactly right (fires when, and only when, there's genuinely
   nothing to synthesize) and can't under-fire on a day that's mostly blank but has one
   real thing worth summarizing.
8. **The `LIMIT 1` backfill for `af7760e8`** — correct today (confirmed single-engineer),
   but silently wrong the day it's copy-pasted as a general pattern rather than treated as
   the one-time, data-verified operation it is. Worth a second look that nothing downstream
   reuses this exact query shape as if it generalized.
9. **The `not_applicable` send-time logic (§5, spec Rule 7).** Check specifically whether
   the per-half comparison of `project_members.created_at` against `CHECKIN_CHECKPOINTS.
   {morningSend,eveningSend}` can ever mis-classify a real gap as `not_applicable`
   (silently excusing someone who actually did owe a check-in) — and, separately from the
   logic itself, whether `CHECKIN_CHECKPOINTS.morningSend`/`.eveningSend` (07:30/18:30) are
   themselves still correct on `main` post-merge, since PR #59 (§7) is what introduces
   them and this package's own confidence in the values is only as good as that merge.

---

## Attachments

- `028_dprs_engineer_id_option_a.sql` — Option A (DELETE), full text, same directory as this
  package.
- `028_dprs_engineer_id_option_b.sql` — Option B (partial unique index), full text, same
  directory.
- The design plan (all revisions) — already shared with Aravind in-session; not
  duplicated here in full to avoid two copies drifting. This package restates only the
  load-bearing parts (the migration, the gate evaluation, cost, holiday/mid-day-join).
