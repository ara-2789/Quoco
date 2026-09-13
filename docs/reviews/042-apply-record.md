# Migration 042 apply record

Stage 0 of the media capability (`docs/plans/media-capture-design.md` item
20; full plan `docs/plans/stage0-storage-setup-plan.md`). Applied by hand
by Aravind, outside this session — this document is the post-apply
paperwork, written from the facts he reported, not re-derived or
independently re-verified against a live connection (this session has no
Supabase credentials of any kind).

## What this migration does

One statement: `INSERT INTO storage.buckets (id, name, public) VALUES
('daily-log-photos', 'daily-log-photos', false) ON CONFLICT (id) DO
NOTHING`. No table, no RLS policy, no ingestion code. Access control is
`service_role`-only application code (`lib/storage/photo-access.ts`'s
`getSignedPhotoUrl()`) — see the migration's own header and
`docs/plans/stage0-storage-setup-plan.md` §4 for the full reasoning; not
repeated here.

## Pre-apply probe — PROD

```sql
SELECT count(*) FROM storage.buckets;
```
**`count = 0`.** This product had never had a Storage bucket before this
migration — the first object storage in this product's history, confirmed
directly rather than assumed from "nothing in the migrations directory
creates one."

## The reservation's own open question — ANSWERED

`docs/reviews/042_storage_bucket_setup.sql`'s own header (and
`docs/plans/stage0-storage-setup-plan.md` §9) carried this as an
unverified dependency: whether this project's normal CLI apply path
(`supabase db query --linked -f <file>`) has sufficient Postgres privilege
to write `storage.buckets`, which lives in Supabase's managed `storage`
schema, not this project's own `public` schema. **It does.** The apply
below succeeded with no privilege error. No dashboard exception was
needed — for this migration, or, by the same reasoning, for future
Storage work that stays within normal `INSERT`/`CREATE POLICY`-shaped
statements against Supabase-managed schemas.

## File moved into `supabase/migrations/`

```
$ git mv docs/reviews/042_storage_bucket_setup.sql supabase/migrations/042_storage_bucket_setup.sql
```
Per CLAUDE.md's own "a migration file enters `supabase/migrations/` when it
is being applied, not when it is written" rule — done immediately before
the apply, same session, not earlier.

## Apply — PROD

```
$ supabase link --project-ref jvxwqignooseazzmwhvl
$ supabase db query --linked -f supabase/migrations/042_storage_bucket_setup.sql
```
No error.

### Post-apply readback — PROD, confirmed by observation

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'daily-log-photos';
```
```
id: daily-log-photos
name: daily-log-photos
public: false
```
**Confirmed by observation, not by trusting the migration's own text** —
per CLAUDE.md's own "rollback mechanisms are verified by observation, never
by checklist status" rule, applied here to the bucket's access flag: the
`INSERT` statement saying `public = false` is not, on its own, evidence
that the live row actually landed that way. This `SELECT` is that evidence.

### Ledger — PROD

```
$ supabase migration repair --status applied 042 --linked
Repaired migration history: [042] => applied
$ supabase migration list --linked
```
Local and Remote match through `042`, no gaps.

## Apply — test-db

Also applied to test-db (`exfccwlrhoutkgrlikod`) — same command, same file,
link switched accordingly. Bucket confirmed present and private on test-db
by direct observation (`SELECT public FROM storage.buckets` → `false`) —
this is the same bucket the cross-tenant isolation suite
(`test/storage-photo-access.test.ts`) ran its real 5/5 pass against (see
that suite's own build/fix history, `docs/plans/stage0-storage-setup-
plan.md` and the PR that carried it, for the full test evidence — not
repeated here). Ledger repaired the same way as prod.

## types/database.ts regeneration — DELIBERATELY NOT RUN, and why

This is a **recorded exception**, not a repeat of the drop that happened on
migrations 029, 030, and 031. `storage.buckets` lives in the `storage`
schema. `npx supabase gen types typescript --linked --schema public`
regenerates types for the `public` schema only — it has **no diff to give**
for this migration, by construction, regardless of whether it's run.
Running it would produce a clean, empty diff that **proves nothing** —
indistinguishable from "the command was never run" or "the command failed
silently." Skipping it here is not the same failure as 029/030/031's own
drops, where a real, expected diff was simply never checked for. If a
future migration ever adds a `public`-schema table or column related to
storage (e.g. `daily_log_photos`, stage 1+), that migration owns its own
types regen — this one has nothing to regen.

## Reservation entry updated

`scripts/migration-number-reservations.json`'s `"042"` entry now carries a
dated correction recording the apply — see that file directly. While
updating it, the same audit found three OTHER entries (034, 039, 040, 041)
carrying the identical stale "held, pending review" language for migrations
that have long since been applied — corrected in the same pass; see that
file's own dated corrections for each. Full findings reported separately
(not duplicated here — this document is 042's own apply record, not a
reservations-file audit).

## Scope, restated

No ingestion, no `daily_log_photos` table, no retention, no webhook or flow
change, no dashboard UI. All later stages
(`docs/plans/stage1-photo-intake-plan.md` onward).
