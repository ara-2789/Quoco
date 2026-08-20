# Migration 029 review package — DPR versioning (EXERCISABLE half)

**Status: WRITTEN, NOT APPLIED, NOT REHEARSED.** This package accompanies
`supabase/migrations/029_dpr_versioning.sql`, pinned at commit
`e6a06826ad17df6c27f73db5584f97896d5c0ef2` (branch `docs/dpr-delivery-versioning-plan`).
Design record: `docs/dpr-delivery-versioning-plan.md` §2c/§2d (frozen — no further plan
revisions per the external reviewer's graduation verdict, 2026-08-19).

**Sequencing (external review, split-package decision):** this is the EXERCISABLE half.
`lib/dpr/dispatch.ts` and `scripts/generate-one-dpr.ts` already exist and already write to
`dprs` for real rows — this migration can apply and be verified end-to-end now, independent
of the trigger-cron workstream. It does not wait on migration 030 (owner-email, blocked) or
on #69's own migration 031 (blocked).

---

## 1. Full SQL, pinned

```
$ git show e6a06826ad17df6c27f73db5584f97896d5c0ef2:supabase/migrations/029_dpr_versioning.sql
```
Full file at that path/SHA — reproduced here is the command, not a retyped copy, per
CLAUDE.md §0's provenance rule ("never retyped, never summarised"). The reviewer runs the
command above against this SHA for the exact bytes that would be pasted to prod.

---

## 2. §0 gate evaluation

Carried over from the migration file's own header comment (§0 GATING ASSESSMENT section,
`029_dpr_versioning.sql:19-38`) — reproduced here for the package record, not re-derived:

- **(a) trips** — `write_dpr_version` is a NEW `SECURITY DEFINER` function with real write
  authority over report content.
- **(b) trips** — writes `dprs.content`/`current_version`/etc. on an existing, live table.
- **(c) judgment call, recorded, not tripped** — `generated_by_user` derived from
  `auth.uid()` inside the RPC, never trusted from caller input.
- **(d) does not trip** in the schema sense — purely additive.
- **(e) does not trip** — no billing surface touched.

**Net: (a) and (b) trip on the new `SECURITY DEFINER` function alone — full external-review
package required, same path as 028. This document is that package.**

---

## 3. RLS audience statement

