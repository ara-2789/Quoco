# Artifact Provenance & Review Process — Incident History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Green CI certifies a SHA — concurrency-group cancellation incident

Origin: a shared CI concurrency group (`ci-test-db-suite`)
  cancels a queued run when a newer one for the same branch arrives —
  rapid pushes to fix small issues one after another produce a run that
  passes for an OLDER commit while the LATEST commit's own run gets
  cancelled underneath it. A merge attempted on "checks are green" without
  checking which SHA they're green FOR would have shipped a commit whose
  own CI result was never actually observed — caught only because the SHA
  was checked before merging, not because the color was.

## Regular merge commits, not squash — PR #243/#244 broken-ancestry incident

EVIDENCE: PR #243 (migration 039 +
  the runbook's own Step F) was squash-merged into `main` as `f87faf0`;
  PR #244 (Stage 2, same branch, continuing directly on top of #243's own
  pre-squash commits, having already added the runbook's Step G on that
  same base) then showed `git merge-base HEAD origin/main` returning
  `d137bbf` — a commit from BEFORE Stage 1 started, not `f87faf0`'s actual
  logical parent. `git merge-tree` reported a genuine CONFLICT on
  `docs/migration-runbook-template.md` despite the branch's version being
  byte-for-byte `origin/main`'s version plus a pure insertion (confirmed via
  `git diff origin/main:<path> de6f513:<path>` returning empty, i.e.
  identical, before the merge) — resolved correctly this time (`-X ours`,
  verified after the fact by confirming the merge diff was a pure addition
  with zero deletions), but only after a full investigation cycle to tell
  "real conflict" apart from "broken ancestry." **The SAME broken-ancestry
  merge state ALSO silently stopped GitHub Actions from ever triggering
  `pull_request`-event CI on PR #244 at all** — a `DIRTY`/`CONFLICTING`
  mergeable status blocks GitHub from computing the merge ref some workflow
  trigger paths depend on, so the missing CI run itself needed its own
  separate investigation before anyone even noticed a check was absent
  rather than merely slow.

