#!/bin/bash
# lock-test.sh -- 052 dry-run, N-5 (SQL review round 1): the LOCK-MODE half of the FOR UPDATE claim.
# LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST. Two raw psql sessions, unix socket.
# Proves only that classify holds a row lock strong enough to block FOR KEY SHARE (Postgres semantics).
# It does NOT prove anything about the two-caller race through PostgREST: that stays owed at the test-db rehearsal.
# Env: DB (database name), SRC (dryrun-src dir). PG env vars (PGHOST...) come from the runner.
P() { psql -X -q -At -v ON_ERROR_STOP=0 -d "$DB" "$@"; }
DOC=$(P -c "select id from public.capture_documents where source_message_sid='m-e2'")
echo "document m-e2 = $DOC (unclassified: $(P -c "select kind is null from public.capture_documents where id='$DOC'"))"

echo
echo "=== CONTROL: session 1 holds only FOR NO KEY UPDATE (the lock a non-key update takes); session 2 FOR KEY SHARE must NOT block"
( P -c "BEGIN; select 'S1 begin ' || clock_timestamp()::time(3); select id from public.capture_documents where id='$DOC' for no key update; select 'S1 holds NO KEY UPDATE ' || clock_timestamp()::time(3); select pg_sleep(5); COMMIT; select 'S1 commit ' || clock_timestamp()::time(3);" > /tmp/lock-s1-ctl.$$ 2>&1 ) &
sleep 1.5
P -c "set lock_timeout='2s'; select 'S2 start ' || clock_timestamp()::time(3); begin; select id from public.capture_documents where id='$DOC' for key share; select 'S2 acquired FOR KEY SHARE ' || clock_timestamp()::time(3); commit;" 2>&1
wait
cat /tmp/lock-s1-ctl.$$; rm -f /tmp/lock-s1-ctl.$$

echo
echo "=== TEST: session 1 classifies the document (as the PM) and has NOT committed; session 2 FOR KEY SHARE must time out"
( P -c "BEGIN; select 'S1 begin ' || clock_timestamp()::time(3); select t.try_as('authenticated','40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text','$DOC','dc')); select 'S1 classified, NOT committed ' || clock_timestamp()::time(3); select pg_sleep(6); COMMIT; select 'S1 commit ' || clock_timestamp()::time(3);" > /tmp/lock-s1.$$ 2>&1 ) &
sleep 2
echo "-- session 2 while session 1 holds the uncommitted classify:"
P -c "set lock_timeout='2s'; select 'S2 start ' || clock_timestamp()::time(3); begin; select id from public.capture_documents where id='$DOC' for key share; select 'S2 acquired FOR KEY SHARE ' || clock_timestamp()::time(3);" 2>&1
wait
cat /tmp/lock-s1.$$; rm -f /tmp/lock-s1.$$
echo "-- session 2 again AFTER session 1 committed:"
P -c "set lock_timeout='2s'; select 'S2 start ' || clock_timestamp()::time(3); begin; select id from public.capture_documents where id='$DOC' for key share; select 'S2 acquired FOR KEY SHARE ' || clock_timestamp()::time(3); commit;" 2>&1
echo "-- state: document now classified by the PM: $(P -c "select kind || '/' || kind_source from public.capture_documents where id='$DOC'")"
