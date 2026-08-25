# QUOCO — Claude Code Instructions
# Read this file at the start of every session before writing any code.
# Last updated: 7 August 2026 — v2.1 (P1 correction pass, process-hardening
# work order — factual corrections only; restructuring is P3, deliberately
# separate)

# This is the CORE file. Detailed reference lives in two linked files —
# read them WHEN the task touches them, not every session:
#   - docs/schema.md     → full database schema, migration order
#   - docs/bot-flows.md  → full WhatsApp flow specs, DPR generation, templates
#   - docs/design-principles.md → UX rules, persona rules, copy tone, visual system
#     Read this when a task touches any user-facing surface: WhatsApp bot
#     copy/flow structure, PM dashboard, or DPR/owner content.
# When a task touches the schema or a bot flow, open the relevant doc first.

---

## 0. HOW WE WORK (read every time)

- ONE feature per session. Never build multiple features in one prompt.
- PLAN FIRST: before writing code, list the files you will touch and the
  approach. Wait for my confirmation before writing.
- Use /clear between every task to keep context clean.
- Commit after every working, tested feature before starting the next.
- If you give me code I do not fully understand, explain it until I do
  before I accept it. I am solo and the only person who will ever debug this.
- If anything I ask CONFLICTS with a rule in this file or the docs, STOP and
  flag the conflict. Do not silently resolve it or pick one side.
- If a fact you need (a model name, a library version, an API shape) might
  have changed since your training, SAY SO and ask me to verify rather than
  guessing. Wrong version strings and API shapes are silent runtime failures.
- ROLLBACK MECHANISMS ARE VERIFIED BY OBSERVATION, NEVER BY CHECKLIST STATUS.
  Before any migration that depends on a backup, PITR, or restore path,
  verify the mechanism exists by directly observing it (dashboard state,
  restore-point UI, or an actual test restore) — never by trusting a "DONE"
  in a checklist. Origin: the 007 apply (2026-07-10), where "PITR provisioned
  — DONE" had been false for weeks and was caught only by direct dashboard
  inspection on apply day. A record of a thing is not the thing.
- ARTIFACT PROVENANCE IS PINNED, NOT PARAPHRASED (standing rule since 2026-07-13,
  per the 016 sign-off round). From migration 017 onward, every reviewer-package
  artifact is pinned to the exact source, never retyped or summarised:
    * file contents via `git show <sha>:path` (the SHA is what gets pasted to
      prod — the terminal frame, commands visible, goes into the PR record);
    * probe captures with the query text visible above its result;
    * suite output with the commit SHA echoed at the top of the run — AND, since
      the 017 round (2026-07-16, reviewer round 2), an empty `git status --porcelain`
      line captured alongside that SHA. Rationale: the SHA alone names the commit but
      not the working tree; a dirty tree can run code that differs from the named SHA.
      SHA echo + empty `--porcelain` together prove the run used exactly the committed
      artifacts. Both lines are part of every future suite capture, not just this one.
  Rationale: paraphrase drifts and GitHub can serve a stale branch cache to the
  reviewer; a pinned `git show`/probe frame is verifiable and cache-proof. The
  canonical apply skeleton lives in docs/migration-runbook-template.md.
