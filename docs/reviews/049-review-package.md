# 049 SQL review package — capture tables (PR-A), block 2a

Written 11 Oct 2026. Migration 049 is **FULL tier**. This block touched **no Supabase database** (test-db and prod untouched; the only database written to is a disposable local PG 17 cluster). The migration is **HELD, not applied**. Nothing here is an apply GO.

## 1. Repo-state header

- `main` @ `0289bcfacccc3c97738624e764e11b853f944726` (fetched 11 Oct; `git ls-remote origin refs/heads/main` returns the same SHA).
- Branch `feat/049-capture-tables`. **Artifact commit** (the one every transcript names): `f26c7eddb8813001c0a32f83fef644a28edecbb1`. The branch head is the next commit, which adds this package and the transcripts; its SHA is in the hand-off report from `git ls-remote`, not here (a file cannot name the commit that contains it).
- `supabase migration list`, prod: 44 rows, local = remote on all 44, last row 048 — from `049-plan-evidence/prod-P13-raw.json`, 11 Oct. **Not re-run in this block** (no Supabase command that links or writes was permitted).
- Last runbook executed: 048 prod apply, 2026-09-21 (`scripts/migration-number-reservations.json`, 048 entry).
- Number 049: `supabase/migrations/` ends at 048; the reservations file now carries a 049 entry naming the held file. Not checked against sibling worktrees (isolated worktree; same stated limit as 044–048).

## 2. Pinned artifacts

Hashes taken with `git show f26c7ed:<path> | shasum -a 256`, and the same values are echoed at the top of every transcript (`shasum` frame).

| Artifact | sha256 | git blob |
|---|---|---|
| `docs/reviews/049_capture_tables.sql` (973 lines) | `1f0ad956633d084d2c92d4f50a8ccb53529a73c3f20745bda72b94f7cee68bc4` | `c56af3a7929fcc9d957649f50d35e312867c0257` |
| `scripts/test-db-only-capture-helpers.sql` | `4842ed8f8546152d233cc873f3c5c058f3d944b047a8661ff280bc386de761f3` | `fac582130a10b63ec10d734d95a4d3a6d4a15901` |

Reviewer: `git show f26c7ed:docs/reviews/049_capture_tables.sql` is the file; do not trust a GitHub branch view.

The header of the SQL file carries a source-id → line-range map generated from the `-- [src: ...]` markers in the file itself (`genmap` was a throwaway script outside the repo; the map was re-checked against the final file: 86 of 86 map lines match the markers).

## 3. The PG 17 scaffold (CLAUDE.md section 7)

**Real structure, not hand-built.** `supabase --workdir <main checkout> db dump --linked --schema public --dry-run` with the linked ref printed first (`exfccwlrhoutkgrlikod`, equal to test-db's; read from `supabase/.temp/project-ref`, no link created). The dry-run script went to a mode-600 file, was never printed, was run (it is the CLI's own `pg_dump` invocation; local `pg_dump` 17.11, no Docker), and was deleted. Output: 206,211 bytes, 4,611 lines; credential-pattern scan of the dump: 0. This was a READ of test-db. Log: `049-sql-evidence/scaffold-build.txt`.

