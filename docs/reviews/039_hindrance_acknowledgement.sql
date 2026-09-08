-- =============================================================================
-- 039_hindrance_acknowledgement.sql
-- DASH-07 Phase 2, Stage 1 -- REHEARSED TWICE AGAINST REAL TEST-DB
-- (exfccwlrhoutkgrlikod), 2026-09-08, held for Aravind's Stage 1 review
-- before this enters supabase/migrations/ for real. Per CLAUDE.md's "a
-- migration file enters supabase/migrations/ when it is being applied,
-- not when it is written" rule, this file lives in docs/reviews/ until
-- an apply is actually happening -- do not copy it into
-- supabase/migrations/ yet, review approval notwithstanding.
--
-- REHEARSAL RECORD -- PASS 1, FULLY ROLLED BACK, NOTHING PERSISTED.
-- Pre-flight: 0 active `hindrances` rows, structure/policy set matched
-- the live schema exactly (tenant-wide-only, 4 PERMISSIVE policies) --
-- confirmed live, not assumed. One transaction: applied this file's own
-- forward DDL verbatim, built throwaway fixtures (two tenants, two
-- projects in tenant A, one REAL auth.users row -- not a fabricated JWT
-- claim with no backing row -- so auth.uid()/get_user_tenant_id() behave
-- exactly as they would for a genuine PostgREST caller), ran 9 cases,
-- ROLLBACK at the end:
--   1. ack_at set, ack_by null        -> REJECT (pairing check)   -- PASS
--   2. ack_by set, ack_at null        -> REJECT (pairing check)   -- PASS
--   3. both null                      -> ACCEPT                   -- PASS
--   4. both set, same-tenant user     -> ACCEPT                   -- PASS
--   5. ack_by = cross-tenant user     -> REJECT (composite FK)    -- PASS
--   6. PM of THIS project updates     -> ALLOW (1 row)            -- PASS
--   7. PM of a DIFFERENT project,
--      same tenant, same real user    -> DENY (0 rows)            -- PASS
--   8. member of THIS project,
--      role='engineer' not 'pm'       -> DENY (0 rows)            -- PASS
--   9. no project_members row at all  -> DENY (0 rows)            -- PASS
-- Cases 6-9 are the RLS PRECEDENCE proof, run via SET ROLE authenticated +
-- a real request.jwt.claims sub (verified first, separately, that this
-- mechanism actually makes auth.uid()/get_user_tenant_id() behave
-- correctly in a `supabase db query` session -- that session connects as
-- `postgres`, table owner, which bypasses RLS by ownership unless
-- explicitly switched away from). Case 7 is the one that actually matters
-- for "confirm which takes precedence": the SAME real user, same tenant,
-- moved from PM-of-project-A1 to PM-of-project-A2 -- under the OLD
-- tenant-wide-only regime this update would have SUCCEEDED; the new
-- RESTRICTIVE policy correctly DENIES it. Post-rollback, re-verified live:
-- 0 hindrances rows, 0 `ack%` columns on the table -- zero residue.
--
-- ONE FIXTURE-BUILDING SURPRISE, WORTH RECORDING FOR THE NEXT PERSON WHO
-- WRITES A RAW-SQL TEST AGAINST THIS TRIGGER: the first attempt at this
-- rehearsal assumed `handle_new_user()` sets `public.users.id = NEW.id`
-- (auth.users.id), matching migration 007's OWN SOURCE TEXT for that
-- function. It doesn't, on the LIVE database -- checked directly via
-- `pg_get_functiondef('public.handle_new_user()'::regprocedure)`, not
-- assumed from the migration file: the current body is `INSERT INTO
-- public.users (id, auth_id) VALUES (gen_random_uuid(), NEW.id)` --
-- `id` is a FRESH random uuid, only `auth_id` is `NEW.id`. Some later
-- migration (015 or 020, both touch this function per grep) changed this
-- without either file's own prose calling out the `id` change explicitly.
-- The first rehearsal attempt used the wrong assumption and got a
-- `project_members_user_id_fkey` violation that made no sense until the
-- live function definition was actually read. Fixed by looking up the
-- resulting `public.users.id` via `WHERE auth_id = <the auth.users.id>`
-- instead of assuming they're equal -- same "verify by observation, not
-- migration-file text" discipline CLAUDE.md's own §0 rehearsal rules ask
-- for elsewhere, just newly needed here.
--
-- REHEARSAL RECORD -- PASS 2, REAL COMMITTED APPLY + REAL COMMITTED DOWN
-- (proves the DOWN block itself, not just the forward DDL's syntax --
-- Pass 1's rolled-back transaction never actually exercises DOWN at all).
-- Forward applied for real: verified live afterward -- 3/3 new columns
-- present, 2/2 new constraints present, 1/1 new policy present, 0
-- `hindrances` rows (still empty, as Pass 1's pre-flight found). DOWN
-- (policy drop, then the three-column ALTER TABLE DROP COLUMN, no
-- explicit DROP CONSTRAINT for either the pairing CHECK or the composite
-- FK -- see the DOWN block's own note on why) applied for real
-- immediately after, FIRST ATTEMPT, no cascade-ordering surprise this
-- time: 0 leftover columns, 0 leftover constraints, 0 leftover policy,
-- exactly 4 policies and 18 columns afterward -- diffed column-name-by-
-- column-name against the pre-migration baseline captured in Pass 1's own
-- pre-flight, byte-identical. Ledger untouched throughout -- `supabase db
-- query --linked` never touches `schema_migrations`, by construction, so
-- this rehearsal leaves no trace there either way.
--
-- WHAT THIS REHEARSAL DOES NOT COVER, STATED PLAINLY: `service_role`'s
-- negative capabilities on the three new columns (CLAUDE.md's REHEARSAL
-- REQUIREMENT is scoped to NEW TABLES; these are new COLUMNS on an
-- existing table whose service_role grants are untouched by this file)
-- and the actual Stage 2 write path (no application code calls this yet
-- -- Stage 1 is schema + policy only, per the task's own staging).
--
-- MIGRATION NUMBER: 039, verified against origin/main's supabase/migrations/
-- (038 is the highest applied number, both on prod and test-db as of
-- 2026-09-08) and against scripts/migration-number-reservations.json (no
-- entry claimed 039 before this file's own reservation commit) and against
-- every sibling worktree under .claude/worktrees/ (none carries a 039 file).
-- Reservation entry added in the same commit as this file, per the
-- held-migration-reservation-required lint rule (scripts/lint-migrations.mjs
-- rule 8).
--
-- SCOPE: docs/plans/dash-07-hindrance-queue.md's "Columns required from the
-- other track" section -- this migration is that other track. Two things:
--   1. Three new nullable columns on hindrances (acknowledged_at,
--      acknowledged_by, ack_notified_at) plus a pairing CHECK and a
--      composite same-tenant FK.
--   2. A new RESTRICTIVE, project-scoped RLS UPDATE policy, ADDED alongside
--      the existing tenant-wide hindrances_update policy (002_rls_policies.
--      sql:257-260) -- that policy is NOT touched, NOT removed. See "RLS
--      PRECEDENCE, WORKED THROUGH EXPLICITLY" below for why a second policy
--      had to be RESTRICTIVE, not another PERMISSIVE one, to have any effect
--      at all.
--
-- =============================================================================
-- THE THREE COLUMNS
-- =============================================================================
--
-- acknowledged_at TIMESTAMPTZ, nullable, no default. Set the moment a PM
-- acknowledges a hindrance (Stage 2's write path); NULL means unacknowledged.
--
-- acknowledged_by UUID, nullable, no default. The acknowledging PM's
-- users.id. Composite same-tenant FK -- see "COMPOSITE FK, NOT PLAIN" below.
--
-- ack_notified_at TIMESTAMPTZ, nullable, no default. NOT the acknowledgement
-- itself -- whether the hindrance-ack WhatsApp sender (Stage 3, currently
-- unbuilt) has told the reporting engineer his PM has seen it. Named as its
-- own column, comment naming its one intended consumer, rather than left to
-- be inferred later -- this table already carries three columns nobody has
-- ever populated (hindrance_type, impact_level, photo_url, all from
-- migration 001 -- docs/plans/dash-07-hindrance-queue.md's own "Smallest
-- useful version" section names this exact prior pattern) and a reader six
-- months from now should not have to guess whether ack_notified_at is a
-- fourth one or a column with a real, currently-just-unbuilt consumer. It
-- is the latter: Stage 3 is the write path, not written here.
--
-- PAIRING CHECK COVERS acknowledged_at/acknowledged_by ONLY, DELIBERATELY
-- NOT ack_notified_at -- three columns, two different lifecycles, not one:
--   * acknowledged_at / acknowledged_by move TOGETHER, always. Set together
--     (Stage 2 Acknowledge), cleared together (Stage 2 Un-acknowledge). The
--     CHECK below makes "one set, the other null" impossible to write.
--   * ack_notified_at moves INDEPENDENTLY and ASYMMETRICALLY:
--       - It can be NULL while acknowledged_at is SET -- this is the normal
--         "send pending" state between Acknowledge and the sender's next
--         successful attempt (Stage 3's trigger condition is exactly
--         "acknowledged_at IS NOT NULL AND ack_notified_at IS NULL").
--       - It must NEVER be cleared by Un-acknowledge. This is the entire
--         reason the column exists as its OWN field rather than being
--         folded into acknowledged_at's own lifecycle -- see "THE SEND-ONCE
--         GUARANTEE" below.
--   A CHECK constraint pairing ack_notified_at with the other two would
--   make BOTH of those legitimate states illegal. It is intentionally left
--   with no CHECK of its own.
--
-- THE SEND-ONCE GUARANTEE, WHY IT LIVES IN THE SCHEMA NOT JUST IN STAGE 2'S
-- CODE (docs/plans/dash-07-hindrance-queue.md's own "send-once marker --
-- prevents a real spam bug" section, and this task's own Stage 3 framing:
-- "this condition is why ack_notified_at is never cleared by undo").
-- Acknowledge -> Un-acknowledge -> Acknowledge again must send the "your PM
-- has seen it" WhatsApp message AT MOST ONCE, ever, for a given hindrance --
-- two sends for one misclick-and-recover cycle is a worse outcome than the
-- misclick itself (the spec's own words). Stage 3's trigger condition
-- (ack_notified_at IS NULL) only stays a correct once-ever gate if NOTHING
-- in this table's write surface ever resets ack_notified_at back to NULL
-- once it is set. This migration does not enforce that at the DB layer (no
-- CHECK/trigger forbids it -- an application bug could still write NULL
-- back over it) -- it is enforced by Stage 2's Un-acknowledge write only
-- ever naming acknowledged_at/acknowledged_by in its UPDATE, never
-- ack_notified_at. Recorded here so Stage 2's implementation is checked
-- against this exact invariant before Stage 3 is considered safe to build
-- on top of it (this task's own Stage 3 framing says as much explicitly).
--
-- =============================================================================
-- COMPOSITE FK, NOT PLAIN -- WHY, AND WHY IT'S THE 038 PATTERN, NOT 036'S
-- =============================================================================
-- Named in the task as "matching migration 036's pattern" -- checked against
-- the actual file, not assumed: 036 adds NO foreign key at all (timing/
-- timing_raw are plain TEXT/CHECK columns, no REFERENCES clause anywhere in
-- that file). The composite same-tenant FK pattern on THIS table was
-- actually introduced by 038's STEP 0 (hindrances_project_id_fkey /
-- hindrances_reported_by_fkey, both swapped from plain single-column FKs to
-- `FOREIGN KEY (col, tenant_id) REFERENCES parent (id, tenant_id)`) --
-- docs/plans/dash-07-hindrance-queue.md's own "Columns required" section
-- says the same thing in its own words ("acknowledged_by wants the
-- composite same-tenant FK... exactly as migration 038's own review package
-- argued for reported_by"). Flagging the 036-vs-038 naming mismatch here
-- rather than silently building against whichever one actually has the
-- pattern -- if "036" in the task was meant loosely (this whole unit of
-- work, 036/037/038 together, is colloquially "the hindrance-flow
-- migrations"), this is a non-issue; if something else was specifically
-- meant, this is the place to say so before Stage 1 is approved.
--
-- Parent composite unique already exists (017_rls_column_bounding.sql:
-- users_id_tenant_id_key) -- no new UNIQUE constraint needed, matching
-- 038's own STEP 0 comment on this exact point. ON DELETE left at the
-- default (NO ACTION, unspecified) -- matching this table's OTHER two
-- composite FKs (project_id, reported_by), both also left at the default
-- by 038 for the same table. This is a genuine choice, not a copy without
-- thought: acknowledged_by is nullable (unlike reported_by, NOT NULL), so
-- ON DELETE SET NULL was a real alternative -- rejected because a users row
-- is never hard-deleted by any code path in this project today (confirmed
-- by grep: zero `DELETE FROM users` outside test fixture teardown), making
-- this a decision with no live consequence either way; matching the
-- table's existing two FKs was chosen for consistency, not because SET
-- NULL is wrong.
--
-- =============================================================================
-- RLS PRECEDENCE, WORKED THROUGH EXPLICITLY -- THIS IS THE PART EASIEST TO
-- GET WRONG SILENTLY
-- =============================================================================
-- The task's own instruction: "add a stricter project-scoped one... confirm
-- which takes precedence." Postgres RLS policies are PERMISSIVE by default,
-- and multiple PERMISSIVE policies for the same command on the same table
-- are combined with OR -- a row is authorized if ANY permissive policy's
-- USING/CHECK clause passes. hindrances_update (002_rls_policies.sql:
-- 257-260) is PERMISSIVE and already grants UPDATE to every authenticated
-- user in the same tenant, with no project scoping at all. If the new
-- policy below were ALSO added as a plain (permissive) policy, it would
-- have ZERO net effect on who can update a row -- OR-ing a NARROWER
-- permissive clause onto a WIDER one never restricts anything, it can only
-- ever be redundant. "Stricter" only becomes real if the new policy is
-- declared AS RESTRICTIVE: restrictive policies combine with AND against
-- the set of applicable permissive policies, so the EFFECTIVE authorization
-- becomes (tenant-wide permissive) AND (project-scoped restrictive) --
-- genuinely narrower than either alone. This is why the policy below is
-- written `AS RESTRICTIVE`, not left at the (permissive) default -- a
-- second permissive policy here would have been a no-op that LOOKED like a
-- fix.
--
-- WHO the restrictive check authorizes: `project_members.role = 'pm'` for
-- THIS row's project_id -- not `users.role` (the account-level login role).
-- This deliberately matches DASH-07 Phase 1's own established precedent for
-- THIS table (docs/plans/dash-07-hindrance-queue.md's "PM identity --
-- RESOLVED" section: "the read path scopes on project_members.role='pm',
-- NOT users.role"), not migration 027's checkin_escalations precedent
-- (`u.role IN ('pm','admin')`, account-level, explicitly NOT project-
-- scoped) -- the two tables answer different questions. checkin_escalations
-- is internal-management data any manager in the tenant may need to see;
-- a hindrance's acknowledgement is a specific action for the specific
-- project's specific PM, matching the page that will call this write
-- (Stage 2's /hindrances tile, itself scoped to project_members.role='pm'
-- rows only). 'admin' is deliberately NOT included here -- flagging this
-- explicitly rather than silently deciding it: if Aravind wants an admin to
-- also be able to acknowledge on a PM's behalf, this policy's role
-- predicate needs `pm.role IN ('pm', 'admin')` instead of `pm.role = 'pm'`.
--
-- READ/WRITE ASYMMETRY, LEFT AS IS -- FLAGGED, NOT SILENTLY DECIDED. This
-- migration only touches UPDATE, per the task's own scope. hindrances_select
-- remains exactly as it was (002_rls_policies.sql:249-251, tenant-wide, no
-- project scoping at the DB layer) -- Phase 1's page-level project_members
-- filtering is the only thing narrowing SELECT today (docs/plans/
-- dash-07-hindrance-queue.md's own "RLS findings" section already recorded
-- this as accepted, not a gap introduced here). The practical consequence:
-- after this migration, a same-tenant user who is NOT project A's PM can
-- still SELECT project A's hindrances (via the untouched tenant-wide
-- policy, or the app's own service-role reads) but CANNOT UPDATE them (the
-- new RESTRICTIVE policy blocks it) -- read is looser than write. This is
-- consistent with Phase 1's own already-accepted posture, not a new
-- asymmetry this file invents, but worth stating plainly since "add a
-- stricter UPDATE policy" could be misread as "and SELECT already matches
-- it" -- it doesn't, unless a matching SELECT RESTRICTIVE policy is wanted
-- too (not built here -- out of the task's stated scope).
--
-- hindrances_delete IS NOT TOUCHED -- per the task's own explicit
-- instruction ("that's a separate deferred item, out of scope here"). It
-- remains tenant-wide, no project scoping, exactly as docs/plans/
-- dash-07-hindrance-queue.md's own "RLS findings" section already recorded
-- for the migration track.
--
-- service_role is UNAFFECTED by either policy, permissive or restrictive --
-- service_role has BYPASSRLS and does not evaluate table policies at all
-- (confirmed by grep of Supabase's own default role setup and this
-- project's own migration 020/029 headers, which name BYPASSRLS explicitly
-- for exactly this reason).
--
-- =============================================================================
-- CLAUDE.md §0 EXTERNAL REVIEW GATE -- TRIPPED, FLAGGED NOT SILENTLY PASSED
-- OVER. Condition (b): "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN
-- EXISTING OBJECT -- grants, RLS policies..." This migration ADDS a new RLS
-- policy on an EXISTING table (hindrances) -- this is exactly the shape (b)
-- names, "a new table with wrong RLS from day one" language notwithstanding
-- (hindrances is not new, but the POLICY is, on an object real rows already
-- exist in -- one row, per the spec's own "Why this exists" section). Per
-- CLAUDE.md §0, this migration is a candidate for the full external-review
-- package (docs/migration-runbook-template.md's shape), the same process
-- 020/027/029 went through for their own grant/RLS changes. This Stage 1
-- checkpoint (file + diff shown to Aravind, explicit approval required
-- before Stage 2) is being treated as that review for this solo project --
-- named here so it's a stated decision, not an unstated gap, and so a
-- future reader doesn't need to re-derive whether this migration was
-- supposed to get the fuller package.
--
-- =============================================================================
-- RISK CLASS: additive (three new nullable columns, one pairing CHECK, one
-- new composite FK) plus one new RESTRICTIVE RLS policy on an existing
-- table with real (if few) rows. Trips CLAUDE.md §0 condition (b) -- see
-- above. Does not touch (a) function logic, (c) auth/identity, (e) money.
-- Reversible while the acknowledged/ack_notified data is empty (true today
-- -- the table holds a small number of hindrance rows, per Phase 1's own
-- "the table had zero rows before 2026-09-07" starting point, and nothing
-- writes these three new columns until Stage 2/3 ship) -- see the DOWN
-- block's own consequence note for where that stops being true.
-- =============================================================================

BEGIN;

ALTER TABLE hindrances
  ADD COLUMN acknowledged_at TIMESTAMPTZ,
  ADD COLUMN acknowledged_by UUID,
  ADD COLUMN ack_notified_at TIMESTAMPTZ,
  ADD CONSTRAINT hindrances_ack_pairing_check
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  ADD CONSTRAINT hindrances_acknowledged_by_fkey
    FOREIGN KEY (acknowledged_by, tenant_id) REFERENCES public.users (id, tenant_id);

COMMENT ON COLUMN hindrances.acknowledged_at IS
  'DASH-07 Phase 2 (migration 039, 2026-09-08). Set the moment a PM acknowledges this hindrance (Stage 2''s Acknowledge action); NULL means unacknowledged. Set and cleared TOGETHER with acknowledged_by ONLY -- hindrances_ack_pairing_check enforces (acknowledged_at IS NULL) = (acknowledged_by IS NULL) structurally, not by convention. Un-acknowledge clears this column back to NULL; it never touches ack_notified_at (see that column''s own comment for why).';

COMMENT ON COLUMN hindrances.acknowledged_by IS
  'DASH-07 Phase 2 (migration 039, 2026-09-08). The acknowledging PM''s users.id. Composite same-tenant FK (hindrances_acknowledged_by_fkey, (acknowledged_by, tenant_id) -> users(id, tenant_id)) -- same pattern migration 038 established for this table''s project_id/reported_by columns, so a caller cannot pass a real-but-wrong-tenant user id. Nullable; paired with acknowledged_at by hindrances_ack_pairing_check (see that CHECK and acknowledged_at''s own comment).';

COMMENT ON COLUMN hindrances.ack_notified_at IS
  'DASH-07 Phase 2 (migration 039, 2026-09-08). NOT the acknowledgement itself -- whether the hindrance-ack WhatsApp sender (Stage 3, docs/plans/dash-07-hindrance-queue.md''s "send-once marker" section) has told the reporting engineer his PM has seen it. Deliberately excluded from hindrances_ack_pairing_check: it can be NULL while acknowledged_at is set (send pending -- Stage 3''s own trigger condition is acknowledged_at IS NOT NULL AND ack_notified_at IS NULL), and it must NEVER be reset to NULL by an Un-acknowledge write -- that is the entire send-once guarantee against double-notifying an engineer across an acknowledge/un-acknowledge/re-acknowledge cycle. If this column is ever found NULL with no Stage-3 sender built yet, that is the normal "send pending, sender doesn''t exist" state, not a bug -- same posture this table''s own hindrance_type/impact_level/photo_url columns (migration 001) already have as long-unpopulated, intentionally provisioned fields.';

-- -----------------------------------------------------------------------------
-- New RESTRICTIVE, project-scoped UPDATE policy -- ADDED alongside the
-- existing tenant-wide hindrances_update (002_rls_policies.sql:257-260),
-- which is NOT modified or removed by this file. See "RLS PRECEDENCE,
-- WORKED THROUGH EXPLICITLY" above for why this must be RESTRICTIVE, not a
-- second PERMISSIVE policy, to have any actual effect.
-- -----------------------------------------------------------------------------
CREATE POLICY "hindrances_update_project_scoped" ON hindrances
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      -- Same single-lookup-then-join shape as 027's checkin_escalations_select
      -- (auth.uid() -> users row, joined to project_members on that resolved
      -- id) -- not a second subquery for role on top of a first for id.
      SELECT 1
      FROM public.users u
      JOIN public.project_members pm
        ON pm.project_id = hindrances.project_id
       AND pm.user_id = u.id
      WHERE u.auth_id = auth.uid()
        AND pm.role = 'pm'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.project_members pm
        ON pm.project_id = hindrances.project_id
       AND pm.user_id = u.id
      WHERE u.auth_id = auth.uid()
        AND pm.role = 'pm'
    )
  );

COMMIT;

-- =============================================================================
-- DOWN (exact inverse, not applied by this file -- recorded per this
-- project's own migration-file convention, matching 036/038's own DOWN
-- block style):
--
--   DROP POLICY IF EXISTS "hindrances_update_project_scoped" ON hindrances;
--
--   ALTER TABLE hindrances
--     DROP COLUMN acknowledged_at,
--     DROP COLUMN acknowledged_by,
--     DROP COLUMN ack_notified_at;
--
-- NO EXPLICIT DROP CONSTRAINT for hindrances_ack_pairing_check or
-- hindrances_acknowledged_by_fkey -- LEARNED FROM 036's OWN REHEARSAL, NOT
-- RE-DISCOVERED HERE: DROP COLUMN acknowledged_at/acknowledged_by cascades
-- and removes both (the CHECK references both columns; the FK references
-- acknowledged_by) before an explicit DROP CONSTRAINT clause in the same
-- statement would ever run -- 036's own DOWN block failed on exactly this
-- shape once ("hindrances_timing_raw_pairing_check does not exist") for its
-- own pairing CHECK, which is why no explicit drop is written for either
-- constraint here.
--
-- ORDER NOTE: the policy drop is written first, but this is not order-
-- dependent -- the policy's USING/CHECK clauses reference project_id/
-- tenant_id (untouched by this file) and auth.uid()/project_members
-- (unrelated tables), never the three new columns, so dropping the columns
-- first would work identically. Policy-first reads as "undo the
-- authorization change, then the schema change," matching the order this
-- file adds them in.
--
-- CONSEQUENCE, STATED NOT JUST IMPLIED (same documented-loss shape 030/034/
-- 036's own DOWN blocks carry): once Stage 2 ships and real acknowledgements
-- exist, this DOWN destroys them irreversibly -- which PM acknowledged which
-- hindrance, and when, is gone the moment DROP COLUMN runs; there is no
-- separate audit table it lives in. While no code writes these columns
-- (true until Stage 2 ships) this is inert.
-- =============================================================================
