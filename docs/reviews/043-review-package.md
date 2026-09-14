# 043_daily_log_photos.sql — external review package (2026-09-13/14)

**Status: applied to TEST-DB ONLY (`exfccwlrhoutkgrlikod`), NOT applied to
prod.** Not merged, no PR open yet, file lives in `docs/reviews/`, not
`supabase/migrations/`, per CLAUDE.md's "a migration file enters
`supabase/migrations/` when it is being applied, not when it is written"
rule — the test-db apply below does not count as "the" apply for that rule;
it is the review-and-rehearsal apply Aravind explicitly chose in place of a
Supabase-branch rehearsal (`docs/plans/stage1-photo-intake-plan.md`'s stage,
this round's own instruction: "apply to test-db directly rather than
rehearsing on a branch first — it is a test database, and the tests
themselves become review evidence").

## Repo-state header (per this project's own standing rule)

- `main @ e92d0f4` (Merge pull request #267 from ara-2789/stage0-post-apply-paperwork) — confirmed via `git rev-parse HEAD` in this worktree; the worktree is `worktree-stage1-photo-intake-build`, currently uncommitted (all stage 1 work, including this package, sits as working-tree changes, per this round's explicit "do not commit" instruction).
- `supabase/migrations/` on `main` tops out at `042_storage_bucket_setup.sql` (stage 0, applied and merged). 043 is not in that directory — it lives here, in `docs/reviews/`.
- `scripts/migration-number-reservations.json` carries a 043 entry, reserved against `main`'s own highest applied (042) at reservation time.
- Last runbook executed against a real database: THIS package's own test-db apply + readback, below, 2026-09-13/14.

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
-- HELD, NOT APPLIED ANYWHERE. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, and per this pass's own explicit instruction not to apply anything
-- to production. NOT rehearsed against a real database this pass -- this
-- build environment has no Supabase credentials of any kind (no .env.test
-- in this worktree, no SUPABASE_TEST_* vars in the shell). A real
-- dry-run/rehearsal against test-db, per CLAUDE.md §7's own standing
-- "every new migration gets a disposable dry-run" rule, is owed before
-- this is ever applied for real.
--
-- EXTERNAL REVIEW GATE: this trips CLAUDE.md §0's condition (a
-- generalization) -- a brand-new table with its own RLS policies and
-- grants from day one, per that document's own broadening clause ("a new
-- table with wrong RLS from day one... is at least as dangerous as a bad
-- change to an existing one"). Needs the full review package before it
-- applies, same as every other schema change in this project's recent
-- history (029, 031, 038, 039, ...). NOT reviewed yet.
--
-- NUMBER RESERVED 2026-09-13 in scripts/migration-number-reservations.json.
-- Confirmed against origin/main at reservation time: highest applied
-- migration is 042 (supabase/migrations/042_storage_bucket_setup.sql),
-- highest reservation is 042 -- 043 was free.
--
-- SHAPE: retention_class and expires_at are STAMPED AT INSERT TIME by the
-- media_ingest job handler (lib/media/ingest.ts), never recomputed later --
-- stage 6's retention job scans expires_at directly. photo_url is always a
-- Supabase Storage object path (this stage's own bucket, 'daily-log-photos',
-- stage 0), NEVER a Twilio URL. No table this migration creates references
-- storage.objects by foreign key -- Storage and Postgres are independent
-- systems here, linked only by the path convention stage 0 established
-- ({tenant_id}/{daily_log_id}/{photo_id}.{ext}), enforced by application
-- code, not a database constraint.
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
  daily_log_id    UUID         NOT NULL REFERENCES public.daily_logs(id) ON DELETE CASCADE,
  phase           TEXT         NOT NULL CHECK (phase IN ('morning', 'evening')),
  photo_url       TEXT,        -- Supabase Storage object path. NULL once tombstoned (item 9, stage 6).
  caption         TEXT,        -- item 12: the answer-parser's raw Body, if any accompanied the photo.
  retention_class TEXT         NOT NULL CHECK (retention_class IN ('attendance', 'evening_progress')),
  expires_at      TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
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
  'directly. retention_class/expires_at are stamped at INSERT time, never '
  'recomputed later (stage 6''s own retention job depends on this). Tombstoned '
  '(photo_url set NULL), never hard-deleted, once expires_at passes (item 9).';

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

-- authenticated/anon: read-only via the policy above, nothing else.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.daily_log_photos FROM authenticated;
REVOKE ALL ON public.daily_log_photos FROM anon;

-- service_role: needs SELECT (the ingest job reads back what it wrote in
-- some paths) INSERT (the ingest job's own write) and UPDATE (stage 6's
-- tombstone -- photo_url set NULL, row retained). Does NOT need DELETE or
-- TRUNCATE -- this table is tombstoned, never hard-deleted (item 9), so an
-- unrevoked DELETE grant here would be the EXACT gap already found twice on
-- this project (dpr_versions, migration 031 round 1) -- named explicitly by
-- CLAUDE.md's own standing rule ("a table-level revoke must name
-- service_role explicitly"), applied here from day one rather than found
-- later by an external reviewer.
REVOKE DELETE, TRUNCATE ON public.daily_log_photos FROM service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
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

| Role | Grant/Revoke | What it prevents / allows |
|---|---|---|
| `anon` | `REVOKE ALL` | No unauthenticated access at all — matches the standing pattern for every tenant-scoped table in this schema. |
| `authenticated` | `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` (SELECT stays, gated by the RLS policy above) | Prevents a logged-in PM's own session from ever writing a row directly — every write must go through the job handler's `service_role` path. Without this, RLS alone would still permit an `INSERT ... WITH CHECK` if a future migration ever added one; the REVOKE removes the table-level privilege outright, so there is nothing for a future WITH CHECK gap to expose. |
| `service_role` | SELECT/INSERT/UPDATE retained (Supabase's default ACL grants these automatically); **`REVOKE DELETE, TRUNCATE`** | This is the load-bearing one. Supabase grants `service_role` **all** privileges on every new `public`-schema table by default — the exact mechanism that produced the `dpr_versions` gap (migration 029) and was later found to be a *pattern*, not a one-off, per CLAUDE.md's own standing rule ("a table-level revoke must name `service_role` explicitly... a table whose design claims to be append-only or a durable record must have that claim enforced by grants"). This table is explicitly tombstoned, never hard-deleted (item 9: `photo_url` set NULL, row retained) — an unrevoked `DELETE`/`TRUNCATE` grant on `service_role` would leave that claim enforced by convention only, not by the database, identical to `dpr_versions`' own gap. Closed here from day one, not found later by a post-apply probe. |

**Post-apply verification, live (not asserted from the migration text) —
see §5 below for the exact probe and raw output**: `service_role` holds
SELECT/INSERT/UPDATE = `true`, DELETE/TRUNCATE = `false`; `authenticated`
holds SELECT = `true`, INSERT/UPDATE/DELETE = `false`; `anon` holds
SELECT/INSERT = `false`. Confirmed by `has_table_privilege(...)`, not
inferred from the `REVOKE`/`GRANT` statements' text alone.

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

## §5 — `retention_class`/`expires_at` stamped at INSERT, never recomputed — and stage 6's dependency on that

**Stamped once, at insert time, by `lib/media/ingest.ts`'s
`handleMediaIngestJob`**:
```ts
const retentionDays = RETENTION_DAYS[payload.phase]       // 7 (morning) or 60 (evening)
const retentionClass = RETENTION_CLASS[payload.phase]     // 'attendance' or 'evening_progress'
const receivedAt = new Date()
const expiresAt = new Date(receivedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000)
```
This value is written into the row and **never recomputed** — there is no
trigger, no view, no read-time derivation. `expires_at` is a durable fact
about *that specific row*, fixed at the moment it was inserted.

**Why this matters for stage 6 (the still-unbuilt retention/deletion
job)**: that job's entire design (item 15's own "may extend later" note)
depends on scanning `expires_at` directly — `WHERE expires_at < now()` —
rather than recomputing `received_at + retention_window_for(phase)` at
scan time. If the retention window is ever changed later (e.g., evening
photos move from 60 to 90 days), rows **already stamped** under the old
60-day window must keep their **original** expiry — a forward-only
change, matching item 15's own decided semantics. Recomputing at scan time
would retroactively apply the new window to old rows, which is explicitly
NOT the intended behavior. The `idx_daily_log_photos_expires_at` index
exists specifically to make that stage-6 scan cheap once real rows exist.

**Not built or tested in this pass**: stage 6 itself (the actual deletion/
tombstone job) does not exist yet — this migration only lays the
structural groundwork (the column, the index, the stamping-at-insert
discipline) it will depend on.

---

## §6 — Test-db apply evidence, pinned

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

**Apply** — `supabase db query --linked -f docs/reviews/043_daily_log_photos.sql`
— completed with no error, zero rows returned (a DDL/DML transaction, not a
SELECT).

**Post-apply readback, live, by name — not asserted from the migration
text:**

Table exists:
```
{"daily_log_photos_exists": "daily_log_photos"}
```

Columns (10, matching the `CREATE TABLE` exactly — `id`, `created_at`,
`tenant_id`, `daily_log_id`, `phase`, `photo_url`, `caption`,
`retention_class`, `expires_at`, `received_at`; nullability and defaults
all match):
```
id              uuid    NOT NULL  default gen_random_uuid()
created_at      timestamptz  nullable  default now()
tenant_id       uuid    NOT NULL
daily_log_id    uuid    NOT NULL
phase           text    NOT NULL
photo_url       text    nullable
caption         text    nullable
retention_class text    NOT NULL
expires_at      timestamptz  NOT NULL
received_at     timestamptz  NOT NULL  default now()
```

`daily_logs`' two new status columns, both nullable text:
```
evening_photos_status  text  nullable
morning_photos_status  text  nullable
```

Constraints on `daily_log_photos` (6, all present, matching the migration
exactly — PK, both FKs (`daily_log_id -> daily_logs`, `tenant_id ->
tenants`, both `ON DELETE CASCADE`), both simple CHECKs, and the composite
`daily_log_photos_phase_retention_check`):
```
daily_log_photos_pkey                       PRIMARY KEY (id)
daily_log_photos_daily_log_id_fkey          FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id) ON DELETE CASCADE
daily_log_photos_tenant_id_fkey             FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
daily_log_photos_phase_check                CHECK (phase = ANY (ARRAY['morning','evening']))
daily_log_photos_retention_class_check      CHECK (retention_class = ANY (ARRAY['attendance','evening_progress']))
daily_log_photos_phase_retention_check      CHECK ((phase='morning' AND retention_class='attendance') OR (phase='evening' AND retention_class='evening_progress'))
```

`daily_logs`' two new CHECK constraints:
```
daily_logs_morning_photos_status_check  CHECK (morning_photos_status = ANY (ARRAY['pending','complete','failed']))
daily_logs_evening_photos_status_check  CHECK (evening_photos_status = ANY (ARRAY['pending','complete','failed']))
```

RLS enabled (`relrowsecurity = true`, `relforcerowsecurity = false` — the
standard, non-forced posture every other table in this schema uses):
```
{"rls_enabled": true, "rls_forced": false}
```

Exactly one policy, `SELECT`-only, scoped to `authenticated`, `qual`
matching §2's description verbatim:
```
policyname: daily_log_photos_select
cmd: SELECT
roles: {authenticated}
qual: ((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1
   FROM (daily_logs dl JOIN project_members pm ON ((pm.project_id = dl.project_id)))
  WHERE ((dl.id = daily_log_photos.daily_log_id)
     AND (pm.user_id = ( SELECT users.id FROM users WHERE (users.auth_id = auth.uid())))
     AND (pm.role = 'pm'::text)))))
```

**Grants, by role, via `has_table_privilege(...)` — the exact check §3
above claims:**
```
anon:          SELECT=false  INSERT=false
authenticated: SELECT=true   INSERT=false  UPDATE=false  DELETE=false
service_role:  SELECT=true   INSERT=true   UPDATE=true   DELETE=false  TRUNCATE=false
```
Matches the design exactly: `service_role` can do everything it needs
(SELECT/INSERT/UPDATE) and nothing it shouldn't (DELETE/TRUNCATE, the
`dpr_versions`-class gap this migration was built to avoid from day one).

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
  negative-capability TEST** (only as a one-off `has_table_privilege`
  readback, §6/§7 above). CLAUDE.md's own "REHEARSAL REQUIREMENT" entry
  asks for this to be a first-class rehearsal case, not just a manual
  probe — it was checked here, but not turned into a repeatable automated
  test the way `031_outbound_send_ledger.sql`'s own round did.
  **Recommend**: fold this into `test/media-ingest.test.ts`'s own suite
  before this migration is considered fully closed out, so a future,
  unrelated schema change to this table can't silently reintroduce the
  gap without a test noticing.
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

