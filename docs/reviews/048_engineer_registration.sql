-- =============================================================================
-- 048_engineer_registration.sql   *** HELD in docs/reviews/ -- NOT YET APPLIED ***
-- Add-engineer screen, SLICE 1 of 2 (docs/plans/add-engineer-plan.md at caab70b,
-- rev13). Moves into supabase/migrations/ ONLY in the commit/session that applies
-- it (CLAUDE.md §6). No apply GO exists. See docs/reviews/048-review-package.md.
--
-- WHAT THIS ADDS (plan §6, items (1) (2) (3) (4) (6) -- nothing beyond them)
--   1. users.registered_by / registered_at / consent_attested -- all NULLable, with
--      a three-column PAIRING CHECK (all NULL together, or all set together).
--   2. The attribution FK (registered_by, tenant_id) -> users (id, tenant_id),
--      ON UPDATE NO ACTION ON DELETE RESTRICT, both actions written out (plan
--      §2.8a: a durable record of who put a person on the production sender is
--      never cascaded away or blanked).
--   3. The six-role CHECK on project_members.role, mirroring users_role_check
--      (plan §4.5 item 1, D8/D11). The RLS insert policy places no restriction
--      on the role VALUE of the inserted row today.
--   4. engineer_admin_gate(uuid) -- the shared authorisation helper (plan §2.7).
--      Internal: callable by NO role but its owner.
--   5. add_engineers_to_project(uuid, jsonb, boolean, boolean) -> jsonb -- the
--      SECURITY DEFINER add function, with its dry-run flag (plan §2.1-§2.3).
--   6. Their EXECUTE grants, per role BY NAME (CLAUDE.md §6).
--
-- WHAT THIS DELIBERATELY DOES NOT ADD (slice 2 / deferred, plan §4.8, §6)
--   no partial unique index, no engineer_episodes table, no deactivate/reactivate,
--   no deactivated_* columns (D10 reversed), no change to any existing function.
--
-- REVIEW GATE (CLAUDE.md §0): TRIPPED on (a) new SECURITY DEFINER function logic,
--   (b) grants + SECURITY DEFINER status + a new CHECK on an RLS-governed table,
--   (c) auth/identity (resolves the caller from auth_id), and (d) the DOWN drops
--   columns holding attribution data (destructive). FULL TIER.
--
-- RISK CLASS: additive on the way up (nullable columns, new constraints that hold
--   for every existing row, new functions). The DOWN is NOT free: dropping the
--   columns destroys attribution data, and dropping the functions while the
--   deployed app still calls them breaks the add screen. Deploy order: MERGE is
--   the deploy -- 048 -> test-db -> CI -> 048 -> prod -> THEN merge. Rollback:
--   revert commit first, THEN this file's DOWN block.
--
-- IDENTITY RESOLUTION: the caller is resolved ONLY by users.auth_id matched to the
--   Supabase auth uid (007). The auth uid is never compared to users.id -- the
--   class scripts/lint-rules/no-auth-uid-as-users-id.mjs exists to catch. Any
--   prose about that class lives in these -- comments: the lint strips only
--   line comments, so it must never appear in a string literal or block comment.
--
-- CONVENTIONS FOLLOWED (each a real incident class in this repo)
--   * SECURITY DEFINER SET search_path = public, no pg_temp, every object schema-
--     qualified, no dynamic SQL (all 15 existing definer functions, plan §2.7).
--   * REVOKE ... FROM PUBLIC is NOT enough on Supabase: default privileges grant
--     EXECUTE to anon, authenticated and service_role INDIVIDUALLY, so each is
--     revoked BY NAME (020, 029, CLAUDE.md §6).
--   * Both functions are NEW: no signature is being changed, so the CREATE OR
--     REPLACE / overload hazard (CLAUDE.md §0) has nothing to bite yet. Slice 2's
--     redefinition must keep add_engineers_to_project's exact argument type list;
--     the apply record pins it (plan §6, S6) so that can be SHOWN.
--   * A NULL boolean is never defaulted to a value (plan §2.3, S4): a NULL consent
--     raises, and so does a NULL dry-run flag -- a NULL there would otherwise read
--     as "not a dry run" and WRITE. (The dry-run guard is the one check here that
--     the plan's prose does not list by name; it is the same class as S4.)
--
-- ASSUMED NAMES (plan §6: file name ASSUMED; the helper's name is not fixed by the
--   plan at all): engineer_admin_gate, users_registered_pairing_chk (the name the
--   plan's observed 23514 carries), users_registered_by_fkey (027's pattern),
--   project_members_role_check (Postgres's own default name for a column CHECK).
--
-- payload contract of add_engineers_to_project: idx is the ZERO-BASED position in
--   p_engineers. Status values are machine identifiers, never wording. Fields per
--   status are exactly plan §2.1's table; number_registered carries idx + status
--   and nothing else.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Attribution columns on users (plan §2.8). No inline REFERENCES: the FK is a
--    composite, added as its own constraint below.
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN registered_by    uuid,
  ADD COLUMN registered_at    timestamptz,
  ADD COLUMN consent_attested boolean;

-- Pairing CHECK: all three NULL together (every legacy row), or all three set.
-- A registered_by beside a NULL consent_attested is rejected 23514 -- the second
-- layer behind the function's own NULL raise (plan §2.3, S4).
ALTER TABLE public.users
  ADD CONSTRAINT users_registered_pairing_chk CHECK (
    (registered_by IS NULL) = (registered_at IS NULL)
    AND (registered_by IS NULL) = (consent_attested IS NULL)
  );

-- -----------------------------------------------------------------------------
-- 2. The attribution FK, actions explicit (plan §2.8a). Composite same-tenant FK,
--    017's pattern; its parent key users_id_tenant_id_key (UNIQUE (id, tenant_id))
--    has existed since 017. RESTRICT: an admin who registered engineers is not
--    deletable while they stand. Not CASCADE (would delete every engineer they
--    registered), not SET NULL (would erase the record and break the pairing CHECK).
--    Fixture teardown covers this edge with action 'delete' in
--    scripts/shared-fixture-fk-coverage.json (plan §2.8b), same commit as this file.
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD CONSTRAINT users_registered_by_fkey
  FOREIGN KEY (registered_by, tenant_id)
  REFERENCES public.users (id, tenant_id)
  ON UPDATE NO ACTION
  ON DELETE RESTRICT;

-- -----------------------------------------------------------------------------
-- 3. project_members.role CHECK -- exactly the live users_role_check set (D8/D11).
--    Not a narrowing of who may hold a membership: that is a product decision.
--    Fails and aborts the whole file (no change) if prod holds a role outside the
--    six -- plan §11 query n2 is the pre-apply check.
-- -----------------------------------------------------------------------------
ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_role_check CHECK (
    role IN ('pm', 'qs', 'engineer', 'owner', 'subcontractor', 'admin')
  );

-- -----------------------------------------------------------------------------
-- 4. engineer_admin_gate -- the shared authorisation helper (plan §2.3 steps 1-3,
--    §2.7). Returns the caller's users.id and the PROJECT's tenant (tenant_id is
--    derived from the project row, never a parameter -- §2.4).
--    Failure codes, in order: no profile / no auth_id match -> insufficient_privilege;
--    project missing OR in another tenant (or caller tenant NULL) -> no_data_found,
--    ONE indistinguishable error (NULL-safe via IS DISTINCT FROM -- the precedent
--    at 019 uses <>, which a NULL tenant silently passes); caller role not
--    admin/pm, or a pm without a pm membership on this project -> insufficient_privilege.
--    The gate is the intersection of the RLS insert policy's role list and per-
--    project membership (plan §1, D6). qs / engineer / NULL-role callers never pass.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.engineer_admin_gate(p_project_id uuid)
RETURNS TABLE (o_caller_id uuid, o_tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  v_caller_tenant  uuid;
  v_project_tenant uuid;
BEGIN
  -- (1) Resolve the caller: users.auth_id, never users.id (007). Engineers and
  -- owners have auth_id NULL, so they can never match.
  SELECT u.id, u.role, u.tenant_id
    INTO v_caller_id, v_caller_role, v_caller_tenant
  FROM public.users u
  WHERE u.auth_id = auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'engineer_admin_gate: no profile for caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (2) Load the project and tenant-bind, NULL-safe. This single comparison is the
  -- only tenant-binding mechanism (T1). projects.tenant_id is NOT NULL, so a NULL
  -- here means the row was not found.
  SELECT p.tenant_id INTO v_project_tenant
  FROM public.projects p
  WHERE p.id = p_project_id;
  IF NOT FOUND OR v_project_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'engineer_admin_gate: project not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- (3) Role / authority gate (plan §1).
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'pm') THEN
    RAISE EXCEPTION 'engineer_admin_gate: role may not manage engineers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_caller_role = 'pm' AND NOT EXISTS (
    SELECT 1 FROM public.project_members m
    WHERE m.project_id = p_project_id
      AND m.user_id = v_caller_id
      AND m.role = 'pm'
  ) THEN
    RAISE EXCEPTION 'engineer_admin_gate: pm is not a pm on this project'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY SELECT v_caller_id, v_project_tenant;
END;
$$;

-- Internal helper: NO role may call it. FROM PUBLIC alone is not enough (the
-- default privileges grant anon, authenticated, service_role individually), so all
-- four are named. The GRANT to postgres below satisfies scripts/lint-migrations.mjs
-- Rule 1 (every SECURITY DEFINER function needs a REVOKE and a GRANT) and changes
-- the effective ACL not at all -- postgres already owns the function -- so this
-- helper is NOT callable by any other role.
REVOKE EXECUTE ON FUNCTION public.engineer_admin_gate(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.engineer_admin_gate(uuid) TO postgres;

-- -----------------------------------------------------------------------------
-- 5. add_engineers_to_project -- plan §2.1-§2.6. One transaction; any exception
--    rolls back everything. Authorisation runs BEFORE any number lookup, in both
--    modes (T8); apply re-runs every classification and never trusts a preview.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.add_engineers_to_project(
  p_project_id         uuid,
  p_engineers          jsonb,
  p_dry_run            boolean,
  p_consent_attested   boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id          uuid;
  v_tenant_id          uuid;
  v_count              integer;
  v_ord                bigint;
  v_elem               jsonb;
  v_name               text;
  v_number             text;
  v_names              text[] := '{}';
  v_numbers            text[] := '{}';
  v_existing           record;
  v_status             text;
  v_other_project_name text;
  v_row                jsonb;
  v_rows               jsonb := '[]'::jsonb;
  v_all_ok             boolean := true;
  v_user_id            uuid;
  i                    integer;
BEGIN
  -- Steps 1-3: resolve caller, load + tenant-bind the project, role gate.
  SELECT g.o_caller_id, g.o_tenant_id
    INTO v_caller_id, v_tenant_id
  FROM public.engineer_admin_gate(p_project_id) g;

  -- Step 4: validate the argument. Both booleans must be stated: a NULL consent
  -- is a caller bug (S4) and a NULL dry-run flag would read as "not a dry run".
  IF p_consent_attested IS NULL THEN
    RAISE EXCEPTION 'add_engineers_to_project: p_consent_attested must be stated'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'add_engineers_to_project: p_dry_run must be stated'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_engineers IS NULL OR jsonb_typeof(p_engineers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'add_engineers_to_project: p_engineers must be an array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_count := jsonb_array_length(p_engineers);
  IF v_count < 1 OR v_count > 50 THEN
    RAISE EXCEPTION 'add_engineers_to_project: 1 to 50 rows required, got %', v_count
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  FOR v_ord, v_elem IN
    SELECT e.ord, e.elem
    FROM jsonb_array_elements(p_engineers) WITH ORDINALITY AS e(elem, ord)
    ORDER BY e.ord
  LOOP
    IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_elem -> 'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_elem -> 'whatsapp_number') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'add_engineers_to_project: row % is not {name, whatsapp_number}', v_ord - 1
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_name   := btrim(v_elem ->> 'name', E' \t\r\n');
    v_number := v_elem ->> 'whatsapp_number';
    IF v_name = '' OR char_length(v_name) > 100 THEN
      RAISE EXCEPTION 'add_engineers_to_project: row % has an invalid name', v_ord - 1
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    -- Generic stored shape only (plan §3.6, ACCEPTED LIMIT): the India-only rule
    -- lives in TypeScript, not here.
    IF v_number !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'add_engineers_to_project: row % has an invalid number shape', v_ord - 1
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_number = ANY (v_numbers) THEN
      RAISE EXCEPTION 'add_engineers_to_project: row % repeats a number', v_ord - 1
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_names   := v_names || v_name;
    v_numbers := v_numbers || v_number;
  END LOOP;

  -- Step 5: classify every row. Lookups are on the NUMBER (users_whatsapp_number_key),
  -- never on an index this slice does not have (plan §4, R5-R7a). This function
  -- bypasses RLS, so every cross-tenant answer is the generic number_registered:
  -- exactly {idx, status} -- never a project id, project name or full name (T5).
  FOR i IN 1 .. v_count LOOP
    v_number := v_numbers[i];
    v_row := jsonb_build_object('idx', i - 1);

    SELECT u.id, u.tenant_id, u.role
      INTO v_existing
    FROM public.users u
    WHERE u.whatsapp_number = v_number;

    IF NOT FOUND THEN
      v_status := 'ok';
    ELSIF v_existing.tenant_id IS DISTINCT FROM v_tenant_id
          OR v_existing.role IS DISTINCT FROM 'engineer' THEN
      v_status := 'number_registered';
    ELSIF EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.user_id = v_existing.id AND m.project_id = p_project_id
    ) THEN
      v_status := 'already_on_this_project';
    ELSE
      -- Same-tenant engineer, not on this project: on another project of the
      -- caller's own tenant (name only), or on none.
      SELECT pr.name INTO v_other_project_name
      FROM public.project_members m
      JOIN public.projects pr ON pr.id = m.project_id
      WHERE m.user_id = v_existing.id
        AND pr.tenant_id = v_tenant_id
      ORDER BY pr.name, pr.id
      LIMIT 1;
      IF FOUND THEN
        v_status := 'on_another_project';
        v_row := v_row || jsonb_build_object('other_project_name', v_other_project_name);
      ELSE
        v_status := 'registered_no_project';
      END IF;
    END IF;

    v_row := v_row || jsonb_build_object('status', v_status);
    IF v_status <> 'ok' THEN
      v_all_ok := false;
    END IF;
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  -- Step 6: a dry run, or any row that is not ok, writes NOTHING.
  IF p_dry_run OR NOT v_all_ok THEN
    RETURN jsonb_build_object('applied', false, 'rows', v_rows);
  END IF;

  -- Step 7: insert per row. Every column whose default or NULL would hide a bug
  -- is written explicitly (plan §2.6). tenant_id comes from the project row;
  -- registered_by is the RESOLVED caller's users.id; consent is recorded exactly
  -- as passed. A concurrent add of the same number loses on users_whatsapp_number_key
  -- (23505) and rolls the whole batch back.
  v_rows := '[]'::jsonb;
  FOR i IN 1 .. v_count LOOP
    INSERT INTO public.users (
      tenant_id, role, status, full_name, whatsapp_number,
      messaging_blocked, auth_id,
      registered_by, registered_at, consent_attested
    ) VALUES (
      v_tenant_id, 'engineer', 'active', v_names[i], v_numbers[i],
      false, NULL,
      v_caller_id, now(), p_consent_attested
    )
    RETURNING id INTO v_user_id;

    INSERT INTO public.project_members (tenant_id, project_id, user_id, role)
    VALUES (v_tenant_id, p_project_id, v_user_id, 'engineer');

    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('idx', i - 1, 'status', 'added', 'user_id', v_user_id)
    );
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'rows', v_rows);
END;
$$;

-- Public function: REVOKE from PUBLIC and, BY NAME, anon and service_role; GRANT to
-- authenticated (Class 2 in 020's convention -- the caller is derived and re-checked
-- in the body, the ACL is defence-in-depth in front of it, not instead of it).
REVOKE EXECUTE ON FUNCTION public.add_engineers_to_project(uuid, jsonb, boolean, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_engineers_to_project(uuid, jsonb, boolean, boolean)
  TO authenticated;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- ORDER OF OPERATIONS AT ROLLBACK: revert the app commit FIRST (merged, deployed),
-- THEN run this. Run first, it drops functions and columns the deployed add screen
-- still calls. The column drop DESTROYS attribution data (registered_by,
-- registered_at, consent_attested) for every engineer added since apply -- there is
-- no other record of who created them (plan §2.8).
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.add_engineers_to_project(uuid, jsonb, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.engineer_admin_gate(uuid);
--
-- ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
--
-- ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_registered_by_fkey;
-- ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_registered_pairing_chk;
-- ALTER TABLE public.users
--   DROP COLUMN IF EXISTS consent_attested,
--   DROP COLUMN IF EXISTS registered_at,
--   DROP COLUMN IF EXISTS registered_by;
--
-- COMMIT;
