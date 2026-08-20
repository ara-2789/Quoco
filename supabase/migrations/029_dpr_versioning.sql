-- =============================================================================
-- 029_dpr_versioning.sql
-- DPR delivery/versioning, EXERCISABLE HALF (docs/dpr-delivery-versioning-plan.md
-- §2d/§2c). Adds append-only version history for `dprs`, a transactional
-- version-write RPC, and the `comment` column `daily_log_edits` needs for §4b's
-- worked correction example.
--
-- SCOPE, STATED EXPLICITLY (per the split-package sequencing decision,
-- external review, 2026-08-19): this is the EXERCISABLE half only. The
-- pipeline (`lib/dpr/dispatch.ts`, `scripts/generate-one-dpr.ts`) and the
-- `dprs` table this versions already exist and carry real rows, so this half
-- can apply and be verified end-to-end now. It does NOT include:
--   * the dashboard edit surface (§2b) — application code, not a migration
--   * `delivery_status`'s `pm_notified`/`skipped_no_template` widening — BLOCKED
--     on the trigger-cron workstream, ships in 030 alongside owner-email
--   * the owner-email schema chain (§2j) — BLOCKED, own migration, 030
--   * anything from #69's outbound-send primitive — BLOCKED, own migration, 031
--
-- CLAUDE.md §0 GATING ASSESSMENT, condition by condition (§0's own text, not
-- paraphrased):
--   (a) "CREATES OR MODIFIES a live function's LOGIC." TRIPS. `write_dpr_version`
--       (below) is a NEW SECURITY DEFINER function with real write authority
--       over report content — a new function, no prior safe state to fall back
--       on, at least as dangerous as modifying an existing one (§0's own text on
--       this point).
--   (b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING OBJECT."
--       TRIPS. `write_dpr_version` writes `dprs.content`/`current_version`/
--       `generated_by`/`generated_by_user` — an EXISTING, already-live table
--       carrying full report bodies delivered nightly to real customers.
--   (c) "Touches auth or identity." Judgment call, named as one: `generated_by_
--       user` is a `users(id, tenant_id)` composite FK, and the RPC derives it
--       from `auth.uid()` (never caller-trusted input — the exact 020-incident
--       shape this project's own SECURITY DEFINER discipline exists to avoid).
--       Reading: does not trip on the caller-trust axis (parameter is not
--       trusted), but recorded rather than silently assumed clear, since the
--       function does resolve an authenticated identity.
--   (d) "Is destructive or irreversible." Does not trip in the schema sense —
--       purely additive (new table, new columns with defaults, no DROP/DELETE).
--       The RUNTIME behaviour it enables (regeneration producing history rows)
--       is not itself irreversible at the DB level; nothing in this file deletes
--       data. See §2d's own dated-supersession note for the DESIGN reversal
--       this enables (silent-replace → new-version-row), which is a documented
--       decision, not an accidental irreversibility.
--   (e) "Moves money." Does not trip. No billing surface touched.
--   NET: (a) and (b) both trip on the new SECURITY DEFINER function alone —
--   full external-review package required, same path as 028. This IS that
--   package (docs/reviews/029-dpr-versioning-review-package.md).
--
-- PROVENANCE NOTE: migration numbers 028 (dprs.engineer_id) was applied to
-- both databases before this file existed but was never copied into
-- supabase/migrations/ or ledgered — corrected in this same commit as its own,
-- clearly-flagged file-copy (028_dprs_engineer_id_option_a.sql). This file is
-- 029, the next number after that correction, confirmed via `ls
-- supabase/migrations/` immediately before authoring, not carried over from
-- an earlier session.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. dprs: minimal additions for the "latest version" projection.
-- ----------------------------------------------------------------------------
ALTER TABLE public.dprs
  ADD COLUMN current_version INT NOT NULL DEFAULT 1,
  ADD COLUMN generated_by TEXT NOT NULL DEFAULT 'system'
    CHECK (generated_by IN ('system', 'pm')),
  ADD COLUMN generated_by_user UUID NULL;

-- Composite same-tenant FK (017's pattern) — set only when generated_by='pm'.
-- Parent index users(id, tenant_id) already exists since 017
-- (users_id_tenant_id_key) — reused, not re-added.
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_generated_by_user_tenant_id_fkey
    FOREIGN KEY (generated_by_user, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT;

-- generated_by_user must be NULL when generated_by='system', and NOT NULL
-- when generated_by='pm' — a fabricated PM-authored version with no author,
-- or a 'system' version wrongly attributed to a person, are both wrong facts
-- this CHECK makes structurally impossible, not just conventionally avoided.
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_generated_by_user_consistency_check
    CHECK (
      (generated_by = 'system' AND generated_by_user IS NULL) OR
      (generated_by = 'pm' AND generated_by_user IS NOT NULL)
    );

-- ----------------------------------------------------------------------------
-- 2. dpr_versions: NEW, append-only history table.
-- ----------------------------------------------------------------------------
CREATE TABLE public.dpr_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id),
  dpr_id                UUID NOT NULL,
  version               INT NOT NULL,
  generated_by          TEXT NOT NULL CHECK (generated_by IN ('system', 'pm')),
  generated_by_user     UUID NULL,
  content               TEXT NOT NULL,
  structured            JSONB NOT NULL,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_to_owner_at TIMESTAMPTZ NULL,
  UNIQUE (dpr_id, version),
  CONSTRAINT dpr_versions_generated_by_user_consistency_check
    CHECK (
      (generated_by = 'system' AND generated_by_user IS NULL) OR
      (generated_by = 'pm' AND generated_by_user IS NOT NULL)
    ),
  -- Composite same-tenant FK (017's pattern, 027's precedent — applied from
  -- the start here, not found by a second reviewer pass as it was for 028's
  -- own engineer_id FK). Only generated_by_user's FK is inline here —
  -- dpr_versions_dpr_id_fkey is declared separately, below, deliberately
  -- OUT of this CREATE TABLE (see the note there for why).
  CONSTRAINT dpr_versions_generated_by_user_fkey
    FOREIGN KEY (generated_by_user, tenant_id) REFERENCES public.users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);

-- dprs(id, tenant_id) has no UNIQUE parent index yet (dprs' own FKs to
-- tenants/projects are plain single-column, per the pre-existing, documented
-- 023 gap — see this file's own header note above and the review package's
-- §_ for why this migration does not silently fix that separate, unrelated
-- gap). dpr_versions_dpr_id_fkey (below) needs one. Added here, scoped to
-- this table's own need, not a general retrofit of 023's plain FKs.
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_id_tenant_id_key UNIQUE (id, tenant_id);

-- dpr_versions_dpr_id_fkey — ADDED SEPARATELY, NOT INLINE IN THE CREATE
-- TABLE ABOVE (F1, rehearsal round 1 finding, fixed here). The inline
-- version referenced dprs(id, tenant_id) before dprs_id_tenant_id_key (the
-- parent unique constraint it needs) existed anywhere in this transaction —
-- Postgres 42830, "no unique constraint matching given keys," caught live
-- by rehearsal, not by review. FIX SHAPE CHOSEN: declared as its own
-- ALTER TABLE, after both prerequisite objects (dpr_versions itself, and
-- dprs_id_tenant_id_key immediately above) exist — deliberately NOT simply
-- moving the dprs_id_tenant_id_key ALTER earlier instead, which would have
-- been the smaller diff. This shape is more robust to future reordering
-- (a later editor moving CREATE TABLE dpr_versions again cannot silently
-- reintroduce the same 42830, since the FK no longer lives inside it) and
-- reads more explicitly at the point a reviewer is most likely to be
-- checking cross-table dependencies — right where the parent constraint
-- was just created, not buried inside an unrelated table's own definition.
ALTER TABLE public.dpr_versions
  ADD CONSTRAINT dpr_versions_dpr_id_fkey
    FOREIGN KEY (dpr_id, tenant_id) REFERENCES public.dprs (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE;

CREATE INDEX idx_dpr_versions_dpr_id ON public.dpr_versions (dpr_id, version);

ALTER TABLE public.dpr_versions ENABLE ROW LEVEL SECURITY;

-- RLS, audience-scoped, matching dprs_select's own shape (023) exactly —
-- tenant + project_members join, PM-only, no owner-readable policy (owners
-- have no web login, auth_id NULL, get_user_tenant_id() has nothing to key
-- off for them regardless of channel).
CREATE POLICY "dpr_versions_select" ON public.dpr_versions
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.dprs d
      JOIN public.project_members pm ON pm.project_id = d.project_id
      WHERE d.id = dpr_versions.dpr_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.dpr_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dpr_versions FROM anon;
REVOKE ALL ON public.dpr_versions FROM anon;

COMMENT ON TABLE public.dpr_versions IS
  'Append-only DPR generation history. One row per regeneration (system or PM-'
  'triggered). dprs.content/structured/current_version stay a denormalized '
  '"latest" projection for fast reads; this table is the source of truth for '
  'history. "Which version was delivered to the owner" is answered by whichever '
  'row has delivered_to_owner_at set. Written ONLY via write_dpr_version() — '
  'never a direct INSERT from application code.';

-- ----------------------------------------------------------------------------
-- 3. write_dpr_version: the transactional version-write RPC.
--
-- Mirrors correct_daily_log's (019) single-transaction guarantee: the UPDATE
-- to dprs and the INSERT into dpr_versions happen in one function body, so a
-- regeneration can never update dprs but fail to record history (or the
-- reverse) — the two are not two round trips from application code.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_dpr_version(
  p_dpr_id UUID,
  p_content TEXT,
  p_structured JSONB,
  p_generated_by TEXT,
  p_generated_by_user UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_new_version INT;
  v_version_id UUID;
BEGIN
  IF p_generated_by NOT IN ('system', 'pm') THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by must be system or pm, got %', p_generated_by
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_generated_by = 'pm' AND p_generated_by_user IS NULL THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by_user is required when p_generated_by=pm'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_generated_by = 'system' AND p_generated_by_user IS NOT NULL THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by_user must be NULL when p_generated_by=system'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the target row before reading current_version — a concurrent
  -- regeneration (two jobs racing, or a PM regenerating while the nightly
  -- job also fires) must not both compute the same "next version" number.
  SELECT tenant_id, current_version + 1
    INTO v_tenant_id, v_new_version
  FROM public.dprs
  WHERE id = p_dpr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'write_dpr_version: no dprs row for id=%', p_dpr_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- When p_generated_by='pm', the caller's own users row must belong to the
  -- SAME tenant as the target dprs row — derived from auth.uid(), never
  -- trusted from caller input (the 020-incident shape this project's own
  -- SECURITY DEFINER discipline exists to avoid). A 'system' write (the
  -- nightly job, service_role) has no auth.uid() session to check against.
  IF p_generated_by = 'pm' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = p_generated_by_user
        AND u.auth_id = auth.uid()
        AND u.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'write_dpr_version: p_generated_by_user does not match the calling PM''s own tenant-scoped identity'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO public.dpr_versions (
    tenant_id, dpr_id, version, generated_by, generated_by_user,
    content, structured
  ) VALUES (
    v_tenant_id, p_dpr_id, v_new_version, p_generated_by, p_generated_by_user,
    p_content, p_structured
  )
  RETURNING id INTO v_version_id;

  UPDATE public.dprs
  SET content = p_content,
      structured = p_structured,
      current_version = v_new_version,
      generated_by = p_generated_by,
      generated_by_user = p_generated_by_user,
      last_regenerated_at = now()
  WHERE id = p_dpr_id;

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated, service_role;
-- authenticated CAN call this (a PM regenerating from the dashboard, once
-- §2b's edit surface exists) — the function's own auth.uid() check above is
-- the real boundary, not the grant. service_role calls it for the nightly
-- 'system' generation path (dispatch.ts).

-- ----------------------------------------------------------------------------
-- 4. daily_log_edits.comment — the column §4b's worked example needs.
--    Additive; rides in this migration since both are the same delivery-
--    versioning feature and both need the same review pass.
-- ----------------------------------------------------------------------------
ALTER TABLE public.daily_log_edits
  ADD COLUMN comment TEXT NULL;

-- ----------------------------------------------------------------------------
-- 5. 023's COMMENT ON TABLE dprs — two corrections in one pass, named
--    together so the second isn't missed while fixing the first.
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.dprs IS
  'One row per (project_id, engineer_id, log_date) — CORRECTED 029: was '
  '(project_id, log_date), stale since migration 028 widened the key and '
  'nobody updated this comment then. The aggregated, Claude-generated Daily '
  'Progress Report, current-version projection. REVERSED 029 (was "UPSERT '
  'target for regeneration, silent replace, never a new version row per '
  'bot-flows.md"): regeneration now writes a NEW dpr_versions row via '
  'write_dpr_version() — dprs.content/structured/current_version are a '
  'denormalized "latest" projection, dpr_versions is the source of truth for '
  'history. See docs/dpr-delivery-versioning-plan.md §2d and bot-flows.md''s '
  'own dated supersession note at "Late data before 9 PM owner send". '
  'generation_status and delivery_status remain ORTHOGONAL lifecycles (one '
  'tracks the compute job, one tracks the owner-send state) — do not collapse '
  'them into one column or couple their transitions.';

COMMIT;

-- DRY-RUN VERIFIED, TWICE, UNDER TWO METHODOLOGIES (2026-08-20, F1/F3, then
-- G1/G2, CLAUDE.md §7's standing rule): after the F1 statement-order fix,
-- this file ran cleanly, end to end (BEGIN through COMMIT, every statement,
-- no error), first against a hand-built scaffold on PostgreSQL 16 (retired
-- as circular by G1 — it could only ever agree with itself), then again
-- against a REAL structural dump of test-db's actual schema
-- (`supabase db dump --linked --schema public`, loaded via a local `pg_dump`
-- since no Docker was available) on PostgreSQL 17 (matching prod/test-db's
-- own 17.6, confirmed via `SELECT version()` on both — G2). Only the two
-- named stubs §7 documents (`auth.users`/`auth.uid()`, and the roles the
-- dump's own GRANT/REVOKE/OWNER TO statements reference) were added by
-- hand; everything else — including `dprs`, `daily_log_edits`, and every
-- constraint this file's own `ADD CONSTRAINT`/FK statements depend on — came
-- from the real database, not from a re-derivation of what this file
-- expects to find. This is NOT the test-db rehearsal and does not
-- substitute for it; the real rehearsal (Phases 0-6) against test-db is its
-- own, separately-confirmed step, not run again in this same pass.
