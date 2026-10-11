# 049 SQL review package — capture tables (PR-A), block 2a

Written 11 Oct 2026. Migration 049 is **FULL tier**. This block touched **no Supabase database** (test-db and prod untouched; the only database written to is a disposable local PG 17 cluster). The migration is **HELD, not applied**. Nothing here is an apply GO.

## 1. Repo-state header

- `main` @ `0289bcfacccc3c97738624e764e11b853f944726` (fetched 11 Oct; `git ls-remote origin refs/heads/main` returns the same SHA).
- Branch `feat/049-capture-tables`. **SQL artifact commit** (the one every transcript names): `50b929a666d394f9e47884c5661304de722830aa` ("fix(049): O-1 grant-to-postgres, O-3 E7 before E6 (HELD)"). The SQL file is byte-identical in every later commit (blob `687d640a…` in each transcript header). The commit that ran the transcripts is `1121e72f5288db613eb5a53c5e35edb971fabc8b` (evidence sources for O-1/O-3); the branch head is the next commit, which adds this package and the transcripts, and its SHA is in the hand-off report from `git ls-remote`, not here (a file cannot name the commit that contains it). **Superseded** (block 2a, kept as history in git): artifact commit `f26c7ed`, branch head `8d9ef1c`.
- `supabase migration list`, prod: 44 rows, local = remote on all 44, last row 048 — from `049-plan-evidence/prod-P13-raw.json`, 11 Oct. **Not re-run in this block** (no Supabase command that links or writes was permitted).
- Last runbook executed: 048 prod apply, 2026-09-21 (`scripts/migration-number-reservations.json`, 048 entry).
- Number 049: `supabase/migrations/` ends at 048; the reservations file now carries a 049 entry naming the held file. Not checked against sibling worktrees (isolated worktree; same stated limit as 044–048).

## 2. Pinned artifacts

Hashes taken with `git show 50b929a:<path> | shasum -a 256`, and the same values are echoed at the top of every transcript (`shasum` frame). The helper script was not changed in block 2a-FIX (same hash as in block 2a).

| Artifact | sha256 | git blob |
|---|---|---|
| `docs/reviews/049_capture_tables.sql` (997 lines) | `31d5b0436ba6688449c37be8416d531c1c8af0e6f42507f7af37b34516dc3dbd` | `687d640ad1fece1bf0bcbb50dd1ca0347c079e94` |
| `scripts/test-db-only-capture-helpers.sql` | `4842ed8f8546152d233cc873f3c5c058f3d944b047a8661ff280bc386de761f3` | `fac582130a10b63ec10d734d95a4d3a6d4a15901` |

Reviewer: `git show 50b929a:docs/reviews/049_capture_tables.sql` is the file; do not trust a GitHub branch view.

The header of the SQL file carries a source-id → line-range map generated from the `-- [src: ...]` markers in the file itself (`genmap` was a throwaway script outside the repo; the map was re-checked against the final file: 88 of 88 map lines match the markers). It carries the dated line "11 Oct: O-1 and O-3 closed per Aravind."

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
| `T-ACL.txt` | `has_table_privilege` matrix (3 roles × 8 privileges × 4 tables = 96 cells), column grants, PUBLIC grants, `prosecdef`/`proconfig`/owner/EXECUTE per function, **O-1: postgres holds EXECUTE and the effective ACL of each trigger function is exactly `{postgres=X/postgres}`; no EXECUTE for PUBLIC, anon, authenticated, service_role**, real 42501 denials per role | planted GRANTs | PASS=68 (was 66: +2 O-1 checks) |
| `T-TRIG.txt` (extra) | TR1–TR5, A33, every E-code, D-23 lock, E14 under RR and SERIALIZABLE; **O-3: retype of an automatic delivery → E7 (with and without an active self-link), E7 backstop CHECK on INSERT (23514), E6 unchanged for a linked DC** | all four triggers dropped; **old ordering (`old_order`: the E7 branch disabled — retype gives E6, then 23514)** | PASS=57 (was 54: 2 lines replaced by 5) |
| `T-RLS.txt` (extra) | D-20 audience: PM of the project only; QS, admin-without-membership, deactivated, pending, cross-project, cross-tenant, anon see nothing | status clause removed; role clause removed | PASS=19 |
| `T-HELP.txt` (extra) | Option Y helpers: tenant guard, jsonb-key column list, triggers still fire, ACL, cleanup | tenant guard removed (actually deletes a non-fixture row) | PASS=23 |

Also in the directory: `scaffold-build.txt` (scaffold command log), `scaffold-stubs.sql`, `lint-migrations.txt`, `lint-filesize-lines.txt`.

