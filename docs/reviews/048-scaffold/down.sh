#!/bin/zsh
# DOWN rehearsal on the disposable scaffold (CLAUDE.md §7: the DOWN is rehearsed and verified, not only written).
#   1. clone the pristine pre-048 baseline; apply 048 (UP)
#   2. extract the commented DOWN block ('-- BEGIN;' .. '-- COMMIT;', comment prefix stripped) and run it
#   3. diff a schema-only pg_dump of the result against the baseline's -- the dump includes COMMENT ON
#      statements, ACLs, constraints and defaults, so this checks comments and grants too (CLAUDE.md §7)
#   4. re-apply UP on the reverted database: UP -> DOWN -> UP must work
# Environment (the DISPOSABLE local cluster only): SCAF_PSQL, SCAF_PGDUMP (command prefixes), SCAF_TMP.
# This is the SCAFFOLD rehearsal. The full-tier rehearsal on the cleaned TEST-DB, with captured output, is still owed.
set -u
HERE=${0:A:h}
REPO=${HERE:h:h:h}
FILE=$REPO/docs/reviews/048_engineer_registration.sql
DB=scaf_down

$=SCAF_PSQL -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE scaf_base" || exit 1
strip() { grep -v '^\\\(un\)\{0,1\}restrict' ; }

echo "== dump BEFORE (baseline, pre-048)"
$=SCAF_PGDUMP -d $DB --schema-only --schema=public | strip > $SCAF_TMP/down-before.sql
wc -l < $SCAF_TMP/down-before.sql

echo "== UP"
$=SCAF_PSQL -d $DB -q -v ON_ERROR_STOP=1 -f $FILE > /dev/null && echo "UP applied, exit 0"
$=SCAF_PGDUMP -d $DB --schema-only --schema=public | strip > $SCAF_TMP/down-after-up.sql
echo "dump after UP differs from baseline by $(diff $SCAF_TMP/down-before.sql $SCAF_TMP/down-after-up.sql | grep -c '^[<>]') lines (expected: >0)"

echo "== extracted DOWN (comment prefix stripped)"
python3 - "$FILE" > $SCAF_TMP/down.sql <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
marker = next(i for i, l in enumerate(lines) if l.startswith("-- DOWN ("))
start = next(i for i in range(marker, len(lines)) if lines[i].strip() == "-- BEGIN;")
end = next(i for i in range(start, len(lines)) if lines[i].strip() == "-- COMMIT;")
for l in lines[start:end + 1]:
    print(l[3:] if l.startswith("-- ") else "")
PY
cat $SCAF_TMP/down.sql

echo "== DOWN"
$=SCAF_PSQL -d $DB -q -v ON_ERROR_STOP=1 -f $SCAF_TMP/down.sql && echo "DOWN applied, exit 0"
$=SCAF_PGDUMP -d $DB --schema-only --schema=public | strip > $SCAF_TMP/down-after-down.sql
echo "== diff baseline vs after-DOWN (schema, comments, ACLs, constraints, defaults, functions)"
diff $SCAF_TMP/down-before.sql $SCAF_TMP/down-after-down.sql > $SCAF_TMP/down-diff.txt
echo "diff exit $? ; differing lines: $(grep -c '^[<>]' $SCAF_TMP/down-diff.txt)"
cat $SCAF_TMP/down-diff.txt

echo "== UP again on the reverted database"
$=SCAF_PSQL -d $DB -q -v ON_ERROR_STOP=1 -f $FILE > /dev/null && echo "UP re-applied, exit 0"
$=SCAF_PSQL -d $DB -Atc "select 'functions after re-UP: ' || count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('add_engineers_to_project','engineer_admin_gate')"
