# Migration 027 — `checkin_escalations` table — review package (PRE-APPLY)

> **This is a PRE-APPLY review, unlike the 024+025 catch-up package.** 027
> has run NOWHERE — not rehearsed on test-db, not applied to prod, not even
> pushed to a branch yet at the time this package is written. The reviewer
> here is gating a deployment before it happens, not looking for existing
> damage after the fact. Nothing below should be read as "already done and
> being reported" — every step past §1 is a plan, explicitly marked as such.

## Internal review pass (2026-08-12) — read this before §1

Aravind read the first draft of this migration on the branch before sending
it out further and found three things worth fixing before spending the
external reviewer's attention on them. His attention is the scarce
resource here — this section exists so he sees the reasoning behind each
fix, not just the diff, and doesn't have to re-derive any of it himself.
All three are already applied in the migration file this package pins
below (commit `236ac414bd1b4b9dc7e529698da55a2606ed0d22`), not left as
follow-ups.

1. **Send outcome collapsed from three booleans to one nullable column.**
   The first draft stored `sent_free_form` / `sent_template` /
   `template_unavailable` as three independent booleans alongside the
   five-value `status` lifecycle column — nothing prevented
   `status='nudged'` with all three false, or two of the three true at
   once. Two representations of overlapping facts, free to disagree — the
   same shape this project has been bitten by repeatedly (CLAUDE.md's
   HAND-MIRRORED RECONCILIATION entry names the pattern, albeit for a
   different pair of columns). Fixed: one nullable `nudge_outcome` column,
   `CHECK IN ('free_form', 'template', 'unavailable', 'failed')`, NULL =
   not attempted. `status` keeps the lifecycle question; `nudge_outcome`
   now exclusively owns the send-path question. Same principle as
   `lib/dpr/schema.ts`'s `CapturedCount` — a contradictory state is
   impossible by construction, not by discipline.
2. **`updated_at` had no maintenance mechanism at all.** `DEFAULT now()` +
   `NOT NULL` but no trigger and nothing setting it on UPDATE — it would
   have frozen at insert time forever. Checked, not assumed: grepped every
   migration in this project for an `updated_at` trigger — none exists
   anywhere; the house pattern is explicit setting at every write site
   (`whatsapp_sessions.updated_at`, labelled "SESSION WRITE — ALWAYS" at
   each RPC call site). Fixed: documented via column comment as
   explicitly-set-by-the-future-writer, matching that convention, so a
   future reader doesn't assume a trigger exists and build staleness logic
   on a column that was never actually refreshed.
3. **`idx_checkin_escalations_engineer` dropped.** No query in this
   codebase, in `docs/bot-flows.md`'s DASH-01 spec, or in the (unbuilt)
   escalation sweep job is keyed by `engineer_id` first — the only
   candidate use (a future per-engineer 7-day pattern view) is
   speculative, not built, not specified. Migration 021 exists precisely
   because this project shipped a redundant index once already and had to
   clean it up afterward; not repeating that. `idx_checkin_escalations_
   project_date` — which serves DASH-01's actual project+date query shape
   — stays.

Nothing about the table's PURPOSE, grain, or RLS approach changed — §3's
question for the reviewer (RLS scoping) is exactly as it was and is the
one item this package still needs external judgment on.

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

File contents pinned via `git show`, not retyped. Committed on
`feat/checkin-escalations-nudges`, commit
`236ac414bd1b4b9dc7e529698da55a2606ed0d22` — this is the SHA that would be
pasted to test-db/prod, not a paraphrase of it. Supersedes the earlier pin
at `77ba1fba9ba8ed0522646f019bfca31a039ab0ae` (the pre-internal-review
version) — see "Internal review pass" above for what changed and why.