## 5. The reviewer's SQL-package checklist (`review-round-2.txt` section 7, items 1–6)

| # | Item | Where it is met |
|---|---|---|
| 1 | S-A..S-E landed; S-F carried as a PR-B blocking condition | **S-A** `linked_by`/`unlinked_by` composite FKs: SQL `dil_linked_by_fk`, `dil_unlinked_by_fk` (lines 382–413); Rule 9 entries re-counted (section 6). **S-B** third orphan probe: `T-ORPH.txt` (probe 3), definition also in header lines 234–244. **S-C** path 4 re-read rule: header lines 149–207 (PATH 4 at 182); race test is CI-only, **OWED to PR-B**. **S-D** helpers dropped first, guard restricted to non-system namespaces: DOWN lines 918–997, helper file DOWN, `T-DOWN.txt`. **S-E** `UNIQUE (source_message_sid)` stays, rule stated: `capture_documents_source_message_sid_key` (table at line 260) and header 209–219. **S-F** header lines 209–219, stated as **PR-B BLOCKING, not solved here**. |
| 2 | Path 4 rewritten as the numbered steps of Q2-2 | Header, PATH 4, steps 1–8, line 182 onward; step 4 is the S-C re-read rule. |
| 3 | Q2-1 helper tenant guard; Q2-6 single-parameter rule | Guard: `quoco_test_capture_fixture_tenant_ok`, helper file lines 68–78, used by insert (102), update (132), cleanup (155) — one function, three callers; proved in `T-HELP.txt` incl. its RED. Column list built from jsonb keys: insert helper (never `INSERT … SELECT *`), `T-HELP` H2/H3. Pre-check function `quoco_test_capture_helpers_present()`. Q2-6: header lines 221–232 (a PR-B RPC rule; this file has no RPC). |
| 4 | SQL run against the PG 17 scaffold with RED-then-GREEN for B1, B2, B3 (RC and RR), R5, D-18, the section 3 CHECKs and the three orphan probes | `T-B1`, `T-B2`, `T-B3`, `T-R5`, `T-D18`, `T-CHK`, `T-ORPH` (section 4). |
| 5 | Bucket INSERT and DELETE plus the full DOWN executed on test-db, output captured | **OWED — block 2b.** The scaffold's `storage` is a stub. What is done here: the UP's bucket INSERT and its in-transaction assertion ran against the stub (UP lines ~847–866); the full DOWN ran against the scaffold (`T-DOWN.txt`). |
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

