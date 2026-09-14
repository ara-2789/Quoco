# 043_daily_log_photos.sql — external review package (2026-09-13/14, round 1 fold-and-return 2026-09-14)

**Status: applied to TEST-DB ONLY (`exfccwlrhoutkgrlikod`), NOT applied to
prod.** PR #270 open (not merged). File lives in `docs/reviews/`, not
`supabase/migrations/`, per CLAUDE.md's "a migration file enters
`supabase/migrations/` when it is being applied, not when it is written"
rule — the test-db apply below does not count as "the" apply for that rule;
it is the review-and-rehearsal apply Aravind explicitly chose in place of a
Supabase-branch rehearsal.

## External review round 1 — verdict and fold-and-return (2026-09-14)

**Round 1 returned STOP** — five items plus one required test addition, all
on a table that had (and still has) zero rows. Every item below is now
FIXED, re-applied to test-db (fresh apply of the fully amended file, over a
clean teardown — see §6), and re-verified by live observation, not by
reading the file text:

| Item | What round 1 found | Fix | Verified how |
|---|---|---|---|
| 1 | Subtractive `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` left `REFERENCES`/`TRIGGER` untouched on `authenticated`/`service_role` (Supabase's default ACL grants ALL) — the §6 probe never checked those two, so it couldn't see the gap | `REVOKE ALL` first, then `GRANT` back the narrow named set (migration 031's own standard) | Live 7-privilege `has_table_privilege` probe, all three roles, §3/§6 |
| 2 | `expires_at` job-supplied, not schema-enforced — a wrong stamp was uncaught, not impossible | `expires_at` is now a `GENERATED ALWAYS AS (...) STORED` column | **The reviewer's literal SQL does not compile on real Postgres** — see §5's own new subsection for the exact error, the root cause, and the UTC-pinned fix that IS immutable, live-verified |
| 3 | `daily_log_id` FK was `ON DELETE CASCADE` — would silently delete photo rows (the only pointer to their Storage bytes) if a `daily_logs` row were ever deleted | Changed to `ON DELETE RESTRICT`; DOWN section now names what a rollback destroys, including the orphaned-bucket-object cleanup SQL cannot perform | Live probe: a `daily_logs` DELETE with a live `daily_log_photos` row now raises `foreign_key_violation`, confirmed in a rolled-back transaction — §6 |
| 4 | `tenant_id`/`daily_log_id` pairing has no composite-FK cross-check | **Argued and pinned, not enforced** (Aravind's decision) — the single-writer argument is now in the migration's own `COMMENT ON TABLE`, with its expiry condition named explicitly | Text review — §4-addendum below |
| 5 | Header still attested "NOT rehearsed... NOT reviewed" — both false | Dated addendum (2026-09-14), struck through per the 029/030/040 precedent, original text preserved | §1, the file itself |
| 6 (added) | RLS policy (SQL) and `getSignedPhotoUrl` (TS) are two independently-encoded authorization boundaries that agree only by parallel construction — one asymmetry (RLS carries an explicit `tenant_id` check, the TS function does not) was already named | New file `test/photo-access-boundary-agreement.test.ts`: one shared fixture matrix (PM on owning project, PM on another tenant's project, non-PM/qs in the correct tenant, a nonexistent daily_log), each case run through BOTH boundaries in the same `it` | §7's raw suite output |

**One deviation flagged for explicit re-confirmation, not silently
substituted**: item 2's literal proposed SQL (`received_at + CASE
retention_class WHEN 'attendance' THEN INTERVAL '7 days' ELSE INTERVAL '60
days' END`) is rejected by real Postgres — `ERROR: 42P17: generation
expression is not immutable`, because `timestamptz + interval` is STABLE,
not IMMUTABLE (confirmed via direct `pg_proc.provolatile` lookup, not just
the error text). The fix adopted (UTC-pinned via `timezone('UTC', ...)`,
confirmed immutable the same way and live-tested) is functionally
identical to the reviewer's intent but is different SQL from what was
literally specified. Full account: §5's new subsection. **This is the one
item in this round that needs the reviewer's own re-confirmation, not just
Aravind's** — everything else here is a direct implementation of what was
asked.

## Repo-state header (per this project's own standing rule)

- `main @ e92d0f4` (Merge pull request #267 from ara-2789/stage0-post-apply-paperwork) — unchanged since round 1; this fold-and-return round made no commits to `main`. PR #270 (head `1921255`) carries the pre-round-1 state; this round's fixes land in a follow-up commit on the same branch.
- `supabase/migrations/` on `main` tops out at `042_storage_bucket_setup.sql` (stage 0, applied and merged). 043 is not in that directory — it lives here, in `docs/reviews/`.
- `scripts/migration-number-reservations.json` carries a 043 entry, reserved against `main`'s own highest applied (042) at reservation time.
- Last runbook executed against a real database: THIS round's own teardown + fresh re-apply + readback, below, 2026-09-14.

---

## §1 — The migration file, in full

```sql
-- =============================================================================
-- 043_daily_log_photos.sql
-- Stage 1 of the media capability (docs/plans/media-capture-design.md item
-- 20; full plan: docs/plans/stage1-photo-intake-plan.md). Creates
-- `daily_log_photos`, per item 7's already-decided per-parent shape
-- (extends design-decisions-beta-feedback.md §6's own spec, which named
-- this table but never built it -- confirmed by grep before writing this
-- file: zero prior hits for `daily_log_photos` anywhere in
-- supabase/migrations/, lib/, or types/database.ts).
--
-- ADDENDUM (2026-09-14, external review round 1 -- STOP, fold-and-return,
-- five items plus one added test; see the review package's own "External
-- review round 1 -- verdict and fold-and-return" section). Both claims
-- struck through immediately below are now FALSE. §6 of the review package
-- shows this file applied to test-db, with a live post-apply readback
-- (structure, RLS, grants); and external review has now happened -- this
-- very file IS
-- the fold-and-return fix for that review. Struck through, not rewritten,
-- per this project's own correction discipline (migrations 029/030/040's
-- own precedent) -- the ORIGINAL environment-gap reasoning (no credentials
-- in the authoring pass) still holds as history, only the current-status
-- claim is superseded.
--
-- HELD, NOT APPLIED ANYWHERE. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, and per this pass's own explicit instruction not to apply anything
-- to production. ~~NOT rehearsed against a real database this pass -- this
-- build environment has no Supabase credentials of any kind (no .env.test
-- in this worktree, no SUPABASE_TEST_* vars in the shell). A real
-- dry-run/rehearsal against test-db, per CLAUDE.md §7's own standing
-- "every new migration gets a disposable dry-run" rule, is owed before
-- this is ever applied for real.~~
--
-- EXTERNAL REVIEW GATE: this trips CLAUDE.md §0's condition (a
-- generalization) -- a brand-new table with its own RLS policies and
-- grants from day one, per that document's own broadening clause ("a new
-- table with wrong RLS from day one... is at least as dangerous as a bad
-- change to an existing one"). Needs the full review package before it
-- applies, same as every other schema change in this project's recent
-- history (029, 031, 038, 039, ...). ~~NOT reviewed yet.~~ Still NOT
-- applied to PROD -- that half of the original posture is unchanged by
-- this addendum; only "not rehearsed" and "not reviewed" are superseded.
--
-- SHAPE: retention_class is STAMPED AT INSERT TIME by the media_ingest job
-- handler (lib/media/ingest.ts) -- stage 6's retention job scans expires_at
-- directly. expires_at itself is a GENERATED STORED column, not
-- job-supplied -- see the column definition's own comment below (external
-- review round 1, item 2) for why and what that changes. photo_url is
-- always a Supabase Storage object path (this stage's own bucket,
-- 'daily-log-photos', stage 0), NEVER a Twilio URL. No table this
-- migration creates references storage.objects by foreign key -- Storage
-- and Postgres are independent systems here, linked only by the path
-- convention stage 0 established ({tenant_id}/{daily_log_id}/{photo_id}.
-- {ext}), enforced by application code, not a database constraint.
--
-- ACCESS CONTROL, TWO INDEPENDENT LAYERS, NOT TO BE CONFUSED:
--   1. The Storage OBJECT itself (the actual image bytes) has NO Storage
--      RLS at all (Aravind's stage-0 decision) -- service_role plus
--      lib/storage/photo-access.ts's own membership check is that
--      boundary, entirely separate from this table.
--   2. This TABLE (ordinary Postgres rows: photo_url, caption, retention
--      metadata) DOES get real Postgres RLS below, per CLAUDE.md §4's
--      standing multi-tenancy rule ("every table has RLS... never rely on
--      app-layer filtering alone") -- unaffected by the storage-bucket
--      decision, which was scoped to storage.objects specifically, not to
--      this project's own public-schema tables.
--   These two boundaries are independently encoded (SQL RLS vs. a TS
--   function) and agree only by parallel construction, not by sharing a
--   predicate -- see test/photo-access-boundary-agreement.test.ts (external
--   review round 1, item 6), which runs a shared fixture matrix through
--   both and is the thing that would actually catch the two drifting apart.
-- =============================================================================

BEGIN;

-- Media completion status -- the async signal everything downstream (a
-- future PM dashboard, DPR generation) needs, per the design doc's own
-- item 4 intent ("a separate status... asynchronous... the thing
-- everything downstream needs to check"). Two independent columns, not
-- one, because morning and evening are independent completion events on
-- the same daily_logs row (item 7's shared-row precedent) -- evening's
-- photos finishing has nothing to do with morning's. NULL means "no
-- photos sent this phase" (the common case); 'pending' is set the moment
-- the first media_ingest job is enqueued for that phase; 'complete'/
-- 'failed' are set by the job handler (or its dead-letter path) once it
-- resolves. TEXT + CHECK, never an ENUM, per CLAUDE.md §6.
ALTER TABLE public.daily_logs
  ADD COLUMN morning_photos_status TEXT CHECK (morning_photos_status IN ('pending', 'complete', 'failed')),
  ADD COLUMN evening_photos_status TEXT CHECK (evening_photos_status IN ('pending', 'complete', 'failed'));

CREATE TABLE public.daily_log_photos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  DEFAULT now(),
  tenant_id       UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT, not CASCADE (external review round 1, item 3).
  -- Cascading a daily_log delete would silently delete every photo row
  -- pointing at it -- the ONLY retention record and the ONLY pointer this
  -- database holds to that photo's actual bytes in the daily-log-photos
  -- bucket. A cascade would leave those bucket objects orphaned with no
  -- retention scan (stage 6) ever able to reach them again, which directly
  -- contradicts this table's own tombstone-never-delete philosophy (item
  -- 9: photo_url set NULL, row retained -- never a hard delete of the row
  -- itself, so certainly never an implicit one via a PARENT's delete).
  -- Nothing in this codebase deletes a daily_logs row today, so this is a
  -- free safety margin now, not a behavior change to anything live.
  daily_log_id    UUID         NOT NULL REFERENCES public.daily_logs(id) ON DELETE RESTRICT,
  phase           TEXT         NOT NULL CHECK (phase IN ('morning', 'evening')),
  photo_url       TEXT,        -- Supabase Storage object path. NULL once tombstoned (item 9, stage 6).
  caption         TEXT,        -- item 12: the answer-parser's raw Body, if any accompanied the photo.
  retention_class TEXT         NOT NULL CHECK (retention_class IN ('attendance', 'evening_progress')),
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- GENERATED STORED, not job-supplied (external review round 1, item 2).
  -- Before this, lib/media/ingest.ts computed expires_at in TypeScript and
  -- wrote it directly -- a wrong stamp (a future edit to RETENTION_DAYS/
  -- RETENTION_CLASS going out of sync, a copy-paste bug in a later job) was
  -- merely UNCAUGHT, not impossible. Computing it here, from received_at
  -- and retention_class, makes a wrong stamp IMPOSSIBLE: Postgres refuses
  -- any INSERT/UPDATE that tries to supply expires_at directly (a hard
  -- error, not a silent overwrite), and the two durations (7d/60d) now live
  -- in exactly ONE place -- this expression -- instead of in ingest.ts plus
  -- a comment asking a future editor to keep the two in sync by hand.
  --
  -- NOT THE REVIEWER'S LITERAL SQL -- A REAL POSTGRES CONSTRAINT FORCED A
  -- REWRITE, FLAGGED HERE RATHER THAN SILENTLY SUBSTITUTED. The item-2
  -- proposal as written (`received_at + CASE retention_class WHEN
  -- 'attendance' THEN INTERVAL '7 days' ELSE INTERVAL '60 days' END`) was
  -- tried against real Postgres 17.6 on test-db and REJECTED: `ERROR:
  -- 42P17: generation expression is not immutable`. Confirmed by direct
  -- `pg_proc.provolatile` lookup, not just the error text: `timestamptz +
  -- interval` (timestamptz_pl_interval) is STABLE ('s'), not IMMUTABLE
  -- ('i') -- adding a days-unit interval to a timestamptz is timezone-
  -- sensitive in general (DST-correct calendar arithmetic), so Postgres
  -- refuses it in a STORED generated column's expression regardless of
  -- what the runtime interval value actually contains. `extract(epoch FROM
  -- timestamptz)` is ALSO merely STABLE, so an epoch-arithmetic rewrite
  -- fails identically. THE FIX BELOW pins the timezone explicitly rather
  -- than deferring to the session's: `timezone('UTC', received_at)`
  -- (timestamptz -> timestamp) and `timezone('UTC', <timestamp>)`
  -- (timestamp -> timestamptz) are BOTH confirmed IMMUTABLE
  -- (`pg_proc.provolatile = 'i'` for both signatures, checked directly),
  -- because naming the zone explicitly removes the session-TimeZone
  -- dependence that makes the bare operator STABLE; plain `timestamp +
  -- interval` (no zone at all) is IMMUTABLE too (`timestamp_pl_interval`,
  -- confirmed the same way). Live-verified end to end against a disposable
  -- TEMP TABLE on test-db before this file was re-applied: both retention
  -- classes produced exactly 7.0 and 60.0 elapsed days. Functionally
  -- identical to the reviewer's intent (received_at + a fixed 7d/60d
  -- interval, computed once, immutable, keyed on retention_class) --
  -- different SQL because the literal form does not compile on this
  -- project's own Postgres version. Reviewer/Aravind should re-confirm
  -- this substitution in the next round rather than treating it as
  -- pre-approved by the original item-2 text.
  --
  -- CONSEQUENCE FOR A FUTURE RETENTION-WINDOW CHANGE, recorded here because
  -- it inverts this table's original design intent: changing either
  -- duration below is a migration to THIS EXPRESSION (Postgres has no
  -- in-place edit of a generated column's formula -- it's a DROP/re-ADD,
  -- which rewrites the table). Because expires_at is COMPUTED, not
  -- stamped-once, such a migration recomputes it for EVERY EXISTING ROW as
  -- well as every future one -- the OPPOSITE of the forward-only guarantee
  -- item 15 originally specified ("rows already stamped under the old
  -- window must keep their original expiry"; review package §5). A future
  -- author widening or narrowing the retention window must explicitly
  -- re-decide whether that forward-only guarantee still matters -- it is
  -- no longer preserved by construction the way a plain stamped-at-insert
  -- column was.
  expires_at      TIMESTAMPTZ  GENERATED ALWAYS AS (
                    timezone('UTC',
                      timezone('UTC', received_at) + CASE retention_class
                        WHEN 'attendance' THEN INTERVAL '7 days'
                        ELSE INTERVAL '60 days'
                      END
                    )
                  ) STORED
);

-- phase <-> retention_class must agree -- morning is always attendance (7d),
-- evening is always evening_progress (60d). A CHECK, not left to application
-- code alone to keep consistent, per this project's general "the database
-- enforces its own invariants" posture.
ALTER TABLE public.daily_log_photos
  ADD CONSTRAINT daily_log_photos_phase_retention_check
  CHECK (
    (phase = 'morning' AND retention_class = 'attendance') OR
    (phase = 'evening' AND retention_class = 'evening_progress')
  );

CREATE INDEX idx_daily_log_photos_daily_log_id ON public.daily_log_photos(daily_log_id);
CREATE INDEX idx_daily_log_photos_tenant_id    ON public.daily_log_photos(tenant_id);
-- Stage 6's own retention scan needs this -- a scan for "past expiry" without
-- an index on the scanned column is exactly the kind of thing that's cheap to
-- add now and expensive to discover missing once the table has real rows.
CREATE INDEX idx_daily_log_photos_expires_at   ON public.daily_log_photos(expires_at);

COMMENT ON TABLE public.daily_log_photos IS
  'Photos captured during an active morning or evening check-in (item 7''s '
  'per-parent shape; the second per-parent class, hindrance_photos, lands in a '
  'later migration for stage 2). Written ONLY by the media_ingest job handler '
  '(lib/media/ingest.ts), via service_role -- no end-user client ever inserts '
  'directly. retention_class is stamped at INSERT time by that job; '
  'expires_at is a GENERATED STORED column (received_at + 7d/60d keyed on '
  'retention_class, via an explicit UTC pin -- see the column''s own '
  'comment for why: timestamptz + interval is only STABLE in Postgres, not '
  'IMMUTABLE, so a bare form of this expression is rejected), never '
  'supplied by the job -- a wrong stamp is now impossible, not merely '
  'uncaught (external review round 1, item 2). '
  'Tombstoned (photo_url set NULL), never hard-deleted, once expires_at '
  'passes (item 9). '
  'PINNED ARGUMENT, tenant_id/daily_log_id pairing (external review round 1, '
  'item 4, Aravind''s decision, argued rather than enforced by a composite '
  'FK): this table has exactly ONE writer -- lib/media/ingest.ts, via '
  'service_role -- and that writer derives tenant_id and daily_log_id '
  'TOGETHER from the same resolution (resolveOrCreateDailyLogId), so a row '
  'pairing a tenant with a daily_log that does not belong to it is not '
  'reachable BY CONSTRUCTION, not merely unlikely. A composite FK against '
  'daily_logs(id, tenant_id) would require a new UNIQUE(id, tenant_id) on '
  'daily_logs itself -- a live production table -- for a mismatch this '
  'single writer cannot produce. THIS ARGUMENT EXPIRES the moment a SECOND '
  'writer to this table is ever added: at that point the composite FK '
  'becomes REQUIRED, not optional, because the closed-writer-set premise '
  'this argument rests on no longer holds. A future editor adding a second '
  'writer without also adding that FK is violating this table''s own '
  'documented safety argument, not merely skipping a nice-to-have.';

-- -----------------------------------------------------------------------------
-- RLS. SELECT only, PM-scoped to the project the photo''s daily_log belongs
-- to -- same shape as daily_log_edits'' own policy (019_daily_log_corrections.sql),
-- adapted: that table joins through project_id directly; this one joins
-- through daily_log_id -> daily_logs.project_id first, since this table has
-- no denormalized project_id column of its own.
-- -----------------------------------------------------------------------------
ALTER TABLE public.daily_log_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_log_photos_select" ON public.daily_log_photos
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.daily_logs dl
      JOIN public.project_members pm ON pm.project_id = dl.project_id
      WHERE dl.id = daily_log_photos.daily_log_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND pm.role = 'pm'
    )
  );

-- -----------------------------------------------------------------------------
-- GRANTS (external review round 1, item 1). REVOKE ALL first, then GRANT
-- back exactly what each role needs -- NOT the original subtractive form
-- (REVOKE INSERT, UPDATE, DELETE, TRUNCATE), which named only four of the
-- six non-SELECT/USAGE privileges a table actually carries under Supabase's
-- default ACL (which grants ALL to authenticated/anon/service_role on every
-- new public-schema table). REFERENCES and TRIGGER were never named by that
-- form, so they were never revoked -- left live on both authenticated and
-- service_role. The §6 post-apply probe only checked SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE, so it could not see the two missing privileges either;
-- this was caught only by the external reviewer naming them explicitly.
-- Standard adopted from migration 031's own round: REVOKE ALL so nothing is
-- left to leak by omission, then GRANT back the narrow, named set.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.daily_log_photos FROM authenticated, anon, service_role;

-- authenticated: read-only via the daily_log_photos_select policy above,
-- nothing else -- no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
GRANT SELECT ON public.daily_log_photos TO authenticated;

-- anon: no grant at all. REVOKE ALL above already removed everything
-- Supabase's default ACL had granted; no GRANT statement follows for anon,
-- deliberately -- matches the standing pattern for every tenant-scoped
-- table in this schema.

-- service_role: SELECT (the ingest job reads back what it wrote in some
-- paths), INSERT (the ingest job's own write), UPDATE (stage 6's tombstone
-- -- photo_url set NULL, row retained). Deliberately NOT DELETE, TRUNCATE,
-- REFERENCES, or TRIGGER -- this table is tombstoned, never hard-deleted
-- (item 9), so any of those four left live would be the EXACT gap already
-- found twice on this project (dpr_versions, migration 031 round 1) --
-- named explicitly by CLAUDE.md's own standing rule ("a table-level revoke
-- must name service_role explicitly"). Closed here from day one via the
-- REVOKE ALL / GRANT-back pattern, which cannot leak a privilege by
-- omission the way a subtractive REVOKE naming only some of them can.
GRANT SELECT, INSERT, UPDATE ON public.daily_log_photos TO service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- WHAT THIS DESTROYS, NAMED EXPLICITLY (external review round 1, item 3).
-- Every daily_log_photos row -- the ONLY retention record and the ONLY
-- pointer this database holds to each photo's actual bytes in the
-- daily-log-photos bucket -- plus both daily_logs status columns
-- (morning_photos_status, evening_photos_status). SQL alone cannot reach
-- the Storage side of this: once this DOWN runs for real, every Storage
-- object this table's rows pointed to (via photo_url) becomes ORPHANED --
-- bytes still present in the bucket, with no database row left to name
-- them, and no retention scan (stage 6) able to find or reap them either,
-- since that scan itself depends on this table existing.
-- PROCEDURAL CLEANUP NOTE, since no SQL statement can do this: before
-- running this DOWN for real, SELECT photo_url for every non-null row
-- first and keep that list -- it is the only record of which Storage
-- objects are about to be orphaned. Deleting those objects afterward (via
-- the Storage API, using PHOTO_BUCKET from lib/storage/photo-access.ts) is
-- then a separate, manual step this migration cannot perform for you.
--
-- BEGIN;
--
-- DROP TABLE public.daily_log_photos;
-- ALTER TABLE public.daily_logs DROP COLUMN morning_photos_status;
-- ALTER TABLE public.daily_logs DROP COLUMN evening_photos_status;
--
-- COMMIT;
```

---

## §2 — The RLS policy, explained, and why this table gets RLS while the storage bucket deliberately doesn't

**Two independent boundaries — do not conflate them, this is the single
most important thing for a reviewer to hold onto:**

1. **The photo BYTES live in Supabase Storage** (`daily-log-photos` bucket,
   stage 0). Aravind's stage-0 decision was **no Storage RLS at all** —
   access control there is entirely `service_role` plus an application-code
   membership check (`lib/storage/photo-access.ts`'s `getSignedPhotoUrl()`).
   That decision was scoped to `storage.objects` specifically.
2. **This migration's TABLE holds ordinary Postgres ROWS** — `photo_url`
   (a path string, not bytes), `caption`, retention metadata. This is a
   completely different object class from `storage.objects`, and
   CLAUDE.md §4's standing multi-tenancy rule ("every table has RLS...
   never rely on app-layer filtering alone") applies to it exactly like
   every other table in this schema. Nothing about stage 0's storage
   decision exempts this table — a reviewer who reasons "photos have no
   RLS, so this table shouldn't either" would be conflating the two
   boundaries.

**The policy itself** (`daily_log_photos_select`, `FOR SELECT TO
authenticated`) grants read access only when:
- `tenant_id = get_user_tenant_id()` (the standing tenant-isolation
  predicate every RLS policy in this schema uses), **AND**
- the caller is a `pm`-role member of the specific project the photo's
  `daily_log` belongs to (joined `daily_log_photos.daily_log_id ->
  daily_logs.project_id -> project_members`).

This is `SELECT`-only, deliberately — no `authenticated` client ever
inserts, updates, or deletes a row here. Every write is `service_role`
(the job handler), never a PostgREST call from a logged-in PM's session.
The shape mirrors `daily_log_edits`' own policy
(`019_daily_log_corrections.sql`) adapted for one structural difference:
`daily_log_edits` has its own `project_id` column and joins directly;
`daily_log_photos` has no denormalized `project_id` of its own, so the
join goes through `daily_log_id -> daily_logs.project_id` first.

---

## §3 — Grants and revokes, and what each prevents

**REWRITTEN, external review round 1, item 1.** The ORIGINAL form
(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ...` / `REVOKE DELETE, TRUNCATE
... FROM service_role`) named only four of the six non-SELECT/USAGE
privileges a table actually carries under Supabase's default ACL —
`REFERENCES` and `TRIGGER` were never named, so they were never revoked,
left live on both `authenticated` and `service_role`. The round-1 §6 probe
(the version that existed at the time) only checked SELECT/INSERT/UPDATE/
DELETE/TRUNCATE, so it could not see the gap either — caught only by the
external reviewer naming the two missing privileges explicitly. Fixed by
adopting migration 031's own standard: `REVOKE ALL` first, so nothing is
left to leak by omission, then `GRANT` back exactly the narrow, named set
each role needs.

| Role | Grant/Revoke | What it prevents / allows |
|---|---|---|
| `anon` | `REVOKE ALL`, no `GRANT` follows | No access at all, on any of the seven privileges checked below — matches the standing pattern for every tenant-scoped table in this schema. |
| `authenticated` | `REVOKE ALL`, then `GRANT SELECT` | Read-only via the `daily_log_photos_select` RLS policy above, and NOTHING else — INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER all denied. The two privileges round 1 caught missing (REFERENCES, TRIGGER) are now closed, alongside the four the original form did cover. |
| `service_role` | `REVOKE ALL`, then `GRANT SELECT, INSERT, UPDATE` | SELECT (the ingest job reads back what it wrote in some paths), INSERT (the ingest job's own write), UPDATE (stage 6's tombstone — `photo_url` set NULL, row retained). Deliberately NOT DELETE, TRUNCATE, REFERENCES, or TRIGGER — this table is tombstoned, never hard-deleted (item 9), so any of those four left live would be the EXACT gap already found twice on this project (`dpr_versions`, migration 031 round 1), per CLAUDE.md's own standing rule ("a table-level revoke must name `service_role` explicitly... a table whose design claims to be append-only or a durable record must have that claim enforced by grants"). The `REVOKE ALL` / `GRANT`-back pattern cannot leak a privilege by omission the way the original subtractive form did. |

**Post-apply verification, live (not asserted from the migration text) —
see §6 below for the exact fresh-apply methodology and raw output**: a
FULL SEVEN-PRIVILEGE probe (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER), all three roles, run against test-db after tearing
down the pre-round-1 table and re-applying this fully amended file fresh:

```
anon:          SELECT=false  INSERT=false  UPDATE=false  DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
authenticated: SELECT=true   INSERT=false  UPDATE=false  DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
service_role:  SELECT=true   INSERT=true   UPDATE=true   DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
```

Matches the design exactly, including the two privileges (REFERENCES,
TRIGGER) the round-1 probe never checked — both `false` for every role now
confirmed live, not just asserted from the `REVOKE ALL`/`GRANT` text.

---

## §4 — The `phase`/`retention_class` CHECK, and why it exists

Two separate CHECKs, one composite:
- `daily_log_photos_phase_check`: `phase IN ('morning', 'evening')`.
- `daily_log_photos_retention_class_check`: `retention_class IN
  ('attendance', 'evening_progress')`.
- `daily_log_photos_phase_retention_check` (the composite one): `(phase =
  'morning' AND retention_class = 'attendance') OR (phase = 'evening' AND
  retention_class = 'evening_progress')`.

**Why the composite CHECK, not just the two independent ones**: `phase`
and `retention_class` are NOT independent facts — a morning photo is
*always* attendance-class (7-day retention), an evening photo is *always*
evening-progress-class (60-day retention), by design (item 11/15). Without
the composite CHECK, the two independent CHECKs alone would still permit a
nonsensical row — `phase='morning'` paired with
`retention_class='evening_progress'` — that no application code path is
supposed to ever produce, but that a bug in `lib/media/ingest.ts`
(`RETENTION_CLASS` map, hand-maintained, one entry per phase) could
silently write if that map were ever edited incorrectly. The composite
CHECK converts that class of bug from a silent data-integrity error into a
hard `23514` at insert time — the database enforcing its own invariant
rather than trusting the TypeScript map to stay correct forever, matching
this project's general posture (CLAUDE.md §6's own examples: `attendance`
= 7-day, `evening_progress` = 60-day, tied to `phase` structurally, not by
convention).

---

## Pinned argument — tenant_id/daily_log_id pairing, no composite FK (external review round 1, item 4)

**Round 1's finding**: `tenant_id` and `daily_log_id` are not cross-
validated against each other — nothing stops a row from pairing a
`tenant_id` with a `daily_log_id` that actually belongs to a DIFFERENT
tenant's `daily_logs` row, short of a composite foreign key against
`daily_logs(id, tenant_id)`.

**Aravind's decision: argue and pin, do NOT add the composite FK.** A
composite FK would require a new `UNIQUE(id, tenant_id)` constraint on
`daily_logs` itself — a live production table — to enforce a mismatch this
table's own writer cannot actually produce. The argument, now written into
the migration's own `COMMENT ON TABLE` (§1 above, not just here, so it
travels with the schema object itself, not only this document):

