#!/bin/bash
# 052 local PG17 dry-run orchestrator. Everything runs on a throwaway local cluster (unix socket, no TCP).
# LABEL for all output: local PG17, structure-only dump of test-db, no roles/PostgREST.
export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
WT=<local-path>
SRC=$WT/docs/reviews/052-sql-evidence/dryrun-src
FIX=$WT/docs/reviews/049-sql-evidence/src/_fixture.sql
B=<local-path>
B=<local-path> O=<local-path> rm -rf $O; mkdir -p $O
D=<local-path>
export PGHOST=$D/sock PGPORT=54417 PGUSER=postgres
HELD=$WT/docs/reviews/052_mi_kind_deferred.sql
DOWN=$WT/docs/reviews/052-down-testdb.sql
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# --- cluster + stubs + dump load, then rename to the pre-052 template
bash <local-path> > $O/00-cluster.txt 2>&1
psql -X -q -d postgres -c "ALTER DATABASE scaffold RENAME TO pre052" >> $O/00-cluster.txt 2>&1
{ echo "HEAD $(cd $WT && git rev-parse HEAD)"; echo "git status --porcelain: [$(cd $WT && git status --porcelain | grep -v dryrun-src | grep -v 052-sql-evidence)]"
  shasum -a 256 $HELD $DOWN $B/schema.sql | sed -E "s# /[^ ]*/# #"; } > $O/00-pins.txt

mk() { # mk NAME: fresh database from the pre-052 template, fixture + lib loaded
  dropdb --if-exists $1 2>/dev/null; createdb -T pre052 $1
  P -d $1 -c "CREATE SCHEMA t" -f $FIX -f $SRC/lib.sql > /dev/null
}
ST() { P -d $1 -f $SRC/state.sql; }
RB() { DB=$1 bash <local-path> /dev/null > /dev/null 2>&1; }

# ================= MAIN lifecycle =================
mk main
{ echo "== 3c.0 pre-052 state"; ST main; } > $O/10-main-pre.txt 2>&1
{ echo "== 3c.1 apply held 052, one transaction (psql -v ON_ERROR_STOP=1 -f)"; P -d main -f $HELD; echo "apply exit=$?"; } > $O/11-main-apply.txt 2>&1
{ echo "== 3c.2 read-back"; . <local-path> DB=main; export DB
  bash <local-path> x >/dev/null 2>&1; cat $B/x; rm -f $B/x; ST main; } > $O/12-main-readback.txt 2>&1
{ echo "== 3c.3 seed + exercise (main.sql)"; P -d main -f $SRC/main.sql; echo "exit=$?"; } > $O/13-main-exercise.txt 2>&1
{ echo "== N-5 lock-mode test (two raw psql sessions). LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST. Owed at test-db: the two-caller race through PostgREST."; 
  P -d main -c "select t.turn('+91900000005','4','m-e0',NULL,true)" > /dev/null; P -d main -c "select t.turn('+91900000005',NULL,'m-e2',t.media(1))" > /dev/null;
  DB=main SRC=$SRC bash $SRC/lock-test.sh; } > $O/13b-main-lock-test.txt 2>&1
{ echo "== state before the DOWN"; ST main; } > $O/14-main-before-down.txt 2>&1
{ echo "== 3c.4a DOWN with an unclassified document present (expect the plan's refusal)"; echo "DOWN sha256 $(shasum -a 256 $DOWN | cut -c1-64)"; P -d main -f $DOWN; echo "down exit=$?"; echo "== state after the refused DOWN (must equal the state before it)"; ST main; } > $O/15-main-down-refused.txt 2>&1
{ echo "== 3c.4 remove the blocker as the plan describes: a PM classifies the unclassified document (a kind is never guessed)";
  P -d main -At -c "select t.try_as('authenticated','40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-d2'), 'invoice'))"
  P -d main -At -c "select 'unclassified now: ' || count(*) from public.capture_documents where kind is null"; } > $O/16-main-blocker-removed.txt 2>&1
{ echo "== 3c.4b DOWN"; P -d main -f $DOWN; echo "down exit=$?"; echo "== state after DOWN (md5s must equal cecc170b.../b5467b20.../4a7f4703...)"; ST main;
  echo "== session +91900000009 after DOWN (invoice session cleared, unrelated key kept)"; P -d main -At -c "select coalesce(current_flow,'NULL')||'/'||current_step||' '||context::text from public.whatsapp_sessions where phone_number='+91900000009'"; } > $O/17-main-down.txt 2>&1
{ echo "== 3c.5 re-apply 052"; P -d main -f $HELD; echo "apply exit=$?"; echo "== read-back"; DB=main bash <local-path> x >/dev/null 2>&1; cat $B/x; rm -f $B/x; ST main; } > $O/18-main-reapply.txt 2>&1

