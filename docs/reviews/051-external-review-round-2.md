**051 round 2, PR #339 @ `f03a3721cf7fbb54ce1df47eec9f13f6f5b6394d`**

Base is still `main` @ `10cd3a3047d281c34a5e34cbae13d016dd0aa276`. I diffed rev 1 (`9e9b63b`) against rev 2 and read the SQL delta, the DOWN files, the Rev 2 section, §9 and the new tests in full. All 32 entries in `SHA256.txt` verify at head, and lint at head is `clean. 107 known violation(s), all exempted`. My probes ran on PG 16.15 against 049's DDL verbatim plus rev 2 applied byte-for-byte (sha `fbd3b3a5…`); the post-condition passed and the cluster is gone.

B1, B2, S1, N1–N4 all landed as asked. The rev 1 → rev 2 RED/GREEN pairs line up with what I asked for.

---

**R2-1: confirmed, with a correction to the reason.**

The DB stamp is better than what I wrote. The 049 TR1 precedent isn't really the argument, though. The argument is: validate what you construct. If you grant the column, the trigger has to judge a caller's timestamp, and there's nothing meaningful to judge it against. If you stamp it, there's nothing to judge. The QE009 compare is owner-only defence; `service_role` never reaches it:

```
SET ROLE service_role;
UPDATE capture_files SET ingested_at = '2020-01-01' WHERE file_no=1;
ERROR:  permission denied for table capture_files
```

Your sentence "no caller can ever supply the time" is too wide, though. It holds for UPDATE only. The trigger doesn't fire on INSERT, and the CHECK only wants *a* time:

```
INSERT INTO capture_files (..., ingest_status, reject_reason, ingested_at)
VALUES (..., 'rejected', 'too_large', '2020-01-01');
 file_no | ingest_status | reject_reason | ingested_at
       2 | rejected      | too_large     | 2020-01-01
```

That ran as owner, which is what any DEFINER function runs as. 050's insert names none of these columns (050:353–355), so nothing does this today. C3–C6 add inserters, though.

---

**Findings**

**S1. Stale attempt data gets frozen into terminal rows (this is your R2-6, answered yes).** `failed`→`failed` and `pending` rows can hold `content_type` and `byte_size`. A later transition that doesn't overwrite them inherits them as if they were observed in that transition. Then the lock freezes them.

```
UPDATE ... SET ingest_status='failed', content_type='image/png', byte_size=99999999 WHERE file_no=1;   UPDATE 1
UPDATE ... SET ingest_status='rejected', reject_reason='wrong_type' WHERE file_no=1;                   UPDATE 1
 file_no | ingest_status | reject_reason | content_type | byte_size
       1 | rejected      | wrong_type    | image/png    |  99999999
```

That row is a "wrong type" reject that also claims a 95 MB size from a different attempt, frozen permanently. It's the same class as B1, just quieter. The fix:

```sql
CHECK (ingest_status IN ('stored','rejected') OR (content_type IS NULL AND byte_size IS NULL))
```

Every terminal detail then has to arrive in the UPDATE that makes the row terminal, which closes "details move with status" completely. Pending rows on test-db and prod are all NULL, so it validates. Land it this round.

**S2. INSERT is outside the lock.** You have two options:

- (a) Make it `BEFORE INSERT OR UPDATE`, with an INSERT branch that requires `ingest_status='pending'` and all eight detail/stamp columns NULL (QE011). Update the post-condition's `tgtype` mask to match.
- (b) Write a carry-forward rule that any new `INSERT INTO capture_files` is reviewed against this, plus a static test in the T-D8-17 style that fails if an insert column list names `ingest_status` or `ingested_at`.

(a) is the real lock; (b) is a tripwire. I'd take (a), since you're re-running the rehearsal for S1 anyway.

**S3. Make R2-4 mechanical in the DOWN, not just stated in prose.** The stance is right. But as written, the DOWN will drop real `ingested_at` values from real rows without asking, and you've already shown that a re-apply over those rows aborts. Add `terminal_rows=N` to the DOWN precondition, and refuse when N > 0. If anyone ever needs to roll back over live rows, that's a separate reviewed artifact that carries its own backfill or clear decision.

---

**Your other questions**

- **R2-2 `now()`:** Keep it. A PostgREST request is one transaction, so `now()` is the request start, and it agrees with any other `now()` written in the same transaction. `clock_timestamp()` buys nothing.
- **R2-3 two path checks:** Keep both, and don't plan a later drop. Dropping an applied constraint for tidiness is all risk and no gain.
- **R2-5 count:** Enough. Fix the reasoning in the package, though. "Nothing calls `apply_material_inward_turn` before C4" is weak; your own reservation note says 050's N2 start-branches are live on prod. The real reason is structural: today nothing but the owner can UPDATE `capture_files` (049 grants SELECT only), so a terminal row can't exist short of a hand edit. Pending rows validate either way. And if it's wrong, the file aborts whole (G1b case D). The count is an early warning, not the guard.
- **R2-7 `select *` keys:** Accept it as a tripwire. It works because `newPending()` guarantees a row, and table-level SELECT covers any column added later. The catalog half is the post-condition's `pg_attribute` walk, which is good enough as a pair.

---

**Credit**

- Comparing `ingested_at` to OLD *before* stamping, so the caller's value is judged and then overwritten, not the other way round.
- G1b case D: you seeded a valid-under-049 stored row and proved the whole file aborts with the fingerprint back at baseline.
- Three separate mutants (stamp, path, terminal) instead of one.
- The S1 strike-through left legible, with a date.
- R2-A through R2-D found by you, not me. The re-apply-aborts point is the one I'd have raised.

---

**Verdict: design GO, conditional.** No blocking findings. Before the test-db apply:

1. The S1 CHECK in the file, with a post-condition entry and a DOWN drop.
2. S2(a) in the file, or S2(b) written down; your call, but say which.
3. S3 precondition in both DOWN files.
4. Re-run G0/G1/G1b/G2/G2b/G3. My two new probes (stale-size inheritance, owner INSERT of a terminal row) must be RED on rev 2 and GREEN on rev 3, and add a mutant for the S1 CHECK.
5. Package wording: R2-1's "no caller can ever" limited to UPDATE unless S2(a) lands, and the R2-5 reason corrected.

Apply GO is unchanged from round 1. It needs the test-db apply, the ledger row, the pre-apply terminal-row count, and a pinned green CI run URL where QE011 and 23514 show up as `error.code`.

I'm not pushing this one either. `pr339r2` is a local copy of your PR head that I fetched to review rev 2. All 8 commits are yours and already on GitHub under PR #339. I made no commits or edits in the repo, and pushing would just create a stray branch on `ara-2789/Quoco`.

The round 2 review above is complete.
