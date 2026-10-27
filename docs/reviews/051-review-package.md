# Migration 051 — `capture_files` immutability, lifecycle CHECKs, INSERT lock and column UPDATE grant: review package (C2), rev 3

**Status: REVIEW PACKAGE ONLY. Nothing here has been applied to any database.** Test-db apply, CI green, the prod readback, the prod apply, the move into `supabase/migrations/` and the types check are all still to do (section 7).

**Tier: FULL** (CLAUDE.md §0 external-review triggers: (a) a new trigger function is live logic; (b) a new `SECURITY DEFINER` function and a new column-level UPDATE grant on a tenant-scoped table).

**How to read this file.** The Rev 3 section (round 2) and the Rev 2 section (round 1) come first, newest first, each with its findings and evidence. Sections 1 to 9 below them describe the **current (rev 3)** design. Where the Rev 2 section says something rev 3 changed, a dated note says so.

---

## Rev 3, 2026-10-27 — after external review round 2 (verdict: design GO, conditional)

**The review text.** `docs/reviews/051-external-review-round-2.md`, sha256 `f681927322fd968c295dfb93c66b4033fdcbb5eb64269ea4c639566dae9977a1`, 93 lines. **Provenance note:** saved by Aravind, copied from the rendered message, **markdown intact**. Not edited. (Round 1's file, `…round-1.md`, `08e1516d…2c7b`, is the one with the missing narration lines and formatting.)

**Decisions, per Aravind, 2026-10-27.** S1 accepted as written. **S2 option (a)** (the INSERT lock; not the tripwire). S3 accepted. R2-2 keep `now()`. R2-3 keep both path checks, no later drop.

**Repo-state header.** `main @ 10cd3a3047d281c34a5e34cbae13d016dd0aa276` (still; `git fetch origin` before every comparison). `supabase migration list`: **not run** (the only remote action was one read-only schema dump of test-db, ref printed first, `exfccwlrhoutkgrlikod`). Rev 2 head was `f03a372`; rev 3 artifact commit is `635d39b`.

### Findings → what changed

| Finding | What changed | Where (rev 3 SQL line numbers) | Evidence |
|---|---|---|---|
| **S1** stale attempt data frozen into terminal rows | New CHECK `capture_files_details_terminal_only_chk`: `ingest_status IN ('stored','rejected') OR (content_type IS NULL AND byte_size IS NULL)`. Every terminal detail must now arrive in the UPDATE that makes the row terminal. | `:182-185`; post-condition constraint loop `:316-324`; DOWN drop `051-down-*.sql:67` | `G0d-review2-probes-rev2.txt` (probe 1 SUCCEEDS on rev 2); `G2-green-rev3.txt` T-D8-18 (23514); mutant `G2b-mutant-s1chk-rev3.txt` |
| **S2(a)** INSERT is outside the lock | The trigger is now `BEFORE INSERT OR UPDATE`. The function's first statement stays the QE014 check; then `IF TG_OP = 'INSERT'` requires `ingest_status = 'pending'` and `content_type, byte_size, sha256, storage_path, reject_reason, preview_state, ingested_at` all NULL, else **QE011**, then `RETURN NEW`. The UPDATE branch is unchanged. The body still names no capture table. | trigger `:267-270`; INSERT branch `:204-216`; tgtype mask `:364-368` (ROW, BEFORE, **INSERT**, UPDATE; not DELETE or TRUNCATE) | `G0d` probe 2 (owner INSERT of a terminal row SUCCEEDS on rev 2); `G2-green-rev3` T-D8-19 (QE011 ×9, QE014 on INSERT, 42501 for `service_role`); mutant `G2b-mutant-insert-rev3.txt` |
| **S3** make R2-4 mechanical | Both DOWN files' precondition counts rows with `ingest_status IN ('stored','rejected')` and refuses with `DOWN_PRECONDITION_051 … terminal_rows=N` when N > 0 (counted only when the column exists). Header: "Rolling back over live terminal rows needs a separate reviewed artifact with its own decision on ingested_at (external review round 2, S3)." The DOWN also drops the new constraint (five now). | `051-down-testdb.sql:12-16` header, `:27-58` precondition, `:67-72` drops | `G3-down-rev3.txt`: DOWN over 18 terminal rows refused `terminal_rows=18`; over exactly one stored row refused `terminal_rows=1`, nothing changed (fingerprint equal) |
| **R2-1 wording** | "No caller can ever supply the time" was true for UPDATE only. **It is now true for both INSERT and UPDATE, as of rev 3 (2026-10-27)**, because the INSERT branch refuses any `ingested_at`. The reviewer's reason is adopted: *validate what you construct*; if the column is granted the trigger must judge a caller's timestamp and has nothing to judge it against; if it is stamped there is nothing to judge. The QE009 compare is owner-only defence; `service_role` never reaches it (42501). | SQL header `:6-23`; §9 | `G2-green-rev3` T-D8-15, T-D8-15b, T-D8-19 |
| **R2-5 reason** | Corrected as the reviewer wrote. The weak reason ("nothing calls `apply_material_inward_turn` before C4") is withdrawn: the reservation note itself says 050's N2 start-branches are live on prod. **The structural reason:** today only the owner can UPDATE `capture_files` (049 grants SELECT only), so a stored or rejected row cannot exist short of a hand edit. Pending rows validate either way. If one does exist the file aborts whole (G1b case D). The apply block's count is an early warning, not the guard. | SQL header `:120-128` (LOCKS note); §9; carry-forward item 13 | `G1b-postcondition-negative-rev3.txt` cases D and E |

### The reviewer's two round-2 probes: RED on rev 2, GREEN on rev 3

| Probe | Rev-2 051 (`G0d-review2-probes-rev2.txt`) | Rev-3 051 (`G2-green-rev3.txt`) |
|---|---|---|
| 1 (S1): `failed` carrying `content_type` and `byte_size`, then `rejected` `wrong_type` without overwriting them | `HOLE rev-2 probe 1a … succeeded` and `1b … succeeded`; `1c` clearing it is refused QE011. The row ends `rejected`, `wrong_type`, `image/png`, `99999999`, frozen | step 1 (**failed carrying `content_type` and `byte_size`**) refused **23514**; a pending row carrying either refused **23514**; control: pending → failed with nothing set, then failed → rejected `wrong_type` leaves both NULL; control: pending → rejected `wrong_type` WITH its own `image/png` / `99999999` in ONE UPDATE succeeds |
| 2 (S2): owner INSERT of a terminal row (`rejected`, `too_large`, `ingested_at` 2020-01-01) | `HOLE rev-2 probe 2 … succeeded`. The row sits with `ingested_at` 2020-01-01 | refused **QE011** (so are INSERTs with `stored`, `failed`, or any single detail/stamp column); control: an owner INSERT with exactly 050's column list is accepted |

The rev-2 file used for the RED run is `git show f03a372:docs/reviews/051_capture_files_immutability.sql`, sha256 checked equal to `fbd3b3a5…5907` by the runner (it stops on a mismatch).

### Other rev 3 results (`*-rev3.txt`)

- **Baseline RED** (`G0-red-rev3.txt`): 4 PASS, 7 expected FAIL.
- **Apply** (`G1-apply-rev3.txt`): exit 0, post-condition passed; a second apply fails cleanly (`already exists`) with the fingerprint unchanged; the trigger fires on INSERT and UPDATE, row-level, BEFORE, not DELETE or TRUNCATE.
- **Post-condition negatives** (`G1b-postcondition-negative-rev3.txt`): the three grant cases and case D abort whole; **new case E**: a pre-existing *pending* row carrying `byte_size` (valid under 049) makes `capture_files_details_terminal_only_chk` fail to validate and the whole file aborts, fingerprint back at baseline.
- **GREEN** (`G2-green-rev3.txt`): **143 PASS, 0 FAIL.**
- **Mutants** (the same GREEN scenario against each): terminal-row check removed → **20 FAIL**; row-path CHECK dropped → **5 FAIL**; S1 CHECK dropped → **6 FAIL**; INSERT lock removed (trigger recreated `BEFORE UPDATE` only) → **11 FAIL**; `ingested_at` stamp removed → **90 FAIL, 2 psql errors**. The stamp mutant is noisy by nature: with no stamp, `capture_files_ingested_at_iff_chk` refuses every move into a terminal status, including the scenario's own fixtures, so most later assertions fail with it. It does prove the suite notices.
- **DOWN** (`G3-down-rev3.txt`, 28 PASS, 0 FAIL): see the S3 row above; with no terminal rows the DOWN passes and the fingerprint (function, trigger, ACLs, **every constraint, the column list**) and the comments hash **equal the pre-051 baseline exactly**; the six 049 constraints remain; the pending row and queued job are intact; a new file turn still works; a second DOWN is refused; a re-apply over rows left by the rehearsal aborts whole; after cleanup it passes and equals the first post-apply fingerprint.
- **Guard 2** (`G5-049-down-guard-rev3.txt`): the function body still names no capture table (static test T-D8-17 enforces it).
- **Static** (`T-D8-11-static-rev3.txt`): T-D8-11 and T-D8-17, 11 passed, 21 skipped (database tests), `tsc --noEmit` exit 0.
- **Lint** (`G4-lint-rev3.txt`): GREEN at the head before the last commit.
- Scaffold: fresh read-only dump of test-db; destroyed (`G6-scaffold-teardown-rev3.txt`). **A logging gap, stated:** the dump script's own tail output (byte count, credential-pattern scan count) for this run was cut by a `| head` pipe on my side and is not in `scaffold-build-rev3.txt`; the dump itself finished and loaded with 0 errors into the same-shaped scaffold. Its credential scan was therefore not re-captured for this run (it was clean, count 0, on the two earlier runs of the same command).

### What the S1 CHECK changes, in plain words

Every one of the seven granted columns is now NULL on a `pending` or `failed` row. So a `pending` or `failed` row cannot change any column except by a status move. Two things follow. The reviewer's round-1 question "allow `failed` → `failed` with changes" is now **vacuous**: there is nothing to change (a no-change UPDATE is still allowed). And my rev-2 test controls that wrote `byte_size` on a pending row are replaced by a no-op or a status move.

### New things found while doing rev 3

- **R3-A. Test controls had to change.** Seven rev-2 controls wrote `byte_size` on pending or failed rows; all moved to `ingest_status` or no-ops. Listed in `test/capture-files-immutability.test.ts` and `g2-green` scenario echoes.
- **R3-B. Fixtures changed.** INSERT is locked to blank pending rows, so every scaffold fixture is now a blank pending INSERT (with 050's column list) followed by an owner UPDATE to the wanted status.
- **R3-C. Every 051-adjacent inserter is a design input.** Carry-forward item 10: C3 to C6 inserters must insert a blank pending row.
- **R3-D. A rollback over terminal rows is now structurally impossible** from this artifact (carry-forward item 12).

---

---

> **Dated note, 2026-10-27 (rev 3):** this section is the rev 2 record. Rev 3 superseded three things in it: R2-1's "no caller can ever supply the time" (UPDATE only in rev 2; INSERT and UPDATE as of rev 3), the R2-5/R2-B reasoning about an empty prod table (replaced by the structural reason in the Rev 3 section), and the rev-2 DOWN statement that a re-apply "needs the table clean" (the DOWN now refuses over terminal rows, S3). The transcripts named here (`G0c`, `*-rev2.txt`) are unchanged history.

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

## 1. What this changes, in product terms (current: rev 3)

A file an engineer sends (a delivery challan or an invoice photo or PDF) becomes a `capture_files` row. The row starts `pending`. A background job (C5, not built yet) later downloads the bytes, checks them, and fills in the row's stored details.

Today nobody can change a `capture_files` row at all. 049 gave `service_role` read access only. The ingest job needs to write, so this migration gives it a narrow write right, and locks the result.

> ~~A stored capture file can never be silently changed.~~ **Dated correction (S1 of round 1), rev 2, 2026-10-27, per external review:** 051 locks the **database record** of a stored file, not the bytes in Storage. `service_role` can still overwrite a Storage object. The byte guard is C5's: upload with `upsert: false` to the row-owned path (B2), and no C5 code path overwrites or deletes an object under a stored row.

What the migration does:

1. **Only the ingest job's seven columns can be written, and only by `service_role`.** Nobody else can write anything.
2. **Once a file is `stored` or `rejected`, its row can never change again.** Its hash, path, size, type and timestamp are fixed. A file's identity (which document, which page, which message) never changes at all.
3. **A row's shape is always consistent.** A rejected file has a reason and no stored details. A stored file has its details and no reason. A file's path always belongs to that file's own row. A file that reached `stored` or `rejected` always has the time it got there, stamped by the database.
4. **(rev 3) Terminal details arrive together with the terminal status.** `content_type` and `byte_size` exist only on `stored` and `rejected` rows, so a value from an earlier failed attempt can never be inherited and frozen.
5. **(rev 3) A new row is always blank.** An INSERT must be a `pending` row with every detail and the timestamp NULL. No owner, no DEFINER function and no caller can plant a terminal row or supply the time. Today only 050's insert writes this table, and it already does exactly that.

## 2. The exact objects and grants (SQL line numbers, rev 3)

File: `docs/reviews/051_capture_files_immutability.sql` (held in `docs/reviews/`; it moves into `supabase/migrations/` only in the apply commit, CLAUDE.md §6).

| What | Lines |
|---|---|
| Header: purpose, rev 3 / rev 2 summaries and the S1 dated correction, plain-words list, decisions, row-shape rules, transition table, QE map, identity list, locks (incl. the R2-5 reason), source map, DOWN pointer | 1–152 |
| `BEGIN;` and `SET LOCAL lock_timeout = '3s';` | 154, 156 |
| `ALTER TABLE … ADD COLUMN ingested_at timestamptz` | 162 |
| `capture_files_reject_reason_iff_chk`, `capture_files_stored_only_chk` (B1) | 165–169 |
| `capture_files_storage_path_row_chk` (B2) | 172–174 |
| `capture_files_ingested_at_iff_chk` (S2, rev 2) | 177–179 |
| **`capture_files_details_terminal_only_chk` (S1, rev 3)** | **182–185** |
| `CREATE FUNCTION public.trg_capture_files_before_update()` (`RETURNS trigger`, `plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`) | 190–261 |
| QE014 refusal, first statement | 198–200 |
| **INSERT branch: blank pending row only, else QE011 (S2(a), rev 3)** | **204–216** |
| Identity columns immutable, QE009 | 219–229 |
| `ingested_at` never caller-set, QE009 (compared **before** the stamp) | 231–235 |
| Terminal rows: any change refused QE011, a no-change UPDATE allowed | 237–244 |
| Status moves for `pending` and `failed`, QE011 otherwise; stamp `ingested_at := now()` on a move into `stored` or `rejected` | 246–257 |
| `CREATE TRIGGER trg_capture_files_before_update` **`BEFORE INSERT OR UPDATE`** `… FOR EACH ROW` | 267–270 |
| `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role` (all four by name) | 280 |
| `GRANT EXECUTE … TO postgres` (changes no effective ACL; satisfies lint Rule 1 as `049:988-1004` does) | 281 |
| `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) ON public.capture_files TO service_role` (column-scoped; **seven columns, `ingested_at` not among them**) | 288–289 |
| In-file post-condition `DO` block (`POSTCONDITION_051`) | 295–430 |
| `COMMIT;` | 432 |
| Commented DOWN block | 435–end |

The function body never writes a capture table name (049's DOWN Guard 2 scans function bodies for table names and blocks the 049 DOWN on a match). `G5-049-down-guard-rev3.txt` shows 051's function does not match, and static test T-D8-17 enforces it.

**What the post-condition block checks** (any miss raises `POSTCONDITION_051` and the whole file aborts): exactly one `pg_proc` row; `prosecdef`; owner `postgres`; `proconfig = {search_path=""}`; a non-NULL ACL with no PUBLIC entry; no role holds EXECUTE; the trigger exists, is enabled, is **BEFORE, ROW, INSERT and UPDATE, and not DELETE or TRUNCATE** (tgtype mask, `:364-368`) and is bound to this function; the `ingested_at` column exists (`timestamptz`, nullable, no default); **the five new CHECKs exist, are CHECKs and are validated**; `has_column_privilege('service_role', …, 'UPDATE')` is true for exactly the seven columns and false for every other column (all 17 are walked); false for `anon` and `authenticated` on every column; an explicit check that no role can UPDATE `ingested_at`; `has_table_privilege(…, 'UPDATE')` false for all three roles; `service_role` holds no DELETE and no TRUNCATE and still holds SELECT; all seven granted columns exist.

**Identity columns (QE009).** `id, created_at, tenant_id, project_id, document_id, file_no, source_message_sid, media_index, claimed_content_type`. `capture_files` has 17 columns: 9 identity + 7 granted + `ingested_at`. Rev 3 adds no column.

**DOWN files.** `docs/reviews/051-down-testdb.sql` (test-db, `exfccwlrhoutkgrlikod`) and `docs/reviews/051-down-prod.sql` (prod, `jvxwqignooseazzmwhvl`). Identical bodies; each header names its own database and says never to apply it to the other. Lines: header with the S3 sentence 12–16; `BEGIN` 20; `lock_timeout` 22; precondition (ledger row, function, trigger, **five constraints, the column, and `terminal_rows`**) 27–58; `DROP TRIGGER` 62; `DROP FUNCTION` 63; **drop the five constraints 66–71, `DROP COLUMN ingested_at` 72**; `REVOKE UPDATE (…)` 75; ledger `DELETE` 79; closing assertion 83–123; `COMMIT` 125.

## 3. The threat it closes: `049-review-package.md:145`, and what rounds 1 and 2 found

**The original blocking item.** With the column grant but no trigger, a stored file's `sha256` could be rewritten. Reproduced in `G0b-reviewer-stub-rev3.txt` (7 PASS, each a reproduced hole). On the real baseline before 051 (`G0-red-rev3.txt`), `service_role` is refused 42501 and even the table owner can rewrite a stored row (4 PASS, 7 expected FAIL).

**Round 1's three probes** (rev 1 → rev 2) are in the Rev 2 section below (`G0c-review-probes-rev1.txt`). **Round 2's two probes** (rev 2 → rev 3) are in the Rev 3 section above (`G0d-review2-probes-rev2.txt`): both SUCCEED on rev 2 and are refused on rev 3.

**GREEN, after 051 rev 3** (`G2-green-rev3.txt`): 143 PASS, 0 FAIL. On a `stored` row, `service_role` rewriting `sha256`, `storage_path`, `byte_size`, `content_type`, `preview_state` or `reject_reason` is refused QE011. The table owner rewriting `sha256` is refused QE011 too. The stored row is byte-for-byte unchanged afterwards.

**The tests can fail.** Five mutants (Rev 3 section): 20, 5, 6, 11 and 90 FAIL. **The post-condition block can fail:** five wrong starting states abort the file whole.

## 4. Status transitions, row shape and QE codes

Order of checks inside the trigger: QE014 first, then (on INSERT) the blank-pending rule, then (on UPDATE) identity (QE009), then `ingested_at` (QE009), then terminal rows (QE011), then status moves (QE011). The table CHECKs (23514) run after the trigger.

| Event | Result |
|---|---|
| **INSERT**, `ingest_status` `pending` and every detail and `ingested_at` NULL | allowed (050's insert) |
| **INSERT**, anything else | QE011 |
| `pending` → `stored`, `rejected`, `failed` | allowed by the trigger; the CHECKs then enforce the shape (below). The move into `stored` or `rejected` stamps `ingested_at := now()` |
| `failed` → `stored`, `rejected` | allowed (stamped) |
| `pending` → `pending`, `failed` → `failed` | allowed only as a no-change UPDATE (rev 3: every granted column is NULL by CHECK on these rows, so no change is possible) |
| `failed` → `pending` | QE011 |
| `stored` → anything else, or any column change | QE011 |
| `rejected` → anything else, or any column change | QE011 |
| `stored` → `stored` or `rejected` → `rejected` with **no** change | allowed (a retried job is a no-op); `ingested_at` unchanged |
| any identity column changes, or `ingested_at` changes by a caller | QE009 (also on `stored` and `rejected` rows) |
| writer not READ COMMITTED, on INSERT or UPDATE | QE014 |

**Row shape (23514, from the CHECKs):** `reject_reason` set ⇔ `rejected`; `storage_path`, `sha256`, `preview_state` only when `stored`; **`content_type` and `byte_size` only when `stored` or `rejected` (rev 3)**; `storage_path` starts with `tenant/project/document/<row id>`; `ingested_at` set ⇔ `stored` or `rejected`. 049's own six CHECKs are unchanged, including the weaker prefix check, which is kept (R2-3: keep both, no later drop).

| Code | Meaning | Source |
|---|---|---|
| QE009 | immutable column changed (or `ingested_at` caller-set) | 049 `trg_capture_documents_before_update` (`049:784-791`), map `pr-b-050-plan.md:129-131` |
| QE011 | locked content, refused status move, or a non-blank INSERT | same |
| QE014 | non-READ-COMMITTED writer (UPDATE and, from rev 3, INSERT) | `049:778-780` |
| 23514 | row shape (CHECK) | standard Postgres `check_violation` |

**QE014 on INSERT, and 050.** The trigger's isolation check now also fires on 050's insert. 050 sets no isolation level (Step 0 log: `grep -i isolation` on the 050 file finds nothing) and the same 050 call already inserts a `capture_documents` row through 049's INSERT guard, which raises the same QE014 (`049:863`), so the call already runs READ COMMITTED when it works today. PostgREST runs every request as READ COMMITTED. [inferred from the code and from that existing guard; the server's `default_transaction_isolation` was not read.]

## 5. Test list: what runs in CI, what is scaffold-only

`test/capture-files-immutability.test.ts`. Each test names its positive control in its title or a comment.

| Test | Where it runs | Positive control |
|---|---|---|
| T-D8-1 service_role updates the seven columns of a pending row | CI against test-db (RED until the test-db apply) | the row reads back `stored` |
| T-D8-2 grant layer: `file_no`, `claimed_content_type`, `tenant_id`, `id` refused 42501 | CI | a granted column (`ingest_status`) on the same row succeeds |
| T-D8-2b trigger layer with the grant bypassed, QE009 | **scaffold only** (`G2-green-rev3.txt`, all nine identity columns). `it.skip`: "needs owner connection; evidence in docs/reviews/051-sql-evidence/" | owner UPDATE of a granted column and an owner no-op both succeed |
| T-D8-3 stored row: `sha256`, `storage_path`, `byte_size`, `content_type` rewrite refused QE011 | CI | pending → stored with full details succeeds (inside `newStored`) |
| T-D8-4 rejected is terminal | CI | pending → rejected succeeded when the row was made |
| T-D8-5 no move back to pending; failed → stored / rejected allowed | CI | pending → failed succeeded |
| T-D8-6 no-op UPDATE on a stored row allowed, `ingested_at` unchanged | CI | T-D8-3 shows a real change is refused |
| T-D8-7 anon (real anon-key call) and an authenticated PM refused 42501 | CI | service_role updates the same row |
| T-D8-8 service_role DELETE refused 42501 | CI. TRUNCATE is scaffold only | the row still reads back |
| T-D8-9 trigger function not callable | CI over PostgREST (42501 or PGRST202); catalog proof on the scaffold and in the post-condition | an exposed test helper is callable |
| T-D8-10 DOWN rehearsal | **scaffold only** (`G3-down-rev3.txt`). `it.skip`, same reason | see section 6 |
| T-D8-11 overload rule, static | CI and local, no database | a planted second definition is counted |
| T-D8-12 B1 probe 1: failed + `reject_reason` refused 23514 | CI | failed → stored with full details and no reason succeeds |
| T-D8-13 B1 probe 2: rejected + `sha256` / `storage_path` / `preview_state` refused 23514; **a pending row carrying `sha256`, `byte_size` or `content_type` refused 23514 (rev 3)** | CI | pending → rejected `too_large` WITH `byte_size` succeeds |
| T-D8-14 B2 probe 3: another row's `storage_path` refused 23514 | CI | the row's own path, stored, succeeds |
| T-D8-15 S2: `ingested_at` stamped by the database inside a ±2-minute window around the test's own clock (DB clock vs this machine); not stamped on `failed`; `service_role` setting it refused 42501 | CI | a granted-column update on the same row succeeds |
| T-D8-15b S2: an owner UPDATE that sets `ingested_at` raises QE009 | **scaffold only**. `it.skip`, same reason | owner no-op succeeds |
| T-D8-16 N3: the table's columns = identity ∪ granted ∪ `{ingested_at}` (17); no new column in rev 3 | CI | the test names the lists |
| T-D8-17 the 051 function body names no capture table (Guard 2) | CI and local, no database | the matcher matches a body that does name the table |
| **T-D8-18** (S1 probe) a failed or pending row carrying `content_type` / `byte_size` refused 23514; nothing stale to inherit | CI | pending → rejected `wrong_type` WITH its own `image/png` / `99999999` in ONE update succeeds |
| **T-D8-19** (S2(a) probe) an owner INSERT of a terminal row refused QE011; a blank pending INSERT with exactly 050's column list accepted | **scaffold only** (`G2-green-rev3.txt`). `it.skip`, same reason | the 050-shape INSERT is accepted |
| **T-D8-20** 050's real insert path is accepted by the INSERT lock | CI (every test's `newPending()` goes through `apply_material_inward_turn`; this one asserts the row's shape) | a status move then works |
| **T-D8-21** (S3) a DOWN with one stored row present is refused `terminal_rows=1` and changes nothing | **scaffold only** (`G3-down-rev3.txt`). `it.skip`, same reason | the DOWN passes with no terminal rows |

Owner-only precedent for the skipped tests: `test/capture-races.test.ts:307` and `test/capture-pm-functions.test.ts:276`.

**What was run, honestly.** T-D8-11, T-D8-17 and `tsc --noEmit` were run locally with no database and no credentials in scope (`T-D8-11-static-rev3.txt`): 11 passed, 21 skipped, `tsc` exit 0. **The database tests (T-D8-1 to 9, 12 to 16, 18, 20) have not been run anywhere.** The block forbade any write to a remote database and they create fixtures. They are typechecked only. Their expected error codes (`QE011`, `42501`, `23514`, `PGRST202` as `error.code`) are inferred from precedent (`test/capture-engineer-flow.test.ts:200` reads `error?.code` for `QE012`). **The apply GO needs a pinned green CI run where QE011 and 23514 are observed as `error.code`.** No concurrency or race test exists in this package (CLAUDE.md §0).

## 6. DOWN: steps, precondition, rollback order

`G3-down-rev3.txt`, run on the scaffold with a **pending file row (40) and a queued `capture_ingest` job** seeded first.

1. Precondition: refuse (`DOWN_PRECONDITION_051 … terminal_rows=N`) unless the 051 ledger row, the function, the trigger, **the five constraints and the `ingested_at` column** all exist **and no row is `stored` or `rejected`** (S3).
2. `DROP TRIGGER`; `DROP FUNCTION`; **`DROP CONSTRAINT` ×5; `DROP COLUMN ingested_at`**; `REVOKE UPDATE (seven columns)`; delete the 051 ledger row; closing assertion.

Results (28 PASS, 0 FAIL): the DOWN over 18 terminal rows is **refused** (`terminal_rows=18`) and changes nothing; over exactly one stored row it is **refused** (`terminal_rows=1`), the row intact, the fingerprint unchanged; with no terminal rows it passes. After it the fingerprint (function, trigger, table ACL, column ACLs, **every constraint, the column list**) and the comments hash **equal the pre-051 baseline exactly**; `service_role` UPDATE is 42501 again; the owner can again rewrite a stored row, put a hash on a rejected row, set `byte_size` on a pending row and INSERT a terminal row (the lock and all CHECKs are really gone); the six 049 constraints remain; the seeded pending row and queued job are intact; a new engineer file turn still inserts a pending row and queues its job. A **second DOWN is refused**. A **re-apply over the rows the rehearsal left behind aborts whole** (table back at the baseline); after the scaffold clears them the re-apply passes and the fingerprint equals the first post-apply fingerprint.

**Rollback order.** C5 (the ingest job) must be rolled back **before** this DOWN, because the ingest needs the column grant. Full order: C6 → C5 → C4 → C3 → this DOWN (C2). Then, outside PR-C, **C, then B, then A**. Run outside 08:25–08:40 and 18:25–18:40 IST. 051 locks only `capture_files` (`ADD CONSTRAINT` ×5 takes ACCESS EXCLUSIVE and scans the table; `lock_timeout` is 3 s).

**Scaffold stand-in, stated plainly:** the scaffold's migration-ledger table is a stub. I inserted the `051` ledger row by hand after each scaffold apply. On prod the ledger step is a separate action; the DOWN's precondition would refuse if that row were missing (N4).

## 7. What is NOT yet done

- Test-db apply of 051 rev 3 (and its ledger row), preceded by the read-only count of `capture_files` rows by status (an early warning; see R2-5 above).
- CI green with a pinned run URL where **QE011 and 23514** are observed as `error.code`. CI is **expected RED** on `test/capture-files-immutability.test.ts` until the test-db apply.
- Prod readback for "PITR substituted": PITR is OFF until launch. At the prod apply, save the prod pre-apply ACL / trigger / constraint / column readback for `capture_files` with its sha256 and record the word "substituted". Not part of this block.
- Prod apply (`supabase db query --linked -f`, with Aravind's go-ahead in the same exchange, CLAUDE.md §0).
- Reservation entry: ~~"Not done here."~~ **exists** since commit `9e9b63b` (lint Rule 8); its note is updated for rev 3 (sha256 `debe97f0…2df9`). Remaining for the apply commit: the move of the file into `supabase/migrations/` and the `claimedBy` path change (CLAUDE.md §6, Step H).
- Types regeneration after the apply: `types/database.ts` gains `ingested_at` on `capture_files`. [inferred: the existing post-apply step.]
- Confirm the migration file is on `main` and test-db carries it for real (CLAUDE.md §0 rule (d) and (e)).

**Open items.**

- ~~L. The repo lint fails on this branch.~~ **Resolved 2026-10-27, per Aravind: reservation entry added in this PR.** `G4-lint-rev3.txt` is the GREEN transcript at the resubmitted head; `G4-lint.txt` (RED, `44cac28`) and `G4-lint-rev2.txt` are history.
- **H14 is unaffected** (the helper iterates a fixed list of six names, `scripts/test-db-only-capture-helpers.sql:198`).
- **Scaffold-only evidence for TRUNCATE** (PostgREST cannot issue it).

## 8. Hashes

Full sha256 of every file (also in `docs/reviews/051-sql-evidence/SHA256.txt`, which lists everything except itself and this package; **`G4-lint-rev3.txt` and the final `SHA256.txt` are committed in the last commit, after the lint was run at the commit before it, so G4's hash is in `SHA256.txt` and not below**):

```
debe97f051f4414c72f2bb1f6c45ca37ee59dd1bec43e5cefecca8a74ce22df9  docs/reviews/051_capture_files_immutability.sql
672a422f895bc7b1425e21ae274ad9792c12ed4b1b2d12f334540b06a721da3a  docs/reviews/051-down-testdb.sql
288dc847cb66336a9b2574bfc227a0f54c4858854f3e606d71c584f744596046  docs/reviews/051-down-prod.sql
0de4517b02e743d0bcfb2c3e5e394c0345204aa09850c9a05407addd3ddc04a0  test/capture-files-immutability.test.ts
08e1516d06cd28cead094ac812efa68578ca98624d97513dd55b459aece62c7b  docs/reviews/051-external-review-round-1.md
f681927322fd968c295dfb93c66b4033fdcbb5eb64269ea4c639566dae9977a1  docs/reviews/051-external-review-round-2.md
7d86e44e999a2d7b52737380f34a0e45a1176cf89b6a7f63cb567b9959dc7a4b  docs/reviews/051-sql-evidence/G0-red-rev2.txt
01c163eab9d4d3392b478f2dec9196293b03cc050e23d4b1cd75290ceb836fbc  docs/reviews/051-sql-evidence/G0-red-rev3.txt
3233a5abca119f69ca1d0fe8e26520eb22e20db45f8deb482456d26cec4e4363  docs/reviews/051-sql-evidence/G0-red.txt
a6796dcc4c58386ce1a7c098729c6e99ec9f3f7389fcb9f88618d2ab03480bab  docs/reviews/051-sql-evidence/G0b-reviewer-stub-rev2.txt
a96d399ae836e8be7831e1de2e65c86a8860c4c26cc6762ed205da972d44477f  docs/reviews/051-sql-evidence/G0b-reviewer-stub-rev3.txt
09fd53f0eb4278d2a221c7114bac93b02a1ef8798394a99421aab4d8953f78b5  docs/reviews/051-sql-evidence/G0b-reviewer-stub.txt
82a5ea4f2849f31cccbac970e905033d4df1167706d62daee8a70654b8fe2de0  docs/reviews/051-sql-evidence/G0c-review-probes-rev1.txt
ef56d161e8a12c2bf455d696c91d0123f8bbf16659c494baa8c299b68bc55c9d  docs/reviews/051-sql-evidence/G0d-review2-probes-rev2.txt
fbf091899548a73e11a0bf0278dab350cdcb90bda03c6a469e88e85afc8cf54c  docs/reviews/051-sql-evidence/G1-apply-rev2.txt
d8f9300248d4a5279f9acfecc4b9afc489d127265d00f5e72453cb8d623a9a25  docs/reviews/051-sql-evidence/G1-apply-rev3.txt
ee2704f55f881b190c46743aceda63e1d86eaac9a0d4ee871d174c068a908d7a  docs/reviews/051-sql-evidence/G1-apply.txt
be1f6d6057a096315c70ec52a5e3140fe08453305d69d272feaeba7858e83093  docs/reviews/051-sql-evidence/G1b-postcondition-negative-rev2.txt
d5d3f4cb4f99b305fbb3a45bea071a34208610a408957fb867320e254aa5e3a9  docs/reviews/051-sql-evidence/G1b-postcondition-negative-rev3.txt
45811e1182bd8ef2d8fc2db8600a80de05e2aba5fa8220d2baa16a260a3cf015  docs/reviews/051-sql-evidence/G1b-postcondition-negative.txt
224d945200ef7b7607993fbcbac6176cf7f4904ebec0c49c1bb346df739e2e6c  docs/reviews/051-sql-evidence/G2-green-rev2.txt
27c1836c5f605a7b93a22f24657f52b58a1428891d479c595915967fb62af89c  docs/reviews/051-sql-evidence/G2-green-rev3.txt
e131513d60a79975e0ef6f42d0db95ef9246daeb55a6d9c95c8951b36aa21e7e  docs/reviews/051-sql-evidence/G2-green.txt
e22f391a7ceb2416d32a9becc176220f09f32ff861a93f0512d869b29716f79c  docs/reviews/051-sql-evidence/G2b-mutant-insert-rev3.txt
343d0181947bd39f70aca4b4dfcd732d9b0db179d41ae22d421ae654bb56e037  docs/reviews/051-sql-evidence/G2b-mutant-pathchk-rev2.txt
ac7653869bcafa24d8d60d34c44cba9b854c7f1f399d435e44f3a5da018aa34f  docs/reviews/051-sql-evidence/G2b-mutant-pathchk-rev3.txt
a2d30935a3269b0a7f11e295b5e614d63baaa5ff1dbb12c4cbb30527bbbe72d0  docs/reviews/051-sql-evidence/G2b-mutant-s1chk-rev3.txt
ded93c9cc1a5355be9e1a21373d8602003901bce817e1ccc1f332775c58f9eb9  docs/reviews/051-sql-evidence/G2b-mutant-stamp-rev2.txt
684bfe321e5027823a54b5d8e72fa0910317409d545bf2661302c99a5362cca3  docs/reviews/051-sql-evidence/G2b-mutant-stamp-rev3.txt
ff27b176ca0c37e974088f958dedcc9b8959f4a1414f637576b5198209f7ff7d  docs/reviews/051-sql-evidence/G2b-mutant-terminal-rev2.txt
58b537a0a67f681caf3f90e5b74eaa901fc78a2f0f6246e8fa5b231905f5711a  docs/reviews/051-sql-evidence/G2b-mutant-terminal-rev3.txt
741c25d15dd87662c3f20b702aff9ba3b43901e7c8d1cf84c9bbb3b1cc6f708c  docs/reviews/051-sql-evidence/G2b-mutant.txt
a5ef58968549ba58aaaf04f98502e1c384e9def7e9fdb6071ab7a9cba11786da  docs/reviews/051-sql-evidence/G3-down-rev2.txt
7e2879cfadf6986af9e31d25a89fb09188b62b3fb2c364afd7336de79bc1f17f  docs/reviews/051-sql-evidence/G3-down-rev3.txt
77e1dd870bb77a6fd039d2163ea6cccc50f9f6d0bb06812281f58b6ae7edf87b  docs/reviews/051-sql-evidence/G3-down.txt
2e07df3a334ac4a2a1e69ba8bb72c3bb44310602bd757ce5a73bcd906cc076b2  docs/reviews/051-sql-evidence/G4-lint-rev2.txt
f82555ac79c4d486afe437cc40475d9999ead63a8d73dfd89311b911f1af65b3  docs/reviews/051-sql-evidence/G4-lint.txt
f72972166ae0c5fb45eb1b254fc67ec976a1893bd5f11008b294e79ad191e1c1  docs/reviews/051-sql-evidence/G5-049-down-guard-rev2.txt
908fa95e9755ee495a1a7dab5c84a289c05bd632078d9e58632f5857fdfe6144  docs/reviews/051-sql-evidence/G5-049-down-guard-rev3.txt
09545f71ea2e2604db4712b7ca4e706941600c40e4237ac360d39db63210ba31  docs/reviews/051-sql-evidence/G5-049-down-guard.txt
903bd23d8b6f4176558495741a8b55f312a8584f29b8e9b5e6c257af697dbed4  docs/reviews/051-sql-evidence/G6-scaffold-teardown-rev2.txt
1ca874c4604ed322d8669b48278dd5546060e4bf1a2b454b49af299eb0b1d793  docs/reviews/051-sql-evidence/G6-scaffold-teardown-rev3.txt
9ae2f48d476e868d426b5f199329c4dc1eb346886ad947bed8b3615061765339  docs/reviews/051-sql-evidence/G6-scaffold-teardown.txt
c5b0c97a896d85d7c9bebc2fde633a15fbce019f9f16ad6cb73a8992092aef11  docs/reviews/051-sql-evidence/scaffold-build-rev2.txt
e1c2e3eb925033577adb3a25d1f0d15d63f32e2395321037472e666a93cf6f13  docs/reviews/051-sql-evidence/scaffold-build-rev3.txt
09040e2d9e0152e812f59d290b872f033c3ecf074d2a07226de0c303b25bd553  docs/reviews/051-sql-evidence/scaffold-build.txt
e3297762a6c9a09d2c5fdf2b4a4a56e225c316ab5f1d7ab9e3bf3dd1bd3c3fcc  docs/reviews/051-sql-evidence/T-D8-11-static-rev2.txt
7b8ba086b438ccda765a6b0bb0da84359e32640709d99ca1f2314b68fd161af3  docs/reviews/051-sql-evidence/T-D8-11-static-rev3.txt
73f6e32ab16995ed4bee3d926d186bfbaff24d2fa642c235dfa26eafeb8e4695  docs/reviews/051-sql-evidence/T-D8-11-static.txt
```

**Earlier-revision artifacts** (git history, not the current files; kept so the rev-1 and rev-2 transcripts stay checkable): rev-1 SQL at `9e9b63b` `70ef913cb3a111246ed73f3946dfebedfd690343aaaa92ae2e0edb2551c349d2`; rev-2 SQL at `f03a372` `fbd3b3a535db3c9af41991c1b324ae0e7fe26fb5e5713a1de0e6b7a824c15907`; rev-2 test-db DOWN `acd672658497c1dc745b90748c33704d9ac957d681f98324813737f557dc69c8`; rev-2 prod DOWN `b43ed526c9f84057a672f221780e6971bb616731c5b2d96e2d05fc17d6c0a0b9`; rev-2 test file `db4fa5d758dc1479c54546109dcee23de77a1260f082e8e229652ffcd0b817a1`. Use `git show <sha>:<path> | shasum -a 256`.

How the scaffold was built (`scaffold-build-rev3.txt`): a read-only schema dump of test-db `public` (linked ref printed first, equal to `exfccwlrhoutkgrlikod`), loaded into a disposable local PG 17.11 cluster with the named stubs of `docs/reviews/049-sql-evidence/scaffold-stubs.sql` and the 049 and 050 helper libraries. The scenario SQL files are not committed; `psql -e` echoed every statement into the transcripts. `G6-scaffold-teardown-rev3.txt` records the teardown.

## 9. Questions for the reviewer

**Answers folded in.** Round 1: identity list complete; keep `SECURITY DEFINER`; no-op UPDATE on terminal rows allowed; QE009/011/014 reused and logs carry the table name; the stored details move only with the status; owner and superuser boundary accepted; prod ACL pre-state covered by the in-file post-condition. Round 2: **R2-1** confirmed, reason adopted (validate what you construct); **R2-2** keep `now()` (a PostgREST request is one transaction); **R2-3** keep both path checks, no later drop; **R2-5** the count is enough, the reason is structural (corrected above); **R2-7** the `select *` keys are a tripwire, the catalog half is the post-condition's `pg_attribute` walk.

**Question 9 of rev 1 (reservation timing).** ~~Reserve the number in this PR, or accept a red lint until the apply commit?~~ **Dated addendum (N1), 2026-10-27:** moot. The reservation entry was added in this PR and the lint is clean.

**R2-1 sentence, dated.** "No caller can ever supply the time." True for UPDATE only in rev 2. **True for INSERT and UPDATE as of rev 3 (2026-10-27)** (S2(a) landed).

**New questions for rev 3:**

1. **R3-1 (QE014 now on INSERT).** The isolation check now also refuses a non-READ-COMMITTED INSERT, so 050's insert depends on READ COMMITTED. 050 sets no isolation level and PostgREST uses READ COMMITTED, but the server's `default_transaction_isolation` was not read. Is that acceptable, or should the INSERT branch skip the isolation check?
2. **R3-2 (the vacuous `failed` → `failed`).** After S1, no column of a `pending` or `failed` row can change except by a status move. The earlier "allow `failed` → `failed` with changes" decision has nothing left to apply to. Confirm that is the intended end state.
3. **R3-3 (apply-time failure on a pending row with details).** Case E: any existing `pending` or `failed` row carrying `content_type` or `byte_size` aborts the whole apply. Prod and test-db rows come from 050's blank insert, so none should. Is the read-only count enough to catch it early (count of terminal rows, and of rows with `content_type` or `byte_size` set)?
4. **R3-4 (the DOWN is now unusable over live data).** The DOWN refuses over any terminal row (S3). A real rollback after C5 has stored files needs a separate reviewed artifact. Is a refusal without a ready-made alternative acceptable at this stage, given PITR is off until launch?
5. **R3-5 (the stamp mutant is noisy).** Removing the stamp makes the CHECK refuse the scenario's own fixtures, so 90 assertions fail. A narrower mutant would need the fixtures to stay valid. Is the broad failure enough evidence, or do you want a targeted one?