- `daily_log_photos` has **exactly ONE writer**: `lib/media/ingest.ts`'s
  `handleMediaIngestJob`, running as `service_role` — no end-user client
  ever inserts into this table directly (enforced by §3's grants: neither
  `authenticated` nor `anon` holds INSERT).
- That single writer derives `tenant_id` and `daily_log_id` **together**,
  from the same resolution (`resolveOrCreateDailyLogId` /
  `resolveDailyLogId`) — there is no code path in this writer that could
  independently source one from a different record than the other.
- A mismatched pair is therefore **not reachable by construction**, not
  merely unlikely or untested — there is no line of code in the one
  writer that could produce one.

**The expiry condition, stated explicitly so a future editor cannot miss
it**: this argument holds only as long as the writer set stays closed at
one. **The moment a second writer is added to this table — for any
reason — the composite FK becomes REQUIRED, not optional**, because the
single-writer premise the argument rests on no longer holds. A future
editor who adds a second writer without also adding
`UNIQUE(id, tenant_id)` on `daily_logs` plus the composite FK here is
violating this table's own documented safety argument, not merely
skipping a nice-to-have — the `COMMENT ON TABLE` text says this in exactly
those terms.

---

## §5 — `expires_at`: from job-stamped to a GENERATED STORED column (external review round 1, item 2) — and the real Postgres constraint that changed its shape

