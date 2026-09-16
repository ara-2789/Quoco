-- =============================================================================
-- 047_revoke_unused_table_rights.sql
--
-- HELD, NOT APPLIED. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, this file stays in docs/reviews/ until an apply actually happens.
-- Per Aravind's explicit instruction (D6): external review -> test-db ->
-- CI -> merge -> PITR -> prod. This pass writes the migration and its
-- review package (docs/reviews/047-review-package.md) only -- no apply to
-- any database, test-db included.
--
-- TRIPS CLAUDE.md's own external review gate on condition (b): grants and
-- RLS policy changes on existing objects.
--
-- PURPOSE. Supabase's project-level default ACL grants anon and
-- authenticated TRUNCATE, TRIGGER, REFERENCES, and DELETE on every new
-- public-schema table the moment it's created (and, on Postgres 17+,
-- MAINTAIN too) -- regardless of whether the application ever uses those
-- privileges through PostgREST or any other path. Every one of them is
-- unused today: TRUNCATE/TRIGGER/REFERENCES/MAINTAIN have no PostgREST
-- verb at all (confirmed: T-023-07's own tracked-gap note in
-- test/migration-023.test.ts, and this migration's own review package),
-- and DELETE is exercised ONLY by RLS-gated `authenticated` sessions
-- through the 17 delete policies this file drops (never by application
-- code -- see below).
--
-- DECISIONS (Aravind, 2026-09-16, settled):
--   D1. Revoke TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN (addendum,
--       2026-09-16) from anon and authenticated on every table in schema
--       public.
--   D2. Revoke DELETE from anon and authenticated on every table in schema
--       public, and DROP the 17 DELETE-command RLS policies this leaves
--       dead (D2's own prose calls this "the 16 delete policies," but its
--       own listed names, and the live policy count captured in this
--       migration's own review package step 1, are both 17 -- a count
--       label, not a set mismatch; every name in D2's list matches a real
--       policy 1:1).
--   D3. ALTER DEFAULT PRIVILEGES in schema public so new tables do not
--       grant TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, or DELETE to anon
--       or authenticated -- scoped to FOR ROLE postgres only (see below).
--   D4. A DB-level test (test/db-level/047-no-unused-table-rights.test.ts)
--       extends the no-delete guard: no public table grants DELETE/
--       TRUNCATE/TRIGGER/REFERENCES/MAINTAIN to anon or authenticated, and
--       no polcmd 'd' policy exists in public.
--   D5. anon SELECT cleanup is OUT of scope (backlog). SELECT/INSERT/
--       UPDATE for any role is untouched by this file.
--   D6. service_role is NEVER touched by this file.
--
-- THE INSIDE-COMPANY RISK THIS CLOSES. T-023-07's own review record
-- (docs/reviews/023-review-package.md §3) already demonstrated the risk
-- directly, not hypothetically: `SET ROLE anon; TRUNCATE public.dprs`
-- actually destroyed a seeded row on test-db (rows_before=1, rows_after=0,
-- rolled back). TRUNCATE/DELETE bypass RLS's row-level filtering entirely
-- (TRUNCATE always; a raw DELETE only reads RLS if the caller goes through
-- a path that applies it) -- so the real blast radius of these grants is
-- not "an external attacker with an anon key," it is anyone (or any
-- compromised/misconfigured client) able to construct a raw SQL connection
-- as anon or authenticated. This migration's own review package step 1
-- capture also found a NARROWER, concrete instance of exactly this
-- exposure: 6 tables (daily_logs, jobs, processed_messages, rate_catalog,
-- rate_catalog_history, tenants) hold a table-level DELETE grant for
-- authenticated with NO delete RLS policy behind it at all -- currently
-- inert only because RLS is enabled and blocks the operation by default,
-- but a live grant with nothing but RLS standing behind it is exactly the
-- shape CLAUDE.md's own "a correct RLS policy does not make an unnecessary
-- grant harmless" principle (§6) warns against.
--
-- WHAT THIS DOES NOT DO.
--   * D5: anon's remaining SELECT/INSERT/UPDATE surface is untouched --
--     out of scope, tracked as backlog, not silently folded in here.
--   * No function EXECUTE grants are touched (backlog, named in this
--     migration's own review package: new functions in public are still
--     EXECUTE-able by anon/authenticated by default via Postgres's
--     postgres-role default ACL; every migration since 020 has revoked
--     this by hand, per-function, at CREATE time -- changing that default
--     is out of 047's scope).
--   * No sequence USAGE grants are touched (same reasoning; sequences are
--     rwU by default, never assessed here).
--   * service_role is never touched (D6) -- including on test-db, where
--     scripts/test-db-only-grants.sql deliberately grants service_role
--     DELETE on outbound_sends/daily_log_photos for test cleanup only,
--     a documented, standing exception (CLAUDE.md's own "OUTBOUND_SENDS'
--     GRANTS NOW DIFFER BETWEEN TEST-DB AND PROD" rule) that this
--     migration does not touch, alter, or need to reconcile.
--
-- NO APPLICATION CODE DELETES VIA A USER SESSION -- INDEPENDENTLY VERIFIED,
-- NOT ASSUMED. `grep -rn "\.delete(" lib app --include='*.ts' --include='*.tsx'`
-- returns exactly four hits, all four `requiredList.delete(...)` calls on a
-- plain JS Set in lib/dpr/generate.ts -- zero real `.from(<table>).delete(`
-- database calls anywhere in lib/ or app/, via ANY client (service_role,
-- authenticated, or anon). This is stronger than "no user-session delete" --
-- there is no application-code delete AT ALL; every real delete call in
-- this codebase lives in test/ cleanup helpers. test/unit/no-app-delete-
-- invariant.test.ts exists and is cited here for completeness, but its
-- actual scope is narrower than this claim: it is a static guard for
-- exactly two tables (outbound_sends, daily_log_photos) where service_role
-- itself has a test-db-only DELETE divergence from prod -- it does not
-- generally assert "no app code deletes," which is why the grep result
-- above, not that test, is this file's own evidence for that claim.
--
-- TEST IMPACT -- ZERO TESTS BREAK. Full grep of test/ for `.delete(`:
-- every hit resolves to `testClient()` (service_role, D6, never touched)
-- EXCEPT ONE -- test/migration-023.test.ts:210, `jwtA.from('dprs').delete()`
-- -- a real authenticated-session client. That test ALREADY expects
-- `error.code === '42501'` (permission denied), because `authenticated`
-- already lacks a DELETE grant on `dprs` today (confirmed live, this
-- migration's own review package step 1) -- this migration does not change
-- that table's behaviour at all. No `truncate`/`CREATE TRIGGER` usage
-- exists anywhere in test/ (TRUNCATE/TRIGGER have no PostgREST verb, same
-- reasoning as T-023-07). Full detail, file-by-file: this migration's own
-- review package, step 2.
--
-- STALE COMMENT, FLAGGED NOT FIXED HERE. test/migration-023.test.ts's own
-- T-023-07 `it.todo` comment claims this exact gap "closes via migration
-- 024" -- factually wrong (024_evening_flow_q4_q5.sql is an unrelated
-- parser change, confirmed by reading the file) and contradicted by this
-- migration's own live step-1 capture, which found the privileges still
-- held broadly. 047 is the migration that actually closes T-023-07's gap.
-- Correcting that stale comment is out of this file's own scope; flagged
-- in the review package's open questions for a follow-up.
--
-- D3 SCOPE -- FOR ROLE postgres ONLY, PROVEN NOT ASSUMED. The migration
-- runner connects as `postgres` (confirmed live: `SELECT current_user`),
-- is NOT a superuser (`rolsuper = false`), and is NOT a member of
-- `supabase_admin` (`pg_has_role('postgres','supabase_admin','MEMBER')` =
-- false) -- so it can only run `ALTER DEFAULT PRIVILEGES FOR ROLE postgres
-- IN SCHEMA public`, never `FOR ROLE supabase_admin`. Per Aravind's own
-- prod-state supply (2026-09-16): on prod, pg_default_acl for schema
-- public shows BOTH postgres and supabase_admin granting anon/
-- authenticated arwdDxtm on tables (rwU on sequences, X on functions) --
-- this migration only closes the postgres half of that. supabase_admin's
-- own default cannot be altered by this migration, and no Quoco table is
-- created under supabase_admin today (every table in public is owned by
-- postgres -- confirmed both on prod, per Aravind, and independently on
-- test-db, this migration's own step-1 capture: single distinct owner,
-- `postgres`, across all 32 tables). If a future migration ever creates a
-- table owned by supabase_admin, this default-privilege closure would not
-- cover it -- named as a limit, not fixed here.
--
-- TEST-DB / PROD DIVERGENCE ON pg_default_acl -- NONE FOUND. Test-db's own
-- pg_default_acl capture (this migration's review package step 1) matches
-- Aravind's reported prod state exactly for schema public: postgres and
-- supabase_admin both grant anon/authenticated arwdDxtm on tables, rwU on
-- sequences, X on functions. No difference to report.
--
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- D1 + D2: explicit per-table REVOKE, every table in schema public (32
-- tables, captured live this migration's own review package step 1).
-- One statement per table, no dynamic loop, by design (D1's own wording)
-- -- REVOKE is a safe no-op on a privilege that was never granted, so this
-- runs identically whether or not a given table/role/privilege
-- combination currently holds the grant (4 tables -- daily_log_photos,
-- hindrance_photos, outbound_sends, owner_email_verifications -- already
-- hold none of these five privileges for anon/authenticated at all, per
-- their own prior migrations' REVOKE ALL).
-- -----------------------------------------------------------------------

REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.boq_items FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.boq_sessions FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.checkin_escalations FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.daily_log_edits FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.daily_log_photos FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.daily_logs FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.dpr_versions FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.dprs FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.hindrance_photos FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.hindrances FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.invoices FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.jobs FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.outbound_sends FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.owner_email_verifications FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.processed_messages FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.project_members FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.projects FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.ra_bill_payments FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.ra_bills FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.rate_catalog FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.rate_catalog_history FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.safety_incidents FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tenants FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tender_chat_messages FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tender_chat_sessions FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tender_document_chunks FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tender_documents FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.tenders FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.users FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.vendor_invoices FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.vendors FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON public.whatsapp_sessions FROM anon, authenticated;

-- -----------------------------------------------------------------------
-- D2: DROP the 17 now-dead DELETE-command RLS policies -- verbatim names
-- from D2's own list, cross-checked against this migration's own review
-- package step 1 live capture (exact match, 17 for 17).
-- -----------------------------------------------------------------------

DROP POLICY boq_items_delete ON public.boq_items;
DROP POLICY boq_sessions_delete ON public.boq_sessions;
DROP POLICY hindrances_delete ON public.hindrances;
DROP POLICY invoices_delete ON public.invoices;
DROP POLICY project_members_delete ON public.project_members;
DROP POLICY projects_delete ON public.projects;
DROP POLICY ra_bill_payments_delete ON public.ra_bill_payments;
DROP POLICY ra_bills_delete ON public.ra_bills;
DROP POLICY safety_incidents_delete ON public.safety_incidents;
DROP POLICY tender_chat_messages_delete ON public.tender_chat_messages;
DROP POLICY tender_chat_sessions_delete ON public.tender_chat_sessions;
DROP POLICY tender_document_chunks_delete ON public.tender_document_chunks;
DROP POLICY tender_documents_delete ON public.tender_documents;
DROP POLICY tenders_delete ON public.tenders;
DROP POLICY vendor_invoices_delete ON public.vendor_invoices;
DROP POLICY vendors_delete ON public.vendors;
DROP POLICY whatsapp_sessions_delete ON public.whatsapp_sessions;

-- -----------------------------------------------------------------------
-- D3: default privileges for FUTURE tables -- FOR ROLE postgres ONLY (see
-- header for why supabase_admin's own default is out of reach). Tables
-- only -- sequences and functions are explicitly NOT touched (see header).
-- -----------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON TABLES FROM anon, authenticated;

-- -----------------------------------------------------------------------
-- Final self-check -- aborts the whole transaction if either invariant
-- this migration exists to establish does not actually hold once every
-- statement above has run. Same discipline as 028's own NOT NULL backstop
-- (migration 028, Step 4's own comment) -- a stale assumption fails loud,
-- not silent.
-- -----------------------------------------------------------------------

DO $$
DECLARE
  v_grant_count INT;
  v_policy_count INT;
BEGIN
  -- information_schema.role_table_grants does NOT report MAINTAIN (found
  -- live, this migration's own review-package correction pass, 2026-09-16
  -- -- relacl showed MAINTAIN held on 27 anon / 28 authenticated tables
  -- that information_schema's own view reported as zero) -- this check
  -- reads pg_class.relacl directly via aclexplode(), the same source the
  -- migration's own review package now uses throughout, so it can never
  -- silently miss a privilege information_schema doesn't surface.
  SELECT count(*) INTO v_grant_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    AND a.privilege_type IN ('DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');

  IF v_grant_count > 0 THEN
    RAISE EXCEPTION 'migration 047: % grant(s) of DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN to anon/authenticated remain in schema public after revoke -- aborting', v_grant_count;
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pol.polcmd = 'd';

  IF v_policy_count > 0 THEN
    RAISE EXCEPTION 'migration 047: % polcmd ''d'' polic(y/ies) remain in schema public after drop -- aborting', v_policy_count;
  END IF;
END $$;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- BEGIN;
--
-- -- Reverse D3 first (defaults for tables created AFTER this migration
-- -- would otherwise still lack these grants while the DOWN re-grants
-- -- existing tables back to their pre-047 state).
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, DELETE ON TABLES TO anon, authenticated;
-- -- MAINTAIN IS re-granted here -- CORRECTED 2026-09-16, review-package
-- -- correction pass: the original comment here claimed MAINTAIN was never
-- -- granted pre-047, based on an information_schema.role_table_grants
-- -- capture that does not report MAINTAIN at all. Rebuilt from
-- -- pg_class.relacl via aclexplode(): MAINTAIN is held by anon on 27
-- -- tables and authenticated on 28 tables on test-db, matching prod's own
-- -- relacl capture exactly (anon 27, authenticated 28, per Aravind,
-- -- 2026-09-16) -- co-occurring, table-for-table, with TRUNCATE/TRIGGER/
-- -- REFERENCES in every case (never granted alone). Prod's own default
-- -- ACL confirms the 'm' (MAINTAIN) privilege letter is present for
-- -- anon/authenticated alongside the others, so the default-privilege
-- -- reversal restores it too.
--
-- -- Re-GRANT the exact privileges step 1 captured, per table and role --
-- -- rebuilt from pg_class.relacl via aclexplode(), not information_schema
-- -- (which does not report MAINTAIN at all -- see the header's own DATED
-- -- CORRECTION). Tables already at zero for all five (daily_log_photos,
-- -- hindrance_photos, outbound_sends, owner_email_verifications) get
-- -- NOTHING re-granted -- their own prior migrations' REVOKE ALL is what
-- -- this DOWN restores by doing nothing.
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.boq_items TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.boq_items TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.boq_sessions TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.boq_sessions TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkin_escalations TO anon;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.checkin_escalations TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.daily_log_edits TO anon;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.daily_log_edits TO authenticated;
-- -- daily_log_photos: nothing (pre-047 state was zero grants).
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.daily_logs TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.daily_logs TO authenticated;
-- -- dpr_versions: anon gets nothing (pre-047 state was zero for anon).
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.dpr_versions TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.dprs TO anon;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.dprs TO authenticated;
-- -- hindrance_photos: nothing (pre-047 state was zero grants).
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.hindrances TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.hindrances TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.invoices TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.invoices TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.jobs TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.jobs TO authenticated;
-- -- outbound_sends: nothing (pre-047 state was zero grants).
-- -- owner_email_verifications: nothing (pre-047 state was zero grants).
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.processed_messages TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.processed_messages TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.project_members TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.project_members TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.projects TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.projects TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ra_bill_payments TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ra_bill_payments TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ra_bills TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.ra_bills TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.rate_catalog TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.rate_catalog TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.rate_catalog_history TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.rate_catalog_history TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.safety_incidents TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.safety_incidents TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenants TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenants TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_chat_messages TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_chat_messages TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_chat_sessions TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_chat_sessions TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_document_chunks TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_document_chunks TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_documents TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tender_documents TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenders TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.tenders TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.users TO anon;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.users TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.vendor_invoices TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.vendor_invoices TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.vendors TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.vendors TO authenticated;
-- GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.whatsapp_sessions TO anon;
-- GRANT DELETE, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.whatsapp_sessions TO authenticated;
--
-- -- Recreate all 17 policies verbatim (USING expression captured live,
-- -- step 1 -- pg_get_expr output pasted exactly, not retyped from memory).
-- CREATE POLICY boq_items_delete ON public.boq_items FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY boq_sessions_delete ON public.boq_sessions FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY hindrances_delete ON public.hindrances FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY project_members_delete ON public.project_members FOR DELETE TO authenticated
--   USING ((tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text])));
-- CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY ra_bill_payments_delete ON public.ra_bill_payments FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY ra_bills_delete ON public.ra_bills FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY safety_incidents_delete ON public.safety_incidents FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY tender_chat_messages_delete ON public.tender_chat_messages FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY tender_chat_sessions_delete ON public.tender_chat_sessions FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY tender_document_chunks_delete ON public.tender_document_chunks FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY tender_documents_delete ON public.tender_documents FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY tenders_delete ON public.tenders FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY vendor_invoices_delete ON public.vendor_invoices FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY vendors_delete ON public.vendors FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
-- CREATE POLICY whatsapp_sessions_delete ON public.whatsapp_sessions FOR DELETE TO authenticated
--   USING (tenant_id = get_user_tenant_id());
--
-- COMMIT;
