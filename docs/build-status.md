# QUOCO — Current Build Status

Split verbatim out of CLAUDE.md §10 on 2026-08-23 (original CLAUDE.md
lines 1076-2538, pure cut/paste, no rewording). See CLAUDE.md §10 for why.

SPLIT AGAIN, 2026-09-17 (docs/split-claude-md-build-status), same reason as
the first split: this file had reached 130,092 chars against the
120,000-char warn threshold (CLAUDE.md §0's own FILE SIZE LIMITS / "A DOCS
FILE THAT PASSES THE WARN THRESHOLD GETS SPLIT" rules). Completed history
moved by stage into `docs/build-status/*.md`, verbatim, never reworded —
this file now holds the CURRENT status, the open backlog, and the dated
index below back to wherever a given date's content actually lives. Every
existing citation of the shape "docs/build-status.md's <date> entry" —
there are roughly 30 of them across CLAUDE.md and docs/ — was **left
unedited deliberately**, per this project's own established practice for
exactly this situation (this file's own header already did the same thing
in 2026-08-23 for "CLAUDE.md §10" citations). Look the date up in the index
below to find which file it now lives in.

---

## DATED INDEX — date/entry → destination file

| Entry | Destination |
|---|---|
| [2026-07-24] next 16.2.11 security patch — postcss/sharp overrides | `docs/build-status/2026-q3-weeks-1-2.md` |
| Week 1: COMPLETE | `docs/build-status/2026-q3-weeks-1-2.md` |
| Week 2: IN PROGRESS (all dated corrections/updates embedded within, through the point Week 4 starts) | `docs/build-status/2026-q3-weeks-1-2.md` |
| Week 4 (in progress): APPLIED TO PRODUCTION — migration 022, evening check-in, and everything through migrations ~015-027 embedded within | `docs/build-status/2026-q3-week-4-migrations.md` |
| [2026-08-23] DECIDED — design-decisions-beta-feedback.md is NOT split at this time, and all undated content that follows it through early September | `docs/build-status/2026-08-late.md` |
| [2026-09-03] Migration 035's Q4 equipment-echo bug | stays in this file, below |
| [2026-09-05] `submitted_via` channel vocabulary | stays in this file, below |
| [2026-09-15] Sentry "Consecutive HTTP" N+1 pattern | stays in this file, below |
| [2026-09-16] Backlog: function EXECUTE default | stays in this file, below |
| [2026-09-17] CI double-run fix shipped | stays in this file, below |

If a cited date isn't obviously one of the headings above, it's embedded
prose inside whichever file's date range brackets it — open that file and
search for the date string directly (each file states its own approximate
span in its own header).

---

## OPEN ITEMS CARRIED FORWARD (2026-09-17 split — found during the required
pre-move scan of the moved history for unresolved markers; see the split's
own task record for the full scan output and closed/false-positive
determinations)

- **BOT-27's opt-out set-half does not exist** — `messaging_blocked` is
  never set `TRUE` anywhere in the codebase (opened 2026-08-10). Explicitly
  named a PRE-LAUNCH BLOCKER for the production WhatsApp sender going live
  with the current STOP-line template: needs a Twilio status-callback
  endpoint, or inbound-STOP-text detection, whichever this integration
  actually surfaces. (carried forward from `docs/build-status/2026-q3-weeks-1-2.md`)
  DATED NOTE (2026-09-17, Aravind): deferred. MUST ship before the
  CLAUDE.md two-tier SWITCH TRIGGER fires (first beta tester, customer, or
  RCPL project data on prod). Onboarding anyone other than Aravind is
  blocked until BOT-27 is live.
- **`docs/reviews/handle-new-user-id-drift.md`** — "prod not yet checked"
  whether a function's live behavior still matches any migration file's
  documented version, after an out-of-band change. (carried forward from
  `docs/build-status/2026-q3-weeks-1-2.md`)
- **Equipment-parser follow-up questions**, deliberately left unanswered
  during a live DPR smoke test: whether an unrecognised equipment name
  should be accepted as-is or reasked, among others named at the time. Some
  of this class is tracked in dedicated `docs/reviews/equipment-*-gap.md`
  files — confirm before assuming still open. (carried forward from
  `docs/build-status/2026-q3-weeks-1-2.md`)
