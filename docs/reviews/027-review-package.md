# Migration 027 — `checkin_escalations` table — review package (PRE-APPLY)

> **This is a PRE-APPLY review, unlike the 024+025 catch-up package.** 027
> has run NOWHERE — not rehearsed on test-db, not applied to prod, not even
> pushed to a branch yet at the time this package is written. The reviewer
> here is gating a deployment before it happens, not looking for existing
> damage after the fact. Nothing below should be read as "already done and
> being reported" — every step past §1 is a plan, explicitly marked as such.

## Repo-state header (CLAUDE.md §0, standing rule since 2026-08-07)

- `main @ 822e9da4e64f9160a0dafb5526747a8281c1b91a`
- `supabase migration list` (local/remote), run live for this package, not
  recalled:
  ```
  001-025: local ✓ / remote ✓ (both sides agree, all 25 applied to prod)
  026:     local ✓ / remote ✗ (written, NOT applied — separate, unrelated
                                 to this migration; tracked in CLAUDE.md §10
                                 under dpr_generation_stale, pending a real
                                 latency measurement before it ships)
  027:     local ✓ / remote ✗ (THIS migration — the subject of this package)
  ```
- Last runbook actually EXECUTED against any database: migration 025's prod
  apply, 2026-08-11 09:35 IST (docs/schema.md's 025 entry;
  `docs/reviews/024-025-review-package.md`). Nothing has been applied to
  any database since.

---

## Provenance / pinning (CLAUDE.md §0)

File contents pinned via `git show`, not retyped. At the time this package
is written the migration file is UNCOMMITTED (`git status --porcelain`
shows it untracked) — the pin below will be updated to a real `git show
<sha>:path` the moment it lands on the feature branch in step 4 of this
work order; recorded here so that step's commit is a paper trail, not a
silent substitution.

```
$ git status --porcelain -- supabase/migrations/027_checkin_escalations.sql
?? supabase/migrations/027_checkin_escalations.sql
```

**ACTION FOR THE PR**: once committed, replace this section with
`git show <commit-sha>:supabase/migrations/027_checkin_escalations.sql`,
full output, per CLAUDE.md §0's provenance rule — never a paraphrase.

---

## 1. What this migration does, structurally

One new table, `public.checkin_escalations`, RLS enabled from creation.
No existing object is touched — no `ALTER` on any live table, no grant
change on anything that exists today. Full column list and every design
decision is in the migration file's own header comment
(`supabase/migrations/027_checkin_escalations.sql`) — not restated here
verbatim, per CLAUDE.md §0's "pinned, not paraphrased" rule; read the file
itself for the reasoning behind each choice. Summary of shape only:

- **Grain**: one row per `(project_id, engineer_id, log_date, half)`,
  `half IN ('morning', 'evening')`.
- **Lifecycle**: `status` walks `awaited -> nudged -> escalated ->
  submitted | not_submitted`, with a timestamp column per transition
  (`nudge_sent_at`, `escalated_at`, `resolved_at`).
- **Send tracking**: `sent_free_form`, `sent_template`,
  `template_unavailable` — the latter two are UNREACHABLE today (see §2).
- **Idempotency**: `UNIQUE (project_id, engineer_id, log_date, half)`,
  written via upsert by the (not-yet-built) escalation sweep job — protects
  against the sweep firing more than once for the same engineer/day/half
  under `/api/jobs/tick`'s ordinary retry semantics (NFR-16). Same shape as
  `processed_messages` (011) and `dprs` (023)'s own idempotent-write
  precedents.
- **RLS**: `SELECT`-only, `project_members`-scoped, byte-for-byte the same
  shape as `dprs_select` (023). No `authenticated`/`anon` write path;
  `INSERT`/`UPDATE`/`DELETE` explicitly revoked from both. Only
  `service_role` (the sweep job) writes.

This exists to back the check-in nudges / escalation feature specified in
`docs/bot-flows.md`'s `TRIGGER TIMES` section (2026-08-12 correction) and
`design-principles.md` Rule 7.2 — read by the planned DASH-01 exceptions
surface, written by the planned escalation sweep job. **Neither consumer
exists yet.** This migration is schema only, same "schema before handler"
sequencing as migration 023 (the `dprs` table shipped before the
`dpr_generate` handler did).

---

## 2. Why external review is required (CLAUDE.md §0 trigger conditions)

Two independent trigger conditions fire, not one:

- **Trigger (a)-adjacent, more precisely the "no prior safe state" clause**:
  a brand-new table has nothing to fall back on if its RLS is wrong from
  day one — CLAUDE.md §0 states this by name as "at least as dangerous as
  a bad change to an existing one."
- **Trigger (b), the one CLAUDE.md calls out explicitly by name** after
  migration 020's incident (seven functions with default-PUBLIC EXECUTE):
  "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING OBJECT —
  grants, RLS policies." This migration creates RLS and grants on a new
  object — read narrowly, 020's condition was written for *existing*
  objects, but the surrounding "CREATES or modifies... throughout (a) and
  (b), not 'modifies' alone" clause extends it explicitly to new objects
  with wrong-from-day-one RLS. Both readings converge on the same
  conclusion: this needs the package.

Nothing here touches auth/identity, is destructive, or moves money —
triggers (c)/(d)/(e) don't apply. (a)/(b) are sufficient on their own.

---

## 3. THE QUESTION FOR THE REVIEWER — RLS scoping, asked directly

This is the part of the design most worth an outside read, named plainly
rather than buried in the migration file's own comments (though the same
reasoning is there too, under "RLS SCOPING" in the file header).

