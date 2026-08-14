# DPR reformat — per-engineer report, plan only (revision 7)

**Revision 7 note — round 2 of external review came back. Verdict: STOP, revise, THEN
implement — Option A is decided and does not wait on the rest.** Full detail lives in
`docs/reviews/028-dpr-engineer-report-review-package.md` (this plan document is now
committed alongside it, in the same PR — see that package's S6). Summary of what changed,
so this plan file doesn't silently drift from the package it's paired with:

- **Option A vs. B was resolved on a MECHANICAL basis, not a trade-off.** §15 below framed
  this as risk-vs-permanence. That framing was wrong on its own terms: every `dprs` writer
  is a `supabase-js` `.upsert()` with `onConflict:'project_id,log_date'`, and Postgres only
  honors a **partial** unique index as an `ON CONFLICT` arbiter when the conflict clause
  carries a matching `WHERE` predicate — `supabase-js` cannot express that. Option B would
  have thrown `42P10` on every upsert, the first night. **Option A is decided.** §15's
  trade-off framing stands as a record of what round 1 got wrong, not as a live choice.
- **B1 (blocking):** `engineer_id`'s FK must be the house composite same-tenant pattern —
  `(engineer_id, tenant_id) REFERENCES users(id, tenant_id)`, per 017's precedent and 027's
  (three days prior) enforcement of it — not the plain `REFERENCES users(id)` §3 specified.
  Folded into the migration; full precedent/lineage check in the review package §8.
- **B2 (blocking):** a full inventory of `(project_id, log_date)` key-consumer sites, with
  line pins, found **three genuinely broken call sites** the earlier revisions missed: the
  cron dedup's JSONB containment match (`route.ts:89`), the error-path revert
  (`dispatch.ts:127-131`), and `markDprGenerationFailed` — all three would silently affect
  every engineer's row for a project-day instead of just one. Full inventory + fixes:
  review package §9.
- **B3 (blocking):** migration/deploy sequencing was unaddressed — the gap between
  applying the widened constraint and deploying the code that targets it is live breakage.
  Hard sequence now specified (PITR → apply outside the 20:00 window → deploy immediately
  → confirm live before 20:00): review package §10.
- **S1–S7 (should-fix):** containment corpus region now stated exactly (not just "the
  rendered body" — the four pair lines + MISSING + NEEDS ATTENTION, explicitly excluding
  header/date, cross-referencing the 2026-08-11 `ContainmentMeta` decision by date); the
  degraded-path spec (§5 below) extended to cover retry-exhaustion, not just single-attempt
  failure; the roster fix (§1 below) corrected to a **union** (active roster ∪ engineers
  with real `daily_logs` data), not roster alone, plus an explicit dated decision to
  deactivate the test engineer before shipping; the zero-roster case decided (accepted,
  dated regression, not silently fixed); `docs/dpr-engineer-report-spec.md` itself updated
  for the `not_applicable` conditional-on-crons framing, IST-explicit comparison, and
  re-added-membership policy; this plan document committed into the PR; raw catalog/probe
  output pinned in the migration file itself. Full detail: review package §11–§14.
- **N1 — a real conflict, not resolved unilaterally.** The review asked for
  `supabase/migrations/026_dpr_generation_stale.sql` to be edited (rebased + noted).
  Checked first: that file has no keying logic to rebase at all (it's a bare
  `ADD COLUMN`) — the substance is recorded in the review package instead. The file
  itself has NOT been touched, because doing so would override the explicit, repeatedly-
  stated standing instruction that it "stays untracked and untouched." Flagged for
  Aravind's confirmation rather than guessed either way.
- **N2:** `docs/schema.md`'s `dprs` entry is a required close-out item once 028 applies;
  027's own `schema.md` entry has been open since Tuesday (2026-08-11) — named so 028
  doesn't stack a second gap on the first, not fixed in this pass.

**Still nothing implemented.** This revision is plan-and-package correction only.

**Revision 6 note:** `docs/dpr-engineer-report-spec.md` was updated on disk — Rule 7 now
directly specifies `not_applicable`, its render string, and its threshold rule. §16 below
is rewritten to defer to the spec as authoritative rather than re-deriving the design, and
corrects two things §16 (revision 5) got wrong:
1. **Wrong constants.** Cited `cutoffs.ts` at "10:30/19:30" — 10:30 was already stale
   (superseded by PR #59's own dated correction to 15:00) and, separately, a *cutoff* was
   never the right constant for this question at all.
2. **Wrong threshold, semantically, independent of the stale number.** A cutoff answers
   "when do we stop waiting" — the question here is "was this engineer on the roster when
   the question went out." Those differ: someone joining at 11:00 never received the
   morning question at all; testing against a 15:00 cutoff would still class them as
   owing it. The spec now states this precisely (Rule 7) and requires the **send** times —
   `CHECKIN_CHECKPOINTS.morningSend` (07:30) / `.eveningSend` (18:30) — never the cutoffs,
   never hardcoded.

**Consequence: PR #59 must merge before this work, since `CHECKIN_CHECKPOINTS` only
exists on that branch.** Verified, not assumed — see §17.

**Revision 4 note (carried forward):** revision 3 was approved in substance; revision 4
folded in three conditions (PITR-before-delete sequencing, holiday/mid-day-join enqueue
decisions, cost visibility) — §12, §13, §14. **§2's conclusion ("(d) does not trip") is
corrected in §12 — do not read §2 as final on that point.**

**Revision 5 note:** two more corrections, both explicitly left for the external reviewer
to decide rather than pre-decided here:
1. **§15 (new)** — the migration's `DELETE` is presented as one of two real options, not
   the only path; a partial-unique-index alternative avoids it entirely. This makes §12's
   "(d) trips" conclusion **conditional on which option is chosen**, not unconditional —
   see §15 for the corrected framing.
2. **§16 (new)** — the mid-day-join case from §14 is no longer "flagged, not fixed." It's
   designed in full: a real gap (every new engineer's first day would otherwise read as a
   failure to report), not an edge case, per the explicit pushback that "known
   consequence" wasn't an argument for deferring it.

Full review package, including the migration's exact SQL text and both revision-5
additions: see `028-dpr-engineer-report-review-package.md` and `028_dprs_engineer_id.sql`
(both updated to match this revision).

## Context

The 2026-08-13 unattended DPR run rendered `"No equipment reported this morning"` when a
JCB *was* reported. `docs/dpr-engineer-report-spec.md` replaces the report format to close
this structurally: one report per engineer per day, a four-line body where every line is a
planned/actual pair sourced from a fixed question-to-field binding, free text rendered
verbatim in quotes, and the model restricted to one containment-checked verdict sentence.
Scope is per-engineer only — the project-level report is explicitly deferred.

This revision answers six correctness/rigor gaps found in review of revision 2, plus one
direct question about where cross-engineer status now lives. Nothing has been implemented;
this is still plan-only.

---

## 1. FIX — a silent engineer must still produce a report (roster-driven trigger)

**Revision-7 correction (S3): the eligible set is a UNION, not the roster alone —
`active project_members` ∪ `engineers with a daily_logs row for log_date`.** An engineer
who submits real data and is then deactivated or moved off the project before the 20:00
generation run would otherwise drop out of a roster-only query while their real
`daily_logs` rows persist unrendered — Rule 7's own "real data always wins" principle
applies here too. Full detail: review package §5.

Revision 2 moved DPR-17's skip from "project has no `daily_logs` rows" to "engineer has no
`daily_logs` row" — backwards, since an engineer who submitted nothing is the report's most
important thing to say, not a reason to say nothing.

**Corrected design:** `runDprGenerateTrigger` enumerates the **roster**, not `daily_logs`.
Reuse the exact query shape `lib/dpr/accountability.ts`'s `assembleAccountability` already
uses (and PR #59's `lib/checkin-escalations/roster.ts` mirrors for the same reason):

```
project_members JOIN users!inner(id, full_name, role, status)
  WHERE project_members.project_id = :project_id
    AND users.role = 'engineer'
    AND users.status = 'active'
```

For every `(project, roster engineer)` pair on an active project, enqueue one
`dpr_generate` job — **unconditionally**, whether or not that engineer has a `daily_logs`
row for today. No more project-level DPR-17 skip; skip becomes per-engineer, per the
existing `daily_logs` presence check, and even a "skip" still writes a full report:

- **Holiday exclusion**: mirror `accountability.ts`'s own logic exactly, don't reinvent it
  — an engineer whose **own** `daily_logs.is_holiday = true` gets a report saying so (site
  closed), not "not received." An engineer with **no** row at all, on a day another
  engineer on the same project reported `is_holiday = true`, gets the same `'unconfirmed'`
  treatment `accountability.ts` already applies (corroborating evidence, not proof — Rule
  5.3's ruling-out-legitimate-absence requirement) — the per-engineer report should read
  this as "may be a holiday, unconfirmed for this engineer" rather than a flat "not
  received," reusing `statusFor`'s existing three-way logic (`submitted`/`missing`/
  `unconfirmed`) rather than the two-way "row exists or doesn't" this plan's revision 2
  assumed.
- **`status='active'` exclusion**: same filter as `accountability.ts` — a deactivated
  engineer never appears on the roster and gets no report generated for them at all
  (matches ENG-registration semantics; there's no "was on the roster, now isn't" state to
  report on).
- **No `daily_logs` row, not a holiday**: report reads `Morning check-in: not received /
  Evening check-in: not received`, every body line `planned: <if morning ever ran before>
  / not reported`, `not reported` on the actual side — actually: with zero `daily_logs`
  row, EVERY field (both planned and actual) is `not_captured`, so the correct rendering is
  `not reported` on **both** sides of every pair line, and the verdict sentence has no
  Facts to cite (see §5's containment-failure design — this is exactly the "empty corpus"
  case that design has to handle cleanly, not as an error).

This also changes the migration's engineer_id sourcing model (§3) and the cron route's
control flow more substantially than revision 2 stated: the loop is now
`for each active project → for each roster engineer → enqueue`, not
`for each active project with daily_logs today → for each contributing engineer →
enqueue`.

---

## 2. RE-EVALUATED — CLAUDE.md §0, against the full change, quoted precisely

Quoting the gate's actual text rather than characterising it:

> A migration (or a PR bundling several...) requires an external review package... when
> it: (a) CREATES OR MODIFIES a live function's LOGIC — what it computes, what it writes,
> who it lets do what. **Narrowed to logic deliberately, not "any SQL touching a
> function"**...

**Two readings, both taken seriously, not just the convenient one:**

- **Literal-mechanism reading:** the gate's trigger mechanism is grammatically bound to "a
  migration" throughout the whole numbered list — every condition reads as "when **it**
  [the migration] creates/modifies/touches..." (a) itself contrasts "logic" against "any
  SQL touching a function" — both halves of that contrast are SQL-scoped, which is only a
  meaningful contrast if (a) is about Postgres functions in the first place. Applied to
  this plan's one migration (`engineer_id` on `dprs` — no Postgres function touched at
  all, confirmed by grep, zero `.rpc()` calls anywhere in the DPR pipeline): **does not
  trip.** This part of revision 2's conclusion stands, on this narrow question.
- **Bare-wording reading, applied to the full change as instructed:** taken out of the
  "migration" framing, (a)'s own wording — "modifies a live function's logic — what it
  computes, what it writes" — describes this change exactly. `generateDprJudgment`,
  `renderDpr`, `handleDprGenerateJob`, `runDprGenerateTrigger`, `assembleDprFacts` all have
  their logic substantially rewritten: what they compute changes, what they write to
  `dprs.content`/`structured` changes completely, and the artifact reaches a real customer
  nightly. Read this way, **it trips.** The gate's own separate line — "THE TRIGGER IS
  SUBJECT MATTER, NOT DDL SHAPE" — exists precisely to stop an author narrowing scope by
  form rather than substance; that line is about migrations' own DDL shape, but the
  reasoning it embodies (don't let a technically-true scoping argument excuse a
  consequential change from scrutiny) applies with equal force here.

**Conclusion, stated plainly rather than picked around: the formal gate mechanism, as
literally written, is migration-triggered and this migration doesn't trip it — so the
gate does not *compel* the review package for this PR.** I am not going to pretend that
settles the question, because it doesn't answer what was actually asked.

**On the merits, independent of whether the gate compels it: yes, this warrants external
review.** Reasons, not just an instinct:
- This is the exact class of change CLAUDE.md's own §0 history says the gate exists for —
  a "first unattended run" already produced one confidently-wrong statement in a
  customer-facing document, from the *current* pipeline. The replacement pipeline is
  larger, touches more files, and — same document — the same failure mode (a false
  negative stated as fact) is exactly what §5's containment-failure design (below) has to
  guard against for the *new* pipeline too.
- CLAUDE.md's own recorded lesson from migration 027 (the first review that ran BEFORE any
  code touched a database) states the payoff precisely: "the same three findings, caught
  retroactively instead, would have been live defects... not lines in a migration nobody
  had run yet." The DPR generator runs live, nightly, unattended, on prod — a defect here
  is live the first night it ships, same shape as an unreviewed migration, even though it
  isn't one.

**Recommendation: request the same review discipline (a package per
`docs/migration-runbook-template.md`'s shape, or the closest sensible TypeScript analogue —
the runbook template is migration-shaped and would need adapting, not applying verbatim) as
a standing decision on this PR, before cutover — not because the rule's literal text
compels it, but because the rule's own reasoning does.** This is my recommendation to
Aravind, not something I'm treating as already decided.

---

## 3. FIXED — the `engineer_id` migration, in full, with real numbers behind it

Checked against prod directly rather than assumed. **Every existing `dprs` row, queried
live:**

| id | project_id | log_date | underlying `daily_logs` engineers |
|---|---|---|---|
| `35a2f41c-...` | `acef67fe-...` | 2026-08-12 | **zero** — `skipped_no_data`, no rows exist |
| `af7760e8-...` | `acef67fe-...` | 2026-08-13 | **one** — `3534756b` only |

**No multi-engineer merge exists in prod today** — confirmed by query, not assumed from
the spec's "beta is single-engineer" claim. This makes the nullability question concrete
rather than hypothetical:

- **The NULL-uniqueness bug, stated exactly:** Postgres treats every NULL as distinct in a
  standard `UNIQUE` constraint, so `UNIQUE (project_id, engineer_id, log_date)` with a
  nullable `engineer_id` would let unlimited rows share `(project_id, NULL, log_date)` —
  the constraint stops protecting anything for any row lacking an engineer_id. **Fix:
  `engineer_id UUID NOT NULL REFERENCES public.users(id)`**, not nullable, no partial
  index needed — the small, exact backfill below makes NOT NULL achievable directly rather
  than working around nullability.
- **Backfill, stated per row, not hand-waved:**
  - `af7760e8` → `engineer_id = 3534756b-2a32-4b91-954b-0bab15c2dba1` (its one real
    contributing engineer — `UPDATE dprs SET engineer_id = (SELECT engineer_id FROM
    daily_logs WHERE project_id = dprs.project_id AND log_date = dprs.log_date LIMIT 1)`
    is safe and correct only because every row today happens to have at most one engineer
    — this is a real assumption, stated here so a future re-reader doesn't miss it, not a
    general-purpose backfill rule).
  - `35a2f41c` → **no correct value exists.** It's a project-level `skipped_no_data`
    marker from the OLD design (zero `daily_logs` rows, `content: null`, never delivered) —
    a concept that has no equivalent under the new schema, since skip is now per-roster-
    engineer (§1), not per-project. **Recommendation: delete this one row as part of the
    migration**, with the reasoning in the migration's own comment — it's test/beta data
    from initial cron wiring (2026-08-12), not delivered, not real content, and keeping it
    would mean either fabricating an `engineer_id` for a row with no engineer behind it, or
    carrying a permanent nullable escape hatch for exactly one historical artifact. Flagging
    this explicitly as a delete, not silently folding it into "the backfill," since deleting
    a row — even an empty test one — is worth naming plainly rather than passing through
    quietly.
- **"Reversible" — qualified, not asserted flatly.** The schema change itself
  (`DROP CONSTRAINT` / `ADD COLUMN` reversal) is clean **only while no two rows share
  `(project_id, log_date)` with different `engineer_id` values** — true today (one
  engineer per project), but false the moment the new per-engineer pipeline runs for real
  on a multi-engineer project, which is the whole point of this work. **Stated plainly:
  this migration is reversible now, and stops being cleanly reversible the first time it
  does its job for more than one engineer on the same project-day** — a rollback after
  that point requires a real data decision (which engineer's row survives under the old
  2-column key), not a schema-only revert. This should be in the migration's own header
  comment, not left implicit.

---

## 4. FIXED — containment corpus narrowed to what's actually rendered

Agreed: whole-`DprFacts` corpus was too loose — it would let the verdict cite a number the
reader can't find anywhere near it (a suppressed or otherwise-unrendered Fact). **Narrower
rule: the corpus is the set of digits appearing in the report's own rendered body text**
(the four pair lines + MISSING + NEEDS ATTENTION), not the whole assembled Facts object.
Header/date is excluded, same reasoning `containment.ts`'s existing `ContainmentMeta`
already documents (a date's digits sit in the same magnitude band as real quantities).

**Implementability — requires, and gets, a pipeline reorder, stated explicitly:**
Today `dispatch.ts` calls the model (`generateDprJudgment`) **before** `renderDpr`, because
the old design's per-section model notes had to be merged **into** the render. That
dependency is gone: the new verdict sentence is model output, but it sits as its **own
line**, never interpolated into the four body lines (confirmed against both of the spec's
worked samples — the verdict sits between the check-in statuses and the body, not
inside it). Body construction and verdict generation are independent given the same Facts.
**New order:**

1. Assemble Facts (single-engineer).
2. Render the **body** (four pair lines + MISSING/NEEDS ATTENTION) — pure code, zero model
   involvement, matches Rule 2 directly, and can run before or after step 3/4 with no
   ordering constraint of its own.
3. Build the corpus directly from that rendered text: `extractDigitTokens(renderedBody)` —
   **no bespoke Facts-walking corpus builder needed at all**, simpler than revision 2's
   `buildDayCorpus` proposal, since `extractDigitTokens` (containment.ts, unchanged)
   already does exactly this on a string.
4. Call the model for the verdict sentence; check containment against that corpus.
5. Compose final `content` = header + check-in statuses + verdict (or its fallback, §5) +
   already-rendered body.

This is implementable without any design compromise — the reorder is a genuine
simplification, not a workaround.

---

## 5. FIXED — containment-failure behaviour, stated exactly, with a test

**Decision: on containment failure, render a code-generated neutral line in the verdict's
position — never omit the line entirely, and never block the report.**

Reasoning for neutral-line over omit-entirely: a blank gap exactly where a summary sentence
is expected reads as a rendering bug to a PM/owner, not as a deliberate state; a plain,
honest placeholder ("Summary unavailable for this report.") is legible on its own and
doesn't need the reader to infer why nothing is there.

**Exact behaviour:**
- Body (step 2 above) is already fully rendered and doesn't depend on the model call at
  all — **it always ships**, containment failure or not. This is a real improvement over
  today's design, where `generateDprJudgment` throwing `DprValidationError` blocks the
  *entire* report (`dispatch.ts`'s catch reverts `generation_status`, nothing gets
  written) — under the old nine-field schema this was already all-or-nothing (any one
  field's violation killed the whole thing), so "no partial fallback" isn't a regression
  from something that existed before; it's the same as before, now consciously kept
  narrow (verdict-only) rather than global.
- On failure: `dprs.content`/`structured` **still gets written**, `generation_status`
  **stays `'idle'`** (this run succeeded — it produced a real report, just without a
  narrative sentence), the verdict slot holds the neutral placeholder, never the tainted
  model text.
- **"Must not silently omit that anything was dropped"**, satisfied two ways: (a) Sentry
  capture, same `feature: 'dpr-generate', failure_class: 'dpr_validation'` tag pattern
  already used for the today's-still-succeeds-on-retry case; (b) a machine-readable marker
  in `structured` (e.g. `verdict_status: 'containment_failed'`) so the archive/detail UI
  *could* surface this distinctly later, even though wiring that into the UI isn't part of
  this pass — the marker exists so the information isn't lost, whether or not it's
  displayed yet.
- **New test, named explicitly (goes in §8's list, not left implicit):** feed
  `generateDprJudgment`'s response path a verdict sentence containing an uncontained digit;
  assert (1) the body still renders in full and correctly, (2) the verdict is the neutral
  placeholder text, not the model's tainted sentence, (3) `dprs.content`/`structured` is
  still written, (4) `generation_status` is `'idle'`, not left at `'running'` or reverted
  in a way that looks like failure, (5) Sentry is called with the right tags.

---

## 6. REVERSED — keep `case-complete-two-engineer-day.ts`

Correct — this was a mistake in revision 2. §2's own recommendation keeps
`mergeDprFacts`/`assembleDprFacts` and the suppression apparatus alive, untouched, for the
deferred project report; deleting their only multi-engineer fixture would leave that real,
retained code untested from today until whenever that report gets built — exactly the kind
of silent rot CLAUDE.md's own testing discipline exists to prevent. **Corrected: keep the
fixture and its test, pointed at the retained multi-row `mergeDprFacts`/`assembleDprFacts`
path, unchanged.** Nothing about this plan's per-engineer work touches it.

---

## Cross-engineer status — where it lives now, named directly

**Not PR #59.** Checked PR #59's actual diff (`git diff main
origin/feat/checkin-escalation-sweep`, read-only, branch untouched): it adds
`lib/checkin-escalations/{roster,status,reachability,sweep}.ts` — escalation-sweep
*backend* logic only. Its own file header says plainly: "NOT REGISTERED AS A CRON ROUTE —
no app/api/ file calls this yet," and a repo-wide grep for `checkin_escalations` under
`app/` returns nothing — there is no dashboard surface reading that table yet. PR #59 is
where this plan's roster-query *pattern* comes from (§1), not where the cross-engineer
*view* lives.

**The real answer: `app/(dashboard)/daily-logs/page.tsx` (DASH-03), which already exists
and already does this job, independent of the DPR entirely.** Its own header comment:
"DASH-03 Daily Logs — PM triage board. One card per engineer per day, morning [&] evening
[status]... Scoped to the PM's projects via project_members." This is a PM's existing,
already-built, cross-engineer check-in view — the gap ACCOUNTABILITY's removal opens is
real but not unaddressed: it was never the *only* place this information lived, and the
place that remains was built independently and stays untouched by this work.

---

## Everything else from revision 2, carried forward unchanged

**§1 Assembler audit, §2 pair Fact shape, §4 spec-rule enforcement points, §5→ now §1's
roster fix supersedes the check-in-status recoverability discussion only where it touches
"no row at all" — the Q3/Q5 structural-skip recoverability finding is unchanged, still
correct: Q3 skip is derivable from `evening_schedule_met`, Q5 skip from `morning_equipment`
itself, and a genuinely abandoned mid-flow turn remains unrecoverable from `daily_logs`
alone (would need a new `whatsapp_sessions.current_step` read, not built here).**

Consumers (§7 prior), test list (§8 prior, now also carrying case-complete-two-engineer-
day.ts as KEPT not retired, and the new containment-failure test from §5 above), and the
`af7760e8` regeneration-as-verification-case plan (§9 prior) are unchanged by this
revision and not restated here to avoid drift between two copies — this document is the
current one.

## Files changed — updated for this revision

- `supabase/migrations/0NN_dprs_engineer_id.sql` — `ADD COLUMN engineer_id UUID NOT NULL
  REFERENCES public.users(id)` with the exact backfill in §3 (one `UPDATE` for `af7760e8`,
  one `DELETE` for `35a2f41c`, both named in the migration's own comment, not silent);
  `UNIQUE (project_id, engineer_id, log_date)`. No RLS/grant change.
- `app/api/cron/dpr-generate/route.ts` — roster-driven loop per §1, not
  data-presence-driven.
- `lib/dpr/dispatch.ts` — render-before-generate ordering per §4; containment-failure
  handling per §5.
- `lib/dpr/containment.ts` — no new Facts-walking corpus function needed (§4 simplifies
  this away); reuses `extractDigitTokens` directly on rendered body text.
- Everything else from revision 2's file list stands: `schema.ts` (`CapturedText`,
  one-field `DprJudgment`), `assemble.ts` (new single-row assembler, old multi-row path
  kept), `generate.ts` (one-field schema), `render.ts` (new renderer, body-first),
  `narrative-context.ts` (single-row simplification), both `dprs` page files.

## 12. CORRECTION to §2 — condition (d) trips, once the migration is fully specified

§2's original conclusion ("(d) does not trip") was reached before §3's backfill analysis
had settled what happens to `35a2f41c` (the zero-`daily_logs` skip marker with no
engineer to backfill to). That analysis concludes the honest resolution is to **delete**
it — no `engineer_id` exists to correctly assign, and inventing one would be worse than
removing a worthless marker. A `DELETE` against a production row is destructive under
condition (d)'s plain wording, regardless of how little the row is worth — rounding that
down to "doesn't count" is exactly the kind of self-serving narrowing CLAUDE.md's own gate
history warns against.

**Corrected: this migration trips (d), formally, on the gate's own terms.** The external
review package is therefore required by the standing rule, not merely warranted "on the
merits" as §2's closing recommendation argued for the broader TypeScript rewrite. (b),
(c), (e) still don't trip; reading 1 vs. reading 2 on (a) both still stand, unresolved,
as presented — this correction doesn't touch (a) at all, only (d).

PITR must be observed live, immediately before the `DELETE` runs, per §13.

---

## 13. FOLDED IN — PITR before the delete, stated as an explicit runbook step

Per CLAUDE.md §0 ("rollback mechanisms are verified by observation, never by checklist
status"): before running the migration's `DELETE` statement, observe PITR directly
(`supabase backups list` or the dashboard's Backups → Point in time panel), confirm
`pitr_enabled: true` and `walg_enabled: true`, and record the actual restore window's
upper bound at the moment of the check — same discipline as every prior prod apply this
project has done (025, 027). **Not done yet** — an apply-time step, named here so it
can't be skipped or assumed from an earlier, unrelated PITR check. The migration file's
own comments point back to this section rather than re-asserting it inline.

---

## 14. FOLDED IN — holiday / mid-day-join enqueue decisions, and cost

**Holiday engineer:** report generated, **no Claude call**. `is_holiday=true` is a fully-
known fact — same reasoning `schema.ts` already uses for any `not_captured` section (code
already knows the answer, the model's note is unreachable). The verdict line is
code-templated ("Site closed — holiday" style), matching `lib/daily-logs/status.ts`'s
existing holiday handling. Corroborated-but-unconfirmed (no row, but a peer reported
`is_holiday=true`) reuses `accountability.ts`'s `'unconfirmed'` status verbatim — also no
model call, also a fully-determined code state.

**Mid-day join (`status='active'`, joined `project_members` partway through the day): no
special-casing, flagged as a known consequence, not fixed.** Roster is evaluated at 20:00
IST generation time; anyone active at that moment gets a full-day report, honestly
"not received" for whatever wasn't captured — can read as a full-day gap for someone only
eligible part of the day. `project_members.created_at` exists (confirmed, migration
001) and could support a future cutoff-aware fix; out of scope here.

**Cost, from the real measured baseline** (`docs/design-decisions-beta-feedback.md`:
≈$0.0156/DPR, n=2, old nine-field schema, standard $3/$15-per-MTok rate — the new
one-field schema should cost less per call, not more, so this is a conservative upper
bound, not a prediction). The scaling axis changes from per-project to
per-engineer-with-real-evening-data (holiday/silent engineers cost $0, per the no-call
design above), so the table below is a worst case, not typical:

| Engineers/project | Daily (worst case) | Monthly (×30) |
|---|---|---|
| 1 | ≈$0.0156 | ≈$0.47 |
| 5 | ≈$0.078 | ≈$2.34 |
| 20 | ≈$0.312 | ≈$9.36 |

Trivial in absolute terms; the point is the scaling model changed and is now visible
before shipping, not discovered on a bill.

---

## 15. `35a2f41c` disposition — Option A DECIDED (revision 7); this section is now a record

**Superseded by round 2 of review: Option A is decided, on a mechanical basis, not the
trade-off framed below.** Every `dprs` writer is a `supabase-js` `.upsert()` with
`onConflict:'project_id,log_date'`; Postgres cannot use a partial unique index as an
`ON CONFLICT` arbiter without a matching `WHERE` predicate on the conflict clause, which
`supabase-js` has no way to express. Option B would `42P10` on every upsert, immediately.
This section is kept as-is below — a record of the trade-off as it was understood in
round 1, now known to be wrong on its own terms — not a live decision point. See the
review package §2 for the correction.

### Original (round-1) trade-off framing, for the record

**Option A — DELETE (what §3/§12 assumed).** Backfill `af7760e8`, delete `35a2f41c`,
`ALTER COLUMN engineer_id SET NOT NULL`, single unqualified `UNIQUE (project_id,
engineer_id, log_date)`. Clean forever after: the column is genuinely never null, every
downstream TypeScript type is `engineer_id: string` with no defensive null-handling
anywhere, ever. Cost: one destructive, irreversible-without-PITR operation against prod,
on a row that is confirmed worthless (`content IS NULL`, `delivered_owner_at IS NULL`,
never shown to anyone) but is still a real `DELETE`. Trips §0 (d), needs the PITR runbook
step (§13), needs the review this package already requests.

**Option B — partial unique index, `engineer_id` stays nullable.**

```sql
ALTER TABLE public.dprs ADD COLUMN engineer_id UUID REFERENCES public.users(id);

-- af7760e8 still gets backfilled — this part is unconditionally correct and
-- unconditionally safe (an UPDATE, not a DELETE) regardless of which option
-- is chosen; it's still true that the new per-engineer pipeline needs this
-- row correctly attributed to avoid an orphaned duplicate on the next
-- generation for that same (project, engineer, date).
UPDATE public.dprs d
SET engineer_id = (SELECT dl.engineer_id FROM public.daily_logs dl
                    WHERE dl.project_id = d.project_id AND dl.log_date = d.log_date LIMIT 1)
WHERE d.engineer_id IS NULL;

-- 35a2f41c is untouched — stays engineer_id IS NULL, permanently, sitting
-- outside the constraint below, never colliding with anything because the
-- new pipeline never again writes a NULL engineer_id.
CREATE UNIQUE INDEX dprs_project_engineer_date_key
  ON public.dprs (project_id, engineer_id, log_date)
  WHERE engineer_id IS NOT NULL;
```

Every row the new pipeline ever writes carries a real `engineer_id`, so the partial index
protects every real row exactly as fully as the full constraint would. The one legacy row
sits outside it, inert, forever. No `DELETE`, no PITR step, no trip on §0 (d) — fully
additive.

**Trade-off, stated honestly, not minimized on either side:**
- Option A costs one irreversible prod operation (mitigated: real, tested PITR; a
  confirmed-worthless row) but leaves the schema and every downstream type permanently
  clean — `engineer_id` is simply never null, forever, matching what's actually true of
  the table from this point forward.
- Option B costs zero irreversible operations but leaves `engineer_id` **permanently
  nullable at the type level** for a table where, in practice, it will never again be
  null — every consumer that reads `dprs.engineer_id` (both dashboard pages, any future
  code) carries a `| null` in its type and a dead defensive branch that can never actually
  fire, forever, to accommodate one 2026-08-12 test artifact. This is a small, permanent
  tax on code clarity versus a one-time, well-documented, PITR-backed operation on data
  that has already been confirmed worthless by direct query.

**My recommendation: Option A.** The row is genuinely worthless (confirmed, not assumed)
and PITR here is a real, already-proven mechanism, not a hypothetical promise — the
one-time cost is small and bounded, while Option B's cost is small per-instance but never
goes away. **This is a recommendation, not a decision already made** — the reviewer should
pick, and §12's "(d) trips" conclusion applies only if Option A is chosen; under Option B,
(d) does not trip and this migration would be fully additive.

---

## 16. `not_applicable` — now spec-authoritative (Rule 7), plan defers to it

`docs/dpr-engineer-report-spec.md` Rule 7 now states this fully and is the source of
truth — not restated in full here to avoid two copies drifting. Load-bearing points for
implementation, quoted/summarized from the spec directly:

- Four-value vocabulary: `complete` / `partial` / `not received` / `not applicable`.
- Evaluated **per half, independently**; real data always wins regardless of timing.
- Threshold is `project_members.created_at` (IST) falling on `log_date` **after that
  half's SEND time** — `CHECKIN_CHECKPOINTS.morningSend` (07:30) /
  `.eveningSend` (18:30) — **never** the cutoff times, and never hardcoded; both constants
  come from `lib/daily-logs/cutoffs.ts`'s `CHECKIN_CHECKPOINTS`.
- Render string: `Morning check-in: not applicable — joined this project today` (spec's
  exact text; evening analogous).
- Does not count toward MISSING, does not lower completeness.
- A fully-`not_applicable` day (both halves) skips the Claude call entirely, same as
  holiday (§14). A half-and-half day still calls the model.

**Why the earlier draft of this section was wrong, not just imprecise, kept here as the
record of the correction rather than silently dropped:** it cited `cutoffs.ts` at
"10:30/19:30" and used a *cutoff* as the threshold. Both wrong, independently. 10:30 was
already stale — PR #59 (§17) corrects it to 15:00, sourced from `docs/bot-flows.md`
TRIGGER TIMES (2026-08-12), a decision this plan hadn't read. Separately, and this would
have been wrong even against the correct number: a cutoff answers "when do we stop
waiting," not "was this person on the roster when the question went out" — those are
different questions, and testing the wrong one would have classed an 11:00 joiner (never
sent the morning question at all) as owing it. The spec's send-time threshold is the
right question; this plan now just points at it rather than re-deriving it.

---

## 17. PR #59 — verified as the prerequisite, not assumed

**`CHECKIN_CHECKPOINTS` only exists on `feat/checkin-escalation-sweep`** — confirmed by
reading the branch directly (`git show origin/feat/checkin-escalation-sweep:lib/daily-
logs/cutoffs.ts`). Not in `main`. §16's design cannot be built without it landing first.

**The dashboard consequence, checked, not assumed correct:** re-ran the cutoffs.ts
importer grep, this time including `app/(dashboard)/` as instructed. One direct importer
beyond the two already known: **`app/(dashboard)/daily-logs/page.tsx`** imports
`DEFAULT_CUTOFFS` directly and passes it into `deriveHalfStatus` for both halves (lines
7, 81-83, 132-133). Merging PR #59 moves `DEFAULT_CUTOFFS.morning` from `'10:30'` to
`CHECKIN_CHECKPOINTS.morningCutoff` (`'15:00'`) — **this does move a live DASH-03
boundary**, immediately on merge, not as a side effect discovered later. Per PR #59's own
`cutoffs.ts` header, this is intentional: the 15:00 figure is board and sweep agreeing on
one already-decided number (`docs/bot-flows.md` TRIGGER TIMES), replacing a customer-TBD
placeholder that was never finalized — not a new decision this plan is making, a
pre-existing one this plan is surfacing before merge rather than after.

**Tests verified against current `main`, not against PR #59's own stale base.** PR #59's
merge-base with `origin/main` is `4c6a682` — one merge behind current main (`d620f09`,
PR #60's dotenv-banner fix), so it hadn't been checked against the latest tip. Verified in
an isolated worktree (`git worktree add`, no changes to the actual working tree or to PR
#59's branch itself):
- `git merge origin/main` into the worktree: **clean, no conflicts** (only `ci.yml`
  touched by both sides, merged without collision).
- The three boundary-recalibrated cases in `test/unit/daily-logs-status.test.ts`
  ("today, after cutoff, missing", the IST-conversion regression guard, and "evening
  cutoff does not fire early using the morning time") plus the file's other 13 tests: **16/16
  pass.**
- PR #59's own four new test files (`checkin-escalations-{status,roster,reachability,
  sweep}.test.ts`): **30/30 pass**, including the ones hitting real test-db.
- **46/46 total, `tsc --noEmit` clean**, merged against current main.
- **Full `npm test` also run in the same worktree, to completion: 567/568 passed, one
  timeout** — `test/migration-023.test.ts`'s `T-023-05: UNIQUE(project_id, log_date)
  rejects a duplicate` hit the harness's 30s ceiling during the full-suite run.
  **Directly relevant to name, not gloss over: this is the exact constraint this plan's
  own migration replaces.** Re-ran that file in isolation immediately after: passed
  cleanly, 498ms, no assertion failure — a hard timeout with a clean, fast pass on retry
  is the signature of test-db contention during a long concurrent run, not a logic
  regression from merging PR #59 + main. Doesn't change the "safe to merge" conclusion,
  but recorded here rather than silently smoothed over, since flagging it and then
  omitting it would be exactly the kind of thing this whole review process exists to
  catch.

Worktree and its throwaway branch removed after verification — `git worktree list`
confirms only the real working tree remains, no trace left on disk or on PR #59's branch.

---

## Verification — updated

- `tsc --noEmit` clean, `npm run lint` clean.
- Full DPR test suite green, including: the new single-row assembler tests, the rewritten
  render/schema tests, `case-complete-two-engineer-day.ts` still passing against the
  retained multi-row path (§6), and the new containment-failure test (§5).
- The `af7760e8` regeneration (§9, prior revision) run as a real check.
- **New, from §1:** a roster-driven generation check — an engineer with zero `daily_logs`
  rows for the day gets a real report reading "not received" throughout, not silence; an
  engineer excluded by `status != 'active'` gets no job enqueued at all; the holiday/
  `unconfirmed` three-way status is exercised, not just submitted/missing.
- Migration rehearsed on test-db per the standing rehearsal discipline before any prod
  apply — separate approval gate, when that step is reached.
