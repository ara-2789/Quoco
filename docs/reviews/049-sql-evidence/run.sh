#!/bin/bash
# 049 PG17 dry-run evidence runner (block 2a). Runs ONLY against a disposable LOCAL PG 17 scaffold.
#
#   usage:  run.sh <test-id> <out-dir>        e.g. run.sh T-B1 /tmp/quoco/evidence
#   env:    PGHOST PGPORT PGUSER   the local cluster (never a Supabase project; the scripts refuse a remote host)
#           WORK                   scratch dir for expanded scenarios / mutated copies (default /tmp/049-run)
#           DEV=1                  allow a dirty tree (official transcripts require an empty `git status --porcelain`)
#
# The scaffold database `quoco_049_scaffold` is built from a REAL structure-only dump of test-db's public schema
# plus named stubs (see docs/reviews/049-review-package.md, "PG17 scaffold"). Every test clones it
# (CREATE DATABASE ... TEMPLATE), applies the real 049 UP, loads fixtures, and runs one scenario file.
#
# Each transcript: header (HEAD sha, git status --porcelain, psql version), then for every RED run the named mutant
# and its output (the test MUST show FAIL lines: proof the test can fail), then the GREEN run against the real
# file (MUST show 0 FAIL). psql -e echoes every statement above its result.
set -u
ID=${1:?test id}
OUT=${2:?out dir}
ROOT=$(git rev-parse --show-toplevel)
EV=$ROOT/docs/reviews/049-sql-evidence
SRC=$EV/src
SQLF=$ROOT/docs/reviews/049_capture_tables.sql
HELPF=$ROOT/scripts/test-db-only-capture-helpers.sql
WORK=${WORK:-/tmp/049-run}
PSQL=${PSQL:-psql}
mkdir -p "$OUT" "$WORK"
T=$OUT/$ID.txt
: > "$T"

