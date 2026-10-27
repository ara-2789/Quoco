# PR-C carry-forward (from the 050 close-out)

Written 2026-10-26. Four items PR-C must not lose. Nothing here is implemented. Fixture fix: not in the close-out PR.

1. **Overload rule.** The 050 DOWN guard counts exactly seven functions by name (`v_n <> 7`). PR-C must not add overloads of those seven names, or it must update both 050 DOWN files in the same PR.
   Source: `docs/reviews/050-down-testdb.sql` and `docs/reviews/050-down-prod.sql`, the `DOWN_PRECONDITION_050` block; `docs/reviews/050-closeout-record.md` section 5.

2. **Fixed clock.** The capture fixtures use the real clock, so a CI run that crosses 18:30Z (IST midnight) can fail. Run 40217915047 attempt 1 did. Fixtures must pass a fixed `p_now`.
   Source: `docs/reviews/050-closeout-record.md` section 3; `test/helpers/capture-fixtures.ts` (`makeDoc`, `miTurn`).

3. **D1 and the IST midnight case.** The open D1 decision (what `1`, `2`, `3` do after expiry) must also cover a session that crosses midnight: a session started at 23:59 is wiped at 00:00 by the IST-date rule, and the stale ack question can still be answered afterwards.
   Source: `docs/plans/slice-1a-plan-v3.md` section 12 D1, Q5 (N3, T-A27-8); `docs/plans/pr-b-050-plan.md` lines 319 and 479.

4. **PITR is off until launch.** Every FULL-tier prod apply records "PITR substituted", with prod-captured bodies and a DOWN, until the switch trigger fires.
   Source: `docs/reviews/050-closeout-record.md` section 6 (per Aravind, 2026-10-26); CLAUDE.md section 0, "SWITCH TRIGGER".

## Added 2026-10-27, source: 051 external review round 1 (`docs/reviews/051-external-review-round-1.md`)

5. **C5 byte guard (S1).** 051 locks the database record of a stored file, not the bytes in Storage; `service_role` can overwrite a Storage object. C5 must upload with `upsert: false` to the row-owned path (`tenant/project/document/<file id>...`, the path 051's `capture_files_storage_path_row_chk` requires), and no C5 code path may overwrite or delete an object under a stored row.
   Source: `docs/reviews/051-external-review-round-1.md` S1 and B2; `docs/reviews/051_capture_files_immutability.sql` header.

6. **C5 UPDATE contract (N2, reviewer Q6).** C5 filters its UPDATE on `ingest_status IN ('pending','failed')`, so a retry touches 0 rows instead of relying on value equality. C5 treats QE011 as an ALERT, never a retry. C5's logs carry the table name (`E11` now means two tables).
   Source: `docs/reviews/051-external-review-round-1.md` N2 and Q6.

7. **C5 plan diffs its columns against 051's grant (reviewer Q4).** Before any C5 code exists, the C5 plan lists every column its UPDATE writes and diffs that list against 051's grant (`ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`). `ingested_at` is database-stamped and not grantable. A stored row must carry all of `content_type, byte_size, sha256, storage_path`; a rejected row must carry `reject_reason` and no `sha256`, `storage_path` or `preview_state` (051 rev 2 CHECKs, 23514).
   Source: `docs/reviews/051-external-review-round-1.md` Q4, B1, S2.

8. **Apply runbook (N4).** The ledger row is part of "apply done", not a follow-up. The 051 DOWN refuses without it. An apply GO needs the test-db apply, its ledger row, and a pinned green CI run URL in which QE011 is observed as `error.code`.
   Source: `docs/reviews/051-external-review-round-1.md` N4 and Verdict.

9. **Apply block read-only count (rev 2).** Prod `capture_files` is believed empty (nothing calls `apply_material_inward_turn` before C4). The 051 rev 2 apply adds CHECKs that fail on any existing stored or rejected row (no `ingested_at` backfill is invented). The apply block verifies emptiness with a read-only count of `capture_files` rows by status before the apply, on test-db and on prod.
   Source: `docs/reviews/051-review-package.md` Rev 2 section; `docs/reviews/051-sql-evidence/G1b-postcondition-negative-rev2.txt` case D.