- REHEARSE ON A CLEANED EXISTING BRANCH, NOT A FRESH PROVISION — CONDITIONAL RULE
  (2026-07-26, from the 019 round-2 rehearsal; PR #17). A freshly-provisioned
  Supabase branch is NOT a faithful prod clone: its schema is built by REPLAYING the
  migration files linearly from scratch, which (a) omits prod's out-of-band objects
  (see the OUT-OF-BAND DB OBJECTS registry in §10), and (b) was observed to come up
  MISSING `users.auth_id` — two independent fresh branches both lacked the column even
  though `schema_migrations` recorded 007 (which adds it, 007:55-57) as applied.
  MECHANISM UNCONFIRMED — do not assert one: an earlier
  note guessed "`IF NOT EXISTS` degrades to a NOTICE," which is WRONG (`IF NOT EXISTS`
  only skips when the column already exists, so it can't explain a genuinely-absent
  column) and has been retracted. What IS established: standard linear `psql` replay
  DOES add the column (not a 007 logic bug), and it involves a cross-schema FK into
  `auth.users`; the real failure mode is an open question filed with Supabase
  (docs/reviews/supabase-fresh-branch-auth-id-bug.md). Prod never hit it because 007
  was applied out-of-order (after 011-014) via the SQL editor, not a clean linear
  replay. Evidence pinned in
  docs/reviews/019-review-package.md Appendix B2. UNTIL this fresh-branch behaviour is
  re-tested and confirmed FIXED, rehearse migrations by TEARING DOWN and reusing the
  schema-complete test-db, never on a fresh branch. This rule LAPSES once a fresh
  provision is observed to come up WITH `users.auth_id` present — it is a work-around
  for a live defect, not a permanent preference.
- TEST-DB IS NOT CONFIDENTLY REBUILDABLE — RECORDED ALONGSIDE THE RULE ABOVE, SAME
  FAILURE FAMILY (2026-08-20, migration 029's rehearsal round, checked by direct
  observation, not assumed). Three facts, checked live against test-db
  (`exfccwlrhoutkgrlikod`), not inferred from the account's general tier:
    a. `pitr_enabled: false` — `supabase backups list --project-ref
       exfccwlrhoutkgrlikod` returned it explicitly. No continuous restore window
       exists for test-db, unlike prod's.
    b. Branching is not accessible — `supabase branches list` returned a `403`
       ("account does not have the necessary privileges").
    c. What test-db actually has: nightly physical backups only (`walg_enabled:
       true`), most recent observed ~24h old at any given moment — a snapshot, not
       a point-in-time window.
  Combined with the rule immediately above (a from-scratch replay is ALREADY
  documented as coming up missing `users.auth_id`, root cause still unconfirmed),
  the honest statement is: **test-db today has no reliable recovery path** — not
  "restore to just before the mistake" (no PITR), not "clean rebuild" (the known
  fresh-replay defect), only a stale nightly snapshot. Migration 029's own rehearsal
  survived this only because `dprs`/`daily_log_edits` both happened to be empty at
  the time — a real mistake against populated test-db tables would have had no clean
  way back. Recorded as an input to the open test-db reliability workstream, not
  resolved here — this is a statement of current risk, not a fix.
- SUPERSEDING PR CARRIES THE REVIEWER-ITEMS LIST FORWARD, ITEM-BY-ITEM (standing rule
  since 2026-07-26; origin: the 019 round-1→round-3 near-miss where eight
  reviewer-required revisions were briefly treated as non-existent because they lived
  only in the prior review, not the new PR). When a PR supersedes another (a fresh
  branch replacing a stale draft, a re-cut PR, a v2), the OPEN reviewer-items from the
  superseded PR do NOT get a clean slate: migrate them into the new PR's body as an
  EXPLICIT per-item checklist, each marked LANDED (with where it was folded) or
  DEFERRED (with why + where tracked). A superseding PR that silently drops the prior
  review's open items is not allowed — the checklist is the mechanism that makes a
  dropped item impossible to miss. Applies to the review package too: it must state
  which round was reviewed-WITH-CHANGES vs. approved, so "byte-identical to the
  reviewed file" can never be misread as "approved."
- REVIEW REQUESTS AT THIS TIER OPEN WITH A REPO-STATE HEADER (standing rule
  since 2026-08-07, from PR #22's B1 near-miss). A reviewer's context is a
  conversation, not a clone — between rounds the repo moves, and a reviewer
  working from memory or a cached GitHub diff can build an entire blocker on a
  premise that stopped being true days earlier. Origin: B1 flagged
  webhook-wiring PR #22 for a types-regen/merge-ordering hazard that had
  already been resolved and merged via migration 022's own PR; the reviewer
  caught it himself only because a stale GitHub page visibly contradicted
  itself, and explicitly noted his own verification was a weaker evidence
  class than a live catalog probe. From 2026-08-07, every review request at
  019/020/021/022-tier opens with a two-line repo-state header: `main @
  <sha>`; `supabase migration list` local/remote; and the last runbook
  executed, with its date. Costs ten seconds to produce. Converts "reviewer
  assumes state" into "reviewer checks a pinned input" — the header alone
  would have made B1 impossible to write, since it would have shown 022
  already merged and applied before the reviewer needed to derive that from a
  diff.
- PROD APPLIES MAY USE `supabase db query --linked -f <file>`, NOT ONLY THE
  SQL EDITOR (standing rule since 2026-08-11, Aravind's decision, from
  migration 025's apply). Superseded a prior instruction requiring the
  Supabase SQL Editor with the project selector confirmed visually — that
  requirement assumed browser/GUI access exists, which it does not in every
  environment Claude Code runs in. `supabase db query --linked -f <file>` is
  now an accepted apply path PROVIDED all three hold:
    a. the linked project ref is printed and pasted immediately before the
       apply, in the same output — not recalled from earlier in the session;
    b. a pre-apply and post-apply hash of the affected object is captured and
       compared, with the post-apply hash matching an independently
       re-probed rehearsal reference (re-probed live, not read from a log
       line — see the REHEARSE ON A CLEANED EXISTING BRANCH rule above for
       why a stale reference can't be trusted on its own);
    c. Claude Code never issues the apply command without an explicit
       go-ahead from Aravind in the same exchange.
    d. A MIGRATION IS NOT DONE WHEN APPLIED AND LEDGERED — IT IS DONE WHEN
       THE FILE IS ON `main` (added 2026-08-20, migration 029's PR-split
       arc, CC2/AA4). Applying and ledgering a migration on prod is a
       DATABASE fact; the repo staying in sync with that fact is a SEPARATE
       step that does not happen automatically. Origin: migrations 028 and
       029 were both applied to prod and correctly ledgered while their own
       files sat unmerged on a feature branch for an extended stretch — the
       repo on `main` described a database that no longer existed, and 030
       was simultaneously sitting unapplied inside the scanned
       `supabase/migrations/` directory on that same unmerged branch (the
       exact hazard this file's own migration-file-lifecycle rule now
       guards against). Post-apply checklist gains a final item: confirm
       the migration's file has actually merged to `main` — or, if not yet,
       name the open PR that carries it — before considering the apply
       finished. Verify by reading `main` directly (`git show origin/main:
       <path>`), not by trusting a merge button's result or a PR's "open"
       status at a glance.
  Rationale: the SQL Editor rule's real purpose was preventing an apply
  against the wrong database — a pasted project ref plus a hash comparison
  is STRONGER evidence of that than a human glance at a dropdown, which
  leaves no audit trail at all. Condition (c) preserves the one thing the
  SQL Editor was genuinely providing that a hash can't: a human present at
  the moment of change. The SQL Editor remains acceptable; it is no longer
  required.
- `supabase db push` IS NEVER USED AGAINST ANY DATABASE — TEST-DB INCLUDED
  (hard rule, not a preference, since 2026-08-11, from the migration-026
  rehearsal incident). `db push` decides what to apply by diffing the LOCAL
  migration directory against the target's `schema_migrations` LEDGER — and
  this project's history is full of that ledger lagging the actual applied
  schema (001-005 originally; a separate prod-ledger gap for 023/024/025
  recorded elsewhere in this file; and, this incident, test-db). When the
  ledger lags, `db push` cannot tell "already applied, ledger just hasn't
  caught up" from "genuinely never applied" — it re-runs whatever it
  believes is missing regardless. On test-db here, that meant re-running 022
  (`CREATE OR REPLACE FUNCTION apply_evening_flow_turn`) over a body that
  already had 024 AND 025 correctly applied, silently reverting the
  productive/idle inversion fix — the exact bug 025 exists to prevent,
  restored by the tool meant to apply migrations safely. Caught only because
  a body-hash re-probe happened to run for an unrelated reason (a migration
  026 stale-detection mechanism being rehearsed at the time); the CI suite
  (T-024) would have failed on the very next run against test-db, with
  nothing connecting that failure to "someone ran db push" for whoever saw
  it. FIX APPLIED same-session: `025_evening_productivity_reconciliation.sql`
  re-applied directly (`supabase db query --linked -f <path>`), re-probed
  (`body_md5` back to `9bd64d28c9cbf0056c7fd63a83c12d3b`, `body_len` 35150,
  matching the reference recorded at prod's own 025 apply), T-024 confirmed
  31/31 green against test-db afterward. Migrations are applied ONE FILE AT A
  TIME — `supabase db query --linked -f <file>` (per the PROD APPLIES rule
  above) or the SQL Editor — against every database without exception; the
  ledger-lag failure mode above is not specific to prod, so the restriction
  above isn't either anymore.
- NO DATABASE-ALTERING COMMAND IS EVER BACKGROUNDED, AND ANY COMMAND CARRYING
  AN INTERACTIVE CONFIRMATION RUNS IN THE FOREGROUND WITH THE CONFIRMATION
  REPORTED BEFORE PROCEEDING (standing rule since 2026-08-11, same incident).
  The `db push` above ran as a backgrounded, non-interactive process; its own
  `[Y/n]` confirmation prompt was defaulted through by the CLI, with no
  explicit "yes" ever given by a human or relayed by Claude Code on a
  human's behalf. THIS IS THE MORE SERIOUS OF THE TWO FAILURES IN THIS
  INCIDENT, NOT THE LESSER ONE: a command capable of altering a database must
  never also be capable of confirming itself. Backgrounding removes the one
  moment a human — or Claude Code relaying to a human — would otherwise see
  the confirmation prompt and be able to stop it. Applies regardless of which
  database is targeted, including test-db; "it's only test-db" was exactly
  the reasoning that made backgrounding feel low-risk here, and the incident
  above is why that reasoning doesn't hold on its own terms.
- WHY THIS HAPPENED, RECORDED ALONGSIDE THE TWO RULES ABOVE BECAUSE IT IS WHAT
  CREATED THE OPENING FOR THEM TO FIRE (2026-08-11, same incident). A
  stale-detection mechanism for `dprs.generation_status` had correctly been
  brought back as a proposal and confirmed before any code was written — the
  PLAN FIRST rule at the top of this section was followed for that part.
  What wasn't separated out: once building started, writing the migration
  file and REHEARSING it against a real database ran as an undifferentiated
  continuation of "build," not as its own, separately-flagged, higher-risk
  step. Application code and a database-touching rehearsal are not the same
  risk tier and should never be collapsed into one uninterrupted stretch of
  execution — the pause that a separate checkpoint before the rehearsal step
  would have forced is exactly the pause in which the `db push` choice and
  the backgrounding choice would have been visible before either one ran, not
  after.
- EXTERNAL REVIEW GATE — TRIGGER CONDITIONS, DEFINED (standing rule since
  2026-08-11, Aravind's decision). Migrations 024 and 025 — a live RPC gaining
  new steps, then a fix to a real production inversion bug in that same RPC —
  never went to external review. Asked why, the honest answer was that nothing
  DEFINED when the gate applies, so it depended on someone remembering. That is
  the same failure shape as the `db push` incident above, one level up: a rule
  that exists only as something a person has to recall, rather than something
  that fires on its own trigger, will eventually not fire. This entry is that
  trigger, so the next migration's author checks a condition instead of relying
  on memory.
  A migration (or a PR bundling several — if ANY migration in the PR trips a
  trigger, the WHOLE PR needs the package, not a partial review) requires an
  external review package (docs/migration-runbook-template.md's shape) when it:
    a. CREATES OR MODIFIES a live function's LOGIC — what it computes, what it
       writes, who it lets do what. Narrowed to logic deliberately, not "any
       SQL touching a function": a comment or error-message wording change
       touching the same `CREATE OR REPLACE FUNCTION` statement would trip a
       literal "modifies a function" reading, and a trigger that fires on
       genuinely inert changes erodes the same way any over-firing alert does
       — people stop trusting it. TRADEOFF, NAMED AND ACCEPTED, NOT RESOLVED:
       "this change is just cosmetic" is exactly the kind of self-assessment
       an author can talk themselves into wrongly; narrowing to logic trades a
       false-positive risk for a judgment-call risk. Both migrations 024 and
       025 are unambiguous logic changes either way this is read — the
       narrowing doesn't exist to let those two off the hook.
    b. CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING OBJECT —
       grants, RLS policies, SECURITY DEFINER status. THE IMPORTANT ONE OF THE
       FIVE, called out by name: migration 020 — this project's actual
       security incident, seven functions shipped with PostgreSQL's default
       PUBLIC EXECUTE — changed NO function logic at all, only EXECUTE grants.
       Condition (a) alone would not have caught it. A gate that would have
       missed 020 is not a gate; this condition exists specifically because
       020 already proved (a) is not sufficient on its own.
    c. Touches auth or identity.
    d. Is destructive or irreversible.
    e. Moves money.
  "CREATES or modifies," throughout (a) and (b), not "modifies" alone — a
  brand-new SECURITY DEFINER function, or a new table with wrong RLS from day
  one, has no prior safe state to fall back on and is at least as dangerous as
  a bad change to an existing one.
  THE TRIGGER IS SUBJECT MATTER, NOT DDL SHAPE. An "additive" migration — a
  new nullable column, syntactically the safest shape this file's own
  migration-lint rules recognize — still trips (e) if what consumes that
  column moves money, still trips (c) if it feeds an auth path. Whether a
  migration reads as ADD COLUMN or DROP TABLE says nothing about which of
  these five conditions it trips; a large-looking additive migration that
  touches none of them still doesn't need the package, and a one-line change
  that trips (b) does.
  NOT a new concept — a generalization of existing practice. Individual
  migration headers already draw exactly this line ad hoc, per migration:
  023's own header states "RISK CLASS: mostly additive... reversible without
  PITR... the drop is irreversible," and 016 states the same shape for its own
  column drop. This entry turns that already-existing habit into a checkable
  condition instead of leaving it as prose a future author has to reconstruct
  by reading the header's tone.
  NOT required for additive, trivially reversible, feature-class changes that
  trip none of (a)-(e) — e.g. migration 021 (index hygiene) or a migration
  adding one nullable diagnostic column with no function, grant, RLS, auth, or
  money surface touched.
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
- A MANUALLY-TRIGGERED FLOW FEEDING A SCHEDULED CONSUMER CHECKS THE
  CONSUMER'S SCHEDULE FIRST, NOT JUST THE PRODUCER'S READINESS (standing
  rule since 2026-08-12). Before manually starting/seeding anything whose
  OUTPUT a cron or scheduled job will later read (a flow, a backfill, a
  test write), check whether that period's consumer window has already run
  — not only whether the trigger itself is ready to fire. Origin: the
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
- A DOCUMENT SUBMITTED FOR EXTERNAL REVIEW IS AUDITED FOR ASSERTED-BUT-
  NONEXISTENT ARTIFACTS, NOT JUST FACTUAL CORRECTNESS (standing rule since
  2026-08-20, migration 029's external review round). Before any package or
  plan is submitted for external review, audit every internal cross-
  reference against the actual header list, and confirm every cited
  artifact — probe, section, script, output — EXISTS rather than assuming
  it was written. Prefer stable anchors (names, not bare numbers) where the
  format allows, and check any new numbered label against conventions
  already in use elsewhere in the project before adding it — a collision
  reads as correct to a skimming reader exactly like a dangling reference
  does. Origin: the SAME failure shape occurred three times in one session
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
- A GREEN CI CHECK CERTIFIES A SHA, NOT A BRANCH (standing rule since
  2026-08-20, migration 029's PR-split arc, DD3). Before merging, confirm
  the passing run's `headSha` matches the PR's current HEAD — a pass on an
  earlier commit certifies nothing about the one actually being merged.
  Same family as the rest of this arc: verify the artifact, not the label
  attached to it. Origin: a shared CI concurrency group (`ci-test-db-suite`)
  cancels a queued run when a newer one for the same branch arrives —
  rapid pushes to fix small issues one after another produce a run that
  passes for an OLDER commit while the LATEST commit's own run gets
  cancelled underneath it. A merge attempted on "checks are green" without
  checking which SHA they're green FOR would have shipped a commit whose
  own CI result was never actually observed — caught only because the SHA
  was checked before merging, not because the color was.
- SESSION NOTES AND HANDOVER DOCUMENTS DESCRIBE THE PAST; THE REPO DESCRIBES
  THE PRESENT (standing rule since 2026-08-21). Any claim about CURRENT
  state — a PR's open/merged status, a file's actual contents, whether
  something is built — is verified against `main` (or the live database,
  for data claims) before being acted on, never trusted from a chat
  message, a prior session's summary, or an earlier round's own notes,
  no matter how recently or confidently those were written. A written
  record is a snapshot from whenever it was made; only the repo and the
  database are live. Evidence, not a hypothetical: four stale claims were
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
- FOR THIRD-PARTY ACCOUNT STATE, THE PROVIDER CONSOLE IS THE SOURCE OF
  TRUTH — THE REPO DESCRIBES ONLY WHAT THE APP IS CONFIGURED TO REACH
  (standing rule since 2026-08-21, same day as the rule above; companion to
  it, not a restatement). The rule above covers repo/database state; this
  one covers a different, easily-conflated case — an external provider
  account (Twilio, Meta, Vercel, Supabase's own dashboard) can hold real,
  provisioned state that no file or env var in this repo reflects at all,
  because nothing here was ever asked to reach it. Origin: a same-day
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
  second one. Consequence for this project specifically: WhatsApp template
  submission is a WABA-level operation (Twilio Content API / Meta template
  review), independent of which number the app currently sends live traffic
  through — so template submission is unblocked by this finding, even
  though the app-to-sender wiring (the swap runbook) is not.
- FILE SIZE LIMITS (standing rule since 2026-08-22). CLAUDE.md has a
  150,000-character limit. Past it, the TAIL is silently dropped: the file
  still loads, no error is raised, and the most recently added content is
  the first to go. On 2026-08-22 the file reached 167,825 chars and the
  last ~20,000 (11 incident blocks, CLAUDE.md L2259-2517) had been silently
  out of context for an unknown period. Two open findings existed only
  there — rescued into `docs/reviews/2026-08-13-flow-start-mystery.md` and
  `docs/plans/flow-migration-rescoping-plan.md` before this rule was
  written; full audit: `docs/reviews/claude-md-rule-inventory-2026-08-22.md`.
  THRESHOLDS: at 120,000 chars, plan a split. At 140,000, split before
  adding anything further. Standing rules live in §0-§9 and are read every
  time; narrative and incident records belong in `docs/reviews/` or
  `docs/build-status.md`, referenced by a one-line pointer, not carried
  inline. The same applies to any markdown file routinely read into
  context: keep it under 120,000 chars or split it. SELF-ENFORCING, not
  honor-system: `scripts/check-file-sizes.mjs` (via `npm run
  lint:filesize`) prints the real character count for CLAUDE.md and every
  `docs/**/*.md` file on every commit (`.githooks/pre-commit`) and every PR
  (`.github/workflows/ci.yml`'s "File Size Lint" job) — warns at 120,000,
  hard-fails only CLAUDE.md past 140,000. A rule nobody checks is how this
  file reached 167,825 chars in the first place.
- CITE FILE + SECTION, NEVER A BARE "§N" (standing rule since 2026-08-23).
  Since the CLAUDE.md §10 split, two live documents each have their own §9,
  §10, etc. (`design-decisions-beta-feedback.md` and `docs/build-status.md`)
  — a bare "§10" no longer names one place. `lib/whatsapp/dispatch.ts` had
  already mis-cited "design-decisions §11" for §10 before this ambiguity
  even existed (docs/build-status.md's `morning.ts:188` entry), so a bare
  section number was already fragile on its own. Always cite the filename
  with the section, e.g. `design-decisions-beta-feedback.md §10`, never
  just "§10". Full reasoning: docs/build-status.md's 2026-08-23 entry.
- `CREATE OR REPLACE FUNCTION` ONLY PRESERVES GRANTS WHEN THE ARGUMENT
  SIGNATURE IS UNCHANGED — QUALIFIER TO THE EXISTING "NEVER DROP+CREATE,
  ALWAYS CREATE OR REPLACE" CONVENTION (standing rule since 2026-08-23,
  migration 030's first draft). That convention (per-migration headers,
  e.g. `022_evening_flow_apply_turn.sql`'s own text, "never DROP+CREATE --
  migration 020's own incident is why") exists to stop a function's
  EXECUTE grants from silently reverting to Postgres defaults on every
  apply. It is NOT unconditional: a function's identity in Postgres is its
  name PLUS its full parameter TYPE LIST. Appending a parameter to a
  `CREATE OR REPLACE FUNCTION` statement — even a trailing one with a
  `DEFAULT` value — changes that type list, so Postgres does NOT replace
  the existing function; it silently creates a SECOND, DISTINCT, live
  overload under the same name. The OLD function body is never removed,
  keeps whatever grants it already had, and stays fully callable. Any
  caller passing a partial named-argument set that both overloads' defaults
  can satisfy becomes genuinely AMBIGUOUS ("function ... is not unique")
  instead of resolving to either one. THIS IS A DIFFERENT FAILURE IN THE
  SAME FAMILY AS MIGRATION 020, not the same one re-occurring: 020 was an
  explicit DROP+CREATE reverting to default PUBLIC grants; this is
  `CREATE OR REPLACE` itself failing to replace, with no DROP in sight.
  CONSEQUENCE: any migration that changes a `SECURITY DEFINER` function's
  ARGUMENT LIST (adding, removing, or reordering parameters — not just
  editing the body) needs an EXPLICIT plan for the old signature before it
  ships, not a bare `CREATE OR REPLACE`: either (a) avoid the signature
  change entirely, if the new behaviour can be obtained inside the function
  body instead (migration 030's eventual fix — classify inside the RPC
  rather than pass a precomputed flag in, once the reason a precomputed
  pattern existed elsewhere was checked and found not to apply here), or
  (b) an explicit `DROP FUNCTION IF EXISTS <old exact signature>` ahead of
  the `CREATE OR REPLACE`, paired with the function's own explicit
  grant-reassertion (already required by `scripts/lint-migrations.mjs`'s
  no-orphan-security-definer rule) so the DROP never leaves a window with
  default grants. Evidence: migration 030's first draft appended
  `p_yesno_met`/`p_yesno_ok` to `apply_morning_flow_turn`, confirmed live
  against a real Postgres 17 instance to leave two simultaneously-callable
  functions (`pg_proc` returned two rows for one name) — caught by the
  project's own pre-apply dry-run discipline (§7's disposable-dry-run rule)
  before this ever touched test-db or prod. Full incident + the fix
  actually chosen: `docs/reviews/morning-flow-migration-review-package.md`
  §10 (the finding, kept in full) and §10.1 (the fix and its verification).
- A BACKGROUND AGENT SESSION WRITES ON ITS OWN WORKTREE BRANCH, NOT THE
  BRANCH IT WAS ASKED TO WORK ON — VERIFY AND CONSOLIDATE AFTER EVERY SUCH
  SESSION (standing rule since 2026-08-23). This project's own tooling
  isolates a background agent session into `.claude/worktrees/<id>/`, on a
  freshly-created branch, before it makes any commit — a safety mechanism,
  not a bug, so a session's file edits can never land directly on whatever
  branch happened to be checked out in the shared working copy. The
  consequence that matters: work committed inside that worktree is
  INVISIBLE to the branch the session was asked to work on until someone
  explicitly merges or fast-forwards it across, and `.claude/worktrees/` is
  DISPOSABLE — it can be removed without warning, taking any
  not-yet-consolidated commits with it. A session that reports "committed
  and pushed" without naming which branch the commit actually landed on can
  be describing a commit that is about to become unreachable.
  CONSEQUENCE: after any background-agent session that involved commits,
  run `git worktree list` before trusting that the target branch was
  updated — do not infer it from the session's own summary. If work landed
  in a worktree, consolidate it onto the intended branch (fast-forward if
  the worktree branch is a clean descendant, as here; otherwise merge or
  cherry-pick, matching the actual history relationship) and remove the
  worktree and its branch once every commit is confirmed reachable from its
  real destination — do not leave the worktree branch as a second,
  quietly-authoritative copy.
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
- NEVER PIPE UNFAMILIAR COMMAND OUTPUT THROUGH `head`/`cat`/`tail`/`less`
  INTO THE TRANSCRIPT — REDIRECT TO A FILE, THEN READ SELECTIVELY FOR THE
  SPECIFIC THING NEEDED (standing rule since 2026-08-23; REPLACED, not
  widened again, 2026-08-24, after the widened version ALSO failed within
  hours). Two enumerations have now been tried on this rule and both
  failed the same way: v1 named one command (`supabase projects
  api-keys`) — obeyed, and the hazard recurred via `grep -n` on
  `.env.test`, a command not on the list. v2 widened to a category (CLI
  key-listing commands, `cat`/`grep`/`sed`/`head` on `.env*` files, error
  messages, diffs) — ALSO obeyed, and the hazard recurred a THIRD time via
  a route not on THAT list either: `supabase db dump --linked --dry-run`
  (a legitimate, previously-used command for this project's own dry-run
  scaffold discipline, §7) prints its generated `pg_dump` script to
  stdout, and that script embeds a live `PGPASSWORD` — piping it through
  `head -30` to see the invocation printed the password into the
  transcript. See EVIDENCE below for all three, dated precisely.

  THE ACTUAL MISTAKE, NAMED ONCE PROPERLY THIS TIME: in all three
  instances, the mistake was never "ran a command already known to be
  dangerous" — every one of the three commands was doing something
  legitimate and non-obviously risky at the time it was run. The mistake
  was piping output whose CONTENTS WERE NOT KNOWN IN ADVANCE straight
  through `head`/`cat`/`tail`/`less` (or an unfiltered file Read) into the
  transcript, to "see what's there." That is the actual failure
  condition, and it holds regardless of which command produces the
  surprise next — a list of dangerous commands can always be one item
  short; a rule about NOT INSPECTING UNKNOWN OUTPUT WHOLESALE has no next
  item to miss.

  THE PROCEDURE, LED WITH, NOT A LIST: before running `| head`, `| cat`,
  `| tail`, `| less`, or reading a file straight into view, ask — do I
  already know every line of this output is safe? If the answer is
  anything but a confident yes (a CLI's own generated script, a config
  dump, `env`, any tool's dry-run/debug output not already known to be
  credential-free) — redirect it to a file (`> /tmp/...`) FIRST, then
  extract ONLY the specific thing actually needed: a targeted `grep`
  (name-only where relevant, e.g. `grep -o '^[A-Z_]*='`), a narrow line
  range, a single field. Never dump the whole thing into the transcript
  "to look." Delete the file once the file itself is no longer needed if
  it turned out to hold a real credential.

  THE ORIGINAL PROHIBITIONS STILL HOLD, kept here as recognizable examples
  of the failure pattern above — useful for spotting a likely offender on
  sight, but supporting detail now, not the mechanism that prevents the
  next one:
    * a CLI command whose job is enumerating credentials (`supabase
      projects api-keys`, with or without `--reveal`, and anything shaped
      like it);
    * `cat`, `grep`, `sed`, `head`, or any other command that prints the
      contents — or a matched line's contents — of `.env*` or any other
      file holding real values (a NAME-only match, e.g. `grep -o
      '^[A-Z_]*='`, is fine; a match that includes `=<value>` is not);
    * an error message, stack trace, or debug log that happens to include a
      credential;
    * a diff, patch, or file read that shows a secret's actual value;
    * a CLI's own generated script or dry-run output that embeds
      connection credentials to do its job (added 2026-08-24, instance 3
      below — `supabase db dump --dry-run`'s script is the concrete case,
      but the shape generalises: any command whose PURPOSE is unrelated to
      credentials can still embed one in its output incidentally).
  To confirm a credential value EXISTS without printing it: test for
  presence, don't print — e.g. `[ -n "$VAR" ] && echo set` (bash), or a
  bare `grep -o '^VARNAME='` against an env file (matches the key, not the
  value after `=`). To identify WHICH project/database a session is about
  to act against — the actual need all three incidents below arose from —
  use a SQL probe (`supabase db query --linked -f <file>` running
  something like `SELECT current_database(), now();`) plus the linked
  project ref itself (`cat supabase/.temp/project-ref` — a public path
  component of the project's URL, not a secret). A SQL query's RESULT is
  safe to print by construction; a command or file-read whose output is,
  or contains, credential material is not — no matter how it's invoked,
  and no matter whether that command is on any list. **This applies with
  far more force to production (`jvxwqignooseazzmwhvl`) than to test-db**
  — the same keystroke, an entirely different consequence: a prod
  `service_role` key or `PGPASSWORD` in a transcript is a live,
  RLS-bypassing credential over real tenant data, not a disposable
  test-db key.
  EVIDENCE, ALL THREE, DATED PRECISELY — the enumeration approach has now
  failed twice in a row, evidence enough that a third enumeration is not
  the fix (`docs/build-status.md`'s 2026-08-23 and 2026-08-24 entries):
  (1) **2026-08-23.** `supabase projects api-keys --project-ref
  exfccwlrhoutkgrlikod` printed test-db's anon, service_role, and secret
  keys into the transcript while establishing a project-identity
  breadcrumb, in a session that had already switched to the safe
  SQL-probe pattern for every OTHER breadcrumb that same session.
  (2) **2026-08-23, same session, within the hour of (1).** Immediately
  after recording that incident and writing this rule's first (v1,
  command-specific) version, a `grep -n` against `.env.test` — checking
  which variables needed updating once key rotation happens — printed the
  full contents of every matched line, values included, a second time.
  (3) **2026-08-24**, after this rule had already been WIDENED to v2 (the
  category version, written in direct response to (1) and (2)) and that
  version was the one in effect. `supabase db dump --linked --schema
  public --dry-run`, run to build a disposable local-scaffold proof for
  migration 030's transaction-wrapper fix (per §7's own dry-run
  discipline), piped through `head -30` to inspect the generated
  `pg_dump` invocation — the script's own `export PGPASSWORD=...` line
  printed a live test-db connection password into the transcript.
  Contained: the file was deleted immediately, the dump was regenerated
  with direct redirection to a file and never printed again. Full record:
  `docs/build-status.md`'s 2026-08-24 entry.
  Neither of the first two incidents repeated the other's exact command,
  and the third repeated neither — three distinct commands, two rule
  versions, both obeyed exactly as written, the underlying hazard
  recurring anyway each time, because each version named instances of the
  class instead of the class's actual shape. This version doesn't
  enumerate; it names the shape — unfamiliar output, piped raw into
  view — so the next surprising command is already covered, not waiting
  to become instance four.
- CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY — A LOCAL PASS IS NOT
  EVIDENCE FOR THESE (standing rule since 2026-08-24, full record:
  `docs/reviews/sandbox-cannot-test-concurrency.md`). This Claude Code
  sandbox cannot sustain two genuinely concurrent RPC calls against test-db
  — proven directly, not inferred: a `SELECT ... FOR UPDATE NOWAIT` probe
  correctly detected a held row lock via raw dual-session SQL, but the
  SAME probe, called via the JS client while another RPC call held that
  lock, never observed it — every attempt reported unlocked, because by
  the time each probe request reached Postgres, the other call had already
  finished. The decisive test: a THIRD call to an already-proven-working
  RPC, targeting a COMPLETELY DIFFERENT, non-contended row (zero possible
  data-level conflict), STILL didn't resolve until the first call's entire
  round-trip completed — ruling out row locking, this project's SQL, and
  the specific function involved as the cause. Plain REST table reads
  (no RPC) run genuinely concurrently in this same sandbox — the
  serialization is specific to concurrent RPC/function calls against
  test-db, not a blanket claim about all concurrent access.
  CONSEQUENCE: any test whose assertion depends on caller 2 genuinely
  running WHILE caller 1 holds something (a lock, a queue slot, any
  contended resource) passes TRIVIALLY in this sandbox regardless of
  whether the underlying mechanism works — caller 2 physically cannot be
  dispatched until caller 1's own call has already returned, so "caller 2
  observed X after caller 1" is guaranteed true either way. A local green
  run for this CLASS of test proves NOTHING about the behavior under test
  and must be reported as such — "not verified locally, CI-only" — never
  as "passed" or "verified." Do not claim local verification for
  concurrency/lock/race tests going forward; if CI is the only environment
  that can exercise the real condition, say so plainly rather than
  reporting a local pass as evidence. Origin: `acquire_and_transition_
  session` (migrations 012/013) exists specifically to serialize
  concurrent callers on one phone number — BOT-21's queueing depends on
  it, and Pass 1's cron (once the #69/031 outbound-send primitive ships,
  CLAUDE.md §3) will exercise this exact path twice daily, at scale. CI
  is the only environment that has ever genuinely tested it; a session
  discovered this only while root-causing `test/session-transition.
  test.ts` Test B's own lock-wait incident (docs/reviews/session-
  transition-lock-wait-flake.md) — an earlier "30/30 clean, zero
  negatives" local capture in that same incident is retracted as evidence
  on these grounds, though it does not change what CI itself already
  showed (three independent real failures).

---

## 1. WHAT IS QUOCO

Multi-tenant SaaS for construction contractors in India. Each subscribing
company is a TENANT.

Two modules — build POST-CONTRACT first:

PRE-CONTRACT (Phase 2 — DO NOT build now): Tender Analyser, BOQ Estimator.

POST-CONTRACT — Phase 1 Spine (build this):
- WhatsApp bot: site engineers submit morning + evening check-ins.
- Claude API generates a Daily Progress Report (DPR) sent to PM + Owner nightly.
- PM web dashboard: projects, daily logs view, DPR archive.

---

## 2. SPINE vs FAST-FOLLOW

Build SPINE first. Fast-Follow ships live to the same betas after Spine launch.
When Claude Code asks what to build, answer from the SPINE list ONLY.

SPINE — build and ship:
- Auth, onboarding, engineer + owner registration
- Morning check-in (6 Q), evening check-in (6 Q)
- DPR generation (6 sections — see docs/bot-flows.md)
- PM dashboard: Daily Logs view, DPR Archive
- Scheduling, cron, jobs queue, RLS, E.164, Sentry, PITR — **"cron" here
  presumes an outbound send capability this codebase does not have yet; read
  the STANDING ARCHITECTURAL FACT under §3's WhatsApp line before sizing this
  item, not after starting it**
- Razorpay payment links

FAST-FOLLOW — fully specified, DO NOT build yet:
- Ad-hoc safety / invoice / hindrance flows
- DPR accountability engine (dependency roll-forward, escalation, resolve path)
- DASH-05 invoice queue, DASH-06 safety log, DASH-07 hindrance tracker,
  DASH-10 accountability view
- BOT-30 Q6→hindrance promotion
- resolutions table + source_key

The Fast-Follow TABLES exist in the schema (so migrations are stable), but
their FLOWS and dashboard views are not built in the Spine.

---

## 3. TECH STACK

- Framework: Next.js App Router + TypeScript — App Router conventions only.
  VERIFY the exact Next.js version in package.json; do not assume.
- Database: Supabase (PostgreSQL) — auth, DB, storage, pgvector (enabled, nullable)
- Auth: Supabase Auth — magic link only, no passwords, PKCE via @supabase/ssr
- Storage: Supabase Storage — site photos only in Spine
- AI: Claude API — DPR generation.
  MODEL STRING: verify the current model string against
  platform.claude.com/docs before Week 4 — model IDs change and a wrong
  string is a silent runtime failure. Do not trust a string carried over
  from an earlier session without checking.
- WhatsApp: Twilio WhatsApp Business API — webhook at /api/whatsapp/webhook
  STANDING ARCHITECTURAL FACT (2026-08-20, II2, HH1 assessment): NO TWILIO SDK
  IS IMPORTED ANYWHERE IN THIS CODEBASE — confirmed by grep, zero
  `require('twilio')`/`from 'twilio'` hits outside comments. Every outbound
  message this system has ever sent is inline TwiML constructed inside the
  webhook's own HTTP response (`app/api/whatsapp/webhook/route.ts`'s
  `twimlMessage`/`twimlEmpty`). **THIS SYSTEM CAN ONLY REPLY. IT CANNOT
  INITIATE.** No code path anywhere can send a WhatsApp message except as the
  synchronous response to an inbound one. This changes how two roadmap items
  must be sized, not just described:
    * Inbound-as-start-trigger (the shortest path to a real beta, per HH1)
      works INSIDE this architecture unchanged — a start-trigger reply is
      still a reply, triggered by an inbound message, answered the same way
      every other reply already is. No new capability needed. **BUILT
      2026-08-20 (`lib/whatsapp/inbound-start.ts`), and, per PP2
      (design-decisions-beta-feedback.md §27, same day): SCAFFOLDING, not
      the permanent design.** The permanent design is cron-triggered
      check-ins, inbound message never starts a flow — this build exists
      only because, until the item below ships, there is no cron capable of
      starting one at all. Read §27 before sizing any future work in this
      area as "the inbound path already covers it."
    * THE TRIGGER CRON IS NOT "ADD A CRON JOB." A cron can decide WHEN to
      send something; it cannot MAKE a send happen, because nothing in this
      codebase can construct an outbound WhatsApp message outside a webhook
      response. The missing piece is a genuine OUTBOUND SEND CAPABILITY — the
      #69/031 outbound-send primitive — a Twilio client construction, API
      credentials wired for real calls, delivery-status handling, the whole
      surface this codebase has never built. Reading "scheduling, cron, jobs
      queue" in §2's SPINE list without this fact will mis-size that work by
      an order of magnitude: the scheduler is the easy 10%; the send
      primitive underneath it is the other 90%, and does not exist yet in
      any form. **Per PP2, this is now not merely "the precondition" in the
      abstract — it is the head of the build sequence: the system's
      CORRECT behaviour (cron-triggered check-ins) cannot exist until this
      ships, and every other Fast-Follow/Spine sequencing question sits
      downstream of it.**
- Billing: Razorpay payment links — NOT Stripe (Stripe paused India onboarding)
- Deployment: Vercel Pro — required for 6 IST cron times + 60s function timeout
- Email: Resend — DPR delivery to owner
- Monitoring: Sentry — wire Week 2 Day 1, all environments
- UI: Tailwind CSS + shadcn/ui — VERIFY Tailwind major version in the repo
  DATED NOTE (2026-07-16, per the DASH-03 token proposal): shadcn/ui is NOT yet
  initialized (no components.json). Adopt it when a component needs its
  accessibility primitives (dialogs, dropdowns, comboboxes) — status chips/tokens
  don't require it. Tailwind is v4 (^4.3.1): CSS-first config via @theme in
  app/globals.css, no tailwind.config.js.

---

## 4. MULTI-TENANCY — CRITICAL, NON-NEGOTIABLE

- Every table has a tenant_id UUID column, EXCEPT rate_catalog and
  rate_catalog_history (Quoco-owned, shared across tenants).
- NEVER query the DB without filtering by tenant_id.
- Use tenant_id — NOT organization_id, org_id, or company_id.
- RLS enforced at the DB layer via get_user_tenant_id() (see docs/schema.md).
  Never rely on app-layer filtering alone.
- Use the Supabase SSR client in server components + API routes.
  NEVER the browser client on the server.
- NEVER use the service role key client-side, or in any route reachable
  without authentication.
- All RLS policies verify tenant membership through auth.uid().
- Cross-project scope: DASH views and DPR delivery are scoped to projects
  where the PM has a project_members row — NOT all tenant projects.
  Owner DPR content is strictly single-project scoped.

---

## 5. USER ROLES

Six roles, TEXT on users table:
CHECK (role IN ('pm','qs','engineer','owner','subcontractor','admin'))

- The role was named 'client' in early schema. Canonical name is 'owner'.
  Use 'owner' everywhere. Already true today — the CHECK constraint above
  is live. CORRECTED (2026-08-07, P1 pass): this previously said the rename
  "lands in migration 007." Wrong migration — 007's own header explicitly
  EVICTS it ("client -> owner role rename -> corrections migration") so a
  bug in a rename could never force rollback pressure on 007's irreversible
  auth-identity surgery. The rename actually lands in migration 016
  (016_corrections.sql — the corrections migration 007 evicted it to):
  drops the 001-era CHECK, `UPDATE ... SET role = 'owner' WHERE role =
  'client'`, adds the current CHECK. Applied on both test-db and prod
  (confirmed via `supabase migration list --linked`: 016 present on both
  local and remote). No sequencing risk to carry forward — role='owner' is
  a valid CHECK value now, not a future one.
- admin — tenant creation, invites, billing, settings
- pm    — projects, DPR review, engineer management
- qs    — invoice review, BOQ (Phase 2)
- engineer — WhatsApp bot user only. NO web login. auth_id = null.
- owner    — receives DPR via WhatsApp + email. No web login in Phase 1.
             auth_id = null.
- subcontractor — Phase 2

Engineer and owner rows have auth_id = null. Created by PMs, not via the
email-invite auth flow. Do NOT create auth.users entries for them.

---

## 6. CODING RULES

TypeScript
- Always TypeScript. No `any` under any circumstances.
- Generate DB types from the schema — do not hand-write them.
  DATED NOTE (2026-07-13, per 016 round-3 review) — SUPERSEDED 2026-07-13 by the
  generated-types PR (feat/generated-db-types), see the ACTIVE note below. The
  original note recorded the interim state: the pipeline did NOT yet exist,
  clients were untyped, no `types/database.ts` existed, and adoption was DEFERRED
  to the named milestone (a dedicated PR after 016 merges, before Morning Flow
  Pass 2 merges).
  DATED NOTE — ACTIVE (2026-07-13, feat/generated-db-types PR): the generated-types
  pipeline is now STOOD UP. `types/database.ts` exists, generated via
  `npx supabase gen types typescript --linked --schema public` against prod
  (`jvxwqignooseazzmwhvl`; prod and test-db are schema-identical post-016). The
  three Supabase clients (`client.ts`, `server.ts`, `service.ts`) now carry the
  `<Database>` generic. Call sites are migrated INCREMENTALLY: existing inline
  `.single<{...}>()` generics remain valid and stay until touched — the client
  generic is additive. The standing runbook-template line **"regenerate types
  after every schema migration"** is now ACTIVE (no longer inert): from this PR
  on, every schema migration re-runs the gen command and commits the diff.

Money
- Every amount/rate/cost/value column: DECIMAL(12,2). No exceptions.
- Never TEXT or FLOAT for money. invoices.amount is (12,2), not (10,2).

Status columns
- Always TEXT + CHECK constraint. Never ENUM types.
- Adding a status value later = update the CHECK only.

Database
- Migrations in supabase/migrations/ as numbered files. EVERY numbered file
  currently present in that directory is LIVE — do not edit any of them.
  Author new changes as the next UNUSED number; confirm the true next number
  with `ls supabase/migrations/` and `supabase migration list` (don't trust
  a number carried over from an earlier session — CORRECTED 2026-08-07, P1
  pass: this used to hardcode "001–006 live, new changes go in 007/008/009,"
  which was accurate in July but by design goes stale the moment migrations
  pass 009 — migrations are now through 022, with a gap at 008-010 that were
  never created. A number-listing rule can't go stale the same way; a
  hardcoded range can and did).
- Never edit schema directly in the Supabase dashboard.
- Every table: id UUID PK DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now().
- Full schema + migration order: docs/schema.md.
- A ONE-TIME MIGRATION STATEMENT TARGETING SPECIFIC EXISTING ROWS IS PINNED
  OR GENERAL BASED ON WHETHER IT'S DESTRUCTIVE — ONE RULE, TWO CASES
  (standing rule since 2026-08-20, migration 029's external review, P3;
  Aravind's decision after reviewing B3's shape). The two cases:
    * DESTRUCTIVE statements (DELETE, DROP, any irreversible write) ENUMERATE
      — extensionally pinned to the specific known id(s), never a general
      `WHERE`. A stale pin fails toward DATA LOSS if reality has drifted
      since the migration was written, which is the safer failure direction
      for something that can't be undone without PITR. Precedent: 023's
      `35a2f41c` DELETE. Concrete case where the pin itself had to move:
      028's own DELETE was pinned to one id, then had to be WIDENED when a
      second marker row (`3c14243f`) appeared before apply — re-pinned
      immediately pre-apply, not left as the original single-id list (full
      record: `docs/reviews/028-dpr-engineer-report-review-package.md`
      §21.6; `028_dprs_engineer_id_option_a.sql:211`). The pin is re-derived
      at apply time, every time — it is not a write-once artifact.
    * ADDITIVE IDEMPOTENT statements (INSERT-only backfills, anything that
      can only add rows, never remove or overwrite) take a GENERAL
      predicate, an in-transaction structural assertion (a `DO $$ ... RAISE
      EXCEPTION` block, not a comment), and a pre-apply probe pinning the
      EXPECTED extension of that predicate. The failure geometry inverts
      here: a pinned id under drift SILENTLY SKIPS the very row the
      backfill exists to protect (the opposite failure direction from the
      destructive case — omission, not overwrite), while a general
      predicate absorbs the drift and the in-transaction assertion converts
      any residual surprise into a full-transaction abort instead of a
      silent gap. Precedent: migration 029's `dpr_versions` backfill
      (`docs/reviews/029-dpr-versioning-review-package.md` §12, B3).
      EXTENSIONALITY IS NOT ABANDONED IN THIS CASE, IT MOVES: a human still
      confirms the expected extension immediately pre-apply, via a named
      probe with an explicit PROCEED/STOP condition (029's Probe F) — the
      pin lives in the apply-time CHECK, not in the `WHERE` clause itself.
  Both cases are extensional at apply time; only WHERE the pin lives differs,
  and that difference tracks which direction a stale pin fails toward.
- EVERY NEW FUNCTION IN THE public SCHEMA REQUIRES AN EXPLICIT PER-ROLE
  REVOKE — `REVOKE ALL ... FROM PUBLIC` IS NOT SUFFICIENT (standing rule
  since 2026-08-20, migration 029's first prod apply, U1-U4; recurrence of a
  gap migration 020 already found once). Supabase's own `pg_default_acl`
  grants EXECUTE on every new `public`-schema function to `anon`,
  `authenticated`, AND `service_role` INDIVIDUALLY, per-role — not through
  the `PUBLIC` pseudo-role. `REVOKE ... FROM PUBLIC` only removes a grant
  made TO PUBLIC; it does nothing to these per-role default grants. State
  the intended callers explicitly and REVOKE BY NAME from every role that is
  not one of them — do not rely on a bare `FROM PUBLIC` to be enough.
  Same principle for new TABLES: state the audience and bound the grants
  explicitly rather than relying on RLS alone to compensate for an
  over-broad table-level grant (RLS and the grant are two independent
  layers — a correct RLS policy does not make an unnecessary anon grant
  harmless, it just means nothing has exploited it yet).
    Origin: migration 020 (2026-07-25) found and fixed this EXACT behaviour
  for seven pre-existing functions, explicitly naming `anon` as a separate
  revoke target in its own text (`020_function_execute_hardening.sql:94`:
  `REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC,
  anon;`). That fix was never generalised into a standing rule for functions
  created AFTERWARD — a point fix, not a rule — so the first new SECURITY
  DEFINER function to ship since 020 (`write_dpr_version`, migration 029)
  silently reintroduced the identical hole: `anon` held live EXECUTE on a
  function whose one caller-trusting branch (`p_generated_by='system'`)
  keys its only guard on `auth.uid() IS NOT NULL` — and an anon PostgREST
  call carries no JWT, so it satisfies that guard exactly like the
  legitimate `service_role` caller does. The anon key is public by design
  (ships in client code), so this was a live, internet-facing exposure on
  production, caught only by the post-apply ACL fingerprint below, not by
  anything earlier in the pipeline — the dry-run scaffold has no Supabase
  default ACLs to reproduce this, the test-db rehearsal never tested an
  anon caller, and §12-style behavioural evidence authenticated as real
  users throughout, never as anon. Full incident record:
  `docs/reviews/029-dpr-versioning-review-package.md`'s U1-U5 section.
    VERIFICATION, now standing: the post-apply catalog readback for any
  migration creating a new function or table must fingerprint the ACL of
  every new object, not just its definition (constraints, policy text,
  prosrc) — an object can be functionally correct and still carry a grant
  nobody intended. Prefer proving a revoke worked two ways, not one: read
  the ACL back (`has_function_privilege`/`has_table_privilege`), AND — for
  anything reachable via PostgREST — make a real anon-key call and confirm
  the actual refusal (`42501`), not just its absence from the catalog.
    STANDARD EVIDENCE SHAPE, MADE PROACTIVE, NOT ONLY REACTIVE: an anon-key
  call is not just how you verify a revoke you already suspect is needed —
  it is now a REQUIRED line in every future `SECURITY DEFINER` function's
  own review package, run by default alongside the authenticated/pm/qs
  behavioural tests §12-style packages already run, whether or not anyone
  suspects a gap. This function's own review package ran exactly that shape
  of test (authenticated, qs, pm, member/non-member) and never once called
  as `anon` — that absence is precisely why this sailed through every prior
  check and was only caught by the POST-APPLY catalog readback, on
  production, after the fact. Testing anon proactively, pre-apply, moves
  this same class of finding to where 027's own external-review-round-1
  findings landed: cheap, pre-apply, in a file nobody had run yet — not a
  live production exposure discovered after the fact.
- A MIGRATION FILE ENTERS supabase/migrations/ WHEN IT IS BEING APPLIED, NOT
  WHEN IT IS WRITTEN (standing rule since 2026-08-20, migration 030's BB2
  relocation). Until an apply is actually happening, a written migration
  lives in `docs/reviews/`, alongside its review package — not in
  `supabase/migrations/`, the directory every apply/rehearsal tool scans.
  Holding an unapplied file off `main` is not sufficient on its own: a file
  sitting unapplied, on no ledger row, in the scanned directory is a live
  hazard on ANY branch that has it checked out, whether or not that branch
  has reached `main` — a stray `supabase db push` on that branch applies it
  regardless. Origin: migration 028's own file genuinely followed this
  pattern already (moved into `supabase/migrations/` at apply time, not
  before) without it ever being written down as a rule — 030 sat in the
  scanned directory, unapplied, for the length of an entire review-and-hold
  cycle before this was named and fixed. Move a migration INTO
  `supabase/migrations/` as part of the same commit/session that applies
  it, never earlier — matches the CANDIDATE CI CHECK entry's own spirit
  (catch a class of hazard at write time, not after it's rediscovered).

API routes
- All /api/ routes require authentication.
- Validate ALL inputs with Zod before processing.
- WhatsApp webhook responds within 15 seconds.
- ALL Claude API calls go through the jobs table — NEVER called synchronously
  in the webhook handler (NFR-16). Queue detail: docs/bot-flows.md.

Webhook specifics (bot-flows.md has the full rules)
- Validate X-Twilio-Signature HMAC on every request; reject non-matching (403).
- Idempotency: dedupe on Twilio message SID. A repeated SID is a no-op —
  no duplicate rows, no duplicate replies.
- Media: download from Twilio, re-upload to Supabase Storage (tenant-scoped),
  store the SUPABASE url. NEVER persist a Twilio media URL — they expire.

Secrets
- NEVER hardcode a secret, key, token, or connection string in source.
- NEVER console.log a key, token, or full auth header — even while debugging.
- NEVER commit .env.local. Secrets come from env vars only (see Section 8).

Errors
- Wrap external calls in try/catch. Return structured errors — never expose
  raw DB errors to the client. Log to Sentry in production.

Session state
- WhatsApp state lives in whatsapp_sessions — NEVER in memory. Serverless
  functions have no persistent memory; all state is in the DB.
- SELECT FOR UPDATE on the session row before any state change.
- TTL + resume rules: docs/bot-flows.md (BOT-07).

---

## 7. TESTING & VERIFICATION — how "done" is defined

A feature is NOT done until it is verified. For a solo build, this section
is the safety net that replaces a second developer. Follow it every task.

Definition of done (per task)
- Code written AND its tests written AND tests green AND committed.
- No `any`, zero TypeScript errors (`tsc --noEmit` clean).

Tests are required, not optional
- State-machine change → ships with its T-SM unit tests.
- Parser change → ships with its T-PR tests.
- Webhook change → ships with the relevant T-WH integration test
  (including the forged-signature rejection, T-WH-01).
- DPR generation → the eval harness (docs/bot-flows.md) is a REQUIRED
  deliverable, not a nice-to-have. Golden-set cases must pass before DPR
  work is considered done.
- RLS change → a cross-tenant AND cross-project isolation test
  (two-tenant fixture; PM sees only their projects; owner DPR single-project).
- State-loss regression (a fix for data silently dropped/overwritten) → assert
  the END STATE of the full realistic sequence, not the mechanism the fix
  targeted. A test asserting the predicted mechanism goes green the moment
  that one fix lands and hides sibling defects upstream of it — origin:
  migration 022's reverse-order test, which drove the full realistic sequence
  (evening completes → morning starts → morning completes) and caught a
  second, unnamed instance of the bug a mechanism-targeted test would have
  missed (docs/reviews/022-review-package.md).

EVERY NEW MIGRATION GETS A DISPOSABLE DRY-RUN BEFORE IT ENTERS A REVIEW PACKAGE
(standing rule since 2026-08-20, migration 029's rehearsal round; AMENDED
same day, G1, before the rule finished hardening). Origin: 029, 030, and 031
were written, packaged, and declared review-ready in the same session, by
the same process, and none of them had ever been executed against a real
Postgres. 029 turned out to have a real ordering defect (an inline FK
referencing a parent unique constraint the file didn't create until 15 lines
later — Postgres 42830) that a careful read — including a correct, thorough
§0 security/atomicity read that had no reason to catch this class of bug —
did not surface, and that only running the file against Postgres did. The
systemic finding was never the ordering bug itself; it was that a review
package whose SQL has never been past a parser is a proposal, not a package.

THE SCAFFOLD MUST COME FROM THE REAL SCHEMA, NOT BE HAND-BUILT (G1
correction — the first version of this rule was circular). A scaffold typed
by hand from "the tables/columns/functions the new file references" can only
ever agree with the file being tested, since both come from the same
person's belief about the schema — it catches intra-file ordering defects
(real value; that is the class that bit 029) but CANNOT catch a migration
referencing a column, table, constraint, or function that does not actually
exist, because a hand-built scaffold will simply include whatever the
migration expects. Build the scaffold from a real structural dump instead:

    supabase db dump --linked --schema public --dry-run -f /tmp/schema.sql

`--dry-run` prints the exact `pg_dump` invocation (env vars, flags, the sed
pipeline that strips platform-managed noise) without requiring Docker — copy
that script and run it directly if a local `pg_dump` is available and no
Docker is (this project's own environment had no Docker when this rule was
written; a Homebrew Postgres install provided a matching `pg_dump`). Load the
result into a disposable local Postgres, then run the candidate migration
against it. Same cost as the hand-built version, no circularity: this
upgrades the check from "does this file agree with itself" to "does this
file agree with the database."

NAMED STUBS — what this check still cannot see, stated so a future reader
knows the limit rather than assuming full coverage. A structure-only dump of
`public` does not include Supabase-managed internal schemas. Two things must
be stubbed by hand, every time, and named as stubs, not silently patched in:
  - `auth` schema — a bare `auth.users(id uuid primary key)` table and an
    `auth.uid() RETURNS uuid` function returning `NULL`, since RLS policies
    and `SECURITY DEFINER` functions in `public` reference both.
  - Roles — `postgres`, `anon`, `authenticated`, `service_role`, and
    `supabase_auth_admin` must exist in the local cluster before the dump
    loads (the dump's own `OWNER TO`/`GRANT`/`REVOKE` statements reference
    them by name).
Anything genuinely platform-specific beyond these two — a Postgres
extension the dump doesn't include `CREATE EXTENSION` for (pgvector did
not appear in the dump and had to be created by hand before loading, once,
per fresh instance), an `auth.*` function beyond `uid()` a future migration
calls, a different internal schema a future migration touches — is NOT
covered by this check and must be added to the stub list explicitly when it
comes up, not silently assumed away.

POSTGRES VERSION MUST MATCH THE SERVER (G2 — checked, not presumed; the
local tool was PG16 on first use, while both prod and test-db run PG17.6,
confirmed live via `SELECT version()` on both — a version this rule now
pins so the next installer gets it right without re-deriving it). Install
the same MAJOR version locally (`brew install postgresql@17` on macOS,
or equivalent) — a mismatch lets the dry-run pass on syntax the real
server would reject. Re-check `SELECT version()` against prod/test-db
whenever this rule is next relied on, since a platform upgrade would move
the target without updating this line.

This is NOT the test-db rehearsal and does not substitute for it (§0's own
rehearsal rules, and the REHEARSE ON A CLEANED EXISTING BRANCH rule above,
are unchanged and still required before any real apply) — it is a cheaper,
earlier gate that catches parse/ordering/executability/missing-object
defects before the external reviewer's attention is spent on whether SQL
runs at all, rather than on the design it encodes. Touches no real
environment; no §0 gate implication of its own. A rule that overstates its
own coverage is worse than no rule — this one covers intra-file ordering
AND schema-agreement (real dump), but not the two named stub gaps above,
and that limit is part of the rule, not an implementation detail to forget.

How to verify locally (ask me to run these; show me the command)
- DB change: run migrations against a Supabase BRANCH first, never prod.
  Confirm no errors, then I review before it touches the real database.
- Any change: `tsc --noEmit` clean + `npm test` green for the touched area.
- Bot flow: exercise it end-to-end against the Twilio SANDBOX on a real
  handset before calling it done. (Sandbox cannot send custom templates —
  template + cron tests wait for the production sender.)

If you cannot write a test for something, say so and explain why, so I can
decide whether to accept it. Do not quietly skip the test.

---

## 8. ENVIRONMENT VARIABLES

In .env.local — NEVER commit. NEXT_PUBLIC_ prefix ONLY for browser-safe values.

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       ← server-side only, never expose to client
ANTHROPIC_API_KEY=               ← server-side only
TWILIO_ACCOUNT_SID=              ← server-side only
TWILIO_AUTH_TOKEN=               ← server-side only
TWILIO_WHATSAPP_NUMBER=          ← e.g. whatsapp:+14155238886
RESEND_API_KEY=                  ← server-side only
RAZORPAY_KEY_ID=                 ← server-side only
RAZORPAY_KEY_SECRET=             ← server-side only
SENTRY_DSN=
NEXT_PUBLIC_APP_URL=             ← magic link redirect URL
CRON_SECRET=                     ← server-side only, secures /api/jobs/tick
                                    and /api/cron/dpr-generate — see below

All non-NEXT_PUBLIC_ keys are used ONLY in server-side API routes.

CRON_SECRET — ADDED 2026-08-12, MANUAL STEP STILL OUTSTANDING (this
environment has no Vercel dashboard/authenticated-CLI access to complete
it; `vercel env ls` requires a login this session cannot provide). Both
`/api/jobs/tick` and `/api/cron/dpr-generate` now check
`Authorization: Bearer <CRON_SECRET>` on every request and fail closed
(401) if `CRON_SECRET` is unset — see lib/cron/auth.ts for the incident
this closes (jobs/tick previously had NO auth at all, live in
production) and lib/cron/auth.ts's own header comment for the exact
mechanism, verified directly against Vercel's current "Securing cron
jobs" docs, not assumed from training. TO FINISH THIS: (1) generate a
random string of at least 16 characters (a password generator is fine —
this is Vercel's own recommendation); (2) add it to `.env.local` as
`CRON_SECRET=<value>` for local testing; (3) add the SAME value to the
Vercel project's Environment Variables (Production AND Preview) via the
dashboard or an authenticated `vercel env add CRON_SECRET` — Vercel
automatically attaches it as the `Authorization` header on every
cron-triggered request once it's set there, no other configuration
needed. ~~Until step 3 is done, BOTH routes will 401 every real cron
invocation in production, not just unauthorized requests — this is a
deliberate fail-closed default, not a bug, but it means these routes
will not actually run until the secret is provisioned.~~

RESOLVED (observed 2026-08-12, ~22:15 IST, not asserted from a dashboard
check — §0's observation rule). Step 3 has been done: `CRON_SECRET` is
provisioned in Vercel Production and a deploy has happened since PR #55
merged (2026-08-11). Evidence: `public.dprs` — confirmed EMPTY at 13:44 IST
today (see §10's `DATED UPDATE` under the JOBS TABLE HAS NO CLAIMED-AT
entry) — had exactly one new row by 22:15 IST, for `log_date = 2026-08-12`,
with `delivery_status = 'skipped_no_data'`. That value has exactly ONE
writer in this codebase (grepped, confirmed, not assumed):
`runDprGenerateTrigger` in `app/api/cron/dpr-generate/route.ts` (line ~70),
the 8:00 PM cron route's own DPR-17 zero-data check — it is written
directly by the TRIGGER route, before any job is enqueued, never by
`handleDprGenerateJob` (the job handler) or `scripts/generate-one-dpr.ts`
(neither writes it — grepped, zero hits in either file). Reaching that
write path requires `isCronRequestAuthorized` to have passed first (route.ts
line 106) — the exact check this CRON_SECRET section describes — so this
row could not exist unless the secret check succeeded. Distinguished from
stale/leftover test data deliberately, not assumed: the row's `project_id`
matches a project used in earlier manual smoke-testing, which could look
like a false signal on its face, but `log_date = 2026-08-12` (today, not an
old test date) plus the single-writer trace above rules out any other
origin — a leftover test row could not carry today's date with this exact
value written by this exact code path.

**INFERENCE TRAP, recorded for the next reader**: on the zero-data path, an
ABSENT `dpr_generate` job in `public.jobs` is the SUCCESS signal, not a
failure signal — the whole point of the DPR-17 check running before
enqueueing (see the route's own header comment) is that nothing gets queued
for a project with no data that day. Checking `jobs` alone and seeing zero
rows is not evidence the cron never ran; check `dprs` for a
`skipped_no_data` row (or a real `generated_at`) first. This mistake was
made once already this session — recorded here so it isn't made again.

~~KNOWN VERCEL CONFIG GAP (2026-07-21, non-urgent, track + fix separately): the
Preview-scoped NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and related
Supabase vars) are pinned to ONE branch — feat/migration-007-auth-surgery (a
leftover from that migration's review) — instead of "All Preview branches." So
every OTHER branch's preview deploy gets NO Supabase config, and proxy.ts's
middleware (createServerClient + getUser on every request) throws → "Internal
Server Error" on EVERY route of that preview, even though the build is green.
This bit the feat/bot-27-reactivation-clear preview and is easy to misread as a
code bug. FIX: in Vercel → Project → Settings → Environment Variables, re-scope
those Preview vars to "All Preview branches." (Build-time is unaffected — these
vars are only read at request time.)~~

RESOLVED (2026-07-24): confirmed in Vercel → Settings → Environment Variables
that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Preview) are both
scoped to "All Preview Branches," not a single branch. Gap was apparently
fixed same-day as discovery (2026-07-21) but never marked resolved here.

KNOWN SUPABASE AUTH CONFIG GAP (2026-07-25): magic-link signup emails baked a
redirect_to pointing at the DEAD feat/migration-007-auth-surgery branch preview
URL (quoco-git-feat-migration-007-auth-surgery-quoco.vercel.app → 404). NOT a
code bug — login/page.tsx + auth/callback/route.ts derive the domain dynamically
from request headers (origin/host) and are correct. The dead URL comes from
Supabase Auth's dashboard SITE URL, still pinned to that 007 branch: Supabase
falls back to the Site URL whenever the code-supplied emailRedirectTo is NOT in
the Redirect URLs allowlist, and branch-preview URLs weren't allowlisted — so
every preview's magic link fell back to the stale Site URL. FIX (Supabase
Dashboard → Authentication → URL Configuration): Site URL → the real prod domain
(https://quoco-six.vercel.app — confirm this is the canonical/custom domain);
Redirect URLs → add https://quoco-six.vercel.app/** AND a preview wildcard
https://quoco-git-*-quoco.vercel.app/** (+ http://localhost:3000/** for local) so
each preview's dynamic emailRedirectTo is honored instead of falling back. VERIFY
BY OBSERVATION (§0), not dashboard-said-so: request a magic link from a preview
and confirm the email's redirect_to is that preview, not the Site URL.
RESOLVED (observed 2026-07-25): after the Site URL fix, the magic-link redirect
from the test-db signup landed correctly (no 404) — the same signup that produced
the 020 review package's §6 evidence. Observed on test-db; the PROD-side
confirmation rides with the real prod magic-link signup on the 020 runsheet
(020-review-package.md §7 item 5).

SAME DEAD BRANCH, BITTEN TWICE: feat/migration-007-auth-surgery has now been the
stale pin behind TWO real bugs this session — the Vercel Preview Supabase env
vars (note above) and this Auth Site URL — both leftovers from that migration's
review era. Assume more may be lurking: grep every prod config surface (Vercel
env scopes, Supabase Auth URLs, any dashboard setting or hardcoded string) for
that branch name and purge it wholesale, rather than fixing one surface at a time
as each bug surfaces.

SWEEP COMPLETE (2026-07-25): a full Vercel + Supabase dashboard sweep for that
branch name was done and is CLEAN — no additional stale references beyond the two
above. Checked: Vercel Environment Variables (all envs), Deployment Protection,
Domains; Supabase (BOTH main AND test-db) Auth email templates (Magic Link uses
{{ .ConfirmationURL }}, no hardcoded URLs), Database Webhooks (none configured),
Edge Functions (none deployed — empty "deploy your first function" screen). Repo
code/config is also grep-clean. So the pattern is closed at two instances; the
standing rule above still holds if a THIRD surface ever appears.

---

## 9. FILE STRUCTURE

quoco/
├── CLAUDE.md                       ← this file (core rules)
├── docs/
│   ├── schema.md                   ← full schema + migration order
│   └── bot-flows.md                ← full flows, DPR, templates, queue
├── app/
│   ├── (auth)/login, auth/callback ← done
│   ├── (onboarding)/               ← done
│   ├── (dashboard)/                ← shell, dashboard, projects done;
│   │                                  daily-logs (Wk3), dprs (Wk4)
│   └── api/
│       ├── whatsapp/webhook/       ← Week 2
│       ├── jobs/tick/              ← Week 2 (queue worker)
│       └── cron/{morning,evening,nudges,dpr-generate,owner-deliver}/
├── lib/
│   ├── supabase/{client,server,service} ← done (3 clients — client.ts,
│   │                                        server.ts, service.ts)
│   ├── whatsapp/{session,normalise,flows/{morning,evening}}
│   ├── dpr/{generate,render}       ← Week 4
│   └── queue/jobs                  ← Week 2
├── supabase/migrations/            ← every numbered file present is LIVE;
│                                      confirm the current set with
│                                      `ls supabase/migrations/` (§6)
├── types/database.ts               ← generated DB types, live (§6) —
│                                      regenerated after every schema
│                                      migration, most recently 022's step F
└── proxy.ts                        ← done
# CORRECTED (2026-08-07, P1 pass): this list previously (a) omitted
# service.ts (only client/server were named, contradicting §6's own "three
# Supabase clients"), and (b) carried a STRUCK note claiming types/database.ts
# "NEVER EXISTED" and calling generated types a deferred milestone — both
# stale since the generated-types PR (2026-07-13, same day as that struck
# note) stood the pipeline up; the file has existed and been regenerated on
# every schema migration since. §6 was already correct; this section
# contradicted it. Reconciled to match §6, not restated separately.

---

## 10. CURRENT BUILD STATUS

Moved to docs/build-status.md on 2026-08-23 — this file was past the
150,000-char limit (§6's FILE SIZE LIMITS rule) and the tail was being
silently dropped. Read docs/build-status.md for build history — it is not missing.
Existing "CLAUDE.md §10" references across docs/ and the review packages
(~60 of them) now mean docs/build-status.md — left unedited deliberately,
since several live in frozen review packages this project's own rules say
never to rewrite.
