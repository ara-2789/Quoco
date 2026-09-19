#!/bin/zsh
# One scaffold run: clone the pristine pre-048 baseline, apply 048 (real, mutated, or none), run tests.sql.
#
#   run.sh real            the committed 048 file, unmodified
#   run.sh base            NO 048 applied (the natural red: the function and columns are absent)
#   run.sh <mutant>        a red variant from mutate.py (see that file for the list)
#
# Environment (all point at the DISPOSABLE local cluster, never a remote database):
#   SCAF_PSQL   psql command prefix incl. host/socket/port/user, e.g. "psql -h /path/sock -p 54329 -U postgres"
#   SCAF_TMP    scratch directory
# The baseline database `scaf_base` is stubs.sql + a schema-only dump of test-db, loaded once (CLAUDE.md §7).
set -u
HERE=${0:A:h}
REPO=${HERE:h:h:h}
FILE=$REPO/docs/reviews/048_engineer_registration.sql
MODE=$1
DB=scaf_run_$MODE

$=SCAF_PSQL -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE scaf_base" || exit 1

case $MODE in
  base) echo "== apply: NONE (baseline, pre-048)";;
  real) APPLY=$FILE;;
  *)    python3 $HERE/mutate.py $MODE $FILE > $SCAF_TMP/mutant-$MODE.sql || { echo "== MUTATION DID NOT APPLY"; exit 1; }
        APPLY=$SCAF_TMP/mutant-$MODE.sql;;
esac
if [ "$MODE" != base ]; then
  $=SCAF_PSQL -d $DB -q -v ON_ERROR_STOP=1 -f $APPLY > $SCAF_TMP/apply-$MODE.out 2>&1
  echo "== apply $MODE: exit $? ($(basename $APPLY))"
  grep -E 'ERROR' $SCAF_TMP/apply-$MODE.out | head -3
fi
$=SCAF_PSQL -d $DB -q -f $HERE/tests.sql > $SCAF_TMP/tests-$MODE.out 2>$SCAF_TMP/tests-$MODE.err
grep -E '^FAIL|^SUMMARY' $SCAF_TMP/tests-$MODE.out | cut -c1-230
