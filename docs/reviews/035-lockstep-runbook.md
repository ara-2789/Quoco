# Migration 035 lockstep apply runbook — consolidated, prepared 2026-09-02

**Status: PREPARED, NOT EXECUTED.** Per explicit instruction: report the
consolidation plan and the runbook, apply nothing. Nothing in this document
has been run against test-db or prod. The canonical S0–S6 sequence below is
**pinned from the reviewed package**, not re-derived —
`docs/reviews/035-evening-flow-review-package.md` §14.2 (`worktree-evening-
flow-plan-commit:docs/reviews/035-evening-flow-review-package.md`, lines
479–532) — with three additions this entry makes explicit: a PITR
observation step (missing from that package, present in the generic
template), the consolidation state as of PR #157, and this file's own
repo-state header.

## Repo-state header (CLAUDE.md §0's standing convention)

- `origin/main @ 4e720c1e6f1e8dfb177cd6fda1a48ad816b52a23`
- `worktree-evening-flow-plan-commit` (the 035 branch): 12 commits ahead of
  `origin/main`, 0 behind — opened as **PR #157**, CI running (first time
  ever for this branch — see Consolidation Plan below). Not yet consolidated
  with the templates repoint (also below).
- Last runbook executed: migration 034 (`docs/reviews/034-apply-record.md`,
  production apply record, fingerprint PASS).
- **This header goes stale the moment either PR moves — re-run `git log`/`gh
  pr view` fresh at S0, not from this line**, per the review package's own
  S0 text: "re-read... not from this package's own §0, which is already
  stale by the time of a real apply."

## Consolidation plan (report only — not yet executed)

Two branches currently touch adjacent territory:

1. **`worktree-evening-flow-plan-commit`** (PR #157) — the 035 SQL, the
   evening.ts 5-question rewrite, the three parsers, the review package.
2. **`worktree-evening-2v3-repoint-lockstep`** (this session's own commit
   `82b6fee`) — repoints `EVENING_CHECKIN_SID` to 2v3, keeps
   `MORNING_CHECKIN_SID` on template 1, per the MARKETING-categorisation
   decision.

**Mechanical overlap, checked precisely, not assumed:** `git diff
origin/main worktree-evening-flow-plan-commit` on `templates.ts`,
`trigger.ts`, `checkpoint-trigger.ts`, `roster.ts`, and
`scripts/submit-templates.ts` returns **empty** — PR #157 does not touch any
of these five files at all. The one file both branches DO touch,
`test/outbound-trigger.test.ts`, has non-overlapping hunks (PR #157 edits a
header comment around line 84–90; this session's commit edits the import
line and the test body around line 500+) — a clean merge, not a conflict.

**But there is a real coupling, confirmed by direct comparison, not
assumed — this is where I differ slightly from "no functional dependency"
and want to state precisely why folding is correct:** `origin/main`'s
CURRENT (unrewritten) `evening.ts` still has:
```
EVENING_QUESTIONS[1] = 'Evening check-in 🌇 What *work was completed* today? Add the quantity if you can — e.g. "slab concrete 120 sqm".'
```
— old template 2's wording, byte-different from `quoco_evening_checkin_v3`'s
approved body ("Enter quantity wherever applicable... e.g. \"brickwork 8
m3\""). PR #157's own evening.ts rewrite is what corrects this drift (its
§15.1 "Q1 copy correction" work). **If the templates.ts repoint ships
separately, ahead of PR #157, there is a real window where the outbound
trigger sends 2v3's new wording but a REASK (invalid first answer) replies
with the OLD, uncorrected copy** — reproducing the exact copy-divergence
class this project has already found and fixed once. This is the same
species of hazard as Findings A/B in §14.2 (an observable gap between two
things that must change together), one layer up from the RPC/parser
coupling those findings describe.

**Conclusion: fold `worktree-evening-2v3-repoint-lockstep`'s one commit
INTO PR #157, not the reverse.** PR #157 is the larger, already-under-review
piece; the repoint is a small, cleanly-separable addition to it (confirmed
zero file-conflict on four of the five files it touches, non-overlapping
hunks on the fifth). Mechanical plan, not yet executed:
1. Wait for PR #157's current CI run to finish and report cleanly — this is
   the first time these 12 commits have ever been tested; folding in more
   changes before seeing that result would confuse "pre-existing 035 defect"
   with "something the fold introduced."
2. Cherry-pick (or rebase) commit `82b6fee` onto `worktree-evening-flow-
   plan-commit`, push, let CI re-run on the combined branch.
3. Update PR #157's description to note the fold and why (this coupling).
4. Close/delete `worktree-evening-2v3-repoint-lockstep` as its own PR once
   its one commit is confirmed reachable from PR #157 — per CLAUDE.md's own
   worktree-consolidation rule, don't leave it as a second, quietly-
   authoritative copy.

**I have not done step 2 onward yet** — reporting the plan per instruction,
pending your confirmation given step 1 (CI result) isn't in yet either.

## The runbook itself

Numbered S0–S6, pinned from the review package, PITR inserted before S0,
S0 updated for the current consolidation state.

