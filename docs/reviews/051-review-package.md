# Migration 051 — `capture_files` immutability and column UPDATE grant: review package (C2)

**Status: REVIEW PACKAGE ONLY. Nothing here has been applied to any database.** Test-db apply, CI green, the prod readback, the prod apply, the reservation entry and the types check are all still to do (section 7).

**Tier: FULL** (CLAUDE.md §0 external-review triggers: (a) a new trigger function is live logic; (b) a new `SECURITY DEFINER` function and a new column-level UPDATE grant on a tenant-scoped table).

**Repo-state header** (CLAUDE.md §0, review requests at this tier):

- `main @ 10cd3a3047d281c34a5e34cbae13d016dd0aa276`, the merge of PR #338 (`git rev-parse origin/main` after `git fetch origin`, 26 Oct 2026).
- `supabase migration list` local/remote: **not run in this block.** The block allowed no remote access except one read-only schema dump of test-db. From the repo: `supabase/migrations/` on `origin/main` ends at `050_material_inward_functions.sql`. 051 is unused there and in `docs/reviews/*.sql`.
- Last runbook executed: migration 050's prod apply, `docs/reviews/050-prod-apply-record.md`. [read from the repo, not re-probed]

**Artifact provenance.** Every scaffold transcript header carries the commit SHA and an empty `git status --porcelain` capture. The transcripts G0 to G4 were run at `44cac28` (the commit that holds the SQL, both DOWN files and the test). G5 was run at `4f302c0` (the same SQL files, plus the committed transcripts). Section 8 has every file's full sha256.

Source documents: `docs/plans/pr-c-plan.md` section 3d and section 8 row C2; `docs/reviews/049-review-package.md:145` (the BLOCKING item); `docs/reviews/049-plan-review-package.md:33` (D-8); `supabase/migrations/049_capture_tables.sql` and `050_material_inward_functions.sql` for patterns.

---

## 1. What this changes, in product terms

A file an engineer sends (a delivery challan or an invoice photo or PDF) becomes a `capture_files` row. The row starts `pending`. A background job (C5, not built yet) later downloads the bytes, checks them, and fills in the row's stored details.

Today nobody can change a `capture_files` row at all. 049 gave `service_role` read access only. The ingest job needs to write, so this migration gives it a narrow write right.

This migration does two things.

1. **Only the ingest job's seven columns can be written, and only by `service_role`.** Nobody else can write anything.
2. **Once a file is `stored` or `rejected`, it can never change again.** A stored file's hash, path, size and type are fixed for good. A file's identity (which document, which page, which message) never changes at all.

This closes the hole the external reviewer proved open on a stub: with the column grant but no trigger, a stored file's `sha256` could be silently rewritten.

## 2. The exact objects and grants (SQL line numbers)

File: `docs/reviews/051_capture_files_immutability.sql` (held in `docs/reviews/`; it moves into `supabase/migrations/` only in the apply commit, CLAUDE.md §6).

