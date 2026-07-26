-- =============================================================================
-- 019_daily_log_corrections.sql
-- Rule 4.3 inline correction (DASH-03) — PM-editable daily_logs SCALAR fields,
-- audit-logged atomically. SCALAR-ONLY v1: the 9 text/boolean/integer columns
-- from 017's grant. The 8 JSONB-array columns are a deliberately deferred pass
-- (different UI problem) and are NOT correctable here — the RPC's column
-- whitelist (and the table CHECK) reject them.
--
-- WHAT THIS ADDS
--   1. daily_log_edits — the audit trail, and the SOURCE OF TRUTH for post-
--      check-in edits (a future dpr_generate handler consumes it; see the DPR
--      hook comment below and docs/bot-flows.md).
--   2. correct_daily_log(...) — a SECURITY DEFINER RPC that performs the
--      daily_logs UPDATE and the audit INSERT in ONE transaction, so we can
--      never end up with a corrected row and a missing audit entry.
--
-- SECURITY MODEL — WHY A DEFINER RPC, NOT A PLAIN SERVER ACTION (read this):
--   The RPC runs as its owner, so it BYPASSES RLS and the 015/017 column grants
--   (exactly like the morning-flow RPC). That is intentional — it is the single
--   controlled write path — but it means EVERY authorization check must be re-
--   implemented in the body; none is inherited from RLS. In particular:
--
--   * SCOPE GAP CLOSED HERE, NOT AT RLS. The daily_logs_update RLS policy
--     (007:282) permits ANY pm/admin/qs to update ANY daily_logs row in their
--     TENANT — broader than what a PM can actually see on DASH-03, which is
--     scoped to their project_members rows (CLAUDE.md §4). This RPC therefore
--     re-checks project membership for the TARGET row's project before writing.
--     This is the same "enforce the invariant at the WRITE, not just the
--     decision/RLS layer" lesson as 015 HIGH-1 and BOT-27's S2 TOCTOU fix.
--
--   * v1 is PM-ONLY, MEMBERSHIP-GATED. admin/qs correction is out of scope for
--     now (they are typically not project_members); widen later behind an
--     explicit decision, never speculatively.
--
--   * TOCTOU. The target row is locked FOR UPDATE before the old value is read,
--     so the recorded old_value is the true pre-image and no interleaving write
--     is lost (S2 lesson again).
--
-- PLAIN FKs — WHY SAFE DESPITE 017's COMPOSITE-FK PRECEDENT (pinned so a future
--   auditor need not re-derive it): 017 added composite same-tenant FKs because
--   those columns are CLIENT-WRITABLE (a raw authenticated client could smuggle a
--   cross-tenant id past single-column FKs). daily_log_edits has NO such path:
--   it is written ONLY by this SECURITY DEFINER RPC, which sets tenant_id (and
--   project_id/log_date) by COPYING them from the already-verified target
--   daily_logs row — never from caller input. There is no app-layer INSERT into
--   this table (authenticated/anon INSERT is revoked below). So a mismatched
--   tenant_id cannot arise, and plain single-column FKs are sufficient.
--
-- RISK CLASS: additive (new table + new function). No existing object altered,
--   no data migrated. Reversible without PITR (DROP TABLE / DROP FUNCTION — see
--   DOWN block). Rehearse on the test-db branch and pass migration-019.test.ts
--   (prove-open-pre-apply / prove-closed-post-apply) BEFORE prod, and get the
--   second-pair-of-eyes review — same tier as 007/015/016/017: this carries a
--   SECURITY DEFINER function and a genuine write path, not app-code only.
--   Regenerate types/database.ts after apply and commit the diff (§6).
--
-- ROUND-1 REVIEW REVISIONS FOLDED (2026-07-26): this file incorporates the eight
--   required changes from round 1 (reviewed-WITH-changes, not approved):
--     1. REVOKE EXECUTE … FROM PUBLIC, anon alongside the GRANT (ACL section).
--     2. ACL comment cites 020's Class-2 convention (not "mirrors complete_onboarding").
--     3. new test T-019-09 — anon-client call rejected at the ACL (the REVOKE).
--     4. NULL/type convention pinned (comment at (i); test T-019-10 clear-to-NULL).
--     5. size guard at the trust boundary (guard (c2), cap 100 KB).
--     6. DPR-hook comment: "latest per (daily_logs_id, column_name)", not "authoritative".
--     7. guard (e) comment cites 017's composite FKs for the membership⇒tenant implication.
--     8. table CHECK comment: the CHECK/CASE whitelist duplication is load-bearing.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Audit table. created_at IS the "when" (§6 — every table has it); no
--    separate edited_at. old_value/new_value are JSONB so the same shape serves
--    both today's scalars and the future JSONB columns (a scalar is stored as a
--    JSON scalar; a cleared scalar is SQL NULL in new_value). project_id +
--    log_date are DENORMALIZED from the target daily_logs row: both are
--    immutable there (017 excludes them from the UPDATE grant), so no drift —
--    and it lets the SELECT policy below be self-contained (no join back to
--    daily_logs) and lets dpr_generate query by (project_id, log_date) directly.
-- -----------------------------------------------------------------------------
CREATE TABLE public.daily_log_edits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  daily_logs_id UUID NOT NULL REFERENCES public.daily_logs(id),
  project_id    UUID NOT NULL REFERENCES public.projects(id),
  log_date      DATE NOT NULL,
  column_name   TEXT NOT NULL CHECK (column_name IN (
    -- the 9 scalar columns from 017's daily_logs grant; TEXT+CHECK per §6.
    -- Widen (not re-type) when JSONB-column editing ships in a later pass.
    -- LOAD-BEARING — DO NOT DROP (review item 8): this CHECK deliberately
    -- DUPLICATES the RPC's CASE whitelist (guard (c)). Two independent gates that
    -- must agree: if a future edit widens the CASE but forgets this CHECK (or vice
    -- versa), the write fails CLOSED — the stricter gate rejects — instead of
    -- silently persisting an un-whitelisted column. The redundancy IS the safety;
    -- do not "simplify" it away.
    'is_holiday', 'holiday_reason', 'weather',
    'morning_plan', 'morning_execution_plan',
    'evening_output', 'evening_schedule_met',
    'evening_schedule_miss_reason', 'evening_workers_on_site'
  )),
  old_value     JSONB,
  new_value     JSONB,
  edited_by     UUID NOT NULL REFERENCES public.users(id),
  source        TEXT NOT NULL DEFAULT 'pm_inline_correction'
                CHECK (source IN ('pm_inline_correction'))
);