**BEFORE round 1**: `expires_at` was computed in TypeScript and written
directly by `lib/media/ingest.ts`'s `handleMediaIngestJob`:
```ts
const retentionDays = RETENTION_DAYS[payload.phase]       // 7 (morning) or 60 (evening)
const retentionClass = RETENTION_CLASS[payload.phase]     // 'attendance' or 'evening_progress'
const receivedAt = new Date()
const expiresAt = new Date(receivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000)
```
A wrong stamp (a future edit to `RETENTION_DAYS`/`RETENTION_CLASS` going
out of sync, a copy-paste bug in a later job) was merely **uncaught**, not
impossible — round 1's finding.

**AFTER round 1: `expires_at` is a `GENERATED ALWAYS AS (...) STORED`
column.** `handleMediaIngestJob` no longer computes or supplies it at all
(`lib/media/ingest.ts`'s insert call omits the field entirely; `RETENTION_
DAYS` survives only as the expected reference `test/media-ingest.test.ts`
checks the database's own computed value against). Postgres now refuses
any INSERT/UPDATE that tries to set `expires_at` directly — **confirmed
live**, not just documented: a rolled-back transaction against test-db
attempted exactly that insert and Postgres rejected it (§6 below has the
full probe).

**THE REVIEWER'S LITERAL SQL DOES NOT COMPILE — found by actually running
it, not by inspection, exactly the class of defect CLAUDE.md's own
"disposable dry-run" rule (§7) exists to catch.** Item 2 proposed:
```sql
expires_at TIMESTAMPTZ GENERATED ALWAYS AS (
  received_at + CASE retention_class
    WHEN 'attendance' THEN INTERVAL '7 days'
    ELSE INTERVAL '60 days' END
) STORED
```
Tried against real Postgres 17.6 on test-db (via a disposable `TEMP TABLE`
probe first, then confirmed again on the real apply attempt): both
attempts were rejected with the identical error —
```
ERROR:  42P17: generation expression is not immutable
```
**Root cause, confirmed by direct `pg_proc.provolatile` lookup, not
inferred from the error text alone**:
```
timestamptz_pl_interval (timestamptz + interval):        provolatile = 's'  (STABLE)
date_part / extract(epoch FROM timestamptz):              provolatile = 's'  (STABLE)
```
Adding a days-unit interval to a `timestamptz` is timezone-sensitive in
Postgres's own categorization (DST-correct calendar arithmetic depends on
the session's `TimeZone` setting) — so the operator is marked STABLE, not
IMMUTABLE, and Postgres refuses it inside a STORED generated column's
expression **regardless of what the runtime interval value actually
contains**. An epoch-arithmetic rewrite (`extract(epoch FROM ...)` +
`to_timestamp(...)`) was tried next and fails for the identical reason —
`extract(epoch FROM timestamptz)` is ALSO merely STABLE.

**THE FIX: pin the timezone explicitly rather than deferring to the
session's.** Confirmed immutable the same way, by direct `pg_proc`
lookup, before it was adopted:
```
timezone(text, timestamp with time zone)      -- ts -> naive, e.g. 'UTC'   provolatile = 'i'  (IMMUTABLE)
timezone(text, timestamp without time zone)   -- naive -> ts, e.g. 'UTC'   provolatile = 'i'  (IMMUTABLE)
timestamp_pl_interval (plain timestamp + interval, no zone)                provolatile = 'i'  (IMMUTABLE)
```
Naming the zone explicitly removes the session-`TimeZone` dependence that
makes the bare operator STABLE. The adopted expression:
```sql
expires_at TIMESTAMPTZ GENERATED ALWAYS AS (
  timezone('UTC',
    timezone('UTC', received_at) + CASE retention_class
      WHEN 'attendance' THEN INTERVAL '7 days'
      ELSE INTERVAL '60 days'
    END
  )
) STORED
```
**Live-verified end to end** against a disposable `TEMP TABLE` on test-db
before the real file was re-applied: inserting one `attendance` row and
one `evening_progress` row produced `expires_at` values exactly 7.0 and
60.0 elapsed days after `received_at` (raw output, §6 below). Then
re-verified again after the real re-apply, both via `information_schema.
columns.generation_expression` (§6) and via the FK/generated-column guard
probe (§6).

**This is functionally identical to the reviewer's intent** — `received_
at` plus a fixed 7d/60d interval, computed once, immutable, keyed on
`retention_class` — **but it is different SQL from what was literally
specified**, because the literal form does not compile on this project's
real Postgres version (17.6, confirmed live, matching CLAUDE.md §7's own
pinned version note). **This is the one item in this round that needs the
reviewer's own re-confirmation**, not just Aravind's sign-off — everything
else in this round is a direct implementation of what was asked, with no
technical obstacle forcing a substitution.

**Why this matters for stage 6 (the still-unbuilt retention/deletion
job)**: that job's entire design (item 15's own "may extend later" note)
depends on scanning `expires_at` directly — `WHERE expires_at < now()` —
rather than recomputing `received_at + retention_window_for(phase)` at
scan time. The `idx_daily_log_photos_expires_at` index exists specifically
to make that scan cheap once real rows exist; this is unaffected by
whether `expires_at` is job-stamped or DB-generated.

**CONSEQUENCE FOR A FUTURE RETENTION-WINDOW CHANGE — this is where the
generated-column design INVERTS the original stamped-at-insert intent, and
it is now recorded in three places (this section, the migration's own
column comment, and here) so it can't be missed**: item 15 originally
specified a **forward-only** guarantee — "rows already stamped under the
old window must keep their original expiry" if the retention window is
ever widened or narrowed later. That guarantee held automatically under
the old job-stamped design (a plain column, set once, never touched
again). It does **NOT** hold automatically under the generated-column
design: Postgres has no in-place edit of a generated column's formula — a
future change to either duration is a migration that DROPs and re-ADDs the
expression, which **rewrites the table and recomputes `expires_at` for
EVERY EXISTING ROW**, not just future ones. A future author widening or
narrowing the retention window must explicitly re-decide whether the
forward-only guarantee still matters for this table, and build it back in
deliberately (e.g., freezing old rows' `expires_at` into a plain column
before changing the expression) if it does — it is no longer preserved by
construction.

**Not built or tested in this pass**: stage 6 itself (the actual deletion/
tombstone job) does not exist yet — this migration only lays the
structural groundwork (the column, the index, the generated-value
discipline) it will depend on.

---

## §6 — Test-db apply evidence, pinned (ROUND 1: original apply; ROUND 2, 2026-09-14: teardown + fresh re-apply of the fold-and-return fixes)

### Round 1 (2026-09-13/14) — superseded by round 2 below, kept for provenance

**Pre-apply probe** (confirms the table and columns do NOT already exist,
run against `exfccwlrhoutkgrlikod` via `supabase db query --linked -f`):

```
$ SELECT current_database() AS db, now() AS at;
{"db": "postgres", "at": "2026-09-13 18:23:17.825139+00"}

$ SELECT to_regclass('public.daily_log_photos') AS daily_log_photos_exists;
{"daily_log_photos_exists": null}

$ SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='daily_logs'
    AND column_name IN ('morning_photos_status','evening_photos_status');
[]  -- zero rows: neither column exists yet
```

Apply, structure/RLS/policy readback, and a grant probe that checked only
five of the seven relevant privileges all happened in round 1 — this is
exactly the gap external review round 1's item 1 found (§3 above). That
readback is superseded by round 2's full seven-privilege probe below, not
repeated here.

### Round 2 (2026-09-14) — the fold-and-return re-apply, methodology stated explicitly

**How the fold-and-return changes reached test-db: a full teardown, then a
fresh apply of the entire amended file — not a follow-up ALTER
statement.** Three of the six items (1, 2, 3) change the table's actual
shape (grants, a column's generation mechanism, an FK action) in ways that
don't cleanly layer as incremental ALTERs on top of the round-1 objects
(a `GENERATED` column in particular cannot be added by altering an
existing plain column — Postgres has no such ALTER form). Since the table
was, and still is, confirmed zero-row (checked immediately before tearing
down, below), a clean teardown-then-fresh-apply was the lower-risk path
over trying to reconcile in place.

**Step 1 — confirm zero rows before touching anything:**
```
$ SELECT count(*) AS row_count FROM public.daily_log_photos;
{"row_count": 0}
```

**Step 2 — teardown**, running the migration's own DOWN block (pre-item-3
version, before the RESTRICT change existed — at teardown time the FK was
still CASCADE from round 1, so the plain `DROP TABLE` / `DROP COLUMN`
sequence applied cleanly with no FK obstruction of its own):
```sql
BEGIN;
DROP TABLE public.daily_log_photos;
ALTER TABLE public.daily_logs DROP COLUMN morning_photos_status;
ALTER TABLE public.daily_logs DROP COLUMN evening_photos_status;
COMMIT;
```
Applied with no error. Confirmed by observation immediately after, not
assumed from the command's exit status:
```
$ SELECT to_regclass('public.daily_log_photos') AS daily_log_photos_exists;
{"daily_log_photos_exists": null}

$ SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='daily_logs'
    AND column_name IN ('morning_photos_status','evening_photos_status');
[]  -- zero rows: both columns gone
```

**Step 3 — fresh apply of the fully amended file.** First attempt (the
reviewer's literal item-2 SQL) was REJECTED — this is the immutability
finding §5 covers in full:
```
$ supabase db query --linked -f docs/reviews/043_daily_log_photos.sql
ERROR:  42P17: generation expression is not immutable
```
Confirmed the whole file's transaction rolled back cleanly (table still
absent) before diagnosing further — no partial state:
```
{"daily_log_photos_exists": null}
```
Root-caused via direct `pg_proc.provolatile` lookups (full detail, §5) and
the file was corrected to the UTC-pinned expression. Re-applied:
```
$ supabase db query --linked -f docs/reviews/043_daily_log_photos.sql
{}   -- no error, zero rows (DDL/DML transaction)
```

**Step 4 — full post-apply readback, live, by name.**

Table exists:
```
{"daily_log_photos_exists": "daily_log_photos"}
```

Columns, including the generated column's own `information_schema`
metadata (note `is_generated`/`generation_expression` on `expires_at` —
this is what proves it is a real generated column, not just a plain one
that happens to be computed correctly once):
```
id              uuid         NOT NULL  is_generated=NEVER
created_at      timestamptz  nullable  is_generated=NEVER  default now()
tenant_id       uuid         NOT NULL  is_generated=NEVER
daily_log_id    uuid         NOT NULL  is_generated=NEVER
phase           text         NOT NULL  is_generated=NEVER
photo_url       text         nullable  is_generated=NEVER
caption         text         nullable  is_generated=NEVER
retention_class text         NOT NULL  is_generated=NEVER
received_at     timestamptz  NOT NULL  is_generated=NEVER  default now()
expires_at      timestamptz  nullable  is_generated=ALWAYS
  generation_expression: timezone('UTC'::text, (timezone('UTC'::text, received_at) +
    CASE retention_class
        WHEN 'attendance'::text THEN '7 days'::interval
        ELSE '60 days'::interval
    END))
```
(`expires_at`'s own `is_nullable=YES` at the catalog level is normal for a
generated column in Postgres — nullability of the SOURCE columns feeding
it, both NOT NULL here, is what actually guarantees it is never null in
practice; confirmed separately via the write-guard probe below, which
inserted real rows and observed real non-null values.)

Constraints on `daily_log_photos` (6, all present — PK, both FKs, both
simple CHECKs, and the composite check). **`daily_log_id`'s FK is now
RESTRICT, matching item 3** (was `ON DELETE CASCADE` in round 1):
```
daily_log_photos_pkey                       PRIMARY KEY (id)
daily_log_photos_daily_log_id_fkey          FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id) ON DELETE RESTRICT
daily_log_photos_tenant_id_fkey             FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
daily_log_photos_phase_check                CHECK (phase = ANY (ARRAY['morning'::text, 'evening'::text]))
daily_log_photos_retention_class_check      CHECK (retention_class = ANY (ARRAY['attendance'::text, 'evening_progress'::text]))
daily_log_photos_phase_retention_check      CHECK (((phase = 'morning'::text) AND (retention_class = 'attendance'::text)) OR ((phase = 'evening'::text) AND (retention_class = 'evening_progress'::text)))
```

RLS flags and the one policy — UNCHANGED from round 1, re-confirmed live
rather than assumed carried-over:
```
{"rls_enabled": true, "rls_forced": false}

