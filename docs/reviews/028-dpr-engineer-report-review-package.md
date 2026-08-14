# Review package — DPR engineer-report reformat (migration 028 + pipeline rewrite)

**Revision 13 (2026-08-14, ~15:20 UTC). MIGRATION 028 APPLIED TO PROD. GO issued by the
external reviewer (round 5) with two conditions, both handled: the `3534756b` divergence
(§23 — kept renamed, not deactivated, roster evidence attached) and the widened two-id
DELETE (§21.6 Option 1, preserving the pinned-id property the reviewer's original sign-off
depended on). Applied via the exact SQL pasted verbatim in this session (§26 item 1),
catalog readback confirmed exactly (§25.3), ledger row written, real `types/database.ts`
regenerated and diffed clean against the dated hand-edit, `docs/schema.md` closed out for
both `dprs` (028) and the already-closed `checkin_escalations` (027, stale N2 note
corrected). Aravind promoted `77119de` back to production — confirmed via an exact etag
fingerprint match plus independent cache-age corroboration (§25.1), high confidence, not
absolute. `main` IS NO LONGER ARMED (§25.2). Full assembled record for the reviewer: §26.**

**Revision 12 (2026-08-14, ~13:20 UTC). INCIDENT — §19's framing of "merge PR #61" as a
REVERSIBLE, pre-apply step was WRONG, not just mis-ordered — merging to `main` auto-deploys
production, so it deployed the new pipeline against the old (un-migrated) schema for real,
for real minutes. Caught, verified, rolled back the same session. Full record, dated: §20.
§19's original text is struck through, not deleted, and corrected in place per this
project's own provenance discipline — do not read §19 as accurate standing guidance;
read §20 first.**

**Revision 11. PR #61 merged; the ~~REVERSIBLE~~ portion of the apply gate run and
completed (§19). The migration itself (DELETE + schema change) is explicitly NOT part of
this revision — reserved for its own, separate, deliberate apply session.** — **INCORRECT
AS WRITTEN, see the revision-12 note above and §20. "Merge PR #61" was never reversible in
the sense this line implied; it triggered a real production deploy.**

**Revision 10. Round 4's two required fixes — B1 (blocking) and S1 (should-fix), plus the
NIT — not a new design round.** Round 4 came back "two fixes, then approved; neither
reopens design." This revision adds §18: both fixes, the new/updated tests, and raw
suite output. See §18 for the diff against `e9afdc4`.

**Revision 9. Round 4 submission — implementation + test-db rehearsal, not a new design
round.** Design converged at round 3 (revision 8) and was not reopened. This revision adds
§17: the full implementation against plan revision 8 (code diffs against `4528f286`), the
migration-028 (Option A) test-db rehearsal with its post-apply catalog fingerprint, the
full green test suite with raw output, the B2 inventory checked off site by site, and a
test-db-vs-prod migration ledger comparison requested as a precondition for this round —
including an explicit statement that the two ledgers diverge, what diverges, and what that
divergence does and does not mean for what the rehearsal proves.

**Revision 8 (round 3) summary, unchanged, kept for continuity:** one BLOCKING amendment
(B3-amend — the sequencing guard targeted the wrong window), three SHOULD-FIX text
corrections (S8, S9, S10), two NITs (both accepted). Four of round 2's own "look hardest
at" questions answered by the reviewer (§16) — no advisory lock needed, zero-roster
detection is now in scope, N1/026 confirmed handled correctly and the request withdrawn.

Status: **MIGRATION 028 IS APPLIED TO PROD (§25.3) AND PRODUCTION IS SERVING THE NEW
PIPELINE (§25.1, `77119de`, high confidence). `main` IS NO LONGER ARMED (§25.2) — pushes
are safe again.** History for continuity: PR #61 merged (`08ed8ab`) before the migration
applied, which deployed the new pipeline onto the OLD schema for ~22-34 minutes (§20, a
real incident, not a close call); rolled back to `0b138fc` same session; a second zero-data
marker written during that window's aftermath forced the DELETE to widen from one pinned id
to two (§21); the reviewer's GO (round 5) came with two conditions, both resolved (§23,
§26). This branch (`docs/dpr-merge-deploy-incident`) is being merged to `main` now that
main is safe to receive pushes again — see this session's closing report for the merge
commit.

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

**Round 4 — every row checked off against the actual implementation (commit `d3d2ba3`),
not just the plan. ✅ = implemented and covered by a passing test; site names below match
the NEW file/line, since several sites moved during the rewrite.**

