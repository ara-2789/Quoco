# Migration 051 — `capture_files` immutability, lifecycle CHECKs and column UPDATE grant: review package (C2), rev 2

**Status: REVIEW PACKAGE ONLY. Nothing here has been applied to any database.** Test-db apply, CI green, the prod readback, the prod apply, the move into `supabase/migrations/` and the types check are all still to do (section 7).

**Tier: FULL** (CLAUDE.md §0 external-review triggers: (a) a new trigger function is live logic; (b) a new `SECURITY DEFINER` function and a new column-level UPDATE grant on a tenant-scoped table).

---

## Rev 2, 2026-10-27 — after external review round 1 (verdict: STOP, one round short)

**The review text.** `docs/reviews/051-external-review-round-1.md`, sha256 `08e1516d06cd28cead094ac812efa68578ca98624d97513dd55b459aece62c7b`, 148 lines. **Provenance note, per Aravind:** it was copied by Aravind from the rendered message. The reviewer's two opening narration lines and the markdown formatting are missing. Every finding is present. The file is not edited.

**Decisions, per Aravind, 2026-10-27.** B1 and B2 accepted as the reviewer wrote them. S2 yes, with one change from the reviewer's wording (see question R2-1): `ingested_at` is **stamped by the database**, not written by the caller, and is **not** added to the `service_role` grant (precedent: 049 TR1 stamps `delivery_invoice_links.linked_at`, F4-1). `failed` → `failed` with column changes stays allowed (now safe under B1).