policyname: daily_log_photos_select
cmd: SELECT
roles: {authenticated}
qual: ((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1
   FROM (daily_logs dl JOIN project_members pm ON ((pm.project_id = dl.project_id)))
  WHERE ((dl.id = daily_log_photos.daily_log_id)
     AND (pm.user_id = ( SELECT users.id FROM users WHERE (users.auth_id = auth.uid())))
     AND (pm.role = 'pm'::text)))))
```

**Step 5 — the four-way negative grant probe item 1 asked for, widened to
the full seven privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER), all three roles, via `has_table_privilege(...)`:**
```
anon:          SELECT=false  INSERT=false  UPDATE=false  DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
authenticated: SELECT=true   INSERT=false  UPDATE=false  DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
service_role:  SELECT=true   INSERT=true   UPDATE=true   DELETE=false  TRUNCATE=false  REFERENCES=false  TRIGGER=false
```
Every cell matches the design exactly, including the two privileges
(REFERENCES, TRIGGER) round 1's probe never checked — the actual gap item
1 found is now closed and independently re-verified, not just re-asserted
from the new `REVOKE ALL`/`GRANT` text.

**Step 6 — FK RESTRICT and the generated-column write-guard, both proven
live in one disposable, rolled-back transaction** (a throwaway tenant/
project/engineer/daily_log/photo built and torn down inside `BEGIN;
... ROLLBACK;`, never touching real fixture data):
```sql
-- (abbreviated; full script kept out of the file, not the repo, since it
-- is scratch — the shape: seed one real daily_logs row and one real
-- daily_log_photos row pointing at it, then:)

