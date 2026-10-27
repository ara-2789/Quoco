**051 apply gate: test-db record plus CI run 40527531487**

I checked PR #339 at `94ef38aa02ece3c0226933d89535700c509d8f52` against `main` at `10cd3a3047d281c34a5e34cbae13d016dd0aa276`. Since rev 3, the SQL is unchanged (sha `debe97f0…2df9`, which matches the file the record says was applied), and so are both DOWN files and the tests. I read the apply record, the runbook, the carry-forward and the epoch mutant in full, and grepped the raw log.

**What I could and couldn't see of the CI run.** I read the run page logged out. It's for `94ef38a`, triggered by a pull_request synchronize, and its overall conclusion is Failure. The only failing job I can see is Lint, with two `require()` errors at lines 3–4 of `postgrest-probes.cjs`. That matches what you said. But the page shows no per-job conclusion for Test (real test-db), and its log needs a sign-in. So "Test is green, QE011 and 23514 asserted" is your report, not something I observed. That's fine, because the run you're about to pin will close it, as long as it comes with the output described in condition 1 below.

---

**Round 3 apply items: all landed**

- **Isolation probes.** Runbook step 1 rows 41–43 and P0 show `read committed`, with no isolation setting on any role or db-role setting.
- **Epoch mutant** (`G2c`). It produces exactly 2 FAIL lines, both in the T-D8-15 time window, against 142 PASS. That's the targeted result I asked for: the window check fired and nothing else moved.
- **Restore warning.** It's in runbook §d, with the reason written out.
- **Carry-forward item 9.** Struck, dated, and pointing to item 13.
- **Test-db apply.** Applied, DOWN rehearsed, re-applied, with the ledger row written after each apply. The fingerprint went `91a1865d → 19102bc8 → 91a1865d → 19102bc8`, and the comments hash moved the same way.

---

**Findings (none blocking)**

**S1. The rename needs to go on the record.** Renaming the `.cjs` to `.txt` is fine, and the content stays the same. Right now, though, the script isn't in `SHA256.txt`, and the raw log's P1b section doesn't show the command that ran it. Once it's renamed, nothing ties the `.txt` to what actually executed. In the rename commit:
- hash the file into `SHA256.txt`;
- add a dated note to the record: "executed as `postgrest-probes.cjs` at `38c0b21…`, stored as `.txt` from `<sha>`, sha256 `<x>` unchanged."

Also put an ESLint ignore for `docs/reviews/**` in the carry-forward. Otherwise the next evidence script hits the same wall.

**S2. Your reason for skipping the seeded-row refusal on test-db is wrong.** The record says a seeded stored row "may be impossible to remove with the test helpers." It isn't. `quoco_test_capture_cleanup` is SECURITY DEFINER and runs `DELETE FROM public.capture_files` (`scripts/test-db-only-capture-helpers.sql`, around line 160). 051's trigger only fires on INSERT and UPDATE, and every CI run now creates stored rows and deletes them this way. The scaffold proof in `G3-down-rev3` still covers the refusal, so the outcome stands. Correct the reason, with a date.

The flip side: if a CI run aborts before teardown, it leaves terminal rows on test-db, and the test-db DOWN will refuse until they're cleaned up. After the pinned run, record a read-only terminal-row count on test-db. It should be 0.

**S3. Two claims in the record will go stale when the green run lands.** It says "No CI run exists against the applied test-db yet" and that "the database tests have still never run against any database." Once the green run is in, add a dated addendum to both that points at the run. Don't edit the original lines.

**N1.** Leaving the PGRST202 lines in the raw log as FAIL, unedited, was the right call. Keep it that way.

---

**One gate to add for prod**

Test-db's fingerprints matched the scaffold exactly. That gives you a free tripwire on prod:
- prod's P0 must show fingerprint `91a1865dd1fd0b98de6a9d9333008593` and comments hash `80b77da945cc55890da3acee8182eca2`;
- after the apply, prod must show `19102bc8020867d2650e13c6fddd13c0` and `b97d2e3b734f6c002fd5c0a57a06e643`.

Any mismatch means STOP, whatever the reason. This is the first time anyone looks at prod's `capture_files` for this migration, and a drifted prod should not get a migration that was only ever proved against test-db's shape.

---

**Verdict: prod apply GO, conditional.** These conditions must all be met before the prod apply:

1. **A fully green run at the new head,** pinned by full `headSha`. For it, I need raw output, not a summary:
   - every job's conclusion;
   - the vitest lines for `capture-files-immutability.test.ts` showing T-D8-3, 4, 5, 12, 13, 14 and 18 as passed, not skipped.
2. **S1** in the rename commit.
3. **S2 and S3** as dated addenda, plus the test-db terminal-row count after the run.
4. **Prod, per runbook §c,** with:
   - the P0 probes and the fingerprint/hash gate above;
   - the PITR-substituted readback saved and hashed before the apply;
   - the run outside both windows, with no CI running or queued;
   - your go-ahead in the same exchange;
   - the ledger row as part of "apply done";
   - `git mv` into `supabase/migrations/`, plus the reservation update, in the apply commit;
   - types regenerated after the apply.

The closing artifact is `051-prod-apply-record.md`, with the post-apply fingerprint matching test-db's.
