# Review package — DPR engineer-report reformat (migration 028 + pipeline rewrite)

**Revision 8.** Round 3 of external review. **Convergence — nothing reopens the design.**
Round 3 findings: one BLOCKING amendment (B3-amend — the sequencing guard targeted the
wrong window), three SHOULD-FIX text corrections (S8, S9, S10), two NITs (both accepted).
Four of round 2's own "look hardest at" questions answered by the reviewer (§16) — no
advisory lock needed, zero-roster detection is now in scope, N1/026 confirmed handled
correctly and the request withdrawn.

Status: PLAN ONLY. Nothing implemented, nothing applied, nothing merged. PR #59 still
open, unmerged, still a hard prerequisite (§7).

---

## Repo-state header (pinned, per convention)

- `main @ e9f18ecdbb7bb4079035fb90ee37c551bc15bb0a` (unchanged — this branch's parent
  commit; this and every round-2/round-3 revision are commits on top of it, not new base
  points).
- Round 2 landed as commit `b766a64` on `review/dpr-engineer-report-plan`. This revision's
  diff is against that commit, per the reviewer's own round-3 instruction.
- `supabase migration list --linked`, raw: local and remote in sync through `027`;
  `026` present locally, not applied remotely — pre-existing, unrelated to this work, left
  untouched (N1, confirmed correct handling by the reviewer this round, request withdrawn).
- Last runbook executed: none yet for this change — this is still pre-apply.

---

## 1. What this change is

Replaces the DPR generation pipeline: one report per site engineer per day (not one per
project), a four-line body of planned/actual pairs sourced from a fixed question-to-field
binding, free text rendered verbatim in quotes, and the model restricted to writing one
containment-checked verdict sentence. Full spec: `docs/dpr-engineer-report-spec.md`
(committed on this branch, updated this round for S5). Full design plan, all revisions:
`docs/reviews/028-dpr-engineer-report-plan.md` (committed this round — see S6).

Files touched: `lib/dpr/{schema,assemble,containment,generate,render,narrative-context,
dispatch}.ts`, `lib/dpr/discarded-fields.ts` (retired), `app/api/cron/dpr-generate/
route.ts`, `app/(dashboard)/dprs/{page.tsx,[id]/page.tsx}`, `scripts/generate-one-dpr.ts`
(round-2 addition to this list — see §5), plus the one migration.

---

## 2. The migration — Option A DECIDED, Option B corrected and rejected

**Option B is mechanically broken, not merely costlier — both of us had the reasoning
wrong in round 1.** Every `dprs` writer is a `supabase-js` `.upsert()` with
`{ onConflict: 'project_id,log_date' }` (`dispatch.ts:50`, `dispatch.ts:97`,
`route.ts:65`). Postgres only infers a **partial** unique index as an `ON CONFLICT`
arbiter when the conflict clause itself carries a matching `WHERE` predicate —
PostgREST/`supabase-js` has no way to express that predicate through `.upsert()`'s
`onConflict` option. Under Option B, every one of those three upserts throws `42P10`
("no unique or exclusion constraint matching the ON CONFLICT specification") the first
night this schema goes live. Neither the option file nor round 1's trade-off section knew
this — recorded here explicitly, per instruction, rather than quietly switching to A
without saying why the earlier trade-off framing (risk vs. permanent nullable) was wrong
on its own terms, not just outweighed.