```
$ git show 236ac414bd1b4b9dc7e529698da55a2606ed0d22:supabase/migrations/027_checkin_escalations.sql
-- =============================================================================
-- 027_checkin_escalations.sql
-- ----------------------------------------------------------------------------
-- STATUS: WRITTEN ONLY. Not rehearsed on test-db, not applied anywhere, not
-- pushed. This file exists so docs/reviews/027-review-package.md can pin it
-- via `git show <sha>:path` (CLAUDE.md §0 provenance rule) BEFORE the
-- external review round runs — not after. Do NOT rehearse or apply this
-- migration until that review confirms the RLS design below. It trips the
-- external-review gate on two independent grounds (CLAUDE.md §0): a brand
-- new table has no prior safe state to fall back on ("CREATES OR MODIFIES...
-- a new table with wrong RLS from day one... is at least as dangerous as a
-- bad change to an existing one"), and RLS/grants are named explicitly as
-- trigger (b), the condition CLAUDE.md calls out by name after migration
-- 020's incident.
--
-- WHAT THIS IS FOR
-- Backs the check-in nudges / escalation feature (docs/bot-flows.md TRIGGER
-- TIMES, "Morning cutoff" + design-principles.md Rule 7.2): one row per
-- (project, engineer, log_date, half) tracking that half's nudge/escalation
-- lifecycle — awaited -> nudged -> escalated (PM notified) -> submitted /
-- not_submitted. Read by the DASH-01 exceptions surface (bot-flows.md,
-- not yet built) to show a PM which engineers are missing today. Written
-- only by the escalation sweep job (not yet built — same "schema before
-- handler" sequencing as migration 023's dprs table before the dpr_generate
-- handler existed).
--
-- ROSTER PRECEDENT — project_members, NOT daily_logs (per lib/dpr/
-- accountability.ts's own header, the house precedent for this exact
-- problem shape). accountability.ts asks "who's missing," and an engineer
-- who submitted nothing has no daily_logs row to read — absence can't be
-- detected from rows that don't exist. This table has the same shape: it
-- exists BECAUSE an engineer hasn't submitted, so anything driving it (the
-- roster of who SHOULD have a row today) has to come from project_members,
-- never from daily_logs. Not restated as code here — this migration is
-- schema only — but the job handler that populates this table MUST follow
-- accountability.ts's left-join-and-look-for-NULL shape, not the fetch-
-- what-exists shape lib/dpr/assemble.ts uses for a different question.
--
-- UNIQUE (project_id, engineer_id, log_date, half) — AT-LEAST-ONCE WRITE
-- SAFETY, not just a dedupe convenience. The escalation sweep is a job
-- polled by the existing /api/jobs/tick worker (NFR-16) — the same queue
-- whose retry/backoff semantics mean a sweep for a given engineer/day/half
-- can legitimately run more than once (a retried job after a transient
-- failure, or two overlapping poller invocations under BOT-26-style
-- ordering pressure). Nothing about this table's writer is exactly-once by
-- construction. The UNIQUE constraint is what turns "the sweep may fire
-- more than once" into "at most one row exists regardless" — the writer
-- upserts (INSERT ... ON CONFLICT (project_id, engineer_id, log_date, half)
-- DO UPDATE) rather than plain INSERT, the same idempotency shape
-- processed_messages (011) uses for inbound webhook SIDs and dprs (023)
-- uses for regeneration. Without it, a re-run sweep would create duplicate
-- escalation rows for the same engineer/day/half, double-counting on
-- DASH-01 and potentially double-firing a PM notification.
--
-- nudge_outcome — ONE nullable column, not three independent booleans.
-- INTERNAL-REVIEW CHANGE (2026-08-12): the first draft of this migration
-- stored the send outcome as three separate booleans (sent_free_form,
-- sent_template, template_unavailable) ALONGSIDE the five-value `status`
-- lifecycle column — two representations of overlapping facts, free to
-- disagree (nothing prevented status='nudged' with all three false, or
-- sent_free_form AND sent_template both true simultaneously). Caught before
-- this went to external review, not by him — the exact class of bug this
-- project has been bitten by four times now (see CLAUDE.md's HAND-MIRRORED
-- RECONCILIATION entry for the pattern, though that entry is about a
-- different pair of columns). Collapsed to a single nullable
-- `nudge_outcome`, CHECK-constrained to ('free_form', 'template',
-- 'unavailable', 'failed'), NULL meaning not attempted. `status` keeps
-- answering a DIFFERENT question (where the escalation lifecycle is:
-- awaited/nudged/escalated/submitted/not_submitted) — two columns, one job
-- each, same principle as schema.ts's CapturedCount in the DPR pipeline
-- (lib/dpr/schema.ts): a contradictory state is impossible BY CONSTRUCTION,
-- not by discipline.
--
-- 'template' AND 'unavailable' ARE UNREACHABLE VALUES TODAY, BY DESIGN —
-- recorded so a future reader doesn't mistake a dead code path for a bug.
-- Per bot-flows.md's 2026-08-12 correction, free-form send is the PRIMARY
-- path for every trigger and the named template is the FALLBACK for a
-- closed 24h session window. But CLAUDE.md §10 Week 2 item 5/6: the Twilio
-- PRODUCTION sender is still BLOCKED on company registration, and
-- bot-flows.md's own "Sandbox limitation" section states the Twilio
-- SANDBOX cannot send custom approved templates at all — session messages
-- only. So until the production sender exists, no code path in this system
-- can attempt a template send, meaning nudge_outcome can only ever land on
-- 'free_form', 'failed', or NULL — never 'template' or 'unavailable'. They
-- exist now so the escalation job handler's schema is stable when that
-- sender ships, not because either is exercised today. Do not treat their
-- absence from every row as evidence the fallback path was tested; it is
-- evidence the fallback path has never been reachable. ('free_form' and
-- 'failed' ARE reachable today, unlike the booleans-era note this replaces
-- implied for the whole column — free-form/session sends already work in
-- the Twilio sandbox, and a send can fail for ordinary infra reasons
-- regardless of which path it took.)
--
-- RLS SCOPING — DELIBERATELY MIRRORS dprs_select (023), FLAGGED FOR REVIEW,
-- NOT ASSERTED AS SETTLED. The policy below is SELECT-only,
-- project_members-scoped, tenant_id + EXISTS-over-project_members — byte-
-- for-byte the same shape as dprs_select. That shape was right for dprs
-- because a DPR is a single-project artifact (CLAUDE.md §4: "Owner DPR
-- content is strictly single-project scoped"). checkin_escalations is
-- different in one respect worth naming, not resolving here: it is
-- ACCOUNTABILITY data — who has and hasn't submitted — and a PM who sits on
-- multiple projects sees it project-by-project under this policy, same as
-- every other project-scoped table. Whether that is the right scope for
-- accountability data specifically (as opposed to, say, a tenant-wide
-- admin view across all of a PM's projects) is an open question put
-- directly to the reviewer in docs/reviews/027-review-package.md — this
-- migration takes the dprs_select shape as its starting point, not its
-- final answer.
--
-- RISK CLASS: additive (new table only, no existing object touched) but
-- NOT low-risk by CLAUDE.md §0's own subject-matter test — a new table
-- with RLS from day one is explicitly named as the case with no prior safe
-- state to fall back on, hence the external-review gate and the
-- WRITTEN-ONLY status above. Reversible without PITR if it ever needs
-- rolling back pre-apply (nothing else references this table yet).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. checkin_escalations table.
-- -----------------------------------------------------------------------------
CREATE TABLE public.checkin_escalations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NOT trigger-maintained — no trigger exists anywhere in this project for
  -- any updated_at column (checked: grepped every migration; the house
  -- pattern is explicit setting at every write site, e.g.
  -- whatsapp_sessions.updated_at, labelled "SESSION WRITE — ALWAYS" at each
  -- RPC call site that touches it). This column follows the same
  -- convention: the escalation sweep job (not yet built) MUST set
  -- updated_at = now() explicitly on every UPDATE/upsert. See this column's
  -- own COMMENT below — read that before assuming Postgres refreshes this
  -- for you on UPDATE. It does not.
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id),
  project_id           UUID NOT NULL REFERENCES public.projects(id),
  engineer_id          UUID NOT NULL REFERENCES public.users(id),
  log_date             DATE NOT NULL,
  half                 TEXT NOT NULL CHECK (half IN ('morning', 'evening')),
  status               TEXT NOT NULL DEFAULT 'awaited'
                          CHECK (status IN (
                            'awaited', 'nudged', 'escalated', 'submitted', 'not_submitted'
                          )),
  nudge_sent_at        TIMESTAMPTZ,
  escalated_at         TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ,
  -- See header note above: 'template' / 'unavailable' are unreachable
  -- values until the Twilio production sender exists. NULL = not attempted.
  nudge_outcome        TEXT CHECK (nudge_outcome IN (
                          'free_form', 'template', 'unavailable', 'failed'
                        )),
  -- At-least-once write safety for the escalation sweep — see header note.
  UNIQUE (project_id, engineer_id, log_date, half)
);

COMMENT ON TABLE public.checkin_escalations IS
  'One row per (project, engineer, log_date, half) tracking that half''s '
  'nudge/escalation lifecycle: awaited -> nudged -> escalated -> submitted / '
  'not_submitted. Roster comes from project_members, never daily_logs (see '
  'lib/dpr/accountability.ts header for why). Written only by the escalation '
  'sweep job (not yet built) via service_role, upserting on the UNIQUE key to '
  'stay correct under at-least-once job retries. Read by the DASH-01 '
  'exceptions surface (docs/bot-flows.md).';

COMMENT ON COLUMN public.checkin_escalations.updated_at IS
  'Set explicitly by the escalation sweep job on every write — NOT trigger-'
  'maintained (no updated_at trigger exists anywhere in this project). '
  'Mirrors whatsapp_sessions.updated_at''s "SESSION WRITE — ALWAYS" '
  'convention. A row where this lags created_at despite a real status '
  'change is a bug in that writer, not expected behaviour.';

COMMENT ON COLUMN public.checkin_escalations.nudge_outcome IS
  'Which send path was actually used for the most recent attempt this half.'
  ' ''template'' and ''unavailable'' are UNREACHABLE until the Twilio '
  'production sender exists (CLAUDE.md §10) — the sandbox cannot send '
  'custom templates at all. NULL means no send has been attempted yet; '
  'distinct from ''failed'', which means an attempt was made and did not '
  'succeed. Kept separate from `status` deliberately — status is the '
  'escalation LIFECYCLE, this is the send-path OUTCOME, and collapsing '
  'them (or splitting outcome across independent booleans, as an earlier '
  'draft of this migration did) makes contradictory states representable. '
  'See this migration''s header for the fuller reasoning.';

-- Serves the DASH-01 exceptions surface's actual query shape (project +
-- date). idx_checkin_escalations_engineer (engineer_id, log_date) was in
-- the first draft of this migration and is DROPPED here, not shipped: no
-- query in this codebase or in bot-flows.md's DASH-01/escalation-sweep
-- spec is keyed by engineer_id first. The only candidate use (a future
-- per-engineer 7-day pattern view) is speculative — not built, not
-- specified — and migration 021 exists specifically because this project
-- shipped a redundant index once already and had to clean it up later. Add
-- it back with a real query to justify it, not ahead of one.
CREATE INDEX idx_checkin_escalations_project_date
  ON public.checkin_escalations (project_id, log_date);

-- -----------------------------------------------------------------------------
-- 2. RLS: SELECT only, project_members-scoped — mirrors dprs_select (023).
--    See the RLS SCOPING header note above: this shape is a starting point
--    for review, not asserted as final for accountability data specifically.
--    No authenticated/anon write policy exists; the only writer is the
--    escalation sweep job via service_role, which bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.checkin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkin_escalations_select" ON public.checkin_escalations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = checkin_escalations.project_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM anon;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.checkin_escalations;  -- drops its policy + indexes
-- COMMIT;
-- =============================================================================
```

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
- **Send outcome**: one nullable `nudge_outcome` column, `CHECK IN
  ('free_form', 'template', 'unavailable', 'failed')` — `'template'` and
  `'unavailable'` are UNREACHABLE today (see §4). Deliberately kept
  separate from `status` rather than merged or split across booleans — see
  "Internal review pass" at the top of this package.
