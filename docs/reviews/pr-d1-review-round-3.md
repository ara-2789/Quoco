# PR #348 (PR-D1): round 3, verification of the package

**GO.** All three evidence conditions from round 3 are met. I checked each SHA and file hash in the package against the git tree myself.

## Checked against the tree

| Package claim | Tree at that SHA | Result |
|---|---|---|
| The five SHAs in P1 | `git rev-parse` on each commit | match |
| `f6cf79f` `pm-file-route.test.ts` = `e8e3ed6f…` | `e8e3ed6f…` | match |
| `f6cf79f` `pm-file-access.ts` = `9289988c…` | `9289988c…` | match |
| `d5b8a64` `pm-file-route.test.ts` = `e8e3ed6f…` (test unchanged between RED and fix) | `e8e3ed6f…` | match |
| `d5b8a64` `pm-file-access.ts` = `066396e3…`, which is also the T-NOBUCKET-1 signer hash before and after every control | `066396e3…` | match |
| `b92fabd` `labels.ts` = `5b9aa995…`, before and after the H2 control | `5b9aa995…` | match |
| CI `headSha` | `b92fabd6b6561b30798bc464e5c2259daa1b4cbb` | match |

## Condition by condition

**1. S1, RED and GREEN: met.**
- RED was run at `f6cf79f` with a clean tree and `PM_CONTROL=service`. Output: `AssertionError: expected 302 to be 404`, 1 failed and 4 passed, vitest exit 1. The 302 follows directly from the code at that commit (the membership row exists and there is no status line), so the failure is the intended one, not a side effect of the shared database.
- GREEN was run at `d5b8a64` on a clean tree, twice:
  - the T-FILE-CTRL deactivated case, with the swap: passed
  - the T-FILE-2..n deactivated case: passed

**2. CI of record: met.** P6 shows `success`, `headSha` = `b92fabd…`, 164/164 files, 2697 passed / 7 skipped / 1 todo, and the T-CONC-1 line (4598 ms).

**3. Render control: met.** With the old string concatenation restored at `b92fabd`, every H2 row failed (exit 1). The `Received:` lines show `"Invoice expected Invoice pending for {n} days 7"`, which is the defect you described. The file hash after revert matches the hash before.

**Also covered:**
- **G2:** the merge `92936dc` touches none of the protected paths (the grep returns none).
- **Strings count:** your count of 75 `-` and 75 `+` value lines and my count of 156 total changed lines are both right; the difference is the 6 header comment lines your grep filtered out. Nothing to fix.
- **G3:** this run left zero residue rows and created zero new bucket objects.

## For the record (not conditions)

**N1. Command lines are missing from the GREEN runs.**
- P2's two GREEN blocks show HEAD and the results but not the command or environment.
- For the swap case this doesn't matter: the test hard-codes `rowClient: kit.svc`, so the environment variable has no effect on it.
- "RLS still refuses first" without the swap is established by reading the code: the status value is checked in the app check, which runs after the RLS read. It is not established by the transcript. Put the command line in future GREEN blocks.

**N2. P3's REDs are summaries.**
- T-NOBUCKET-1's four planted-verb REDs and the unlisted-file RED are recorded as `RED` plus the mutated file's sha256, not as raw failure lines.
- The guard is pure and GREEN at head (raw lines in R5), so I accept this. Next time, paste one raw `FAIL` line per control.

**N3. The RED run shared the test database with another CI job.**
- The RED run overlapped main's CI job 41359820380 on the shared test database. That timing came from the backend chat, so keep it labelled as reported.
- It doesn't weaken this RED, because the code at `f6cf79f` decides the 302. It is still the condition the schedule-window rule exists to prevent.

**N4. An approved DC with no linked invoice still shows "Invoice pending" (R1).**
- "Open" in the query means "not rejected and not cancelled", so approved DCs are included.
- If an approved DC still owes an invoice, that is correct; if not, it needs a change.
- This is a product decision for you. It has been the query's behaviour since round 1.

**N5. Old test marker rows remain on test-db.**
- 4 tenants, 51 `capture_documents` rows and 69 `capture_files` rows from other runs or sessions.
- None is from this PR. Hand it to the backend chat as a cleanup item.

## Merge protocol

1. Merge `b92fabd` as it is. Any new commit voids this GO.
2. Merging is deploying. The page is reachable by URL only (no nav entry until the C6 gate), and digit 4 stays dark (052 rollout step 1).
3. **Closing artifact:** on prod, as the owning PM, open one stored file and record:
   - the 302
   - `Cache-Control: no-store` and `Referrer-Policy: no-referrer`
   - the signed URL's expiry at 60 s
   - the same request as a non-PM returning 404
