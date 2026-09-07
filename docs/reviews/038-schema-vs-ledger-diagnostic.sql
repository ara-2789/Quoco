-- =============================================================================
-- Migration 038 -- schema-vs-ledger diagnostic, READ-ONLY.
--
-- Run against test-db ONLY, per Aravind's own explicit instruction ("Do not
-- modify test-db yourself. Give me the sequence and I'll run it.") -- this
-- file makes no writes of any kind, and Aravind runs it himself, not Claude
-- Code.
--
-- WHY THIS EXISTS: scripts/rehearse-038.ts correctly stopped at its own
-- gate -- test-db's supabase_migrations.schema_migrations ledger ends at
-- 035, prod's at 037. But a missing LEDGER ENTRY and a missing COLUMN are
-- different facts (036/037 could have been applied out-of-band, the same
-- way 007 originally was on prod, with the ledger just never catching up).
-- This distinguishes the three possibilities named:
--   (a) columns absent    -> apply 036 and 037 to test-db, then repair ledger
--   (b) columns present, ledger missing -> repair ledger only, do NOT re-apply
--   (c) partially present -> stop, something is wrong, needs a human look
-- before anything gets applied.
-- =============================================================================

-- Breadcrumb -- combined with `cat supabase/.temp/project-ref` in the same
-- terminal output (see the run sequence below), not a standalone identity
-- check on its own: current_database() is always "postgres" on every
-- Supabase project, so it does not by itself distinguish test-db from prod.
SELECT current_database() AS db, now() AS checked_at;

-- 1. hindrances columns 036/037 are supposed to add: timing, timing_raw,
--    pm_notified_at.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing', 'timing_raw', 'pm_notified_at')
 ORDER BY column_name;

-- 2. submitted_via -- 036 also does `ALTER COLUMN submitted_via DROP
--    DEFAULT, SET NOT NULL`. Pre-036 it's nullable with a DEFAULT of
--    'whatsapp' (001's own text).
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name = 'submitted_via';

-- 3. The pairing CHECK constraint 036 adds.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'hindrances'::regclass AND conname = 'hindrances_timing_raw_pairing_check';

-- 4. Every FK currently on hindrances -- confirms (i) whether 038's own
--    composite same-tenant FKs are ALREADY present (they should NOT be --
--    038 is unapplied everywhere) and (ii) the exact shape of whatever IS
--    there, for comparison against 036/037/038's own expectations.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'hindrances'::regclass AND contype = 'f'
 ORDER BY conname;

-- 5. Full column list of hindrances, so nothing outside the three named
--    columns is missed -- e.g. if 036/037 partially applied via a manual
--    SQL Editor session, some other column-level artifact might exist that
--    the targeted checks above wouldn't surface.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'hindrances'
 ORDER BY ordinal_position;

-- 6. The ledger itself, for direct side-by-side comparison with the schema
--    facts above in the same output (rather than trusting the CLI's own
--    separately-run `supabase migration list` from earlier).
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

-- 7. COMMENT text on the two columns 036 adds extensive documentation to --
--    if columns are present but comments are NULL/different, that is its
--    own signal about how they got there (a hand-run partial apply is more
--    likely to have skipped the COMMENT ON statements than a full migration
--    file run start to finish).
SELECT column_name, col_description('hindrances'::regclass, ordinal_position) AS comment
  FROM information_schema.columns
 WHERE table_name = 'hindrances' AND column_name IN ('timing', 'timing_raw', 'pm_notified_at')
 ORDER BY column_name;
