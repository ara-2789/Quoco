I'll pin `1dab368`, diff the prod DOWN against the test-db DOWN, read the pre-check transcript, and check what CI actually certified.

The prod DOWN differs from the test-db DOWN in the header only. Next, the pre-check transcript and the two prod body files: are the embedded restore bodies byte-identical to what was captured?

The rule has no exemption for docs-only commits. Let me check the run itself rather than take the description.

# 050 prod DOWN review: PR #333 @ `1dab368`

**Verdict: the prod DOWN is cleared. Don't merge yet, though.**
- The green run you pinned is at `5534d50`. The PR head is `1dab368`, two docs-only commits later (`c038a79`, `1dab368`).
- CLAUDE.md line 269: "confirm the passing run's `headSha` matches the PR's current HEAD — a pass on an earlier commit certifies nothing about the one actually being merged." There's no exemption for docs-only commits.
- So re-run CI at the head you'll actually merge, and pin that run. That's the only thing between you and the merge.
- I couldn't open the Actions run from here (this session has no GitHub API access), so `39372883356`'s `headSha` is your record, not something I checked.

**Pins**
- PR head `1dab3684b2e50599d5d401a0fc52680ac2a1d9a7`; `main` still `4b419f6`.
- `050-down-prod.sql` is `2e3747d4…db44c`, as you said. The UP is unchanged at `1e09730d…`.

**What I checked**
- **The prod DOWN against the test-db DOWN:** `diff` shows only lines 1-6, the header comment. Every statement, the lock, the ledger delete and the closing assertion are the same.
- **The prod bodies:** `050-prod-live-morning.sql` and `-evening.sql` hash to `69ae1b5c…cebe5` and `30979c8f…c18a4`. Those are the same hashes as the test-db captures in `SHA256.txt`, so prod's text is byte-identical to test-db's. Both bodies appear verbatim inside the prod DOWN.
- **What follows:** your test-db DOWN rehearsal (with a live session, then re-apply) carries over to prod unchanged. Same statements, same restore text.
- **The pre-check transcript, item by item:**
  - S-4 returns 0 rows (3-a), and there are 0 `invoice` sessions (3-b).
  - The two live functions are owned by `postgres`, `SECURITY DEFINER`, with `search_path=public` and ACL `{postgres=X,service_role=X}`, which is exactly what the UP's assertion expects (3-d1).
  - The CHECK allows `invoice` (3-e1). `ensure_rls` is present and enabled, as D-2 assumed (3-e3).
  - The ledger ends at 049, with nothing after it (3-f1). No function among the 243 mentions QE015–017 (3-f2/f3). None of the seven names exist yet (3-d2).
- **One small gap:** the transcript doesn't show prod's `md5(pg_get_functiondef)` for the two functions. The byte-identical files cover it, and the DOWN's closing assertion re-checks it when it runs. Still, for the apply record, include the md5 line in the transcript.

## Your question: should the prod DOWN refuse to run anywhere but prod?

**No identity guard. I'd add a precondition instead.**

There's no reliable way for SQL to tell the two projects apart:
- `current_database()` is `postgres` on both.
- Nothing in the catalog carries the project ref.
- Anything data-based (a known tenant id, a row count) is fragile, and a guard that misfires during a real rollback is worse than no guard.

The guard also wouldn't protect anything here. The two artifacts are identical apart from the header, and their restore text is byte-identical. So running the "wrong" file restores exactly the right bodies. The real risk is running a DOWN on the wrong *database*, and only the operator rule catches that: print `supabase/.temp/project-ref` and paste it in the same frame, as you already do.

What the file already protects:
- **The DROPs** (`:790-796`) are plain `DROP FUNCTION`, with no `IF EXISTS`. On a database where 050 isn't applied, the first DROP errors and the whole transaction rolls back.
- **The closing assertion** (`:810-837`) aborts on any wrong end state.

Worth adding (non-blocking): one `DO` block right after the `LOCK`. It raises `DOWN_PRECONDITION_050` unless the 050 ledger row exists **and** all seven functions are present. That gives a clear refusal up front instead of a DROP error halfway through. Put the same block in both artifacts, so they still differ only in the header.

## Before you apply to prod

1. Re-run CI at the merge head, check its `headSha`, and pin it. Then merge as a regular merge commit.
2. Apply outside 08:25–08:40 and 18:25–18:40 IST. The UP replaces both live check-in functions.
3. Print and paste the project ref in the same frame, then run `supabase db query --linked -f`, foreground.
4. Readbacks:
   - the UP's own assertion passes;
   - `pg_proc` count = 1 for each of the nine names;
   - the ACL matrix;
   - one real anon-key call refused;
   - the live morning and evening md5s are now the 050 bodies, not `707c10fe`/`d19d0750`.
5. Ledger row, reservations file, the file moved into `supabase/migrations/` in the apply commit, and types regenerated per D-16.
6. In the apply record, write "PITR substituted" (D-6), naming the two prod body files and their sha256 as the rollback evidence.

PR-C stays blocked on S-F and S-3. PR-D must be live before any engineer is switched on.