**Repo-state header.** `main @ 10cd3a3047d281c34a5e34cbae13d016dd0aa276` (merge of PR #338; `git fetch origin` before every comparison). `supabase migration list`: **not run** (no remote access beyond the one read-only schema dump of test-db; `supabase/migrations/` on `origin/main` ends at `050`). Rev 1 head was `9e9b63b`; rev 2 artifact commit is `c606afa`.

### Findings → what changed

| Finding | What changed | Where (rev 2 SQL line numbers) | Evidence |
|---|---|---|---|
| **B1** the terminal lock freezes contradictory rows | Two CHECKs added before the trigger: `capture_files_reject_reason_iff_chk` (`(ingest_status='rejected') = (reject_reason IS NOT NULL)`) and `capture_files_stored_only_chk` (`storage_path`, `sha256`, `preview_state` only when `stored`). `content_type` and `byte_size` stay allowed off `stored`. | `051_…sql:141-145`; post-condition `:270-278`; DOWN drops `051-down-*.sql:56-59` | `G0c-review-probes-rev1.txt` (probes 1 and 2 SUCCEED on rev 1), `G2-green-rev2.txt` T-D8-12, T-D8-13 (23514) |
| **B2** two rows can point at one object | `capture_files_storage_path_row_chk`: the path must start with `tenant/project/document/<this row's id>`. 049's weaker `capture_files_storage_path_prefix_chk` is **kept** (live, a subset; header explains why). | `:147-150`; DOWN `:57` | `G0c` probe 3 SUCCEEDS on rev 1; `G2-green-rev2` T-D8-14 (23514); mutant `G2b-mutant-pathchk-rev2.txt` (5 FAIL) |
| **S1** the bytes are not locked | Header line 3 and section 1 reworded with a dated correction: 051 locks the database record, not the bytes in Storage. The byte guard is C5's. | `:3-14`; carry-forward item 5 | `docs/plans/pr-c-carry-forward.md` items 5 and 6 |
| **S2** no terminal timestamp | `ingested_at timestamptz` added (nullable, no default). `capture_files_ingested_at_iff_chk`: terminal ⇔ `ingested_at IS NOT NULL`. The trigger first compares the caller's `NEW.ingested_at` to `OLD` (**QE009** if different), then stamps `now()` on the move from `pending` or `failed` into `stored` or `rejected`. **Not granted.** `now()` is the transaction start time, the function 049's TR4 uses for `approved_at` (S-3). | column `:138`; check `:152-155`; compare `:188-190`; stamp `:209-211` | `G2-green-rev2` T-D8-15, T-D8-15b, T-D8-6; mutant `G2b-mutant-stamp-rev2.txt` (15 FAIL) |
| **N1** stale self-attestation | Section 7 and question 9 get dated addenda below. The lint transcript at the resubmitted head is `G4-lint-rev2.txt` (**GREEN**; committed in the last commit, run at the commit before it). | §7, §9 | `G4-lint-rev2.txt` |
| **N2** C5 contract | Written into the C5 plan carry-forward, not this file: filter C5's UPDATE on `ingest_status IN ('pending','failed')`; QE011 is an alert, never a retry; logs carry the table name. | `docs/plans/pr-c-carry-forward.md` item 6 | — |
| **N3** hand-kept column lists | A test asserts the table's columns equal identity ∪ granted ∪ `{ingested_at}` (17). The test names the lists it compares against. | `test/capture-files-immutability.test.ts` T-D8-16 | `G2-green-rev2` T-D8-16 (both directions, count 17) |
| **N4** DOWN refuses without the ledger row | Written into the apply-runbook carry-forward: the ledger row is part of "apply done". The DOWN precondition now also requires the four constraints and the column. | `docs/plans/pr-c-carry-forward.md` item 8; DOWN `:24-47` | `G3-down-rev2.txt` |

### The reviewer's three probes: RED on rev 1, GREEN on rev 2

| Probe | Rev-1 051 (`G0c-review-probes-rev1.txt`, run as `service_role`) | Rev-2 051 (`G2-green-rev2.txt`) |
|---|---|---|
| 1 (B1): failed with `reject_reason`, then stored | `HOLE rev-1 probe 1a … succeeded` and `1b … succeeded`; `1c` clearing it is refused QE011. Row ends `stored`, `reject_reason too_large` | probe 1a refused **23514**, probe 1b refused **23514**; control: failed → stored with full details and no `reject_reason` succeeds |
| 2 (B1): rejected carrying `sha256`, `storage_path`, `preview_state` | `HOLE rev-1 probe 2 … succeeded`. Row ends `rejected`, `cccc`, `previewable` | each extra refused **23514** (also the full rev-1 shape); control: pending → rejected `too_large` WITH `byte_size` succeeds |
| 3 (B2): second row with another row's `storage_path` | `HOLE rev-1 probe 3 … succeeded`. Rows 3 and 4 share one path | refused **23514**; also a path in the right folder with no row id refused **23514**; control: its own path succeeds |

The rev-1 file used for the RED run is `git show 9e9b63b:docs/reviews/051_capture_files_immutability.sql`, sha256 checked equal to `70ef913c…49d2` by the runner (it stops on a mismatch).

### Other rev 2 results (`*-rev2.txt`)

- **Baseline RED** (`G0-red-rev2.txt`): 4 PASS, 7 expected FAIL. The fingerprint now covers `pg_constraint` and the column list.
- **Apply** (`G1-apply-rev2.txt`): exit 0, the in-file post-condition passed; a second apply fails cleanly (`function … already exists`) and the fingerprint is unchanged.
- **Post-condition negatives** (`G1b-postcondition-negative-rev2.txt`): the earlier three (extra DELETE grant, `UPDATE (file_no)` grant, table-level UPDATE for `authenticated`) each abort the file; **new case D**: a pre-existing `stored` row (valid under 049, no way to carry `ingested_at`) makes `capture_files_ingested_at_iff_chk` fail to validate (`ERROR: check constraint … is violated by some row`). Afterwards no column, no constraint, no function, no trigger, no grant, and the fingerprint equals the pre-051 baseline: the whole file aborted.
- **GREEN** (`G2-green-rev2.txt`): **121 PASS, 0 FAIL.**
- **Mutants** (the same GREEN scenario): ingested_at stamp removed → 15 FAIL (`G2b-mutant-stamp-rev2.txt`); `capture_files_storage_path_row_chk` dropped → 5 FAIL (`G2b-mutant-pathchk-rev2.txt`); terminal-row check removed → 20 FAIL (`G2b-mutant-terminal-rev2.txt`).
- **DOWN** (`G3-down-rev2.txt`): 24 PASS, 0 FAIL. After the DOWN the fingerprint (function, trigger, table ACL, column ACLs, **every constraint, the column list**) and the comments hash equal the pre-051 baseline exactly; the four rev-2 constraints and the column are gone; the six 049 constraints remain. A second DOWN is refused (`DOWN_PRECONDITION_051: ledger_051=f functions_found=0 triggers_found=0 …`). Re-apply with rehearsal rows still present **aborts whole** (see R2-4); after the scaffold cleanup it succeeds and the fingerprint equals the first post-apply fingerprint.
- **Guard 2** (`G5-049-down-guard-rev2.txt`): the rev-2 function body still names no capture table. A static test (T-D8-17) now enforces that.
- **Static** (`T-D8-11-static-rev2.txt`): T-D8-11 and T-D8-17, 11 passed, 17 skipped (the database tests), `tsc --noEmit` exit 0.
- Scaffold built from a fresh read-only schema dump of test-db (ref printed first, `exfccwlrhoutkgrlikod`; the dump is the same size as in rev 1, 302834 bytes). Destroyed: `G6-scaffold-teardown-rev2.txt`.

### New things found while doing rev 2

- **R2-A. A DOWN loses data and a re-apply needs the table clean.** The DOWN drops `ingested_at`, so it discards the terminal timestamps. A re-apply over existing stored or rejected rows aborts (no backfill time is invented, as the reviewer warned). Shown in `G3-down-rev2.txt` and G1b case D.
- **R2-B. The apply block must count rows first.** Prod `capture_files` is **believed empty**: nothing calls `apply_material_inward_turn` before C4. That is a belief, not an observation. The apply block verifies it with a read-only count of `capture_files` by status, on test-db and on prod, before the apply (carry-forward item 9).
- **R2-C. Any test-db leftovers.** Test-db teardown deletes capture rows, but a leftover stored or rejected row would abort the test-db apply. Same read-only count.
- **R2-D. The scaffold's own RED rows** (a stored and a rejected row from G0) also abort the apply; `G1-apply-rev2.txt` logs the cleanup step explicitly.

---

## 1. What this changes, in product terms

A file an engineer sends (a delivery challan or an invoice photo or PDF) becomes a `capture_files` row. The row starts `pending`. A background job (C5, not built yet) later downloads the bytes, checks them, and fills in the row's stored details.

Today nobody can change a `capture_files` row at all. 049 gave `service_role` read access only. The ingest job needs to write, so this migration gives it a narrow write right, and locks the result.

> ~~A stored capture file can never be silently changed.~~ **Dated correction (S1), rev 2, 2026-10-27, per external review:** 051 locks the **database record** of a stored file, not the bytes in Storage. `service_role` can still overwrite a Storage object. The byte guard is C5's: upload with `upsert: false` to the row-owned path (B2), and no C5 code path overwrites or deletes an object under a stored row.

What the migration does:

1. **Only the ingest job's seven columns can be written, and only by `service_role`.** Nobody else can write anything.
2. **Once a file is `stored` or `rejected`, its row can never change again.** Its hash, path, size, type and timestamp are fixed. A file's identity (which document, which page, which message) never changes at all.
3. **A row's shape is always consistent** (rev 2). A rejected file has a reason and no stored details. A stored file has its details and no reason. A file's path always belongs to that file's own row. A file that reached `stored` or `rejected` always has the time it got there, stamped by the database.

This closes the hole the external reviewer proved open on a stub (`049-review-package.md:145`), and the two holes round 1 found in rev 1.

## 2. The exact objects and grants (SQL line numbers, rev 2)

File: `docs/reviews/051_capture_files_immutability.sql` (held in `docs/reviews/`; it moves into `supabase/migrations/` only in the apply commit, CLAUDE.md §6).

| What | Lines |
|---|---|
| Header: purpose, S1 dated correction, rev 2 summary, plain-words list, decisions, row-shape rules, transition table, QE map, identity list, locks, source map, DOWN pointer | 1–127 |
| `BEGIN;` and `SET LOCAL lock_timeout = '3s';` | 130, 132 |
| `ALTER TABLE … ADD COLUMN ingested_at timestamptz` | 138 |
| `capture_files_reject_reason_iff_chk`, `capture_files_stored_only_chk` (B1) | 141–145 |
| `capture_files_storage_path_row_chk` (B2) | 147–150 |
| `capture_files_ingested_at_iff_chk` (S2) | 152–155 |
| `CREATE FUNCTION public.trg_capture_files_before_update()` (`RETURNS trigger`, `plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`) | 161–216 |
| QE014 refusal, first statement | 169–171 |
| Identity columns immutable, QE009 | 174–184 |
| `ingested_at` never caller-set, QE009 (compared **before** the stamp) | 186–190 |
| Terminal rows: any change refused QE011, a no-change UPDATE allowed | 192–199 |
| Status moves for `pending` and `failed`, QE011 otherwise; **stamp `ingested_at := now()`** on a move into `stored` or `rejected` | 201–212 |
| `CREATE TRIGGER trg_capture_files_before_update BEFORE UPDATE … FOR EACH ROW` | 222–225 |
| `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role` (all four by name) | 235 |
| `GRANT EXECUTE … TO postgres` (changes no effective ACL; satisfies lint Rule 1 as `049:988-1004` does) | 236 |
| `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) ON public.capture_files TO service_role` (column-scoped; **seven columns, `ingested_at` not among them**) | 243–244 |
| In-file post-condition `DO` block (`POSTCONDITION_051`) | 250–383 |
| `COMMIT;` | 385 |
| Commented DOWN block | 387–end |

The function body never writes a capture table name. That is deliberate: 049's DOWN Guard 2 scans function bodies for table names and blocks the 049 DOWN on a match. `G5-049-down-guard-rev2.txt` shows 051's function does not match, and static test T-D8-17 enforces it.

**What the post-condition block checks** (any miss raises `POSTCONDITION_051` and the whole file aborts): exactly one `pg_proc` row; `prosecdef`; owner `postgres`; `proconfig = {search_path=""}`; a non-NULL ACL with no PUBLIC entry; no role holds EXECUTE; the trigger exists, is enabled, is BEFORE UPDATE FOR EACH ROW and is bound to this function; **(rev 2) the `ingested_at` column exists, is `timestamptz`, nullable and has no default; the four new CHECKs exist, are CHECKs and are validated**; `has_column_privilege('service_role', …, 'UPDATE')` is true for exactly the seven columns and false for every other column (all 17 columns are walked); false for `anon` and `authenticated` on every column; **(rev 2) an explicit check that no role can UPDATE `ingested_at`**; `has_table_privilege(…, 'UPDATE')` false for all three roles; `service_role` holds no DELETE and no TRUNCATE and still holds SELECT; all seven granted columns exist.

**Identity columns (QE009).** `id, created_at, tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type`. `capture_files` now has 17 columns: 9 identity + 7 granted + `ingested_at`. The reviewer confirmed the 9 + 7 = 16 count against `049:311–340`.

**DOWN files.** `docs/reviews/051-down-testdb.sql` (test-db, `exfccwlrhoutkgrlikod`) and `docs/reviews/051-down-prod.sql` (prod, `jvxwqignooseazzmwhvl`). Identical bodies; each header names its own database and says never to apply it to the other. Lines: `BEGIN` 17; `lock_timeout` 19; precondition (ledger row, function, trigger, **four constraints, the column**) 24–47; `DROP TRIGGER` 51; `DROP FUNCTION` 52; **drop the four constraints 55–59, `DROP COLUMN ingested_at` 60**; `REVOKE UPDATE (…)` 63; ledger `DELETE` 67; closing assertion 71–110; `COMMIT` 112.

## 3. The threat it closes: `049-review-package.md:145`, and what round 1 found

**Rev 1's hole (the original blocking item).** With the column grant but no trigger, a stored file's `sha256` could be rewritten. Reproduced in `G0b-reviewer-stub-rev2.txt` (7 PASS, each a reproduced hole). On the real baseline before 051 (`G0-red-rev2.txt`), `service_role` is refused 42501 and even the table owner can rewrite a stored row (4 PASS, 7 expected FAIL).

**Rev 2's three further probes** are in the table in the Rev 2 section above: all three SUCCEED on rev 1 and are refused 23514 on rev 2.

**GREEN, after 051 rev 2** (`G2-green-rev2.txt`): 121 PASS, 0 FAIL. On a `stored` row, `service_role` rewriting `sha256`, `storage_path`, `byte_size`, `content_type`, `preview_state` or `reject_reason` is refused QE011. The table owner rewriting `sha256` is refused QE011 too. The stored row is byte-for-byte unchanged afterwards.

**The tests can fail.** Three mutants (Rev 2 section): 15, 5 and 20 FAIL lines. **The post-condition block can fail:** four wrong starting states abort the file whole.

## 4. Status transitions, row shape and QE codes

Order of checks inside the trigger: QE014 first, then identity (QE009), then `ingested_at` (QE009), then terminal rows (QE011), then status moves (QE011). The table CHECKs (23514) run after the trigger.

| From → To | Result |
|---|---|
| `pending` → `pending`, `stored`, `rejected`, `failed` | allowed by the trigger; the CHECKs then enforce the shape (below) |
| `failed` → `stored`, `rejected` | allowed |
| `failed` → `failed` (with or without a column change) | allowed (reviewer: allow, now that B1 has landed) |
| `failed` → `pending` | QE011 |
| `stored` → anything else, or any column change | QE011 |
| `rejected` → anything else, or any column change | QE011 |
| `stored` → `stored` or `rejected` → `rejected` with **no** change | allowed (a retried job is a no-op); `ingested_at` unchanged |
| any identity column changes, or `ingested_at` changes by a caller | QE009 (also on `stored` and `rejected` rows; checked before QE011) |
| writer not READ COMMITTED | QE014 |

**Row shape (23514, from the CHECKs):** `reject_reason` set ⇔ `rejected`; `storage_path`, `sha256`, `preview_state` only when `stored`; `content_type` and `byte_size` allowed on any status (so a `too_large` or `wrong_type` reject can record what was observed); `storage_path` starts with `tenant/project/document/<row id>`; `ingested_at` set ⇔ `stored` or `rejected`. 049's own six CHECKs are unchanged, including the weaker prefix check, which is kept as a second wall.

| Code | Meaning | Source |
|---|---|---|
| QE009 | immutable column changed (or `ingested_at` caller-set) | 049 `trg_capture_documents_before_update` (`049:784-791`), map `pr-b-050-plan.md:129-131` |
| QE011 | locked content or refused status move | same |
| QE014 | non-READ-COMMITTED writer | `049:778-780` |
| 23514 | row shape (CHECK) | standard Postgres `check_violation` |

No new QE code. The reviewer: make sure logs carry the table name, since `E11` now means two tables (carry-forward item 6).

## 5. Test list: what runs in CI, what is scaffold-only

`test/capture-files-immutability.test.ts`. Each test names its positive control in its title or a comment.

| Test | Where it runs | Positive control |
|---|---|---|
| T-D8-1 service_role updates the seven columns of a pending row | CI against test-db (RED until the test-db apply) | the row reads back `stored` |
| T-D8-2 grant layer: `file_no`, `claimed_content_type`, `tenant_id`, `id` refused 42501 | CI | a granted column (`byte_size`) on the same row succeeds |
| T-D8-2b trigger layer with the grant bypassed, QE009 | **scaffold only** (`G2-green-rev2.txt`, all nine identity columns). `it.skip`: "needs owner connection; evidence in docs/reviews/051-sql-evidence/" | owner UPDATE of a granted column and an owner no-op both succeed |
| T-D8-3 stored row: `sha256`, `storage_path`, `byte_size`, `content_type` rewrite refused QE011 | CI | pending → stored with full details succeeds (inside `newStored`); **replaces the rev-1 control, which is now refused 23514 by design** |
| T-D8-4 rejected is terminal | CI | pending → rejected succeeded when the row was made |
| T-D8-5 no move back to pending; failed → stored / rejected allowed | CI | pending → failed succeeded |
| T-D8-6 no-op UPDATE on a stored row allowed, `ingested_at` unchanged | CI | T-D8-3 shows a real change on a stored row is refused |
| T-D8-7 anon (real anon-key call) and an authenticated PM refused 42501 | CI | service_role updates the same row |
| T-D8-8 service_role DELETE refused 42501 | CI. TRUNCATE is scaffold only: PostgREST cannot issue it | the row still reads back |
| T-D8-9 trigger function not callable | CI over PostgREST (42501 or PGRST202); catalog proof on the scaffold and in the post-condition block | an exposed test helper is callable |
| T-D8-10 DOWN rehearsal | **scaffold only** (`G3-down-rev2.txt`). `it.skip`, same reason | see section 6 |
| T-D8-11 overload rule, static | CI and local, no database | a planted second definition is counted; a comment-only mention is not |
| **T-D8-12** B1 probe 1: failed + `reject_reason` refused 23514, and failed → stored carrying it | CI | failed → stored with full details and no reason succeeds |
| **T-D8-13** B1 probe 2: rejected + `sha256` / `storage_path` / `preview_state` refused 23514; a pending row carrying `sha256` refused | CI | pending → rejected `too_large` WITH `byte_size` succeeds |
| **T-D8-14** B2 probe 3: another row's `storage_path` refused 23514 | CI | the row's own path, stored, succeeds |
| **T-D8-15** S2: `ingested_at` stamped on the move into `stored` / `rejected`, inside a window around the test's own clock (±2 minutes, DB clock vs this machine); not stamped on `failed`; `service_role` setting it refused 42501 | CI | a granted-column update on the same row succeeds |
| **T-D8-15b** S2: an owner UPDATE that sets `ingested_at` raises QE009 | **scaffold only** (`G2-green-rev2.txt`). `it.skip`, same reason | owner `byte_size` update succeeds |
| **T-D8-16** N3: the table's columns = identity ∪ granted ∪ `{ingested_at}` (17), both directions | CI (reads the keys of a `select *`) | the test names the lists; a new column fails it |
| **T-D8-17** the 051 function body names no capture table (Guard 2) | CI and local, no database | the matcher matches a body that does name the table |

Owner-only precedent for the skipped tests: `test/capture-races.test.ts:307` and `test/capture-pm-functions.test.ts:276`.

**Also scaffold-only, not CI:** QE014 under REPEATABLE READ and SERIALIZABLE with a READ COMMITTED control; the 050 INSERT-path regression (`apply_material_inward_turn` inserts pending rows that satisfy every new CHECK, the ingest-style UPDATE then works and stamps `ingested_at`, a rewrite is refused QE011).

**What was run, honestly.**

- T-D8-11, T-D8-17 and `tsc --noEmit` were run locally with no database and no credentials in scope (`T-D8-11-static-rev2.txt`): 11 passed, 17 skipped (the database tests, deselected), `tsc` exit 0.
- **The database tests (T-D8-1 to 9, 12 to 16) have not been run anywhere.** The block forbade any write to a remote database and they create fixtures. They are typechecked only. Their expected error codes (`QE011` surfacing as `error.code`, `42501`, `23514`, `PGRST202`) are inferred from precedent (`test/capture-engineer-flow.test.ts:200` reads `error?.code` for `QE012`). **The reviewer notes the apply GO needs a pinned green CI run where QE011 is observed as `error.code`; today that is still inferred.** `23514` is a standard Postgres code that PostgREST passes through; also not yet observed.
- The scaffold is PG 17.11 (the reviewer's probes ran on PG 16.15).
- No concurrency or race test exists in this package (CLAUDE.md §0).

## 6. DOWN: steps, precondition, rollback order

`G3-down-rev2.txt`, run on the scaffold with a **pending file row (40) and a queued `capture_ingest` job** seeded first.

1. Precondition: refuse (`DOWN_PRECONDITION_051`) unless the 051 ledger row, the function, the trigger, **the four constraints and the `ingested_at` column** all exist.
2. `DROP TRIGGER`; `DROP FUNCTION`; **`DROP CONSTRAINT` ×4; `DROP COLUMN ingested_at`**; `REVOKE UPDATE (seven columns)`; delete the 051 ledger row; closing assertion (function, trigger, constraints and column gone, UPDATE false on all seven, SELECT still held, ledger row gone).

Results (24 PASS, 0 FAIL): first DOWN exit 0; `service_role` UPDATE is 42501 again; the owner's `sha256` rewrite on a stored row **succeeds again** and an owner can again put a hash on a rejected row (the lock and the CHECKs are really gone); the fingerprint (now including every constraint and the column list) and the comments hash **equal the pre-051 baseline exactly**; the six 049 constraints remain; the seeded pending row and queued job are intact; a new engineer file turn still inserts a pending row and queues its job; a **second DOWN is refused**; a **re-apply over the rehearsal's rows aborts whole** with the table equal to the baseline; after the scaffold clears those rows the re-apply passes and the fingerprint equals the first post-apply fingerprint.

**Data loss, stated:** the DOWN discards `ingested_at` values.

**Rollback order.** C5 (the ingest job) must be rolled back **before** this DOWN, because the ingest needs the column grant. Full order: C6 → C5 → C4 → C3 → this DOWN (C2). Then, outside PR-C, **C, then B, then A**: PR-C rolled back first, then 050's DOWN, then 049's DOWN last. Run outside 08:25–08:40 and 18:25–18:40 IST. 051 locks only `capture_files`: `ADD CONSTRAINT` takes ACCESS EXCLUSIVE and scans the table (the reviewer: fine, 050 is live and inserts only pending rows with NULL details, which satisfy every check); `lock_timeout` is 3 s.

**Scaffold stand-in, stated plainly:** the scaffold's migration-ledger table is a stub. I inserted the `051` ledger row by hand after each scaffold apply. On prod the ledger step is a separate action; the DOWN's precondition would refuse if that row were missing (N4).

## 7. What is NOT yet done

- Test-db apply of 051 rev 2 (and its ledger row), preceded by the read-only row count (R2-B, R2-C).
- CI green with a pinned run URL, where `QE011` is observed as `error.code`. CI is **expected RED** on `test/capture-files-immutability.test.ts` until the test-db apply.
- Prod readback for "PITR substituted": PITR is OFF until launch. At the prod apply, save the prod pre-apply ACL / trigger / constraint / column readback for `capture_files` with its sha256 and record the word "substituted". Not part of this block; `051-down-prod.sql` is the file it pairs with.
- Prod apply (`supabase db query --linked -f`, with Aravind's go-ahead in the same exchange, CLAUDE.md §0).
- ~~Reservation entry in `scripts/migration-number-reservations.json` (Step H).~~ **Dated addendum (N1), 2026-10-27:** the reservation entry **exists**, added in this PR in commit `9e9b63b` (048-050 precedent, lint Rule 8) and its note updated for rev 2 (sha256 `fbd3b3a5…5907`). What remains for the apply commit is the move of the file into `supabase/migrations/` and the `claimedBy` path change (CLAUDE.md §6, Step H).
- Types regeneration after the apply. **Not "no type change expected" any more:** rev 2 adds a column, so `types/database.ts` gains `ingested_at` on `capture_files`. [inferred: the regen is the existing post-apply step.]
- Confirm the migration file is on `main` and test-db carries it for real (CLAUDE.md §0 rule (d) and (e)).

**Open items.**

- ~~L. The repo lint fails on this branch (`held-migration-reservation-required`).~~ **Resolved 2026-10-27, per Aravind: reservation entry added in this PR (048-050 precedent, lint Rule 8).** `G4-lint-rev2.txt` is the GREEN transcript at the resubmitted head (closes N1); the rev-1 `G4-lint.txt` is the RED transcript of `44cac28`, kept as history.
- **H14 is unaffected.** `test/capture-tables.test.ts` H14 asserts exactly six trigger functions, but the helper `quoco_test_capture_acl()` iterates a fixed list of six names (`scripts/test-db-only-capture-helpers.sql:198`), so a seventh function does not change its count. That helper does not report 051's function, so T-D8-9 does not use it.
- **Scaffold-only evidence for TRUNCATE** (PostgREST cannot issue it).

## 8. Hashes

Full sha256 of every file (also in `docs/reviews/051-sql-evidence/SHA256.txt`, which lists everything except itself and this package; **`G4-lint-rev2.txt` and the final `SHA256.txt` are committed in the last commit, after the lint was run at the commit before it, so G4's hash is in `SHA256.txt` and not below**):

```
fbd3b3a535db3c9af41991c1b324ae0e7fe26fb5e5713a1de0e6b7a824c15907  docs/reviews/051_capture_files_immutability.sql
acd672658497c1dc745b90748c33704d9ac957d681f98324813737f557dc69c8  docs/reviews/051-down-testdb.sql
b43ed526c9f84057a672f221780e6971bb616731c5b2d96e2d05fc17d6c0a0b9  docs/reviews/051-down-prod.sql
db4fa5d758dc1479c54546109dcee23de77a1260f082e8e229652ffcd0b817a1  test/capture-files-immutability.test.ts
08e1516d06cd28cead094ac812efa68578ca98624d97513dd55b459aece62c7b  docs/reviews/051-external-review-round-1.md
7d86e44e999a2d7b52737380f34a0e45a1176cf89b6a7f63cb567b9959dc7a4b  docs/reviews/051-sql-evidence/G0-red-rev2.txt
3233a5abca119f69ca1d0fe8e26520eb22e20db45f8deb482456d26cec4e4363  docs/reviews/051-sql-evidence/G0-red.txt
a6796dcc4c58386ce1a7c098729c6e99ec9f3f7389fcb9f88618d2ab03480bab  docs/reviews/051-sql-evidence/G0b-reviewer-stub-rev2.txt
09fd53f0eb4278d2a221c7114bac93b02a1ef8798394a99421aab4d8953f78b5  docs/reviews/051-sql-evidence/G0b-reviewer-stub.txt
82a5ea4f2849f31cccbac970e905033d4df1167706d62daee8a70654b8fe2de0  docs/reviews/051-sql-evidence/G0c-review-probes-rev1.txt
fbf091899548a73e11a0bf0278dab350cdcb90bda03c6a469e88e85afc8cf54c  docs/reviews/051-sql-evidence/G1-apply-rev2.txt
ee2704f55f881b190c46743aceda63e1d86eaac9a0d4ee871d174c068a908d7a  docs/reviews/051-sql-evidence/G1-apply.txt
be1f6d6057a096315c70ec52a5e3140fe08453305d69d272feaeba7858e83093  docs/reviews/051-sql-evidence/G1b-postcondition-negative-rev2.txt
45811e1182bd8ef2d8fc2db8600a80de05e2aba5fa8220d2baa16a260a3cf015  docs/reviews/051-sql-evidence/G1b-postcondition-negative.txt
224d945200ef7b7607993fbcbac6176cf7f4904ebec0c49c1bb346df739e2e6c  docs/reviews/051-sql-evidence/G2-green-rev2.txt
e131513d60a79975e0ef6f42d0db95ef9246daeb55a6d9c95c8951b36aa21e7e  docs/reviews/051-sql-evidence/G2-green.txt
343d0181947bd39f70aca4b4dfcd732d9b0db179d41ae22d421ae654bb56e037  docs/reviews/051-sql-evidence/G2b-mutant-pathchk-rev2.txt
ded93c9cc1a5355be9e1a21373d8602003901bce817e1ccc1f332775c58f9eb9  docs/reviews/051-sql-evidence/G2b-mutant-stamp-rev2.txt
ff27b176ca0c37e974088f958dedcc9b8959f4a1414f637576b5198209f7ff7d  docs/reviews/051-sql-evidence/G2b-mutant-terminal-rev2.txt
741c25d15dd87662c3f20b702aff9ba3b43901e7c8d1cf84c9bbb3b1cc6f708c  docs/reviews/051-sql-evidence/G2b-mutant.txt
a5ef58968549ba58aaaf04f98502e1c384e9def7e9fdb6071ab7a9cba11786da  docs/reviews/051-sql-evidence/G3-down-rev2.txt
77e1dd870bb77a6fd039d2163ea6cccc50f9f6d0bb06812281f58b6ae7edf87b  docs/reviews/051-sql-evidence/G3-down.txt
f82555ac79c4d486afe437cc40475d9999ead63a8d73dfd89311b911f1af65b3  docs/reviews/051-sql-evidence/G4-lint.txt
f72972166ae0c5fb45eb1b254fc67ec976a1893bd5f11008b294e79ad191e1c1  docs/reviews/051-sql-evidence/G5-049-down-guard-rev2.txt
09545f71ea2e2604db4712b7ca4e706941600c40e4237ac360d39db63210ba31  docs/reviews/051-sql-evidence/G5-049-down-guard.txt
903bd23d8b6f4176558495741a8b55f312a8584f29b8e9b5e6c257af697dbed4  docs/reviews/051-sql-evidence/G6-scaffold-teardown-rev2.txt
9ae2f48d476e868d426b5f199329c4dc1eb346886ad947bed8b3615061765339  docs/reviews/051-sql-evidence/G6-scaffold-teardown.txt
c5b0c97a896d85d7c9bebc2fde633a15fbce019f9f16ad6cb73a8992092aef11  docs/reviews/051-sql-evidence/scaffold-build-rev2.txt
09040e2d9e0152e812f59d290b872f033c3ecf074d2a07226de0c303b25bd553  docs/reviews/051-sql-evidence/scaffold-build.txt
e3297762a6c9a09d2c5fdf2b4a4a56e225c316ab5f1d7ab9e3bf3dd1bd3c3fcc  docs/reviews/051-sql-evidence/T-D8-11-static-rev2.txt
73f6e32ab16995ed4bee3d926d186bfbaff24d2fa642c235dfa26eafeb8e4695  docs/reviews/051-sql-evidence/T-D8-11-static.txt
```

**Rev 1 artifacts** (git history, not the current files; kept so the rev-1 transcripts `G0-red.txt` … `T-D8-11-static.txt` stay checkable): the rev-1 SQL at `9e9b63b` is sha256 `70ef913cb3a111246ed73f3946dfebedfd690343aaaa92ae2e0edb2551c349d2`, the rev-1 test-db DOWN `0a587f06bb0f81ba7bf75a30a79859febaccf1658814490b64c3ce1d87758101`, the rev-1 prod DOWN `95a6b3357f65e86a070b058051e23f765aeef3076aa795423fdb61610e0a6646`, the rev-1 test file `56794979358d740d0a59f59e5cfa6ed59983f4a5af76a69e4706f06f5d62a570`. Use `git show 9e9b63b:<path> | shasum -a 256`.

How the scaffold was built (`scaffold-build-rev2.txt`): a read-only schema dump of test-db `public` (linked ref printed first, equal to `exfccwlrhoutkgrlikod`), loaded into a disposable local PG 17.11 cluster with the named stubs of `docs/reviews/049-sql-evidence/scaffold-stubs.sql` and the 049 and 050 helper libraries. Procedure cited from `docs/reviews/049-sql-evidence/scaffold-build.txt` and `docs/reviews/050-sql-evidence/run050.sh`. The scenario SQL files are not committed (the block listed no place for them); `psql -e` echoed every statement into the transcripts. `G6-scaffold-teardown-rev2.txt` records the teardown.

## 9. Questions for the reviewer

**Round 1 answers, folded in.** Identity list complete (9 + 7 = 16; `ingest_status` is the state machine, not identity). `failed` → `failed` with changes allowed once B1 lands (landed). Keep `SECURITY DEFINER` (the DEFINER surface is nil: a trigger function cannot be invoked directly). No-op UPDATE on terminal rows allowed. QE009/011/014 reused; logs carry the table name. Pending → pending with changes: the stored details move only with the status (B1's second CHECK). Owner and superuser boundary accepted. Prod ACL pre-state: the in-file post-condition is the real pre-check; keep the readback as the PITR substitute.

**Question 9 of rev 1 (reservation timing).** ~~Reserve the number in this PR, or accept a red lint until the apply commit?~~ **Dated addendum (N1), 2026-10-27:** moot. The reservation entry was added in this PR and the lint is clean (`G4-lint-rev2.txt`).

**New questions for rev 2:**

1. **R2-1 (S2 deviation).** The reviewer wrote: add `ingested_at` to the grant (8 columns). Aravind decided: database-stamped, **not granted**. The trigger compares the caller's value to `OLD` first (QE009), then stamps. Please confirm that is acceptable, in particular that no caller (including C5) can ever supply the time, so a timestamp cannot be backfilled by `service_role`.
2. **R2-2 (`now()` or `clock_timestamp()`).** The stamp is `now()` (transaction start). 049's TR4 stamps `approved_at` with `now()` too. A long ingest transaction would stamp its start, not the instant of the UPDATE. Acceptable?
3. **R2-3 (two path checks).** 049's `capture_files_storage_path_prefix_chk` (document folder) is kept next to the new row-owned check. The old one is now implied by the new one. Keep both, or replace the old one in a later migration? A replace means dropping an applied constraint.
4. **R2-4 (re-apply and DOWN).** The DOWN drops `ingested_at` (a stated data loss) and a re-apply over existing stored or rejected rows aborts, because the migration invents no backfill time. Is "clear the rows or backfill by an explicit, separate decision" the right stance?
5. **R2-5 (apply-time failure mode).** If any stored or rejected row exists at apply time, the whole migration aborts at `capture_files_ingested_at_iff_chk`, by design (G1b case D). Prod is believed empty (not observed). Is a read-only count in the apply block, on test-db and on prod, enough?
6. **R2-6 (`content_type` and `byte_size` on any status).** They may be set on `pending` and `failed` rows too, not only on rejects. Should they be restricted to `rejected` and `stored`?
7. **R2-7 (N3 test mechanics).** T-D8-16 reads the column set from the keys of a `select *` through PostgREST. Is that an acceptable stand-in for a catalog query, given the tests cannot call a new helper (this block may not touch `scripts/`)?