# ================= LEGACY data: backfills on real rows =================
mk legacy
{ echo "== legacy: seed PRE-052"; P -d legacy -f $SRC/legacy-seed.sql; echo "== apply 052 over legacy rows"; P -d legacy -f $HELD; echo "apply exit=$?"; echo "== checks"; P -d legacy -f $SRC/legacy-post.sql; ST legacy;
  P -d legacy -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('052','x')"; echo "== DOWN over the legacy (all classified) database"; P -d legacy -f $DOWN; echo "down exit=$?"; ST legacy;
  P -d legacy -At -c "select 'legacy rows intact after DOWN: docs=' || (select count(*) from public.capture_documents) || ' deliveries=' || (select count(*) from public.deliveries) || ' links=' || (select count(*) from public.delivery_invoice_links)"; } > $O/20-legacy.txt 2>&1

# ================= abort: in-flight invoice session =================
mk abort1
{ echo "== T-M-1: seed a step-3 invoice session, then apply (expect APPLY_ABORT_052, nothing changed)";
  P -d abort1 -c "INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, pending_flows, expires_at, updated_at) VALUES ('+91900000099','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','invoice',3,'{}','[]', now() - interval '1 hour', now())"
  P -d abort1 -f $HELD; echo "apply exit=$?"; ST abort1;
  echo "== same database, session removed: apply succeeds"; P -d abort1 -c "DELETE FROM public.whatsapp_sessions WHERE phone_number='+91900000099'"; P -d abort1 -f $HELD; echo "apply exit=$?"; ST abort1; } > $O/30-abort-invoice-session.txt 2>&1

# ================= abort: a document with no delivery (A3b assertion) =================
mk nodlv
{ echo "== A3b: a legacy document with NO delivery, then apply (expect BACKFILL_ASSERT_052 'exactly one delivery', nothing changed)";
  P -d nodlv -c "SELECT t.mk_doc('50000000-0000-0000-0000-0000000000aa','dc','nd-1')"
  P -d nodlv -f $HELD; echo "apply exit=$?"; ST nodlv; } > $O/31-abort-no-delivery.txt 2>&1

# ================= POSITIVE CONTROL: break one in-file assertion's expected value =================
mk ctl
SCR=$B/scratch-052-broken-assertion.sql
sed "s/('pm_classify_document',                'public',  'public.pm_classify_document(uuid,text)',               false, true,  false)/('pm_classify_document',                'public',  'public.pm_classify_document(uuid,text)',               false, false, false)/" $HELD > $SCR
{ echo "== POSITIVE CONTROL: scratch copy with the wrapper's expected authenticated EXECUTE flipped true -> false"; echo "HEAD $(cd $WT && git rev-parse HEAD)"; echo "held sha256   $(shasum -a 256 $HELD | cut -c1-64)"; echo "scratch sha256 $(shasum -a 256 $SCR | cut -c1-64)";
  echo "-- diff held vs scratch (exactly one changed line expected):"; diff $HELD $SCR | cut -c1-200; echo "diff lines: $(diff $HELD $SCR | grep -c '^[<>]')";
  P -d ctl -f $SCR; echo "apply exit=$?"; echo "== state afterwards (nothing of 052 may remain)"; ST ctl; } > $O/40-positive-control.txt 2>&1
# ================= POSITIVE CONTROL 2 (S-3): flip ONE table-privilege expectation =================
mk ctl2
SCR2=$B/scratch-052-broken-table-grant.sql
sed "s/FOREACH v_priv IN ARRAY ARRAY\['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'\] LOOP/FOREACH v_priv IN ARRAY ARRAY['SELECT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP/" $HELD > $SCR2
{ echo "== POSITIVE CONTROL 2 (S-3): scratch copy where the table-privilege list that must be FALSE has INSERT replaced by SELECT (authenticated and service_role DO hold SELECT)"; echo "HEAD $(cd $WT && git rev-parse HEAD)"; echo "held sha256    $(shasum -a 256 $HELD | cut -c1-64)"; echo "scratch sha256 $(shasum -a 256 $SCR2 | cut -c1-64)";
  echo "-- diff held vs scratch (exactly one changed line expected):"; diff $HELD $SCR2 | cut -c1-200; echo "diff lines: $(diff $HELD $SCR2 | grep -c '^[<>]')";
  P -d ctl2 -f $SCR2; echo "apply exit=$?"; echo "== state afterwards (nothing of 052 may remain)"; ST ctl2; } > $O/41-positive-control-table-grant.txt 2>&1
echo done