case "${PGHOST:-}" in
  /*|localhost|127.0.0.1) ;;
  *) echo "refusing: PGHOST must be a local socket dir or localhost" >&2; exit 2;;
esac

p() { printf '%s\n' "$*" >> "$T"; }
cmd() { printf '$ %s\n' "$*" >> "$T"; "$@" >> "$T" 2>&1; local rc=$?; printf '[exit %s]\n' "$rc" >> "$T"; return $rc; }

header() {
  p "== 049-sql evidence: $ID =="
  p "generated: $(date -u +%FT%TZ)"
  p "\$ git rev-parse HEAD"; git -C "$ROOT" rev-parse HEAD >> "$T"
  if [ -n "${ARTIFACT_SHA:-}" ]; then
    p "\$ SQL artifact commit under test: $ARTIFACT_SHA"
    p "\$ git rev-parse $ARTIFACT_SHA:docs/reviews/049_capture_tables.sql"; git -C "$ROOT" rev-parse "$ARTIFACT_SHA:docs/reviews/049_capture_tables.sql" >> "$T"
    p "\$ git rev-parse HEAD:docs/reviews/049_capture_tables.sql   (identical blob = the file under test IS the artifact commit's file)"; git -C "$ROOT" rev-parse "HEAD:docs/reviews/049_capture_tables.sql" >> "$T"
  fi
  p "\$ git status --porcelain      (empty output between the next two lines = clean tree)"
  p "----- begin porcelain -----"; git -C "$ROOT" status --porcelain >> "$T"; p "----- end porcelain -----"
  p "\$ psql --version"; $PSQL --version >> "$T"
  p "\$ select version()   (LOCAL scaffold server; test-db/prod are 17.6)"
  $PSQL -X -At -d postgres -c "select version()" >> "$T" 2>&1
  p "\$ shasum -a 256 (artifacts under test)"
  (cd "$ROOT" && shasum -a 256 docs/reviews/049_capture_tables.sql scripts/test-db-only-capture-helpers.sql docs/reviews/049-sql-evidence/src/_lib.sql docs/reviews/049-sql-evidence/src/_fixture.sql) >> "$T"
  p ""
}

# fresh clone of the scaffold, 049 UP applied from $1 (a .sql path), optional post-UP SQL from $2
mkdb() {
  local db=$1 up=$2 post=${3:-}
  $PSQL -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$db\"" -c "CREATE DATABASE \"$db\" TEMPLATE quoco_049_scaffold" >> "$T" 2>&1
  p "\$ psql -d $db -v ON_ERROR_STOP=1 -f $(basename "$up")   (049 UP)"
  $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$up" >> "$T" 2>&1; p "[exit $?]"
  if [ -n "$post" ]; then
    p "\$ psql -d $db -f <post-UP mutation>:"
    p "$post"
    printf '%s\n' "$post" | $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f - >> "$T" 2>&1; p "[exit $?]"
  fi
  $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$SRC/_lib.sql" >> "$T" 2>&1
  $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$SRC/_fixture.sql" >> "$T" 2>&1
  p "(fixtures: src/_lib.sql, src/_fixture.sql loaded)"
  if [ -n "${LOAD_ASSERT:-}" ]; then
    # N-1: the UP file's own in-transaction ACL/ownership assertion block (the last DO block before the UP's COMMIT),
    # extracted and re-created as t.assert_block() so a scenario can run it after planting a wrong owner.
    python3 -I - "$up" "$WORK/assert-fn.sql" <<'PYEOF'
import sys
lines = open(sys.argv[1]).read().split('\n')
c = lines.index('COMMIT;')
end = max(i for i in range(c) if lines[i] == '$$;')
start = max(i for i in range(end) if lines[i] == 'DO $$')
body = lines[start + 1:end]
open(sys.argv[2], 'w').write('CREATE OR REPLACE FUNCTION t.assert_block() RETURNS void LANGUAGE plpgsql AS $$\n' + '\n'.join(body) + '\n$$;\n')
PYEOF
    p "\$ the UP's final assertion DO block extracted from $(basename "$up") (lines: $(wc -l < "$WORK/assert-fn.sql")) and loaded as t.assert_block()"
    $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$WORK/assert-fn.sql" >> "$T" 2>&1; p "[exit $?]"
  fi
  if [ -n "${HELPER_FILE:-}" ]; then
    p "\$ psql -d $db -v ON_ERROR_STOP=1 -f $(basename "$HELPER_FILE")   (test-db-only helpers, loaded for THIS scenario only)"
    $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$HELPER_FILE" >> "$T" 2>&1; p "[exit $?]"
  fi
}

# run scenario file $2 in db $1 with extra psql args; append output; echo "PASS FAIL" counts to fd 3
scn() {
  local db=$1 name=$2; shift 2
  python3 -I "$SRC/expand.py" "$SRC/$name.sql" "$WORK/$name.expanded.sql" || return 1
  local o="$WORK/$db.out"
  p "\$ psql -X -e -d $db -f $name.sql (tokens expanded by src/expand.py)"
  $PSQL -X -e -d "$db" -f "$WORK/$name.expanded.sql" "$@" > "$o" 2>&1
  cat "$o" >> "$T"
  local pass fail
  pass=$(grep -c '^PASS:' "$o"); fail=$(grep -c '^FAIL:' "$o")
  # N-2: the expected assertion count is DECLARED in the source (-- EXPECT_PASS: N) and cross-checked against a static
  # count of the source's own assertion lines outside \if blocks (the RED-only controls live inside \if).
  SCN_EXPECT=$(grep -m1 -oE '^-- EXPECT_PASS: [0-9]+' "$SRC/$name.sql" | grep -oE '[0-9]+$')
  SCN_STATIC=$(awk 'BEGIN{d=0} /^\\if /{d++} /^\\endif/{d--} d==0 && /^SELECT t\.(expect|val)\(/{n++} END{print n+0}' "$SRC/$name.sql")
  p ""; p ">>> RESULT $db: PASS=$pass FAIL=$fail   (declared EXPECT_PASS=${SCN_EXPECT:-none}, static assertion lines=$SCN_STATIC)"
  SCN_PASS=$pass; SCN_FAIL=$fail
}

# ---- mutants (each is NAMED; a RED run applies exactly one) ---------------------------------------------------
mut_file() {  # $1 name -> writes $WORK/mutant-$1.sql ; prints a diff into the transcript
  local n=$1 f=$WORK/mutant-$1.sql
  case $n in
    no_guard)       sed "s/IF current_setting('transaction_isolation') <> 'read committed' THEN/IF false THEN/" "$SQLF" > "$f";;
    no_for_share)   sed "s/^     FOR SHARE;\$/     ;/" "$SQLF" > "$f";;
    old_order)      sed "s/^     AND NEW.created_from_invoice_id IS NOT NULL THEN\$/     AND false THEN/" "$SQLF" > "$f";;
    no_tr4b)      sed "s/IF NEW.delivery_type = 'internal_transfer' AND OLD.delivery_type IS DISTINCT FROM 'internal_transfer' THEN/IF false THEN/" "$SQLF" > "$f";;
    no_b2_insert)   sed -e "s/^  IF NEW.unlinked_at IS NOT NULL OR NEW.unlinked_by IS NOT NULL OR NEW.unlink_reason IS NOT NULL\$/  IF (NEW.unlinked_at IS NOT NULL OR NEW.unlinked_by IS NOT NULL OR NEW.unlink_reason IS NOT NULL/" -e "s/^     OR NEW.superseded_approval_at IS NOT NULL THEN\$/     OR NEW.superseded_approval_at IS NOT NULL) AND false THEN/" "$SQLF" > "$f";;
    rls_no_status)  sed "/AND u.status = 'active'/d" "$SQLF" > "$f";;
    rls_no_role)    sed "/AND pm.role = 'pm'/d" "$SQLF" > "$f";;
    *) echo "unknown file mutant $n" >&2; return 1;;
  esac
  p "MUTANT (named): $n   -- diff of the real file against the mutated copy:"
  diff "$SQLF" "$f" >> "$T"; true
}
mut_post() {  # $1 name -> prints post-UP SQL
  case $1 in
    no_triggers)    printf '%s\n' "DROP TRIGGER tr_dil_before_insert ON public.delivery_invoice_links;" "DROP TRIGGER tr_dil_before_update ON public.delivery_invoice_links;" "DROP TRIGGER tr_deliveries_before_update ON public.deliveries;" "DROP TRIGGER tr_capture_documents_before_update ON public.capture_documents;" "DROP TRIGGER tr_deliveries_before_insert ON public.deliveries;" "DROP TRIGGER tr_capture_documents_before_insert ON public.capture_documents;";;
    no_tr3_trigger) printf '%s\n' "DROP TRIGGER tr_dil_before_update ON public.delivery_invoice_links;";;
    drop_self_fk)   printf '%s\n' "ALTER TABLE public.delivery_invoice_links DROP CONSTRAINT dil_self_link_fk;";;
    drop_doc_fks)   printf '%s\n' "ALTER TABLE public.deliveries DROP CONSTRAINT deliveries_dc_document_fk;" "ALTER TABLE public.deliveries DROP CONSTRAINT deliveries_invoice_document_fk;";;
    weak_approver_chk) printf '%s\n' "ALTER TABLE public.delivery_invoice_links DROP CONSTRAINT dil_snapshot_approver_chk;" "ALTER TABLE public.delivery_invoice_links ADD CONSTRAINT dil_snapshot_approver_chk CHECK ((superseded_approval_by IS NOT NULL) = (superseded_from_status = 'approved'));";;
    plant_grants)   printf '%s\n' "GRANT INSERT ON public.deliveries TO anon;" "GRANT DELETE ON public.capture_files TO service_role;" "GRANT TRUNCATE ON public.delivery_invoice_links TO service_role;" "GRANT EXECUTE ON FUNCTION public.trg_dil_before_insert() TO authenticated;" "GRANT UPDATE ON public.capture_documents TO authenticated;";;
    *) echo "unknown post mutant $1" >&2; return 1;;
  esac
}

# generic scenario test: RED list, then GREEN
generic() {
  local scenario=$1; shift
  local reds=("$@")
  header
  local n=0 red_ok=1
  for r in "${reds[@]}"; do
    n=$((n+1))
    p "################ RED run $n: $r ################"
    local kind=${r%%:*} name=${r#*:} db="t_${ID//-/_}_red$n"
    case $kind in
      file) mut_file "$name" || exit 1; mkdb "$db" "$WORK/mutant-$name.sql";;
      hfile) HELPER_FILE=$WORK/mutant-helper-$name.sql
             case $name in no_guard) sed "s/^  SELECT p_tenant_id IS NOT NULL AND EXISTS (\$/  SELECT true OR p_tenant_id IS NOT NULL AND EXISTS (/" "$HELPF" > "$HELPER_FILE";; esac
             p "MUTANT (named): helper $name   -- diff of the real helper script against the mutated copy:"; diff "$HELPF" "$HELPER_FILE" >> "$T"
             mkdb "$db" "$SQLF"; HELPER_FILE=$HELPF;;
      commit) git -C "$ROOT" show "$name:docs/reviews/049_capture_tables.sql" > "$WORK/old-$name.sql"
              p "MUTANT (named): the REVIEWED file at commit $name   -- diff of that file against the file under test:"; diff "$WORK/old-$name.sql" "$SQLF" >> "$T"
              mkdb "$db" "$WORK/old-$name.sql";;
      post) p "MUTANT (named): $name   (post-UP SQL applied to the real file's result)"; mkdb "$db" "$SQLF" "$(mut_post "$name")";;
      flag) p "MUTANT (named): flow variant -v $name"; mkdb "$db" "$SQLF";;
    esac
    if [ "$kind" = flag ]; then scn "$db" "$scenario" -v "$name"; else scn "$db" "$scenario"; fi
    if [ "${SCN_FAIL:-0}" -gt 0 ]; then p ">>> RED verdict: test FAILED against the mutant (FAIL=$SCN_FAIL) -- the test can fail: OK"; else p ">>> RED verdict: test did NOT fail against the mutant -- NOT A VALID TEST"; red_ok=0; fi
    p ""
  done
  p "################ GREEN run: the real file ################"
  local gdb="t_${ID//-/_}_green"
  mkdb "$gdb" "$SQLF"
  if [ "${#reds[@]}" -gt 0 ] && [[ ${reds[0]} == flag:* ]]; then scn "$gdb" "$scenario" -v green=1; else scn "$gdb" "$scenario"; fi
  # N-2 gate: PASS must EQUAL the declared expected count (which must equal the static count); FAIL must be 0.
  if [ "${SCN_FAIL:-1}" -eq 0 ] && [ -n "${SCN_EXPECT:-}" ] && [ "${SCN_PASS:-0}" -eq "$SCN_EXPECT" ] && [ "$SCN_EXPECT" -eq "$SCN_STATIC" ] && [ "$red_ok" -eq 1 ]; then
    p ">>> OVERALL $ID: RED failed as required, GREEN PASS=$SCN_PASS == expected $SCN_EXPECT (static $SCN_STATIC), FAIL=0"; return 0
  fi
  p ">>> OVERALL $ID: NOT CLEAN (red_ok=$red_ok green PASS=${SCN_PASS:-0} expected=${SCN_EXPECT:-none} static=${SCN_STATIC:-?} FAIL=${SCN_FAIL:-?})"; return 1
}

# ---- custom driver: T-B3, link-vs-retype races with REAL concurrent psql sessions --------------------------------
# These are separate psql processes against a local PG 17 cluster: genuinely concurrent. (The CLAUDE.md sandbox limit
# -- serialised concurrent RPC calls -- concerns test-db calls through the JS client only; it does not apply here.)
# They prove the trigger design on PG 17; the PR-B functions' own race tests remain CI-only.
expand() { python3 -I "$SRC/expand.py" "$SRC/$1.sql" "$WORK/$1.expanded.sql"; }
race() {  # label first second exp_type exp_links [red-spec]
  local label=$1 first=$2 second=$3 et=$4 el=$5 spec=${6:-}
  local db="t_b3_${label}_$([ -n "$spec" ] && echo red || echo green)"
  if [ -n "$spec" ]; then
    local name=${spec#file:}
    p "################ RED race $label: MUTANT (named) $name ################"
    mut_file "$name" || exit 1; mkdb "$db" "$WORK/mutant-$name.sql"
  else
    p "################ GREEN race $label: the real file ################"
    mkdb "$db" "$SQLF"
  fi
  for f in B3-setup B3-observe B3-end "$first" "$second"; do expand "$f" || exit 1; done
  p "\$ psql -X -e -d $db -f B3-setup.sql"; $PSQL -X -e -d "$db" -f "$WORK/B3-setup.expanded.sql" >> "$T" 2>&1
  p "\$ [session 1] psql -X -e -d $db -f $first.sql   (background, starts at T+0.0s)"
  $PSQL -X -e -d "$db" -f "$WORK/$first.expanded.sql" > "$WORK/s1.out" 2>&1 &
  local p1=$!
  sleep 1.5
  p "\$ [session 2] psql -X -e -d $db -f $second.sql   (background, starts at T+1.5s)"
  $PSQL -X -e -d "$db" -f "$WORK/$second.expanded.sql" > "$WORK/s2.out" 2>&1 &
  local p2=$!
  sleep 1.5
  p "\$ [observer] psql -X -d postgres -v db=$db -f B3-observe.sql   (at T+3.0s, both writers open)"
  $PSQL -X -d postgres -v db="$db" -f "$WORK/B3-observe.expanded.sql" >> "$T" 2>&1
  wait $p1 $p2
  p "----- session 1 output ($first) -----"; cat "$WORK/s1.out" >> "$T"
  p "----- session 2 output ($second) -----"; cat "$WORK/s2.out" >> "$T"
  p "\$ psql -X -e -d $db -v exp_type=$et -v exp_links=$el -f B3-end.sql"
  $PSQL -X -e -d "$db" -v exp_type="$et" -v exp_links="$el" -f "$WORK/B3-end.expanded.sql" > "$WORK/end.out" 2>&1; cat "$WORK/end.out" >> "$T"
  RACE_FAIL=$(cat "$WORK/s1.out" "$WORK/s2.out" "$WORK/end.out" | grep -c '^FAIL:')
  RACE_PASS=$(cat "$WORK/s1.out" "$WORK/s2.out" "$WORK/end.out" | grep -c '^PASS:')
  p ">>> RESULT race $label ($([ -n "$spec" ] && echo RED || echo GREEN)): PASS=$RACE_PASS FAIL=$RACE_FAIL"
}
b3() {
  header
  p "NOTE: three races, each RED (named mutant) then GREEN (real file). Two writers are separate psql processes, genuinely"
  p "concurrent on a local PG 17 cluster; 'LINK' = pm_manual link INSERT (TR1/TR2), 'RETYPE' = UPDATE delivery_type (TR4b)."
  local ok=1
  race rc_link_first   B3a-link    B3a-retype  supplier 1 file:no_tr4b;     [ "$RACE_FAIL" -gt 0 ] || { p ">>> RED did NOT fail -- not a valid test"; ok=0; }
  race rc_link_first   B3a-link    B3a-retype  supplier 1;                  [ "$RACE_FAIL" -eq 0 ] && [ "$RACE_PASS" -eq 4 ] || ok=0
  race rc_retype_first B3b-retype  B3b-link    internal_transfer 0 file:no_for_share; [ "$RACE_FAIL" -gt 0 ] || { p ">>> RED did NOT fail -- not a valid test"; ok=0; }
  race rc_retype_first B3b-retype  B3b-link    internal_transfer 0;         [ "$RACE_FAIL" -eq 0 ] && [ "$RACE_PASS" -eq 4 ] || ok=0
  race rr              B3c-retype  B3c-link    supplier 1 file:no_guard;    [ "$RACE_FAIL" -gt 0 ] || { p ">>> RED did NOT fail -- not a valid test"; ok=0; }
  race rr              B3c-retype  B3c-link    supplier 1;                  [ "$RACE_FAIL" -eq 0 ] && [ "$RACE_PASS" -eq 4 ] || ok=0
  if [ $ok -eq 1 ]; then p ">>> OVERALL T-B3: every RED failed as required, every GREEN clean"; else p ">>> OVERALL T-B3: NOT CLEAN"; return 1; fi
}

# ---- custom driver: T-DOWN ------------------------------------------------------------------------------------------
extract_down() {  # uncomment the DOWN block (first '-- BEGIN;' after the DOWN marker .. '-- COMMIT;') of $1
  awk '/^-- DOWN \(/{d=1} d&&/^-- BEGIN;$/{on=1} on{print} on&&/^-- COMMIT;$/{on=0}' "$1" | sed 's/^-- \{0,1\}//'
}
fp() {  # catalog fingerprint of db $1 -> stdout
  $PSQL -X -At -d "$1" -f "$WORK/fp.sql" 2>&1
}
verdict() { # label ok(0/1)
  if [ "$2" -eq 0 ]; then p "PASS: $1"; DPASS=$((DPASS+1)); else p "FAIL: $1"; DFAIL=$((DFAIL+1)); fi
}
runsql() {  # db file -> output appended, rc in RC
  p "\$ psql -X -e -d $1 -v ON_ERROR_STOP=1 -f $(basename "$2")"
  $PSQL -X -e -d "$1" -v ON_ERROR_STOP=1 -f "$2" > "$WORK/last.out" 2>&1; RC=$?
  cat "$WORK/last.out" >> "$T"; p "[exit $RC]"
}
down() {
  header
  DPASS=0; DFAIL=0
  cat > "$WORK/fp.sql" <<'EOSQL'
SELECT 'relations ' || md5(string_agg(c.relname || ':' || c.relkind::text || ':' || COALESCE(c.relacl::text, '') || ':' || c.relrowsecurity::text, ',' ORDER BY c.relname)) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace;
SELECT 'functions ' || md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || COALESCE(p.proacl::text, '') || ':' || md5(p.prosrc), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
SELECT 'constraints ' || md5(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conrelid::regclass::text, conname)) FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
SELECT 'triggers ' || md5(COALESCE(string_agg(tgrelid::regclass::text || ':' || tgname, ',' ORDER BY tgrelid::regclass::text, tgname), '')) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace);
SELECT 'policies ' || md5(COALESCE(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || COALESCE(qual, ''), ',' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public';
SELECT 'indexes ' || md5(string_agg(indexname || ':' || indexdef, ',' ORDER BY indexname)) FROM pg_indexes WHERE schemaname = 'public';
SELECT 'table/column comments ' || count(*) || ' ' || md5(COALESCE(string_agg(c.relname || ':' || d.objsubid || ':' || d.description, ',' ORDER BY c.relname, d.objsubid), '')) FROM pg_description d JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass WHERE c.relnamespace = 'public'::regnamespace;
SELECT 'function comments ' || count(*) FROM pg_description d JOIN pg_proc p ON p.oid = d.objoid AND d.classoid = 'pg_proc'::regclass WHERE p.pronamespace = 'public'::regnamespace;
SELECT 'default_acl ' || md5(COALESCE(string_agg(defaclobjtype::text || defaclacl::text, ',' ORDER BY defaclobjtype), '')) FROM pg_default_acl;
SELECT 'storage.buckets rows ' || count(*) FROM storage.buckets;
SELECT 'ledger rows ' || count(*) FROM supabase_migrations.schema_migrations;
SELECT 'public tables=' || (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') || ' functions=' || (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace);
EOSQL
  extract_down "$SQLF" > "$WORK/049-down.sql"; extract_down "$HELPF" > "$WORK/helpers-down.sql"
  p "DOWN blocks extracted by uncommenting (awk/sed in run.sh:extract_down): $(wc -l < "$WORK/049-down.sql") lines (049), $(wc -l < "$WORK/helpers-down.sql") lines (helpers). 049 DOWN as run:"
  cat "$WORK/049-down.sql" >> "$T"; p "-----"
  # ---------------- phase A: S-D order -------------------------------------------------------------------------
  p ""; p "######## PHASE A (S-D): helpers present -> the guard must TRIP (RED); drop helpers, then DOWN succeeds (GREEN) ########"
  local db=t_down_a
  $PSQL -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db TEMPLATE quoco_049_scaffold" >> "$T" 2>&1
  p "## fingerprint BEFORE 049 (baseline of the REAL-dump scaffold):"; fp $db > "$WORK/fp_base.txt"; cat "$WORK/fp_base.txt" >> "$T"
  runsql $db "$SQLF"
  runsql $db "$HELPF"
  p "\$ INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('049', 'capture_tables');  (stands in for the ledger repair)"
  $PSQL -X -q -d $db -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('049', 'capture_tables')" >> "$T" 2>&1
  p "## fingerprint AFTER UP + helpers + ledger row:"; fp $db > "$WORK/fp_up.txt"; cat "$WORK/fp_up.txt" >> "$T"
  cmp -s "$WORK/fp_base.txt" "$WORK/fp_up.txt"; verdict "UP changed the catalog (fingerprint differs from baseline)" $((1 - $?))
  p "## RED: run the 049 DOWN while the helper functions exist"
  runsql $db "$WORK/049-down.sql"
  [ $RC -ne 0 ] && grep -q 'DOWN_GUARD_FUNCTIONS' "$WORK/last.out"; verdict "DOWN refused with DOWN_GUARD_FUNCTIONS while helpers exist" $?
  grep -q 'quoco_test_capture_insert' "$WORK/last.out"; verdict "the guard names the offending helper functions" $?
  fp $db > "$WORK/fp_after_refused.txt"; cmp -s "$WORK/fp_up.txt" "$WORK/fp_after_refused.txt"; verdict "refused DOWN rolled back completely (fingerprint == after-UP fingerprint)" $?
  p "## GREEN: helpers' own DOWN first, then the 049 DOWN"
  runsql $db "$WORK/helpers-down.sql"; verdict "helpers DOWN ran" $RC
  runsql $db "$WORK/049-down.sql"; verdict "049 DOWN ran to COMMIT" $RC
  p "## fingerprint AFTER DOWN:"; fp $db > "$WORK/fp_down.txt"; cat "$WORK/fp_down.txt" >> "$T"
  cmp -s "$WORK/fp_base.txt" "$WORK/fp_down.txt"; verdict "post-DOWN catalog fingerprint == pre-049 baseline (structure, ACLs, policies, triggers, indexes, comments, default ACL, bucket, ledger)" $?
  [ -z "$(diff "$WORK/fp_base.txt" "$WORK/fp_down.txt")" ] || { p "diff base vs down:"; diff "$WORK/fp_base.txt" "$WORK/fp_down.txt" >> "$T"; }
  cat > "$WORK/gone.sql" <<'EOSQL'
SELECT 'tables left: ' || count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links');
SELECT 'functions left: ' || count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'trg\_%' OR proname LIKE 'quoco\_test\_capture%');
SELECT 'triggers left: ' || count(*) FROM pg_trigger WHERE tgname LIKE 'tr\_%before\_%' AND NOT tgisinternal;
SELECT 'policies left: ' || count(*) FROM pg_policies WHERE policyname IN ('capture_documents_select','capture_files_select','deliveries_select','delivery_invoice_links_select');
SELECT 'bucket rows left: ' || count(*) FROM storage.buckets WHERE id = 'capture-documents';
SELECT 'ledger 049 rows left: ' || count(*) FROM supabase_migrations.schema_migrations WHERE version = '049';
SELECT 'comments on the four tables left: ' || count(*) FROM pg_description d WHERE d.classoid = 'pg_class'::regclass AND d.objoid::regclass::text IN ('capture_documents','capture_files','deliveries','delivery_invoice_links');
EOSQL
  p "\$ psql -X -At -d $db -f gone.sql   (post-DOWN catalog: nothing of 049 remains)"
  $PSQL -X -At -d $db -f "$WORK/gone.sql" > "$WORK/gone.out" 2>&1; cat "$WORK/gone.out" >> "$T"
  [ "$(grep -c ': 0$' "$WORK/gone.out")" -eq 7 ]; verdict "post-DOWN catalog shows none of the 049 objects (7 of 7 counts are 0)" $?
  # ---------------- phase B: rows guard, then non-public namespace + future public function -----------------------
  p ""; p "######## PHASE B: guard 1 (rows) and guard 2 (any other function naming the tables, any non-system schema) ########"
  db=t_down_b
  $PSQL -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db TEMPLATE quoco_049_scaffold" >> "$T" 2>&1
  $PSQL -X -q -d $db -v ON_ERROR_STOP=1 -f "$SQLF" >> "$T" 2>&1
  $PSQL -X -q -d $db -v ON_ERROR_STOP=1 -f "$SRC/_lib.sql" -f "$SRC/_fixture.sql" >> "$T" 2>&1
  p "\$ one DC document + delivery inserted (t.mk_dc) so the tables are not empty"
  $PSQL -X -At -d $db -c "SELECT t.mk_dc('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','SM_DOWN_1')" >> "$T" 2>&1
  runsql $db "$WORK/049-down.sql"
  [ $RC -ne 0 ] && grep -q 'DOWN_GUARD_ROWS' "$WORK/last.out"; verdict "guard 1: DOWN refused with DOWN_GUARD_ROWS while a table has rows" $?
  $PSQL -X -At -d $db -c "SELECT 'rows still there: ' || (SELECT count(*) FROM public.capture_documents)" >> "$T" 2>&1
  p "\$ delete the rows (owner); the fixture functions in schema t (a NON-public, non-system schema) still name the tables"
  $PSQL -X -q -d $db -c "DELETE FROM public.deliveries" -c "DELETE FROM public.capture_documents" >> "$T" 2>&1
  runsql $db "$WORK/049-down.sql"
  [ $RC -ne 0 ] && grep -q 'DOWN_GUARD_FUNCTIONS' "$WORK/last.out" && grep -q 't\.mk_doc' "$WORK/last.out"; verdict "guard 2: refused, naming a function in a NON-public, non-system schema (t.mk_doc)" $?
  $PSQL -X -q -d $db -c "DROP SCHEMA t CASCADE" >> "$T" 2>&1
  p "\$ plant a FUTURE PR-B-style function in public that names a table"
  $PSQL -X -q -d $db -c "CREATE FUNCTION public.pm_unlink_invoice_future() RETURNS void LANGUAGE sql AS 'UPDATE public.delivery_invoice_links SET unlinked_at = now() WHERE false'" >> "$T" 2>&1
  runsql $db "$WORK/049-down.sql"
  [ $RC -ne 0 ] && grep -q 'DOWN_GUARD_FUNCTIONS' "$WORK/last.out" && grep -q 'public.pm_unlink_invoice_future' "$WORK/last.out"; verdict "guard 2: refused, naming the planted future public function" $?
  $PSQL -X -q -d $db -c "DROP FUNCTION public.pm_unlink_invoice_future()" >> "$T" 2>&1
  runsql $db "$WORK/049-down.sql"; verdict "no row, no foreign function: DOWN ran to COMMIT" $RC
  # ---------------- phase C (S-2): Storage refuses a direct SQL delete on storage.buckets --------------------------
  p ""; p "######## PHASE C (S-2): Storage REFUSES the direct SQL bucket delete (STUB trigger on storage.buckets). RED = the reviewed file's DOWN; GREEN = the new DOWN ########"
  git -C "$ROOT" show "50b929a:docs/reviews/049_capture_tables.sql" > "$WORK/old-50b929a.sql"
  extract_down "$WORK/old-50b929a.sql" > "$WORK/old-down.sql"
  cat > "$WORK/refuse.sql" <<'EOSQL'
CREATE FUNCTION storage.refuse_bucket_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'STORAGE_REFUSES_SQL_DELETE'; END; $$;
CREATE TRIGGER refuse_bucket_delete BEFORE DELETE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.refuse_bucket_delete();
EOSQL
  cat > "$WORK/state.sql" <<'EOSQL'
SELECT 'tables left: ' || count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links');
SELECT 'functions left: ' || count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'trg\_%';
SELECT 'ledger 049 rows left: ' || count(*) FROM supabase_migrations.schema_migrations WHERE version = '049';
SELECT 'bucket rows left: ' || count(*) FROM storage.buckets WHERE id = 'capture-documents';
EOSQL
  for variant in old new; do
    local cdb="t_down_c_$variant" upf="$SQLF" dnf="$WORK/049-down.sql" kind=GREEN
    if [ $variant = old ]; then upf="$WORK/old-50b929a.sql"; dnf="$WORK/old-down.sql"; kind=RED; fi
    p ""; p "--- phase C $kind: DOWN of $( [ $variant = old ] && echo 'the REVIEWED file (50b929a): bucket DELETE inside the single transaction' || echo 'the NEW file: main transaction, then the separate bucket step' )"
    $PSQL -X -q -d postgres -c "DROP DATABASE IF EXISTS $cdb" -c "CREATE DATABASE $cdb TEMPLATE quoco_049_scaffold" >> "$T" 2>&1
    $PSQL -X -q -d $cdb -v ON_ERROR_STOP=1 -f "$upf" >> "$T" 2>&1
    $PSQL -X -q -d $cdb -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('049', 'capture_tables')" >> "$T" 2>&1
    p "\$ psql -f refuse.sql   (STUB: BEFORE DELETE trigger on storage.buckets raising STORAGE_REFUSES_SQL_DELETE; stands in for Storage refusing a direct SQL delete)"
    $PSQL -X -q -d $cdb -v ON_ERROR_STOP=1 -f "$WORK/refuse.sql" >> "$T" 2>&1
    runsql $cdb "$dnf"; local drc=$RC
    p "\$ psql -X -At -d $cdb -f state.sql   (state after the refusal)"
    $PSQL -X -At -d $cdb -f "$WORK/state.sql" > "$WORK/state.out" 2>&1; cat "$WORK/state.out" >> "$T"
    local c1=1 c2=1 c3=1 c4=1
    [ $drc -ne 0 ] && c1=0
    grep -q 'tables left: 0' "$WORK/state.out" && c2=0
    grep -q 'functions left: 0' "$WORK/state.out" && grep -q 'ledger 049 rows left: 0' "$WORK/state.out" && c3=0
    grep -q 'bucket rows left: 1' "$WORK/state.out" && grep -q 'STORAGE_REFUSES_SQL_DELETE' "$WORK/last.out" && c4=0
    if [ $variant = new ]; then
      verdict "S-2: the DOWN exits non-zero when Storage refuses (the bucket step failed)" $c1
      verdict "S-2: the MAIN transaction committed anyway (tables left 0)" $c2
      verdict "S-2: functions and the 049 ledger row are gone too (committed)" $c3
      verdict "S-2: the bucket row is still there and the refusal message is in the output" $c4
      p "\$ Storage-API fallback (stand-in: drop the refusing stub trigger, then remove the bucket row)"
      $PSQL -X -q -d $cdb -c "DROP TRIGGER refuse_bucket_delete ON storage.buckets" -c "DELETE FROM storage.buckets WHERE id = 'capture-documents'" >> "$T" 2>&1
      fp $cdb > "$WORK/fp_c.txt"; cmp -s "$WORK/fp_base.txt" "$WORK/fp_c.txt"
      verdict "S-2: after the fallback the catalog fingerprint == the pre-049 baseline" $?
    else
      p "RED observation (not counted): exits non-zero=$([ $c1 -eq 0 ] && echo yes || echo no); main transaction committed (tables left 0)=$([ $c2 -eq 0 ] && echo yes || echo NO -- ROLLED BACK); functions+ledger gone=$([ $c3 -eq 0 ] && echo yes || echo NO -- ROLLED BACK)"
      if [ $c2 -ne 0 ] && [ $c3 -ne 0 ]; then p "FAIL(expected, RED): with the bucket DELETE inside the transaction, a Storage refusal rolls the table drops and the ledger delete back -- the defect S-2 fixes"; C_RED_OK=1; else p "RED did NOT reproduce the defect -- NOT A VALID TEST"; C_RED_OK=0; fi
    fi
  done
  p ""
  p ">>> DOWN RESULT: PASS=$DPASS FAIL=$DFAIL (expected PASS=17)"
  [ "${C_RED_OK:-0}" -eq 1 ] || DFAIL=$((DFAIL+1))
  [ "$DPASS" -eq 17 ] || DFAIL=$((DFAIL+1))
  if [ "$DFAIL" -eq 0 ]; then p ">>> OVERALL T-DOWN: guards tripped (RED) where required, DOWN succeeded (GREEN) after the procedure, catalog back to baseline"; return 0; fi
  p ">>> OVERALL T-DOWN: NOT CLEAN"; return 1
}

case $ID in
  T-B3)   b3;;
  T-DOWN) down;;
  T-B1)   generic T-B1 post:no_triggers;;
  T-B2)   generic T-B2 file:no_b2_insert post:no_tr3_trigger;;
  T-R5)   generic T-R5 post:drop_self_fk;;
  T-D18)  generic T-D18 post:drop_doc_fks;;
  T-CHK)  generic T-CHK post:weak_approver_chk commit:50b929a;;
  T-ORPH) generic T-ORPH flag:red=1;;
  T-TRIG) generic T-TRIG post:no_triggers file:old_order commit:50b929a commit:668956e commit:ecc8e1e;;
  T-RLS)  generic T-RLS file:rls_no_status file:rls_no_role;;
  T-ACL)  LOAD_ASSERT=1; generic T-ACL post:plant_grants commit:50b929a commit:ecc8e1e;;
  T-HELP) HELPER_FILE=$HELPF; generic T-HELP hfile:no_guard;;
  *) echo "unknown or custom test id $ID (custom drivers are added below)" >&2; exit 2;;
esac