**The policy is modelled on `dprs_select` (migration 023): SELECT-only,
scoped through `project_members`, not tenant-wide.** For `dprs` that shape
was justified because a DPR is inherently a single-project artifact
(CLAUDE.md §4: "Owner DPR content is strictly single-project scoped") —
there was no real ambiguity about what the right boundary was.

`checkin_escalations` is a different kind of data: it is **who has and
hasn't submitted**, i.e. accountability data, and it will be read
cross-project the moment a PM who sits on more than one project opens
DASH-01 — the exceptions surface has to aggregate rows across every
project that PM is a member of, one `project_members`-scoped SELECT at a
time under this policy.

**Direct question**: is `project_members`-scoping — identical in shape to
how `dprs` is scoped — the right boundary for accountability data
specifically, or should this be narrower (e.g. some additional
per-row restriction beyond project membership) or is project-scoped
correct and the aggregation-across-projects concern is adequately handled
by the app layer issuing one scoped query per project the PM belongs to
(same as `dprs`, same as `daily_log_edits`)? This migration takes the
`dprs_select` shape as a **starting point**, not a settled answer — sign-off
on this specific point is what's being requested, not a rubber stamp on
"RLS exists."

Nothing about `tenant_id`-scoping vs `project_members`-scoping is in
question — `tenant_id = get_user_tenant_id()` stays as the outer guard
either way, consistent with every RLS-enabled table in this project.

---

## 4. Columns deliberately inert today — `sent_template` / `template_unavailable`

Recorded here as well as in the migration file, so a reviewer doesn't have
to open the SQL to find it: these two columns can only ever hold their
default (`false`) right now. The Twilio **production** sender is still
blocked on company registration (CLAUDE.md §10, Week 2 item 5/6,
unresolved as of this package), and the **sandbox** cannot send custom
approved templates at all (`docs/bot-flows.md`'s "Sandbox limitation"
section) — so no code path anywhere in this system can attempt a template
send today, closed-window fallback or otherwise (`docs/bot-flows.md`'s
2026-08-12 TRIGGER TIMES correction: free-form is primary, template is the
fallback for a closed 24h session window). The columns exist so the
escalation job handler's schema doesn't need a follow-up migration the day
the production sender ships — not because either is exercised now. **Ask
during review**: is it acceptable to ship inert-but-correctly-typed
columns ahead of the code path that will use them, same precedent as
`dprs.generator_job_id` shipping in 023 ahead of the job handler that
populates it? No objection expected, flagged so it isn't a surprise.

---

## 5. Explicitly NOT covered by this package

- **No rehearsal has happened.** Per CLAUDE.md §0's REHEARSE rule, rehearsal
  must run on a cleaned EXISTING test-db branch, not a fresh provision
  (the `users.auth_id` fresh-branch bug is still open,
  `docs/reviews/supabase-fresh-branch-auth-id-bug.md`). Rehearsal is
  planned for AFTER this review round signs off on §3's RLS question — no
  point rehearsing a shape that review might change.
- **No application code exists.** The escalation sweep job handler and the
  DASH-01 exceptions surface are both unbuilt. This package reviews the
  schema and RLS only.
- **`migration-027.test.ts` does not exist yet** — will be written
  alongside rehearsal, following the RLS cross-tenant/cross-project
  isolation pattern CLAUDE.md §7 requires (two-tenant fixture; a PM sees
  only their own projects' escalation rows), same shape as
  `migration-015.test.ts`.
- **No decision on `types/database.ts` regeneration timing** — happens
  after apply, per the standing §6 rule, not before.

---

## 6. Rehearsal + apply plan (PLANNED, NOT EXECUTED)

Sequenced so the highest-uncertainty step (§3's RLS question) resolves
before any database is touched, even test-db:

1. **This review round** — reviewer signs off on §3 (RLS scoping) and §4
   (inert columns), or requests changes. Iterate until settled.
2. **Rehearsal** — apply to the cleaned existing test-db branch (not a
   fresh provision), via `supabase db query --linked -f <file>` per
   CLAUDE.md §0 (`db push` is never used, ledger-lag risk — same rule that
   caught the migration-022-over-025 incident). Write
   `migration-027.test.ts` alongside it: table shape, RLS isolation
   (two-tenant fixture), UNIQUE-constraint upsert behaviour under a
   simulated double-fire.
3. **Second review pass** (if §3 changed the design materially) or proceed
   directly to apply if rehearsal confirms the reviewed shape unchanged.
4. **Prod apply** — full runbook per `docs/migration-runbook-template.md`:
   PITR observed by direct dashboard/API inspection immediately before
   (CLAUDE.md §0, never trusted from a checklist), pre-apply probe,
   `supabase db query --linked -f <file>` apply with the linked project ref
   printed fresh, post-apply column/RLS/policy/grant verification against
   the test-db reference, manual ledger `INSERT` (CLI `migration repair` is
   28P01-blocked for this project), `docs/schema.md`'s own `checkin_
   escalations` entry written only after the ledger insert confirms.
   Explicit go-ahead from Aravind required before the apply step itself,
   per CLAUDE.md §0's `db query` conditions — same as every prod apply
   this project has done since 025.

None of step 2 onward happens before this review round concludes.

---

## 7. Sign-off checklist

- [ ] §3 RLS scoping — reviewed, decision recorded (keep `project_members`
      shape / narrow further / other)
- [ ] §4 inert columns — acknowledged, no objection or changes requested
- [ ] Table/column shape (§1) — reviewed for anything beyond RLS scope
      (naming, missing column, wrong CHECK values)
- [ ] Cleared to proceed to rehearsal (§6 step 2)
