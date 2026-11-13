#!/bin/bash
# Throwaway local PG17 cluster for the 052 dry-run. Unix socket only (listen_addresses=''), no TCP.
set -eu
export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
D=<local-path>
SOCK=$D/sock
B=<local-path>
pg_ctl -D $D/data stop -m immediate >/dev/null 2>&1 || true
rm -rf $D; mkdir -p $SOCK
initdb -D $D/data -U postgres -A trust --no-locale -E UTF8 >/dev/null
pg_ctl -D $D/data -o "-c listen_addresses='' -c unix_socket_directories=$SOCK -c port=54417" -l $D/server.log -w start >/dev/null
export PGHOST=$SOCK PGPORT=54417 PGUSER=postgres
createdb scaffold
psql -v ON_ERROR_STOP=1 -X -q -d scaffold <<'SQL'
-- NAMED STUBS (CLAUDE.md section 7): roles, auth schema. Nothing else from the platform.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE EXTENSION vector SCHEMA public;  -- named stub: pgvector is not in a structure-only dump
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- auth.uid(): reads the same GUC the real one reads, so a test can SET LOCAL it. (Real: request.jwt.claim.sub / request.jwt.claims.)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Ledger stub (the dump is public-only): a table shaped like supabase_migrations.schema_migrations.
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
SQL
psql -v ON_ERROR_STOP=0 -X -q -d scaffold -f $B/schema.sql > $B/3b-load.out 2> $B/3b-load.err || true
echo "load: exit $?  ERROR lines: $(grep -c ERROR $B/3b-load.err)"
psql -X -At -d scaffold -c "select version()"
