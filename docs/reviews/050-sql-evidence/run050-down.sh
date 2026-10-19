#!/bin/bash
# 050 DOWN dry-run on the disposable LOCAL scaffold (block 10). Never touches test-db or prod.
#   usage: run050-down.sh <out-dir>     env: PGHOST PGPORT PGUSER (local), UP, DOWN
set -u
OUT=${1:?out dir}
ROOT=$(git rev-parse --show-toplevel)
EV=$ROOT/docs/reviews/050-sql-evidence/src; E49=$ROOT/docs/reviews/049-sql-evidence/src
UP=${UP:-$ROOT/docs/reviews/050_material_inward_functions.sql}
DOWN=${DOWN:-$ROOT/docs/reviews/050-down-testdb.sql}
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be local" >&2; exit 2;; esac
# [SQL review r1, per Aravind 18 Oct] N-6: an OFFICIAL transcript needs an empty `git status --porcelain` (the artifacts COMMITTED
# first; transcripts are written OUTSIDE the repo) so the HEAD recorded below IS the artifact commit. DEV=1 allows a dirty tree.
if [ "${DEV:-0}" != "1" ] && [ -n "$(git status --porcelain)" ]; then echo "refusing: the tree is dirty (commit the artifacts first, or DEV=1 for a non-official run)" >&2; git status --porcelain >&2; exit 2; fi
mkdir -p "$OUT"; T=$OUT/S5-down.txt; : > "$T"
P="psql -X -q"
say() { printf '%s\n' "$*" >> "$T"; }
run() { printf '$ %s\n' "$*" >> "$T"; "$@" >> "$T" 2>&1; local rc=$?; printf '[exit %s]\n' "$rc" >> "$T"; return $rc; }
mk() { $P -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\" TEMPLATE quoco_050_scaffold" >/dev/null 2>&1
  $P -d "$1" -v ON_ERROR_STOP=1 -f "$UP" >/dev/null 2>&1 || say "UP FAILED on $1"
  $P -d "$1" -f "$E49/_lib.sql" >/dev/null 2>&1; $P -d "$1" -f "$E49/_fixture.sql" >/dev/null 2>&1; $P -d "$1" -f "$EV/_lib050.sql" >/dev/null 2>&1; }
say "== 050 DOWN dry-run (local scaffold) =="; say "generated: $(date -u +%FT%TZ)"; say "HEAD: $(git rev-parse HEAD)"; say "git status --porcelain (empty between the markers = clean tree):"; say "----- begin porcelain -----"; git status --porcelain >> "$T"; say "----- end porcelain -----"
say "sha256 UP:   $(shasum -a 256 "$UP" | cut -d' ' -f1)"; say "sha256 DOWN: $(shasum -a 256 "$DOWN" | cut -d' ' -f1)"; say ""

say "=== A. DOWN with a live in-flight session ==="
mk d_down
$P -d d_down -e >> "$T" 2>&1 <<'SQL'
SELECT t.turn('+91950000001', '4', 'dn-s0', NULL, true) \gset
SELECT t.turn('+91950000001', '1', 'dn-s1') \gset
SELECT t.turn('+91950000001', NULL, 'dn-s2', t.media(1)) \gset
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91950000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','morning',1,'{"invoice_reset_guard":"morning"}', now()+interval '20 minutes', now()),
       ('+91950000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',NULL,0,'{"morning_submitted":true,"mi_last_sid":"z","mi_kind":"dc"}', now()+interval '20 minutes', now());
INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('049', ARRAY['x'], 'capture_tables'), ('050', ARRAY['x'], 'material_inward_functions');
SELECT 'BEFORE: ' || phone_number || ' ' || coalesce(current_flow,'NULL') || '/' || current_step || ' ' || context::text AS sessions FROM public.whatsapp_sessions WHERE phone_number LIKE '+9195%' ORDER BY 1;
SELECT t.ok('before: the in-flight session works (S3 ack accepted) -- the same turn that must still be safe after the DOWN', (t.turn('+91950000001','1','dn-ack')->>'outcome') = 'complete');
UPDATE public.whatsapp_sessions SET current_flow = 'invoice', current_step = 3, context = context || '{"mi_kind":"dc","mi_last_sid":"dn-s2"}' WHERE phone_number = '+91950000001';
SQL
run $P -d d_down -v ON_ERROR_STOP=1 -f "$DOWN"
$P -d d_down -e >> "$T" 2>&1 <<'SQL'
SELECT 'AFTER: ' || phone_number || ' ' || coalesce(current_flow,'NULL') || '/' || current_step || ' ' || context::text AS sessions FROM public.whatsapp_sessions WHERE phone_number LIKE '+9195%' ORDER BY 1;
SELECT t.ok('T-DOWN-1: no invoice session and no flag/flow-owned key on ANY row', (SELECT count(*) = 0 FROM public.whatsapp_sessions WHERE current_flow = 'invoice' OR context ?| ARRAY['mi_last_sid','mi_kind','mi_document_id','mi_reask','invoice_reset_guard']));
SELECT t.ok('subtract-only: morning_submitted survived on the idle row', (SELECT context = '{"morning_submitted": true}'::jsonb FROM public.whatsapp_sessions WHERE phone_number = '+91950000003'));
SELECT t.ok('S-2: the 050 ledger row was deleted by the DOWN and the 049 row is untouched', (SELECT count(*) = 0 FROM supabase_migrations.schema_migrations WHERE version = '050') AND (SELECT count(*) = 1 FROM supabase_migrations.schema_migrations WHERE version = '049'));
SELECT t.ok('the seven functions are gone', (SELECT count(*) = 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details','pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice')));
SELECT t.ok('the restored bodies equal the captured md5s', md5(pg_get_functiondef('public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure)) = '707c10fe09dfd5a7cd065f7826eacd46' AND md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure)) = 'd19d07507abccdaf7d54ee1d74419af7');
SELECT t.ok('049 data untouched by the DOWN (documents, files, deliveries still there)', (SELECT count(*) FROM public.capture_documents) >= 1 AND (SELECT count(*) FROM public.capture_files) >= 1 AND (SELECT count(*) FROM public.deliveries) >= 1);
SELECT public.apply_morning_flow_turn('+91950000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','',true) AS morning_start_after_down;
SELECT t.ok('after the DOWN a scheduled morning start over the former invoice session STARTS (outcome start, not reask)', (SELECT current_flow = 'morning' AND current_step = 1 FROM public.whatsapp_sessions WHERE phone_number = '+91950000001'));
SELECT public.apply_morning_flow_turn('+91950000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','yes',false) AS turn_on_row_that_carried_the_flag;
SELECT t.ok('a row that carried the flag processes a normal turn after the DOWN (step 2)', (SELECT current_step = 2 FROM public.whatsapp_sessions WHERE phone_number = '+91950000002'));
SELECT t.expect('the dropped engineer function no longer exists (42883)', $$SELECT public.apply_material_inward_turn('+91950000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','1','sid-after-down')$$, '42883');
SQL

race_setup() { $P -d "$1" -v ON_ERROR_STOP=1 -c "SELECT t.turn('+91960000001','4','race-s0',NULL,true)" >/dev/null 2>&1
  $P -d "$1" -At -c "select 'race row before: ' || coalesce(current_flow,'NULL') || ' ' || context::text from public.whatsapp_sessions where phone_number='+91960000001'" >> "$T" 2>&1; }
race() { # race <db> <down file> <turn-hold-seconds> <label>
  say ""; say "=== $4 ==="; say "turn A: BEGIN; SELECT ... FOR UPDATE; pg_sleep($3); UPDATE ... context || {turn:1}; COMMIT.   DOWN B starts 0.7s later (lock_timeout 3s)."
  ( $P -d "$1" -v ON_ERROR_STOP=1 >> "$T.A" 2>&1 <<SQL
BEGIN;
SELECT id FROM public.whatsapp_sessions WHERE phone_number = '+91960000001' FOR UPDATE;
SELECT pg_sleep($3);
UPDATE public.whatsapp_sessions SET context = context || '{"turn":1}'::jsonb WHERE phone_number = '+91960000001';
COMMIT;
SQL
    echo "[turn A exit $?]" >> "$T.A" ) &
  local pa=$!
  sleep 0.7
  ( $P -d "$1" -v ON_ERROR_STOP=1 -f "$2" >> "$T.B" 2>&1; echo "[DOWN B exit $?]" >> "$T.B" ) &
  local pb=$!
  wait $pa; wait $pb
  say "--- turn A output ---"; cat "$T.A" >> "$T" 2>/dev/null; say "--- DOWN B output ---"; cat "$T.B" >> "$T" 2>/dev/null; rm -f "$T.A" "$T.B"
  $P -d "$1" -At -c "select 'race row after: ' || coalesce(current_flow,'NULL') || ' ' || context::text from public.whatsapp_sessions where phone_number='+91960000001'" >> "$T" 2>&1
  $P -d "$1" -At -c "select 'seven functions left: ' || count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details','pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice')" >> "$T" 2>&1
}
mk d_race; race_setup d_race
race d_race "$DOWN" 2 "B. CONCURRENT TURN vs DOWN with EXCLUSIVE (must NOT deadlock; the turn commits, then the DOWN clears)"
mk d_race_red; race_setup d_race_red
sed "s/LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;/LOCK TABLE public.whatsapp_sessions IN SHARE ROW EXCLUSIVE MODE;/" "$DOWN" > /tmp/quoco/050-down-sre.sql
say ""; say "(RED mutant: SHARE ROW EXCLUSIVE; lines differing from the DOWN: $(diff "$DOWN" /tmp/quoco/050-down-sre.sql | grep -c '^>'))"
race d_race_red /tmp/quoco/050-down-sre.sql 2 "C. RED: the SAME race with SHARE ROW EXCLUSIVE (review r1's mode) -- expected: deadlock detected"
mk d_race_to; race_setup d_race_to
race d_race_to "$DOWN" 6 "D. lock_timeout: the turn holds the row 6s, the DOWN gives up after 3s and changes NOTHING"
say ""; say "=== end ==="
