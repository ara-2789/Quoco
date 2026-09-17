# External Review Gate — Evidence & Retrospectives

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## External review gate — retroactive catch-up + migration 027 retrospectives

RETROACTIVE CATCH-UP: migrations 024 and 025 both trip (a) and were never
  reviewed externally. A combined catch-up package for both is tracked in
  docs/reviews/024-025-review-package.md (written 2026-08-11) — see that
  file for the retroactive-not-gating framing, since both are already live on
  prod.
  THE GATE PAID FOR ITSELF ON ITS FIRST GENUINELY PRE-STATE OUTING
  (2026-08-13, Aravind's observation, migration 027's external review).
  Every review before 027 (015, 016, 017, 019, 020, 021, 022, 023, the
  024+025 catch-up) reviewed a migration that had ALREADY RUN somewhere —
  test-db at minimum, prod in several cases — so the reviewer's role was
  finding damage already done, or confirming damage hadn't happened yet on
  a database that could still be rolled back. 027 was the first review
  where the SQL had run NOWHERE — not test-db, not prod, not even applied
  to a throwaway branch — when the reviewer read it. His verdict (STOP,
  three blocking findings: a role-blind RLS policy, referential actions
  left to default, cross-tenant reference integrity never asked) cost
  NOTHING to issue and nothing to act on beyond editing a file still sitting
  in `supabase/migrations/`, unapplied. The identical three findings,
  caught retroactively instead — the shape 015 through 025 all shared —
  would have been LIVE DEFECTS on a table already readable by whichever
  accounts happened to hold pm/admin sessions, not lines in a migration
  nobody had run yet. Same reviewer, same findings, same fixes either way —
  the only variable that changed was WHEN in the pipeline the review
  landed, and that variable is the entire argument for gating BEFORE
  apply rather than accepting review as a retroactive habit. Record this
  where the next person deciding whether a migration is "probably fine,
  skip the package this once" will read it.
  THE FULL CYCLE'S OWN COST, RECORDED SEPARATELY (2026-08-13, reviewer's
  closing line, migration 027's round 2 sign-off): stop, revise, verify,
  proceed — the complete pre-apply cycle this migration went through, from
  round 1's STOP verdict through the closed_at question through rehearsal
  — cost three days and zero archaeology. Zero archaeology is the point:
  nothing in this cycle required anyone to later reconstruct what a table
  was supposed to do, why a policy was shaped the way it was, or what a
  prod row's presence did or didn't prove — every question the reviewer
  raised was answered, verified, and recorded in the same review package
  before the next step ran. That is the comparison for the next person
  deciding whether the gate is ceremony: three days of visible, front-
  loaded cost against the alternative this file's own history already
  demonstrates — a live defect on an already-readable table, found later,
  by someone doing archaeology to understand what shipped and why.