- **`updated_at`**: NOT trigger-maintained — explicit-set-by-writer, same
  convention as `whatsapp_sessions.updated_at`. See "Internal review pass."
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

## 4. A value deliberately inert today — `nudge_outcome IN ('template', 'unavailable')`

Recorded here as well as in the migration file, so a reviewer doesn't have
to open the SQL to find it: `nudge_outcome` can only ever land on
`'free_form'`, `'failed'`, or `NULL` right now — never `'template'` or
`'unavailable'`. The Twilio **production** sender is still blocked on
company registration (CLAUDE.md §10, Week 2 item 5/6, unresolved as of
this package), and the **sandbox** cannot send custom approved templates
at all (`docs/bot-flows.md`'s "Sandbox limitation" section) — so no code
path anywhere in this system can attempt a template send today,
closed-window fallback or otherwise (`docs/bot-flows.md`'s 2026-08-12
TRIGGER TIMES correction: free-form is primary, template is the fallback
for a closed 24h session window). Those two values exist so the escalation
job handler's schema doesn't need a follow-up migration the day the
production sender ships — not because either is exercised now. Unlike the
first draft's all-false booleans, `'free_form'` and `'failed'` genuinely
ARE reachable today (free-form/session sends already work in the Twilio
sandbox; a send can fail for ordinary infra reasons regardless of path) —
this column is not wholesale inert, only two of its four values are.
**Ask during review**: is it acceptable to ship a column whose full value
range isn't reachable yet, same precedent as `dprs.generator_job_id`
shipping in 023 ahead of the job handler that populates it? No objection
expected, flagged so it isn't a surprise.

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