`dpr_versions_select` — `authenticated`, `tenant_id = get_user_tenant_id() AND EXISTS` a
`project_members` row for the calling user on the target DPR's project, via a join through
`dprs`. **Same audience as `dprs_select` (023) exactly** — any project member (not
role-gated to `pm` specifically, matching `dprs_select`'s own shape, not `checkin_
escalations_select`'s narrower `pm`/`admin` gate, since `dprs_select` itself isn't
role-narrowed either). No owner-readable policy — owners have `auth_id NULL`, no
`auth.uid()` session exists for `get_user_tenant_id()` to resolve regardless of channel.
`INSERT`/`UPDATE`/`DELETE` revoked from both `authenticated` and `anon` — the ONLY write
path is `write_dpr_version()`, whose own `auth.uid()`-derived check (not the GRANT) is the
real authorization boundary for a `pm`-triggered regeneration; `service_role` calls it for
the nightly `system` path and bypasses RLS/grants by construction.

---

## 4. Composite FK convention (5)

- `dpr_versions.dpr_id` → `dprs(id, tenant_id)`, `ON DELETE CASCADE` — versions have no
  meaning without their parent, same reasoning as 028's own `dpr_versions_dpr_id_fkey`
  sketch in the frozen plan document.
- `dpr_versions.generated_by_user` → `users(id, tenant_id)`, `ON DELETE RESTRICT` —
  archival; matches `dprs`' own `RESTRICT` reasoning (an author row must not silently
  vanish out from under a historical record).
- `dprs.generated_by_user` → `users(id, tenant_id)`, `ON DELETE RESTRICT` — same reasoning,
  on the "latest" projection column.
- **New parent index required and added:** `dprs` had no `UNIQUE(id, tenant_id)` before
  this migration (its own FKs to `tenants`/`projects` are plain single-column — a
  pre-existing, documented gap from 023, noted in this file's own header, NOT retrofitted
  here — out of scope for this migration, which only adds what `dpr_versions`' own FK
  needs). `dprs_id_tenant_id_key` is added scoped to that need.

---

## 5. Retention-ledger lines

Per CLAUDE.md's DATA RETENTION POSTURE taxonomy (`CLAUDE.md:934`, three-way: pure hygiene /
hygiene-with-a-caveat / compliance record):

- **`dpr_versions` — COMPLIANCE RECORD, same class as `daily_logs`/`daily_log_edits`, not
  hygiene.** Grain: one row per DPR regeneration (system or PM-triggered) — unbounded
  growth, no cap, since a report can be regenerated an unknown number of times within its
  19:45→20:30 edit window (§2a) and, per this migration, indefinitely after. This is
  deliberate: it is the append-only history of every version of a report ever delivered or
  shown to a PM — the same "business record behind every DPR ever sent" reasoning CLAUDE.md
  already applies to `daily_log_edits`. No prune mechanism proposed or needed; retention
  here is a compliance question (how long a contractor must retain progress-report
  history), never a storage one. Growth rate: bounded by regeneration frequency, not a
  fixed per-day rate like `daily_logs` — expected low relative to `daily_logs` itself
  (most DPRs are generated once and never edited), but not assumed zero.
- **`daily_log_edits.comment`** — additive column on an existing COMPLIANCE RECORD table,
  inherits that table's existing classification and retention posture unchanged. No new
  retention-ledger line needed; it is not a new table.

---

## 6. Rehearsal plan (per §0's test-db rules)

**Not run in this pass — planned, per direct instruction, with raw output to be captured
at rehearsal time, not fabricated here.** Rehearsal is its own, separately-confirmed
database-touching step (CLAUDE.md §0: application code and a database-touching rehearsal
"should never be collapsed into one uninterrupted stretch of execution" — the exact
incident this rule exists for). Plan:

1. Confirm current test-db ledger/schema state (`ls supabase/migrations/` vs.
   `supabase_migrations.schema_migrations` — known lag exists, see migration 028's own
   provenance note in this same commit; do not assume they agree).
2. Apply `029_dpr_versioning.sql` via `supabase db query --linked -f <path>` against
   test-db (never `db push`, per the standing hard rule).
3. Run the pre-/post-apply probes below.
4. Exercise `write_dpr_version()` directly against test-db with a real `dprs` row (a
   `system`-authored call, then a `pm`-authored call with a real `auth.uid()` session) —
   confirm both the `dprs` UPDATE and the `dpr_versions` INSERT land atomically, and that a
   forced mid-transaction failure (e.g., a deliberately invalid `p_generated_by_user` on
   the `pm` path) leaves NEITHER write applied, not one without the other.
5. Confirm `write_dpr_version()`'s consistency `CHECK` rejects a `system`-with-author and a
   `pm`-without-author call, both directions.

---

## 7. Pre-apply catalog probes (planned, queries written, output NOT YET captured)

```sql
-- Probe A: dprs' current column set, pre-apply (expect: no current_version/
-- generated_by/generated_by_user columns yet).
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='dprs' ORDER BY ordinal_position;

-- Probe B: dprs' current constraint set, pre-apply (expect: no
-- dprs_id_tenant_id_key, no dprs_generated_by_user_* constraints).
SELECT conname FROM pg_constraint WHERE conrelid='public.dprs'::regclass;

-- Probe C: confirm dpr_versions does not exist yet.
SELECT to_regclass('public.dpr_versions');

-- Probe D: confirm daily_log_edits has no comment column yet.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='daily_log_edits' AND column_name='comment';