| Site | What it does today | Consequence of the widened key | Round 4 status |
|---|---|---|---|
| `app/api/cron/dpr-generate/route.ts` (was :65) | project-level DPR-17 skip marker | **Superseded by S3/S4** | ✅ Replaced — `runDprGenerateTrigger` now enumerates the roster∪real-data union; zero-eligible case emits a Sentry warning instead of a skip-marker row (Q8/S4). Covered: `dpr-generate-trigger.test.ts` Q8 test. |
| `app/api/cron/dpr-generate/route.ts` (was :89) | `.contains('payload', {project_id, log_date})` — cron dedup | **BROKEN, confirmed, fixed below** | ✅ Fixed — `.contains('payload', {project_id, engineer_id, log_date})`. Covered: `dpr-generate-trigger.test.ts` "DEDUP does not cross-collapse engineers" — the direct proof of the B2 bug, fixed. |
| `app/api/cron/dpr-generate/route.ts` (was :98) | `enqueueJob('dpr_generate', {project_id, log_date}, ...)` | Payload gains `engineer_id` | ✅ Done — every enqueue call carries `engineer_id`. Covered: `dpr-generate-trigger.test.ts` "B2 — N roster engineers... N enqueued jobs." |
| `lib/dpr/dispatch.ts` `DprGenerateJobPayload` | type | Gains `engineer_id: string` | ✅ Done, plus `assertPostMigrationPayload()` throws on a pre-028 payload shape (item 2, this round). Covered: `dpr-generate-job.test.ts` "B2/item-2." |
| `lib/dpr/dispatch.ts` claim upsert | `onConflict:'project_id,log_date'` | Key widens to `project_id,engineer_id,log_date` | ✅ Done — `onConflict:'project_id,engineer_id,log_date'`, matching the migration's widened constraint (confirmed live on test-db, §17). |
| `lib/dpr/dispatch.ts` assembler/narrative-context calls | keyed `(project_id, log_date)` | Threaded `engineer_id`; `assembleAccountability` dropped | ✅ Done — calls `assembleEngineerDprFacts`/`fetchEngineerNarrativeContext`, both single-row, both take `engineer_id`. No `assembleAccountability` call anywhere in the new `dispatch.ts`. |
| `lib/dpr/dispatch.ts` final success upsert | `onConflict:'project_id,log_date'` | Key widens | ✅ Done — same widened key as the claim upsert. |
| `lib/dpr/dispatch.ts` error-path revert | `.eq('project_id',...).eq('log_date',...)` | **BROKEN, confirmed, fixed below** | ✅ Fixed — `.eq('engineer_id', payload.engineer_id)` added. No dedicated cross-engineer test for this exact path (S10 made this path unreachable for containment failures — see §12 — so its only remaining trigger is an assembler/DB throw, not exercised by a dedicated test this round; flagged, not hidden). |
| `lib/dpr/dispatch.ts` Sentry `extra` context | `{project_id, log_date}` | Add `engineer_id` | ✅ Done. |
| `lib/dpr/dispatch.ts` `markDprGenerationFailed` | `.eq('project_id',...).eq('log_date',...)` | **BROKEN, confirmed, fixed below** | ✅ Fixed — now takes `(client, projectId, engineerId, logDate)`, scoped by all three. Covered: `dpr-generate-job.test.ts` "B2 fix — scoped by engineer_id." |
| `app/api/jobs/tick/route.ts` | calls `markDprGenerationFailed(client, payload.project_id, payload.log_date)` | Add `payload.engineer_id` | ✅ Done — one-line change, `payload.engineer_id` threaded through. |
| `app/(dashboard)/dprs/page.tsx` | reads `.in('project_id', projectIds)` | Needs `engineer_id`/name added for display | ✅ Done — Engineer column added; names fetched via a **separate** `users` query, not an embedded composite-FK join (PostgREST composite-FK-embed support was unverified in this codebase — deliberately not assumed). |
| `app/(dashboard)/dprs/[id]/page.tsx` | reads `.eq('id', id)` | **Confirmed unaffected** | ✅ Confirmed unaffected, as predicted; engineer name added to the header subtitle via the same separate-query pattern. Covered: `dpr-detail.test.ts`, all 5 green (T-DETAIL-01..05). |
| `scripts/generate-one-dpr.ts` | manual debug script, own `{onConflict:'project_id,log_date'}` upsert | **Missed in round 1.** Needs an `engineer_id` CLI arg | ✅ Fixed — rewritten for `<project_id> <engineer_id> <log_date>` args and the widened upsert key. No automated test (it's a manual operator script, consistent with how it was treated pre-028); not exercised as part of the apply-gate embargo either (B3-amend Step 3) until that gate's own session. |

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
5. ~~Vercel deploy of the corresponding app code follows **immediately** after — same
   session, no gap left open deliberately.~~ **DATED CORRECTION (2026-08-14, §20 —
   real incident, not a hypothetical): this step's own wording ("Vercel deploy... follows
   immediately after") was read, in practice, as a separate, schedulable action from
   "merge the branch to `main`" — and merging PR #61 ahead of the migration deployed the
   new pipeline onto the old schema for ~22-34 minutes before being caught and rolled
   back. THE MERGE IS THE DEPLOY — this project's Vercel integration auto-deploys
   production on every push to `main`, confirmed via the GitHub Deployments API (§20).
   Corrected: "merging this branch to `main`" IS step 5, not a precursor to it. The
   branch stays unmerged, no matter how reviewed or how ready, until step 4 is done and
   its post-apply catalog readback is confirmed. No exceptions for "it's just docs" —
   any push to `main` re-deploys, regardless of what changed.**
6. Confirm the deploy is live (a real request against the new code path, not just
   "deploy succeeded" in Vercel's UI) **by 19:00 IST** (see the restored deadline clause
   below — round 4 correction, not a re-opening).

**No schema-version marker needed in the cron route.** Considered (round 2's own
look-hardest-at item 7) — Step 1.5's probe makes the failure mode a marker would guard
against structurally impossible; a marker on top would be a redundant guard against a
state the probe already rules out. Settles that question.

**RESTORED, round 4: the same-day deadline clause, dropped in error when round-3's
B3-amend struck round 2's steps wholesale.** Round 3 correctly replaced the *wrong*
window (the round-2 version guarded only "near the 20:00 cron," missing that `tick` runs
every minute), but the strike-through took the deadline clause down with it — Step 1.5
and the deadline guard two **different** consumers, not one, and both are required:

- **Step 1.5 (queue probe)** guards the **consumer side** — a `dpr_generate` job already
  queued, executing via `tick` inside the apply→deploy gap, hitting the dropped
  `onConflict` target.
- **The deadline** guards the **producer side** — if the *deploy itself* stalls past
  20:00 IST, the 20:00 cron fires on the OLD deployed code against the NEW schema: a
  zero-data project's skip-marker upsert (`route.ts:65`, still old-shape) hits `42P10`
  directly; a data-bearing project enqueues an **old-shape payload with no
  `engineer_id`**, which `tick` later retries against the **NEW** `dispatch.ts` once the
  deploy eventually lands — exactly the payload shape the implementation's new assertion
  (item 2, this round) must reject loudly rather than silently coerce.

**Abort threshold: deploy confirmed live by 19:00 IST** — a full hour of margin before
the 20:00 cron, not a just-in-time confirm. Not met ⇒ treat that day's apply as failed:
either get the deploy live by other means before 20:00, or this is an emergency decision
with Aravind before 20:00, not a silent hope the deploy finishes in time.

Both guards, both documents — folded into `028_dprs_engineer_id_option_a.sql`'s own
header this round, not left only here.

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

## 17. ROUND 4 — implementation, test-db rehearsal, and the ledger comparison

### 17.1 Implementation

Full implementation against plan revision 8, on `review/dpr-engineer-report-plan`:
- `d3d2ba3` — the per-engineer pipeline itself (all files in §1's list, plus the retained
  old project-level pipeline left fully intact and unmodified — `discarded-fields.ts`,
  the old `DprFacts`/`DprJudgment`/`mergeDprFacts`/`assembleDprFacts`/`renderDpr` — kept
  specifically because `lib/dpr/eval/cases/case-complete-two-engineer-day.ts` still
  depends on the old nine-field shape; not retired, per §6 of the plan document).
- `fbadbe1` — test-fix commit, this round: `test/migration-023.test.ts` and
  `test/dpr-detail.test.ts` both predated 028 and seeded `dprs` rows without
  `engineer_id`; found by running the suite against the rehearsed schema (§17.2), not by
  static review. Fixed the `seedDpr` helpers, and rewrote `T-023-05` to assert the new
  3-column `UNIQUE(project_id, engineer_id, log_date)` constraint plus a new case proving
  two engineers can now share `(project_id, log_date)` — the exact behaviour 028 exists
  to enable — rather than passively patching the old assertion to keep it compiling,
  which would have concealed the change instead of proving it.

`git diff --stat 4528f28..HEAD`: 30 files, +2479/-332. **Attribution, not just a stat
dump — several of those files are PR #59 merge content, not this round's own work**
(`c6b4380` merged `main`, which included PR #59, into this branch): `lib/checkin-
escalations/*`, `lib/daily-logs/{cutoffs,status}.ts`, and
`test/unit/{checkin-escalations-*,daily-logs-status}.test.ts` are PR #59's, already
externally reviewed and merged separately — listed for completeness of the diff range,
not as new surface for this round's review. **This round's own new/changed files:**
`app/(dashboard)/dprs/{page.tsx,[id]/page.tsx}`, `app/api/cron/dpr-generate/route.ts`,
`app/api/jobs/tick/route.ts`, `lib/dpr/{archive-status,assemble,dispatch,generate,
narrative-context,render,schema}.ts`, `scripts/generate-one-dpr.ts`,
`test/{dpr-detail,dpr-generate-job,dpr-generate-trigger,migration-023}.test.ts`,
`types/database.ts`, and this package + `028_dprs_engineer_id_option_a.sql`.

`lib/dpr/containment.ts` is **not** in the diffstat above (0 logic lines changed — S9's
header-comment-only addition was already committed at round 3, `4528f286` itself).

### 17.2 Migration 028 (Option A) — test-db rehearsal

Applied `docs/reviews/028_dprs_engineer_id_option_a.sql` via
`supabase db query --linked -f <file>`, foreground, by file — never `db push`, never
backgrounded, per the standing rule this exact incident class produced. Linked ref
printed and confirmed immediately before (`exfccwlrhoutkgrlikod`, test-db — confirmed
distinct from prod's `jvxwqignooseazzmwhvl` by comparing against `SUPABASE_TEST_URL`
before touching anything, not assumed from an earlier session). Succeeded.

**Post-apply catalog readback, re-probed live (not restated from an earlier run in this
session):**

```
column:  engineer_id | uuid | is_nullable: NO

FK:      dprs_engineer_id_tenant_id_fkey
         confupdtype: a   confdeltype: r
         FOREIGN KEY (engineer_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT

UNIQUE:  dprs_project_id_engineer_id_log_date_key
         UNIQUE (project_id, engineer_id, log_date)   -- old 2-column constraint gone
```

Exact match to the fingerprint this round required (`confupdtype='a'`, `confdeltype='r'`).

**What this rehearsal does NOT cover, stated explicitly:** test-db has no
`35a2f41c`-equivalent row (that row is a prod-only artifact — a `skipped_no_data` marker
from the old project-level pipeline, confirmed absent from test-db's `dprs` table by the
nature of the two databases never sharing data). So **neither the migration's `UPDATE`
backfill branch nor its `DELETE` branch were exercised by this rehearsal** — only the
`ADD COLUMN` / `SET NOT NULL` / composite-FK / `UNIQUE` widening DDL ran against real
rows. This rehearsal also does not cover PITR observation or the §0(d) destructive-
operation gate — both are prod-apply-gate concerns (§4, §10), out of scope for a
test-db-only pass and reserved for the apply gate's own session.

### 17.3 Migration ledger comparison — test-db vs. prod (this round's explicit precondition)

**Raw, re-probed live just now, both databases, read-only, no writes to either.**

**`supabase migration list --linked` (CLI wrapper), test-db (`exfccwlrhoutkgrlikod`):**
```
001✓ 002✓ 003✓ 004✓ 005✓ 006✓ 007✓ 011✓ 012✓ 013✓ 014✓ 015✓ 016✓ 017✓ 018✓ 019✓ 020✓ 021✓ 022✓
023: local="023" remote=""
024: local="024" remote=""
025: local="025" remote=""
026: local="026" remote=""   (expected — 026 is parked everywhere, N1)
027: local="027" remote=""
```

**`supabase migration list --linked` (CLI wrapper), prod (`jvxwqignooseazzmwhvl`):**
```
001✓ 002✓ 003✓ 004✓ 005✓ 006✓ 007✓ 011✓ 012✓ 013✓ 014✓ 015✓ 016✓ 017✓ 018✓ 019✓ 020✓ 021✓ 022✓
023: local="023" remote="023"
024: local="024" remote="024"
025: local="025" remote="025"
026: local="026" remote=""   (expected — 026 is parked everywhere, N1)
027: local="027" remote="027"
```

**Raw `select version, name from supabase_migrations.schema_migrations order by version`,
test-db:** rows for `001`–`022` only. **No rows at all for `023`, `024`, `025`, or `027`**
— not inaccurate entries, genuinely absent rows.

**Same query, prod:** rows for `001`–`022`, plus `023 (dpr_reports)`, `024
(evening_flow_q4_q5)`, `025 (evening_productivity_reconciliation)`, `027
(checkin_escalations)`. No `026` row (expected, matches N1).

**They do not match. Named divergence: migrations `023`, `024`, `025`, and `027` are
present in prod's ledger and absent from test-db's ledger, in both the CLI wrapper view
and the underlying `schema_migrations` catalog table directly.** `026` is absent from
both, which is the one expected, already-understood entry (N1) — not part of this
divergence.

**What this does and does not mean, checked, not assumed:** a ledger gap and a schema gap
are different claims, and this round re-probed the schema directly rather than inferring
one from the other. Live, read-only, against test-db:

```
023: to_regclass('public.dprs') is not null                                    -> true
024: apply_evening_flow_turn prosrc contains 'equipment_hours' (Q5)            -> true
025: apply_evening_flow_turn prosrc contains the productive-count guard        -> true
025: prosrc_md5 = 9bd64d28c9cbf0056c7fd63a83c12d3b (prod's own confirmed hash) -> true
027: to_regclass('public.checkin_escalations') is not null                     -> true
```

Every schema object 023/024/025/027 introduce is present and correct on test-db —
025's function body matches prod's own confirmed post-apply hash byte-for-byte — despite
none of those four versions having a row in test-db's ledger table. **This is a
ledger-bookkeeping gap, not a schema divergence.** It's also not new: it's the same,
already-documented pattern as `CLAUDE.md`'s own note that `supabase migration list
--linked` showed `023`–`027` as `remote: ""` on test-db earlier this session, before
today's `028` work touched anything, and matches the broader pattern (prod's ledger rows
for `022`/`027` were themselves added by manual `INSERT`, per `CLAUDE.md`, because the
CLI's own tracking lagged even on prod — that manual catch-up has evidently never been
done for test-db, on any of 023/024/025/027, not just the ones the recent `db push`
incident touched). This round did not determine why the manual-insert step was skipped on
test-db specifically for these four versions, and does not assert a cause — only that the
schema and the ledger disagree, and the schema is what's real.

**What this means for how much the 028 rehearsal (§17.2) proves:** the rehearsal ran
`028`'s DDL against a test-db schema confirmed — by direct, live, re-probed catalog
inspection, not by trusting the ledger — to be at prod-identical schema state for every
object `028` could interact with (the `dprs` table shape from 023, the composite-FK
precedent pattern 028 follows from 017/027). The DDL-correctness proof in §17.2 stands on
that basis. **What it does not prove, and never claimed to: anything about the ledger's
own bookkeeping.** A future `supabase migration list --linked` run against test-db will
still report `023`/`024`/`025`/`027` as unapplied, which could mislead someone who trusts
the CLI wrapper over the catalog — a real, standing gap, but one that predates this round,
is orthogonal to `028`'s own correctness, and is not fixed here per instruction (report,
don't repair, when a divergence is found mid-rehearsal).

**Per instruction: no re-rehearsal, no ledger repair, no other change to test-db in this
pass.** This section is a report of what was found, not an action taken on it.

### 17.4 Full test suite — raw output

```
Test Files  46 passed (46)
     Tests  571 passed | 1 todo (572)
  Duration  319.63s
```

All 46 files green, including every file named in the plan's §8 test list:
`migration-023` (7|1 skipped, rewritten this round), `dpr-detail` (5, fixed this round),
`dpr-generate-job` (6 — payload-shape assertion, S10 both-retry-fails, S10 retry-
succeeds, silent-engineer, `markDprGenerationFailed` engineer-scoping), `dpr-generate-
trigger` (6 — S3 real-data-wins, Q8 zero-eligible Sentry detection, B2 N-engineers-N-jobs,
DEDUP, the B2 cross-collapse proof, non-active-project exclusion), plus
`unit/{dpr-render,dpr-generate-schema,dpr-validate,dpr-containment,assemble-dpr-facts,
dpr-archive-status,idle-cost,accountability}` (all previously green, unaffected by this
round). `tsc --noEmit`: clean. `npm run lint`: 0 errors (2 pre-existing warnings in
untouched `migration-017`/`migration-020` test files, not this round's).

`lib/dpr/eval/cases/case-complete-two-engineer-day.ts` is not part of the vitest suite
(the golden-set eval harness makes real, billed Claude API calls and runs separately, per
`CLAUDE.md` §7) — its retained dependency on the old nine-field `DprJudgment` shape is
confirmed by `tsc --noEmit` passing clean against both the old and new types coexisting,
not by an eval run this round.

---

## 18. ROUND 4's TWO REQUIRED FIXES — B1, S1, and the NIT

Diff against `e9afdc4` (round 4's submitted commit): `db05b3d`, 3 files,
`lib/dpr/dispatch.ts`, `lib/dpr/generate.ts`, `test/dpr-generate-job.test.ts`.

### 18.1 B1 (BLOCKING) — the model-call gate now fires on the EVENING half, not "both halves"

**The bug, exactly as the reviewer stated it:** `dispatch.ts`'s gate was
`bothHalvesFullyDetermined` — call the model unless BOTH morning and evening are outside
{complete, partial}. A morning-only day (morning complete, evening not_received) doesn't
satisfy that condition, so it went to the model — paying for a Claude call and a
containment check to synthesize a verdict the spec's own morning-only sample already fixes
as deterministic text: `"No evening check-in, so we do not know what was done today."`
Package §6's cost model, unchanged across four rounds, prices per engineer WITH real
evening data — it never priced this call, because this call should never have happened.
**This is the only day shape prod has produced so far** (the evening flow cannot yet be
triggered), so this was the untested branch that fires every night, not an edge case.

**The trap named and avoided, not just noted:** widening `bothHalvesFullyDetermined`'s
false branch to route morning-only days to `codeTemplatedVerdict` unmodified would have
been worse — its only fallback line, `"No check-in received today, so we do not know what
was done."`, is FALSE on a day the morning WAS received. The fix is not "route more days to
the existing template," it's "gate on the right half AND add the missing template branch."

**Fix, both parts:**
1. `eveningNeedsModel = evening.status === 'complete' || evening.status === 'partial'`
   replaces `bothHalvesFullyDetermined` as the gate. The model is now needed exactly when
   evening has something real to summarize — evening is the half that ever describes what
   was DONE; morning is a plan, never an account of work performed.
2. `codeTemplatedVerdict` (only ever called when `!eveningNeedsModel`, so every branch can
   assume evening has nothing real) gains a new branch, checked after holiday and the
   both-not_applicable case: `morning.status === 'complete' || morning.status === 'partial'`
   returns the spec's exact sentence, verbatim. The old fallback (`"No check-in received
   today..."`) now only fires when morning ALSO has nothing real — genuinely true in that
   case, never reached otherwise.

**Test, named exactly as required:** `dpr-generate-job.test.ts` — *"B1 — morning-only day
... is fully code-templated: ZERO Anthropic calls, verdict is the spec's exact sentence,
verdict_status: code_templated"*. Zero-calls is proved by construction, not a counter:
the mock client (`mockAnthropicClientThatMustNotBeCalled`) throws if `messages.create` is
ever invoked, so the test would fail outright rather than silently pass if the gate
regressed. Asserts `structured.verdict` equals the spec sentence exactly (byte-for-byte,
not `.toContain`) and `verdict_status: 'code_templated'`.

**Side effect, handled, not overlooked:** the two existing S10 tests
("containment failure on both attempts", "containment fails once, succeeds on retry") both
used a `morning_plan`-only fixture with NO evening data — under the OLD gate this hit the
model (morning was 'partial', not fully-determined); under the CORRECTED gate it would no
longer reach the model at all (evening stays not_received). Both fixtures updated to
include real evening data (`evening_submitted_at` + `evening_schedule_met: true`), so they
continue to exercise the model/containment path they were written to test, under the
corrected gate rather than the old one.

### 18.2 S1 (SHOULD-FIX) — model-output parse failures now degrade to the placeholder, never escape to job-retry

**The bug:** inside `generateEngineerVerdict`'s S10 retry loop, the text-block lookup and
`JSON.parse(textBlock.text)` were unguarded. A missing text block, or malformed/truncated
JSON, threw straight out of the function — past the loop, past `dispatch.ts`'s success
path, into its `catch` block: revert the claim, rethrow, hit the external job-retry path,
and on exhausted retries, `markDprGenerationFailed` — losing a report whose BODY (fully
code-owned, already correct and ready) had nothing wrong with it. `max_tokens: 512` makes
this reachable for real: a `stop_reason: 'max_tokens'` truncation mid-JSON yields exactly
this failure shape, not a hypothetical.

**The principle, stated once and applied structurally:** model-OUTPUT problems (can't
parse what came back) always degrade to the placeholder, same as a containment violation.
Only transport/API failures (the `client.messages.create` call itself throwing — network,
auth, rate limit) are allowed to escape to the job-retry path, because only those actually
indicate retrying the WHOLE job might help.

**Fix:** the text-block extraction + `JSON.parse` + a new explicit check that the parsed
`verdict` field is actually a string are now wrapped in a `try/catch` INSIDE the loop. A
catch does `continue` — falls through to attempt 2, then the placeholder on the second
failure — the identical control flow a containment failure already took. Nothing outside
the loop changed; `client.messages.create` itself is still unguarded and still escapes
normally on a real transport failure.

**Test, named exactly as required:** `dpr-generate-job.test.ts` — *"S1 — malformed model
response (unparseable JSON) on both attempts degrades to the placeholder exactly like a
containment failure; report ships, job succeeds"*. Mock client
(`mockAnthropicClientMalformed`) returns `stop_reason: 'max_tokens'` and unparseable text
(`'{not valid json'`) on every call. Asserts: `generation_status: 'idle'` (job did not
throw), `delivery_status: 'pending'` (`markDprGenerationFailed` never fired — the exact
outcome S1 exists to guarantee), `content` contains the placeholder text, `structured.
verdict_status: 'placeholder'`.

### 18.3 NIT — holiday detection is now structural, not a string match

Folded into the same `dispatch.ts` change (same functions, same review pass) rather than a
separate commit. `codeTemplatedVerdict` used to branch on `reason?.includes('holiday')` —
coupled to the exact plain-language copy `resolveCheckInStatus` happens to write into
`reason` today, which the spec expects to be edited over time (any future copy change would
silently break this check with neither function aware the other depended on it). Added a
`NotApplicableKind = 'holiday' | 'joined_late' | 'left_early'` discriminator, set at each of
the three `not_applicable`-producing sites in `resolveCheckInStatus` (holiday, joined-late,
left-early); `codeTemplatedVerdict` now branches on `kind === 'holiday'`. `reason` keeps
carrying the plain-language text for rendering — `kind` is purely internal routing.

**The other NIT (dedup `.in('status', ['pending','running'])`) — left as-is, per
instruction.** Pre-existing semantics, not touched.

### 18.4 Test output, raw

Targeted run (the six files exercising this change directly):

```
Test Files  6 passed (6)
     Tests  114 passed (114)
```

`dpr-generate-job.test.ts` itself: 8/8 (was 6/6 at round 4 — the two new named tests, B1
and S1, plus the six carried forward, two of them with updated fixtures per §18.1).

Full suite:

```
Test Files  1 failed | 45 passed (46)
     Tests  1 failed | 572 passed | 1 todo (574)
  Duration  433.09s
```

**The one failure is a timeout, not a regression, confirmed by re-running that file alone
immediately after:** `test/migration-024.test.ts` — evening-flow RPC tests, no relation to
`dispatch.ts`/`generate.ts`, untouched by this change. `T-024-14` hit the harness's 30s
ceiling during the full concurrent run; re-run in isolation:

```
Test Files  1 passed (1)
     Tests  31 passed (31)
  Duration  70.86s
   (T-024-14 itself: 2624ms — a clean, fast pass)
```

Same signature this project has already documented for this exact class of flake (§17's
own T-023-05 timeout during the PR #59 worktree verification, and CLAUDE.md's own note on
test-db contention during long concurrent runs) — a hard timeout with an immediate,
fast, clean pass on retry, not a logic regression. `tsc --noEmit`: clean. `npm run lint`:
0 errors (same 2 pre-existing warnings in untouched files, unrelated to this round).

### 18.5 CI-only catch, pre-merge: the profile-lookup guard (`cbc5ece`)

Not part of the reviewed diff (`e9afdc4` → `d042d7e`) — found by GitHub's CI at merge time,
not by any local run in this package, because the guard is a `pretest` hook
(`npm run check:profile-lookups`) that only fires via `npm test`, never via the
`npx vitest run` invocations used throughout this package's own local runs. `Test (real
test-db)` failed on `d042d7e`: `scripts/check-profile-lookups.mjs` correctly flagged
`app/(dashboard)/dprs/[id]/page.tsx` and `lib/dpr/dispatch.ts` for
`from('users').eq('id', ...)` — the guard's whole-file heuristic for the pre-007
lookup bug (matching an auth uid against the post-007-decoupled `users.id`).

**Both are genuine false positives, checked, not assumed:** the `id` at both sites is
`dpr.engineer_id` / `payload.engineer_id` — a resolved `users.id` sourced from
`dprs.engineer_id` (a composite FK to `users.id`) / `daily_logs.engineer_id`, never an
`auth.uid()`. Opted in via the project's existing per-file `profile-lookup-guard:
allow-id-eq` tag — the same convention `lib/whatsapp/reactivation.ts` already uses — not by
weakening the guard. Re-ran the full local suite after (46/46 files, 573 passed, 1 todo,
no timeout this time) and confirmed CI green on the pushed commit (`cbc5ece`) before
merging.

---

## 19. ~~THE REVERSIBLE PORTION OF THE APPLY GATE~~ — CORRECTED BELOW, SEE §20 FIRST

**DATED CORRECTION (2026-08-14, ~13:20 UTC, revision 12): the premise of this section's
title and opening paragraph is wrong, not just its ordering.** "Merge PR #61" was treated
below as a non-destructive, reversible, pre-apply step, grouped with PITR observation and
a read-only queue probe. It is not the same kind of action as those two: **merging to
`main` triggers an automatic Vercel production deploy**, confirmed only AFTER the merge
(§20) — so §19.1 below, in real time, deployed the new per-engineer pipeline (which
assumes `dprs.engineer_id` exists) directly onto the OLD, un-migrated schema. This was
caught, verified, and rolled back the same session (§20) — but the section below still
reads, uncorrected, as if merging were as safe as the read-only steps beside it. It
wasn't. Kept below verbatim, not rewritten, per this project's own provenance discipline —
read §20 for what actually happened and the corrected runbook ordering.

~~Explicit scope, stated once so nothing below is misread: **this section covers only
non-destructive, reversible pre-apply steps.** The migration's `DELETE` and schema change
were NOT run in this pass, under any circumstances, per direct instruction. What follows
is preparation for that future, separate session — not a partial apply.~~ **This
"explicit scope" claim was itself the error — merging IS a form of "running" something,
namely the new application code, against prod. Struck, not deleted.**

### 19.1 PR #61 merged

Merge commit: `08ed8ab5b500852843f496bed3fb174c2e059913` (`main`, was `0b138fc`).
CI green on the PR itself (`Test (real test-db)`, `Typecheck`, `Lint`, `Migration Lint`,
`Vercel` all passed on head `2f61238`) and independently re-confirmed by watching the
fresh CI run GitHub triggered on `main` for the merge commit itself post-merge — not
inferred from the PR's own green checks alone.

**One genuine pre-merge catch, not part of any prior round's reviewed diff:** the first
push attempt (`d042d7e`, round 4's fix-and-resubmit commit) failed `Test (real test-db)`
— CI's `pretest` guard (`scripts/check-profile-lookups.mjs`), which only runs via
`npm test`, not the `npx vitest run` invocations this whole package's local runs used
throughout. Found, fixed, documented in §18.5, re-confirmed green (`cbc5ece`, then
`2f61238` after a docs-only reorder commit) before merging. Full detail there, not
repeated here.

### 19.2 Engineer `3534756b` — RENAMED, not deactivated (gate change, decided this session)

**Reason for the gate change, recorded per instruction:** `3534756b` is the WhatsApp user
behind `+919176865600` — Aravind's own sandbox account, not a disposable test fixture.
Deactivating it (the precondition as originally written) would make the bot go silent on
that number (BOT-08's gated_noop path) at exactly the moment the new pipeline goes live —
removing the only test path available the moment it would be most useful. The
precondition's actual goal was narrower than "deactivate": stop a smoke-test label from
appearing as an engineer name in an owner-facing report. A rename achieves that fully,
is fully reversible, and does not cost the sandbox account its ability to receive
messages.

**Statement run** (prod, `jvxwqignooseazzmwhvl`, via `supabase db query --linked -f
<file>`, foreground, by file):

```sql
UPDATE public.users SET full_name = 'Vikram Rao' WHERE id = '3534756b-2a32-4b91-954b-0bab15c2dba1';
```

**Row before:**

```
full_name: "TEST — Evening Q5 Smoke 2026-08-10 (scenario 1: labelled reply)"
whatsapp_number: +919176865600
role: engineer   status: active   tenant_id: adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0
```

**Row after** (re-read, not assumed from the UPDATE's own empty result set):

```
full_name: "Vikram Rao"
whatsapp_number: +919176865600   (unchanged)
role: engineer   status: active   tenant_id: adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0   (all unchanged)
```

**Open item, stated plainly, not solved by this rename:** test-vs-real user separation
remains unaddressed. `3534756b` is still a real production `users` row with no structural
marker distinguishing "this account is also used for manual smoke-testing" from an
ordinary engineer — a rename fixes what a report DISPLAYS, not what the row IS. The
underlying question (should this project have a genuine test/sandbox flag, separate from
`status`, so smoke-testing an account doesn't require overloading a real one) is open,
not decided or scoped here.

### 19.3 PITR — observed live, read-only

`supabase --experimental backups list --project-ref jvxwqignooseazzmwhvl`, raw:

```
pitr_enabled: true
walg_enabled: true
earliest_physical_backup: 2026-08-07 16:32:11 UTC
latest_physical_backup:   2026-08-14 10:28:16 UTC
```

**Recovery timestamp pinned for the apply session:** as of this observation
(2026-08-14, ~10:28 UTC / ~16:00 IST), PITR covers back to **2026-08-07 16:32:11 UTC**.
This window moves forward continuously (physical backup retention, not a fixed point) —
the apply session must re-observe this live at apply time (§0's standing rule), not reuse
this timestamp as a substitute for that.

### 19.4 Queue probe — rehearsed, read-only, result does NOT carry forward

```sql
SELECT id, status, attempt_count, next_retry_at, payload, created_at
FROM jobs
WHERE type = 'dpr_generate' AND status != 'succeeded';
```

Result, prod: **zero rows.**

**Explicitly NOT proof for the apply session, per instruction:** this was a rehearsal of
the probe mechanism itself — confirming the query runs and returns the expected shape —
not evidence the queue will be empty at apply time. Step 1.5 (B3-amend, §10) requires this
exact probe **re-run live, immediately pre-`BEGIN`**, in the apply session itself.
Tonight's zero-rows result is recorded here for continuity only.

### 19.5 What remains for the apply session

Everything else in §10's hard sequence and §13's PITR-before-delete step: the live
re-probe of the queue (19.4, not reusable), a live re-observation of PITR (19.3, not
reusable — the window will have moved), the actual `BEGIN`-wrapped migration (`ADD COLUMN`
→ backfill `UPDATE` → the `35a2f41c` `DELETE` → `SET NOT NULL` → composite FK → widened
`UNIQUE`), the immediate post-migration Vercel deploy, and the 19:00 IST live-confirmation
deadline (§10) — none of it started, attempted, or rehearsed further in this pass.
**SUPERSEDED — see §20: "the immediate post-migration Vercel deploy" is not a separate,
schedulable action distinct from "merge to main." They are the same event.**

---

## 20. INCIDENT (2026-08-14) — merging PR #61 deployed new code onto the old schema; rolled back same session

**Sequencing error, stated plainly:** PR #61 was merged to `main` (§19.1) BEFORE migration
028 was applied. Merging to `main` auto-deploys production (confirmed by GitHub's
Deployments API — every commit to `main` throughout this project's history has a
corresponding `environment: "Production"` deployment record created by `vercel[bot]`, not
a one-off). §19 treated the merge as a safe, reversible, pre-apply step because nothing
about the ACT of merging touches the database — true, but irrelevant: the merge triggers a
build+deploy of code that immediately started EXPECTING `dprs.engineer_id`, `onConflict:
'project_id,engineer_id,log_date'`, and the composite-FK-backed `UNIQUE` constraint 028
would create — none of which existed on prod. New code ran against the old schema for
real, for a real window of wall-clock time, not hypothetically.

**The window, bounded by what was actually observed, not assumed:**
- New code first live: `08ed8ab`'s Vercel Production deployment created `2026-08-14
  12:41:05Z` (GitHub Deployments API, `state: success`, `vercel[bot]`) — `77119de`
  (a docs-only follow-up push) deployed again at `12:52:26Z`, also new code, so exposure
  did not start later than `08ed8ab`'s deploy.
- Last confirmed still-new-code observation: a `curl -I` against the production domain at
  `13:03:32Z` returned `etag: "163964646ccf9a3e2e6fac4fe6395704"` for `/login`.
- First confirmed post-rollback observation: the same request at `13:15:09Z` returned a
  DIFFERENT `etag: "f5ce721047d7971d97a6b0dfb6704ae4"` — independent, read-only evidence a
  different build was now being served, verified without Vercel dashboard/API access
  (none exists in this environment), consistent with, not just asserted from, Aravind's
  report that the dashboard rollback had been done.
- **Exposure window: `12:41:05Z` → sometime between `13:03:32Z` and `13:15:09Z` —
  approximately 22–34 minutes.** Matches Aravind's own "~35 minutes" estimate; this is the
  more precisely bounded version, from timestamps actually captured, not a re-assertion of
  the same number.

**No data was affected, checked, not assumed.** Every write site to `dprs` was inventoried
by reading the code (§9's B2 table, still accurate): the only writers are
`lib/dpr/dispatch.ts` (reachable ONLY via `handleDprGenerateJob`, called ONLY from
`app/api/jobs/tick/route.ts`, which only acts on a `dpr_generate` job if one exists to
claim) and `scripts/generate-one-dpr.ts` (manual, not run). The only thing that ENQUEUES a
`dpr_generate` job is the 20:00 IST cron (`app/api/cron/dpr-generate/route.ts`,
`30 14 * * *` = 14:30 UTC), which had not fired during the exposure window (window closed
by ~13:15 UTC, cron fires at 14:30 UTC). The `jobs` table was probed live, prod, twice
during the exposure window and once more after the rollback — zero non-succeeded
`dpr_generate` rows every time:

```sql
SELECT id, status, attempt_count, next_retry_at, payload, created_at
FROM jobs WHERE type = 'dpr_generate' AND status != 'succeeded';
```
→ zero rows at `13:05:11Z`, zero rows at `13:15:27Z` (both prod, read-only).

The WhatsApp webhook path (`app/api/whatsapp/`, `lib/whatsapp/`) was independently grepped
for any reference to `dprs` or the DPR generator files — zero matches, confirming it was
never in scope regardless of the deploy state.

**Honesty upgrade (reviewer, 2026-08-14): "nothing wrote" is not "nothing was
user-visible."** During the exposure window, the new `app/(dashboard)/dprs/{page.tsx,
[id]/page.tsx}` — live, since they deployed with everything else — select `engineer_id`
from `dprs`, a column that did not exist on prod's schema; anyone loading either dashboard
page during that window would have gotten a query error, not a quiet no-op. No evidence
anyone did — no application error was reported, and this is a single-operator beta with no
other PM logged in at that hour — but absence of a report is not proof absence of the
error; stated as an open unknown, not resolved by inference.

**Rollback:** done via the Vercel dashboard (Aravind, not Claude Code — no redeploy or
rollback command was issued by this session). Production is now serving `0b138fc` (PR
#59's merge — pre-DPR-reformat code, pre-DPR-reformat expectations, matching the
still-un-migrated schema exactly). Verified independently, read-only, this session:
- GitHub's Deployments API does **not** show a new deployment record for the rollback —
  the most recent entry remains `77119de` (`12:52:26Z`). **This is a real gap in this
  verification method, stated honestly rather than glossed over:** a Vercel-dashboard
  "instant rollback" re-points the production alias without a new git push, so it does not
  create a new GitHub Deployment event. The API answers "what was built and pushed," not
  "what is aliased right now" — the wrong signal for this specific question, not a
  contradiction of Aravind's report.
- The etag change above (§ this section, "the window") is the actual independent
  confirmation available from this environment: different content is being served now
  than was being served during the exposure window.
- `information_schema.columns` re-confirms `engineer_id` still absent from prod's `dprs`
  table — consistent with "rolled back to code that never expected it," and with "nothing
  was applied," both at once.

**The runbook lesson, fixed in the gate itself, not just noted here:** "merge the PR" is
NOT a reversible, schedulable-whenever pre-apply step — it is functionally identical to
"deploy," because this project's Vercel integration auto-deploys production on every push
to `main`. §10's B3-amend hard sequence already correctly sequenced "apply migration" before
"deploy" in the abstract — the error was treating "merge to main" as a DIFFERENT, earlier,
separable action from "the deploy" in §10's own step 5. It is not a different action. It IS
step 5. **§10's hard sequence is corrected in place below** (struck lines, not deleted):

> ~~5. Vercel deploy of the corresponding app code follows immediately after — same
> session, no gap left open deliberately.~~
> **5, corrected: "the deploy" = merging this branch's code to `main`. This step MUST NOT
> happen — no merge, no push to `main`, for any reason, including documentation-only
> changes — until step 4 (the migration itself) has been applied and its post-apply
> catalog readback confirmed. There is no such thing as a "safe" pre-apply merge to `main`
> in this project's current CI/CD configuration. If code needs to land before the apply for
> review purposes, it stays on a branch, unmerged, until the migration is live.**

**MAIN IS ARMED — standing condition until migration 028 applies:** `main`'s HEAD
(`77119de`) already contains the new pipeline. Any future push to `main` — code, docs,
anything — re-deploys that same mismatched code against the still-old schema, re-creating
this exact incident. This condition persists independent of tonight's rollback; the
rollback fixed what's LIVE, not what's on `main`. Holds until migration 028 is applied and
confirmed live via the corrected §10 sequence.

**This section (§20) and its correction to §19 are on a BRANCH
(`docs/dpr-merge-deploy-incident`), NOT merged to `main`, per direct instruction** — see
this session's closing report for the exact branch state.

---

## 21. FINDING (2026-08-14, ~14:35 UTC / 20:05 IST) — a SECOND zero-data marker row; the migration's pinned pre-apply state is stale, and it recurs nightly

**Not a new incident — a consequence of tonight's rollback-verification run (§20) that
changes what tomorrow's apply must account for.** The 20:00 IST cron fired tonight on the
rolled-back OLD code (confirmed, §20's own closing check) and, finding no `daily_logs` for
the one active project, wrote a second `skipped_no_data` marker row — structurally
identical to `35a2f41c`, the row the migration's `DELETE` was written and reviewed against.

### 21.1 Full current state, prod `dprs`, all rows, all columns — re-probed live

```json
[
  {
    "id": "35a2f41c-64ec-41f5-a763-4afe05940ca5",
    "log_date": "2026-08-12",
    "content": null,
    "structured": null,
    "generation_status": "idle",
    "delivery_status": "skipped_no_data",
    "generator_job_id": null,
    "generated_at": null,
    "delivered_owner_at": null,
    "last_regenerated_at": null,
    "created_at": "2026-08-12 14:30:07.100071+00",
    "project_id": "acef67fe-e775-439d-82b8-5b8526868d6d",
    "tenant_id": "adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0"
  },
  {
    "id": "af7760e8-2457-4c11-bc35-52929a0bbf54",
    "log_date": "2026-08-13",
    "content": "EXECUTION OUTPUT\n... (real, generated content — the one genuine row) ...",
    "structured": { "...": "real judgment object, unchanged from prior probes" },
    "generation_status": "idle",
    "delivery_status": "pending",
    "generator_job_id": "a4e27471-f267-4b2e-997b-5322cae863db",
    "generated_at": "2026-08-13 14:31:00.158+00",
    "delivered_owner_at": null,
    "last_regenerated_at": null,
    "created_at": "2026-08-13 14:30:50.289648+00",
    "project_id": "acef67fe-e775-439d-82b8-5b8526868d6d",
    "tenant_id": "adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0"
  },
  {
    "id": "3c14243f-9395-4c8d-923b-fd3ea1925b96",
    "log_date": "2026-08-14",
    "content": null,
    "structured": null,
    "generation_status": "idle",
    "delivery_status": "skipped_no_data",
    "generator_job_id": null,
    "generated_at": null,
    "delivered_owner_at": null,
    "last_regenerated_at": null,
    "created_at": "2026-08-14 14:30:04.344349+00",
    "project_id": "acef67fe-e775-439d-82b8-5b8526868d6d",
    "tenant_id": "adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0"
  }
]
```

(`af7760e8`'s full `content`/`structured` unchanged from the values already pinned
elsewhere in this package — abbreviated here since only its continued presence and shape
matter for this finding, not a re-paste.)

**Three rows now, not two.** Two of the three (`35a2f41c`, `3c14243f`) are zero-data
markers. One (`af7760e8`) is real.

### 21.2 `3c14243f` confirmed zero-data — same three independent fields used for `35a2f41c`

```sql
SELECT
  (SELECT content FROM dprs WHERE id = '3c14243f-9395-4c8d-923b-fd3ea1925b96') IS NULL AS content_is_null,
  (SELECT delivered_owner_at FROM dprs WHERE id = '3c14243f-9395-4c8d-923b-fd3ea1925b96') IS NULL AS delivered_owner_at_is_null,
  (SELECT count(*) FROM daily_logs
     WHERE project_id = 'acef67fe-e775-439d-82b8-5b8526868d6d' AND log_date = '2026-08-14') AS underlying_daily_logs_count;
```
→ `content_is_null: true`, `delivered_owner_at_is_null: true`, `underlying_daily_logs_count: 0`.
Same verdict as `35a2f41c` on every field originally used to justify that row's deletion —
not a weaker or assumed match, the identical check re-run against the new row.

### 21.3 Consequence 1 — the migration's pinned pre-apply state is stale

`028_dprs_engineer_id_option_a.sql`'s header pins prod's pre-apply state as TWO rows: one
real (`af7760e8`), one worthless marker (`35a2f41c`), with the `DELETE` targeting the
latter by id. Prod now has **three** rows. **Option A's `ALTER COLUMN engineer_id SET NOT
NULL` will fail outright against `3c14243f`** unless the `DELETE` step is widened to cover
it too — the backfill `UPDATE` has no correct value to write for a zero-data marker (same
reasoning §3 already established for `35a2f41c`: no engineer contributed anything, so
there is no engineer to backfill to), so `3c14243f` cannot be migrated forward as-is, only
deleted or excluded.

### 21.4 Consequence 2 — this recurs nightly, unless the migration applies or a check-in is submitted

Every day the migration is not applied AND no engineer checks in, the still-live OLD code
writes one more marker at 20:00 IST. **The pinned pre-apply state does not go stale once —
it goes stale on a nightly cadence, and the `DELETE` target set grows by one row per day of
delay.** This is a direct, mechanical consequence of tonight's own finding, not a
hypothetical projected forward: it already happened once between the migration being
written and tonight.

### 21.5 Consequence 3 — a premise the external reviewer accepted ON THE RECORD has changed

The `DELETE` against `35a2f41c` was accepted **un-rehearsed against a real target row**
partly on the strength of it being, in the reviewer's own framing, a single-row operation
against a verbatim-pinned id (`docs/reviews/028-dpr-engineer-report-review-package.md`
§3/§15, `35a2f41c` pinned by id throughout). **It is now a multi-row operation against a
set that changes daily.** Whether the reviewer would accept a two-row (or growing,
predicate-matched) delete on the same reasoning is not something this session gets to
decide on their behalf — the premise they signed off on has materially changed, and per
standing practice, that goes back to them explicitly rather than being silently widened
under the same accepted rationale. A short heads-up note is being sent (this session,
outside this package) flagging this specifically — not a new review round, a notice that
one of their accepted premises no longer holds as stated.

### 21.6 Two options for the apply session — NOT decided here, migration SQL NOT edited

Per direct instruction: the shape of the fix is deferred to the apply session, since a
predicate-based delete is a materially different risk profile from a pinned-id delete, and
that difference deserves its own deliberate decision, not one made in passing during a
read-only verification pass.

**Option 1 — explicit id list, re-pinned immediately pre-apply.**
```sql
DELETE FROM public.dprs WHERE id IN (
  '35a2f41c-64ec-41f5-a763-4afe05940ca5',
  '3c14243f-9395-4c8d-923b-fd3ea1925b96'
  -- + any further marker rows written between now and the apply session,
  -- each independently re-verified on the same 3 fields (§21.2) immediately
  -- before BEGIN, not carried forward from this write-up.
);
```
Matches the exact shape the reviewer already reviewed and accepted — same auditability,
same "verbatim-pinned id" character. Cost: does not solve the recurrence (§21.4) itself —
the id list must be re-derived and re-verified at apply time, every time the apply slips
another day, by re-running §21.2's three-field check against whatever new marker rows
exist by then.

**Option 2 — predicate-based delete of zero-data markers.**
```sql
DELETE FROM public.dprs d
WHERE d.content IS NULL
  AND d.delivered_owner_at IS NULL
  AND d.delivery_status = 'skipped_no_data'
  AND NOT EXISTS (
    SELECT 1 FROM daily_logs dl
    WHERE dl.project_id = d.project_id AND dl.log_date = d.log_date
  );
```
Self-adjusting — captures every zero-data marker at apply time regardless of how many
accumulate, without manual re-pinning. Cost, stated plainly, not minimized: this is a
**materially different risk profile**, exactly as flagged for the reviewer. A predicate
delete is not individually auditable the way a pinned id list is — its correctness rests
on the predicate itself being a complete and exact characterization of "worthless
zero-data marker, nothing else," which is a claim nobody has reviewed yet (the reviewer
reviewed one row by id, not this general characterization). A subtle predicate error — a
wrong join key, a timezone edge on `log_date`, a status string that later gains a new
legitimate meaning — could delete more than intended, silently, in a way a pinned list
structurally cannot.

Neither option is applied, chosen, or written into the migration file in this pass.

---

## 22. PROCESS CORRECTION (2026-08-14) — PR #61 is NOT the review channel; posting there is not delivery to the reviewer

**Error, stated plainly:** Claude Code posted the item-3 heads-up (§21) as a comment on
PR #61, then posted a second note (the two-question message re-approval-conditions ask)
to the same thread immediately after — in the SAME session where listing PR #61's comments
had already shown the fact this second post then ignored: every comment on that thread is
from `ara-2789` (Aravind) or `vercel[bot]`. **Zero from the reviewer, ever, on this PR.**
Posting to PR #61 does not reach them — it was treated as delivery when it is not.

**Corrected understanding, recorded so this does not recur:** review reaches the reviewer
only when **Aravind messages them directly**, through whatever channel that relationship
actually uses (not this repo, not GitHub). **PR comments — including every "round"
write-up and heads-up note in this package's history — are the WRITTEN RECORD those
messages point AT, not the delivery mechanism itself.** Aravind pastes/relays the
reviewer's actual responses back into this session; Claude Code does not have, and should
not act as if it has, a channel to the reviewer.

**Standing correction for this package and any future one like it:** when asked to "send
the reviewer a note," the correct action is to draft/post the durable written record (PR
comment, package section) that Aravind can then point the reviewer at in his own message —
**not** to treat the act of posting as the notification itself, and not to assume a lack of
reviewer reply on GitHub means anything about whether they've been informed, since they
were never going to reply there in the first place.

---

## 23. DIVERGENCE FROM THE REVIEWER'S GO CONDITION — `3534756b` stays RENAMED, not deactivated

**The reviewer's GO-for-apply came with a condition — "test engineer `3534756b`
deactivated before the apply" — reasoning that an active test engineer generates a report
nightly under the roster-union trigger. That reasoning was built on the ORIGINAL gate,
before §19.2's change: `3534756b` was renamed to "Vikram Rao," not deactivated, precisely
because it is Aravind's own WhatsApp sandbox account (`+919176865600`), not a disposable
test fixture. The reviewer's condition, as literally written, was not re-evaluated against
that change before being issued.**

**Verified before acting, per instruction — raw output, both live, prod:**

```sql
SELECT pm.project_id, u.id, u.full_name, u.role, u.status
FROM project_members pm JOIN users u ON u.id = pm.user_id
WHERE pm.project_id = 'acef67fe-e775-439d-82b8-5b8526868d6d'
  AND u.role = 'engineer' AND u.status = 'active';
```
→ exactly one row: `{id: 3534756b-2a32-4b91-954b-0bab15c2dba1, full_name: "Vikram Rao",
role: engineer, status: active}`.

```sql
SELECT id, full_name, role, status, tenant_id FROM users
WHERE role = 'engineer' AND status = 'active' ORDER BY id;
```
→ exactly the same one row, system-wide — **no other active engineer exists anywhere in
prod**, on any project, any tenant.

**Confirmed, not contradicted: deactivating `3534756b` would empty the only roster there
is.** Under the roster-union trigger (§1 of the plan), zero active engineers means zero
reports generated, the Q8 zero-roster Sentry warning fires every night indefinitely
(correct behavior for a genuinely empty roster, but this roster isn't genuinely empty —
it would be MADE empty by the deactivation itself), and Aravind loses his only WhatsApp
test path at the exact moment the new pipeline needs it most.

**The condition's actual purpose was fully served by the rename, not left unaddressed:**
the concern was a smoke-test label ("TEST — Evening Q5 Smoke...") appearing as an engineer
name in an owner-facing report. That string no longer exists anywhere on this row —
`full_name` is "Vikram Rao." Deactivation would have solved a problem that no longer
exists, at the cost of a problem (zero roster) the original condition never intended to
create.

**Decision: keep the rename, do NOT deactivate.** Recorded here, dated, with the roster
evidence above, specifically so this reaches the applied-runbook record and the reviewer
sees it stated rather than discovering a condition that wasn't literally followed. Per
§22's own correction: this section is the durable written record; delivering it to the
reviewer is Aravind's own message, not a PR comment from this session.

---

## 24. §10 RECODIFIED — the invariant is "one hour of margin before the next producer
event," not "by 19:00 IST"

**DATED, before the apply, struck-not-deleted per convention. Reviewer's framing,
adopted as stated.** The 19:00 IST clause (§10, "Abort threshold: deploy confirmed live by
19:00 IST") was the DAYTIME-APPLY SPECIAL CASE of a more general invariant, not the
invariant itself — conflating the two nearly caused a second sequencing error tonight,
when the literal clock reading ("it's past 20:00") would have blocked an apply that is
actually SAFER than a daytime one, because tonight's producer event (the 20:00 IST cron)
has already fired and the next one is ~23.5 hours away.

~~**Abort threshold: deploy confirmed live by 19:00 IST** — a full hour of margin before
the 20:00 cron, not a just-in-time confirm. Not met ⇒ treat that day's apply as failed:
either get the deploy live by other means before 20:00, or this is an emergency decision
with Aravind before 20:00, not a silent hope the deploy finishes in time.~~

**Corrected invariant:** deploy must be confirmed live **at least ONE HOUR before the next
`dpr_generate`-producing event** — the next firing of the 20:00 IST cron, whatever that
next firing actually is, not a fixed wall-clock time. "By 19:00 IST" is simply what this
invariant equals when the apply happens during the day, before that day's cron has fired.
When the apply happens AFTER that day's cron has already fired (as tonight), the invariant
is satisfied by confirming live any time up to one hour before TOMORROW's 20:00 IST —
i.e., by 19:00 IST tomorrow, not tonight. **Applying tonight, right after the cron has
already fired, maximizes the margin against this invariant rather than minimizing it** —
next producer event is ~23.5 hours out, not the ~1 hour or less a daytime apply typically
has to work with.

**Not met ⇒ same consequence as before, restated against the corrected invariant:** if the
deploy does not confirm live within one hour of the NEXT `dpr_generate`-producing event
(concretely: by 19:00 IST tomorrow, for tonight's apply), treat the apply as failed for
that producer event — either get the deploy live by other means before that event fires,
or it is an emergency decision with Aravind before it fires, not a silent hope the deploy
finishes in time.

---

## 25. MIGRATION 028 APPLIED (2026-08-14, ~15:20 UTC / ~20:50 IST) — deploy confirmed, MAIN NO LONGER ARMED

### 25.1 Deploy confirmation — a stronger signal than the etag, and its actual confidence level

**Not just "the etag changed" (the earlier, weaker check) — the etag matches an EXACT,
previously-captured, uniquely-identified fingerprint of `77119de`'s own build:**

```
now (post-promotion):  etag: "163964646ccf9a3e2e6fac4fe6395704"   age: 9066   x-vercel-cache: HIT
known 77119de fingerprint (captured 13:03:32Z, pre-rollback): 163964646ccf9a3e2e6fac4fe6395704  ← EXACT MATCH
known 0b138fc fingerprint (captured 13:15:09Z, post-rollback): f5ce721047d7971d97a6b0dfb6704ae4  ← does NOT match
```

`age: 9066` is independent, arithmetic corroboration, not just a second coincidental
signal: 9066 seconds before the 15:34:39Z request is ~13:03Z — the exact minute `77119de`'s
build was first observed live, before the rollback. `x-vercel-cache: HIT` confirms this is
the actual cached prerendered artifact from that original build being re-served, not a
fresh render that happens to hash the same. Re-checked the GitHub Deployments API too — no
new record appeared for the promotion, same limitation already documented for the rollback
(a dashboard-side alias change doesn't create a GitHub Deployment event); consistent with,
not contradicted by, everything above.

**Confidence: high, not absolute.** An exact match to a uniquely-fingerprinted prior
observation, corroborated by independent cache-age arithmetic, is materially stronger than
"a change was observed" — but this environment still has no direct Vercel dashboard/API
access, so this remains inference from HTTP response fingerprints, not a first-party
"current alias = `77119de`" confirmation. Stated at that strength, not overstated.

### 25.2 MAIN IS NO LONGER ARMED

The standing condition from §20 ("any push to `main` re-deploys the mismatched code") is
**LIFTED**, as of migration 028's apply (§25.3) and Aravind's promotion of `77119de` back
to production (§25.1). `main`'s HEAD now matches the live schema — a future push to `main`
deploys code that expects `engineer_id`, against a database that has it. **Pushes to
`main` are safe again.**

### 25.3 Post-apply record, raw

**Applied:** `docs/reviews/028_dprs_engineer_id_option_a.sql`, exactly as pasted verbatim
in this session's transcript, `supabase db query --linked -f`, ref `jvxwqignooseazzmwhvl`
printed immediately before, foreground, never `db push`, never backgrounded. Pre-check
(FK tenant match), Step 1.5, and Step 1.5b all re-probed live immediately pre-`BEGIN` —
raw output in this session's transcript, all passed. Empty result, no error — transaction
committed.

**Catalog readback**, raw:
```
UNIQUE:  dprs_project_id_engineer_id_log_date_key — UNIQUE (project_id, engineer_id, log_date)
         (old dprs_project_id_log_date_key gone — not listed)
FK:      dprs_engineer_id_tenant_id_fkey — confupdtype: a, confdeltype: r
COLUMN:  engineer_id | uuid | is_nullable: NO
TABLE:   exactly one row — af7760e8, engineer_id 3534756b-2a32-4b91-954b-0bab15c2dba1
```

**Ledger row** — written by manual `INSERT` (applying by file does not write one; this
project's own compensating control since 022, and precisely the gap 028's own test-db
rehearsal proved was still needed):
```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('028', 'dprs_engineer_id');
```
Confirmed present, re-read: `{"version":"028","name":"dprs_engineer_id"}`, immediately
above `027`.

**`types/database.ts`** — real `npx supabase gen types typescript --linked --schema
public`, run against prod, diffed against the dated pre-apply hand-edit it replaces.
**The diff:**
```diff
-      // MANUAL PRE-MIGRATION EDIT (2026-08-14, per-engineer DPR reformat) — ... (13-line dated comment, removed — expected, generated files carry no hand-written comments)
...
+          { foreignKeyName: "dprs_engineer_id_tenant_id_fkey", columns: ["engineer_id", "tenant_id"], isOneToOne: false, referencedRelation: "users", referencedColumns: ["id", "tenant_id"] },
... (same relationship entry, moved earlier in the array — the generator orders Relationships differently than the hand-edit did)
```
**Zero semantic difference** — every column type, every `Row`/`Insert`/`Update` shape for
`engineer_id` is byte-identical between the hand-edit and the real regeneration; the only
diffs are the now-obsolete dated comment (correctly gone) and one array-position reorder
of a single relationship entry (cosmetic, not structural). The hand-edit was accurate.
`tsc --noEmit`: clean against the real file.

**`docs/schema.md`** — `dprs` entry updated in place: `engineer_id UUID NOT NULL` +
composite FK added to the column list, `UNIQUE(project_id, log_date)` →
`UNIQUE(project_id, engineer_id, log_date)`, full apply record boxed at the top matching
this section. **`checkin_escalations` (027) — found ALREADY CLOSED, not reopened or
redone:** commit `fd0d0e9` (2026-08-13 12:52 IST, ~46 minutes after 027's own apply)
already wrote that entry, a full day before this package's own N2 note (round 2, §14)
called it open. Corrected in `schema.md` itself, dated, rather than silently — the N2 item
was closed before it was ever flagged as open; nothing needed doing there, only saying so.

---

## 26. APPLIED RUNBOOK RECORD — assembled for the reviewer

Everything the reviewer asked to see in one place, each pointing at its own detailed
section rather than re-derived here:

1. **The SQL as applied** — §18 of this session's transcript has the full 260-line file
   pasted verbatim (the reviewer asked for this specifically, not a description of it);
   byte-identical to `docs/reviews/028_dprs_engineer_id_option_a.sql` at commit `fb5de1d`
   on this branch.
2. **Both pre-`BEGIN` probes, raw** — Step 1.5 (jobs queue, zero rows) and Step 1.5b
   (`dprs` shape, exactly the three known rows) both re-probed live immediately before
   `BEGIN`, not reused from the readiness pass an hour earlier. Full raw output in this
   session's transcript.
3. **Catalog readback** — §25.3 above.
4. **Deploy confirmation** — §25.1 above, with its stated confidence level.
5. **The ledger row** — §25.3 above.
6. **§23 — the `3534756b` divergence** — kept RENAMED ("Vikram Rao"), not deactivated,
   from the reviewer's literal GO condition. Roster evidence re-stated: exactly one active
   engineer exists anywhere in prod (`3534756b`), on any project, any tenant — confirmed
   live, twice, both before deciding and again immediately before this apply's own
   pre-checks. Deactivating it would have emptied the only roster there is; the rename
   already served the condition's actual purpose (no smoke-test label in an owner-facing
   report).

**Not part of this record, deliberately:** the deploy step itself (Aravind's own dashboard
promotion, §25.1) and anything past it — this section assembles what happened UP TO AND
INCLUDING the schema apply and its immediate verification, per the reviewer's own ask.

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
- `lib/dpr/containment.ts` — header comment only (S9's dated partial supersession, round
  3), no logic touched — 0 lines changed since `4528f286`, not new this round.
- **Round 4, new:** the full implementation (commit `d3d2ba3`) + test-fix commit
  (`fbadbe1`) on this branch — `git diff 4528f28..HEAD` for the code, §17.1 for
  attribution against PR #59 merge noise. §17.2 for the test-db rehearsal, §17.3 for the
  ledger comparison, §17.4 for the full raw test-suite output.