**Loaded into** `quoco_049_scaffold` on a private cluster (own data dir, own socket dir, own port; the user's `:5432` instance was not touched). Dump loaded with `ON_ERROR_STOP`: 0 errors, 32 public tables, 136 public functions. The dump carries test-db's real `ALTER DEFAULT PRIVILEGES` (so the per-role REVOKE is tested against the real default ACL, not an empty one).

**Named stubs** (`049-sql-evidence/scaffold-stubs.sql`; each is hand-written, not from the dump):
1. Roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_auth_admin` — Supabase role *shapes*; `postgres` is the cluster superuser.
2. Extension `vector` in `public` (the dump references `public.vector`; it does not create the extension).
3. `auth` schema: `auth.users(id)` and `auth.uid()`. **Differs from the CLAUDE.md minimal stub:** `auth.uid()` reads `request.jwt.claim.sub` (as Supabase's does) so the RLS test can impersonate users; with no setting it returns NULL.
4. **`storage` schema — STUB:** `storage.buckets(id, name, public, file_size_limit, allowed_mime_types)` and `storage.objects(id, bucket_id, name)`. **This stub cannot show real Storage behaviour**: no Storage API, no object-level size/MIME enforcement, no refusal of direct SQL writes to `storage.*`. The bucket INSERT/DELETE on real Storage, MIME/size refusal (T-BKT), and the full DOWN are **block 2b on test-db**.
5. `supabase_migrations.schema_migrations(version, statements, name)` — so the DOWN's ledger DELETE has a table.

**Version.** Local server and tools are **PG 17.11**; test-db and prod are **17.6** (same major, different minor). Stated, not hidden.

**Concurrency.** The T-B3 races use separate `psql` processes against this local cluster and are genuinely concurrent (an observer connection in each transcript shows one writer in `pg_sleep` and the other waiting on a lock). The CLAUDE.md sandbox limit concerns concurrent *RPC calls through the JS client against test-db*; it does not apply here. It still applies to PR-B: the PR-B functions' own race tests remain **CI-only, not verified locally**.

**Helpers** (`scripts/test-db-only-capture-helpers.sql`) were loaded only in T-HELP and T-DOWN (phase A). Every other scenario ran without them.

## 4. Transcripts (`docs/reviews/049-sql-evidence/`)

Each transcript starts with the worktree HEAD SHA, `git status --porcelain` (empty between its two marker lines), `psql --version` and the server version, and the artifact hashes; `psql -e` echoes every statement above its result. Each shows RED run(s) against a **named mutant** (the test must FAIL) and then the GREEN run against the real file (0 FAIL). Source for every scenario and the runner are in `src/` and `run.sh`.

| File | What it proves | RED mutant | GREEN |
|---|---|---|---|
| `T-B1.txt` | link then reject refused (E13); unlink then reject succeeds; same for an automatic delivery | all four triggers dropped | PASS=10 |
| `T-B2.txt` | fully-consistent forged INSERT refused (E10); caller snapshot on UPDATE overwritten by TR3 | TR1 B2 refusal removed; TR3 trigger dropped | PASS=11 |
| `T-B3.txt` | link-vs-retype race, two real sessions: READ COMMITTED both orders (E6 / E3) and REPEATABLE READ (E14) | `no_tr4b`; `no_for_share`; `no_guard` (end state breaks the invariant in each) | 4/4/4 |
| `T-R5.txt` | `self_invoice_id` generated column in an FK on PG 17: wrong invoice 23503, correct inserts, RESTRICT both ways | `dil_self_link_fk` dropped | PASS=9 |
| `T-D18.txt` | fixed-value kind columns: wrong kind, other project, other tenant → 23503 | both document FKs dropped | PASS=11 |
| `T-CHK.txt` | the section 3 CHECK combinations incl. the NULL-status case, NULL-safety of every implication CHECK, ordering CHECKs, `storage_path` prefix, size cap | reviewer's round-1 NULL-passing CHECK form substituted (fails exactly the NULL-status case) | PASS=52 |
| `T-ORPH.txt` | three orphan probes return 0 after create-DC, create-invoice, link, unlink-with-restore, reject-automatic, reject-DC-with-restore | flow mutant: path 4 without the restore step + planted orphans | PASS=22 |
| `T-DOWN.txt` | S-D order: guard trips while helpers exist; succeeds after the helpers' DOWN; catalog fingerprint == pre-049 baseline; `col_description` comments check; guard 1 (rows) and guard 2 (any other function naming the tables, incl. a non-public schema and a planted future function) | the guard trips are the RED | PASS=12 |
| `T-ACL.txt` | `has_table_privilege` matrix (3 roles × 8 privileges × 4 tables = 96 cells), column grants, PUBLIC grants, `prosecdef`/`proconfig`/owner/EXECUTE per function, real 42501 denials per role | planted GRANTs | PASS=66 |
| `T-TRIG.txt` (extra) | TR1–TR5, A33, every E-code, D-23 lock, E14 under RR and SERIALIZABLE | all four triggers dropped | PASS=54 |
| `T-RLS.txt` (extra) | D-20 audience: PM of the project only; QS, admin-without-membership, deactivated, pending, cross-project, cross-tenant, anon see nothing | status clause removed; role clause removed | PASS=19 |
| `T-HELP.txt` (extra) | Option Y helpers: tenant guard, jsonb-key column list, triggers still fire, ACL, cleanup | tenant guard removed (actually deletes a non-fixture row) | PASS=23 |

Also in the directory: `scaffold-build.txt` (scaffold command log), `scaffold-stubs.sql`, `lint-migrations.txt`, `lint-filesize-lines.txt`.

## 5. The reviewer's SQL-package checklist (`review-round-2.txt` section 7, items 1–6)

| # | Item | Where it is met |
|---|---|---|
| 1 | S-A..S-E landed; S-F carried as a PR-B blocking condition | **S-A** `linked_by`/`unlinked_by` composite FKs: SQL `dil_linked_by_fk`, `dil_unlinked_by_fk` (lines 376–407); Rule 9 entries re-counted (section 6). **S-B** third orphan probe: `T-ORPH.txt` (probe 3), definition also in header lines 228–238. **S-C** path 4 re-read rule: header lines 143–201 (PATH 4 at 176); race test is CI-only, **OWED to PR-B**. **S-D** helpers dropped first, guard restricted to non-system namespaces: DOWN lines 894–973, helper file DOWN, `T-DOWN.txt`. **S-E** `UNIQUE (source_message_sid)` stays, rule stated: `capture_documents_source_message_sid_key` (line 254 table) and header 203–213. **S-F** header lines 203–213, stated as **PR-B BLOCKING, not solved here**. |
| 2 | Path 4 rewritten as the numbered steps of Q2-2 | Header, PATH 4, steps 1–8, line 176 onward; step 4 is the S-C re-read rule. |
| 3 | Q2-1 helper tenant guard; Q2-6 single-parameter rule | Guard: `quoco_test_capture_fixture_tenant_ok`, helper file lines 68–78, used by insert (102), update (132), cleanup (155) — one function, three callers; proved in `T-HELP.txt` incl. its RED. Column list built from jsonb keys: insert helper (never `INSERT … SELECT *`), `T-HELP` H2/H3. Pre-check function `quoco_test_capture_helpers_present()`. Q2-6: header lines 215–226 (a PR-B RPC rule; this file has no RPC). |
| 4 | SQL run against the PG 17 scaffold with RED-then-GREEN for B1, B2, B3 (RC and RR), R5, D-18, the section 3 CHECKs and the three orphan probes | `T-B1`, `T-B2`, `T-B3`, `T-R5`, `T-D18`, `T-CHK`, `T-ORPH` (section 4). |
| 5 | Bucket INSERT and DELETE plus the full DOWN executed on test-db, output captured | **OWED — block 2b.** The scaffold's `storage` is a stub. What is done here: the UP's bucket INSERT and its in-transaction assertion ran against the stub (UP lines ~822–842); the full DOWN ran against the scaffold (`T-DOWN.txt`). |
| 6 | P10 and P14 pinned with their dates | **OWED — apply.** As recorded: P10 re-run by Aravind in the SQL Editor, 0 rows, "per Aravind", 11 Oct, project selector not confirmed (cover D-17); P14 project-wide Storage limit 50 MB "per Aravind" from the dashboard, not probed (cover D-11). Both to be pinned at the apply with their date. |

## 6. Rule 9 (shared-fixture FK coverage) — count and list

13 entries added to `scripts/shared-fixture-fk-coverage.json`, all `"action": "not-applicable"` with a note (Option Y: the capture tests write only under `zz-test-capture-*` tenants, enforced by the helpers; `service_role` has no DELETE on these tables). `sweepSharedFixtureReferences()` skips `not-applicable` entries (existing `outbound_sends` precedent), so these should not change CI behaviour. **Not run against test-db or CI in this block.**

| Table | Column | Parent |
|---|---|---|
| capture_documents | tenant_id | tenants |
| capture_documents | project_id | projects |
| capture_documents | sent_by | users |
| capture_files | tenant_id | tenants |
| deliveries | tenant_id | tenants |
| deliveries | project_id | projects |
| deliveries | reported_by | users |
| deliveries | approved_by | users |
| deliveries | rejected_by | users |
| delivery_invoice_links | tenant_id | tenants |
| delivery_invoice_links | linked_by | users |
| delivery_invoice_links | unlinked_by | users |
| delivery_invoice_links | superseded_approval_by | users |

(`capture_files` and `delivery_invoice_links` get no direct FK to `projects`: their project/tenant pair rides the composite FK to `capture_documents`/`deliveries`. See question Q-3.)

## 7. Lint

`npm run lint:filesize`: clean (exit 0; this package is well under 120,000 chars). `npm run lint:migrations`: **exit 1, 4 violations, all one rule — OPEN item O-1** (`049-sql-evidence/lint-migrations.txt`). Rule 9 (FK coverage) passes with the 13 entries; rules 2–8, 11 pass. One lint false positive was fixed in the file: Rule `status-column-shape` reads `superseded_from_status text CHECK (…)` as having no CHECK (its regex swallows the word into the type text); the column is now written `text DEFAULT NULL::text CHECK (…)`, semantically identical (a nullable column's default is NULL).

## 8. OPEN items (nothing here was improvised away)

- **O-1 — lint Rule 1 vs the spec's "no GRANT" on trigger functions. NOT RESOLVED; lint fails.** `scripts/lint-migrations.mjs` `no-orphan-security-definer` requires a `GRANT EXECUTE ON FUNCTION <name>` for every SECURITY DEFINER function in held files too; the spec (plan v2 section 6, cover D-7) says REVOKE ALL by name and **no GRANT** (a trigger fires without the invoking role holding EXECUTE — observed in `T-TRIG`, where all four triggers fire for roles with no EXECUTE). The four violations are `trg_dil_before_insert`, `trg_dil_before_update`, `trg_deliveries_before_update`, `trg_capture_documents_before_update`. Options for Aravind (I chose none): (a) four narrow `(file, object, rule)` entries in `scripts/migration-lint-exceptions.json` — that file is outside this block's allowed list; (b) a no-op `GRANT EXECUTE … TO postgres` (the owner already holds it) to satisfy the regex — a spec deviation; (c) change the lint rule. **CI's `Migration Lint` job will be red on this branch until decided.**
- **O-2 — E-code assignments the section 4 map does not make.** I assigned: B2 forged-INSERT refusal → **E10** (TR1); TR3 refusing a `superseded_by_link` unlink when the delivery is not `incomplete`/`awaiting_pm`/`approved` → **E10**; a self-link to a rejected automatic delivery (A34) → **E5**; TR5 immutable-column change → **E9**, TR5 second ack/note → **E11** (section 4 lists TR5 only under E11). All map to existing strings. Confirm or reassign.
- **O-3 — TR4b preempts E7 (observed, `T-TRIG.txt`).** TR4b is written exactly as specified (retype to `internal_transfer` while any active link exists). An automatic delivery always has an active self-link, so a retype of it raises **E6** ("Unlink it first" — which the PM cannot do for a self-link) and E7's CHECK is reachable only when no active link exists. Implemented literally; the one-line alternative (restrict TR4b to `created_from_invoice_id IS NULL`) is a spec change and was not made.
- **O-4 — spec silences filled (all stated, none is a substitute for a spec item):** `capture_files.ingest_status` is `NOT NULL DEFAULT 'pending'` (a nullable status would make the `ingest_status = 'stored' ⇒ …` CHECKs pass vacuously); `preview_state` is nullable; `tenant_id → tenants` (RESTRICT) is on **all four** tables including `capture_files` (D-5 read as table-wide); `TR4a/4b/4c` are one function on one `BEFORE UPDATE` trigger (the spec's `UPDATE OF delivery_type` for 4b is covered by comparing OLD/NEW inside it); additive extras: table `COMMENT ON`, and an in-transaction ACL/fingerprint assertion block (aborts the UP on any surprise) beside the bucket assertion; `DOWN` guard messages carry function names (a DOWN-only convenience, not a trigger RAISE).
- **O-5 — nothing in this block verifies:** real Storage behaviour; the Supabase-managed default privileges beyond what the dump carries; `supabase db query -f` multi-statement behaviour of the apply; behaviour under PostgREST (CI); PR-B concurrency. All **OWED to block 2b / CI / apply**, listed in section 5 and 9.

## 9. Deviations from the brief

- **Two commits, not one.** The brief's provenance rule (SHA echo + empty `git status --porcelain` in every transcript) cannot be met by a single commit that also contains the transcripts. Commit 1 (`f26c7ed`): SQL, helpers, registries, evidence sources. Commit 2: transcripts, scaffold log, lint output, this package. The brief's exact commit message is on commit 2.
- Evidence directory also holds the scenario sources and runner (`src/`, `run.sh`) so the transcripts are reproducible — within the allowed `docs/reviews/049-sql-evidence/*`.
- Four extra scenarios (`T-TRIG`, `T-RLS`, `T-HELP`, plus the ACL matrix as its own file) beyond the required list.
- Local PG 17.11 vs 17.6 (section 3).
- The harness created the worktree on its own branch name; it was renamed to `feat/049-capture-tables` before any commit.

## 10. Retention-ledger lines (D-29; plan v2 section 15)

`deliveries`, `capture_documents`, `capture_files`, `delivery_invoice_links`: **business record / compliance class** (supplier delivery and invoice evidence), kept indefinitely, no prune mechanism proposed; one row per delivery, document, file and link event. Bucket objects: kept for the life of the project. Unchanged from D-29.

## 11. Questions for the reviewer (asked, not answered)

- **Q-1.** `unlink_reason` is not constrained per `link_source` (nothing forbids a `pm_manual` row unlinked as `superseded_by_link`; the snapshot CHECK then simply yields NULL snapshot columns). Should a CHECK tie `superseded_by_link` to `created_from_invoice`?
- **Q-2.** TR3 allows any unlink of an active row whose `unlink_reason` is in the CHECK list, with no state check beyond the snapshot case. Is that enough, given every PR-B path unlinks under the invoice lock?
- **Q-3.** Is a transitive project/tenant tie (via the composite FK to the parent) enough for `capture_files` and `delivery_invoice_links`, or do you want a direct `projects` FK on them (would add two Rule 9 entries)?
- **Q-4.** `received_at <= created_at` compares against `created_at DEFAULT now()` (transaction start). A PR-B function that supplies a `received_at` from a *later-committed* `processed_messages` row inside an earlier-started transaction would be refused. Is that the intended edge?
- **Q-5.** Is it acceptable that the RAISE `MESSAGE` is the bare code (`'E13'`) with a custom SQLSTATE class `QE`, for PostgREST to surface as a 400 with that code?
- **Q-6.** O-1: which of (a)/(b)/(c)?

## 12. Not verified here (stated plainly)

Real Storage (MIME/size refusal, SQL delete of a bucket); anything on test-db or prod; CI; PostgREST error mapping of the custom SQLSTATEs; lint behaviour on CI beyond the local `npm run lint:*`; the claim that no existing test breaks when these tables exist (no vitest was run: tests are block 2b by instruction).

END OF 049 SQL REVIEW PACKAGE