---

## §9 — Reviewer's own checklist — what to look at hardest

1. **The `service_role` DELETE/TRUNCATE revoke (§3, §6)** — this is the
   single highest-value thing to re-verify independently, given this
   exact gap has now bitten this project twice (`dpr_versions`,
   `outbound_sends`' own grant-divergence note). Confirm
   `has_table_privilege('service_role', 'public.daily_log_photos',
   'DELETE')` returns `false` on whatever database this migration is next
   applied to, don't trust this package's own readback alone.
2. **The `isPhoto` fix in `lib/whatsapp/inbound-start.ts`/`route.ts`**
   (§7, the T-WH-14 regression) — this is a genuine behavior change to
   the idle/hindrance classification path, found and fixed mid-pass, not
   pre-planned. Confirm the reasoning (extraction emptiness ≠
   classification) holds and that no other call site still keys off
   `media.length` where `isPhoto` should be used instead.
3. **The composite `phase`/`retention_class` CHECK (§4)** — confirm the
   reviewer agrees a hand-maintained TypeScript map (`RETENTION_CLASS` in
   `lib/media/ingest.ts`) is the right place for the phase→class mapping
   to live, given the CHECK is the only thing stopping a future edit to
   that map from producing an inconsistent row.
4. **The `daily_log_photos_select` RLS policy's join path** (§2, §6) —
   confirm the `daily_log_id -> daily_logs.project_id -> project_members`
   join correctly excludes a PM who is a member of some OTHER project in
   the same tenant. Not independently probed with a live cross-project
   fixture in this pass (only a single-tenant, single-project code-review
   read) — worth a dedicated cross-project RLS test before this migration
   is considered fully proven, matching CLAUDE.md §7's own standing "RLS
   change → a cross-tenant AND cross-project isolation test" requirement.
5. **Whether the missing real-Twilio-to-bucket end-to-end proof (§8) should
   block a prod apply.** The three previously credential-gated tests now
   pass for real (§7) — the insert shape, retention arithmetic, and
   Storage-upload code are exercised against test-db, not merely reviewed.
   What remains genuinely unproven is the download leg itself: no test
   here calls the real Twilio media API. Aravind should decide whether the
   manual post-deploy photo-send check named in §8 is a hard precondition
   for a prod apply, or whether this package's evidence is sufficient
   without it.

Nothing in `supabase/migrations/` has been touched. No further application
code beyond this pass's two named fixes has been written. Prod has not
been touched, linked, or queried at any point in this pass.
