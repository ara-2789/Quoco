# C5 deploy record: PR #344 (`capture_ingest` job handler)

Written 2026-10-30. Labels: **verified** = I checked it against git or GitHub when writing this record (raw output in `/tmp/quoco/c5-followup-log.txt`); **per Aravind** = relayed to me, not checked by me (no database or Vercel access in this work).

## The merge

| | |
|---|---|
| PR | #344, `feat/pr-c-c5-ingest` -> `main` (regular merge commit) |
| Merge commit | `594e006c5c753849660ea52ac75a5f0c11eec75e` (verified) |
| Parents | `a84f6e53a68d44e22b34601a575c9346eafe3dd4` (the C4b merge, PR #343) and `60890bb92a697dfec4ef6667c831c4ceec4cab57` (the C5 branch head) (verified with `git log -1 --format='%H parents=%P'`) |

## CI

| Run | Event / ref | headSha | Conclusion |
|---|---|---|---|
| `40913097425` | `pull_request`, `feat/pr-c-c5-ingest` (pre-merge) | `60890bb92a697dfec4ef6667c831c4ceec4cab57` | success (verified, `gh run view`) |
| `40926007684` | `push`, `main` | `594e006c5c753849660ea52ac75a5f0c11eec75e` | success (verified, `gh run view`) |

The pre-merge run's `headSha` equals the PR head that was merged (second parent), so the green check certified the SHA that went in.

## Production, before and after (per Aravind)

C5 is dark: nothing enqueues a `capture_ingest` job while the digit-4 switch is off (`app/api/jobs/tick/route.ts`, `lib/media/capture-ingest.ts` headers). Counts taken by Aravind around the deploy:

| Table / job | Before | After |
|---|---|---|
| `invoice_sessions` | 0 | 0 |
| `capture_ingest` jobs | none | none |
| `capture_files` | none | none |

Not checked by me: these counts.

## Vercel (per Aravind)

Deployment "verified" by Aravind. Not checked by me. Which branch Vercel treats as Production is still an open question (`docs/reviews/s1-build-record.md`, "Open items").

## Process note: merged inside the no-push window (per Aravind)

The no-push window is 23:15-00:15 IST (per Aravind). The merge happened inside the no-push window. This was a habit breach of the window rule. No harm was seen (the counts above did not move and CI on `main` was green). Recorded so the pattern is visible; nothing here changes the deploy.
