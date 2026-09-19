-- 048 apply-record fingerprint (review condition S6, plus plan §2.8a's FK pin). READ-ONLY: catalog SELECTs only.
-- Run on test-db AND on prod (target ref named, supabase/.temp/project-ref printed and compared first), each
-- with its query text visible above its result in the apply record. Never run against a target whose ref was
-- not named. The block below was executed on the disposable scaffold to prove it runs; the scaffold's values
-- are NOT the record -- the record is what these queries return on test-db and on prod at apply time.
--
-- Slice 2's package re-runs the SAME queries after its CREATE OR REPLACE and must show: count still 1, an
-- identical type list, identical grants, and the body delta (recorded md5 vs new). Re-probe live first: a
-- recorded hash is a baseline, not the thing (CLAUDE.md §0).

-- F1. The exact parameter list, as the catalog renders it. Compare on the TYPE LIST with spaces removed:
--     add_engineers_to_project(uuid, jsonb, boolean, boolean); engineer_admin_gate(uuid).
SELECT p.proname,
       oidvectortypes(p.proargtypes)   AS arg_type_list,
       p.oid::regprocedure::text       AS regprocedure
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;

-- F2. pg_proc count per name in public. Expected: exactly 1 each. A 2 means a second overload exists.
SELECT p.proname, count(*) AS n
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
GROUP BY p.proname
ORDER BY p.proname;

-- F3. Body and definition hashes, owner, SECURITY DEFINER, proconfig, ACL.
--     md5(pg_get_functiondef) is beyond the ask: prosrc alone misses SECURITY DEFINER / search_path, and
--     lint-migrations.mjs Rule 10 already asks a redefinition for a pg_get_functiondef baseline.
SELECT p.proname,
       md5(p.prosrc)                          AS md5_prosrc,
       length(p.prosrc)                       AS len_prosrc,
       md5(pg_get_functiondef(p.oid))         AS md5_functiondef,
       length(pg_get_functiondef(p.oid))      AS len_functiondef,
       pg_get_userbyid(p.proowner)            AS owner,
       p.prosecdef                            AS security_definer,
       p.proconfig::text                      AS proconfig,
       p.proacl::text                         AS proacl
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;

-- F4. EXECUTE, per role, by name (has_function_privilege) -- the readback that catches a per-role default grant.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       has_function_privilege('postgres',      p.oid, 'EXECUTE') AS postgres,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS public_pseudo_role
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;

-- F5. The attribution FK's actions (plan §2.8a) and the two new CHECKs.
--     Expected for users_registered_by_fkey: confdeltype 'r' (RESTRICT), confupdtype 'a' (NO ACTION),
--     confmatchtype 's' (SIMPLE). A bare REFERENCES reads confdeltype 'a', so this pin discriminates.
SELECT c.conrelid::regclass::text AS on_table, c.conname, c.contype,
       c.confdeltype, c.confupdtype, c.confmatchtype,
       c.conkey::text AS conkey, c.confkey::text AS confkey,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conname IN ('users_registered_by_fkey', 'users_registered_pairing_chk', 'project_members_role_check')
ORDER BY c.conname;

-- F6. The three new columns (all nullable, no default) and their comments (a teardown verifies comments too,
--     CLAUDE.md §7: 048 adds no COMMENT ON, so these must read NULL).
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr,
       col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.users'::regclass
  AND a.attname IN ('registered_by', 'registered_at', 'consent_attested')
  AND NOT a.attisdropped
ORDER BY a.attname;
