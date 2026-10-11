\pset format aligned
\pset tuples_only off
\echo -- OBSERVER session (a third connection) while both writers are open: proves the sessions really overlap
SELECT pid, state, wait_event_type, wait_event, left(query, 80) AS query FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid() AND state <> 'idle' ORDER BY query_start;
