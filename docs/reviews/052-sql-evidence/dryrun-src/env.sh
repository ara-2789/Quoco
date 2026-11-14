export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
export PGHOST=<local-path> PGPORT=54417 PGUSER=postgres
B=<local-path>
WT=<local-path>
Q() { psql -X -v ON_ERROR_STOP=1 -d "${DB:-scaffold}" "$@"; }
FP="select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('apply_material_inward_turn','trg_capture_documents_before_insert','trg_capture_documents_before_update') order by 1"