- **`labour.ts` parser (morning Q2 workers-planned / evening Q4a
  headcount)** has NO SIGNAL AT ALL for a named gap class — not yet caught
  by any real incident, which is not the same as fixed. (carried forward
  from `docs/build-status/2026-q3-weeks-1-2.md`)
- **DPRS PAGE SWALLOWS QUERY ERRORS** — explicitly noted as staying open,
  unrelated to the apply it was recorded alongside. (carried forward from
  `docs/build-status/2026-q3-weeks-1-2.md`)
- **Real webhook-triggered `apply_evening_flow_turn` proof stays OPEN**
  (was blocked on the webhook-wiring deliverable), and the **restart-
  semantics decision** (`design-decisions/check-in-flow-decisions.md` §10,
  DECIDE-BEFORE-CRON-PR) **also stays OPEN**. NOTE: webhook-wiring (PR #22)
  and the outbound-send/trigger-cron primitive have both since shipped per
  CLAUDE.md §3 — this may already be superseded; verify before treating
  either as still open. (carried forward from
  `docs/build-status/2026-q3-week-4-migrations.md`)
- **Cron/webhook-triggered DPR regeneration**, whenever wired, inherits a
  DPR/owner-record sync gap on top of the migration-022 item above — same
  "may already be superseded by the shipped outbound-send primitive" caveat
  applies. (carried forward from
  `docs/build-status/2026-q3-week-4-migrations.md`)
- **`jobs.status` has no `'stale'`-equivalent value** — a job that dies
  mid-execution stays `'running'` forever and is invisible to retry
  (`claimJobs`'s own `WHERE` only selects `pending`/`failed`). (carried
  forward from `docs/build-status/2026-q3-week-4-migrations.md`)
- **`docs/schema.md`'s own `checkin_escalations` entry was not yet
  written** as of migration 027 — verify it exists now. (carried forward
  from `docs/build-status/2026-q3-week-4-migrations.md`)
- **OPEN QUESTION, sharper as of 2026-08-15, still unresolved at last
  update**: the 2026-08-13 morning check-in's real submission timing vs.
  its displayed timestamp (`daily_logs` row `34f8bbb5...`). (carried
  forward from `docs/build-status/2026-q3-week-4-migrations.md`)
- **Session-transition test flake classification: "UNRESOLVED, not
  contention"** — the evidence rules out a real unique violation and a
  suppressing trigger, but never proved a transient cause. NOTE: the
  underlying test ordering bug this flake stemmed from was later fixed for
  real on 2026-08-24 (CLAUDE.md §0's CONCURRENCY/LOCK/RACE CI-ONLY rule
  origin), but this specific classification question's own resolution was
  never confirmed closed — treat as a distinct, narrower open question.
  (carried forward from `docs/build-status/2026-q3-week-4-migrations.md`)
- **`docs/outbound-send-primitive-plan.md` B3 condition 1 finding**
  (correctly flagged-not-fixed in a plan-only pass) — recorded so it isn't
  lost now that the plan has graduated to real migrations/PRs (CLAUDE.md
  §3's shipped outbound-send primitive). Verify the finding was actually
  carried into the real implementation, not silently dropped when the plan
  document stopped being the place anyone re-reads for open findings.
  (carried forward from `docs/build-status/2026-08-late.md`)
- **`docs/reviews/session-transition-lock-wait-flake.md`: "CI is the only
  environment that can validate this test; that verification is still
  open"** per the flake doc's own status line as of last update. NOTE:
  CLAUDE.md §0's CONCURRENCY/LOCK/RACE CI-ONLY rule was later written using
  this exact incident as its origin and states CI already showed three
  independent real failures — this may already be resolved; verify against
  the flake doc's current status line before treating it as still open.
  (carried forward from `docs/build-status/2026-08-late.md`)

Also carried forward (backlog housekeeping, added 2026-09-17 per this
split's own paperwork step):
- `docs/reviews/morning-flow-migration-review-package.md` is at 141,180
  chars (over the 120,000-char warn threshold); split later.
  DATED CORRECTION (2026-09-17): KEEP, do not split or delete. It is the
  cited spec for live migrations 030/031/033 (which cannot be edited),
  lib/whatsapp/flows/morning.ts, and three test files. File-size lint only
  warns for it. Revisit only if the warning becomes a hard fail.
- `scripts/migration-lint-exceptions.json` reason strings cite "CLAUDE.md"
  for content that actually now lives in `docs/build-status.md`
  (pre-existing drift, predates this split); fix later.
- (2026-09-17) Clean up ~20 stale `.claude/worktrees/` copies. First
  confirm each worktree's branch is pushed to GitHub (CLAUDE.md "every
  branch pushed" rule) and has no uncommitted changes; remove only those
  that pass. Aravind approves the list before removal.

---

## CURRENT STATUS

### [2026-09-03] Migration 035's Q4 equipment-echo bug — near-miss, zero real engineers affected

`v_equipment_echo` shipped permanently `NULL` in 035's own RPC (fixed same-day, `f632a5f`); verified against `outbound_sends`/`daily_logs` that the bug window (09:05-10:28:35 IST) closed hours before the one real `evening_send` trigger for that date (18:30 IST) — nobody hit it. Full evidence and the dated correction to the commit message's own impact claim: `docs/reviews/035-apply-record.md`, "Production incident" section.

### [2026-09-05] `submitted_via` channel vocabulary — three tables now disagree, recorded not fixed

Migration 036's reviewer round added `NOT NULL` to `hindrances.submitted_via` (three allowed values: `whatsapp_scheduled`/`whatsapp_adhoc`/`web_app`, migration 001's own CHECK). The two sibling `submitted_via` columns — `safety_incidents` (~line 148 of its own migration) and `invoices` (~line 169) — both still carry `DEFAULT 'whatsapp'` and **no CHECK constraint at all**, unlike `hindrances`. No live bug today (no writer exists for either sibling column, same as `hindrances` before 036/037's own work), but three tables now disagree on the channel vocabulary for what is conceptually the same fact ("how did this row arrive"), and the same question — what values are legal, is a default honest, should it be NOT NULL — will land on each column the moment it gets a real writer. Recorded here as a ledger line, not resolved: no scope change to 036/037, no migration filed for the siblings.

### [2026-09-15] Sentry "Consecutive HTTP" N+1 pattern on GET /api/jobs/tick — low priority, unrelated to stage 3

Sentry has been flagging a "Consecutive HTTP" N+1-style pattern on `GET
/api/jobs/tick` (the `projects` and `project_members` queries) for
roughly 6-7 days as of this entry. Not investigated or fixed here — noted
as a backlog item, low priority, unrelated to stage 3 (the idle-photo
nudge work this entry rides alongside). Whoever picks it up should
confirm current status in Sentry first, since "roughly 6-7 days" is an
observation at write time, not a fixed window.

### [2026-09-16] Backlog: function EXECUTE default for new public-schema functions

Future migration (reuse released 048 when built): `ALTER DEFAULT
PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS
FROM anon, authenticated.` External reviewer fold 5, 2026-09-16 (migration
047's own external review round, `docs/reviews/047-review-package.md`).
Every new function in `public` is still EXECUTE-able by `anon`/
`authenticated` by default (Postgres's own `postgres`-role default ACL);
every migration since 020 has revoked this by hand, per-function, at
CREATE time. 047 closed the equivalent gap for tables (`docs/reviews/047-
review-package.md`) but deliberately left functions out of scope. Number
048 was reserved for 047's own test-only D4 helper, then released (never
used, no migration number — test-only objects get none, per that
decision's own reasoning) and is free for this future migration to claim.

### [2026-09-17] CI double-run fix shipped — backlog: verify on first merge

CI double-run fix shipped (2026-09-17); verify on the first merge after
this PR that main's test-db job is skipped with the log line. ~~Aravind to
enable "Require branches to be up to date before merging" + required
check "Test (real test-db)" on main.~~

DATED CORRECTION (2026-09-17): verified on PR #287's merge — main run
35196412265 skipped Test (real test-db) with the log line citing PR run
35194080386 (tree 983c6799106a5a18add0b266a1d9e28a25e80fa1). Branch
protection on main enabled by Aravind: strict (up to date) + required
checks Typecheck, Lint, Test (real test-db), Migration Lint.

DATED NOTE (2026-09-17): PR #287 was squash-merged in error; CLAUDE.md's
"regular merge commits, not squash" rule applies. No functional impact (CI
skip verified). Future merges use merge commits.