`docs/reviews/028_dprs_engineer_id_option_b.sql` is kept in the tree, header rewritten to
state this plainly — a record of a rejected option, not a live choice, per this project's
own provenance discipline (don't erase a decision, mark it).

**Option A — decided.** `docs/reviews/028_dprs_engineer_id_option_a.sql`, full text,
rewritten this round to fold in B1 (composite FK) and the raw pinned probes (S7). Summary
of the sequence: add `engineer_id` nullable → backfill the one real row → delete the one
worthless legacy row → `SET NOT NULL` → add the composite same-tenant FK → widen the
unique key.

---

## 3. §0 external review gate — unchanged from round 1, still both readings intact

**Quoting condition (a) exactly:**

> (a) CREATES OR MODIFIES a live function's LOGIC — what it computes, what it writes, who
> it lets do what. Narrowed to logic deliberately, not "any SQL touching a function"...

**Reading 1 — literal mechanism.** Grammatically bound to "a migration"; (a)'s own
contrast ("logic" vs. "any SQL touching a function") is SQL-scoped on both sides. This
migration modifies no Postgres function. Does not trip under this reading.

**Reading 2 — bare wording, applied to the full change.** Taken out of the migration
framing, (a)'s wording describes the TypeScript rewrite exactly — `generateDprJudgment`,
`renderDpr`, `handleDprGenerateJob`, `runDprGenerateTrigger`, `assembleDprFacts` all
substantially rewritten, writing a different artifact nightly to a real customer. Trips
under this reading.

**Both kept intact, neither collapsed.**

**Condition (d): trips.** `DELETE FROM public.dprs WHERE id = '35a2f41c...'` is
destructive under (d)'s plain wording, regardless of the row's confirmed worthlessness —
this is now unconditional, not contingent on an option choice, since Option A is decided
and Option B (the only path that avoided this) is rejected on independent mechanical
grounds (§2). External review is required by the standing rule on this basis alone, not
only warranted on the merits of the broader rewrite. (b), (c), (e) do not trip — no
grant/RLS/auth/money surface touched; `dprs_select` RLS unchanged, grants unchanged.

---

## 4. PITR — the runbook step, unconditional now that Option A is decided

Per CLAUDE.md §0 ("rollback mechanisms are verified by observation, never by checklist
status"): **before running the migration's `DELETE`, observe PITR directly** —
`supabase backups list` (or the dashboard's Backups → Point in time panel), confirm
`pitr_enabled: true`, `walg_enabled: true`, note the actual restore window's upper bound
at the moment of the check, pin it in the applied runbook record (same discipline as 025,
027). **Not done yet** — an apply-time step. See §9 (B3) for where this sits in the full
apply/deploy sequence — it is no longer just "before the DELETE," it's before the whole
sequenced apply.

---

## 5. Holiday, mid-day-join, and the roster's real-data-wins fix (S3)

**Holiday engineer: report generated, no Claude call.** `is_holiday = true` is a
fully-known fact — code-templated verdict, same reasoning `schema.ts` already applies to
any `not_captured` section. Corroborated-but-unconfirmed holiday reuses
`accountability.ts`'s `'unconfirmed'` status verbatim, same no-Claude-call treatment.

**Mid-day join — spec-authoritative, `docs/dpr-engineer-report-spec.md` Rule 7, updated
this round for S5.** Fourth check-in status `not_applicable`, per half, threshold is the
SEND time (`CHECKIN_CHECKPOINTS.morningSend`/`.eveningSend`, 07:30/18:30), never a cutoff.
**Round-2 correction, in the spec now, not just this package:** the send-time framing is
**conditional on the trigger crons shipping** — no proactive send exists today (confirmed:
no code path starts the morning or evening flow in production; engineers self-initiate).
Under today's pull model, an 11:00 joiner could still have self-initiated before the real
close boundary (15:00/20:00) — the rule is right on Rule 5.3 grounds and ships as written,
but is recording intent for the push model, not describing today's actual mechanism. Two
mechanics pinned in the spec: the `created_at`-vs-send-time comparison must convert to
IST explicitly (a raw UTC compare misclassifies every join between 02:00–07:30 UTC), and
a removed-then-re-added membership uses the **current row's** `created_at` — no history
exists to do better, stated as a named limitation, not silently gapped.

**S3, the real-data-wins fix — roster union, not roster alone.** Round-2 finding: an
engineer who submits a morning check-in and is then deactivated or moved off the project
before 20:00 drops out of a roster-only query; their real `daily_logs` rows persist,
unrendered, and the owner's document silently omits reported work. Rule 7's own principle
— real data always wins — applies here too. **Corrected eligible set for the nightly
trigger: `active project_members` ∪ `engineers with a daily_logs row for log_date`**, not
`active project_members` alone. The roster query supplies the first set; a second query
(`daily_logs WHERE project_id = X AND log_date = Y`, distinct `engineer_id`s not already
in the roster set) supplies the second. An engineer in the union-only set (real data, no
longer on the active roster) still gets a report — the report's own "site engineer"
header uses whatever name is on file.

**NIT, accepted this round: a union-only engineer's un-owed LATER half renders
`not_applicable`, not `not_received`.** Reviewer's own proposed fix, taken as offered — an
engineer who submits morning data and then leaves (deactivated, or removed from
`project_members`) before evening currently renders `Evening check-in: not received`,
which is Rule 5.3 shading (blame-flavored language aimed at someone no longer there to
have owed it). `not_applicable` already exists for the mirror case (membership starting
late); this reuses the identical mechanism for membership ending early, no new status
value or vocabulary needed — detected from the same union check already required above
(present in the real-data set, absent from the active-roster set ⇒ left). Folded into
`docs/dpr-engineer-report-spec.md` Rule 7 directly this round, not just noted here.

**Test engineer `3534756b` under a roster-driven trigger — addressed, not left
unaddressed.** Confirmed still `status: 'active'` in prod (re-queried this round). Under
the roster-driven design, this generates a real report, with a real Claude call, every
single night, indefinitely, for a fabricated test identity. **Decision: deactivate before
this migration ships, tracked here with a date — 2026-08-14 (same session as whichever
session applies migration 028) — not executed in this plan-revision pass.** A one-row
`UPDATE users SET status = 'deactivated' WHERE id = '3534756b-...'` is outside this
plan-revision's scope (an operational data change, not a schema or code change) but is
now a named, dated precondition rather than a thing that would otherwise be silently
discovered on the first `not_applicable` roster-driven run.

---

## 6. Cost — unchanged from round 1

Measured baseline (`docs/design-decisions-beta-feedback.md`): ≈$0.0156/DPR (n=2, old
nine-field schema, standard rate — conservative upper bound for the new one-field
schema). Scaling moves from per-project to per-engineer-with-real-evening-data (holiday/
silent engineers cost $0):

| Engineers/project | Daily (worst case) | Monthly (×30) |
|---|---|---|
| 1 | ≈$0.0156 | ≈$0.47 |
| 5 | ≈$0.078 | ≈$2.34 |
| 20 | ≈$0.312 | ≈$9.36 |

---

## 7. PR #59 — still the hard prerequisite, verification unchanged from round 1

`CHECKIN_CHECKPOINTS` only exists on `feat/checkin-escalation-sweep`. Merging moves
`app/(dashboard)/daily-logs/page.tsx`'s live morning cutoff 10:30→15:00 — confirmed
intentional (PR #59's own header, sourced from `docs/bot-flows.md` TRIGGER TIMES,
2026-08-12). Verified in an isolated, since-removed worktree, merged against current
main: 16/16 recalibrated + existing `daily-logs-status.test.ts` tests, 30/30 PR #59's own
tests, `tsc --noEmit` clean. Full suite 567/568 — one timeout in
`migration-023.test.ts`'s `UNIQUE(project_id, log_date)` test (the exact constraint this
plan replaces), reproduced-clean on isolated retry (498ms, no assertion failure) —
recorded as test-db contention, not a regression, not smoothed over.

---

## 8. BLOCKING — B1: the composite same-tenant FK on `engineer_id`

**Required, not optional; folded into `028_dprs_engineer_id_option_a.sql` this round.**

**The pattern, precedented three times, checked against all three:**
- **017** (`docs/schema.md` ~L460-468) established composite `(col, tenant_id) →
  parent(id, tenant_id)` FKs, adding `UNIQUE(id, tenant_id)` on `users` and `projects` as
  the parent index, specifically because the referencing column is caller/client-writable
  and a plain single-column FK cannot stop a cross-tenant id from being smuggled through.
- **019** (`daily_log_edits`) is the one precedented **exception** — plain single-column
  FKs, argued explicitly in the migration's own comment: safe *only* because
  `tenant_id`/`project_id` are copied inside a `SECURITY DEFINER` RPC from an
  already-verified row, with no app-layer `INSERT` path at all (`authenticated`/`anon`
  `INSERT` revoked). **Checked whether `dprs.engineer_id` qualifies for this exception —
  it does not.** `engineer_id` travels from the roster query
  (`app/api/cron/dpr-generate/route.ts`) into a JSON job payload, through the jobs queue,
  read back out by `handleDprGenerateJob` (`lib/dpr/dispatch.ts`) — entirely in
  application code, no DB-enforced copy-from-verified-row step anywhere in that path. A
  bug anywhere in that chain could pair a mismatched `engineer_id` with the wrong
  `project_id`/`tenant_id`; nothing but the FK would catch it. 019's exception does not
  extend here.
- **027** (`checkin_escalations`, three days before this file was first drafted) applies
  the identical composite pattern to its own `engineer_id`: `(engineer_id, tenant_id) →
  users(id, tenant_id)`. Round 1 of *that* migration's review required exactly this same
  fix — this package's own round 1 missed the precedent its own history had just set.

**The lineage question, run down as asked:** migration 023's `dprs.project_id`/
`dprs.tenant_id` FKs (`dprs_project_id_fkey`, `dprs_tenant_id_fkey`) are **plain**,
confirmed against the live catalog (§10). Checked whether 023's own review pinned an
argument for this — **it did not.** `docs/reviews/023-review-package.md`'s constraint
table (line ~198) signs both FKs off as `PASS`, correct by name and definition, with no
mention of the composite pattern at all — 023 simply predates consistent enforcement
(017 introduced the pattern; 023 didn't adopt it for its own new table). **This is a
latent, pre-existing gap in 023, not something 028 introduces or is required to fix** —
named here so it is not later mistaken for 028's own oversight, and not silently
compounded: 028's own new `engineer_id` FK is composite; `project_id`/`tenant_id`
staying plain on `dprs` is 023's unresolved ledger item, left as-is.

**Decided shape:** `(engineer_id, tenant_id) REFERENCES public.users (id, tenant_id)`,
`ON UPDATE NO ACTION ON DELETE RESTRICT` — RESTRICT rather than 027's CASCADE, one-line
rationale: `dprs` is an archival, owner-facing document; deleting a user should never
silently cascade-delete a historical report referencing them. In practice inert (users
are never hard-deleted, only deactivated, per CLAUDE.md §10a) but states the intent
explicitly.

---

## 9. BLOCKING — B2: full `(project_id, log_date)` key-consumer inventory

**"Files touched" was not "key sites enumerated." Full inventory, every keyed write,
read, conflict target, and payload-match site, with line pins — round 1's list of six is
extended, not replaced:**

| Site | What it does today | Consequence of the widened key |
|---|---|---|
| `app/api/cron/dpr-generate/route.ts:65` | `dprs.upsert(..., {onConflict:'project_id,log_date'})` — DPR-17 project-level skip marker | **Superseded by S3/S4** — the skip decision moves to per-engineer/roster-union; this call site's purpose changes, not just its key |
| `app/api/cron/dpr-generate/route.ts:89` | `.contains('payload', {project_id, log_date})` — cron dedup | **BROKEN, confirmed, fixed below** |
| `app/api/cron/dpr-generate/route.ts:98` | `enqueueJob('dpr_generate', {project_id, log_date}, ...)` | Payload gains `engineer_id` |
| `lib/dpr/dispatch.ts:31-34` | `DprGenerateJobPayload` type | Gains `engineer_id: string` |
| `lib/dpr/dispatch.ts:50-59` | claim upsert, `onConflict:'project_id,log_date'` | Key widens to `project_id,engineer_id,log_date` |
| `lib/dpr/dispatch.ts:84-90` | `assembleDprFacts`/`fetchNarrativeContext`/`assembleAccountability` calls, keyed `(project_id, log_date)` | Threaded `engineer_id`; `assembleAccountability` call dropped entirely (no ACCOUNTABILITY section in the new format, per the earlier revision) |
| `lib/dpr/dispatch.ts:97-108` | final success upsert, `onConflict:'project_id,log_date'` | Key widens |
| `lib/dpr/dispatch.ts:127-131` | error-path revert, `.eq('project_id',...).eq('log_date',...)` | **BROKEN, confirmed, fixed below** |
| `lib/dpr/dispatch.ts:144` | Sentry `extra` context `{project_id, log_date}` | Add `engineer_id` — debuggability, not correctness |
| `lib/dpr/dispatch.ts:160-171` (`markDprGenerationFailed`) | `.eq('project_id',...).eq('log_date',...)` | **BROKEN, confirmed, fixed below** |
| `app/api/jobs/tick/route.ts:54` | calls `markDprGenerationFailed(client, payload.project_id, payload.log_date)` | Add `payload.engineer_id` |
| `app/(dashboard)/dprs/page.tsx` | reads `.in('project_id', projectIds)` | Not broken by the key widening (still valid to list all rows); needs `engineer_id`/name added for display (already in scope from the earlier revision) |
| `app/(dashboard)/dprs/[id]/page.tsx` | reads `.eq('id', id)` | **Confirmed unaffected** — keyed by row UUID, not the composite key, at all |
| `scripts/generate-one-dpr.ts:67` | manual debug script, own `{onConflict:'project_id,log_date'}` upsert | **Missed in round 1.** Needs an `engineer_id` CLI arg and the same key widening, or explicit retirement if superseded by real per-engineer tooling |

**Three confirmed-broken sites, all from the same root cause (the code was written when
one project-day meant one row) — each needs its own fix, not one shared patch:**

1. **`route.ts:89`, the dedup containment match.** `.contains('payload', {project_id,
   log_date})` matches on JSONB **containment** (`@>`), not equality. Once payloads carry
   `engineer_id`, a pending job for engineer 1 (`payload ⊇ {project_id, log_date,
   engineer_id: E1}`) still contains `{project_id, log_date}` as a subset — so checking
   "is there already a pending/running job for `{project_id, log_date}`" would match
   engineer 1's job when checking whether to enqueue engineer 2's, 3's, ... N's. **Live
   path where an engineer who owed a check-in gets no report** — the exact failure class
   this whole reformat exists to close, reintroduced at the trigger layer. **Fix:** the
   containment match must include `engineer_id` — `.contains('payload', {project_id,
   log_date, engineer_id})`, checked per roster engineer inside the per-engineer loop
   (§5's union), not once per project. **New test, named explicitly:** N roster engineers
   on one project produce N enqueued jobs, not 1 — assert the dedup check does not
   collapse engineer 2..N into "already_queued" off engineer 1's pending job.
2. **`dispatch.ts:127-131`, the error-path revert.** `.eq('project_id',...).eq(
   'log_date',...)` with no `engineer_id` filter reverts `generation_status` to `'idle'`
   for **every** row matching that project-day — under concurrent per-engineer jobs, one
   engineer's thrown error would revert (or, worse, race against) every other engineer's
   in-flight row for the same day. **Fix:** add `.eq('engineer_id', payload.engineer_id)`.
3. **`markDprGenerationFailed` (`dispatch.ts:160-171`), same shape.** Same fix, same
   reasoning — add the `engineer_id` filter, or this call fails every engineer's row on
   one engineer's exhausted retries.

---

## 10. BLOCKING — B3-AMEND: the round-2 runbook guarded the wrong window

**Round-2's §10 (below, struck) assumed the danger window was "near the 20:00 IST cron."
Wrong: `/api/jobs/tick` runs `* * * * *` — every minute (`vercel.json`), not once a day.**
Any `dpr_generate` job sitting `pending`, `running`, or retry-scheduled (`status='failed'`,
`next_retry_at` due) at the moment the migration applies gets claimed and executed by
`tick` within 60 seconds, hitting the dropped `onConflict` target through `dispatch.ts`'s
upserts — regardless of time of day. The real safe zone is "the `dpr_generate` queue is
proven empty," not a clock window at all.

~~**Hard sequence:** 1. PITR observed live. 2. Migration applied well outside the 20:00
IST window. 3. Deploy follows immediately. 4. Confirm live before 20:00. 5. If 3/4 can't
complete same-day, don't apply.~~ **Superseded — struck, not deleted, per this project's
own correction convention (matches the plan document's S8 pass).**

**Corrected hard sequence:**
1. PITR observed live (§4).
2. **NEW — Step 1.5, mandatory, immediately pre-apply:** probe the `jobs` table —
   ```sql
   SELECT id, status, attempt_count, next_retry_at FROM jobs
     WHERE type = 'dpr_generate' AND status != 'succeeded';
   ```
   **PROCEED only on zero rows, re-probed live at apply time** (not reused from an
   earlier reading — matches this project's own "verify by observation" discipline for
   everything else in this runbook). Any row found: STOP, resolve it (let it complete via
   `tick`, or intervene manually), re-probe.
3. **The probe is only valid if the 20:00 cron is the sole producer — it is not.**
   `scripts/generate-one-dpr.ts` also writes directly to `dprs` with its own
   `onConflict:'project_id,log_date'` upsert (found in B2's own inventory). **The manual
   script must not run between Step 1.5's probe and the deploy landing.** Solo operator,
   so: Aravind does not run it, and Claude Code does not run it, for the duration of the
   apply.
4. Migration applied (the `BEGIN...COMMIT` block).
5. Vercel deploy of the corresponding app code follows **immediately** after — same
   session, no gap left open deliberately.
6. Confirm the deploy is live (a real request against the new code path, not just
   "deploy succeeded" in Vercel's UI).

**No schema-version marker needed in the cron route.** Considered (round 2's own
look-hardest-at item 7) — Step 1.5's probe makes the failure mode a marker would guard
against structurally impossible; a marker on top would be a redundant guard against a
state the probe already rules out. Settles that question.

Folded into `028_dprs_engineer_id_option_a.sql`'s own header this round, not left only
here.

---

## 11. SHOULD-FIX — S1: containment corpus region, specified exactly

Round 1's "digits in the rendered body" silently reversed the **2026-08-11**
`ContainmentMeta` decision (`containment.ts`'s own comment) that deliberately excluded
`log_date` from the corpus — a rendered header like "Thu 13 Aug" carries digits that
would otherwise enter the corpus unexamined. **Corrected, region specified exactly: the
corpus is built from the four pair lines, MISSING, and NEEDS ATTENTION — the header and
the date line are explicitly excluded, cross-referencing the 2026-08-11 decision by date
rather than re-deriving the same reasoning under a new name.** Implementation-wise, this
still means `extractDigitTokens` runs over the concatenation of those specific rendered
sections, not the whole `content` string.

## 12. SHOULD-FIX — S10 (was S2): reconciled to ONE retry semantic, not two conflicting ones

**Round-2 correction, superseded this round by S10 — recorded so the contradiction and
its resolution are both visible, not just the final state.** Round 2's version of this
section described retry-EXHAUSTION semantics (external job retries via `tick`, ending in
`markDprGenerationFailed` if all attempts fail) as a *separate* path from the plan
document's §5 (single-attempt containment failure → immediate placeholder, report always
ships). **The two were never reconcilable as written: if §5 holds — containment never
throws past its own handling — §12's retry-exhaustion branch is unreachable, dead
document text describing a code path that can't exist.**

**Resolved in favor of §5's shape, reconciled exactly, not split the difference:**
containment failure gets **at most one immediate, in-process re-call** (same job
execution, no new job enqueued — `generate.ts`'s own comment already notes violations are
stochastic and often pass on retry) — if that second attempt also fails containment, the
neutral placeholder ships and the report still succeeds. **`markDprGenerationFailed` and
`delivery_status='failed'` are never invoked for a containment failure, first attempt or
second** — that function stays reserved for failures that prevent a report from existing
at all (an assembler throw, an unrecoverable DB error), never for the verdict sentence,
which always has a deliverable fallback now.

**Consequence for `app/api/jobs/tick/route.ts`: no containment-specific branch needed at
all.** Its existing `willRetry`/`markDprGenerationFailed` logic is untouched — containment
failures never reach it, since they resolve entirely inside `generateDprJudgment`/
`dispatch.ts` before the job either succeeds or throws for an unrelated reason. The only
change at that call site is threading `payload.engineer_id` through the existing
`markDprGenerationFailed` call — already required by B2, not a new requirement.

Full corrected design, with the test list: `docs/reviews/028-dpr-engineer-report-plan.md`
§5, which is now the sole source of truth for this behavior — not restated fully here to
avoid a third copy drifting from the other two.

## 13. SHOULD-FIX — S3, S4: covered in §5 (real-data-wins) and below (zero-roster)

**S4 — zero-roster project-day.** Under a roster-driven trigger, a project with no
active engineers writes **no `dprs` row at all** for that night — reintroducing the
absence-vs-failure conflation `archive-status.ts` exists to prevent, now at the project
level instead of the report level. Accepted as a gap (no `dprs`-schema fix — see the
original reasoning below, unchanged), **but round 3 (Q8) changes what "accepted" means:
the detection signal is now IN SCOPE for this implementation, not deferred to a future
incident.** `runDprGenerateTrigger`, when an active project resolves `SET 1 ∪ SET 2`
(§5) to empty, must emit a Sentry/log event at that point — built as part of this work,
not added later after someone notices reports silently stopped for a project.

Original reasoning for why the gap itself (no `dprs` row) stays accepted, not schema-
fixed: a project-level marker doesn't fit coherently under Option A's own `engineer_id
NOT NULL` invariant (there is no engineer to attach it to) — reintroducing one would mean
either violating that invariant for exactly this case or building a second, parallel
marker mechanism outside `dprs` entirely. Zero-roster projects are themselves an edge
state (a project with no engineers assigned is not yet doing real work) — the detection
line (Q8, above) is the right-sized fix; a schema change is not.

## 14. SHOULD-FIX — S5, S6, S7 (round 2) and S8, S9 (round 3): done

- **S5** — `docs/dpr-engineer-report-spec.md` updated directly (not just this package):
  the send-time conditional-on-crons framing, the IST-explicit comparison, and the
  removed-then-re-added membership policy are all now in the spec.
- **S6** — the plan document is committed on this branch:
  `docs/reviews/028-dpr-engineer-report-plan.md`.
- **S7** — raw catalog/probe output pinned verbatim in
  `028_dprs_engineer_id_option_a.sql`'s own header comment (constraint name, pre-apply
  state, multi-engineer check) rather than summarized here or there.
- **S8 (round 3)** — the plan document's §1 contradicted itself: the revision-7 union
  correction sat above an unmodified roster-only query block and a bullet stating the
  exact claim S3 refuted ("a deactivated engineer never appears on the roster and gets no
  report generated"). Fixed with a dated strike-through pass, not a silent rewrite — the
  struck text and its correction are both visible in the plan document now.
- **S9 (round 3)** — `lib/dpr/containment.ts`'s own 2026-08-11 header comment (Reading A)
  now records the dated partial supersession directly, where the original decision lives,
  not only in this package: prong (i) (corpus from code-owned Facts) is unchanged; prong
  (ii) (never raw free text) is superseded for the new verdict corpus specifically, since
  the rendered body now quotes engineer free text verbatim (spec Rule 2b) and that
  strengthens traceability rather than weakening it — the quoted source sits directly
  adjacent to any digit the verdict might cite, unlike the old design's raw prompt input,
  which the reader never saw. `buildExecutionCorpus` itself is unchanged, still governed
  by the original, unsuperseded reasoning.

---

## 15. NITS

**N1 — CONFLICT, flagged rather than silently resolved either way.** The review asked
for `supabase/migrations/026_dpr_generation_stale.sql` to be "re-based on the widened key
and noted in that file." Checked the file directly first: **026 itself has no
`(project_id, log_date)` keying to rebase at all** — it is a single `ALTER TABLE ADD
COLUMN generation_claimed_at TIMESTAMPTZ` with a comment, no `WHERE`/`UPDATE`/`upsert`
logic of any kind. The keying concern applies to the **not-yet-written** stale-reclaim
sweep the column supports (per 026's own header, planned for `app/api/jobs/tick/
route.ts`, "added in the same PR as this migration" — that PR doesn't exist yet), not to
this file's own SQL. Substance recorded here instead: whoever builds that sweep must key
its reclaim query on whichever `dprs` key shape is live at that time — `(project_id,
engineer_id, log_date)` if 028 has landed by then. **The conflict:** this session has
been told, in nearly every prior turn, that `026_dpr_generation_stale.sql` "stays
untracked and untouched" — an explicit, repeated standing instruction. Editing it now,
even for a one-line note, would override that without an unambiguous instruction to do
so specifically for this file. **Not edited. Flagged for Aravind's explicit confirmation**
rather than guessed either way — see the message accompanying this package.

**N2 — schema.md close-out, stacked gaps named, not created.** 028's own close-out list
must include a `docs/schema.md` `dprs` entry update (the `engineer_id` column, the
widened key, the composite FK) once applied — standard practice, per the migration-
runbook-template's "After apply" section. Separately, and worth stating rather than
silently working around: **027's own `docs/schema.md` `checkin_escalations` entry is
still open, since Tuesday** (2026-08-11) — a pre-existing documentation gap, not
something to stack a second one on top of. Both tracked; 028's own entry is a new,
separate close-out item, not a substitute for closing 027's.

**N3 (round 3), accepted — `lib/dpr/archive-status.ts` added to the files-touched list.**
Was absent from §1's list despite the redesign retiring `skipped_no_data` as a writable
status for any new row (its one writer, `route.ts:65`, is superseded per B2/S4). Genuinely
unchanged, not modified — `deriveDprArchiveStatus`'s priority-4 branch becomes dead code
(no new row can ever carry that status, and the one historical row that had it is deleted
by Option A), kept rather than removed since the deferred project-level report may
reintroduce a project-level skip concept later, same pattern as the retained multi-row
`mergeDprFacts`. Dated comment at the branch, not deletion, when implementation happens.

**N4 (round 3), accepted — mid-day-leaver `not_applicable` reuse.** Covered in §5 above;
listed here too since it was raised as a NIT. Folded into the spec directly.

---

## 16. What to look hardest at

Round-2 items 1–5 stand unchanged (still live risk surface). Items 6–9 were the round-2
list's own extension — **all four now answered by the reviewer, resolutions recorded, not
re-opened:**

1. The roster-driven trigger (now roster ∪ daily_logs, per S3) — can any engineer who
   owes a check-in fail to get a report?
2. `engineer_id NOT NULL` + the composite FK + the widened UNIQUE — any path where either
   still stops protecting?
3. The render-before-generate reorder — anything that silently depended on the old order?
4. Containment on the specified corpus region (S1) — any way a verdict digit escapes it?
5. The retained multi-row assembler — still coherent as a caller-facing API once nothing
   calls it?
6. ~~B2's three fixed sites — does the concurrent-per-engineer-jobs shape need a stronger
   guard (e.g. an advisory lock)?~~ **ANSWERED (Q6): no.** `engineer_id` scoping in every
   B2-fixed site means concurrent per-engineer jobs write disjoint rows — `tick`'s own
   concurrency crosses jobs, never rows, so there's no contention to guard against.
7. ~~B3's sequencing — enforceable, or does it need a harder gate?~~ **ANSWERED (Q7 →
   B3-amend, §10):** the round-2 sequence guarded the wrong window entirely — fixed with
   the Step 1.5 jobs-queue probe, which is itself the harder gate this question was
   asking for (structurally makes the failure mode impossible, no marker needed).
8. ~~S4's accepted zero-roster gap — right call, or does it need a real fix?~~
   **ANSWERED (Q8): accept the gap, but build detection now.** Not a full fix, not a pure
   defer either — the Sentry/log line (§13) is the actual resolution, in scope for this
   implementation.
9. ~~N1's conflict — should 026 be touched, overriding the standing instruction?~~
   **ANSWERED (Q9): no.** Reviewer withdrew the request and owned it as an unverified
   assertion about the file's contents. Standing instruction holds; handling was correct.

**New from round 3, carried into round 4's own look-hardest-at scope implicitly (not
re-listed as a separate numbered item since round 3 raised no new open questions of its
own) — the B3-amend Step 1.5 probe, the S10-reconciled single-retry semantic, and the
S9 containment.ts supersession are the three places round 3 changed actual designed
behavior, not just document text, and are where round 4 should look first if anything
is going to reopen.**

---

## Attachments

- `028_dprs_engineer_id_option_a.sql` — DECIDED, full text, this round's revision
  (B3-amend Step 1.5 probe added), same directory.
- `028_dprs_engineer_id_option_b.sql` — REJECTED, kept for the record, unchanged this
  round.
- `028-dpr-engineer-report-plan.md` — the design plan, this round's revision (S8
  strike-through pass, S10 reconciliation, Q6/Q8 fold-in).
- `docs/dpr-engineer-report-spec.md` — this round's revision (mid-day-leaver
  `not_applicable` addition, NIT/N4).
- `lib/dpr/containment.ts` — **new this round** — the actual application file, header
  comment only (S9's dated partial supersession), no logic touched.
