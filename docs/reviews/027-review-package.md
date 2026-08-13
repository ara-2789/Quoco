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

## External review round 1 (2026-08-13) — verdict STOP, three blocking findings, all fixed

The external reviewer read the round-1 file (pinned above,
`236ac414bd1b4b9dc7e529698da55a2606ed0d22`) and returned STOP: three
blocking findings, two non-blocking. Every finding was independently
VERIFIED before acting — against the real policy text, real prod data, or
a real grep of the app — not accepted on the reviewer's word alone. Two
places sharpened his own framing rather than just confirming it (1a/1b
below); both sharpenings were themselves verified, not asserted. All five
are fixed in the file this package now pins (commit
`922b829fc52577eb6ae25d95c940a0fef97bdbb8`), none left as follow-ups —
this section exists so the re-review is short: he sees his findings
landed, not re-derived from scratch.

1. **RLS needs a role gate (blocking).** The round-1 policy mirrored
   `dprs_select`'s project-membership scoping only — no gate on WHO within
   a project's membership could read. Reviewer's frame, confirmed correct:
   `dprs` is a deliverable (shown to people on the project);
   `checkin_escalations` is internal management data about the
   contractor's own staff. Same scoping shape, opposite audience.
   - **1a, sharpened and VERIFIED, not just confirmed**: the reviewer's
     strongest case is the engineer, not the owner. Checked directly
     against prod: `project_members.role` already holds the value
     `'engineer'` TODAY — the test engineer (`3534756b`) is a live
     `project_members` row with `role='engineer'` on the project this
     migration's own smoke test used. The round-1 policy's `EXISTS` never
     filtered `project_members.role` at all, so that row would satisfy it
     the moment engineers get web logins. Inert today only because
     `auth_id = NULL` (CLAUDE.md §5), not because of the policy.
   - **1b, sharpened and VERIFIED**: the owner case needs one more step
     than the reviewer named. Confirmed via `023_dpr_reports.sql`'s own
     header: "Owners are not associated via `project_members` at all...
     Owner association is a SEPARATE mechanism, `projects.owner_user_id`."
     So an owner login alone does not satisfy the old `EXISTS` — the leak
     needs a FUTURE Phase 2 change (an owner dashboard adding owners to
     `project_members`) before it's reachable. Real forward risk, recorded
     one step further away than the reviewer's own framing stated it.
   - **Fix**: kept the tenant pin and the `project_members` `EXISTS`
     exactly as written; added `role IN ('pm', 'admin')`, resolved in the
     SAME lookup that resolves `auth.uid() -> id` (not a second subquery —
     the performance point was mine, not his, folded into the same fix).
     `'qs'` excluded — Aravind's decision, recorded as a decision in the
     policy comment (measurement/valuation, not attendance), not inherited
     as a side effect of the `dprs_select` shape this started from. The
     membership requirement stays for admins too — "should a tenant admin
     see every project" is a DASH-01 product decision, not something to
     smuggle into a table policy.
   - Forward-rationale sentence added to the migration header verbatim in
     spirit: role-gated because owner/engineer logins are both planned,
     not hypothetical, and this is internal-management data neither
     audience has a product reason to read.