DELETE FROM public.daily_logs WHERE id = v_log_id;
-- EXPECTATION: foreign_key_violation. OBSERVED: foreign_key_violation.
-- (the DO block's own EXCEPTION WHEN foreign_key_violation branch caught
-- it and printed a NOTICE; the alternative branch -- an unconditional
-- RAISE EXCEPTION announcing the RESTRICT had failed to fire -- did NOT
-- run, confirmed by the query completing with no error.)

INSERT INTO public.daily_log_photos (..., expires_at) VALUES (..., now());
-- EXPECTATION: rejected (a generated column refuses an explicit value).
-- OBSERVED: rejected -- caught by the DO block's EXCEPTION WHEN OTHERS
-- branch, which printed the real SQLSTATE/SQLERRM as a NOTICE; the
-- unconditional "GENERATED COLUMN GUARD FAILED" RAISE EXCEPTION did NOT
-- run, confirmed the same way.
```
Both assertions passed; the whole probe transaction was rolled back
afterward, so it left test-db exactly as it found it (the disposable
tenant/project/engineer/daily_log/photo never committed).

### A THIRD interaction, found only by running the real suite: `service_role` needed test-only DELETE back

Item 1's `REVOKE ALL ... FROM ... service_role` (correctly) removes
`service_role`'s DELETE on this table for PROD's sake — the table is
tombstone-only by design. But test-db's OWN cleanup code
(`test/media-ingest.test.ts`'s `cleanupPhotos`, and this round's new
`test/photo-access-boundary-agreement.test.ts`'s own `afterAll`) runs AS
`service_role` and physically DELETEs the rows it creates during a test
run — this is EXACTLY the same shape as the already-documented
`outbound_sends` divergence (CLAUDE.md: "`OUTBOUND_SENDS`' GRANTS NOW
DIFFER BETWEEN TEST-DB AND PROD"). The first full-suite run after this
round's re-apply (§7's "first attempt" below) surfaced it directly: 18
test files failed, not because of any real regression in their own logic,
but because their own routine `daily_logs` cleanup (deleting rows under a
shared fixture project) hit `daily_log_photos_daily_log_id_fkey`'s new
RESTRICT — a `daily_log_photos` row that `cleanupPhotos`/`afterAll` had
tried and SILENTLY FAILED to delete (no `{ error }` check on that
specific call) was still there, blocking its parent `daily_logs` row's
delete.

**Fix, same mechanism as the existing `outbound_sends` precedent, not a
new one**: `scripts/test-db-only-grants.sql` (never a migration file,
never scanned by any apply/lint tool per that file's own header) now also
grants `service_role` DELETE on `daily_log_photos`, test-db ONLY. Applied
live:
```
$ supabase db query --linked -f scripts/test-db-only-grants.sql
{}   -- no error
```
The 3 orphaned rows left over from the failed run (all timestamped
`2026-09-14 04:18–04:20 UTC`, confirmed by `min(received_at)`/
`max(received_at)` before deleting, so nothing older or unrelated was
touched) were then cleaned up directly, restoring the zero-row baseline:
```
$ SELECT count(*) FROM public.daily_log_photos;  -- before: 3, after: 0
```
Prod's own migration file is UNTOUCHED by this — the revoke there stays
exactly as reviewed; this divergence is scoped to test-db's own grants
file, identically to the existing `outbound_sends` entry it now sits next
to.

---

## §7 — Raw test-suite results against test-db (post-apply)

Two fixes landed in this same pass, discovered by running the real test
suite against the newly-applied schema (see this session's own report for
full diffs):

1. **Completion detection made structural, not text-based**
   (`lib/whatsapp/dispatch.ts`'s new `isCompletion`/`DispatchResult.
   completed`) — replaces a `dispatchResult.reply === MORNING_COMPLETE_
   REPLY` string comparison in `inbound-start.ts` that would have silently
   broken the photo-count feature the moment either completion string's
   wording changed. Covered by a new `test/unit/dispatch-completion.test.ts`
   (11 cases, pure unit, no DB).
2. **A photo on the very first turn of a flow no longer silently drops**
   (`lib/media/ingest.ts`'s new `resolveOrCreateDailyLogId`) — the row is
   now created (upserted) if it doesn't exist yet, instead of the photo
   being silently un-enqueued. If row creation itself genuinely fails, the
   engineer is now told immediately (`PHOTO_SAVE_FAILED_REPLY`, approved
   copy), a materially different failure surface from a background
   `media_ingest` job failing after acceptance.

A third, unplanned bug was found and fixed **while establishing test
evidence for this package**: `T-WH-14` ("a photo sent at idle gets the
photo reply") regressed because `inbound-start.ts`'s idle/hindrance
canned-reply branches were keyed on `extractMediaItems(params).length >
0` rather than on whether the message was classified as a photo at all —
`extractMediaItems` can legitimately return `[]` for a message
`classifyMediaReply` still correctly calls `'photo'` (a missing
`MediaUrl{i}` — not expected from real Twilio, per its own API contract,
but not something the idle-classification path should silently depend on
either). Fixed by threading a separate `isPhoto: boolean` through
`route.ts` -> `routeInboundMessage`, used by the idle/hindrance branches;
the extracted `media` array is now used ONLY for the actual storage
payload in the active-flow path, never for classification. Full diff in
this session's own report.

**First full-suite run** (`npm test`, 96 files, against test-db with 043
applied and both fixes + the T-WH-14 fix in place, BEFORE the two missing
Twilio env vars below were added):

```
 Test Files  2 failed | 94 passed (96)
      Tests  4 failed | 1147 passed | 1 todo (1152)
   Duration  1038.09s
