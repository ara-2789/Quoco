# 049 SQL review package — capture tables (PR-A), block 2a

Written 11 Oct 2026; updated 11 Oct for block 2a-FIX (O-1, O-3 closed) and block 2a-FIX2 (SQL review round 1 folded). Migration 049 is **FULL tier**. These blocks touched **no Supabase database** (test-db and prod untouched; the only database written to is a disposable local PG 17 cluster). The migration is **HELD, not applied**. Nothing here is an apply GO.

## 1. Repo-state header

- `main` @ `0289bcfacccc3c97738624e764e11b853f944726` (fetched 11 Oct; unchanged since round 2).
- Branch `feat/049-capture-tables` (PR #331, draft). **SQL artifact commit** (the one every transcript names): `668956e6131ee38d3cd96f32edb0c05e29974d0e` ("fix(049): SQL review r1 — B-1, B-2, S-1, Q-1, N-1, S-2 (HELD)"). The commit that ran the transcripts is `0c6239c9f3e913c383e0f94cd38a6024fc8ccb36` (test sources); its SQL blob is identical (`b49df7bd…`, shown in every transcript header). The branch head is the next commit (this package + transcripts); its SHA is in the hand-off report from `git ls-remote`, not here (a file cannot name the commit that contains it).
- Superseded artifact commits (history): `f26c7ed` (block 2a), `50b929a` (O-1/O-3; **this is the file SQL review round 1 reviewed**, blob `687d640a…`, head `8968222`).
- `supabase migration list`, prod: 44 rows, local = remote on all 44, last row 048 — from `049-plan-evidence/prod-P13-raw.json`, 11 Oct. **Not re-run** (no Supabase command that links or writes was permitted).
- Last runbook executed: 048 prod apply, 2026-09-21.
- Number 049: `supabase/migrations/` ends at 048; the reservations file carries a 049 entry naming the held file.

## 2. Pinned artifacts

Hashes taken with `git show 668956e:<path> | shasum -a 256`; the same values are echoed at the top of every transcript (`shasum` frame).

| Artifact | sha256 | git blob |
|---|---|---|
| `docs/reviews/049_capture_tables.sql` (1073 lines) | `cfa6c96bcc4fb369dcc3520d7f8bfa2e365f229f5478849906196b0384689fb6` | `b49df7bd6a51bede54fe1d153c0fcbc272fc93a4` |
| `scripts/test-db-only-capture-helpers.sql` (unchanged since block 2a) | `4842ed8f8546152d233cc873f3c5c058f3d944b047a8661ff280bc386de761f3` | `fac582130a10b63ec10d734d95a4d3a6d4a15901` |

The previous values (block 2a-FIX, the file the reviewer saw): SQL sha256 `31d5b0436ba6688449c37be8416d531c1c8af0e6f42507f7af37b34516dc3dbd`, blob `687d640a…`.

Reviewer: `git show 668956e:docs/reviews/049_capture_tables.sql` is the file; do not trust a GitHub branch view. The SQL header carries a source-id → line-range map generated from the `-- [src: ...]` markers (92 of 92 map lines re-checked against the final file) and the dated lines "11 Oct: O-1 and O-3 closed per Aravind." and "11 Oct: SQL review round 1 folded (B-1, B-2, S-1, Q-1, N-1, S-2)."

## 3. The PG 17 scaffold (CLAUDE.md section 7)

**Real structure, not hand-built.** `supabase --workdir <main checkout> db dump --linked --schema public --dry-run`, the linked ref printed first (`exfccwlrhoutkgrlikod`, equal to test-db's; read from `supabase/.temp/project-ref`; no link created). The dry-run script went to a mode-600 file, was never printed, was run (it is the CLI's own `pg_dump` invocation; local `pg_dump` 17.11, no Docker), and was deleted. Rebuilt for each of blocks 2a, 2a-FIX, 2a-FIX2, with the same result (597 load lines, 0 errors, 32 public tables, 136 public functions); credential-pattern scan of the dump: 0. A READ of test-db. Log: `049-sql-evidence/scaffold-build.txt` (latest).

**Named stubs** (`049-sql-evidence/scaffold-stubs.sql`; hand-written, not from the dump):
1. Roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_auth_admin` — Supabase role *shapes*; `postgres` is the cluster superuser.
2. Extension `vector` in `public`.
3. `auth` schema: `auth.users(id)` and `auth.uid()` (reads `request.jwt.claim.sub` so the RLS test can impersonate; NULL if unset).
4. **`storage` schema — STUB:** `storage.buckets(...)`, `storage.objects(...)`. **It cannot show real Storage behaviour** (no Storage API, no object-level size/MIME enforcement, no real refusal of direct SQL writes to `storage.*`). Phase C of T-DOWN simulates a refusal with a stub BEFORE DELETE trigger; whether real Storage refuses is **block 2b on test-db**.
5. `supabase_migrations.schema_migrations(version, statements, name)`.

**Version.** Local PG **17.11**; test-db and prod are **17.6**.

**Concurrency.** T-B3 uses separate `psql` processes against the local cluster, genuinely concurrent (an observer connection shows one writer sleeping and the other waiting on a lock). The CLAUDE.md sandbox limit concerns concurrent RPC calls through the JS client against test-db and does not apply here; PR-B's own race tests remain **CI-only, not verified locally**.

## 4. Transcripts (`docs/reviews/049-sql-evidence/`)

Each transcript starts with the worktree HEAD SHA, the SQL artifact commit SHA, the SQL blob hash at each (equal), `git status --porcelain` (empty between its two marker lines), `psql --version`, the server version and the artifact hashes; `psql -e` echoes every statement above its result. Each shows RED run(s) against a **named mutant** (the test must FAIL) and then the GREEN run against the real file. **Runner gate (N-2):** every source declares `-- EXPECT_PASS: N`; the runner requires GREEN `PASS == N`, `N ==` a static count of the source's own assertion lines outside `\if` blocks, and `FAIL == 0`.

| File | GREEN: expected = PASS (block 2a-FIX → now) | What it proves | RED mutants |
|---|---|---|---|
| `T-B1.txt` | 10 = 10 (10 → 10) | link then reject refused (E13); unlink then reject succeeds | all four triggers dropped |
| `T-B2.txt` | 11 = 11 (11 → 11) | fully-consistent forged INSERT refused (E10); caller snapshot on UPDATE overwritten by TR3 | TR1 B2 refusal removed; TR3 trigger dropped |
| `T-B3.txt` | 4 = 4 per race ×3 (same) | link-vs-retype race, two real sessions: READ COMMITTED both orders (E6 / E3) and REPEATABLE READ (E14) | `no_tr4b`; `no_for_share`; `no_guard` |
| `T-R5.txt` | 10 = 10 (9 → 10) | generated-column FK; wrong invoice 23503; RESTRICT both ways (re-key now shown with triggers off, since S-1 makes TR4a answer first with E9) | `dil_self_link_fk` dropped |
| `T-D18.txt` | 11 = 11 (same) | fixed-value kind columns; wrong kind / project / tenant → 23503 | both document FKs dropped |
| `T-CHK.txt` | 57 = 57 (52 → 57) | section 3 CHECK combinations incl. NULL-status; NULL-safety; ordering; `storage_path` prefix; size cap; **Q-1: pm_manual unlinked as `superseded_by_link` → 23514; self-link unlinked as `pm_unlinked` → 23514; NULL reason passes** | reviewer's round-1 NULL-passing CHECK form; **the reviewed file 50b929a (fails A16, A17)** |
| `T-ORPH.txt` | 29 = 29 (22 → 29) | the three orphan probes **plus probe 4 (Q-2): links unlinked as `delivery_rejected` whose delivery is not `rejected`** return 0 after every path | flow mutant (path 4 without restore) + planted orphans for probes 1, 2 and 4 |
| `T-DOWN.txt` | 17 = 17 (12 → 17) | S-D order; guards 1 and 2; catalog == baseline; **S-2 phase C: when Storage refuses the direct bucket delete, the main transaction has already committed (tables, functions, ledger gone), only the bucket step fails, and the API-fallback stand-in returns the catalog to baseline** | guards tripping; **the reviewed file's DOWN: a refusal rolls everything back** |
| `T-ACL.txt` | 76 = 76 (68 → 76) | 96-cell privilege matrix; function fingerprint; O-1 ACL; **N-1: tables and functions owned by postgres; the UP's own assertion block (extracted from the file under test) passes clean and raises on a wrong table owner / wrong function owner** | planted GRANTs; **the reviewed file (its block has no owner check: the two "message names …:owner" checks fail)** |
| `T-TRIG.txt` (extra) | 75 = 75 (57 → 75) | TR1–TR5, A33, every E-code, E14; O-3; **B-1 (rewrite approver with status unchanged → E11; cancel while changing approved_by → E11; approve, cancel, restore, reject still pass); B-2 (self-link onto cancelled → E5; restore-then-link ok); S-1 (id / created_at on deliveries and capture_documents → E9)** | all triggers dropped; old ordering (O-3); **the reviewed file 50b929a (18 FAIL)** |
| `T-RLS.txt` (extra) | 19 = 19 (same) | D-20 audience | status clause removed; role clause removed |
| `T-HELP.txt` (extra) | 23 = 23 (same) | Option Y helpers | tenant guard removed |

No count dropped. Increases: T-R5 +1 (one assertion became two), T-CHK +5, T-ORPH +7, T-DOWN +5, T-ACL +8, T-TRIG +18.

Also in the directory: `review-sql-round-1.txt` (the reviewer's text, verbatim copy), `scaffold-build.txt`, `scaffold-stubs.sql`, `lint-migrations.txt`, `lint-filesize-lines.txt`, `run.sh`, `src/`.

## 5. The reviewer's round-2 SQL-package checklist (`review-round-2.txt` section 7, items 1–6)

Line references are to the SQL file at `668956e`.

| # | Item | Where it is met |
|---|---|---|
| 1 | S-A..S-E landed; S-F carried as a PR-B blocking condition | **S-A** `dil_linked_by_fk`, `dil_unlinked_by_fk` (lines 408–409); 13 Rule 9 entries (section 6). **S-B** third orphan probe: `T-ORPH.txt` (probe 3), also header lines 239–249. **S-C** path 4 re-read rule: header lines 154–212 (PATH 4 at 187); race test CI-only, **OWED to PR-B**. **S-D** DOWN lines 984–1073, helper-file DOWN, `T-DOWN.txt`. **S-E** `capture_documents_source_message_sid_key` (line 277) and header 214–224. **S-F** header 214–224, **PR-B BLOCKING, not solved here**. |
| 2 | Path 4 as the numbered steps of Q2-2 | Header PATH 4, steps 1–8, from line 187; step 4 is the S-C re-read rule. |
| 3 | Q2-1 helper tenant guard; Q2-6 single-parameter rule | Guard: `quoco_test_capture_fixture_tenant_ok`, helper file lines 68–78, used by insert (102), update (132), cleanup (155); `T-HELP.txt` incl. its RED. Q2-6: header lines 226–237. |
| 4 | RED-then-GREEN for B1, B2, B3 (RC and RR), R5, D-18, the section 3 CHECKs and the orphan probes | `T-B1`, `T-B2`, `T-B3`, `T-R5`, `T-D18`, `T-CHK`, `T-ORPH` (section 4). |
| 5 | Bucket INSERT/DELETE plus the full DOWN executed on test-db | **OWED — block 2b.** Done here: the UP's bucket INSERT and assertion against the stub (UP lines ~896–921); the full DOWN on the scaffold (`T-DOWN.txt`), incl. the refusal simulation. |
| 6 | P10 and P14 pinned with their dates | **OWED — apply.** P10: re-run by Aravind in the SQL Editor, 0 rows, "per Aravind", 11 Oct, project selector not confirmed (cover D-17); P14: 50 MB "per Aravind", dashboard, not probed (cover D-11). Pin at apply. |

## 6. Rule 9 (shared-fixture FK coverage) — count and list

13 entries in `scripts/shared-fixture-fk-coverage.json`, all `"action": "not-applicable"` (Option Y: capture tests write only under `zz-test-capture-*` tenants, enforced by the helpers; `service_role` has no DELETE). `sweepSharedFixtureReferences()` skips `not-applicable` entries. **Not run against test-db or CI in these blocks.** Unchanged by the fixes.

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

## 7. Lint

`npm run lint:filesize`: clean (exit 0). `npm run lint:migrations`: **passes, exit 0.** Last line of the run output, verbatim: `migration-lint: clean. 107 known violation(s), all exempted.` The 107 are pre-existing exempted entries of older files; `node scripts/lint-migrations.mjs --json` (raw, before exemptions) lists **0** violations for `049_`. No entry was added to `migration-lint-exceptions.json`. Full output: `049-sql-evidence/lint-migrations.txt`.

## 8. Decisions on O-1..O-4 (per Aravind, 11 Oct 2026)

- **O-1 — CLOSED.** Each of the four trigger functions has `GRANT EXECUTE ON FUNCTION public.<fn>() TO postgres;` directly after its REVOKE, with the comment shape of `supabase/migrations/048_engineer_registration.sql:194-203` (SQL lines 874–886). No exceptions-file entry. `T-ACL`: effective `proacl` of each function is exactly `{postgres=X/postgres}`; no EXECUTE for PUBLIC, anon, authenticated, service_role.
- **O-2 — ACCEPTED as made in block 2a.** E-codes outside the section 4 map: B2 forged-INSERT refusal → E10; TR3 snapshot-status refusal → E10; self-link to a rejected automatic delivery → E5; TR5 immutable column → E9, TR5 second ack/note → E11. (B-2 below extends the E5 case to a cancelled delivery.)
- **O-3 — CLOSED.** In `trg_deliveries_before_update`, when `NEW.delivery_type` becomes `'internal_transfer'` and `NEW.created_from_invoice_id IS NOT NULL`, **E7 (`QE007`) is raised before TR4b's E6**; the CHECK `deliveries_auto_not_internal_chk` (23514) remains a backstop for INSERT. Proved in `T-TRIG` incl. a RED against the old ordering.
- **O-4 — ACCEPTED as made in block 2a.** Gaps filled: `ingest_status NOT NULL DEFAULT 'pending'`; `preview_state` nullable; `tenant_id → tenants` on all four tables; one `BEFORE UPDATE` trigger function for TR4a/b/c; table comments and the in-transaction ACL assertion as additive extras; DOWN guard messages carry function names.

## 9. SQL review round 1 (anonymous external reviewer, 11 Oct) — folded in block 2a-FIX2

- **Verdict: STOP, but small** ("two trigger edits before it can be applied"; the next round is a **delta review**). Reviewed head `8968222`; SQL blob `687d640a` (= `50b929a`).
- **Evidence:** `049-sql-evidence/review-sql-round-1.txt`, verbatim copy, sha256 `dedc4245245664767a1dc0c67f427f1df57338b2a432ad265401b647888fdc3a` (checked against the expected value before use).
- **Reviewer error, owned (review section 2):** in round 2 the reviewer ruled C-36 "sound" after checking one direction only (moving a delivery to cancelled while a link is active) and not the other (inserting a link onto an already-cancelled delivery). A coverage miss of the same class as the 028-round B1 miss; it changes no earlier verdict and adds finding B-2 now.

| Item | Disposition | Where |
|---|---|---|
| **B-1** approval attribution rewritable after the fact (proven on the reviewer's stub) | **LANDED.** `trg_deliveries_before_update` raises E11 unless each group changes only on its own transition: `approved_by/at` NULL→value only on a move INTO `approved`, value→NULL only on restore; `rejected_*` only on a move INTO `rejected`; `cancelled_*` set on a move INTO `cancelled`, cleared on restore. | SQL 687–725; `T-TRIG` (RED = the reviewed file) |
| **B-2** self-link insertable onto a cancelled delivery (proven) | **LANDED.** TR2 self-link branch refuses `rejected` **or** `cancelled` (E5). Paths 2 and 4 restore before inserting, so no legitimate path changes. | SQL 500–513; `T-TRIG`, `T-ORPH` |
| **S-1** id / created_at missing from TR4a and TR5 | **LANDED** (id and created_at added to both immutable sets, E9). **capture_files part: MOVED to a PR-C blocking condition** (section 10). | SQL 617–624, 740–746; `T-TRIG` |
| **S-2** bucket DELETE inside the DOWN transaction | **LANDED.** Main `BEGIN … COMMIT` keeps the zero-objects bucket assertion and drops everything else including the 049 ledger row; the bucket DELETE is a separate step after the commit, by SQL, with the Storage-API fallback described. **Block 2b executes it on test-db.** | SQL 1029–1073; `T-DOWN` phase C |
| **N-1** owner checks in the assertion block | **LANDED.** `relowner = 'postgres'::regrole` for the four tables and `proowner = 'postgres'::regrole` for the four functions. | SQL 949–975; `T-ACL` |
| **N-2** runner GREEN gate | **LANDED.** `PASS == declared expected == static count`, `FAIL == 0` (section 4). | `run.sh`, every `src/*.sql` first line |
| **Q-1** scope `unlink_reason` to `link_source` | **LANDED.** `dil_superseded_reason_scope_chk`, `dil_pm_unlinked_scope_chk`. | SQL 421–422; `T-CHK` A16–A20 |
| **Q-2** row-level check enough; add probe 4 | Answered (enforcing at commit needs a deferred trigger; not worth it for 1a). **Probe 4 added** to `T-ORPH`; **PR-B condition** to carry it into PR-B tests. | `T-ORPH`; section 10 |
| **Q-3** indirect project/tenant tie enough | Answered: yes; no direct `projects` FK needed. No change. | — |
| **Q-4** `received_at <= created_at` refusal intended | Answered: yes (the idempotency row commits before the RPC, so the RPC's `now()` is at or after it). No change. | — |
| **Q-5** custom SQLSTATE class acceptable | Answered: acceptable **with two PR-B conditions** (section 10). | section 10 |
| **Q-6** O-1 | Closed by O-1. | section 8 |
| **Q-7** anything else raising E7 | Answered: no; any path updating `delivery_type` gets E7 from the BEFORE UPDATE trigger; INSERT is covered by the CHECK (23514 → E12). No change. | — |

## 10. Conditions recorded on later PRs (per the review and Aravind, 11 Oct)

**PR-B — BLOCKING:**
1. **S-F capture-loss window.** The SID is consumed before processing, so a capture that fails after that point is lost when Twilio retries; `UNIQUE (source_message_sid)` guards server-side double calls only. PR-B must record the inbound media durably at or before SID consumption, or add a failure path that records and alerts. (SQL header 214–224.)
2. **Q-5, E8 translation.** 23505 can come from four unique constraints (`source_message_sid`, `(source_message_sid, media_index)`, `uq_dil_active_self_per_invoice`, `uq_dil_active_per_delivery`) and its details text carries key values. The link function must catch `unique_violation`, read the constraint name with `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME`, and re-raise as `QE008` **only** for `uq_dil_active_per_delivery`. **The app never maps on SQLSTATE 23505 alone.**
3. **Q-5, CI assertion** that one `QE` code reaches supabase-js as `error.code` (PostgREST's handling of unknown SQLSTATEs is unverified).
4. **Q-2, probe 4** in the PR-B tests: links unlinked as `delivery_rejected` whose delivery is not `rejected` must be 0 after every path.
5. **D-30 multi-photo real-phone test:** confirm on a real phone how WhatsApp/Twilio delivers several photos selected together; the bot must ask 1/2/3 once per document.
6. The Q2-6 single-parameter `received_at` rule (SQL header 226–237) and the CI-only race tests for paths 1–6.

**PR-C — BLOCKING:** `capture_files` immutability (reviewer S-1, second part; proven open on the reviewer's stub — a stored file's `sha256` was rewritten): once stored, `storage_path`, `sha256`, `byte_size`, `content_type` are immutable; `stored` and `rejected` are terminal; identity columns are immutable. Together with the D-8 `capture_files` column UPDATE grant. Nothing writes `capture_files` before PR-B/C.

## 11. Delta-review request

**Reviewer: please review the delta only — SQL `50b929a` → `668956e`**, plus the re-run tests.
`git diff 50b929a 668956e -- docs/reviews/049_capture_tables.sql` (188 insertions, 112 deletions; about 92 of those lines are the regenerated header map). Changed line ranges at `668956e`:

| Lines | Change |
|---|---|
| 11–12 | dated header lines |
| 36–127 | regenerated source map (new ids B-1, B-2, S-1, Q-1, N-1, S-2) |
| 138 | E5 line of the E-code table (also cancelled) |
| 418–422 | Q-1: two CHECKs on `delivery_invoice_links` |
| 500–513 | B-2: TR2 self-link branch |
| 617–624 | S-1: TR4a gains `id`, `created_at` |
| 687–725 | B-1: the three attribution groups in `trg_deliveries_before_update` |
| 740–746 | S-1: TR5 gains `id`, `created_at` |
| 949–975 | N-1: table and function ownership in the assertion block |
| 1029–1073 | S-2: DOWN restructured (zero-objects assertion → main transaction → COMMIT → separate bucket step) |

Tests per the reviewer's delta list: `T-TRIG` re-run with the new cases, RED against the file at `50b929a` and GREEN against `668956e`; `T-B2`, `T-CHK`, `T-ORPH` (with probe 4), `T-ACL` re-run; the new SQL sha256 and blob are in section 2; S-2's restructured bucket step is carried into block 2b; the PR-B and PR-C conditions are in section 10. Items 5 and 6 of the round-2 checklist stay owed to block 2b and the apply.

## 12. Deviations

- **Several commits, not one.** The provenance rule (SHA echo + empty `git status --porcelain`) cannot be met by one commit that also contains the transcripts. Block 2a: `f26c7ed`, `8d9ef1c`. Block 2a-FIX: `50b929a` (SQL only), `1121e72` (sources), `8968222`. Block 2a-FIX2: `668956e` (SQL only, as instructed), `0c6239c` (test sources and runner), then the transcripts + package commit. Because T-TRIG/T-ACL/T-CHK/T-ORPH/T-DOWN had to change to test the new cases, the commit that ran the transcripts is one commit after the SQL commit; each transcript names BOTH shas and shows equal SQL blob hashes.
- The evidence directory also holds the scenario sources and runner so the transcripts are reproducible.
- Local PG 17.11 vs 17.6.
- In 2a-FIX2, T-R5's `ON UPDATE RESTRICT` demonstration now runs with the user triggers disabled, because S-1 makes TR4a refuse a delivery `id` change first (E9); this is a test change, not a behaviour loss.
- The T-DOWN RED for S-2 is "the reviewed file's DOWN rolls everything back on a refusal"; its line is printed `FAIL(expected, RED)` and is not counted in the 17.

## 13. Retention-ledger lines (D-29; plan v2 section 15)

`deliveries`, `capture_documents`, `capture_files`, `delivery_invoice_links`: **business record / compliance class**, kept indefinitely, no prune mechanism proposed. Bucket objects: kept for the life of the project. Unchanged.

## 14. Not verified here (stated plainly)

Real Storage (MIME/size refusal; whether it refuses a SQL delete of a bucket — only a stub trigger simulates it); anything on test-db or prod; CI; PostgREST's handling of the custom SQLSTATEs; lint behaviour on CI beyond the local `npm run lint:*`; that no existing test breaks when these tables exist (no vitest was run: tests are block 2b by instruction).

END OF 049 SQL REVIEW PACKAGE
