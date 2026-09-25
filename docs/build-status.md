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
| [2026-09-17] Supabase Auth "Allow new users to sign up" disabled | stays in this file, below |
| [2026-09-17] Backlog: Label Owner DPR email photo attachments by type | stays in this file, below |
| [2026-09-17] Backlog (investigation): DPR verdict containment fallback reached an Owner | stays in this file, below |
| [2026-09-17] Backlog (investigation): unreadable Sentry error message | stays in this file, below |
| [2026-09-19] Backlog: the one-project-per-engineer slice (D12 rider) | stays in this file, below |
| [2026-09-19] Backlog: `anon` holds table-level SELECT on `public.users` (N1) | stays in this file, below |
| [2026-09-19] Backlog: the Rule 9 / runtime-registry coupling is a tooling defect (R3-S1) | stays in this file, below |
| [2026-09-19] Backlog: precedent grants — revoke `service_role` from `complete_onboarding` and `correct_daily_log` (R3-S3) | stays in this file, below |

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
  ADDED 2026-09-17 (per Aravind): BOT-27 is not the only blocker on this
  same switch trigger — the **onboarding re-entry guard** (a sub-item of
  the new **"How people log in"** entry, below) and that entry as a whole
  are also HARD BLOCKERS. ~~All three (BOT-27, the re-entry guard, and "How
  people log in") must close before the trigger fires; none supersedes or
  weakens the others.~~

  **REVISION 2026-09-17 (per Aravind):** a fourth item joins this same
  switch-trigger blocker set, same day, confirmed on prod: **"Daily-log
  correction gate checks the wrong role"** (below). All four (BOT-27, the
  re-entry guard, "How people log in", and the correction-gate role fix)
  must close before the trigger fires; none supersedes or weakens the
  others.
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
- **"How people log in"** — NEW, added 2026-09-17 per Aravind. **FULL
  tier** (CLAUDE.md §0's PRE-LAUNCH TWO-TIER CHANGE PROCESS), and a HARD
  BLOCKER for the switch trigger alongside BOT-27 (above). Scope:
  - WhatsApp OTP replaces the email magic link (decided 2026-09-17).
  - Owner dashboard login — Owners currently have `auth_id = NULL` and
    `whatsapp_number = NULL` (neither the web-login path nor the WhatsApp
    path can reach them today).
  - Onboarding redesign and a self-serve signup policy.
  - **Onboarding re-entry guard — a HARD BLOCKER for the switch trigger on
    its own, independent of the rest of this item.** Current state:
    `complete_onboarding` (prod definition checked 2026-09-17,
    `supabase/migrations/016_corrections.sql:160-191`) always `INSERT`s a
    new `tenants` row and then sets the caller's own `users` row to that
    new `tenant_id` with `role = 'admin'` — with no check for an existing
    `tenant_id` on the caller first. `app/(onboarding)/onboarding/page.tsx`
    has no check either; it only redirects to `/login` when the caller has
    no Supabase Auth session at all. A logged-in PM who submits
    `/onboarding` is moved into a new, empty tenant.
  - Login must complete on the official host. 2026-09-17: a magic link
    requested from a vercel.app deployment URL was consumed by Supabase
    (auth log: /verify "Login: request completed" 21:22:26 IST) but the
    browser landed on app.quoco.co.in/ (not /auth/callback) one second
    later and was sent back to /login; later clicks failed with "One-time
    token not found". Cause: app/(auth)/login/page.tsx builds
    emailRedirectTo from the request origin, and the vercel.app origin is
    not an allowed redirect URL. Not fixed now (magic link is being
    replaced). Requirement for the new login: always complete on
    app.quoco.co.in, and redirect non-official hosts there first.
    Operating rule until then: use app.quoco.co.in only.
  - Design questions, not decided:
    - One phone number = one `users` row —
      `get_user_tenant_id()` (`SELECT tenant_id FROM users WHERE auth_id =
      auth.uid()`) has no `LIMIT 1` (see `scripts/provision-beta-owner.ts`'s
      own header for the full failure mode a second row sharing an
      identity creates).
    - Meta authentication-template approval lead time.
    - Fallback path if WhatsApp/Twilio is down.
    - Recycled or changed phone numbers.
    - Per-login OTP cost — take the actual rate from Twilio at build time;
      do not estimate here.
    - BOT-27's STOP users must still be able to receive login codes.
    - The dashboard layout (`app/(dashboard)/layout.tsx`) has no role gate
      today, only an auth check (`if (!user) redirect('/login')`) — this
      item adds a new auth surface on top of a layout that already lets
      any authenticated user reach every nav link.
  - Parked, not designed:
    - `/login`'s Supabase Auth error is shown to the user raw —
      `app/(auth)/login/page.tsx`'s `sendMagicLink` redirects with
      `error.message` verbatim (e.g. "Signups not allowed for this
      instance").
    - `/onboarding` shows raw DB errors the same way
      (`app/(onboarding)/onboarding/page.tsx`'s `createCompany`, except the
      one hand-matched "unique" case).
  - [2026-08-19] OBSERVED ON PROD, recorded 25 Sep 2026 (per Aravind; from
    the auth decisions record, not re-observed since). Cross-device magic
    links fail. A sign-in link requested in one browser and opened in
    another returns: "PKCE code verifier not found in storage. This can
    happen if the auth flow was initiated in a different browser or device,
    or if the storage was cleared." Cause: PKCE stores a one-time verifier
    in the browser that requested the link, so the exchange cannot complete
    anywhere else. Requesting on a laptop and opening the email on a phone
    is ordinary behaviour, not an edge case. This is the originating reason
    for the email OTP decision (a typed code works on any device) and is
    load-bearing for that plan's rollback section. Recorded here because an
    external review of that plan (25 Sep 2026) found the observation was
    nowhere in this repo.
- **"Daily-log correction gate checks the wrong role"** — NEW, added
  2026-09-17 per Aravind (found during the Stage 5a review package,
  `docs/reviews/stage5a-review-package.md`). **FULL tier** (CLAUDE.md §0's
  PRE-LAUNCH TWO-TIER CHANGE PROCESS) — this is a `SECURITY DEFINER`
  function's own authorization logic changing, per CLAUDE.md §0's EXTERNAL
  REVIEW GATE condition (b). **HARD BLOCKER for the switch trigger**,
  alongside BOT-27, the onboarding re-entry guard, and "How people log in"
  (above).
  - `canEditLog` (`lib/daily-logs/correction.ts:131-133`) compares
    `role === 'pm'` against `viewerRole`, which is `profile.role` —
    `users.role` — passed in from
    `app/(dashboard)/daily-logs/[logId]/page.tsx:42`
    (`viewerRole={profile.role}`).
  - `complete_onboarding` (`supabase/migrations/016_corrections.sql:180`)
    sets `users.role = 'admin'` for every self-serve account, on every
    tenant-creation pass — while creating a project
    (`app/(dashboard)/projects/new/page.tsx:49-54`) makes that SAME person
    `project_members.role = 'pm'` on that project. The two columns
    disagree for every real PM, by construction.
  - Migration 019's own correction RPC guard checks the identical
    account-level column: `correct_daily_log`
    (`supabase/migrations/019_daily_log_corrections.sql:170-171`) resolves
    `v_editor_role` via `SELECT id, role INTO v_editor_id, v_editor_role
    FROM public.users WHERE auth_id = auth.uid()`, then
    (`supabase/migrations/019_daily_log_corrections.sql:178-181`) `RAISE
    EXCEPTION` if `v_editor_role <> 'pm'` — the same `users.role` gate as
    `canEditLog`, at the database layer, not just the UI. (This RPC
    separately checks project membership at
    `supabase/migrations/019_daily_log_corrections.sql:237-243`, but that
    check accepts ANY `project_members` row for the project — it does not
    itself filter on `role = 'pm'`; the actual PM-authorization is carried
    entirely by the `users.role` check above.)
  - CONFIRMED ON PROD BY OBSERVATION, 2026-09-17 (Aravind): logged in as a
    real PM (`users.role = 'admin'`, `project_members.role = 'pm'`), the
    daily log detail page shows no edit/correction controls. Aravind could
    edit earlier only while his `users.role` was temporarily set to
    `'pm'` as a manual-walkthrough workaround; that has since been
    reverted.
  - Fix direction, NOT designed here: gate on `project_members.role =
    'pm'` for the log's own project, in both the UI (`canEditLog`'s
    caller) and the RPC (`correct_daily_log`'s guard), reusing the shared
    project-PM check Stage 5a is introducing for its own photo access
    control (`docs/reviews/stage5a-review-package.md` §4 D3/D6, §8, §9 Q7).
    Scheduled after Stage 5a.
  - Existing test fixtures manufacture the state production never
    produces, by directly setting `users.role = 'pm'` — a shape
    `complete_onboarding` never creates (it always writes `'admin'`,
    above): `test/daily-log-correction-rpc.test.ts:87` (restored to
    `'admin'` in its own `afterAll`, line 103) and
    `test/migration-019.test.ts:123` (restored to `'admin'` in its own
    `afterAll`, line 162, commented `// restore shared fixture state` —
    `'admin'` is the shared fixture's real baseline, per
    `test/helpers/db.ts:1055-1056`'s own `claimProfile(..., 'admin', ...)`
    call). Recorded here, not changed — ~~do not "fix" these tests by
    leaving them on `'pm'`; that would delete the only place this gap is
    currently exercisable at all.~~

    **REVISION 2026-09-17 (per Aravind):** these fixtures HIDE the bug: by
    setting `users.role = 'pm'` they let the tests pass in a state
    production never produces, which is why review missed it. When the
    fix is built, these tests must use the real production shape
    (`users.role = 'admin'`, `project_members.role = 'pm'`), and add a
    case proving a `users.role = 'admin'` PM CAN correct and a non-PM
    project member CANNOT.

    Do not work around the live bug by setting a real account's
    `users.role` to `'pm'` either — that hides the bug from testing
    rather than fixing it.
  - 019's membership check
    (`supabase/migrations/019_daily_log_corrections.sql:237-243`) accepts
    any `project_members` role, so the fix must add `role = 'pm'` there,
    not only replace the `users.role` check.
  - Fix scope: every check that treats `users.role`/`profile.role` as "is
    a PM", not only corrections. Known candidate: DPR regeneration, whose
    plans reuse the same gate (`docs/plans/dpr-regeneration-decision.md:104`,
    `docs/plans/dpr-regeneration-build-spec.md:113`). Run a repo-wide
    search (`app`, `lib`, `components`, `supabase/migrations`) for
    `role === 'pm'` / `role <> 'pm'` / `canEditLog` when the fix is
    scheduled.
  - History: first found 2026-08-29 during a manual walkthrough of PR #137
    and recorded in Aravind's project notes
    (`correction-gate-role-mismatch`), with the interim `users.role =
    'pm'` workaround. That record never reached the repo, so the bug
    stayed open.

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

Sentry issue ids covering this pattern (added 2026-09-17): JAVASCRIPT-NEXTJS-V, JAVASCRIPT-NEXTJS-N, JAVASCRIPT-NEXTJS-W, JAVASCRIPT-NEXTJS-S.

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

### [2026-09-17] Supabase Auth "Allow new users to sign up" disabled

Disabled per Aravind, 2026-09-17.

- **Prod** (`jvxwqignooseazzmwhvl`): verified by observation — a new,
  unregistered email submitted at `/login` received "Signups not allowed
  for this instance"; an already-registered email still received and used
  its magic link successfully.
- **Test** (`exfccwlrhoutkgrlikod`): disabled per Aravind; not
  independently observed in this pass.
- The 2 prod `users` rows with `role IS NULL` / `tenant_id IS NULL` are
  Aravind's own accounts (his Gmail address and a `+smoke020` test
  address). Leave as is — not a data-integrity gap.

### [2026-09-17] Backlog: Label Owner DPR email photo attachments by type

LIGHT tier. Scheduled after Stage 5a B3 (not scheduled now). Reason: the
Owner cannot tell progress photos from hindrance photos in the DPR email
today — observed 2026-09-17 (Speed Mechatronics DPR, engineer Vikram Rao;
full record `docs/reviews/stage5a-b1-b2-record.md`). Every attachment
currently keeps its raw Storage filename.

Approved filenames (English only; Tamil owed, NOT approved): `Progress
photo {n}.{ext}` for evening photos and `Hindrance photo {n}.{ext}` for
hindrance photos; `{ext}` from the real file type; numbering restarts per
group (i.e. evening photos are numbered 1..N independently of hindrance
photos being numbered 1..M).

Considered and rejected: watermarking (alters site evidence, adds image
processing cost). Backlog, not scheduled: embedding photos inline under
each report section instead of as attachments.

### [2026-09-17] Backlog (investigation, not scheduled): DPR verdict containment fallback reached an Owner

LIGHT tier. Sentry issue `JAVASCRIPT-NEXTJS-4`, "DPR verdict containment
failed twice, falling back to placeholder", 1 event, ~1 week before
2026-09-17, via `/api/jobs/tick`. Not investigated here. Whoever picks
this up: identify which DPR triggered it and what placeholder text the
Owner actually received.

### [2026-09-17] Backlog (investigation, not scheduled): unreadable Sentry error message

LIGHT tier. Sentry issue `JAVASCRIPT-NEXTJS-7`, message `[object
Object]`, 1 event, ~1 week before 2026-09-17, via `/api/jobs/tick`. Not
investigated here. Whoever picks this up: find the capture site passing
a non-`Error` object and make it report a readable message.

### [2026-09-19] Backlog: the one-project-per-engineer slice (D12 rider)

Owner: **Aravind**. Not scheduled. FULL tier when built (item 4 replaces a
shipped SECURITY DEFINER function — review gate (a)). Filed here by the 048
build (`docs/reviews/048-review-package.md`) to close external review
condition 3; the plan that names it is `docs/plans/add-engineer-plan.md`
§4.8 and §4.10 (at `caab70b`, branch `feat/add-engineer-plan`). Slice 1
(migration 048) ships **without** any database enforcement of
one-project-per-engineer: the add screen is the only place the rule exists,
and it enforces it only for the paste path — RLS still lets a tenant admin or
`pm` insert a `project_members` row for any tenant user directly.
**`docs/schema.md:129-130` ("enforced at insert in app logic, NOT a DB
constraint") becomes true the day 048 ships: the add screen is now that app
logic, and only that.** Contents, complete (citations re-verified against the
tree on 2026-09-19, not copied from the plan):

1. **The index:** `CREATE UNIQUE INDEX uq_project_members_one_engineer_project
   ON public.project_members (user_id) WHERE role = 'engineer'`. Pre-check
   queries (a) users with more than one `project_members` row and (e) the
   exact predicate: `git show fad98e3:docs/plans/add-engineer-plan.md`.
   Whether it must avoid `CONCURRENTLY` is **unverified**: the plan cites
   `docs/migration-runbook-template.md:34` for it, and that line does not say
   so at 2026-09-19 (no `CONCURRENTLY` appears in `docs/*.md` or `CLAUDE.md`);
   the author of this slice re-derives it.
2. **The 7 test files that build "one user, two `engineer` memberships" as
   ordinary setup**, to be reworked once, against the whole rule:
   `test/unit/project-resolution.test.ts:77-81`,
   `test/unit/morning-cutoff-sweep.test.ts:516-517`,
   `test/webhook.test.ts:239-246`, `test/dpr-generate-job.test.ts:72-76`,
   `test/dpr-generate-trigger.test.ts:40-44`,
   `test/dpr-stage1-plumbing.test.ts:27-31`,
   `test/owner-deliver-job.test.ts:121-127`. The plan's "59 tests" is
   **derived from reading, never observed** — the first step is a real red run
   against an index-carrying scaffold.
3. **Role-scoping of `resolveEngineerProject`** —
   `lib/whatsapp/project-resolution.ts:37`, `.from('project_members')
   .select('project_id').eq('user_id', userId)`, currently role-blind.
4. **Role-scoping of the sweep's count** —
   `supabase/migrations/033_sweep_stale_morning_sessions.sql:220-222`,
   `SELECT count(*), … FROM project_members WHERE user_id = v_row.user_id`,
   role-blind.
5. **Prerequisite, from 048:** the `project_members.role` CHECK.
6. **The consequence it exists to remove:** `pm` on P1 + `engineer` on P2 passes
   the index, yet that engineer still gets `MULTIPLE_MEMBERSHIPS_REPLY` while
   the sweep parks their morning session — "allowed is not works" — until
   items 3 and 4 land. **Until then a second `engineer` membership is loud to
   the engineer and to Sentry, and SILENT TO THE PM:** an amber "Not checked
   in" every day on both boards, with no explanation.

### [2026-09-19] Backlog: `anon` holds table-level SELECT on `public.users` (N1)

Owner: **Aravind**. Not scheduled. FULL tier when built (a revoke on `users`
trips review gate (b)); its own migration. Filed here by the 048 build to
close external review condition 3. **A known gap, not an accepted risk.**
Until now it was tracked **only inside review packages**:
`docs/reviews/047-review-package.md:35` (D5, "`anon` SELECT cleanup is OUT of
scope (backlog)") and `:63` ("`anon`'s remaining SELECT/INSERT/UPDATE surface
is untouched") — and was not in this file's backlog.

Evidence: the plan's read-only test-db probe `pg_6` found `anon` with
table-level `SELECT` on `public.users`, 17 of 17 columns
(`docs/plans/add-engineer-plan.md` §4.10, N1). **Re-observed 2026-09-19 on a
disposable scaffold built from a fresh schema-only dump of test-db plus
migration 048** (`docs/reviews/048-scaffold/`): `has_table_privilege('anon',
'public.users','SELECT')` is `true` and `anon` can `SELECT` **20 of 20**
columns, including 048's three new ones (`registered_by`, `registered_at`,
`consent_attested`) — they inherit the table-level grant. **Prod was not
probed.** What bounds it today is RLS alone (`users_select` requires the own
row or the same tenant; an `anon` request has no tenant) — a single layer, the
shape `CLAUDE.md` §6 warns about ("RLS and the grant are two independent
layers"). 048 widens the exposed surface by three columns and does not close
it.

### [2026-09-19] Backlog: the Rule 9 / runtime-registry coupling is a tooling defect (R3-S1)

Owner: **Aravind**. Not scheduled. Tier to be confirmed by Aravind when scheduled (it edits a test helper and a lint rule — none
of `CLAUDE.md` §0's gates (a)-(e) — but it touches the safety net the fixture teardown relies on, so ask before assuming light).
Filed here by the 048 build (`docs/reviews/048-review-package.md` §10 F12) to close external review round 3, condition S1.
**The defect:** Rule 9 (`scripts/lint-migrations.mjs:389-490`; its no-exceptions note at `:742-757`) scans HELD migration files
under `docs/reviews/` and demands a `scripts/shared-fixture-fk-coverage.json` entry **in the same commit**. The runtime harness
reads that same JSON **live**: `test/helpers/db.ts:2` imports it and `sweepSharedFixtureReferences` (`:348-397`) acts on every
entry at teardown, its `select` throwing at `:366-368` when the column is missing. So a held migration that adds an FK to a
shared-fixture table (`users`, `tenants`, `projects`) forces an entry the harness will execute **before the column exists on any
database** — a **guaranteed red window** for every CI run and every shared-test-db user until the migration is applied. First
victim: 048 (`users.registered_by`; package §8 — 21 of 22 files fail at teardown, and the failed teardowns strand rows). Every
future FK on those tables reproduces it.
**The narrower fix the reviewer proposed (NOT implemented here):** the entry carries `held: true`; the sweep — on a
missing-column error **for a held entry only** — probes `information_schema.columns` and, if the column is absent, **skips with a
logged notice**; the flag is **removed in the applying commit**. Every other error still throws, so the safety net is not
weakened for anything but the one named window. The 048 package refused the broader option (tolerate any missing column) for
exactly that reason (§8, "Option (B)").
**Related, unobserved:** the same function's recursion keeps no visited set (`db.ts:371`), and 048's entry is the first
self-referential edge in the registry (UNKNOWNS #69); the R3-N3 CHECK excludes the length-1 cycle only.

### [2026-09-19] Backlog: precedent grants — revoke `service_role` by name from `complete_onboarding` and `correct_daily_log` (R3-S3)

Owner: **Aravind**. Not scheduled. **FULL tier when built** (revoking a grant on a shipped SECURITY DEFINER function trips review
gate (b)); its own migration and review package. Filed here by the 048 build (`docs/reviews/048-review-package.md` §10 F11, F13) to
close external review round 3, condition S3. Evidence is **test-db's live ACLs only** (package §10 F11); prod is unprobed.
**The mechanism — the point of this entry:** both functions derive the caller from `auth.uid()` inside the body
(`correct_daily_log`: `supabase/migrations/040_evening_q5_tomorrow_needs.sql:285`, `WHERE auth_id = auth.uid()`;
`complete_onboarding`: `supabase/migrations/016_corrections.sql:181`), and `auth.uid()` reads the request's JWT settings. **A
`service_role` session can `set_config('request.jwt.claims', …)` and thereby become any caller**, so a write made through either
function would carry a **FORGED attribution** — a real user recorded as the author of something they never did. **The privilege is
not escalated** (`service_role` already bypasses RLS and can write directly); **the attribution is.** Today both functions'
`service_role` grant is simply the Supabase default privilege nobody revoked: `040:401-402` and `020_function_execute_hardening.sql:80-85`
revoke `FROM PUBLIC, anon` and grant `TO authenticated` — `service_role` is not named.
**The three functions, three different answers:**
- `complete_onboarding` and `correct_daily_log` — revoke `service_role` by name (`CLAUDE.md` §6). **Production callers checked, 2026-09-19:**
  both are called with the SSR (signed-in) client — `app/(onboarding)/onboarding/page.tsx:18,27` and
  `app/(dashboard)/daily-logs/actions.ts:49,68` both use `createClient` from `@/lib/supabase/server` — never the service client.
  **But a test uses `service_role`:** `test/migration-016.test.ts:105` (T-016-02) calls `complete_onboarding` through
  `testClient()`, so the revoke migration must rework that test in the same PR. (`migration-015.test.ts:212` and
  `migration-016.test.ts:149` use `jwtClient`; `migration-019.test.ts` and `daily-log-correction-rpc.test.ts` were **not** checked.)
- `get_user_tenant_id` (`supabase/migrations/002_rls_policies.sql:12`; grants `020:94-95`) — `service_role` bypasses RLS and never
  evaluates the policies that call it, so the revoke is **safe, but needs its own line of proof**: the "Landmine 1" argument
  (`docs/reviews/020-review-package.md:189, :294, :375` — `authenticated` must keep it, because RLS policies call it as the caller).
- **Leave `write_dpr_version` as designed** (`029_dpr_versioning.sql:430`, `041_write_dpr_version_first_write_fix.sql:248`, both
  `TO authenticated, service_role`): it is a **deliberate hybrid with a real `service_role` caller**, not a precedent gap.
048's own `add_engineers_to_project` already revokes `service_role` by name, so it is the first authenticated-callable definer
function without it — the intent of the rule, and a departure from every precedent above (package §10 F11).
