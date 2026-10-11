-- NAMED STUBS (CLAUDE.md section 7). Everything in this file is a STUB: hand-written, NOT from the real dump.
-- The real structure comes from 049-schema.sql (pg_dump of test-db public, structure only).

-- STUB 1: extension. The dump does not CREATE EXTENSION; public.vector is referenced by the dump.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- STUB 2: auth schema. auth.users + auth.uid(). auth.uid() reads request.jwt.claim.sub (as Supabase's does),
-- so an RLS scenario can SET it; with no setting it returns NULL (the CLAUDE.md-minimal behaviour).
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- STUB 3: minimal storage schema. CANNOT show real Storage behaviour (no Storage API, no real bucket
-- constraints, no object-level size/MIME enforcement). That is block 2b on test-db.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name      text
);

-- STUB 4: migration ledger, so the DOWN block's ledger DELETE has a table to run against.
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