CREATE INDEX idx_daily_log_edits_daily_logs_id ON public.daily_log_edits(daily_logs_id);
CREATE INDEX idx_daily_log_edits_project_date  ON public.daily_log_edits(project_id, log_date);

COMMENT ON TABLE public.daily_log_edits IS
  'Audit trail + source of truth for post-check-in PM corrections to daily_logs '
  '(Rule 4.3, migration 019). Written ONLY by correct_daily_log(). DPR HOOK: a '
  'future dpr_generate handler MUST read this by (project_id, log_date) and, per '
  'corrected column, take the LATEST edit per (daily_logs_id, column_name) — '
  'ORDER BY created_at DESC LIMIT 1 — as authoritative over the raw check-in value '
  '(a column can be corrected more than once). See docs/bot-flows.md DPR section.';

-- -----------------------------------------------------------------------------
-- 2. RLS: SELECT only, project-scoped to match DASH-03 read scope. No
--    authenticated/anon INSERT/UPDATE/DELETE policy exists (the only writer is
--    the definer RPC, which bypasses RLS); and the default write grants Supabase
--    hands new tables are stripped, per the 015/017 hardening thesis.
-- -----------------------------------------------------------------------------
ALTER TABLE public.daily_log_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_log_edits_select" ON public.daily_log_edits
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = daily_log_edits.project_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.daily_log_edits FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_log_edits FROM anon;