2. **Referential actions chosen, not inherited (blocking).** All three FKs
   defaulted to `NO ACTION` by omission; 017 established these are chosen
   and written. **VERIFIED, not accepted**: grepped `app/` and `lib/` for
   any project-delete code path — NONE EXISTS today (only list/new/`[id]`
   pages, zero delete/archive action anywhere). So "the first PM to delete
   a project" cannot happen through the product as it stands — the
   reviewer's specific framing overstated how the consequence would arise.
   But `project_members.project_id` has carried `ON DELETE CASCADE` since
   migration 001 regardless of any UI, so the schema already anticipates
   project deletion as a real (if currently manual-only) operation — the
   underlying concern survives the correction, only the mechanism changes.
   Fix: `project_id` → `CASCADE` (meaningless without its project, same as
   `project_members`). `engineer_id` → `CASCADE`, decided explicitly with
   `RESTRICT` named and rejected in the header (RESTRICT would in practice
   never fire — this system never hard-deletes a user row — CASCADE
   chosen for consistency with `project_members.user_id`'s own CASCADE and
   this table's prunable/operational classification, see finding 5).
   `tenant_id` → `CASCADE`, matching 001's near-universal house pattern
   rather than `dprs`'s (023) undocumented deviation to plain `NO ACTION`.
3. **Cross-tenant reference integrity (blocking).** Writer is
   `service_role`, bypassing RLS and grants — nothing structural stopped a
   buggy sweep writing a tenant-A row pointing at a tenant-B project. Two
   house precedents existed and round 1 cited neither: 017's composite
   same-tenant FKs, or 019's documented plain-FK exception. Reviewer
   recommended the composite FKs since the parent `UNIQUE(id, tenant_id)`
   indexes (017) already exist — nearly free — and this table's writer
   doesn't exist yet to verify same-tenant behaviour any other way. Agreed
   and implemented: `FOREIGN KEY (project_id, tenant_id) REFERENCES
   projects (id, tenant_id)` and the same shape for `engineer_id` ->
   `users`, both `ON UPDATE NO ACTION` (tenant_id is immutable
   post-creation, 007 §9 — matching 017's own reasoning verbatim). His
   decisive line, now in the migration header: what is not acceptable is
   the current state — plain FKs with the question unasked — on the table
   whose entire purpose is per-project accountability claims.
4. **Lifecycle CHECK constraints (non-blocking, done anyway).**
   `status='nudged'` with `nudge_sent_at IS NULL` was representable, same
   for `'escalated'`/`escalated_at` and `'submitted'`/`resolved_at`. Same
   principle the internal pass already applied to the send-outcome
   booleans — impossible by construction, not by discipline — left
   unapplied one column over. Three `CHECK` constraints now close it,
   zero cost while the table is unapplied.
5. **Retention register (non-blocking).** Roughly 2x `daily_logs` growth
   (one row per engineer per day per half) with no retention posture
   recorded. Per 021's taxonomy this is the prunable hygiene class —
   DASH-01 cares about today, long-horizon patterns are a future view's
   problem, not this table's. Given its own line in CLAUDE.md §10's DATA
   RETENTION POSTURE register rather than joining the unbounded-growth
   list unrecorded — see that entry for the full reasoning, not restated
   here.

Also recorded separately, at Aravind's request, next to CLAUDE.md §0's
external-review gate definition: this was the first genuinely PRE-STATE
review in this series — nothing above was a live defect being reported
after the fact, all three blocking findings were caught before a single
byte reached any database. The same three findings surfacing later, in a
retroactive package, would have been live defects on a client-facing
surface (a client-facing surface only in the sense that PM/admin accounts
would already be reading it) instead of lines in a migration file nobody
has run yet. That difference — what a reviewer can do when the state
doesn't exist yet versus when it already does — is the entire argument
for gating in the first place.

## Round 2 (2026-08-13) — closed_at symmetry, then rehearsal

**Reviewer signed off on round 1 with one open question**: round 1's three
lifecycle CHECK constraints covered `'nudged'`/`'escalated'`/`'submitted'`
but not `'not_submitted'` — why not? Not an oversight to paper over and
not a deliberate asymmetry worth a comment defending it, because there
wasn't a real reason for the asymmetry. Aravind's decision: make the two
TERMINAL states symmetric, and rename.

- `resolved_at` → `closed_at`. "Resolved" was the wrong word for a day
  that simply ran out — nothing is resolved when a window closes with
  nobody having submitted; the window closed, that's all.
- Stamped on BOTH terminal states now — `'submitted'` AND
  `'not_submitted'` — not just the happy one.
- Fourth CHECK added, completing the family:
  `status <> 'not_submitted' OR closed_at IS NOT NULL`.
- A SINGLE `closed_at` (not two separate timestamp columns) is the point,
  not an accident of naming: a late submission arriving after the 15:00
  cutoff and flipping `'not_submitted'` → `'submitted'` just moves
  `closed_at` forward, rather than forcing a choice between two columns on
  that transition.

Done immediately, before rehearsal — free while the file is unapplied, not
free once it isn't. Fixed in commit
`15da4ffa55e3965969a1962bf0cc2c034a6e5115` (this package's current pin).

### Rehearsal — test-db, `exfccwlrhoutkgrlikod`

Flagged and entered as its own step, not folded into "build." Linked ref
confirmed BEFORE any write (`supabase link --project-ref
exfccwlrhoutkgrlikod`, then independently cross-checked — the migration
ledger on this connection shows 023/024/025/026/027 all unrecorded on
`remote`, which diverges from prod's known ledger state, and `public.dprs`
returned zero rows here where prod has one — two independent signals,
not one, that this connection was genuinely test-db before anything was
written). Applied via `supabase db query --linked -f
supabase/migrations/027_checkin_escalations.sql` — file apply, never
`db push`, foreground throughout, nothing backgrounded.

**Post-apply shape check** (read-only, before any fixture data):
`closed_at` present as `TIMESTAMPTZ`, all four lifecycle CHECK constraints
present with the expected definitions (`checkin_escalations_nudged_
requires_timestamp`, `_escalated_requires_timestamp`, `_submitted_
requires_timestamp`, `_not_submitted_requires_timestamp`), both composite
FKs present (`checkin_escalations_project_id_fkey` →
`projects(id, tenant_id)`, `checkin_escalations_engineer_id_fkey` →
`users(id, tenant_id)`, both `ON DELETE CASCADE`), `tenant_id` FK present
with `ON DELETE CASCADE`, and the RLS policy's `USING` expression showing
exactly the role-gated shape from the migration file — all confirmed by
querying `information_schema.columns`, `pg_constraint`, and `pg_policy`
directly, not assumed from the file having applied without error.

**Fixtures** (constructed to reproduce prod's own live shape, per the
reviewer's own framing — "prod hands you the fixture shape for free"):
two tenants, one project each, six users spanning `pm`/`admin`/`engineer`/
`qs` roles with `project_members` rows (one deliberately WITHOUT a
membership row), one `checkin_escalations` row under test. Built via
`auth.users` inserts (this project's `handle_new_user` trigger auto-
creates a matching `public.users` stub row per insert — discovered mid-
rehearsal when an explicit second `INSERT INTO public.users` collided
with the trigger's own row on `uq_users_auth_id`; fixed by UPDATing the
trigger-created stub instead of inserting a competing row) plus explicit
`tenants`/`projects`/`project_members`/`checkin_escalations` inserts.

**RLS role-gate — prove-open AND prove-closed, every case, raw output.**
Each case ran as a fresh `SET ROLE authenticated; SET request.jwt.claim.sub
= '<auth_id>'` session (`auth.uid()`'s own implementation confirmed first
— `coalesce(current_setting('request.jwt.claim.sub', true),
current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid` — not
assumed):

- **CASE 1 — MUST BE DENIED: engineer, HAS a `project_members` row on the
  project.** The migration's central purpose in one assertion — passing
  membership, failing the role gate.
  ```
  {"case_label": "CASE 1: engineer+membership -> expect 0 rows", "row_count": 0}
  ```
  **DENIED. Confirmed.**
- **CASE 2 — MUST BE DENIED: `'qs'`, HAS membership.** Aravind's recorded
  exclusion decision.
  ```
  {"case_label": "CASE 2: qs+membership -> expect 0 rows", "row_count": 0}
  ```
  **DENIED. Confirmed.**
- **CASE 3 — MUST BE DENIED: `'pm'`, correct role, NO membership row.**
  ```
  {"case_label": "CASE 3: pm, no membership -> expect 0 rows", "row_count": 0}
  ```
  **DENIED. Confirmed.**
- **CASE 4 — MUST BE DENIED: `'pm'`, correct role AND membership, but on a
  DIFFERENT tenant's own project** (member of tenant B's project, querying
  tenant A's row) — proves the outer `tenant_id = get_user_tenant_id()`
  pin independently of the role/membership gate.
  ```
  {"case_label": "CASE 4: pm, different tenant -> expect 0 rows", "row_count": 0}
  ```
  **DENIED. Confirmed.**
- **CASE 5 — MUST BE ALLOWED: `'pm'` with membership.** Row asserted
  PRESENT explicitly, not absence-of-error alone — per the 023-test
  discipline, a total-lockout bug must not be able to pass as a clean run.
  ```
  {"case_label": "CASE 5: pm+membership -> expect 1 row", "id": "5f035886-88bb-487d-8ddb-d9294a42b7fb", "tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "project_id": "bbbbbbbb-0000-0000-0000-000000000001", "engineer_id": "f39d4e0d-8d99-44c3-9607-1765b345766f", "status": "awaited"}
  ```
  **ALLOWED. Row present. Confirmed.**
- **CASE 6 — MUST BE ALLOWED: `'admin'` with membership.**
  ```
  {"case_label": "CASE 6: admin+membership -> expect 1 row", "id": "5f035886-88bb-487d-8ddb-d9294a42b7fb", "tenant_id": "aaaaaaaa-0000-0000-0000-000000000001", "project_id": "bbbbbbbb-0000-0000-0000-000000000001", "engineer_id": "f39d4e0d-8d99-44c3-9607-1765b345766f", "status": "awaited"}
  ```
  **ALLOWED. Row present, same row as CASE 5. Confirmed.**

**Composite FK — cross-tenant rejection, the entire argument for finding
#3, proven, not left as a comment.** Attempted an `INSERT` (as the
elevated connection, matching how `service_role` writes for real) with
`tenant_id` = tenant A but `project_id` = tenant B's own project — a row
the plain single-column FK draft would have accepted silently:

```
$ INSERT INTO public.checkin_escalations (tenant_id, project_id, engineer_id, log_date, half, status)
  SELECT 'aaaaaaaa-...-0001', 'bbbbbbbb-...-0002', id, '2026-08-14', 'morning', 'awaited'
  FROM public.users WHERE auth_id = '33333333-...';

ERROR: 23503: insert or update on table "checkin_escalations" violates
foreign key constraint "checkin_escalations_project_id_fkey"
DETAIL: Key (project_id, tenant_id)=(bbbbbbbb-0000-0000-0000-000000000002,
aaaaaaaa-0000-0000-0000-000000000001) is not present in table "projects".
```

**REJECTED. Confirmed.** The composite FK bites exactly as designed.

**Cleanup**: all fixture rows removed after testing (`checkin_escalations`
→ `project_members` → `public.users` → `auth.users` → `projects` →
`tenants`, respecting FK order), verified by a zero-count query across all
three tables afterward — test-db is reusable shared infrastructure, not
this rehearsal's own scratch space, so it goes back to how it was found.
The applied SCHEMA (the `checkin_escalations` table itself) stays on
test-db, matching this project's own rehearsal convention — schema
changes persist across rehearsals, fixture data doesn't.

Linked ref switched back to `jvxwqignooseazzmwhvl` (prod) and confirmed
immediately after, before anything else.

**Not applied to prod. Not merged.** Round 2 sign-off (§7) is the next
gate — prod apply is a separate decision after that, per Aravind's
explicit instruction.

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
`15da4ffa55e3965969a1962bf0cc2c034a6e5115` — this is the SHA that was
actually applied to test-db during rehearsal (see "Round 2" below), and
the SHA that would be pasted to prod, not a paraphrase of it. Supersedes
the earlier pins at `77ba1fba9ba8ed0522646f019bfca31a039ab0ae`
(pre-internal-review), `236ac414bd1b4b9dc7e529698da55a2606ed0d22`
(post-internal-review, pre-external-review), and
`922b829fc52577eb6ae25d95c940a0fef97bdbb8` (post-round-1, pre-round-2) —
see "Internal review pass", "External review round 1", and "Round 2"
above for what changed at each step and why.

```
$ git show 15da4ffa55e3965969a1962bf0cc2c034a6e5115:supabase/migrations/027_checkin_escalations.sql
-- =============================================================================
-- 027_checkin_escalations.sql
-- ----------------------------------------------------------------------------
-- STATUS: WRITTEN ONLY. Not rehearsed on test-db, not applied anywhere, not
-- pushed. This file exists so docs/reviews/027-review-package.md can pin it
-- via `git show <sha>:path` (CLAUDE.md §0 provenance rule) BEFORE the
-- external review round runs — not after. Do NOT rehearse or apply this
-- migration until Aravind and the reviewer have both seen this revision. It
-- trips the external-review gate on two independent grounds (CLAUDE.md §0): a
-- brand new table has no prior safe state to fall back on ("CREATES OR
-- MODIFIES... a new table with wrong RLS from day one... is at least as
-- dangerous as a bad change to an existing one"), and RLS/grants are named
-- explicitly as trigger (b), the condition CLAUDE.md calls out by name after
-- migration 020's incident.
--
-- REVIEWED TWICE, both incorporated here, neither left as a follow-up:
--   1. INTERNAL PASS (2026-08-12, Aravind reading the branch directly) — see
--      the "nudge_outcome" section below.
--   2. EXTERNAL PRE-APPLY REVIEW (2026-08-13) — verdict STOP, three blocking
--      findings + two non-blocking. See "RLS — ROLE GATE", "REFERENTIAL
--      INTEGRITY", and "LIFECYCLE CHECK CONSTRAINTS" below for each. Full
--      external review record: docs/reviews/027-review-package.md.
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
-- RLS — ROLE GATE (EXTERNAL REVIEW, 2026-08-13, blocking finding #1, FIXED).
-- The prior draft mirrored dprs_select (023) byte-for-byte: tenant pin +
-- project_members EXISTS, no further gate. The reviewer's frame, confirmed
-- correct rather than accepted on faith: dprs is a DELIVERABLE — shown to
-- people ON the project, owner included (once a Phase 2 owner dashboard
-- exists); single-project scoping is the entire point of that policy.
-- checkin_escalations is the opposite kind of data — INTERNAL MANAGEMENT
-- information about the contractor's OWN STAFF's submission behaviour.
-- Project membership answers "are you attached to this project?" when the
-- real question is "are you management?" Same scoping SHAPE (tenant +
-- project), opposite AUDIENCE.
--
-- TWO CONCRETE LEAKS, BOTH VERIFIED AGAINST REAL STATE, NOT ASSUMED:
--   (a) ENGINEER — the sharper of the two. The old policy's EXISTS did not
--       filter project_members.role at all: ANY project_members row for
--       that project/user satisfies it, engineer or not. Checked directly
--       against prod, not hypothetically: project_members.role already
--       holds the value 'engineer' TODAY (the 025/027 test engineer,
--       3534756b, is a live project_members row with role='engineer' on
--       project acef67fe). Nothing in the OLD policy would have excluded
--       that row from reading every other engineer's miss-list on that
--       project, the moment engineers get web logins — the only reason
--       it's inert today is auth_id=NULL (CLAUDE.md §5: engineers are
--       WhatsApp-bot-only, no web login), not the policy.
--   (b) OWNER — real, but one step further away than it first reads.
--       023's own header states owners are NOT in project_members at all
--       ("Owners are not associated via project_members at all... Owner
--       association is a SEPARATE mechanism, projects.owner_user_id") — so
--       an owner login ALONE does not satisfy the old EXISTS. The leak
--       needs a FUTURE change (a Phase 2 owner-facing dashboard adding
--       owners to project_members, which is a plausible design, not a
--       remote one) before it's reachable. Recorded precisely rather than
--       overstated: this is a forward risk one step removed, not a live
--       hole the way (a) is.
--
-- FIX: keep the tenant pin and the project_members EXISTS EXACTLY as
-- written (the project-scoping shape was never the problem) and ADD a
-- caller-role gate: only `role IN ('pm', 'admin')` may read. 'qs' is
-- DELIBERATELY EXCLUDED — Aravind's decision, recorded here as a decision,
-- not inherited as a side effect of the dprs_select shape this migration
-- started from: a quantity surveyor deals with measurement and valuation,
-- not attendance, and has no product reason to see who has and hasn't
-- checked in. The membership requirement stays for admins too, deliberately
-- — CLAUDE.md §4's "should a tenant admin see every project" is a DASH-01
-- product decision, not something to smuggle into a table policy via an
-- unrelated migration.
--
-- FORWARD RATIONALE (so Phase 2's author inherits the REASON, not just the
-- gate): this policy is role-gated because owner and engineer web logins
-- are BOTH planned, not hypothetical, and this table is internal-management
-- data neither audience has a product reason to read. If either login
-- capability ships, re-verify this gate before shipping it, don't assume
-- the shape below still covers the new case unexamined.
--
-- PERFORMANCE (mine, not the reviewer's, folded into the same fix): the
-- naive version of this gate would run a SECOND per-row subquery to resolve
-- auth.uid() -> role, on top of the existing one resolving auth.uid() -> id
-- for the membership join — doubling the users lookup on every row
-- evaluated. The policy below resolves id AND role in ONE lookup (a single
-- `users` row, joined once), not two.
--
-- RISK CLASS: additive (new table only, no existing object touched) but
-- NOT low-risk by CLAUDE.md §0's own subject-matter test — a new table
-- with RLS from day one is explicitly named as the case with no prior safe
-- state to fall back on, hence the external-review gate and the
-- WRITTEN-ONLY status above. Reversible without PITR if it ever needs
-- rolling back pre-apply (nothing else references this table yet).
--
-- REFERENTIAL INTEGRITY (EXTERNAL REVIEW, 2026-08-13, blocking findings
-- #2 and #3, FIXED). Two separate findings, one fix each, both about FK
-- shape:
--
-- #2 — REFERENTIAL ACTIONS CHOSEN, NOT INHERITED. All three FKs in the
--   first draft defaulted to NO ACTION by omission (Postgres's default,
--   never stated). 017's own header establishes the house rule these are
--   CHOSEN and WRITTEN, not left to default. VERIFIED, not accepted from
--   the review text: grepped app/ and lib/ for a project-delete code path
--   — NONE EXISTS today (only list/new/[id] pages under
--   app/(dashboard)/projects/, zero delete/archive action anywhere). So
--   "the first PM to delete a project" cannot happen through the product
--   as it stands. But the SCHEMA already anticipates project deletion as a
--   real operation regardless of the UI: project_members.project_id has
--   carried ON DELETE CASCADE since migration 001, and nothing stops a
--   direct/manual project deletion today. The underlying concern is real
--   even though the specific "first PM clicks delete" framing overstated
--   how it would happen; the fix is the same either way.
--   CHOSEN: project_id -> ON DELETE CASCADE (an escalation row is
--   meaningless without its project — identical reasoning to
--   project_members.project_id's own CASCADE, the sibling table this
--   design is modeled on).
--   engineer_id -> ON DELETE CASCADE, decided explicitly, not defaulted.
--   RESTRICT was the alternative and is defensible on its own terms — this
--   system NEVER hard-deletes a user row (status='deactivated' is the only
--   lifecycle transition anywhere in this codebase; CLAUDE.md §5), so
--   RESTRICT would in practice just never fire. CASCADE was chosen instead
--   because (a) it matches project_members.user_id's own ON DELETE CASCADE
--   exactly (017) — the sibling table checkin_escalations' roster logic is
--   already modeled on — and (b) this table is classified operational/
--   prunable-hygiene-class data (see the RETENTION note in CLAUDE.md §10,
--   added alongside this revision), not a permanent compliance record like
--   daily_logs — losing escalation history for a user row that, by this
--   system's own design, is never actually deleted is an acceptable trade
--   for consistency with the precedent table over a RESTRICT that only
--   ever guards a scenario that cannot occur.
--   tenant_id -> ON DELETE CASCADE, matching the near-universal house
--   pattern (every table in 001_core_schema.sql uses `REFERENCES
--   tenants(id) ON DELETE CASCADE`) rather than dprs's (023) undocumented
--   deviation to plain NO ACTION-by-omission — checked, not assumed, and
--   the original 001 pattern is treated as the house default here since
--   023 never explains the departure.
--
-- #3 — CROSS-TENANT REFERENCE INTEGRITY. The only writer is service_role
--   (the escalation sweep job), which bypasses BOTH RLS and grants —
--   nothing structural stops a buggy sweep writing a tenant-A row pointing
--   at a tenant-B project or engineer. Two house precedents exist for this
--   exact problem and the first draft cited neither: 017's composite
--   same-tenant FKs (FOREIGN KEY (col, tenant_id) REFERENCES parent (id,
--   tenant_id)), or 019's documented plain-FK exception with a pinned
--   argument for why a composite FK wasn't needed there. CHOSEN: the
--   composite FKs, per the reviewer's recommendation — the parent UNIQUE
--   (id, tenant_id) indexes (017: users_id_tenant_id_key,
--   projects_id_tenant_id_key) ALREADY EXIST on prod, so this costs
--   nothing beyond declaring the FK correctly, and unlike 019's case this
--   table's writer does not exist yet to independently verify same-tenant
--   behaviour some other way. What is NOT acceptable, stated as plainly as
--   the reviewer put it: plain FKs with the question unasked, on the table
--   whose entire purpose is per-project accountability claims. ON UPDATE
--   NO ACTION is stated explicitly on both composite FKs (matching 017's
--   own reasoning verbatim): tenant_id is immutable post-creation (007
--   §9), so no legitimate write ever updates a referenced (id, tenant_id)
--   key, and if one ever did, failing loud is correct — silently
--   cascading a tenant-move nobody designed is not.
--
-- LIFECYCLE CHECK CONSTRAINTS (EXTERNAL REVIEW, 2026-08-13, non-blocking
-- finding #4, DONE ANYWAY — zero cost while the table is unapplied). The
-- original five-value status/three-timestamp shape let status='nudged'
-- coexist with nudge_sent_at IS NULL, 'escalated' with escalated_at IS
-- NULL, 'submitted' with resolved_at IS NULL — three representable-but-
-- meaningless states. This is the EXACT SAME PRINCIPLE the internal pass
-- (above) already applied to the send-outcome booleans — impossible by
-- construction, not by discipline — left unapplied one column over. Three
-- CHECK constraints closed it in round 1; a fourth was still missing — see
-- resolved_at -> closed_at below.
--
-- resolved_at RENAMED TO closed_at, STAMPED ON BOTH TERMINAL STATES (ROUND
-- 2, 2026-08-13, reviewer's question, Aravind's decision). The reviewer
-- asked, correctly, why round 1's three CHECK constraints covered
-- 'nudged'/'escalated'/'submitted' but not 'not_submitted' — not an
-- oversight to paper over and not a deliberate asymmetry worth a comment
-- defending it, because there wasn't a real reason for the asymmetry to
-- exist. Decision: make the two TERMINAL states symmetric instead of
-- explaining why they weren't. 'resolved_at' was the wrong name the moment
-- a second terminal state needed it — nothing is "resolved" about a day
-- that simply ran out at the 15:00 cutoff with nobody having submitted;
-- the window closed, it wasn't resolved. Renamed to `closed_at`: the
-- timestamp a row reached ANY terminal state, submitted or not_submitted,
-- not just the happy one. A fourth CHECK constraint completes the family
-- (`status <> 'not_submitted' OR closed_at IS NOT NULL`), and the rename
-- means all four checks now read as one coherent rule — every status past
-- 'awaited' requires its own transition timestamp — rather than three
-- rules plus an unexplained gap.
--
-- LATE-SUBMISSION CASE, THE REASON closed_at (NOT TWO SEPARATE COLUMNS)
-- IS THE RIGHT SHAPE: if a submission arrives after the 15:00 morning
-- cutoff (bot-flows.md TRIGGER TIMES) and flips a row from
-- 'not_submitted' to 'submitted', a single shared `closed_at` simply
-- MOVES to the new close time — the row still has exactly one "when did
-- this stop being open" fact, because it only ever has one true answer at
-- a time. Two separate columns (`not_submitted_at`, `submitted_at`) would
-- have forced a choice on that transition — clear the first, set the
-- second, or leave both populated and let a reader guess which one is
-- current. `closed_at` never poses that question.
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
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- project_id / engineer_id: plain columns here, deliberately WITHOUT an
  -- inline single-column REFERENCES — the actual FK relationship is the
  -- composite constraint below (project_id, tenant_id) / (engineer_id,
  -- tenant_id), which also pins same-tenant. See REFERENTIAL INTEGRITY
  -- (#3) in the header. Matches 017's end-state shape for project_members
  -- exactly (project_members.project_id/.user_id carry no inline
  -- single-column FK either, only the composite table constraint).
  project_id           UUID NOT NULL,
  engineer_id          UUID NOT NULL,
  log_date             DATE NOT NULL,
  half                 TEXT NOT NULL CHECK (half IN ('morning', 'evening')),
  status               TEXT NOT NULL DEFAULT 'awaited'
                          CHECK (status IN (
                            'awaited', 'nudged', 'escalated', 'submitted', 'not_submitted'
                          )),
  nudge_sent_at        TIMESTAMPTZ,
  escalated_at         TIMESTAMPTZ,
  -- Renamed from resolved_at (round 2) — stamped on EITHER terminal state,
  -- submitted or not_submitted, not just the happy one. See the header's
  -- "resolved_at RENAMED TO closed_at" note for the full reasoning and the
  -- late-submission case this shape survives cleanly.
  closed_at            TIMESTAMPTZ,
  -- See header note above: 'template' / 'unavailable' are unreachable
  -- values until the Twilio production sender exists. NULL = not attempted.
  nudge_outcome        TEXT CHECK (nudge_outcome IN (
                          'free_form', 'template', 'unavailable', 'failed'
                        )),
  -- At-least-once write safety for the escalation sweep — see header note.
  UNIQUE (project_id, engineer_id, log_date, half),
  -- Composite same-tenant FKs — REFERENTIAL INTEGRITY #3. Parent UNIQUE
  -- (id, tenant_id) indexes already exist (017: projects_id_tenant_id_key,
  -- users_id_tenant_id_key) — nothing to add on the parent side.
  CONSTRAINT checkin_escalations_project_id_fkey
    FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT checkin_escalations_engineer_id_fkey
    FOREIGN KEY (engineer_id, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE,
  -- Lifecycle CHECK constraints — non-blocking finding #4, completed in
  -- round 2 with the fourth (not_submitted) case. Each status that implies
  -- a transition happened requires that transition's own timestamp; see
  -- the header note for why this is the same principle as the
  -- nudge_outcome collapse, applied one column over. The two terminal
  -- states (submitted, not_submitted) are symmetric on purpose — see
  -- "resolved_at RENAMED TO closed_at" above.
  CONSTRAINT checkin_escalations_nudged_requires_timestamp
    CHECK (status <> 'nudged' OR nudge_sent_at IS NOT NULL),
  CONSTRAINT checkin_escalations_escalated_requires_timestamp
    CHECK (status <> 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT checkin_escalations_submitted_requires_timestamp
    CHECK (status <> 'submitted' OR closed_at IS NOT NULL),
  CONSTRAINT checkin_escalations_not_submitted_requires_timestamp
    CHECK (status <> 'not_submitted' OR closed_at IS NOT NULL)
);

COMMENT ON TABLE public.checkin_escalations IS
  'One row per (project, engineer, log_date, half) tracking that half''s '
  'nudge/escalation lifecycle: awaited -> nudged -> escalated -> submitted / '
  'not_submitted. Roster comes from project_members, never daily_logs (see '
  'lib/dpr/accountability.ts header for why). Written only by the escalation '
  'sweep job (not yet built) via service_role, upserting on the UNIQUE key to '
  'stay correct under at-least-once job retries. Read by the DASH-01 '
  'exceptions surface (docs/bot-flows.md), gated to pm/admin roles only — see '
  'the RLS policy''s own comment for why.';

COMMENT ON COLUMN public.checkin_escalations.updated_at IS
  'Set explicitly by the escalation sweep job on every write — NOT trigger-'
  'maintained (no updated_at trigger exists anywhere in this project). '
  'Mirrors whatsapp_sessions.updated_at''s "SESSION WRITE — ALWAYS" '
  'convention. A row where this lags created_at despite a real status '
  'change is a bug in that writer, not expected behaviour.';

COMMENT ON COLUMN public.checkin_escalations.closed_at IS
  'When this row reached a TERMINAL state — status=''submitted'' OR '
  'status=''not_submitted'', whichever happened. Renamed from resolved_at '
  '(round 2 external review): "resolved" was wrong for the not_submitted '
  'case — nothing is resolved when a window simply closes with nobody '
  'having submitted. Survives a late submission cleanly: if a row flips '
  'not_submitted -> submitted after the cutoff, closed_at MOVES to the new '
  'close time rather than requiring a second column to disambiguate which '
  'terminal timestamp is current — a row has exactly one true answer to '
  '"when did this stop being open" at any moment.';

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
-- 2. RLS: SELECT only, project_members-scoped AND role-gated to management
--    roles (pm, admin) — see "RLS — ROLE GATE" in the header for the full
--    reasoning (external review, 2026-08-13). No authenticated/anon write
--    policy exists; the only writer is the escalation sweep job via
--    service_role, which bypasses RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.checkin_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkin_escalations_select" ON public.checkin_escalations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      -- ONE users lookup (auth.uid() -> id AND role together), then a
      -- single join against project_members on that resolved id — not a
      -- second subquery for role on top of a first for id. See the
      -- PERFORMANCE note in the header.
      SELECT 1
      FROM public.users u
      JOIN public.project_members pm
        ON pm.project_id = checkin_escalations.project_id
       AND pm.user_id = u.id
      WHERE u.auth_id = auth.uid()
        -- Management roles only. 'qs' deliberately excluded — Aravind's
        -- decision: a quantity surveyor deals with measurement and
        -- valuation, not attendance. 'engineer'/'owner'/'subcontractor'
        -- excluded because this is internal-management data neither
        -- audience has a product reason to read (see FORWARD RATIONALE in
        -- the header) — not because project_members.role happens to say
        -- something else; that column is NOT consulted here at all, on
        -- purpose, since the old bug was trusting project_members.role's
        -- absence-of-filtering, not its presence.
        AND u.role IN ('pm', 'admin')
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.checkin_escalations FROM anon;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.checkin_escalations;  -- drops its policy,
--     indexes, CHECK constraints, and composite FKs — nothing else was
--     altered (unlike 017, this migration never touches projects/users).
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
- **RLS**: `SELECT`-only, `project_members`-scoped AND role-gated to
  `pm`/`admin` (added in external review round 1 — see that section above;
  `dprs_select`'s membership-only shape was the round-1 starting point, not
  the final answer). No `authenticated`/`anon` write path;
  `INSERT`/`UPDATE`/`DELETE` explicitly revoked from both. Only
  `service_role` (the sweep job) writes.
- **Referential integrity** (round 1 fix): `project_id`/`engineer_id` are
  composite same-tenant FKs (`(col, tenant_id)` -> parent `(id,
  tenant_id)`, 017's pattern), `ON DELETE CASCADE` on all three FKs
  (`tenant_id`, `project_id`, `engineer_id`) — chosen explicitly, not
  defaulted. See "External review round 1" above for the reasoning behind
  each choice.
- **Lifecycle CHECK constraints** (round 1 + round 2, non-blocking, done
  anyway): all FOUR statuses past `'awaited'` — `'nudged'`, `'escalated'`,
  `'submitted'`, `'not_submitted'` — each require their own timestamp
  column set. The two terminal states share one column, `closed_at`
  (renamed from `resolved_at` in round 2 — see "Round 2" above), not two.
- **Rehearsed** (round 2, `exfccwlrhoutkgrlikod`/test-db): applied via
  file, all RLS prove-open/prove-closed cases and the composite-FK
  cross-tenant rejection confirmed with raw output — see "Round 2" above.
  Fixtures cleaned up; the applied schema stays on test-db.

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

## 3. THE QUESTION FOR THE REVIEWER — RLS scoping — ANSWERED in round 1, re-confirm the shape

**SUPERSEDED (2026-08-13): this was an open question in round 1; the
external reviewer answered it (blocking finding #1, "External review round
1" above), and the fix is now in the migration file.** Preserved below,
struck nowhere, because the ORIGINAL question is still the right frame for
judging whether the fix actually answers it — re-reading this section
alongside the round-1 finding is a faster way to confirm the fix than
reading the fix cold.

~~This is the part of the design most worth an outside read, named plainly
rather than buried in the migration file's own comments (though the same
reasoning is there too, under "RLS SCOPING" in the file header).~~

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

~~**Direct question**: is `project_members`-scoping — identical in shape to
how `dprs` is scoped — the right boundary for accountability data
specifically, or should this be narrower...~~ **ANSWERED**: project-scoping
itself was never the problem — it stays exactly as written. What was
missing was a second, independent axis: WHO within that project-scoped
audience should read internal-staff data. The fix adds `role IN ('pm',
'admin')` on top of the unchanged membership check, rather than narrowing
or replacing the membership shape. See "External review round 1" finding
#1 for the full reasoning, the two verified leak paths (engineer / owner),
and why `'qs'` is excluded.

**RE-CONFIRM, not re-litigate**: is `tenant + project_members + role IN
('pm','admin')` the right final shape, or does anything about the role
list itself (excluding `'qs'`, including `'admin'` unconditionally rather
than gated on some further admin-specific check) need another look before
rehearsal?

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

- **Rehearsal HAS now happened** (round 2, see "Round 2" above) — this
  bullet is preserved struck-through, not deleted, because §6's plan below
  originally sequenced rehearsal AFTER round 2 sign-off, and it actually
  ran BEFORE, on Aravind's explicit instruction, so the reviewer sees both
  the design decision and its live proof in one pass instead of two. The
  composite FKs, role-gated policy, and all four CHECK constraints have
  now run against a real Postgres instance on test-db, with raw output for
  every case — not proofread-and-assumed. ~~No rehearsal has happened,
  still... that's what rehearsal (§6 step 2) is for, and it hasn't
  happened.~~
- **No application code exists.** The escalation sweep job handler and the
  DASH-01 exceptions surface are both unbuilt. This package reviews the
  schema and RLS only.
- **`migration-027.test.ts` still does not exist.** Round 2's rehearsal
  proved every case by hand, via raw SQL, under real time pressure (same
  day as the evening check-in / 20:00 DPR generation this session was
  actually for) — deliberately, not as a substitute for the permanent
  test file CLAUDE.md §7 requires. That file still needs writing, covering
  the exact cases proven by hand here (the six RLS cases, the composite-FK
  rejection) so they run on every future CI invocation instead of only
  once, by hand, tonight. Same shape as `migration-015.test.ts`.
- **No decision on `types/database.ts` regeneration timing** — happens
  after apply, per the standing §6 rule, not before.

---

## 6. Rehearsal + apply plan (PLANNED, NOT EXECUTED)

Sequenced so the highest-uncertainty step (RLS + referential shape)
resolves before any database is touched, even test-db. Updated for round
2 — round 1's plan had ONE review round before rehearsal; there are now
two:

1. **Round 1** (CLOSED, 2026-08-13) — reviewer returned STOP, three
   blocking findings. Fixed in commit `922b829fc52577eb6ae25d95c940a0fef97bdbb8`.
   Reviewer signed off, with one open question (closed_at symmetry).
2. **Round 2, closed_at fix** (CLOSED, 2026-08-13) — Aravind's decision,
   fixed in commit `15da4ffa55e3965969a1962bf0cc2c034a6e5115` (this
   package's current pin).
3. **Rehearsal** (CLOSED, 2026-08-13, test-db `exfccwlrhoutkgrlikod`) —
   run AHEAD of formal sign-off on Aravind's explicit instruction, so the
   reviewer's short sign-off (next step) sees both the design decision and
   its live proof together instead of two separate rounds. Full evidence
   in "Round 2" above. `migration-027.test.ts` still does not exist — the
   permanent test file is separate follow-up work, not superseded by a
   hand-run rehearsal.
4. **Round 2 sign-off** (THIS PACKAGE, OPEN) — reviewer's short look at
   the `closed_at` change and the rehearsal evidence together (§7's
   checklist). Do NOT apply to prod until this closes.
5. **Prod apply** — a SEPARATE decision after step 4 closes, not implied
   by it. Full runbook per `docs/migration-runbook-template.md`:
   PITR observed by direct dashboard/API inspection immediately before
   (CLAUDE.md §0, never trusted from a checklist), pre-apply probe,
   `supabase db query --linked -f <file>` apply with the linked project ref
   printed fresh, post-apply column/RLS/policy/grant/FK/CHECK verification
   against the test-db reference, manual ledger `INSERT` (CLI `migration
   repair` is 28P01-blocked for this project), `docs/schema.md`'s own
   `checkin_escalations` entry written only after the ledger insert
   confirms. Explicit go-ahead from Aravind required before the apply step
   itself, per CLAUDE.md §0's `db query` conditions — same as every prod
   apply this project has done since 025.

Step 5 (prod apply) does not happen before step 4 (this sign-off) closes.

---

## 7. Sign-off checklist

Round 1 items — CLOSED (reviewer signed off; his one open question is what
"Round 2" above records the answer to — kept here, not deleted, so the
record shows what was asked and answered):
- [x] §3 RLS scoping — reviewed round 1, decision: keep `project_members`
      shape, add a role gate (not narrow, not replace)
- [x] §4 inert columns — acknowledged round 1, no objection raised
- [x] RLS role gate (finding #1) — `role IN ('pm', 'admin')`, `'qs'`
      excluded, single-lookup performance fix — SIGNED OFF
- [x] Referential actions (finding #2) — `CASCADE` on all three FKs,
      engineer_id's CASCADE-vs-RESTRICT reasoning — SIGNED OFF
- [x] Composite same-tenant FKs (finding #3) — `(col, tenant_id)` shape,
      `ON UPDATE NO ACTION` — SIGNED OFF
- [x] Lifecycle CHECK constraints (finding #4) — SIGNED OFF, with the
      follow-up question that produced Round 2's `closed_at` change
- [x] Retention register entry (finding #5) — SIGNED OFF (CLAUDE.md §10,
      not this package)

Round 2 items — OPEN, this is the short sign-off being requested now:
- [ ] `resolved_at` → `closed_at` rename + fourth CHECK constraint
      (`status <> 'not_submitted' OR closed_at IS NOT NULL`) — confirmed
      correct, or further change requested
- [ ] Rehearsal evidence ("Round 2" above) — all six RLS cases and the
      composite-FK cross-tenant rejection, raw output, reviewed
- [ ] Cleared to proceed to prod apply — a SEPARATE decision after this
      sign-off, per Aravind's explicit instruction, not implied by closing
      this checklist
