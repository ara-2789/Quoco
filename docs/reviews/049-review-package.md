# 049 SQL review package — capture tables (PR-A), block 2a

Written 11 Oct 2026; updated 11 Oct for block 2a-FIX (O-1, O-3 closed) and block 2a-FIX2 (SQL review round 1 folded). Migration 049 is **FULL tier**. These blocks touched **no Supabase database** (test-db and prod untouched; the only database written to is a disposable local PG 17 cluster). The migration is **HELD, not applied**. Nothing here is an apply GO.

## 1. Repo-state header

- `main` @ `0289bcfacccc3c97738624e764e11b853f944726` (fetched 11 Oct; unchanged since round 2).
- Branch `feat/049-capture-tables` (PR #331, draft). **SQL artifact commit** (the one every transcript names): `3a0244f6cc3c93252e7457d7b78e71a1e5a90485` ("fix(049): S-4 created_at stamped; N-4 PM fields NULL at insert (HELD)"). The commit that ran the transcripts is `7635bb983d768a7ca2ef176f0609b11121752c89` (test sources); its SQL blob is identical (`3b50f2c6…`, shown in every transcript header). Earlier artifacts: `7fae0c9` (F4-1/F4-2; SQL review round 3 reviewed this one), `ecc8e1e` (S-3), `668956e` (round 2), `50b929a` (round 1). The branch head is the next commit (this package + transcripts); its SHA is in the hand-off report from `git ls-remote`, not here (a file cannot name the commit that contains it).
- Superseded artifact commits (history): `f26c7ed` (block 2a), `50b929a` (O-1/O-3; **this is the file SQL review round 1 reviewed**, blob `687d640a…`, head `8968222`).
- `supabase migration list`, prod: 44 rows, local = remote on all 44, last row 048 — from `049-plan-evidence/prod-P13-raw.json`, 11 Oct. **Not re-run** (no Supabase command that links or writes was permitted).
- Last runbook executed: 048 prod apply, 2026-09-21.
- Number 049: `supabase/migrations/` ends at 048; the reservations file carries a 049 entry naming the held file.

## 2. Pinned artifacts

Hashes taken with `git show 3a0244f:<path> | shasum -a 256`; the same values are echoed at the top of every transcript (`shasum` frame).

| Artifact | sha256 | git blob |
|---|---|---|
| `docs/reviews/049_capture_tables.sql` (1195 lines) | `069fbe16f07c383d54edd3233b845de55591548815ce5e6b068e098c9dfa574b` | `3b50f2c6c683a5ea5481d91533be4aa9991b13bc` |
| `scripts/test-db-only-capture-helpers.sql` (unchanged since block 2a) | `4842ed8f8546152d233cc873f3c5c058f3d944b047a8661ff280bc386de761f3` | `fac582130a10b63ec10d734d95a4d3a6d4a15901` |

Previous values: `7fae0c9` (F4) sha256 `e1f7b62c4403ebcd2fb9879b5df52dce6c1407ca05a160ca96af36b7f73467eb`, blob `2597c50e…`; `ecc8e1e` (S-3) sha256 `009ea0eb9ad89ee9c398e97de9a28f8d57a389718f4e5b3b6a74ac1f7964c28a`, blob `903abba5…`; `668956e` (the file SQL review round 2 reviewed) sha256 `cfa6c96bcc4fb369dcc3520d7f8bfa2e365f229f5478849906196b0384689fb6`, blob `b49df7bd…`; `50b929a` (round 1) sha256 `31d5b0436ba6688449c37be8416d531c1c8af0e6f42507f7af37b34516dc3dbd`, blob `687d640a…`. Sections 5, 8, 9 and 11 give line references at `668956e`; section 15 gives the S-3 delta at `ecc8e1e` (lines after ~577 shifted by about +28).

Reviewer: `git show ecc8e1e:docs/reviews/049_capture_tables.sql` is the file; do not trust a GitHub branch view. The SQL header carries a source-id → line-range map generated from the `-- [src: ...]` markers (92 of 92 map lines re-checked against the final file) and the dated lines "11 Oct: O-1 and O-3 closed per Aravind." and "11 Oct: SQL review round 1 folded (B-1, B-2, S-1, Q-1, N-1, S-2)."

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

~~DATED NOTE (2026-10-12, per Aravind): PR-B condition 1 (S-F) is split. PR-B makes apply_material_inward_turn safe to repeat for one SID (a second call with the same SID writes nothing). PR-C closes the rest: the webhook ordering of SID consumption and the failure path that records and alerts. S-F stays BLOCKING for PR-C.~~

DATED CORRECTION (2026-10-18, per Aravind, from external review round 1 of the PR-B plan): the 12 Oct note above is struck. PR-B's SID check in apply_material_inward_turn is a PREREQUISITE for PR-C's S-F fix, not half of it: Twilio retries are stopped at the webhook (app/api/whatsapp/webhook/route.ts:224-227, isNewMessage false returns duplicate_ignored), before the RPC is reached, so the RPC check never sees a normal retry. PR-C owns the S-F fix: the ordering of SID consumption and the failure path that records and alerts. Coupling: received_at is read inside the RPC from the processed_messages row for the SID (Q2-6, SQL header lines 242-253), so that row must exist before the RPC runs; PR-C therefore cannot consume the SID after processing unless migration 050 changes too. S-F stays BLOCKING for PR-C.

**PR-C — BLOCKING:** `capture_files` immutability (reviewer S-1, second part; proven open on the reviewer's stub — a stored file's `sha256` was rewritten): once stored, `storage_path`, `sha256`, `byte_size`, `content_type` are immutable; `stored` and `rejected` are terminal; identity columns are immutable. Together with the D-8 `capture_files` column UPDATE grant. Nothing writes `capture_files` before PR-B/C.

## 11. Delta-review request

**CURRENT (round 4): review the S-4 + N-4 lines only — `git diff 7fae0c9 3a0244f -- docs/reviews/049_capture_tables.sql` — plus the re-run tests.** Changed line ranges at `3a0244f`: 15–20 (dated line and the TIME RULE header text), 44–141 (regenerated source map), 463 (TR1 marker), 490–491 (S-4 in `trg_dil_before_insert`), 821 (deliveries-insert marker), 837–848 (N-4 columns in the deliveries INSERT guard, then S-4 `created_at`), 854 (documents-insert marker), 871–872 (S-4 in `trg_capture_documents_before_insert`). The earlier requests (S-3 + F4 at `668956e` → `7fae0c9`, and round 2) are kept below as history.

**Round 2 (history): the delta was SQL `50b929a` → `668956e`**, plus the re-run tests.
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

## 15. SQL review round 2 (delta review, 11 Oct) — block 2a-FIX3

**This section supersedes the pins in sections 1, 2 and 11 where they differ.**

- **Verdict: SQL-stage GO (conditional).** Evidence: `049-sql-evidence/review-sql-round-2.txt`, sha256 `1912532ff460d8fd79cb3b7c6009b82b281489e26118e927bdc61a9185fda0d6` (verified before use). All round-1 blockers confirmed fixed and proven. Not an apply GO.
- **Reviewer error, owned:** the B-1 spec said each attribution group may change "only on its own status transition" but never said the trigger should *stamp* the time; the file implemented the spec exactly.
- **S-3 DECIDED Option A (Aravind, 11 Oct) and LANDED:** the database stamps `now()` at each allowed transition and overwrites any caller value: `approved_at`, `rejected_at`, `cancelled_at` (TR4, SQL lines 729–741), `unlinked_at` (TR3, 577–580), `engineer_ack_at` when the ack is first set (TR5, 785–789). B-1's who/when rules are unchanged; clearing on restore is unchanged; `received_at` stays caller-supplied (D-25).
- **N-3 LANDED:** `t.expect(…, 'ok')` now fails when an INSERT/UPDATE/DELETE/SELECT touched 0 rows. Re-check of every existing `'ok'` assertion: **none touched 0 rows in any GREEN run, so no scenario needed fixing and none was weakened.**
- **New pins.** SQL artifact commit `ecc8e1ef6d3e9e0a844ea13bbd07d4c89cab5056`; sha256 `009ea0eb9ad89ee9c398e97de9a28f8d57a389718f4e5b3b6a74ac1f7964c28a`; blob `903abba5d3dfa94dc5486923d22a5f5cdd91d25e`; 1101 lines. Test sources / transcript-running commit `70228cc6dad88b3f4169770017ad0159e2fdd84a` (identical SQL blob, shown in every transcript header). Previous reviewed file: `668956e`, sha256 `cfa6c96b…fb6`, blob `b49df7bd`.
- **S-3-only delta for the reviewer:** `git diff 668956e ecc8e1e -- docs/reviews/049_capture_tables.sql`. Changed ranges at `ecc8e1e`: 13 (dated line), 37–128 (regenerated source map), 516 (TR3 marker), 577–581 (unlinked_at stamp), 610 (TR4 marker), 729–743 (approved/rejected/cancelled stamps), 748 (TR5 marker), 785–791 (engineer_ack_at stamp).
- **Transcripts (GREEN expected = PASS; all FAIL 0):** T-B1 10, T-B2 11, T-B3 4 per race, T-R5 10, T-D18 11, T-CHK 57, T-ORPH 29, T-DOWN 17, T-ACL 76, **T-TRIG 87 (was 75: +12 S-3 assertions)**, T-RLS 19, T-HELP 23. No other count changed. T-TRIG RED against `668956e` (the reviewed file) fails exactly the 7 S-3 assertions; REDs against `50b929a` and the other mutants still run.
- **Lint:** `lint:migrations` exit 0, last line `migration-lint: clean. 107 known violation(s), all exempted.` (0 raw violations for 049); `lint:filesize` clean.
- **OPEN (not added, per the brief):** (1) `linked_at` is still caller-supplied; if the D-12 clock needs it stamped, that is a separate decision (an unlink with `now()` earlier than a future `linked_at` is refused by `dil_unlinked_order_chk`). (2) The stamps are in BEFORE UPDATE triggers only; the tables have no BEFORE INSERT trigger, so a row INSERTed directly with `status = 'approved'` / an ack already set can still carry a caller-chosen time (PR-B inserts documents with ack NULL and deliveries `incomplete`; reviewer to say whether an INSERT trigger is wanted).
- **Owed (reviewer §7 conditions 2–4), unchanged:** block 2b on test-db (bucket INSERT and the separate bucket DELETE step against real Storage, full DOWN, T-BKT, the CI run incl. anon-key 42501 per table and `service_role` refusals under Option Y, helpers pre-check); P10 and P14 pinned with dates; then the apply package (runbook, PITR observed, in-flight probe P3 = 0, ledger row, post-apply fingerprint incl. `pg_proc` count 1 per function name, types regenerated per D-16).

## 16. F4-1 and F4-2 (decided by Aravind, 11 Oct; the two OPEN items of section 15) — block 2a-FIX4

- **F4-1 — LANDED.** `linked_at` is stamped by the database: TR1 (`trg_dil_before_insert`) sets `NEW.linked_at := now()`, never trusting NEW (SQL lines 478–480). The earlier "unlink older than a future `linked_at`" hole is closed.
- **F4-2 — LANDED.** Two new functions, `trg_deliveries_before_insert` (line 811) and `trg_capture_documents_before_insert` (line 835), with BEFORE INSERT triggers (line 856 on): SECURITY DEFINER, `SET search_path = ''`, plain `CREATE FUNCTION`, B3 isolation guard first, REVOKE ALL by name then `GRANT EXECUTE … TO postgres` with the 048-shape comment (lines ~975–983), both added to the in-transaction ACL/owner assertion (line 1056) and to the commented DOWN (guard exclusion list and drop order, lines ~1125, 1153). Refusal code **E12** (`QE012`; the E-code table in the header now lists E12 as raised here as well as by CHECK/FK).
  - (a) `deliveries`: refused unless `status = 'incomplete'` and `approved_by`, `approved_at`, `rejected_by`, `rejected_at`, `reject_reason`, `cancelled_at`, `cancel_reason` are all NULL. **Spec read before writing:** a delivery is CREATED `incomplete` (D1; plan v3 line 105: it becomes `awaiting_pm` inside the engineer RPC when the ack is stored, i.e. by UPDATE; plan v2 §2.1 default `'incomplete'`). The brief's text named approved/rejected/cancelled; because the spec allows only `incomplete` at creation, `awaiting_pm` is refused at INSERT too (a deliberate, stated reading of "allow exactly those").
  - (b) `capture_documents`: refused if `engineer_ack`, `engineer_ack_at` or `engineer_ack_note` is non-NULL.
- **Tests.** T-TRIG 87 → 102: F4-1 (a future-dated `linked_at` is stored as the transaction time; the later unlink works), F4-2 (insert as approved / with approved_by only / with cancel_reason only / as rejected / as awaiting_pm / document with ack / document with note only → E12; normal creation still succeeds; both guards refuse under REPEATABLE READ with E14). T-ACL 76 → 82 (the two new functions: EXECUTE only postgres, owner postgres, SECURITY DEFINER, empty `search_path`, exact ACL `{postgres=X/postgres}`, 42501 for every role; six functions and six triggers now). T-DOWN 17 = 17 (the DOWN drops both new functions; catalog back to baseline). RED for the new cases against the file at `ecc8e1e` (the runner's `commit:` mutant): T-TRIG and T-ACL fail there.
- **Scenarios changed (listed; no assertion weakened).** `T-CHK`: sections B (deliveries) and C (capture_documents) test the CHECKs by INSERTing rows that carry exactly the fields F4-2 now refuses, so, as section A already did for links, the user triggers on those two tables are disabled for those sections (owner-level, scaffold only); every assertion and expected code is unchanged (57 = 57). `T-TRIG`: the rejected automatic delivery V6 is now INSERTed incomplete and rejected by UPDATE (it was INSERTed already rejected). No other scenario inserted these fields. The test-db helper script is unchanged; its `quoco_test_capture_acl()` still reports four trigger functions (a count check there, T-HELP H14, still passes; the helper file is outside this block's allowed files — a follow-up if it should list six).
- **Counts (GREEN expected = PASS, all FAIL 0), versus block 2a-FIX3:** T-B1 10 (10), T-B2 11 (11), T-B3 4 per race (same), T-R5 10 (10), T-D18 11 (11), T-CHK 57 (57), T-ORPH 29 (29), T-DOWN 17 (17), T-ACL 82 (76), T-TRIG 102 (87), T-RLS 19 (19), T-HELP 23 (23). No drop.
- **Lint:** `lint:migrations` exit 0, last line `migration-lint: clean. 107 known violation(s), all exempted.` (0 raw violations for 049); `lint:filesize` clean.
- **Delta ranges at `7fae0c9` (vs `ecc8e1e`):** 14 (dated line), 38–132 (regenerated map), 153–155 (E12 header lines), 454 (TR1 marker), 478–481 (F4-1), 806–860 (two new functions and their three triggers), 975–983 (REVOKE/GRANT), 1056 (assertion array), 1124–1125 (DOWN guard list), 1153–1154 (DOWN drops). Full: `git diff ecc8e1e 7fae0c9 -- docs/reviews/049_capture_tables.sql`.
- **Housekeeping:** a stray `src/T-TRIG.sql.bak` was committed by mistake in the test-source commit and is removed in the transcripts commit.
- **OPEN (unchanged):** none new from this block. Still owed: block 2b on test-db, P10 and P14 pinned with dates, the apply package.

## 17. SQL review round 3 and the whole-file time audit (block 2a-FIX5, 12 Oct)

**STATUS (updated): S-4 and N-4 are LANDED at `3a0244f` (see "Landing record" at the end of this section). The `dc_date` question below was DECIDED by Aravind on 12 Oct. The text between is the audit as first written (the block paused at it), kept for the record.**

**STANDING TIME RULE for this file (Aravind, 12 Oct): Every time column recording a system event is set by the database. Exceptions: `received_at` (D-25) and `dc_date` (document content, as printed).**

- **Round 3 evidence:** `049-sql-evidence/review-sql-round-3.txt`, sha256 `59d6e86e0b725750ee7ccabebc804e594f7e7c6297506f7ed45999afa7d829d0` (verified before use). Verdict: the SQL-stage GO holds, conditional. It found **S-4** (`created_at` caller-supplied at INSERT; proven on the reviewer's stub: a document with a future `created_at` can never be acknowledged; a delivery's `received_order_chk` is bypassed) and **N-4** (PM-owned fields can be set at INSERT). **Reviewer error, owned:** per-column fix specs leaving siblings open (C-36, B-1's timestamps, `created_at`); the reviewer's standing rule is below.
- **Decisions (Aravind, 12 Oct):** S-4 — `NEW.created_at := now()` in the three INSERT triggers (`trg_deliveries_before_insert`, `trg_capture_documents_before_insert`, `trg_dil_before_insert`); `capture_files.created_at` goes to the PR-C blocking condition (no trigger here). N-4 Option A — `delivery_type`, `vehicle_number`, `dc_number`, `dc_date` must be NULL at deliveries INSERT, else E12. **TIME RULE for the whole file:** every time column is set by the database at the moment of the event it records; `received_at` is the one named exception (D-25).
- **PR-C blocking condition gains:** `capture_files.created_at` stamped by the database (PR-C adds the trigger; the table has none today).
- **Note for block 2b:** the helper script's `quoco_test_capture_acl()` still counts 4 trigger functions; it must count the current number (six now) before 2b.
- **WHOLE-FILE TIME AUDIT (at `3a06666`, SQL blob `2597c50e`).** 14 time columns across the four tables (`delivery_date` is generated; `self_invoice_id` is a uuid and not a time):

| Column | Event it records | Set today | On INSERT | On UPDATE | Status |
|---|---|---|---|---|---|
| `capture_documents.created_at` | row creation | `DEFAULT now()`, caller may override | **caller-supplied** | immutable (S-1) | S-4 |
| `capture_documents.engineer_ack_at` | first ack stored | DB-stamped (TR5, S-3) | must be NULL (F4-2) | stamped | compliant |
| `capture_files.created_at` | row creation | `DEFAULT now()`, caller may override; no trigger | **caller-supplied** | mutable (no trigger) | PR-C condition |
| `deliveries.created_at` | row creation | `DEFAULT now()`, caller may override | **caller-supplied** | immutable (S-1) | S-4 |
| `deliveries.received_at` | inbound message receipt | caller-supplied by design | caller | immutable (TR4a) | named exception (D-25) |
| `deliveries.delivery_date` | IST date of `received_at` | generated, stored | n/a | n/a | compliant |
| **`deliveries.dc_date`** | date **printed on the delivery challan** (document content, PM-entered) | **caller-supplied, unconstrained** | **caller-supplied** | caller-supplied; locked while approved/cancelled (TR4c(4)) | **DECIDED (Aravind, 12 Oct): named exception to the TIME RULE** (document content as printed); NULL at INSERT (N-4); no CHECK, no stamp |
| `deliveries.approved_at` | move INTO approved | DB-stamped (TR4, S-3) | must be NULL (F4-2) | stamped | compliant |
| `deliveries.rejected_at` | move INTO rejected | DB-stamped (TR4, S-3) | must be NULL (F4-2) | stamped | compliant |
| `deliveries.cancelled_at` | move INTO cancelled | DB-stamped (TR4, S-3) | must be NULL (F4-2) | stamped; cleared on restore | compliant |
| `delivery_invoice_links.created_at` | row creation | `DEFAULT now()`, caller may override | **caller-supplied** | immutable (TR3) | S-4 |
| `delivery_invoice_links.linked_at` | link creation | DB-stamped (TR1, F4-1) | stamped | immutable | compliant |
| `delivery_invoice_links.unlinked_at` | the unlink | DB-stamped (TR3, S-3) | must be NULL (B2) | stamped on unlink | compliant |
| `delivery_invoice_links.superseded_approval_at` | when the superseded approval happened | copied by TR3 from `deliveries.approved_at` (itself DB-stamped); caller value overwritten | must be NULL (B2) | derived | compliant |

- **~~OPEN~~ DECIDED 12 Oct — `deliveries.dc_date`: a named exception (see the standing rule above; the options and reading below are the historical question).** It is a `date` column that is caller-supplied, is not `received_at`, and is not covered by S-4, so under the brief's audit rule it is neither fixed nor assumed. My reading, for the decision only: it does not record an event the system observes; it records a fact printed on a paper document (the date on the supplier's DC) and is PM-entered content, like `dc_number` and `vehicle_number`. Options: (a) name it as a second explicit exception to the TIME RULE ("document content dates are caller-supplied"); (b) bound it (for example `dc_date <= delivery_date`) as a CHECK; (c) stamp it (this would defeat its purpose: the printed date). **Block 2a-FIX5 STOPPED here, before STEP 2: no SQL was edited, no transcripts were re-run.** S-4 and N-4 are therefore NOT yet landed. N-4 makes `dc_date` NULL at INSERT regardless; this question is about the UPDATE path.

**Landing record (block 2a-FIX5 resumed, 12 Oct, per Aravind):**
- **dc_date DECIDED:** named exception to the TIME RULE; no CHECK, no stamp; NULL at INSERT (N-4); locked while approved/cancelled (D-23). Recorded in the SQL header (dated line "12 Oct: S-4 … and N-4 … per Aravind." and the TIME RULE text, SQL lines 15–20) and above. The audit table above is otherwise unchanged: 14 time columns, 11 compliant before this block, 3 `created_at` fixed by S-4, `capture_files.created_at` to PR-C, `received_at` and `dc_date` the two named exceptions.
- **S-4 LANDED:** `NEW.created_at := now()` in `trg_deliveries_before_insert` (SQL 848), `trg_capture_documents_before_insert` (872) and `trg_dil_before_insert` (491). `capture_files.created_at` has no trigger and is on the **PR-C blocking condition** (to be stamped by the database).
- **N-4 LANDED (Option A):** `delivery_type`, `vehicle_number`, `dc_number`, `dc_date` must be NULL at `deliveries` INSERT, else E12 (SQL 837–845).
- **Artifact commit** `3a0244f6cc3c93252e7457d7b78e71a1e5a90485`, sha256 `069fbe16f07c383d54edd3233b845de55591548815ce5e6b068e098c9dfa574b`, blob `3b50f2c6c683a5ea5481d91533be4aa9991b13bc` (section 2). Transcripts ran at `7635bb9`.
- **Tests.** T-TRIG 102 → 122 (+20): a future-dated and a past-dated `created_at` on each of `deliveries`, `capture_documents`, `delivery_invoice_links` is stored as the transaction time; a document born with a supplied future `created_at` can still be acknowledged; the C4 shape (`received_at = now() + 1 hour`, `created_at = now() + 2 hours`) is refused by `deliveries_received_order_chk` (the message is asserted); N-4 one case per field → E12, plus the positive UPDATE path. RED against `7fae0c9`'s file via `commit:`: fails 15 checks, including the C4 shape actually succeeding on the old file.
- **Scenarios changed (every one listed; no assertion weakened):** `_fixture.sql` (`t.mk_dc`, `t.mk_inv`: `delivery_type` set by UPDATE after INSERT, same final state); `T-CHK` section A (the three automatic deliveries: `delivery_type` by UPDATE); `T-RLS` (V3, V4: `delivery_type` by UPDATE); `T-TRIG` (V6: type by UPDATE; the E7 CHECK-backstop assertion keeps its expectation 23514 but runs with the user triggers on `deliveries` disabled, because the N-4 guard now answers E12 first); `T-HELP` H2 (`delivery_type` removed from the helper's jsonb row; the `delivery_date` assertion is unchanged). Run.sh: `commit:7fae0c9` RED added for T-TRIG.
- **Counts, GREEN expected = PASS, FAIL 0, versus block 2a-FIX4:** T-B1 10 (10), T-B2 11 (11), T-B3 4 per race (same), T-R5 10 (10), T-D18 11 (11), T-CHK 57 (57), T-ORPH 29 (29), T-DOWN 17 (17), T-ACL 82 (82), **T-TRIG 122 (102)**, T-RLS 19 (19), T-HELP 23 (23). No drop.
- **Lint:** `lint:migrations` exit 0, last line `migration-lint: clean. 107 known violation(s), all exempted.` (0 raw violations for 049); `lint:filesize` clean.
- **For block 2b (helper script):** `quoco_test_capture_acl()` in `scripts/test-db-only-capture-helpers.sql` still counts 4 trigger functions; it must count the current number (six) before 2b. The helper's insert path also cannot now set the PM-owned or attribution fields at INSERT (use `quoco_test_capture_update`).
- **Reviewer error owned (round 3):** per-column fix specs leaving siblings open (C-36, B-1's timestamps, `created_at`); the whole-file TIME RULE replaces column lists.
- **Review round 3 verdict:** the SQL-stage GO holds (conditional). Conditions: S-4 landed with T-TRIG RED/GREEN and N-4 decided, before block 2b (done here); then block 2b, P10/P14 pins and the apply package (unchanged); PR-B and PR-C blocking conditions in section 10 stand, with `capture_files.created_at` added to PR-C's.

## 18. Addendum after block 2b (12 Oct 2026)

**This section supersedes the pins in sections 1, 2 and 15 where they differ.** Block 2b ran on test-db `exfccwlrhoutkgrlikod` only; prod was not touched. The 049 SQL file is unchanged (sha256 `069fbe16…dfa574b`, blob `3b50f2c6…`).

- **Branch head** `cac20da0461788340ec500c7c3402248636d118a` (2b commits `652c2a0`, `56b2495`, `b088ef5`, `2a76f49`, `7ad592d`, `cac20da`). **CI** run https://github.com/ara-2789/Quoco/actions/runs/38218724012 on `cac20da`: success, 9 passed, 1 skipped, "Test (real test-db)" 25 min — **per Aravind, 12 Oct [R]**; no session pinned `conclusion`/`headSha` from `gh` output. Later commits on this branch need their own pinned run.
- **PR #331 state:** the morning handover said draft; observed a `ready_for_review` event 2026-10-11T06:44:17Z by `ara-2789`, which cannot tell Aravind from a Claude Code session (both act as `ara-2789` through `gh`). Reverted to draft 12 Oct. Marked ready again 12 Oct after CI, **per Aravind [R]**.
- **Helper script hash:** `scripts/test-db-only-capture-helpers.sql` `4842ed8f…` → **`8328ca7f56865f2af72b1a45a4c69b236f60ac788ae15379fad5adc7f8f7e308`** (`56b2495`: `quoco_test_capture_acl()` counts 6 functions; T-HELP H14 expects 6). Applied on test-db; EXECUTE `service_role` only.
- **Transcripts:** the 12 scaffold transcripts are now at `2a76f49` (all pins match: B1 10, B2 11, B3 4/race, R5 10, D18 11, CHK 57, ORPH 29, DOWN 17, ACL 82, TRIG 122, RLS 19, HELP 23). `run.sh` writes fixed file names, so the 11 Oct versions were overwritten in the tree; they remain at `7635bb9` / `0aafe40`. The pinned counts are **scaffold** counts: `run.sh` runs only against the local scaffold, never test-db.
- **Real Storage, observed on test-db (T-BKT 5/5, T-REFUSE 34/34, DOWN rehearsal):** the bucket checks the declared content type only, not the file bytes (PR-C's byte checks decide acceptance); 16 MiB accepted, 16 MiB + 1 refused 413; text/plain and HEIC refused 415. **Prod rollback must delete the bucket through the Storage API:** the SQL `DELETE FROM storage.buckets` in the DOWN's separate bucket step was refused 42501 by `storage.protect_delete()`; the Storage API `deleteBucket` succeeded. This confirms S-2's design (bucket step outside the main transaction).
- **Ledger:** test-db's 049 row was hand-inserted with `statements` NULL (first such row; 039–048 are non-NULL), by decision pending the prod method. **Prod method proposed:** `supabase migration repair --status applied 049 --linked` (runbook template step E; 048 precedent); then re-align test-db with the same command (`--status reverted`, then `--status applied`). Decision is Aravind's (`049-prod-apply-runbook.md`, O-B).
- **Comment faults, recorded, file not edited:** DOWN Guard 2's comment says "four trigger functions" while its exclusion list has six (SQL line 1134). The same stale count is in the header at line 31 ("4 new functions") and line 35 ("four SECURITY DEFINER trigger functions") — found 12 Oct while writing the apply runbook; not in the 2b handover. Any edit changes the pinned hash, so the proposal is to record and not fix; the reviewer decides (runbook O-C). The 049 entry in `scripts/migration-number-reservations.json` also says four; that one is corrected at apply (runbook step H).
- **Fingerprints:** test-db versus the scaffold differ on functions, table/column comments and `default_acl` (expected from the scaffold's stub roles; not investigated; not a pass criterion). For prod, the whole-schema fingerprints cannot be compared with test-db at all (test-only helpers and the `outbound_sends` grant exception differ by design), so the apply package uses a fingerprint scoped to 049's own objects: `049-apply-probes/FP049.sql`, run live on test-db right before the apply and on prod right after.
- **ACL on prod:** the UP's own in-transaction block aborts unless every role/privilege cell on the 4 tables and 6 functions is exactly as designed, so a prod `default_acl` difference cannot leave an unintended grant behind silently. The post-apply observation adds the `PUBLIC` pseudo-role (`049-apply-probes/ACL049.sql`) and the PostgREST refusals (`prod-refusals.mjs`).
- **Deferred to PR-B:** vitest cases c, d, f (helper insert, tenant guard, N-4 E12 via the helper); fixture design belongs to PR-B.
- **CI coupling:** `test/capture-tables.test.ts` fails in CI whenever test-db lacks 049 (for example during any future DOWN rehearsal there).
- **Still owed:** P10 and P14 pinned with dates (runbook steps A and B); the apply package (`docs/reviews/049-prod-apply-runbook.md`, drafted 12 Oct, not run); 2b step 9 HELD pending whether review round 3 still comes.

END OF 049 SQL REVIEW PACKAGE