-- -----------------------------------------------------------------------------
-- 3. correct_daily_log — atomic UPDATE + audit INSERT. Returns the new
--    daily_log_edits.id, or NULL on a no-op (new value equals old — skipped, not
--    recorded). Every guard RAISEs on violation so the whole transaction rolls
--    back; a failed audit INSERT rolls back the daily_logs UPDATE (that atomicity
--    is the entire reason this is one RPC and not two Server-Action writes).
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.correct_daily_log(
  p_daily_logs_id UUID,
  p_column        TEXT,
  p_new_value     JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_editor_id   UUID;
  v_editor_role TEXT;
  v_cast_type   TEXT;
  v_project_id  UUID;
  v_tenant_id   UUID;
  v_log_date    DATE;
  v_old_value   JSONB;
  v_edit_id     UUID;
BEGIN
  -- (a) Resolve the caller's profile (decoupled users.id, post-007). Engineers
  -- have auth_id = NULL / no web login, so this fail-louds for any non-web actor.
  SELECT id, role INTO v_editor_id, v_editor_role
  FROM public.users WHERE auth_id = auth.uid();
  IF v_editor_id IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: no profile for auth.uid()=%', auth.uid()
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) PM-only v1.
  IF v_editor_role <> 'pm' THEN
    RAISE EXCEPTION 'correct_daily_log: role % may not correct logs (PM-only)', v_editor_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) Column whitelist AND per-column cast type, in one CASE. This is what
  -- makes the dynamic format(%I) UPDATE below injection-safe, and enforces
  -- scalar-only-v1 at the DB (a JSONB column, or engineer_id, falls to ELSE).
  v_cast_type := CASE p_column
    WHEN 'is_holiday'                   THEN 'boolean'
    WHEN 'evening_schedule_met'         THEN 'boolean'
    WHEN 'evening_workers_on_site'      THEN 'integer'
    WHEN 'holiday_reason'               THEN 'text'
    WHEN 'weather'                      THEN 'text'
    WHEN 'morning_plan'                 THEN 'text'
    WHEN 'morning_execution_plan'       THEN 'text'
    WHEN 'evening_output'               THEN 'text'
    WHEN 'evening_schedule_miss_reason' THEN 'text'
    ELSE NULL
  END;
  IF v_cast_type IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: column % is not correctable in v1', p_column
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c2) Size guard at the trust boundary (review item 5): a scalar correction is
  -- tiny; cap the jsonb payload so an authenticated PM cannot bloat the daily_logs
  -- row / audit trail with a large value. 100 KB is far above any legit scalar
  -- (a long free-text plan is well under 1 KB) and well below abuse — adjust only
  -- if a real column ever needs more.
  IF pg_column_size(p_new_value) > 100000 THEN
    RAISE EXCEPTION 'correct_daily_log: new_value too large (% bytes, cap 100000)',
      pg_column_size(p_new_value)
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  -- (d) Lock + read the target row (TOCTOU: lock before reading the old value).
  SELECT project_id, tenant_id, log_date
    INTO v_project_id, v_tenant_id, v_log_date
  FROM public.daily_logs WHERE id = p_daily_logs_id
  FOR UPDATE;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: no daily_logs row %', p_daily_logs_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- (e) Tenant assert (defense in depth). NB (review item 7): guard (f)'s
  -- membership check IMPLIES same-tenant ONLY because 017 made project_members's
  -- FKs composite same-tenant ((project_id, tenant_id) -> projects, (user_id,
  -- tenant_id) -> users), so a membership row cannot span tenants. This explicit
  -- assert is the belt to that suspenders — keep it even though (f) implies it;
  -- if 017's composite FKs were ever relaxed, this becomes the sole guard.
  IF v_tenant_id <> get_user_tenant_id() THEN
    RAISE EXCEPTION 'correct_daily_log: cross-tenant target'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (f) *** SCOPE-GAP CLOSURE *** — the calling PM must be a project_member of
  -- the TARGET row's project. RLS does NOT enforce this (it is tenant-wide).
  IF NOT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = v_project_id AND user_id = v_editor_id
  ) THEN
    RAISE EXCEPTION 'correct_daily_log: PM % is not a member of project %', v_editor_id, v_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (g) Old value (row already locked).
  EXECUTE format('SELECT to_jsonb(%I) FROM public.daily_logs WHERE id = $1', p_column)
    INTO v_old_value USING p_daily_logs_id;

  -- (h) No-op: unchanged value is skipped, not recorded.
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN NULL;
  END IF;

  -- NULL / TYPE CONVENTION (review item 4 — the caller/wrapper contract):
  --   * p_new_value is the column's value as JSONB. A JSON scalar must match the
  --     column's NATURAL to_jsonb() output — a boolean column expects JSON
  --     true/false, an integer column a JSON number, a text column a JSON string —
  --     NOT a quoted string for a boolean/int. (The future Server-Action wrapper's
  --     Zod MUST enforce this per-column shape before calling.)
  --   * Passing SQL NULL (not JSON 'null') CLEARS the field: ($1 #>> '{}') is
  --     NULL, so the column is set NULL and the audit row's new_value is NULL.
  --     Covered by the clear-to-NULL happy-path test (T-019-10).
  -- (i) Write the one whitelisted column, coercing jsonb -> the column's base
  -- type (%I is whitelisted, %s is a fixed CASE literal — both safe).
  EXECUTE format(
    'UPDATE public.daily_logs SET %I = ($1 #>> ''{}'')::%s WHERE id = $2',
    p_column, v_cast_type
  ) USING p_new_value, p_daily_logs_id;

  -- (j) Audit row — same transaction, so update+audit are all-or-nothing.
  INSERT INTO public.daily_log_edits (
    tenant_id, daily_logs_id, project_id, log_date,
    column_name, old_value, new_value, edited_by
  ) VALUES (
    v_tenant_id, p_daily_logs_id, v_project_id, v_log_date,
    p_column, v_old_value, p_new_value, v_editor_id
  )
  RETURNING id INTO v_edit_id;

  RETURN v_edit_id;
END;
$$;

-- EXECUTE ACL — 020's Class-2 convention (review items 1 & 2).
-- 020 split the public SECURITY DEFINER functions into two classes; correct_daily_log
-- is Class 2: it derives the caller from auth.uid() and re-checks role + membership
-- IN-BODY, so the ACL is REVOKE-the-default-PUBLIC/anon-grant, GRANT authenticated.
-- The REVOKE is the load-bearing half: without it PostgREST would expose /rpc/
-- correct_daily_log to the anon key (the exact default-PUBLIC-EXECUTE hole 020 closed
-- for the seven pre-existing functions). correct_daily_log is born here, so it gets
-- the same treatment at creation rather than needing a later hardening pass.
-- (The in-body auth.uid() guard is defence-in-depth BEHIND this ACL, not instead of it;
--  T-019-09 asserts the REVOKE at the ACL, T-019-07 asserts the in-body PM-only guard.)
REVOKE EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) TO authenticated;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference — additive migration, no PITR dependency)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.correct_daily_log(UUID, TEXT, JSONB);
--   DROP TABLE IF EXISTS public.daily_log_edits;   -- drops its policy + indexes
-- COMMIT;
-- =============================================================================