### PITR observation (no SQL) — inserted, not in the original package

Per the generic template's own step A (`docs/migration-runbook-template.md`)
and CLAUDE.md §0's "rollback mechanisms are verified by observation, never
by checklist status": Supabase Dashboard → prod project → Database →
Backups → Point in Time. Observe an active restore window ending ~now,
record the timestamp. **Verify by observation — do not trust a "PITR
provisioned" line from any prior doc**, per the 007-apply origin of that
rule (a stale "DONE" checklist entry was false for weeks). → confirm before
S0.

### S0 — Pre-flight

- Confirm `main`'s current HEAD fresh (not this document's header above).
- Re-read `supabase/migrations/` + `docs/reviews/*.sql` directly.
- **Re-verify migration number 035 is still free at THIS moment** — checked
  clean today (2026-09-02): `git log --all --oneline --grep="035"` and `git
  log --all --oneline -- "supabase/migrations/035*"` across every local and
  remote branch return nothing outside the expected `migration-035` commit
  line; zero open PRs reference it independently. **Re-run this exact check
  again at actual apply time** — it has been days once already between
  drafting and applying in this project's own history (the review package's
  own §0a origin), and "checked clean once" is not "checked clean now."
- Re-run `npm run lint:migrations` fresh.
- **Confirm the companion TypeScript is open, reviewed, and ready to merge
  on a keystroke — NOT already merged.** As of this writing: PR #157, open,
  CI in progress, **not yet carrying the templates.ts evening-repoint per
  the Consolidation Plan above** — that fold must land and go green before
  S0 is satisfied. Confirm the fold is present and CI is green on the
  FINAL combined PR before proceeding to S1, not on the pre-fold state.

### S1 — Apply window: BOTH flows' sessions cleared, not one

Per the review package's §6: evening has no cutoff-sweep guarantee the way
morning does. Live query, immediately before applying, on the TARGET
database, not carried over from an earlier check:
```sql
SELECT current_flow, current_step, count(*)
FROM whatsapp_sessions
WHERE current_flow IS NOT NULL
GROUP BY 1, 2;
```
**PROCEED condition: `count = 0`** across all rows — a genuinely empty
result set, not a filtered one. If non-zero, confirm the migration's own
built-in session sweep (STEP 3 of the SQL file) will correctly close
whatever it finds (the review package's §6 scaffold evidence proved this
for a seeded session; re-confirm it wasn't merely asserted for THIS run).
This is the "live zero-sessions probe run immediately before, not
inherited" requirement — run on the actual target (test-db in S2's first
half, prod in its second half), not read from this document or an earlier
session.

### S2 — Apply, ONE sitting, no gap to S3

Fresh linked-project breadcrumb pasted immediately before the apply
(CLAUDE.md §0's PROD APPLIES rule — project ref printed in the same output
as the apply, not recalled from earlier):
```
supabase db query --linked -f docs/reviews/035_evening_flow_restructuring.sql
```
— never `db push`. Against test-db first (re-rehearsal, not trusting the
2026-09-02 rehearsal's state as still current), then prod. The file's own
`BEGIN`/`COMMIT` replaces both RPCs and runs the one-time session sweep
together — no intermediate state where one RPC is new and the other old.
By hand, at your terminal — Claude Code does not issue this command without
your explicit go-ahead in the same exchange (standing rule).

### S3 — Merge — THE LOCKSTEP CLAUSE

The (now-consolidated, per the Consolidation Plan above) PR merges
IMMEDIATELY after S2 confirms on prod, not "sometime after" — Vercel
deploys on merge to `main`, so merging is the deploy. Do not proceed to S4
until the merge/deploy is confirmed live.

### S4 — Confirm live + tests green — the it.fails tests flipping GREEN

The `it.fails`-wrapped tests in `test/evening-flow.test.ts` and
`test/section-42-row-readback.test.ts` (idle_hours/equipment_hours sites)
get their first real execution against the now-live RPC here. **This is
the proof the lockstep worked** — every one of them needs 035 actually
applied to run for real (per the evening.ts-rewrite session's own §15.7).
A named, required step, not an assumed side effect of S2/S3.

### S5 — Post-apply fingerprint

Re-probe both function bodies' `prosrc` hash and both signatures against
the live database; compare to the values pinned in the review package's §1.
Confirm the two new columns exist with the expected type and the
column-bound grant list from §7.

### S6 — Ledger repair + confirm the file is on `main` — LAST, deliberately

`supabase migration list --linked` against each database applied to;
confirm 035 appears on BOTH `local` and `remote`. If not, `supabase
migration repair --status applied 035 --linked`, verified, not assumed.
Then confirm the migration file itself is reachable from `main` — `git show
origin/main:supabase/migrations/035_evening_flow_restructuring.sql` — per
CLAUDE.md's "a migration is not done when applied and ledgered — it is done
when the file is on `main`" rule.

## After apply

- `docs/schema.md`'s 035 entry, written only after S6 confirms.
- Apply-record with the applied SHA + every probe frame, per the standing
  provenance rule (`git show <sha>:path`, never paraphrased).