-- Probe E: 023's current COMMENT ON TABLE text, pre-apply (expect: the stale
-- "(project_id, log_date)" / "silent replace" text this migration corrects).
SELECT obj_description('public.dprs'::regclass);
```

**PROCEED condition:** Probe A/B/D return no rows for the new objects; Probe C returns
`NULL`; Probe E returns the original 023 text verbatim. **STOP on anything else** — a
non-empty result on A/B/D means a prior partial apply or an unexpected schema drift that
must be understood before this file runs, not overwritten.

---

## 8. Test plan

- **`write_dpr_version` atomicity** — the forced-failure case in rehearsal step 4, above,
  is the negative control: prove the transaction cannot half-apply.
- **RLS negative control** (015 model — key on `error.code`, never message text): an
  `authenticated` client from a DIFFERENT tenant's PM attempting to `SELECT` a
  `dpr_versions` row must return zero rows (RLS-filtered), not an error — confirm via a
  real authenticated JWT client, never `service_role` (which would pass by construction).
- **Consistency CHECK negative control**: both `dprs` and `dpr_versions` reject a
  `system`+author-set row and a `pm`+no-author row at the `INSERT`/`UPDATE` level directly
  (bypassing the RPC), proving the CHECK is real defense-in-depth, not merely enforced by
  the RPC's own application-level validation.
- **`generate-one-dpr.ts` end-to-end** — since this is the exercisable half, run the real
  script against test-db post-apply and confirm it still succeeds unmodified (it does not
  call `write_dpr_version` yet — this migration adds the RPC, `dispatch.ts`'s own call site
  is a separate, application-code change not included in this migration) and that `dprs`'
  new columns default sanely (`current_version=1`, `generated_by='system'`,
  `generated_by_user=NULL`) for a plain insert that doesn't touch them.

---

## 9. Apply runbook

Per `docs/migration-runbook-template.md`'s canonical skeleton — A (PITR observation) → B
(pre-apply probe, §7 above) → C (apply, `supabase db query --linked -f`, never `db push`)
→ D (post-apply probes, mirroring §7's queries against the NEW expected state) → E (ledger
mark — `supabase migration repair --status applied 029`, the sanctioned mechanism per
CLAUDE.md's own W1 correction, NOT a manual `INSERT`; verified live-tested working on
test-db during this migration's own ledger backfill, 2026-08-20).

**Test-db: A-D run and confirmed (2026-08-20, full rehearsal, this package's own §7/Phase
0-5 record). E (ledger mark) is CONDITIONAL — pending confirmation the rehearsal's Phase 5
contention guards held with no external interference; see the session's own J-round record
for the go/no-go.**

**Prod: NOT run.** Requires its own explicit go-ahead per CLAUDE.md §0's `db query`
conditions: linked project ref pasted fresh, hash/probe comparison against an
independently re-probed reference (test-db's own post-apply state, now established), and
Aravind's go-ahead in the same exchange as the apply command.

**After prod apply:** `docs/schema.md`'s `dprs`/new `dpr_versions` entries written only
after E confirms (§0) — not written speculatively here.

## 10. Rollback path — documented, not executed (J4)

**What undoing 029 requires, concretely, in dependency order:**

```sql
BEGIN;
DROP FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID);
DROP TABLE public.dpr_versions;  -- takes its own constraints/indexes/policies with it
ALTER TABLE public.dprs DROP CONSTRAINT dprs_id_tenant_id_key;
ALTER TABLE public.dprs DROP CONSTRAINT dprs_generated_by_user_consistency_check;
ALTER TABLE public.dprs DROP CONSTRAINT dprs_generated_by_user_tenant_id_fkey;
ALTER TABLE public.dprs
  DROP COLUMN generated_by_user,
  DROP COLUMN generated_by,
  DROP COLUMN current_version;
ALTER TABLE public.daily_log_edits DROP COLUMN comment;
COMMENT ON TABLE public.dprs IS
  'One row per (project_id, log_date) — the aggregated, Claude-generated Daily '
  'Progress Report. UPSERT target for regeneration (silent replace, never a '
  'new version row per bot-flows.md). generation_status and delivery_status '
  'are ORTHOGONAL lifecycles (one tracks the compute job, one tracks the '
  'owner-send state) — do not collapse them into one column or couple their '
  'transitions. See docs/bot-flows.md DPR GENERATION section.';
  -- NOTE: reverting this comment to 023's ORIGINAL text is itself dishonest
  -- the moment engineer_id (028) has been live — the "(project_id, log_date)"
  -- key description was already stale before 029 touched it. A real rollback
  -- should leave 028's key description intact and revert ONLY 029's silent-
  -- replace/version-row language, not blindly restore this exact string.
COMMIT;
```

**Order matters and is dependency-driven, not arbitrary:** `dpr_versions` must drop before
`dprs_id_tenant_id_key` (the FK depending on that unique constraint has to be gone first —
dropping the table takes the FK with it automatically). Everything else has no ordering
constraint among itself.

**Is any of this irreversible without PITR? Yes — stated plainly, not glossed over.** The
DDL reversal above is mechanically clean and would run without error at any point. But
`DROP TABLE public.dpr_versions` and `DROP COLUMN dprs.generated_by/generated_by_user`
**permanently destroy whatever real version history has accumulated in them by the time
this runs** — every PM-triggered regeneration, every system regeneration, the entire
append-only record this migration exists to create. That data has no DOWN-script recovery
path: once `dpr_versions` is dropped, its rows are gone. **The only recovery for real
accumulated history is PITR, within whatever window is live at that moment** — the schema
reversal above is not a substitute for that, it's what you'd run only once satisfied no
history worth keeping exists, or after already restoring what you need from PITR first.

**Prod PITR — confirmed available, not presumed (F5): `pitr_enabled: true`, restore window
`2026-08-13 16:31:32 UTC → 2026-08-20 02:06:50 UTC`.** Stated plainly, per direct
instruction: **this window is SEVEN-DAY ROLLING, not fixed.** The restore point available
for undoing a prod apply of 029 ages out exactly one week after that apply runs — a
rollback decision cannot be deferred indefinitely once 029 is live on prod. If real
`dpr_versions` history needs to survive a rollback, that decision has a real, moving
deadline from the moment of apply, not an open-ended one.