```

**All 4 failures in that run, by name, each explained:**

1. `test/media-ingest.test.ts > handleMediaIngestJob — retention class /
   expires_at stamped at insert (item 15) > morning: retention_class=
   "attendance", expires_at = received_at + 7 days` — **environment gap,
   not a code or migration defect.** This worktree's `.env.test` had
   `TWILIO_AUTH_TOKEN` set but was missing `TWILIO_ACCOUNT_SID` and
   `TWILIO_WHATSAPP_NUMBER` entirely (confirmed by name-only presence
   check, values never printed). `handleMediaIngestJob` calls
   `readCredentials()` (reused from `lib/whatsapp/outbound/send.ts`) which
   requires all three and throws before the test's own injected
   `fetchFn` mock is ever reached.
2. Same file, same cause: `evening: retention_class="evening_progress",
   expires_at = received_at + 60 days`.
3. Same file, same cause: `media_ingest — failed ingest recorded as
   failed > handleMediaIngestJob throws on a Twilio download failure,
   before touching Storage or daily_log_photos` (asserted a DIFFERENT
   thrown message than the one actually thrown, because the credential
   check fired first).
4. `test/session-transition.test.ts > acquire_and_transition_session /
   drain_next_pending_flow > B: caller 2 blocks on the row lock until
   caller 1 commits` — **confirmed pre-existing, not a stage-1
   regression.** Re-ran the identical test on `main` (`e92d0f4`, via
   `git stash` isolating this branch's changes) and it fails there too,
   with the identical error message. Matches CLAUDE.md's own standing
   "CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY" rule — this
   sandbox cannot sustain genuinely concurrent RPC calls against test-db;
   this specific test's flakiness is a documented, pre-existing sandbox
   limitation (`docs/reviews/sandbox-cannot-test-concurrency.md`,
   `docs/reviews/session-transition-lock-wait-flake.md`), not something
   this pass introduced or is expected to fix.

**Fixed since: the three credential-gated failures (items 1-3 above) are
now closed.** `TWILIO_ACCOUNT_SID` and `TWILIO_WHATSAPP_NUMBER` were added
to this worktree's `.env.test`, and `test/media-ingest.test.ts` was re-run
in isolation:

```
$ npx vitest run test/media-ingest.test.ts

 ✓ routeInboundMessage — captioned photo (item 12) > a caption that parses
   as a valid answer reaches the parser AND is stored on the job payload
 ✓ routeInboundMessage — burst of several photos in one turn (item 13) >
   all photos in one inbound message are stored as a single job, with the
   turn's own natural reply and no per-photo acknowledgement
 ✓ handleMediaIngestJob — retention class / expires_at stamped at insert
   (item 15) > morning: retention_class="attendance", expires_at =
   received_at + 7 days
 ✓ handleMediaIngestJob — retention class / expires_at stamped at insert
   (item 15) > evening: retention_class="evening_progress", expires_at =
   received_at + 60 days
 ✓ media_ingest — failed ingest recorded as failed > handleMediaIngestJob
   throws on a Twilio download failure, before touching Storage or
   daily_log_photos
 ✓ media_ingest — failed ingest recorded as failed > markMediaIngestFailed
   records daily_logs.{phase}_photos_status = failed

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  28.58s
```

All 6 tests in this file now pass for real, against test-db with 043
applied — not skipped, not credential-blocked. This was a targeted re-run
of this one file, not a repeat of the full 96-file run above; item 4
(the session-transition lock-wait flake) was not re-exercised by this run
and remains open, unaffected by the credential fix (it has nothing to do
with Twilio credentials — see below).

**This closes 3 of the 4 originally-reported failures. The 4th
(session-transition's lock-wait test) is pre-existing and unrelated —
see immediately below.**

**Known-not-ours fact #1 — the session-lock failure is pre-existing, not a
stage-1 regression.** Confirmed by re-running the identical test on `main`
(`e92d0f4`, via a stash-isolated comparison that removed every stage-1
change from the working tree first) — it fails there too, with the
identical error message. This matches CLAUDE.md's own standing
"CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY" rule: this sandbox
cannot sustain genuinely concurrent RPC calls against test-db, so this
specific test's flakiness is a documented, pre-existing sandbox
limitation (`docs/reviews/sandbox-cannot-test-concurrency.md`,
`docs/reviews/session-transition-lock-wait-flake.md`), not something this
pass introduced or is expected to fix.

**Known-not-ours fact #2 — a known property of this suite, stated
plainly, not buried.** The FIRST full-suite run after applying 043 showed
20 failures, not 4 — including 9 in `test/evening-flow.test.ts`, 2 in
`test/morning-flow.test.ts`, and 4 in `test/unit/morning-cutoff-sweep.
test.ts`, none of which touch this migration's own code or tables at all.
Re-running those exact files in ISOLATION (just the 5 affected files, not
the full 96) reproduced only the one known concurrency flake (fact #1
above) — proving the other 16 were **cross-file test-db pollution under
concurrency**: running 96 files' worth of integration tests concurrently
against one shared test database produces spurious failures that vanish
on isolated re-run, not real regressions. This is a known, standing
property of this project's test suite against test-db (consistent with
CLAUDE.md's own recorded test-db reliability concerns), not a stage-1
finding — recorded here plainly so a reviewer doesn't mistake a
full-96-file failure count for stage-1 damage.

### Round 2 — post fold-and-return, full suite, TWICE (2026-09-14)

**First attempt after the round-2 re-apply — 18 failed test files, and
this one WAS a real regression from this round's own fix, not sandbox
noise.** Immediately after the teardown + fresh re-apply (§6) and before
`scripts/test-db-only-grants.sql` was updated, a full run produced:
```
 Test Files  18 failed | 79 passed (97)
      Tests  5 failed | 1121 passed | 29 skipped | 1 todo (1156)
   Duration  818.50s
