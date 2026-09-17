# Verify-by-Observation — Incident History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Manually-triggered flow checks consumer schedule — dpr_generate_timing incident

Origin: the
  dpr_generate_timing E2E smoke (§10, "E2E SMOKE PAUSED" entry) — a test
  engineer's morning flow was started directly against prod to seed real
  check-in data for the timing measurement, and it worked (the RPC call
  succeeded, `log_date` came back populated) — but that day's 20:00 IST
  `dpr-generate` cron had already fired ~15 minutes earlier and had
  already written `skipped_no_data` for the same project. Completing the
  check-in under that date would have been permanently invisible to every
  future automated run (the consuming route scans only its own
  invocation-time date, no backfill path exists) AND would have made the
  existing `skipped_no_data` row retroactively false. Caught by reading
  the RPC's own returned `log_date` before proceeding, not by anticipating
  the failure mode in advance — this rule exists so the next author checks
  for it up front instead.

## Document audited for nonexistent artifacts — three-instance + collision-subclass evidence

Origin: the SAME failure shape occurred three times in one session
  before being named — (1) 028's file header asserted "DRAFT... NOT
  applied" while the file was already live on prod; (2) a ROADMAP NOTE
  section header was deleted from this file, leaving a back-reference
  elsewhere pointing at nothing; (3) migration 029's own B3 fix comment
  cited "Probe F, review package §7" before Probe F had ever actually been
  written into that section — a citation of something that did not yet
  exist, caught only when a fourth, unrelated defect prompted a full
  cross-reference audit rather than a spot check. All three read as
  verified to anyone skimming; none were caught by the normal review of
  the surrounding prose, because the prose around each was itself correct
  — only the pointed-to artifact was missing. THE COLLISION SUBCLASS, found
  in the same 029 audit: adding a package's own "§0" section silently
  collided with this file's own bare-`§0`-means-CLAUDE.md's-standing-gate
  convention, used 6+ times in that one package alone — not a dangling
  reference (both readings pointed at something real) but the SAME root
  cause, a label whose meaning was assumed rather than checked against
  what else uses it.

## Session notes describe the past — four stale-claims evidence (2026-08-21)

Evidence, not a hypothetical: four stale claims were
  read as current in a single session on 2026-08-21 — PR #59 believed
  open when it had been merged since 08-14; template 1's body quoted from
  a stale copy of the templates doc rather than `main`'s own; DASH-04's
  DPR detail route believed never built when `app/(dashboard)/dprs/[id]/
  page.tsx` already existed; a three-way sync hazard asserted for
  `morning_manpower_planned` that does not apply, because it's a JSONB
  column and the sync system in question is scalar-only. All four were
  caught only by checking against `main` directly — none would have been
  caught by re-reading the claim more carefully, since each read as
  entirely plausible on its own terms. Plausibility is not verification.

## Third-party console is source of truth — Twilio/Meta WABA sender incident

Origin: a same-day
  Twilio/Meta template-compliance audit concluded "the sandbox is still the
  only configured sender" from `docs/twilio-sender-swap-runbook.md`'s own
  "WRITTEN, NOT EXECUTED" status line and the app's env-var wiring — correct
  about what the APP is wired to reach, wrong about what the ACCOUNT
  actually holds. The Twilio console showed a registered production WABA
  sender already live: `+919940875600`, display name "Quoco", status
  Online, WABA ID present — none of that is derivable from this repo, since
  no code path here ever queries Twilio's account-level state, only the two
  env vars the webhook/CTA-display code happens to read (per the runbook's
  own §1). A repo-only check answers "what is this app wired to talk to,"
  never "what does the provider account actually contain" — those are
  different questions and only the provider's own console answers the
  second one.

## Local git ref not current until fetched — two-incident evidence

EVIDENCE, this project's own history, same underlying class (trusting a
  reference without re-verifying it against the live/current source) —
  cited together because this is the SECOND instance in the SAME
  workstream, not a one-off: (1) **the migration-number staleness**,
  `scripts/migration-number-reservations.json`'s own 035 entry: "Originally
  drafted against a stale '034' in the scoping plan -- corrected the same
  day when 034 was taken by the owner-email migration" — 034 itself having
  just been "Renumbered from 030... after a real collision with the
  already-applied 030_morning_flow_attendance.sql." (2) **This rule's own
  origin, 2026-09-02**: asked to prepare a migration-035 lockstep runbook,
  a local `main` pointer sitting at `f3d7b1b` (stale) was compared against
  `worktree-evening-flow-plan-commit` instead of the actual `origin/main`
  (`4e720c1`) — producing a completely wrong picture: "37 commits ahead, 0
  behind" (the true figures, against `origin/main`, were 12 and 2), five
  files reported as touched (`checkpoint-trigger.ts`, `roster.ts`,
  `trigger.ts`, `submit-templates.ts`, plus a "+30 lines") that the branch
  does not touch AT ALL against the real `origin/main` (confirmed: empty
  diff), and a conflict that did not exist. Built on that wrong picture, a
  recommendation was made to merge the 035 branch into `main` FIRST — which
  would have shipped a TypeScript rewrite expecting the NEW 5-step RPC
  against the OLD 6-step one still live in prod, breaking every evening
  check-in from deploy until the SQL landed (the review package's own
  Finding A, a lockstep hazard this exact rule exists to keep visible).
  Caught only because the recommendation contradicted the review package's
  own explicit sequencing, not because the stale comparison announced
  itself.