| What | Lines |
|---|---|
| Header: purpose, decisions "per Aravind", transition table, QE map, identity list, source map, DOWN pointer | 1–73 |
| `BEGIN;` and `SET LOCAL lock_timeout = '3s';` | 75, 77 |
| `CREATE FUNCTION public.trg_capture_files_before_update()` (`RETURNS trigger`, `plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`) | 83–127 |
| QE014 refusal, first statement (copy of 049's form, `049:778-780`) | 91–93 |
| Identity columns immutable, QE009 | 96–106 |
| Terminal rows: any change refused QE011, a no-change UPDATE allowed | 110–115 |
| Status moves for `pending` and `failed`, QE011 for anything else | 118–123 |
| `CREATE TRIGGER trg_capture_files_before_update BEFORE UPDATE ... FOR EACH ROW` | 133–136 |
| `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role` (all four by name) | 146 |
| `GRANT EXECUTE ... TO postgres` (changes no effective ACL; satisfies `scripts/lint-migrations.mjs` Rule 1 as `049:988-1004` does) | 147 |
| `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) ON public.capture_files TO service_role` (column-scoped; nothing for `anon` or `authenticated`) | 154–155 |
| In-file post-condition `DO` block (`POSTCONDITION_051`) | 161–267 |
| `COMMIT;` | 269 |
| Commented DOWN block | 271–end |

The function body never writes the table name `capture_files`. That is deliberate. 049's DOWN Guard 2 scans function bodies for table names and blocks the 049 DOWN if it finds one outside its own six functions. Probe G5 shows 051's function does not match (`G5-049-down-guard.txt`).

**What the post-condition block checks** (any miss raises `POSTCONDITION_051` and the whole file aborts): exactly one `pg_proc` row; `prosecdef`; owner `postgres`; `proconfig = {search_path=""}`; non-NULL ACL with no PUBLIC entry; no role holds EXECUTE; the trigger exists, is enabled, and is BEFORE UPDATE FOR EACH ROW and bound to this function; `has_column_privilege('service_role', …, 'UPDATE')` is true for exactly the seven columns and false for every other column (all 16 columns are walked); false for `anon` and `authenticated` on every column; `has_table_privilege(…, 'UPDATE')` false for all three roles; `service_role` holds no DELETE and no TRUNCATE and still holds SELECT; all seven granted columns exist.

**Identity columns (QE009).** `id, created_at, tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type`. `capture_files` has 16 columns (`049:305-340`). The grant covers 7. The other 9 are exactly this list. Nothing is left out. Scaffold readback: `G2-green.txt` "READBACK" section (16-row column table).

**DOWN files.** `docs/reviews/051-down-testdb.sql` (test-db, `exfccwlrhoutkgrlikod`) and `docs/reviews/051-down-prod.sql` (prod, `jvxwqignooseazzmwhvl`). Identical bodies. Each header names its own database and says never to apply it to the other. Lines: `BEGIN` 15; `lock_timeout` 17; precondition block 21–36 (`DOWN_PRECONDITION_051`); `DROP TRIGGER` 39; `DROP FUNCTION` 40; `REVOKE UPDATE (…)` 43; ledger `DELETE` 47; closing assertion 51–80 (`DOWN_ASSERT_051`); `COMMIT` 82.

## 3. The threat it closes: `049-review-package.md:145`

The reviewer wrote that a stored file's `sha256` was rewritten on the reviewer's stub. The stub is the D-8 grant without a trigger. The scaffold reproduces it, then shows the fix.

**RED, the hole open** (`G0b-reviewer-stub.txt`: the column grant, no trigger; "PASS" here means the hole was reproduced):

```
 PASS: control: service_role UPDATE of a granted column works (the grant is live) -- succeeded as expected (1 row(s))
 PASS: HOLE REPRODUCED T-D8-3: service_role rewrites sha256 on a STORED row -- succeeded as expected (1 row(s))
 PASS: HOLE REPRODUCED: the stored row now carries the rewritten hash -- value = bbbb
 PASS: HOLE REPRODUCED: service_role rewrites storage_path on a STORED row -- succeeded as expected (1 row(s))
 PASS: HOLE REPRODUCED: service_role reopens a REJECTED row (reject_reason changes) -- succeeded as expected (1 row(s))
 PASS: HOLE REPRODUCED: service_role moves a STORED row back to pending -- succeeded as expected (1 row(s))
```

**RED, the real baseline before 051** (`G0-red.txt`, the scaffold built from the test-db dump; every "FAIL" is the expected RED result). T-D8-1 fails with 42501 (no grant yet). Even the table owner can rewrite a stored row, because there is no trigger:

```
 FAIL: T-D8-1 (RED) svc UPDATE seven columns pending->stored -- expected ok, got refusal SQLSTATE=42501 MESSAGE=permission denied for table capture_files
 FAIL: T-D8-3 (RED) owner rewrites sha256 on a stored row -> must be refused QE011 -- expected refusal QE011 but the statement SUCCEEDED
 FAIL: T-D8-3 (RED) the stored row HAS BEEN rewritten (sha256 now b...) -- expected aaaa got bbbb
```

Totals: PASS 4 (three baseline facts and the 42501 refusal), FAIL 7 (all expected).

**GREEN, after 051** (`G2-green.txt`): 86 PASS, 0 FAIL. On a `stored` row, `service_role` rewriting `sha256`, `storage_path`, `byte_size`, `content_type`, `preview_state` or `reject_reason` is refused QE011. The table owner rewriting `sha256` is refused QE011 too. The stored row is byte-for-byte unchanged afterwards.

**The tests can fail** (`G2b-mutant.txt`). The same GREEN scenario run against a mutant of 051 with the terminal-row check removed (one line changed: `IF NEW IS DISTINCT FROM OLD THEN` to `IF false THEN`) gives 66 PASS and **20 FAIL**. They are the T-D8-3, T-D8-4, T-D8-5 and T-D8-6 refusals, their end-state controls, and the 050-path "same row cannot then be rewritten" check.

**The post-condition block can fail** (`G1b-postcondition-negative.txt`). Three wrong starting states each abort 051 whole: an extra `service_role` DELETE grant raises `POSTCONDITION_051: svc_delete`; an extra `UPDATE (file_no)` grant raises `svc_col_update:file_no`; a table-level UPDATE for `authenticated` lists every column. After each abort no function, no trigger and none of the seven grants exist.

## 4. Status transitions and QE codes

Order of checks inside the trigger: QE014 first, then identity (QE009), then terminal rows (QE011), then status moves (QE011).

| From → To | Result |
|---|---|
| `pending` → `pending`, `stored`, `rejected`, `failed` | allowed (the table CHECKs still apply, e.g. `stored` needs path, type, size and hash) |
| `failed` → `stored`, `rejected` | allowed |
| `failed` → `failed` (with or without a column change) | allowed (reviewer question 2) |
| `failed` → `pending` | QE011 |
| `stored` → anything else, or any column change | QE011 |
| `rejected` → anything else, or any column change | QE011 |
| `stored` → `stored` or `rejected` → `rejected` with **no** change | allowed (a retried job is a no-op) |
| any identity column changes | QE009 (also on `stored` and `rejected` rows; QE009 is checked before QE011) |
| writer not READ COMMITTED | QE014 |

| Code | Meaning | Source |
|---|---|---|
| QE009 | immutable column changed | 049 `trg_capture_documents_before_update` (`049:784-791`), map `pr-b-050-plan.md:129-131` |
| QE011 | locked content or refused status move | same |
| QE014 | non-READ-COMMITTED writer | `049:778-780` |

No new code. The app has no string for these three on this table; the ingest job (C5) is the only caller and sends the engineer nothing (plan section 8, C5 row).

## 5. Test list: what runs in CI, what is scaffold-only

`test/capture-files-immutability.test.ts`. Each test names its positive control in its title or a comment.

| Test | Where it runs | Positive control |
|---|---|---|
| T-D8-1 service_role updates the seven columns of a pending row | CI against test-db (RED until the test-db apply) | the row reads back `stored` with the written hash |
| T-D8-2 grant layer: `file_no`, `claimed_content_type`, `tenant_id`, `id` refused 42501 | CI | a granted column on the same row succeeds |
| T-D8-2b trigger layer with the grant bypassed, QE009 | **scaffold only** (`G2-green.txt`, all nine identity columns). Marked `it.skip`: "needs owner connection; evidence in docs/reviews/051-sql-evidence/" | owner UPDATE of a granted column and an owner no-op both succeed |
| T-D8-3 stored row: `sha256`, `storage_path`, `byte_size`, `content_type` rewrite refused QE011 | CI | the same `sha256` UPDATE on a pending row succeeds |
| T-D8-4 rejected is terminal | CI | pending → rejected succeeded when the row was made |
| T-D8-5 no move back to pending; failed → stored / rejected allowed | CI | pending → failed succeeded |
| T-D8-6 no-op UPDATE on a stored row allowed | CI | T-D8-3 shows a real change on a stored row is refused |
| T-D8-7 anon (real anon-key call) and an authenticated PM refused 42501 | CI | service_role updates the same row |
| T-D8-8 service_role DELETE refused 42501 | CI. TRUNCATE is scaffold only: PostgREST cannot issue it (`G2-green.txt`) | the row still reads back |
| T-D8-9 trigger function not callable | CI checks over PostgREST (42501 or PGRST202); the catalog proof (`has_function_privilege` false for all four, no PUBLIC entry, an owner call reaches the function and gets 0A000) is scaffold (`G2-green.txt`) and the in-file post-condition block | an exposed test helper is callable |
| T-D8-10 DOWN rehearsal | **scaffold only** (`G3-down.txt`). Marked `it.skip` with the same reason | see section 6 |
| T-D8-11 overload rule, static | CI and local, no database: exactly one `CREATE [OR REPLACE] FUNCTION public.<name>` per 050 name across `supabase/migrations/` and `docs/reviews/*.sql`; 051's function is not one of the seven | a planted second definition is counted; a comment-only mention is not |

Owner-only precedent for the skipped tests: `test/capture-races.test.ts:307` and `test/capture-pm-functions.test.ts:276`.

**Also scaffold-only, not CI:** QE014 (PostgREST is always READ COMMITTED), under REPEATABLE READ and SERIALIZABLE, with a READ COMMITTED control (`G2-green.txt`). And a regression smoke that the 050 INSERT path still works with 051 in place (`apply_material_inward_turn` inserts pending rows, the ingest-style UPDATE then works, a rewrite of the same row is refused).

**What was run, honestly.**

- T-D8-11 and `tsc --noEmit` were run locally with no database and no credentials in scope (`T-D8-11-static.txt`): 9 passed, 11 skipped (the database tests, deselected), `tsc` exit 0.
- **The database tests (T-D8-1 to 9) have not been run anywhere.** The block forbade any write to a remote database and they create fixtures. They are typechecked only. Their expected error codes (`QE011` surfacing as `error.code`, `42501`, `PGRST202`) are inferred from precedent (`test/capture-engineer-flow.test.ts:200` reads `error?.code` for `QE012`). [inferred]
- No concurrency or race test exists in this package (CLAUDE.md §0: local passes prove nothing for those).

## 6. DOWN: steps, precondition, rollback order

`G3-down.txt`, run on the scaffold with a **pending file row (40) and a queued `capture_ingest` job** seeded first.

1. Precondition: refuse (`DOWN_PRECONDITION_051`) unless the 051 ledger row, the function and the trigger all exist.
2. `DROP TRIGGER`; `DROP FUNCTION`; `REVOKE UPDATE (seven columns) ON public.capture_files FROM service_role`; delete the 051 ledger row; closing assertion (function and trigger gone, UPDATE false on all seven, SELECT still held, ledger row gone).

Results, all from the transcript:

- First DOWN exit 0.
- After it, `service_role` UPDATE is 42501 again (T-D8-1 shape); the owner's `sha256` rewrite on a stored row **succeeds again** (T-D8-3 shape), which proves the DOWN really removes the lock.
- The fingerprint of function, trigger, table ACL and column ACLs equals the pre-051 baseline from `G0-red.txt` (`0f74d310…`). The hash of every comment on the table, its columns and the function equals the baseline too (CLAUDE.md §7: a teardown verifies comments).
- The seeded pending row and the queued job are intact. A new engineer file turn still INSERTs a pending row and queues its job (050 does not depend on 051).
- A **second DOWN is refused**: `DOWN_PRECONDITION_051: ledger_051=f functions_found=0 triggers_found=0`; the fingerprint is unchanged.
- **Re-apply after DOWN** exits 0; the fingerprint equals the first post-apply fingerprint (`c76efac5…`); the grant works and the rewrite is refused again.
- A **second apply** of 051 on an applied database fails cleanly (`function … already exists`, exit 3) and the fingerprint is unchanged (`G1-apply.txt`).

**Rollback order.** C5 (the ingest job) must be rolled back **before** this DOWN, because the ingest needs the column grant. After this DOWN the pending-row ingest UPDATE fails 42501 (shown in `G3-down.txt`). Full order: C6 → C5 → C4 → C3 → this DOWN (C2). Then, outside PR-C, the existing order **C, then B, then A**: PR-C rolled back first, then 050's DOWN, then 049's DOWN last. Run outside 08:25–08:40 and 18:25–18:40 IST. 051 locks only `capture_files`, not `whatsapp_sessions`, `[inferred]` from the SQL: `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE on that table and `GRANT` a brief lock; `lock_timeout` is 3 s.

**Scaffold stand-in, stated plainly:** the scaffold's migration-ledger table is a stub (`049-sql-evidence/scaffold-stubs.sql`). I inserted the `051` ledger row by hand after each scaffold apply, so the DOWN's precondition and its ledger `DELETE` had a row to act on. On prod the ledger step is a separate action; the DOWN's precondition would refuse if that row were missing.

## 7. What is NOT yet done

- Test-db apply of 051 (and its ledger row).
- CI green with a pinned run URL. CI is **expected RED** on `test/capture-files-immutability.test.ts` until the test-db apply. CI is also expected RED on the migration lint (see open item L below).
- Prod readback for "PITR substituted": PITR is OFF until launch. At the prod apply, save the prod pre-apply ACL / trigger / column-grant readback for `capture_files` with its sha256 and record the word "substituted". Not part of this block; `051-down-prod.sql` here is the file that readback pairs with.
- Prod apply (`supabase db query --linked -f`, with Aravind's go-ahead in the same exchange, CLAUDE.md §0).
- Reservation entry in `scripts/migration-number-reservations.json` (Step H) and the move of the SQL into `supabase/migrations/` (CLAUDE.md §6). **Not done here, per the block's limits.**
- Types regeneration after the apply (no type change expected `[inferred]`: no new column or table).
- Confirm the migration file is on `main` and test-db carries it for real (CLAUDE.md §0 rule (d) and (e)).

**Open items found while doing this** (stated, not resolved):

- **L. The repo lint fails on this branch.** `npm run lint:migrations` reports `docs/reviews/051_capture_files_immutability.sql: unreserved-051 [held-migration-reservation-required]` (`G4-lint.txt`). Lint rule 8 requires every held `docs/reviews/NNN_*.sql` file to have an entry in `scripts/migration-number-reservations.json`. The block's limits (and the plan, section 8) say the reservation is written only in the prod-apply commit. These two conflict. I followed the block's explicit limit and did not touch the JSON. Every other lint rule passed for 051 (the report lists only this one violation). Aravind decides: add a held-file reservation (`claimedBy: docs/reviews/051_capture_files_immutability.sql`) in this PR, or accept a red lint until the apply commit.
- **H14 is unaffected.** `test/capture-tables.test.ts` H14 asserts exactly six trigger functions, but the helper `quoco_test_capture_acl()` iterates a fixed list of six names (`scripts/test-db-only-capture-helpers.sql:198`), so a seventh function does not change its count. It also means that helper does not report 051's function. T-D8-9 therefore does not use it.
- **Scaffold-only evidence for TRUNCATE.** PostgREST cannot issue TRUNCATE, so the `service_role` TRUNCATE denial is shown on the scaffold only.

## 8. Hashes

Full sha256 of every file (also in `docs/reviews/051-sql-evidence/SHA256.txt`, which lists everything except itself and this package):

```
70ef913cb3a111246ed73f3946dfebedfd690343aaaa92ae2e0edb2551c349d2  docs/reviews/051_capture_files_immutability.sql
0a587f06bb0f81ba7bf75a30a79859febaccf1658814490b64c3ce1d87758101  docs/reviews/051-down-testdb.sql
95a6b3357f65e86a070b058051e23f765aeef3076aa795423fdb61610e0a6646  docs/reviews/051-down-prod.sql
56794979358d740d0a59f59e5cfa6ed59983f4a5af76a69e4706f06f5d62a570  test/capture-files-immutability.test.ts
09040e2d9e0152e812f59d290b872f033c3ecf074d2a07226de0c303b25bd553  docs/reviews/051-sql-evidence/scaffold-build.txt
3233a5abca119f69ca1d0fe8e26520eb22e20db45f8deb482456d26cec4e4363  docs/reviews/051-sql-evidence/G0-red.txt
09fd53f0eb4278d2a221c7114bac93b02a1ef8798394a99421aab4d8953f78b5  docs/reviews/051-sql-evidence/G0b-reviewer-stub.txt
ee2704f55f881b190c46743aceda63e1d86eaac9a0d4ee871d174c068a908d7a  docs/reviews/051-sql-evidence/G1-apply.txt
45811e1182bd8ef2d8fc2db8600a80de05e2aba5fa8220d2baa16a260a3cf015  docs/reviews/051-sql-evidence/G1b-postcondition-negative.txt
e131513d60a79975e0ef6f42d0db95ef9246daeb55a6d9c95c8951b36aa21e7e  docs/reviews/051-sql-evidence/G2-green.txt
741c25d15dd87662c3f20b702aff9ba3b43901e7c8d1cf84c9bbb3b1cc6f708c  docs/reviews/051-sql-evidence/G2b-mutant.txt
77e1dd870bb77a6fd039d2163ea6cccc50f9f6d0bb06812281f58b6ae7edf87b  docs/reviews/051-sql-evidence/G3-down.txt
f82555ac79c4d486afe437cc40475d9999ead63a8d73dfd89311b911f1af65b3  docs/reviews/051-sql-evidence/G4-lint.txt
09545f71ea2e2604db4712b7ca4e706941600c40e4237ac360d39db63210ba31  docs/reviews/051-sql-evidence/G5-049-down-guard.txt
9ae2f48d476e868d426b5f199329c4dc1eb346886ad947bed8b3615061765339  docs/reviews/051-sql-evidence/G6-scaffold-teardown.txt
73f6e32ab16995ed4bee3d926d186bfbaff24d2fa642c235dfa26eafeb8e4695  docs/reviews/051-sql-evidence/T-D8-11-static.txt
```

How the scaffold was built (`scaffold-build.txt`): a read-only schema dump of test-db `public` (linked ref printed first, equal to `exfccwlrhoutkgrlikod`), loaded into a disposable local PG 17.11 cluster with the named stubs of `docs/reviews/049-sql-evidence/scaffold-stubs.sql` and the 049 and 050 helper libraries (`049-sql-evidence/src/_lib.sql`, `_fixture.sql`, `050-sql-evidence/src/_lib050.sql`). Procedure cited from `docs/reviews/049-sql-evidence/scaffold-build.txt` and `docs/reviews/050-sql-evidence/run050.sh`. The scenario SQL files are not committed (the block listed no place for them); `psql -e` echoed every statement into the transcripts. `G6-scaffold-teardown.txt` records that the cluster was stopped and its data directory, schema dump and mutant file deleted.

## 9. Questions for the reviewer

1. **Is the identity-column list complete?** It is the nine columns the grant does not cover. Should `ingest_status` ever be treated as identity? (Today it is the only status column and moves forward only.)
2. **Should `failed` → `failed` with a column change be allowed?** Today it is allowed, so a retry can update `preview_state` or `reject_reason` while the row stays `failed`. The alternative is to allow only a status move out of `failed`.
3. **Is `SECURITY DEFINER` needed on this trigger function, or would `SECURITY INVOKER` suffice?** The body reads only `OLD`, `NEW` and `current_setting`. It touches no table. I kept `DEFINER` with `search_path = ''` for consistency with 049's six trigger functions and the lint rule's expectations. If `INVOKER` is acceptable it removes a definer function from the audit surface. I did not test the `INVOKER` variant.
4. **Is any column missing from the grant that C5 will need?** The seven are the ones the plan names (`V3:103`). C5 is not written yet. If C5 needs `claimed_content_type` (identity) or a column that does not exist today, this migration is the wrong place to find out.
5. **Is a no-op UPDATE on a terminal row correctly allowed?** The decision is Aravind's, for retry safety. A no-op UPDATE still fires the trigger and writes a new row version (WAL). Is that acceptable at ingest retry volume?
6. **Reuse of QE009 / QE011 / QE014.** No new code was added. The app has no string for these on this table. Does a future caller other than the ingest job need a distinct code?
7. **Pending → pending with changes.** A `pending` row may have any of the seven columns changed without a status move (for example `sha256` set while still `pending`). The CHECKs only bind `stored` and `rejected`. Is that acceptable, or must the four "stored details" move together with the status?
8. **Owner and superuser.** The trigger does not stop the table owner or a superuser from disabling it (`ALTER TABLE … DISABLE TRIGGER`), and a row trigger does not fire on TRUNCATE. Both are out of reach of `service_role`. Is that the boundary the reviewer wants, or should an event trigger or a stricter owner policy be considered?
9. **Reservation timing** (open item L). Reserve the number in this PR, or accept a red lint until the apply commit?
10. **Prod ACL pre-state.** The scaffold comes from the test-db dump. Prod was not read. The "PITR substituted" readback at the prod apply is the first time prod's `capture_files` ACLs are observed for this migration. Is a different pre-apply check wanted?