```
Root cause (full account: §6's own "A THIRD interaction" subsection):
item 1's `REVOKE ALL ... FROM ... service_role` correctly removed
`service_role` DELETE on `daily_log_photos` for prod's sake, but test-db's
OWN cleanup code (`cleanupPhotos` in `test/media-ingest.test.ts`, `afterAll`
in the new `test/photo-access-boundary-agreement.test.ts`) runs as
`service_role` and needs that exact privilege to remove rows it creates —
without it, a `daily_log_photos` row a test tried and silently failed to
delete stayed behind and blocked ~a dozen UNRELATED test files' own
routine `daily_logs` cleanup via the new RESTRICT FK (item 3). Fixed by
extending the SAME test-db-only-grant mechanism this project already uses
for `outbound_sends` (`scripts/test-db-only-grants.sql`) to cover
`daily_log_photos` too — never a migration, never touching prod.

**Second attempt, after the grant fix and cleaning the 3 orphaned rows
left over from the first attempt — clean, one known failure only:**
```
$ npx vitest run

 Test Files  1 failed | 96 passed (97)
      Tests  1 failed | 1154 passed | 1 todo (1156)
   Duration  1002.04s
```
**The one failure, in full**:
```
FAIL test/session-transition.test.ts > acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits
Error: Test B: caller 1's row lock was never observed within 3000ms via
quoco_test_row_is_locked -- caller 1 never appeared to reach Postgres at
all in that window. This is a different failure from an ordering
inversion (see docs/reviews/session-transition-lock-wait-flake.md) --
investigate caller 1's own dispatch/connection, not the lock mechanism.
```
**Still the same known-not-ours sandbox limitation, a DIFFERENT specific
manifestation of it than round 1 observed** (round 1 hit an ordering
inversion; this run hit a timeout waiting to observe the lock at all) —
the test's own thrown error explicitly distinguishes the two shapes and
points at `docs/reviews/session-transition-lock-wait-flake.md`, the same
file cited for the round-1 manifestation. Both shapes trace to the same
root cause named in that document and in CLAUDE.md's own standing
"CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY" rule: this sandbox
cannot sustain genuinely concurrent RPC calls against test-db. Not
independently re-verified against a stashed `main` a second time in this
round (round 1 already established the class is pre-existing and
sandbox-specific; this is a different manifestation of the identical
underlying cause, not a new, unexplained failure needing its own
from-scratch investigation) — flagged here for the reviewer's own
judgment rather than asserted as fully closed.

**Both media-capability test files pass in full in this final run**:
`test/media-ingest.test.ts` (6/6) and the new
`test/photo-access-boundary-agreement.test.ts` (4/4 — all four matrix
cases: PM on the owning project, PM on another tenant's project, non-PM
(qs) in the correct tenant, and a nonexistent daily_log, each asserted
against both `getSignedPhotoUrl()` and the RLS-enforced SELECT in the same
`it`).

---

## §8 — What is NOT covered

- **No rehearsal on a fresh Supabase branch.** Per Aravind's explicit
  instruction this round, this migration was applied directly to test-db
  rather than rehearsed on a throwaway branch first — the reasoning being
  that test-db is itself a test database, and the real test suite running
  against it afterward is the evidence. This is a deliberate, named
  deviation from the `EVERY NEW MIGRATION GETS A DISPOSABLE DRY-RUN`
  standing rule's usual local-Postgres-scaffold step (CLAUDE.md §7) — no
  local dry-run scaffold was built for this migration; the test-db apply
  substitutes for it.
- **No `service_role` DELETE/TRUNCATE-denial probe run as an explicit
  negative-capability TEST, automated and repeatable.** §6 now has TWO
  live checks — the full seven-privilege `has_table_privilege` readback,
  and a disposable rolled-back-transaction probe that actually attempted
  the denied writes — but neither is a standing, repeatable `vitest` test
  the way `031_outbound_send_ledger.sql`'s own round eventually built.
  **A genuine complication now exists that did not exist when this bullet
  was first written**: `service_role` DELETE on this table is no longer
  uniformly denied everywhere — `scripts/test-db-only-grants.sql` now
  deliberately GRANTS it on test-db ONLY (§6's "A THIRD interaction"
  subsection), mirroring the existing `outbound_sends` divergence, because
  test-db's own suite needs it to clean up after itself. A naive automated
  "assert DELETE is denied" test run against test-db's LIVE grants would
  now get a **false pass on the wrong claim** — DELETE genuinely succeeds
  there by design. Any future automated version of this check must assert
  against PROD's grant shape specifically (e.g., reading
  `031_outbound_send_ledger.sql`/`043_daily_log_photos.sql`'s own REVOKE/
  GRANT text, or running against a schema built from the migration files
  alone, never against live test-db state) — recorded here so the
  recommendation isn't acted on naively.
- **No DOWN-block rehearsal against a live in-flight session.** The DOWN
  block here is purely additive/structural (drop the table, drop two
  columns) with no function/routing-logic change, so the "confirm a live
  in-flight session survives the DOWN" class of rehearsal (CLAUDE.md §7,
  added after migrations 036/038's own DOWN incidents) does not apply the
  same way — but the DOWN block itself has NOT been executed against
  test-db even once, forward-then-back, the way 036/037/039 all were.
  Only the FORWARD migration has been rehearsed for real.
- **Prod is completely untouched.** No SQL from this migration has run
  anywhere except test-db. The external review gate (CLAUDE.md §0
  condition (b): new table, new RLS, new grants) still stands between this
  file and any prod apply.
- **NO AUTOMATED TEST PROVES A REAL IMAGE WAS DOWNLOADED FROM TWILIO AND
  LANDED IN THE `daily-log-photos` BUCKET — STATED PLAINLY, OWED, NOT
  DONE.** All 6 tests in `test/media-ingest.test.ts` now pass (§7 above),
  but every one of them injects `fetchFn` — the function that stands in
  for the real Twilio download — as a mock: `fakeFetch` (the two retention
  tests) returns a small fixed byte array locally, never making a network
  call to Twilio at all; the one test that DOES exercise something about
  the download step, `failingFetch`, only exercises the FAILURE path (a
  simulated 404), and throws before Storage or the table is ever touched.
  So: the **success** paths in this suite prove the Storage-upload and
  `daily_log_photos`-insert code is correct given already-downloaded
  bytes, using test data standing in for those bytes — they do not prove
  a real Twilio media URL can actually be fetched and land in the bucket.
  Only the **failure** path genuinely exercises the download step at all,
  and only to prove it fails correctly. **This gap is not closed by
  anything in this package and must not be described as covered.** The
  end-to-end proof owed before this is trusted on prod: a manual,
  post-deploy check — send one real photo mid-check-in on a real handset,
  then confirm the object actually exists in the `daily-log-photos` bucket
  (and the corresponding `daily_log_photos` row, with a real, non-fake
  `photo_url`). This has NOT been done in this pass. Do not treat the 6/6
  pass above as substituting for it.
- **The uncaptioned-photo Twilio `Body` question** (stage 1 plan's own §8)
  remains genuinely unresolved — this pass's code sidesteps it (tests
  `params.message.trim().length > 0` rather than depending on `Body`'s
  exact absent-vs-empty shape) but that sidestep itself has not been
  verified against a real uncaptioned inbound webhook payload.
- **The FK RESTRICT behavior and the generated-column write-guard (items 2
  and 3) are proven by a one-off manual probe, not a standing `vitest`
  test.** §6's Step 6 confirmed both live, in a disposable rolled-back
  transaction — a real `daily_logs` DELETE was rejected with
  `foreign_key_violation` while a `daily_log_photos` row referenced it, and
  a real INSERT supplying `expires_at` explicitly was rejected by the
  generated column — but neither assertion lives in the repeatable test
  suite. A future, unrelated edit to either constraint (someone widening
  the FK back to CASCADE, or converting the generated column back to a
  plain one) would not be caught by any test run, only by another manual
  probe. **Recommend**: fold both into `test/media-ingest.test.ts` (or a
  small dedicated file) before this migration is considered fully closed
  out.
- **The test-db/prod grant DIVERGENCE this round introduced for
  `daily_log_photos` (§6's "A THIRD interaction") is itself now a second
  named instance of a pattern this project has exactly one prior example
  of (`outbound_sends`).** CLAUDE.md's own standing rule on the first
  instance says "if a second such exception is ever added, name it here
  too rather than letting 'test-db mirrors prod' silently accrue unstated
  exceptions" — that CLAUDE.md update has NOT been made as part of this
  package; it is a follow-up this round leaves open, named here so it
  isn't lost.

---

## §9 — Reviewer's own checklist — what to look at hardest

**Round 2 additions are listed FIRST, since they're what this fold-and-
return round actually needs signed off on; the original round-1 items
follow, updated where this round's evidence changed their status.**

0. **THE ITEM THAT NEEDS THE REVIEWER'S OWN RE-CONFIRMATION, NOT JUST
   ARAVIND'S (§5).** Item 2's literal proposed SQL does not compile on
   real Postgres (`ERROR: 42P17: generation expression is not immutable`)
   — the fix adopted (a UTC-pinned expression) is functionally identical
   but is different SQL from what was specified. Confirm independently
   that the substitution is sound: re-derive or re-check the
   `pg_proc.provolatile` claims in §5 rather than trusting this package's
   own lookups, and confirm the UTC-pinning approach has no edge case
   (e.g., a `received_at` value stored with a sub-second component, a
   leap-second boundary) that would make it diverge from the originally
   intended "received_at + 7d/60d" semantics.
1. **The pinned tenant_id/daily_log_id argument (item 4, the "Pinned
   argument" section above) — confirm the single-writer premise actually
   holds**, by grep or by direct code review: is `lib/media/ingest.ts`'s
   `handleMediaIngestJob` genuinely the ONLY code path that ever inserts
   into `daily_log_photos`? (Confirmed once, in this package's own
   authoring — worth a reviewer's independent check, since the whole
   argument's validity rests on this being true and staying true.)
2. **The service_role grant story now has THREE parts, not one — trace
   all three, don't stop at the first.** (a) The REVOKE ALL/GRANT-back
   PROD grants (§3/§6, item 1's fix) — confirm
   `has_table_privilege('service_role', 'public.daily_log_photos',
   'DELETE')` returns `false` on whatever database this migration is next
   applied to prod against, don't trust this package's own readback
   alone. (b) The NEW test-db-only exception
   (`scripts/test-db-only-grants.sql`, §6's "A THIRD interaction") that
   deliberately grants that SAME privilege back on test-db only — confirm
   this file is never scanned by any apply/lint/CI path (its own header
   makes this claim; independently verify it, the same way `outbound_sends`'
   equivalent claim should have been independently checked when it was
   first added). (c) The **open CLAUDE.md follow-up** this creates (§8's
   final bullet) — CLAUDE.md's own standing rule on the `outbound_sends`
   precedent asks for a SECOND instance of this divergence to be named in
   CLAUDE.md itself, which this round has NOT done (deferred, given
   CLAUDE.md is already past its own 120,000-char warn threshold) —
   Aravind should decide whether that CLAUDE.md update is a precondition
   here or a tracked follow-up.
3. **The boundary-agreement test (item 6, `test/photo-access-boundary-
   agreement.test.ts`) covers CROSS-TENANT, not same-tenant-different-
   project.** Its "PM on another tenant's project" case proves isolation
   across tenants; it does NOT independently prove a PM who is a member of
   a DIFFERENT project in the SAME tenant is excluded — that gap is the
   ORIGINAL, still-open concern in item 4 below (carried over from round
   1, not closed by this round's new test).
4. **The `daily_log_photos_select` RLS policy's join path** (§2, §6) —
   confirm the `daily_log_id -> daily_logs.project_id -> project_members`
   join correctly excludes a PM who is a member of some OTHER project in
   the SAME tenant (not just a different tenant — see item 3 immediately
   above for why the new boundary-agreement test doesn't already cover
   this). Not independently probed with a live same-tenant-different-
   project fixture in this pass — worth a dedicated test before this
   migration is considered fully proven, matching CLAUDE.md §7's own
   standing "RLS change → a cross-tenant AND cross-project isolation
   test" requirement (the cross-TENANT half is now covered; the cross-
   PROJECT-same-tenant half is not).
5. **The composite `phase`/`retention_class` CHECK (§4)** — confirm the
   reviewer agrees a hand-maintained TypeScript map (`RETENTION_CLASS` in
   `lib/media/ingest.ts`) is the right place for the phase→class mapping
   to live, given the CHECK is the only thing stopping a future edit to
   that map from producing an inconsistent row.
6. **The `isPhoto` fix in `lib/whatsapp/inbound-start.ts`/`route.ts`**
   (§7, the T-WH-14 regression) — this is a genuine behavior change to
   the idle/hindrance classification path, found and fixed mid-pass, not
   pre-planned. Confirm the reasoning (extraction emptiness ≠
   classification) holds and that no other call site still keys off
   `media.length` where `isPhoto` should be used instead.
7. **Whether the missing real-Twilio-to-bucket end-to-end proof (§8) should
   block a prod apply.** The credential-gated tests now pass for real
   (§7) — the insert shape, retention arithmetic, and Storage-upload code
   are exercised against test-db, not merely reviewed. What remains
   genuinely unproven is the download leg itself: no test here calls the
   real Twilio media API. Aravind should decide whether the manual
   post-deploy photo-send check named in §8 is a hard precondition for a
   prod apply, or whether this package's evidence is sufficient without
   it.
8. **The FK RESTRICT and generated-column write-guard (§6 Step 6,
   §8) are manual-probe-only, not standing tests** — see §8's own bullet
   for the recommendation to fold both into the automated suite before
   this is considered fully closed out.

Nothing in `supabase/migrations/` has been touched. No further application
code beyond this pass's two named fixes has been written. Prod has not
been touched, linked, or queried at any point in this pass.
