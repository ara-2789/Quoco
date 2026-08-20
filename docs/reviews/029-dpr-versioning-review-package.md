# Migration 029 review package — DPR versioning (EXERCISABLE half)

**Status: PROD APPLY HELD — external review, round 2, found THREE BLOCKING findings
(B1, B2, B3), both B1 and B2 real auth holes in `write_dpr_version`. All three are folded
into the migration file and independently re-verified against test-db (§12, below,
2026-08-20). Test-db's own live function/backfill has been upgraded to match via the
same delta. Still NOT applied to prod — that remains its own, separately-authorized step
(§9/§10), and step 4 of the reviewer's own path-to-go has not been reached.** Test-db
ledger confirmed live (2026-08-20): `supabase_migrations.schema_migrations` carries
version `029`, 25 total rows. See §9/§10 below for the original apply-runbook and
rollback-path record; commit `6c2cabf` carries the J1-J6 narrative; §12 carries the
B1/B2/B3 fix verification. This package accompanies
`supabase/migrations/029_dpr_versioning.sql`, pinned at commit
`e6a06826ad17df6c27f73db5584f97896d5c0ef2` (branch `docs/dpr-delivery-versioning-plan`).
Design record: `docs/dpr-delivery-versioning-plan.md` §2c/§2d (frozen — no further plan
revisions per the external reviewer's graduation verdict, 2026-08-19).

---

## FOR THE REVIEWER — SUBMITTED FOR GO. ONE OPEN QUESTION, YOUR CALL.

*(Unnumbered deliberately — this package already uses bare `§0` throughout, everywhere
it appears, to mean CLAUDE.md's own §0 standing rule, not a section of this document.
Giving this cover note a `§0` of its own would collide with that existing, load-bearing
convention rather than extend it — this is a preface, not numbered content, so it stays
unnumbered and is referenced by name, not by number, from elsewhere in this file.)*

**Open question (M2): B3's backfill deviates from your literal instruction.** You asked
for an extensionally-pinned backfill (hardcoded to the known row id, matching 023's
DELETE-pinned-to-`35a2f41c` precedent). §12 below implements a general `WHERE content IS
NOT NULL` predicate instead, with a hard `DO $$ ... RAISE EXCEPTION` assertion in its
place. Reasoning: 023's DELETE needed a literal pin because deletion is destructive and
irreversible without PITR; this is a pure INSERT, which cannot lose data even if it
matches more rows than expected, and a hardcoded single-id pin would be actively WORSE
under drift (a second content-bearing row appearing between writing and applying this
migration would be silently skipped by an id-pinned `WHERE` clause, defeating the
backfill's own purpose). The "known id" (`af7760e8`, exactly one row today) moved to a
documented pre-apply expectation instead of the `WHERE` clause itself. **This is not
presented as settled — it is your convention, you asked for it literally, and the
deviation is surfaced here explicitly rather than left to be noticed on read-through. If
you want the id pinned, it is a one-line change** (add `AND d.id = 'af7760e8-...'` to
both the `INSERT`'s `WHERE` and the assertion's `WHERE`) and can be made before apply.

**Submission checklist — what this package now carries, in the order requested:**
- The three fixes (B1, B2, B3), each with §12's raw output: authenticated→system refused
  `42501`, qs-as-pm refused `42501`, pm-as-pm **succeeded** (proves the fix didn't break
  the legitimate path), member `SELECT` returned rows, non-member returned zero, backfilled
  v1 read back untouched after v2 landed.
- The G2 dry-run: fresh PG17 loaded from a structure-only dump of **prod**, pre-029 state
  confirmed first, corrected file ran clean. **Worth flagging plainly: the FIRST time this
  version-parity check was ever run (CLAUDE.md §7's own dry-run rule, G2 addendum — its
  inaugural use, before this migration), it caught a REAL mismatch — the local tool was
  PG16 while prod/test-db are both PG17.6/17.11.** Not a hypothetical the rule guards
  against — an actual defect the rule's first real use found, on the very tool you're
  being asked to trust for this GO. (Recorded standing in CLAUDE.md §7's own G2 entry —
  a DIFFERENT §7 from this package's own §7 below, which is this migration's pre-apply
  catalog probes; repeated here so it's visible in this package too, not only in the file
  the rule lives in.)
- Full Vitest suite: 573 passed, 1 todo, 0 failures, 46 files — re-run AFTER the delta, not
  before.
- **M1 — the inert-on-arrival finding and its named closer: see the new subsection at the
  end of §9, below.**
- **M2 — this section.**
- **M3 — the audience argument for B2's `pm`-only gate is now the PRIMARY argument in the
  migration file's own comment (029_dpr_versioning.sql, the `pm` branch), with 019's
  precedent as corroboration, not the whole case — see §12's B2 summary below for the
  short version.**
- The 9-vs-12 test-fixture file-count discrepancy: recorded, not resolved, in
  `ci-test-isolation-options.md`.

**Not authorized, not attempted:** no prod. Step 4 (PITR reconfirmation, apply-by-file
with an explicit ledger row, post-apply catalog fingerprinting, the prod apply itself)
begins only on your GO.

**DATED UPDATE (2026-08-20, GO granted, P1–P3 landed, first apply attempt): your GO
stands — this update does not ask for another one, it reports what the first real
attempt found.** Probes A–E ran clean against real prod. Probe F did not — it could not
run at all, pre-apply, because it selected `current_version`, a column this migration
itself adds. **State this plainly, since it touches your own reasoning directly:** you
accepted the B3 deviation on the grounds that moving the known id into Probe F
"preserves everything extensionality was actually for: a human confirms the expected
extension immediately pre-apply, with STOP on mismatch." The PROBE that mechanism
depended on was itself broken by construction — authored and only ever exercised against
test-db after 029 was already live there, so a pre-apply column-existence defect stayed
invisible until run against a genuinely pre-apply target. **What actually happened:** the
broken probe still forced a stop and a human decision (mine, reported to Aravind, not
silently resolved) rather than running the (unrunnable) query and proceeding on a false
pass. A corrected, read-only diagnostic in its place found SIX content-bearing rows, not
the one originally pinned — nightly generation had produced one per night since the pin
was set. The general predicate absorbed this exactly as your acceptance of the deviation
argued it would; nothing was lost or silently skipped. Probe F is now fixed (no
post-apply column reference, checked against Probe A's own pre-apply output) and
re-pinned to all six real ids (§7, below) — never a bare count, per your own reasoning
for why the pin exists at all. **Your reasoning held. The artifact implementing it did
not. The gap is closed, not papered over — see §7 and §12's own dated notes for the full
mechanics.**

---

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
  19:45→20:30 edit window (`docs/dpr-delivery-versioning-plan.md` §2a) and, per this
  migration, indefinitely after. This is
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

**RUN, 2026-08-20 — see §9/§10 for the outcome record.** The plan below is preserved as
written (this is what was actually executed against test-db, not a retrospectively-edited
description).

**GAP CLOSED (2026-08-20, K1): §11 now carries a full, independently re-run Phase 5 —
`generate-one-dpr.ts` target-confirmed, two `write_dpr_version()` edits with the resulting
rows pasted verbatim, and the load-bearing UPDATE/DELETE refusal test — with raw output
pinned at the time it happened, not retyped afterward.** This closes the specific
provenance gap this note originally flagged (commit `6c2cabf`'s Phase 5 narration had no
pinned artifact behind it). The ORIGINAL `6c2cabf` rehearsal's own raw output remains
unpinned and unrecoverable — its fixture rows were already deleted by J6 before the gap
was noticed, so nothing from that specific run can be retroactively pinned — but §11 is a
genuine, independent re-exercise of the same RPC against the same live schema, not a
substitute narrative, and closes the open question of whether the RPC's behavior is
actually evidenced rather than merely asserted.

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

## 7. Pre-apply catalog probes (queries run 2026-08-20 — see §6's provenance note)

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

-- Probe F (added external review round 2, B3; P2 added the structured
-- check; T1/T2 FIXED, first prod apply attempt, 2026-08-20): the specific
-- known state the B3 backfill's general WHERE clause is EXPECTED to match
-- on prod today — named explicitly, not left implicit, since the backfill
-- itself is deliberately NOT hardcoded to any id (§12, B3).
--
-- T1 — THIS PROBE WAS DEFECTIVE AND COULD NOT RUN PRE-APPLY, CAUGHT LIVE
-- AGAINST REAL PROD: the original version selected `current_version`, a
-- column 029 itself adds — a pre-apply probe referencing a post-apply
-- column, impossible by construction. It was authored and only ever
-- exercised against test-db AFTER 029 was already live there, which is
-- exactly how the defect stayed invisible until run against a genuinely
-- pre-apply target. Fixed: `current_version` removed from the selection.
-- Every remaining column below is checked against Probe A's OWN prod
-- output (not test-db): id, project_id, engineer_id, log_date, content,
-- structured, generation_status, delivery_status are all present in
-- Probe A's 14-column pre-apply result. THIS PROBE RUNS AGAINST A PRE-029
-- SCHEMA, BY DEFINITION — do not add a column here that only exists after
-- this migration applies; if a future editor needs one, confirm it exists
-- in a FRESH Probe A run first, not by assumption.
--
-- T2 — RE-PINNED AT THE ACTUAL EXTENSION FOUND ON PROD (six rows, not the
-- one originally pinned when this probe was first written 2026-08-13):
-- nightly generation has produced one content-bearing row per night since,
-- absent 08-14 (see the session record's separate, unverified note on
-- that gap). This is the drift the general-predicate design was accepted
-- to absorb — not a surprise, the deviation working as designed. The
-- id LIST is pinned, not a bare count: a count alone would pass silently
-- on any six rows, and the probe exists so a human confirms WHICH rows,
-- not how many.
SELECT id, project_id, engineer_id, log_date, content IS NOT NULL AS has_content,
       structured IS NOT NULL AS has_structured, generation_status, delivery_status
FROM public.dprs WHERE content IS NOT NULL
ORDER BY log_date;
```

**PROCEED condition:** Probe A/B/D return no rows for the new objects; Probe C returns
`NULL`; Probe E returns the original 023 text verbatim; **Probe F returns EXACTLY these six
rows, no more, no fewer, matched by id:**

| id | log_date |
|---|---|
| `af7760e8-2457-4c11-bc35-52929a0bbf54` | 2026-08-13 |
| `d7435959-12ea-4655-a9d1-ac3396ec6f4b` | 2026-08-15 |
| `6076b90b-8074-42e5-834b-18090ea85284` | 2026-08-16 |
| `a53b7ec8-db1a-4bca-8a99-1f5264a7c28d` | 2026-08-17 |
| `c3c0c922-86f7-4db7-93ee-7b16b7779de6` | 2026-08-18 |
| `c363c270-251a-4b68-b20b-2816a867a7ad` | 2026-08-19 |

all with `has_structured = true`, all `project_id = acef67fe-...`, all
`engineer_id = 3534756b-...`. **STOP on anything else** — a non-empty result on A/B/D means
a prior partial apply or an unexpected schema drift that must be understood before this
file runs, not overwritten; a Probe F id-set mismatch (a row missing, an extra row, a
different id, or `has_structured = false` on any of the six) means reality has moved again
since this pin was set — re-examine and re-pin before applying, do not proceed on the
assumption this still matches. The backfill's own in-transaction assertion (§12, B3) is
STRUCTURAL — it checks that every content-bearing row has a matching version-1 history row
afterward, not a fixed count — so it is correct as written for six rows or any other
number; Probe F's job is the human-facing extensional confirmation, not the transaction's
own safety net, and the two are deliberately not the same mechanism.

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

**Test-db: A-E all run and confirmed (2026-08-20, full rehearsal, commit `6c2cabf`).**
J3's Phase 5 contention guards held with zero external interference (isolated
`REHEARSAL029-` fixtures, verified before/after), so E's condition was satisfied and the
repair ran: `supabase migration repair --status applied 029` — ledger 24 → 25 rows,
exactly one added. **Independently re-verified live, 2026-08-20 (this update):**
`supabase_migrations.schema_migrations` has a row for version `029`; total row count is
25, matching the commit's own before/after record exactly.

**Prod: NOT run.** Requires its own explicit go-ahead per CLAUDE.md §0's `db query`
conditions: linked project ref pasted fresh, hash/probe comparison against an
independently re-probed reference (test-db's own post-apply state, now established), and
Aravind's go-ahead in the same exchange as the apply command.

**After prod apply:** `docs/schema.md`'s `dprs`/new `dpr_versions` entries written only
after E confirms (§0) — not written speculatively here.

### 9a. M1 — VERSIONING IS INERT ON ARRIVAL. Stated plainly, not left implicit.

The same call-site check that made B1's guard safe to add (grepped `app/`, `lib/`,
`scripts/` — no application code calls `write_dpr_version` anywhere) has a second
consequence this package did not previously state: **after 029 applies to prod, every
NEW DPR still goes down the direct-`upsert` path in `dispatch.ts` and `generate-one-dpr.ts`.
No `dpr_versions` row gets created for it, `current_version` never advances past 1.**
This migration installs the versioning MECHANISM — it does not make anything call it.

**This is precisely B3's condition, regenerating itself for every future report.** B3's
backfill repairs the historical gap (the one row that already existed, `af7760e8`); it
does nothing to stop new rows from landing in the identical unversioned state the moment
they're first regenerated. Without a writer migration, every DPR created after this
migration applies is a future B3, waiting for its first regeneration to silently lose its
only copy — except there will be no backfill left to repair it, because nothing will flag
it as a gap the way this review did.

**This does not block the apply** — shipping schema ahead of its writer is already the
accepted shape for S2 (`daily_log_edits.comment`), and the same reasoning holds here:
`current_version`/`generated_by`/`generated_by_user` all default sanely for a row that
never goes through the RPC (`current_version=1`, `generated_by='system'`,
`generated_by_user=NULL` — confirmed in §8's test plan and exercised live in §11's Step
1), so an un-migrated writer produces a CORRECT, just un-versioned, row — not a broken
one. But it needs the same treatment S2 got, not a lesser one:

**(b) NAMED CLOSER, not "later":** the closer is **the dispatch.ts / generate-one-dpr.ts
→ write_dpr_version() wiring PR** — migrating both call sites from their current direct
`.from('dprs').upsert(...)` to calling the RPC instead. This PR does not exist yet under
any name in `docs/dpr-delivery-versioning-plan.md` (checked — §2d anticipates the
OWNER-SEND side needing "its own RPC, or at minimum a single `UPDATE ... WHERE ...
RETURNING`," but never names the GENERATOR side's own migration off direct-upsert; that
gap is what this entry closes). Tracked here, by this name, so it has a title to be
referenced by when it's opened — not a floating TODO. Given `write_dpr_version`'s B1
guard requires the `'system'` path to carry NO JWT, this PR's own scope must include
confirming the migrated call goes through `service_role` (matching how the nightly job's
existing `dprs` writes already work), not a route that could forward a session.

**(c) Consequence for 030, stated as a hard dependency, not left implicit:** 030's
owner-send design (`docs/dpr-delivery-versioning-plan.md` §2a) stamps
`delivered_to_owner_at` onto a **`dpr_versions` row** — "whichever `dpr_versions` row has
`delivered_to_owner_at` set" is how §2d itself defines "which version was delivered."
**If the generator never creates a `dpr_versions` row (the current, un-migrated state),
030's delivery path has nothing to stamp — for every DPR created after this migration
applies, not just the historical ones the backfill already covers.** This is not a
soft ordering preference; it is a hard dependency between two packages that is currently
implicit nowhere except this paragraph. **030 must not assume `dpr_versions` rows exist
for new DPRs until the writer-migration PR named above has shipped and been verified** —
if 030 lands first, its own review package needs to either (i) block on the writer PR
landing first, or (ii) design its stamp target to also work against `dprs.current_version`
directly for the interim un-migrated period, and say so explicitly rather than silently
assume a `dpr_versions` row will be there.

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

---

## 11. Phase 5 re-run, raw output pinned (K1, 2026-08-20)

**Why this section exists:** commit `6c2cabf` narrated Phase 5 (RPC exercise, version
increment, UPDATE/DELETE refusal) in its commit message only — no raw output was ever
pinned into this file, short of CLAUDE.md's own provenance rule. §6's original rows this
would have exercised were already deleted by J6's cleanup before the gap was noticed, so
nothing could be re-derived from them. **This section is a full, independent re-run**,
using fresh isolated fixtures under a new prefix (not the original `REHEARSAL029-` rows,
which no longer exist), with every command's raw output captured as it happened —
pinned here **before** cleanup, per direct instruction, so the evidence outlives the rows.

**Isolation:** fresh, randomly-generated UUIDs, provably outside `test/helpers/db.ts`'s
teardown predicate (fixed-UUID/phone-prefix exact match — see J2's finding in `6c2cabf`).
Fixtures: `tenants.id = 9181f873-5df4-4a41-8c41-f1caa951f9ef`,
`projects.id = 5208d043-a030-49dc-ab43-ec1217a9396f`,
`users.id = edb54a9e-c23e-4414-9fc7-05dfdd28f54a` (engineer, `whatsapp_number
'+19996669001'`), plus one `daily_logs` row for the same tenant/project/engineer,
`log_date = CURRENT_DATE`.

**Step 0 — target confirmed before any write:**

```
=== RESOLVED TARGET (pre-write confirmation) ===
NEXT_PUBLIC_SUPABASE_URL host: exfccwlrhoutkgrlikod
Expected test-db ref: exfccwlrhoutkgrlikod
MATCH — confirmed pointed at test-db, safe to proceed.
```

**Step 1 — `generate-one-dpr.ts` against test-db, real Claude call, full output:**

```
Running: npx tsx scripts/generate-one-dpr.ts 5208d043-a030-49dc-ab43-ec1217a9396f edb54a9e-c23e-4414-9fc7-05dfdd28f54a 2026-08-20
◇ injected env (9) from .env.local // tip: ⌘ suppress logs { quiet: true }
Assembling Facts for project 5208d043-a030-49dc-ab43-ec1217a9396f (K1 Rehearsal Project (029 Phase 5 re-run)), engineer edb54a9e-c23e-4414-9fc7-05dfdd28f54a, 2026-08-20...
Calling Claude...

=== USAGE / COST ===
Input tokens:  1148
Output tokens: 142
Latency:       7340ms
Attempts:      2
Cost (USD):    $0.005574

=== RENDERED CONTENT ===
DAILY PROGRESS — K1 Rehearsal Project (029 Phase 5 re-run) — Thu 20 Aug
Site engineer: K1 Rehearsal Engineer

Morning check-in: complete
Evening check-in: complete

Excavation of the foundation trench on grid A1-A4 was completed to formation level as planned, with all 12 planned workers on site and working, keeping the schedule on track.

Work — planned: "Excavation of foundation trench, grid A1-A4" | done: "Trench excavated to formation level, ready for PCC pour"
Manpower — planned: 12 | on site: 12, working: 12
Equipment — planned: Excavator, ₹3500/day | used: not reported
Schedule — met

NOT ASKED YET
Tomorrow's plan.

Written to dprs.
```

**Note:** the `◇ injected env (9) from .env.local` line is `dotenv`'s own load confirmation
— it always fires because `generate-one-dpr.ts` unconditionally loads `.env.local` (this
is exactly the risk `generate-one-dpr-target-safety.md`, J7c, proposes fixing). It did NOT
overwrite the pre-exported test-db env vars in this shell (`dotenv`'s `config()` does not
overwrite an already-set `process.env` key) — confirmed by the Facts-assembly line itself
naming the K1 Rehearsal Project, which exists only on test-db, not prod.

**Post-generation `dprs` row, read back:**

```json
{
  "content_len": 628,
  "current_version": 1,
  "delivery_status": "pending",
  "generated_by": "system",
  "generated_by_user": null,
  "generation_status": "idle",
  "id": "fa99fa24-c5e1-4e67-a8c2-eec8c40f190b"
}
```

`current_version = 1` — the default, untouched by `write_dpr_version()` yet, matching this
migration's own §8 test-plan note that `dispatch.ts` does not call the RPC (that wiring is
separate application-code work, not part of this migration).

**Step 2 — first edit, `write_dpr_version()` call #1 (system path), raw output:**

```json
{ "new_version_id": "44f0b0f5-de54-415d-acf1-d5c0f041d0ec" }
```

`dpr_versions` row this call wrote, read back verbatim:

```json
{
  "content": "DAILY PROGRESS -- K1 Rehearsal Project -- EDIT 1 (regenerated content, system path)",
  "dpr_id": "fa99fa24-c5e1-4e67-a8c2-eec8c40f190b",
  "generated_at": "2026-08-20 03:45:12.811835+00",
  "generated_by": "system",
  "generated_by_user": null,
  "id": "44f0b0f5-de54-415d-acf1-d5c0f041d0ec",
  "structured": { "note": "K1 rehearsal edit 1" },
  "version": 2
}
```

`dprs` projection after this call, read back verbatim:

```json
{
  "content": "DAILY PROGRESS -- K1 Rehearsal Project -- EDIT 1 (regenerated content, system path)",
  "current_version": 2,
  "generated_by": "system",
  "generated_by_user": null,
  "id": "fa99fa24-c5e1-4e67-a8c2-eec8c40f190b",
  "last_regenerated_at": "2026-08-20 03:45:12.811835+00"
}
```

Version went `1 → 2`; the `dpr_versions` insert and the `dprs` UPDATE both landed in the
same call, matching the RPC's own single-transaction design.

**Step 3 — second same-day edit, `write_dpr_version()` call #2 (system path), raw output:**

```json
{ "new_version_id": "61b721fc-aefa-4a53-887f-fc1dd5d6cf22" }
```

**Both `dpr_versions` rows, read back together, verbatim — the append-only check:**

```json
[
  {
    "content": "DAILY PROGRESS -- K1 Rehearsal Project -- EDIT 1 (regenerated content, system path)",
    "dpr_id": "fa99fa24-c5e1-4e67-a8c2-eec8c40f190b",
    "generated_at": "2026-08-20 03:45:12.811835+00",
    "generated_by": "system",
    "id": "44f0b0f5-de54-415d-acf1-d5c0f041d0ec",
    "version": 2
  },
  {
    "content": "DAILY PROGRESS -- K1 Rehearsal Project -- EDIT 2 (second same-day regeneration, system path)",
    "dpr_id": "fa99fa24-c5e1-4e67-a8c2-eec8c40f190b",
    "generated_at": "2026-08-20 03:45:31.735638+00",
    "generated_by": "system",
    "id": "61b721fc-aefa-4a53-887f-fc1dd5d6cf22",
    "version": 3
  }
]
```

Version 2's row is byte-identical to Step 2's capture — the second write did not touch it.
`dprs` projection now reads `current_version: 3`, content matching Edit 2 — the "latest"
projection tracks the newest write while every prior version stays intact underneath it.

**Step 4 — LOAD-BEARING: direct `UPDATE`/`DELETE` against `dpr_versions` as `authenticated`
(non-service-role), bypassing the RPC entirely. Both attempts, raw refusal, verbatim:**

```
=== UPDATE attempt as authenticated (non-service-role) ===
ERROR:  42501: permission denied for table dpr_versions
HINT:  Grant the required privileges to the current role with: GRANT UPDATE ON public.dpr_versions TO authenticated;

=== DELETE attempt as authenticated (non-service-role) ===
ERROR:  42501: permission denied for table dpr_versions
HINT:  Grant the required privileges to the current role with: GRANT DELETE ON public.dpr_versions TO authenticated;
```

Confirmed the UPDATE genuinely had no effect, not merely that it errored — re-read the
targeted row immediately after both refusals:

```json
{
  "content": "DAILY PROGRESS -- K1 Rehearsal Project -- EDIT 1 (regenerated content, system path)",
  "id": "44f0b0f5-de54-415d-acf1-d5c0f041d0ec"
}
```

Still the original Edit 1 text, not `TAMPERED` (the attempted UPDATE's payload) — the
REVOKE statements (`029_dpr_versioning.sql:168-170`) are real, enforced denial, not merely
declared. **Append-only holds at the database layer, independent of any application-code
discipline** — this is the claim the package needed evidence for, and now has it.

**Cleanup, run after this section was written and pinned, confirmed by read-back:**

| table | before | after |
|---|---|---|
| `dpr_versions` (this `dpr_id`) | 2 | 0 |
| `dprs` (this row) | 1 | 0 |
| `daily_logs` (this tenant) | 1 | 0 |
| `users` (this engineer) | 1 | 0 |
| `projects` (this project) | 1 | 0 |
| `tenants` (this tenant) | 1 | 0 |

`dpr_versions` was removed via `dprs`' own `ON DELETE CASCADE` (deleting the `dprs` row
cascaded both version rows automatically, not a separate manual delete). Nothing outside
this fixture set was touched — every count above is scoped to this rehearsal's own IDs,
not a table-wide count.

---

## 12. External review round 2 — B1/B2/B3 fixed, re-verified (2026-08-20)

**Findings, one line each, full argument in the migration file's own comments at the
fix site:**
- **B1 (blocking, auth hole):** `write_dpr_version` is `GRANT`ed to `authenticated`, but
  only the `pm` branch checked `auth.uid()`. Any authenticated user, any tenant, any role,
  could call with `p_generated_by='system'` and hit no check at all — a cross-tenant
  arbitrary rewrite of owner-facing report content, RLS bypassed by `SECURITY DEFINER`.
  **Fixed:** `IF p_generated_by = 'system' AND auth.uid() IS NOT NULL THEN RAISE
  EXCEPTION ... 'insufficient_privilege'`. **Verified before fixing, not assumed:**
  grepped `app/`, `lib/`, `scripts/` for any caller of `write_dpr_version` — none exists;
  `dispatch.ts` and `generate-one-dpr.ts` both still `upsert` `dprs` directly. The guard
  cannot break an existing legitimate caller because none exists yet; it is a forward
  constraint on the not-yet-written wiring (must call via `service_role`, no JWT).
- **B2 (blocking, auth hole):** the `pm` branch's same-tenant check never read `u.role` —
  any same-tenant authenticated user (a `qs` today) could author an owner-facing report
  attributed to themselves. **Fixed:** added `AND u.role = 'pm'` to the `EXISTS` check.
  **Argued on the audience test (M3, 027's discipline), not by precedent-matching alone —
  precedent is corroboration, not the case itself:** who legitimately authors an
  owner-facing report? Per CLAUDE.md §1/§5, DPR generation/delivery is explicitly PM-owned
  Spine work; no other role has DPR authorship in its stated remit — `qs` reviews
  invoices/BOQ (Phase 2, unrelated content), engineer/owner have no web login at all.
  `admin` is the interesting exclusion, argued rather than assumed obvious: `admin` is the
  MORE privileged role (tenant creation, billing, settings), but privilege level is not the
  test — JOB FUNCTION is. `admin`'s remit is tenant administration, not site-progress
  judgment; authoring a DPR means attributing operational, site-level content to a role
  whose job is not to know that. `019`'s `correct_daily_log` (`v_editor_role <> 'pm'`,
  rejecting even `admin`) reaches the identical line by applying the SAME job-function test
  to the closest existing analogue — cited as corroboration that the test itself is sound
  house practice, not as the reason this migration copies it. Full argument in the
  migration file's own comment at the fix site.
- **B3 (blocking, phantom v1):** the first-ever `write_dpr_version()` call on any row jumps
  `current_version` straight to 2 — for `af7760e8` (prod's one real content-bearing row,
  `current_version=1` with real delivered content and no `dpr_versions` row), the first
  regeneration would overwrite the only copy of that content with no history record.
  **Fixed:** a backfill `INSERT ... SELECT ... FROM dprs WHERE content IS NOT NULL AND NOT
  EXISTS (...)`, plus a hard `DO $$ ... RAISE EXCEPTION` assertion that aborts the whole
  transaction if any content-bearing row is left unbackfilled. **Shape argued, not
  defaulted:** the review asked for an extensionally-pinned (hardcoded-id) backfill,
  matching 023's DELETE-pinned-to-`35a2f41c` precedent. Deliberately NOT done that way:
  023's DELETE is destructive/irreversible without PITR, so pinning to one verified-
  worthless id was the safety mechanism there. This is a pure INSERT — cannot lose data
  even if it matches more rows than expected, and a hardcoded single-id pin would be
  actively WORSE under drift (a second content-bearing row appearing between writing and
  applying this migration would be silently skipped). Kept general; the "known id" pin
  moves to a documented pre-apply expectation (af7760e8, exactly one row, checked
  immediately before the prod apply — Probe F, §7) instead of into the WHERE clause.
  The `dpr_versions` table's own `COMMENT` was also updated to state the version-2-start
  design fact explicitly, per the review's request, rather than leaving it as something
  the next reader has to rediscover.

**S1 (should-fix, folded in with the delta):** the file never `GRANT`s `SELECT` on
`dpr_versions` — the dashboard read path rests on Supabase's default privileges surviving
the `REVOKE`s, an inherited dependency, not a stated one. The delta run below includes the
positive pair the review asked for: a member session's `SELECT` returning rows, and a
non-member session's `SELECT` returning zero — both exercised for real, not asserted.

**S2 (should-fix):** `daily_log_edits.comment` has zero writers — `correct_daily_log`'s
signature is untouched by this migration, matching the already-present-but-unpopulated
shape this plan flagged for `last_regenerated_at`. Fine to ship ahead of its writer.
**Named closer, not "later":** the edit-surface PR (§2b, the dashboard DPR-edit surface)
or the JSONB-correction design extension — whichever lands first and widens
`correct_daily_log`'s own RPC signature — is this column's closer. Tracked here so it has
an owner, not a floating TODO.

### Step 1 — full corrected file, re-run under G2 methodology (schema-dump-derived scaffold, not hand-built)

Scaffold built from a **structure-only dump of PROD** (not test-db — test-db already has
the old, unfixed 029 applied, which would make a "does this apply cleanly" test
meaningless; prod has never had 029 applied, so it is the correct pre-migration baseline).
`supabase db dump --linked --schema public --dry-run` against `jvxwqignooseazzmwhvl`,
loaded into a fresh local PostgreSQL 17.11 instance (version-matched to prod/test-db's
confirmed `17.6`/`17.11`, per G2) with the two named stubs (`auth.users`/`auth.uid()`, and
the 5 roles) and `pgvector` installed. Confirmed the scaffold genuinely reflects
pre-029 state before trusting it: `grep -c "dpr_versions\|write_dpr_version\|
current_version"` on the dump → `0`; `grep -c "engineer_id"` → `39` (028 present, as
expected — 028 is already live on prod).

Full corrected `029_dpr_versioning.sql` applied against this scaffold, raw output:

```
BEGIN
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE TABLE
ALTER TABLE
ALTER TABLE
CREATE INDEX
ALTER TABLE
CREATE POLICY
REVOKE
REVOKE
REVOKE
COMMENT
INSERT 0 0
DO
CREATE FUNCTION
REVOKE
GRANT
ALTER TABLE
COMMENT
COMMIT
```

Zero errors, clean end-to-end. `INSERT 0 0` is correct and expected — the fresh scaffold
is schema-only, no `dprs` rows exist, so the backfill correctly matches nothing; the `DO`
assertion immediately after passed (0 missing) for the same reason. This proves: no
ordering defect reintroduced by the B1/B2/B3 edits, and the file exactly as it will be
pasted to prod runs clean against a schema matching prod's real current state. Local
instance torn down immediately after (`pg_ctl stop`, directory removed) — no artifacts
left on disk.

### Step 2 — §11 DELTA on test-db, raw output for every line

Test-db already carries the OLD (unfixed) 029 — table, RLS, and function all exist from
the earlier J1-J6 rehearsal. Rather than tear down and replay the whole file (§10's
rollback path exists for that but is heavier than needed here), applied the DELTA
directly: `CREATE OR REPLACE FUNCTION write_dpr_version` (idempotent — upgrades the live
function to the B1/B2-fixed body) and the B3 backfill `INSERT`/`DO` assertion, against a
freshly seeded, isolated fixture simulating a pre-029-style content-bearing row (test-db
has no equivalent of prod's `af7760e8`, so this proves the backfill LOGIC works using
test-db's own known id — the migration's actual `af7760e8`-targeting backfill run is
necessarily a prod-apply-time event, not something reproducible here).

**Catalog readback confirming both guards are live in the deployed function (not just in
the file), before running any behavioral test:**

```json
{ "has_b1_guard": true, "has_b2_guard": true }
```

**Fixtures:** fresh tenant/project/engineer (`tenants.id =
3a6c1375-1176-4aca-b124-6d798b494c15`), one content-bearing `dprs` row seeded directly
(`id = 37eb762b-6434-4426-b590-51d0e8c712e3`, `current_version=1`, real content, no
`dpr_versions` row — the pre-029 shape). Three real Supabase Auth users created via the
admin API and signed in for real JWTs (`test/helpers/db.ts`'s own established
`ensureAuthUser`/`jwtClient`/`claimProfile` pattern, reused verbatim, not reinvented):
a `pm` who is a `project_members` row on this project, a `qs` in the same tenant (also a
member), and a second `pm` in the SAME tenant deliberately left OUT of `project_members`
(the S1 non-member case — same-tenant but not a project member, which exercises the RLS
policy's `EXISTS` join specifically, a more precise test than a cross-tenant one).

**Backfill run against the seeded row, v1 row read back verbatim:**

```json
{
  "content": "DAILY PROGRESS -- B-round pre-existing content, simulating a pre-029 row",
  "dpr_id": "37eb762b-6434-4426-b590-51d0e8c712e3",
  "generated_at": "2026-08-20 04:12:27.924425+00",
  "generated_by": "system",
  "generated_by_user": null,
  "id": "ea66a3f1-0875-4112-8c74-86d715969c8c",
  "structured": { "note": "pre-029 sim" },
  "version": 1
}
```

**Test (a) — B1: authenticated (PM session, a legitimate user in every other respect)
calls `write_dpr_version` with `p_generated_by='system'` — expect REFUSED, SQLSTATE
pinned:**

```
data: null
error: {"code":"42501","details":null,"hint":null,"message":"write_dpr_version: system-authored writes must come from service_role (no JWT) -- got an authenticated caller"}
```

**Test (b) — B2: QS session (same tenant, same project, wrong role) calls
`write_dpr_version` with `p_generated_by='pm'`, `p_generated_by_user=<own id>` — expect
REFUSED:**

```
data: null
error: {"code":"42501","details":null,"hint":null,"message":"write_dpr_version: p_generated_by_user does not match the calling PM's own tenant-scoped identity"}
```

**Test (c) — proves the fix did NOT break the legitimate path: PM session calls
`write_dpr_version` with `p_generated_by='pm'`, `p_generated_by_user=<own id>` — expect
SUCCESS:**

```
data: "f0e9dcc9-22ba-49f3-8da9-83149abb24bb"
error: null
```

**Test (d1) — S1 positive: PM (real project member) `SELECT`s `dpr_versions` for this
`dpr_id` — expect rows:**

```json
[
  {"id":"ea66a3f1-0875-4112-8c74-86d715969c8c","version":1,"generated_by":"system"},
  {"id":"f0e9dcc9-22ba-49f3-8da9-83149abb24bb","version":2,"generated_by":"pm"}
]
```
count: 2 — both the backfilled v1 and the new v2 from Test (c) are visible.

**Test (d2) — S1 negative: same-tenant `pm` who is NOT a project member `SELECT`s the
same `dpr_id` — expect ZERO rows:**

```
data: []
error: null
count: 0
```

RLS's `EXISTS` membership join is doing real work here — this user shares the tenant and
the role, and is still denied, because the join specifically requires a `project_members`
row. Confirms S1's "inherited default-privilege dependency" concern was real (nothing
`GRANT`s `SELECT` explicitly) but the POLICY itself is correctly gating access regardless
of what's supplying the underlying table privilege.

**Post-state, service-role read, both version rows together:**

```json
[
  {"id":"ea66a3f1-0875-4112-8c74-86d715969c8c","version":1,"generated_by":"system","generated_by_user":null,"content":"DAILY PROGRESS -- B-round pre-existing content, simulating a pre-029 row"},
  {"id":"f0e9dcc9-22ba-49f3-8da9-83149abb24bb","version":2,"generated_by":"pm","generated_by_user":"f278366c-97f7-4f58-b375-d773c4ec7831","content":"REAL EDIT (pm role, legitimate path, post-fix)"}
]
```

Version 1 (the backfilled row) is untouched by Test (c)'s write — append-only holds
across the fix, not just before it.

**Cleanup, confirmed by read-back — all six scoped counts, before/after:**

| item | before | after |
|---|---|---|
| `dpr_versions` (this `dpr_id`) | 2 | 0 |
| `dprs` (this row) | 1 | 0 |
| `project_members` (this project) | 2 | 0 |
| `users` (this tenant — pm, qs, nonmember-pm, engineer) | 4 | 0 |
| `projects` (this project) | 1 | 0 |
| `tenants` (this tenant) | 1 | 0 |

All three throwaway auth users (`zz-b-round-pm@quoco.test`,
`zz-b-round-qs@quoco.test`, `zz-b-round-nonmember-pm@quoco.test`) removed via
`auth.admin.deleteUser`. Nothing outside this fixture set was touched.

**dpr_versions' table COMMENT also updated on test-db** (the B3 design-fact statement,
verbatim from the migration file) so test-db's live catalog matches the corrected file,
not just its function body.

### Step 2b — full Vitest suite, re-run after the delta (not skipped)

573 passed, 1 todo, 0 failures, 46 files — same clean result as the earlier post-J6 run.
Re-run specifically to confirm the B1/B2/B3 delta (a live `CREATE OR REPLACE FUNCTION` on
test-db, plus new rows written and removed during the exercise above) left no collateral
effect on the rest of the suite.

### What did NOT happen in this pass

**Step 4 of the reviewer's own path-to-go (PITR reconfirmation, apply-by-file with an
explicit ledger row, post-apply catalog fingerprinting, prod apply itself) was NOT
attempted.** Per the reviewer's explicit "NOT AUTHORIZED: No prod. Do not proceed past
step 3 without reporting" — this section stops at the end of step 3 and reports back
rather than continuing.
