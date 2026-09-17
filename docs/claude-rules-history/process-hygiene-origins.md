# Process Hygiene — Rule Origins

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Background agent worktree branch — three-instance evidence

Evidence: on 2026-08-23, three commits fixing migration 030's function-
  overload bug — the fix itself, its dry-run evidence, and the yes/no
  corpus test that closed the follow-on duplicate-logic hazard — were made
  inside `.claude/worktrees/morning-flow-evidence-regen`, on branch
  `worktree-morning-flow-evidence-regen`, while
  `feat/morning-flow-attendance-migration` — the actual feature branch —
  still pointed at the commit BEFORE any of that work, still carrying the
  broken two-parameter version of the migration. Caught only because the
  branches were compared explicitly (`git log --oneline` against both
  names), not because anything surfaced the mismatch on its own. THIS VERY
  ENTRY is a second, live instance from the same session: the harness
  itself refused this edit against the shared checkout mid-consolidation
  ("Call EnterWorktree first"), forcing a second worktree detour to write
  this rule down — the mechanism the rule describes fired on the rule
  being written.
  THE MECHANISM FIRES ON EVERY WRITE THROUGH THIS HARNESS, NOT ONLY ON LONG
  BACKGROUND-AGENT RUNS — this rule's own text is itself a third instance,
  not just the second: adding this one line required its own worktree
  detour and its own consolidation, same as the paragraph above it did.
  Consolidation is part of every write cycle this harness performs, not a
  cleanup step reserved for the end of a long session — check `git worktree
  list` after any commit, not only after ones that felt long-running.

## Defect fixed structurally, grep repo — session-transition incident

Origin: `test/session-transition.test.ts` Test B's own client-side-
  sleep ordering bug (fire caller 1, sleep a fixed ms client-side, fire
  caller 2, trust the gap to guarantee ordering — nothing enforces it)
  was found, understood, and fixed for real on 2026-08-24 21:53
  (`14737cd`, poll a separate connection until caller 1's row lock is
  DIRECTLY OBSERVED held, via `quoco_test_row_is_locked`, before ever
  dispatching caller 2). The IDENTICAL pattern sat unfixed in
  `test/morning-flow.test.ts:439` — written 2026-07-07, untouched even
  when the surrounding lines of that same test were edited on 2026-08-25
  08:52 (`d305e4c`), **eleven hours after** the fix already existed in a
  sibling file. It produced a real CI failure on 2026-08-26, on an
  unrelated docs-only PR, before anyone went looking for it. **This is
  not a missed test — a missed test implies nobody thought to test the
  thing. This is a fix that did not generalise:** the defect class was
  solved once and the solution stayed local to the file it was solved in,
  because closing a fix has never included a step that asks "does this
  exact shape exist anywhere else."

## Every branch pushed to GitHub — 34-worktree audit evidence

EVIDENCE: the 2026-09-13 worktree audit found 34 worktrees, 13
  holding work not on `main`, FOUR with commits existing only on this
  machine (`docs/dpr-regeneration-decision-and-spec`,
  `feat/dash-01-pm-exceptions-home`,
  `fix/test-fixture-teardown-engineer-scope`,
  `worktree-per-run-fixture-batch4`).
  `worktree-adhoc-menu-spec-corrections` held the only surviving copy of
  decisions migration 037's own applied `COMMENT ON COLUMN` cites as
  authority, live on prod. `worktree-evening-q5-tomorrow-needs` still
  holds an idle-hours parser fix never rescued to `main`, while `main`
  carries its own KNOWN DEFECT test for that same bug, unfixed. Recurring
  shape: work is done in a worktree, partially rescued onto a different
  branch that merges, and whatever didn't make that trip stays behind —
  unpushed, unprotected, and invisible to anyone who isn't looking at this
  exact laptop's local branch list.

## Migration-number-reservations updated at apply time — 2026-09-13 audit

EVIDENCE: the
  2026-09-13 reservations audit found FOUR entries (034, 039, 040, 041)
  still reading "held" / "pending review" while those migrations were
  already live on prod — the same drop-shape as the post-apply types-regen
  step this file's own Step G already exists to close, one bookkeeping
  artifact over.

## Generated DB types — superseded interim-state note (pre-2026-07-13)

DATED NOTE (2026-07-13, per 016 round-3 review) — SUPERSEDED 2026-07-13 by the
  generated-types PR (feat/generated-db-types), see the ACTIVE note below. The
  original note recorded the interim state: the pipeline did NOT yet exist,
  clients were untyped, no `types/database.ts` existed, and adoption was DEFERRED
  to the named milestone (a dedicated PR after 016 merges, before Morning Flow
  Pass 2 merges).

