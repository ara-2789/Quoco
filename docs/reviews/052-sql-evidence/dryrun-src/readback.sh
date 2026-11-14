#!/bin/bash
# Read-back (3c step 2). $1 = output file name suffix.
. <local-path>
O=$B/$1
{
echo "LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST"; echo "db=${DB:-scaffold}"
echo "== three function md5s"; Q -At -F ' ' -c "$FP"
echo "== new functions: schema, name, owner, secdef, config, acl"
Q -At -F ' | ' -c "select n.nspname, p.proname, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig::text, coalesce(p.proacl::text,'NULL') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('pm_classify_document','capture_apply_classification') order by 1,2"
echo "== EXECUTE matrix (anon, authenticated, service_role) for the five functions"
Q -At -F ' | ' -c "select p.oid::regprocedure::text, has_function_privilege('anon',p.oid,'EXECUTE') anon, has_function_privilege('authenticated',p.oid,'EXECUTE') auth, has_function_privilege('service_role',p.oid,'EXECUTE') svc from pg_proc p where p.proname in ('pm_classify_document','capture_apply_classification','apply_material_inward_turn','trg_capture_documents_before_insert','trg_capture_documents_before_update') order by 1"
echo "== schema private privileges"
Q -At -F ' | ' -c "select r, has_schema_privilege(r,'private','USAGE') usage, has_schema_privilege(r,'private','CREATE') cr from unnest(array['anon','authenticated','service_role']) r"
echo "== capture_documents columns (new + kind)"
Q -At -F ' | ' -c "select attname, format_type(atttypid,atttypmod), attnotnull from pg_attribute where attrelid='public.capture_documents'::regclass and not attisdropped and attname in ('kind','kind_source','kind_set_at','kind_set_by','received_at') order by attname"
echo "== constraints (052)"
Q -At -c "select conname||' :: '||pg_get_constraintdef(oid) from pg_constraint where conrelid='public.capture_documents'::regclass and conname in ('capture_documents_kind_provenance_chk','capture_documents_kind_set_order_chk','capture_documents_received_order_chk','capture_documents_kind_set_by_fk') order by conname"
} > $O 2>&1
cat $O | cut -c1-260