`npm run lint:filesize`: clean (exit 0; this package is well under 120,000 chars). `npm run lint:migrations`: **PASSES, exit 0** (after O-1 closed; was exit 1 with 4 violations in block 2a). Last line of the run output, verbatim: `migration-lint: clean. 107 known violation(s), all exempted.` The 107 are pre-existing exempted entries of older files; `node scripts/lint-migrations.mjs --json` (raw, before exemptions) lists **0** violations for `049_` (full output: `049-sql-evidence/lint-migrations.txt`). No entry was added to `migration-lint-exceptions.json`. Rule 9 (FK coverage) passes with the 13 entries; rules 2–8, 11 pass. One lint false positive was fixed in the file: Rule `status-column-shape` reads `superseded_from_status text CHECK (…)` as having no CHECK (its regex swallows the word into the type text); the column is now written `text DEFAULT NULL::text CHECK (…)`, semantically identical (a nullable column's default is NULL).

## 8. Decisions on O-1..O-4 (per Aravind, 11 Oct 2026) and what remains open

- **O-1 — CLOSED per Aravind, 11 Oct.** Lint Rule 1 (`no-orphan-security-definer`) wants a `GRANT EXECUTE` for every SECURITY DEFINER function; the spec said none. Decision: each of the four trigger functions gets `GRANT EXECUTE ON FUNCTION public.<fn>() TO postgres;` directly after its REVOKE, with the comment shape of `supabase/migrations/048_engineer_registration.sql:194-203` (postgres owns the function; the grant changes the effective ACL not at all; it exists to satisfy Rule 1). SQL lines 823–831. No exceptions-file entry. **Proved in `T-ACL.txt`:** the effective `proacl` of each function is exactly `{postgres=X/postgres}` (4 of 4), postgres holds EXECUTE (4 of 4), and no EXECUTE is held by PUBLIC, anon, authenticated or service_role (0). The in-file ACL assertion block and the REVOKE-by-name are unchanged.
- **O-2 — ACCEPTED as made in block 2a.** E-code assignments the section 4 map does not make: B2 forged-INSERT refusal → **E10** (TR1); TR3 refusing a `superseded_by_link` unlink when the delivery is not `incomplete`/`awaiting_pm`/`approved` → **E10**; a self-link to a rejected automatic delivery (A34) → **E5**; TR5 immutable-column change → **E9**, TR5 second ack/note → **E11**. (Original text follows.) I assigned: B2 forged-INSERT refusal → **E10** (TR1); TR3 refusing a `superseded_by_link` unlink when the delivery is not `incomplete`/`awaiting_pm`/`approved` → **E10**; a self-link to a rejected automatic delivery (A34) → **E5**; TR5 immutable-column change → **E9**, TR5 second ack/note → **E11** (section 4 lists TR5 only under E11). All map to existing strings.
- **O-3 — CLOSED per Aravind, 11 Oct.** Was: TR4b (retype to `internal_transfer` while any active link exists) preempted E7, so a PM retyping an automatic delivery got E6 ("Unlink it first" — impossible for a self-link). Decision: in `trg_deliveries_before_update`, when `NEW.delivery_type` becomes `'internal_transfer'` and `NEW.created_from_invoice_id IS NOT NULL`, raise **E7 before the TR4b active-link check**; nothing else in the trigger changes. E7 is therefore now a RAISE code (`ERRCODE = 'QE007'`, `MESSAGE = 'E7'`); the CHECK `deliveries_auto_not_internal_chk` (23514) remains as the backstop (it still covers INSERT). SQL lines 591–673 (the new block sits just before TR4b). **Proved in `T-TRIG.txt`:** automatic V4 with an active self-link → E7 (not E6); rejected automatic V6 with no active link → E7; V4 unchanged; INSERT of an automatic delivery typed `internal_transfer` → 23514; a linked DC retype → E6 (unchanged). RED against the old ordering (the E7 branch disabled) fails exactly the two E7 expectations. T-CHK B8 (CHECK on INSERT) is unchanged and still passes.
- **O-4 — ACCEPTED as made in block 2a.** Spec silences filled (all stated, none is a substitute for a spec item): `capture_files.ingest_status` is `NOT NULL DEFAULT 'pending'` (a nullable status would make the `ingest_status = 'stored' ⇒ …` CHECKs pass vacuously); `preview_state` is nullable; `tenant_id → tenants` (RESTRICT) is on **all four** tables including `capture_files` (D-5 read as table-wide); `TR4a/4b/4c` are one function on one `BEFORE UPDATE` trigger (the spec's `UPDATE OF delivery_type` for 4b is covered by comparing OLD/NEW inside it); additive extras: table `COMMENT ON`, and an in-transaction ACL/fingerprint assertion block (aborts the UP on any surprise) beside the bucket assertion; `DOWN` guard messages carry function names (a DOWN-only convenience, not a trigger RAISE).
- **O-5 — nothing in this block verifies:** real Storage behaviour; the Supabase-managed default privileges beyond what the dump carries; `supabase db query -f` multi-statement behaviour of the apply; behaviour under PostgREST (CI); PR-B concurrency. All **OWED to block 2b / CI / apply**, listed in section 5 and 9.

## 9. Deviations from the brief

- **Several commits, not one.** The provenance rule (SHA echo + empty `git status --porcelain` in every transcript) cannot be met by a single commit that also contains the transcripts. Block 2a: `f26c7ed` (SQL, helpers, registries, evidence sources), then `8d9ef1c` (transcripts, package). Block 2a-FIX: `50b929a` (the SQL change only, as instructed), `1121e72` (evidence sources: T-TRIG and T-ACL expectations, the `old_order` mutant, an artifact-SHA header in `run.sh`), then the transcripts + package commit. **Deviation in 2a-FIX:** the brief says every transcript names the SQL artifact commit; T-TRIG and T-ACL had to change to test O-1/O-3, so the commit that ran the transcripts (`1121e72`) is one commit after the SQL commit. Each transcript therefore names BOTH shas and shows the SQL file's blob hash at each (`git rev-parse <sha>:docs/reviews/049_capture_tables.sql`), equal.
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
- ~~**Q-6.** O-1: which of (a)/(b)/(c)?~~ Answered by Aravind, 11 Oct: the no-op GRANT to postgres (section 8).
- **Q-7.** With E7 now a RAISE ahead of E6, the app maps `QE007` → "Deliveries created from an invoice can't be internal transfers." for the PR-D retype path. Anything else that should raise E7 (e.g. a future bulk edit)?

## 12. Not verified here (stated plainly)

Real Storage (MIME/size refusal, SQL delete of a bucket); anything on test-db or prod; CI; PostgREST error mapping of the custom SQLSTATEs; lint behaviour on CI beyond the local `npm run lint:*`; the claim that no existing test breaks when these tables exist (no vitest was run: tests are block 2b by instruction).

END OF 049 SQL REVIEW PACKAGE
