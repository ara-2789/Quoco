#!/bin/bash
# 050 PG17 scaffold dry-run runner (block 10). Runs ONLY against a disposable LOCAL cluster; refuses any remote host.
#   usage: run050.sh <out-dir>     env: PGHOST PGPORT PGUSER (local), UP=<path to 050 UP>, DOWN=<path to the test-db DOWN>
# The scaffold database quoco_050_scaffold = a REAL structure-only dump of test-db public (which already carries 049)
# + the named stubs of docs/reviews/049-sql-evidence/scaffold-stubs.sql + roles. Each scenario clones it, applies the 050 UP,
# loads the 049 fixtures and the 050 helpers, and runs one scenario file.
set -u
OUT=${1:?out dir}
ROOT=$(git rev-parse --show-toplevel)
EV=$ROOT/docs/reviews/050-sql-evidence/src
E49=$ROOT/docs/reviews/049-sql-evidence/src
UP=${UP:-$ROOT/docs/reviews/050_material_inward_functions.sql}
DOWN=${DOWN:-$ROOT/docs/reviews/050-down-testdb.sql}
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket dir or localhost" >&2; exit 2;; esac
mkdir -p "$OUT"
PSQL="psql -X -q"
mk() { # mk <db> [up-file]
  $PSQL -d postgres -c "DROP DATABASE IF EXISTS \"$1\"" -c "CREATE DATABASE \"$1\" TEMPLATE quoco_050_scaffold" >/dev/null 2>&1
  echo "\$ psql -d $1 -v ON_ERROR_STOP=1 -f $(basename "${2:-$UP}")   (050 UP)"
  $PSQL -d "$1" -v ON_ERROR_STOP=1 -f "${2:-$UP}" 2>&1; echo "[exit $?]"
  $PSQL -d "$1" -v ON_ERROR_STOP=1 -f "$E49/_lib.sql" >/dev/null 2>&1
  $PSQL -d "$1" -v ON_ERROR_STOP=1 -f "$E49/_fixture.sql" 2>&1 | head -5
  $PSQL -d "$1" -v ON_ERROR_STOP=1 -f "$EV/_lib050.sql" 2>&1 | head -5
}
hdr() { echo "== 050 scaffold dry-run: $1 =="; echo "generated: $(date -u +%FT%TZ)"; echo "HEAD: $(git rev-parse HEAD)"; echo "sha256 UP: $(shasum -a 256 "$UP" | cut -d' ' -f1)"; echo "sha256 scenario: $(shasum -a 256 "$2" 2>/dev/null | cut -d' ' -f1)"; psql -X -At -d postgres -c "select version()"; echo; }
scn() { # scn <name> <scenario file> [up-file]
  { hdr "$1" "$2"; mk "d_$1" "${3:-$UP}"; echo; echo "--- scenario output (psql -e echoes every statement) ---"; $PSQL -e -d "d_$1" -f "$2" 2>&1; echo; } > "$OUT/$1.txt" 2>&1
  echo "$1: PASS=$(grep -c 'PASS: ' "$OUT/$1.txt") FAIL=$(grep -c 'FAIL: ' "$OUT/$1.txt") psql-ERROR=$(grep -c 'ERROR:' "$OUT/$1.txt")"
}
case "${2:-all}" in
  S1) scn S1-engineer "$EV/S1-engineer.sql";;
  S2) scn S2-b1 "$EV/S2-b1.sql";;
  S3) scn S3-n2n13 "$EV/S3-n2n13.sql";;
  S4) scn S4-pm "$EV/S4-pm.sql";;
  S3RED) scn S3-red "$EV/S3-red.sql";;
  S4MUT) # RED for T-E8-RERAISE: the handler's bare RAISE; replaced by NULL (a swallowing handler)
    sed "s/^    RAISE;          -- every other 23505 is re-raised unchanged; never swallowed, never translated/    NULL;           -- MUTANT: swallows every other 23505/" "$UP" > /tmp/quoco/050-mutant-swallow.sql
    echo "mutant differs from UP in $(diff "$UP" /tmp/quoco/050-mutant-swallow.sql | grep -c '^>') line(s)"
    scn S4-pm-MUTANT-swallow "$EV/S4-pm.sql" /tmp/quoco/050-mutant-swallow.sql;;
  all) for s in S1-engineer S2-b1 S3-n2n13 S4-pm; do scn "$s" "$EV/$s.sql"; done;;
esac
