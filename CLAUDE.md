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
- Scheduling, cron, jobs queue, RLS, E.164, Sentry, PITR
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

### [2026-07-24] next 16.2.11 security patch — postcss/sharp overrides
PR #11. next@16.2.11 still hard-pins vulnerable transitives: postcss@8.4.31,
sharp@^0.34.5. Added package.json overrides (postcss ^8.5.15, sharp ^0.35.0)
to force patched versions. Verified: fast-uri (only prod-reachable incidental
bump) confirmed absent from .next/ build output; prod builds on Turbopack so
the @sentry webpack-plugin path never executes.

Re-evaluate/remove these overrides when Next 16.3 goes stable — it's expected
to bundle patched postcss/sharp natively, making the overrides dead weight.

Known gap: sharp override is unverified at runtime — no next/image usage
exists yet, so the image-optimization path is currently inert. Add an
optimized-image smoke test to the Week-3 photos PR before that ships.

Week 1: COMPLETE
- Supabase client (client.ts, server.ts, proxy.ts)
- Magic link auth + PKCE callback working
- Onboarding: complete_onboarding() RPC creates tenant + admin user
- Dashboard shell: sidebar nav, welcome, project list
- Project CRUD: create, list, detail, members
- Migrations 001–005 live. TypeScript zero errors.
- GitHub: github.com/ara-2789/Quoco
- NOTE: sidebar shows Safety/Invoices/Hindrances nav items — those are
  Fast-Follow. Hide or disable them for the Spine so beta PMs don't click
  into empty sections.

Week 2: IN PROGRESS
Day 1 checklist:
1. Vercel Pro provisioned — DONE
2. ~~Supabase Pro + PITR provisioned — DONE~~
   DATED CORRECTION (2026-07-10): this was WRONG. Supabase **Pro** is confirmed,
   but **PITR was never actually enabled** — verified via the dashboard on
   2026-07-10; only nightly scheduled physical backups exist. The false "PITR —
   DONE" here is what the migration 007 rollback plan leaned on. See the dated
   correction under §5(a) of docs/migration-007-checkpoint-1-review.md for the
   consequence (reduced rollback granularity: hours-old snapshot vs near-instant
   PITR) and the decision to proceed on the 2026-07-10 16:34:44 UTC scheduled
   backup. To restore PITR granularity, enable PITR ~~(still not done as of this
   correction)~~.
   DATED UPDATE (2026-07-12): PITR is now ENABLED and observation-verified on
   prod — Database → Backups → Point in time shows an active restore window
   (05 Jul → present) at 2-minute granularity. The reduced-granularity caveat
   above applied to the 007 apply (2026-07-10) only; from 2026-07-12 the
   near-instant PITR rollback path is real and observed, per CLAUDE.md §0.
   FINAL (2026-07-12): enablement date was 2026-07-12 (observed same day). The
   2026-07-10 observation (not enabled) was correct — the restore window's
   retroactive reach to 05 Jul comes from Supabase exposing retained WAL/backup
   history at enablement, not from PITR having existed earlier. Chain closed.
   [Date-corrected: this FINAL entry was first committed (fe3bd85) mislabelled
   2026-07-13; actual date 2026-07-12. Corrected forward here, not by history
   rewrite, since the reviewer may have pulled fe3bd85.]
3. Sentry wired, all environments — DONE (tested end-to-end, error confirmed
   landing in Sentry dashboard)
4. NFR-16 jobs table — DONE (migration 006, live). Queue helper library,
   /api/jobs/tick worker, and Vercel cron config still pending.
5. Twilio production sender application — BLOCKED ~2 weeks on company
   registration. Cannot start until entity paperwork clears.
6. 12 WhatsApp templates submitted to Meta — BLOCKED, same dependency as #5.
7. Persona rename grep pass — DONE. Checked: only real 'client' role
   reference is the CHECK constraint in 001_core_schema.sql (live, do not
   edit directly — fixed via migration 007). All other 'client' hits in the
   codebase are legitimate (Supabase SDK client, or the unrelated
   projects.client_name/client_contact fields for Phase 2's external
   building client concept, which correctly stay as-is).

NOTE: Supabase CLI migration tracking was out of sync — 001-005 were
originally applied via the dashboard SQL editor, so the CLI had no local
record of them. Repaired with `supabase migration repair --status applied`
before pushing 006. Any future first-time `supabase db push` in a session
should run `supabase migration list` first to confirm Local/Remote match.

OUT-OF-BAND DB OBJECTS (tracked registry — 2026-07-25). Objects that exist on
PROD but have NO migration-file source (created via the dashboard SQL editor or
other out-of-band action). These are a standing liability: prod drifts from
test-db and from the migration set, so a DR restore / branch reset / rebuild
comes up WITHOUT them, and reviews can miss them (they aren't in the files).
RULE: catalogue every one here the moment it's found, and bring it under version
control (into a migration) the next time it's touched. Known entries:
  * `rls_auto_enable()` — SECURITY DEFINER, owner=postgres, broad default
    PUBLIC/anon/authenticated EXECUTE. On PROD only (absent on test-db); no
    migration history. Being brought under version control for the FIRST TIME via
    migration 020 (the function-EXECUTE hardening pass) — 020 is the first file to
    reference it. Invocation path confirmed during the 020 rehearsal (see 020).
  * `jobs` / `processed_messages` RLS-enabled state — `relrowsecurity=true` set
    out-of-band (017 review F6); default-deny holds on prod but a rebuild comes up
    RLS-DISABLED. Codify via its own migration before any environment rebuild.
  * (historical) 001-005 — applied via the dashboard SQL editor, later reconciled
    into the migration set (see the note above); listed for completeness.

SECURITY INCIDENT — anon-callable SECURITY DEFINER RPCs (migration 020, 2026-07-25).
All SEVEN public SECURITY DEFINER function grants were over-broad (PostgreSQL's
default PUBLIC EXECUTE, live since 012 / 2026-07-05); 020 closes all seven. But
the ACTUALLY-EXPLOITABLE surface was NARROWER than "seven" — do not overstate it:
  * EXPLOITABLE (the hole) — the THREE parameter-trusting fns
    (acquire_and_transition_session, apply_morning_flow_turn,
    drain_next_pending_flow): they take p_user_id/p_tenant_id as caller input,
    derive NO identity from auth.uid(), and return non-trigger types, so the
    public ANON key could call them via PostgREST /rpc/ and forge check-in /
    session data for any engineer — bypassing the webhook, Twilio HMAC, and
    idempotency.
  * BOUNDED — complete_onboarding: anon-invocable but self-guards on auth.uid()
    (016 zero-row RAISE rolls back), so an anon call achieves nothing.
  * NOT EXPLOITABLE, hardened for defense-in-depth only — handle_new_user
    (RETURNS trigger) and rls_auto_enable (RETURNS event_trigger): PostgREST does
    NOT expose trigger-returning functions as /rpc/ endpoints AT ALL, so their ACL
    was never a callable vector. get_user_tenant_id under anon just returns NULL
    (no auth.uid() → no row) — harmless. quoco_same_ist_day is a pure helper, out
    of scope.
Pinned evidence: docs/reviews/020-review-package.md. Log-retention exploitation
check: see that package (§ log-retention).

Then in Week 2 (remaining):
- NFR-16 queue helper library (enqueue/claim/complete/fail functions)
- /api/jobs/tick worker endpoint + Vercel cron config
- Migration 007 (auth surgery) — CHECKPOINT 1: booked second-pair-of-eyes
  review with the developer friend BEFORE running on the real database.
  007 decouples users.id from auth.users — irreversible if wrong. Rehearse
  on a Supabase branch snapshot first. Do not run 007 on prod before this
  review.
- Webhook /api/whatsapp/webhook (HMAC, SID idempotency, media pipeline)
- Session state machine (BOT-07 TTL resume, BOT-21 collision) — see bot-flows
- E.164 normalisation
- Morning flow Q1–Q6 incl. BOT-24 responsibility follow-up, BOT-20 site-closed
- Engineer registration ENG-01/02/05/06

BOT-27 reactivation CLEAR-HALF — DONE (2026-07-21, feat/bot-27-reactivation-clear).
Webhook clears messaging_blocked + TwiML-acks an active-but-blocked engineer's
inbound; pure decideInboundGate() + clearMessagingBlock() in
lib/whatsapp/reactivation.ts, unit-tested + a direct clear-half DB test. Opt-in
TEMPLATE re-send deferred (blocked on Twilio sender). See bot-flows.md BOT-27.

BOT-27's SET-HALF DOES NOT EXIST — messaging_blocked IS NEVER SET TRUE (opened
2026-08-10, tracked, PRE-LAUNCH — not DPR backlog, not general debt; surfaced
while establishing facts for the §6 accountability aggregator, before deciding
how to handle its 7-day pattern). Grepped every write path in app/, lib/,
supabase/migrations/: the ONLY place messaging_blocked is ever set true in this
repo is test fixtures (test/reactivation-db.test.ts, test/webhook.test.ts),
simulating a pre-blocked state so the CLEAR half has something to clear. In
application code, only clearMessagingBlock() (lib/whatsapp/reactivation.ts)
ever writes this column, and it only ever writes false. There is no Twilio
status-callback endpoint (app/api/whatsapp/ contains exactly one route, the
inbound webhook) and no cron job touches this column. A real WhatsApp STOP —
or any other outbound delivery failure — currently sets nothing and is
detected nowhere.
  CONSEQUENCE, stated plainly: an engineer who opts out keeps getting
  messaged, because nothing notices they opted out. This is not primarily a
  DPR-quality issue, though it does surface there too (see design-decisions-
  beta-feedback.md §13's accountability-pattern decision, which found this
  while establishing whether §6's pattern was safe to compute) — it is a
  WhatsApp Business quality-rating and compliance problem in its own right.
  Meta throttles messaging limits based on quality rating; repeated sends to
  an opted-out number degrades that rating for the WHOLE product, not one
  feature or section.
  PRE-LAUNCH, not backlog: needs a set-half — a Twilio status-callback
  endpoint, or detecting the inbound STOP text itself, whichever this
  integration actually surfaces — before the production sender (item 5,
  Week 2 checklist above) carries real opt-out traffic. BOT-27's clear-half
  was built and tested against a set-half that was assumed to exist and
  doesn't.

TESTING DEBT — WEBHOOK HTTP HARNESS (opened 2026-07-21, tracked, NOT fixed).
CLAUDE.md §7 requires every webhook change to ship with a T-WH integration test,
"including the forged-signature rejection, T-WH-01". That harness DOES NOT EXIST
today — T-WH-01 is referenced in §7 but was never built (no HTTP-level webhook
test in the repo; only the pure-decision + DB-IO layers are covered). The BOT-27
clear-half (feat/bot-27-reactivation-clear) shipped WITHOUT it — a conscious
deviation approved for that PR: it is inherited debt 2a does not fix but knowingly
adds to. Do not let this silently persist: the next substantive webhook change
should either build the harness (construct Twilio-signed formData; assert
signature rejection + the clear/idempotency behaviour) or consciously re-defer it
here. The rule stops applying only if someone decides so on the record.
  NAMED FUTURE TEST (deferred with the harness, recorded so the reasoning
  survives): a ROUTE-LEVEL test proving RETRY-AFTER-CLEAR cannot fall into the
  morning flow — i.e. an inbound from an active+blocked engineer clears the flag,
  and a Twilio RETRY of that SAME MessageSid (now an active+unblocked user) is a
  no-op, NOT a morning-flow turn. This is the exact scenario the "consume the SID
  BEFORE the clear" ordering in route.ts exists to prevent (see the ACCEPTED
  FAILURE WINDOW comment there); the ordering is currently only argued in comments
  and covered obliquely by the pure idempotency unit — the route-level proof waits
  on the harness.

CLOSED (2026-08-07): test/webhook.test.ts now exists (10 tests, committed
8a24399, feat/022-evening-flow-apply-turn) — the harness this entry tracked as
missing across two deferrals (BOT-27's clear-half took the first; migration
022's review noted the second and named the outstanding test below). It calls
handleWebhookPost (app/api/whatsapp/webhook/route.ts) directly with an
injected test-db client — the SAME function POST calls in production, not a
separate assembly — via genuinely Twilio-signed requests (an independent
HMAC-SHA1 re-implementation in the test file, not a stub or bypass).
  WHY IT STALLED TWICE: not neglect — the harness was structurally blocked
  until six functions in this path (readCurrentFlow, applyMorningFlowTurn,
  applyEveningFlowTurn, dispatchInboundTurn, handleWebhookPost, isNewMessage)
  each independently constructing its own createServiceClient() gained an
  injected-client parameter; the test env deliberately never configures that
  client, and the block was invisible until someone actually tried to test it.
  T-WH-01 is included; its claim is precise, not broader than earned: the
  .env.test TWILIO_AUTH_TOKEN is a fixed, obviously-fake value, so T-WH-01
  proves validateTwilioSignature's algorithm correctly REJECTS a non-matching
  signature — it does NOT prove production's real Vercel-configured token is
  itself correct. "Signature validation is tested" does not extend that far;
  that remains a separate, unverified claim.
  The NAMED FUTURE TEST above is also closed, not left to outlive this entry:
  T-WH-07 runs exactly that sequence — reactivate clears messaging_blocked,
  the SAME MessageSid retried now finds decideInboundGate returning 'proceed'
  (not 'reactivate'), and the ordinary path's own idempotency check catches it
  as a duplicate before it can reach a morning-flow turn. Verified three ways:
  response body, no session row created, no daily_logs row written.
Full test list and design rationale live in test/webhook.test.ts's own header
comment — not restated here.

PROD SMOKE CHECK RESOLVED (2026-07-26): migration 020's real webhook-driven
apply_morning_flow_turn end-to-end check is DONE — a full multi-turn morning flow
(Q1 plan → Q2 → Q3 → Q4 → "check-in complete") ran through the real webhook +
service_role on prod, stronger than the planned single-turn proof. daily_logs
write confirmed (engineer 3534756b…, 2026-07-26). The test engineer + session were
deactivated per the standing artifact discipline. Full evidence:
docs/reviews/020-review-package.md §8 Step 6. (Was DEFERRED 2026-07-25; closed
within the 1-2 day window.)

DATA RETENTION POSTURE — AUDITED 2026-07-27, NO POLICY EXISTS YET.
A read-only audit of the five WhatsApp-flow tables found that NOTHING deletes or
archives a row anywhere in the system: no DELETE/TRUNCATE in any migration, no
pg_cron job in the migration set, no TTL trigger, no archival table. The only
cleanup code in the repo is test-suite-only (test/helpers/db.ts, keyed on the
+19995550 fake-phone prefix, test-db only). vercel.json declares exactly one cron
(/api/jobs/tick, every minute) and that worker contains no deletion.
  * daily_logs, daily_log_edits, jobs, processed_messages — all grow unbounded.
  * whatsapp_sessions does NOT: uq_whatsapp_sessions_phone_number (012:34) caps it
    at ONE row per phone number, reused in place via ON CONFLICT. Its ceiling is
    distinct numbers ever seen, not messages or days. Needs no retention policy.
  * whatsapp_sessions.expires_at is WRITTEN AND NEVER READ — no WHERE, no
    comparison, in SQL or TypeScript. The real session lifecycle is
    quoco_same_ist_day(p_now, updated_at) (018:105), an IST calendar-day
    comparison. So BOT-07's "30-minute TTL" is not enforced today; that is not a
    bug (both same-day branches of the spec resume identically, so the TTL has no
    behavioural consequence to enforce) but it becomes load-bearing the moment a
    resume-specific message ships per Rule 3.6.
  * processed_messages is the fastest-growing table: one row per INBOUND message,
    ~13/engineer/site-day at full Spine (~195k/yr at 50 engineers). Rows are
    permanently useless after ~24h — Twilio retries within minutes, and the
    idempotency check never SELECTs (it inserts and catches 23505). 011:20-23
    already suggests a 7-day prune; nothing implements it. NOTE: there is no index
    on created_at, so that prune would seq-scan the whole table — BRIN on
    created_at is the right support (append-only, physically time-ordered), not a
    btree.
THREE DIFFERENT TREATMENTS, do not conflate: processed_messages is pure hygiene
(prune freely); jobs is hygiene with a caveat (prune 'succeeded', KEEP 'failed' —
the NFR-17 dead-letter record); daily_logs + daily_log_edits are NOT hygiene at
all — they are the business record behind every DPR ever sent, and 019 makes
daily_log_edits the SOURCE OF TRUTH the future generator must consult. Retention
there is a compliance question (how long a contractor must retain daily progress
records), never a storage one.
Migration 021 came out of this audit but removes INDEX OVERHEAD ONLY — it prunes
nothing. Full audit + growth model: docs/reviews/021-review-package.md.

DATED ADDITION (2026-08-13, migration 027 external review, non-blocking
finding #5) — `checkin_escalations` (~~unapplied~~ APPLIED TO PROD
2026-08-13, see the dated entry near the end of this section;
docs/reviews/027-review-package.md) joins this register with its own line
rather than the unbounded-growth list unrecorded. Grain is one row per (project, engineer,
log_date, half) — roughly 2x `daily_logs`' own growth rate (two halves per
engineer-day instead of one row). Per 021's taxonomy above, this is
CLASSIFIED PRUNABLE HYGIENE, not a compliance record: DASH-01 (its only
planned reader) cares about TODAY's exceptions, not history; a future
7-day/30-day pattern view — if ever built — is a new, separate design
question, not a reason to keep every row indefinitely by default. Contrast
deliberately with daily_logs/daily_log_edits just above: those are the
business record behind every DPR ever sent and retention there is a
compliance question; this table is operational tracking state for a
notification pipeline and has no such claim on permanence. No prune
mechanism is built — this is a classification, not an implementation, same
as this whole register describes a posture nothing yet enforces.

PARSER DEBT — RULE 3.5's LOW-CONFIDENCE FLAG DOES NOT EXIST (opened 2026-07-28,
tracked, NOT fixed). Cross-cutting: affects EVERY future consumer of parsed
check-in data, not one flow. Rule 3.5 (docs/design-principles.md:31 — note:
design-principles, NOT bot-flows, where it is sometimes miscited) promises that an
unparseable reply gets one example, ONE re-ask, then "accept whatever comes and
flag it low-confidence for PM review."
  * The ACCEPT-AND-ADVANCE half IS implemented — morning's per-step re-ask budget
    (MORNING_PARSE_REASK_CAP; q2_reask/q3_reask counters in session context,
    mirrored in the 018 RPC).
  * The FLAG half is NOT. LabourParse is {planned_total, by_trade, raw_text} and
    EquipmentParse is {items, none, raw_text} — neither carries a confidence
    field, and no daily_logs column records one.
CONSEQUENCE: an answer accepted AFTER exhausting its re-ask is indistinguishable
from a cleanly-parsed one, and the PM has nothing to review — Rule 3.5's promise
is half-kept. Live since Pass 2 (migration 018). Until this is built, anything
consuming parsed data (DPR generation, dashboard, the §6 efficiency calculations)
MUST assume no confidence signal exists and treat every parsed value as equally
trusted, because that is the current reality. Do not design a consumer that reads
a confidence field expecting it to be populated. Origin + full reasoning:
docs/design-decisions-beta-feedback.md §9 (evening Q4 v1 scope), where this was
first written down before being promoted here as cross-cutting debt.

HIGH-1 (users_update self-privilege-escalation) — CLOSED by migration 015,
applied to prod 2026-07-12, dual-verified and externally reviewed. Full
record: docs/schema.md:497-517 + docs/reviews/015-review-package.md. Standing
regression guard: test/migration-015.test.ts (6 tests, real authenticated JWT
clients — never service-role, which bypasses both RLS and column grants and
would pass by construction). Independently re-confirmed on prod 2026-08-03:
authenticated holds column-level UPDATE on (full_name, avatar_url) only, no
table-level UPDATE. Full re-confirmation evidence: 015-review-package.md §7.
This entry exists because CLAUDE.md previously had zero reference to 015,
causing an external audit to flag it as possibly-unfixed — a cross-reference
gap, not a fix gap (P3 data point).

EQUIPMENT daily_hire_cost — A COUNT IN A MONEY FIELD (opened 2026-08-05,
tracked, NOT fixed). Pre-existing 018-era parser behavior, surfaced during
migration 022's review (R5 rehearsal, engineer C: "1 JCB, 2 mixers" parsed to
daily_hire_cost: 1 / daily_hire_cost: 2, count: null on both). equipment.ts's
parseChunk (018, unrelated to 022, deliberately left alone there — see
docs/reviews/022-review-package.md §10) reads the FIRST number in a chunk as a
daily hire RATE, never a count, by design ("the field gives rates ('JCB
1500'), not counts" — equipment.ts:50-54). A terse answer that leads with a
count rather than a rate ("2 mixers", "1 JCB") lands that count directly in a
field two future consumers will read as money:
  * design-decisions-beta-feedback.md §6 — "Machinery wastage ₹ = idle hours
    × hire rate," a weekly-review costing calculation.
  * bot-flows.md's DPR generation job — "Idle cost per machine = daily_hire_
    cost × (1 − actual_hours/available_hours)," computed IN CODE and injected
    as a FACT into the Claude prompt (bot-flows.md, "What the job does").
CONSEQUENCE: neither consumer has any signal that a given daily_hire_cost is a
miscaptured count rather than a real rate. The DPR path is the sharper risk —
a count masquerading as a rate becomes a stated currency figure in the
generated report itself, not a visible error a PM would catch and question.
Until this is fixed, any future consumer of morning_equipment MUST treat
daily_hire_cost as unverified and MUST NOT assume it is always a genuine rate.
Same class of finding as PARSER DEBT above (a downstream consumer inherits a
silent gap unless warned here first) — this entry exists so the next author
gets the warning, not the surprise. Full finding + citations:
docs/reviews/022-review-package.md §10.

DATED FINDING (2026-08-13, live E2E smoke, real handset) — A DISTINCT FAILURE
ON THE SAME PATH, TWO CHARACTERS WIDE. Not the count-vs-rate confusion above —
this is an UNRECOGNISED equipment name reaching a stored `type`, confirmed by
tracing parseChunk (equipment.ts) against a real prod row, not inferred.
Engineer typed "Job 15oo" for Q3 (meant "JCB 1500" — two typos: "Job" for
"JCB", letter-o's for zeros). Traced end to end: `splitDigitBoundaries` yields
tokens `["job", "15", "oo"]`; `canonicalEquipment("job")` returns `null`
(`EQUIPMENT_ALIASES` has `jcb: 'jcb'`, no entry for `"job"` — checked the
literal map, not assumed); `"job"` isn't in `RATE_STOPWORDS` either, so it
survives as `firstNameWord`; `"15"` sets `cost`, so `hasNumber` is true and
the `keyword === null && !hasNumber` gate — the ONLY thing standing between an
unrecognised word and a stored type — does not fire, because a number
anywhere in the chunk is enough to pass it regardless of whether the word next
to it means anything. Stored on prod: `daily_logs.morning_equipment.items[0]`
= `{type: "job", daily_hire_cost: 15, count: null, owned_or_hired: null, raw:
"Job 15oo"}`. `isEquipmentAnswered` returned true (`items.length > 0`), so no
reask fired — the bot advanced normally, same as a clean answer.

SIGNIFICANCE, stated plainly, not as a curiosity: `daily_hire_cost` feeds
idle-cost arithmetic, one of the few RUPEE figures that reaches an owner
(design-principles.md Rule 5.4 — "rupees over percentages"). A two-character
typo produced a confidently-wrong money value, silently, with no reask and no
low-confidence flag anywhere on the path. Every numeric safeguard this project
has built so far — containment (lib/dpr/containment.ts), the weak-anchor
rules, `numbers_discarded` — lives on the productivity/manpower path
(productivity.ts, evening.ts). The equipment path has none of it. Left in
place deliberately for tonight's DPR — see the live-E2E-test framing below —
so the actual downstream effect can be observed in a real generated report
before anything is decided.

NOT FIXED TODAY, ON PURPOSE — this is a live end-to-end smoke test and the
wrong value flowing into tonight's DPR is the most useful part of it. Two
questions named for follow-up, deliberately NOT answered here:
  a. Should an unrecognised equipment name be accepted as a stored `type` at
     all, or reasked once? `"job"` matched nothing in `EQUIPMENT_ALIASES` and
     still became a stored type — is "a number was present somewhere in the
     chunk" the right bar for confidence, or should an unrecognised keyword
     alongside a number still count as garbled?
  b. Should an implausible hire rate (₹15/day for plant machinery) be
     flagged? Note the tension with this project's own standing posture
     BEFORE trying to resolve it: this codebase has repeatedly refused to
     guess (see the NULL-not-defaulted-to-0 fixes throughout productivity.ts
     and evening.ts) — a plausibility range is itself a form of guessing.
     Not resolved here.

DATED REFRAME (2026-08-13, same day, Aravind's question) — FUZZY MATCHING
(item (a) above) IS THE SMALLER HALF OF THIS FINDING; THE ROOT CAUSE IS
STRUCTURAL, NOT A MISSED RULE. Aravind's question: under this project's
own never-guess posture, why was `15` recorded from an ambiguous "15oo"
at all? Answer, confirmed by reading every parser's own output TYPE, not
inferred: BECAUSE NOTHING ON THIS PATH CAN EXPRESS UNCERTAINTY.
`EquipmentItem` is `{type, count, owned_or_hired, daily_hire_cost, raw}` —
no confidence field, no discard flag, no equivalent of
`numbers_discarded`. Faced with something ambiguous, the parser has
exactly two options — store a value or store nothing — and "15" looked
like a value. It did not violate a rule it was following; the rule was
never applied to this layer at all.

Checked across EVERY parser in `lib/whatsapp/flows/parsers/`, not just
this one (five modules, not four — corrected below):
  * `productivity.ts` (evening Q4 productivity/idle) — FULLY WIRED:
    `numbers_discarded: boolean` on its own output type, consumed by the
    caller (`evening.ts`) to downgrade `evening_productive_manpower.
    confidence`, which IS persisted. Built ONLY because the 2026-08-10
    inversion incident forced it (this file's own SEVERE BUG note).
  * `quantities.ts` (evening Q1 quantities enrichment) — HALF-WIRED:
    `numbers_discarded: boolean` exists on `QuantityItem`, found the SAME
    day (2026-08-10) as productivity's bug, by the same root cause ("M25"
    dropping its digit the identical way) — and it DOES persist verbatim
    to `daily_logs` (the whole `QuantitiesParse` is stored as-is). But
    nothing downstream reads it: no renderer, no DPR consumer, nothing
    "reasons about it yet" (the file's own comment). A signal that exists
    and is even saved, but dies unread — the same class of gap CLAUDE.md's
    own PARSER DEBT entry above already tracks for Rule 3.5's low-
    confidence flag.
  * `equipment.ts` (morning Q3) — NO SIGNAL AT ALL. Confirmed by reading
    `EquipmentItem`/`EquipmentParse` directly. Caught TODAY.
  * `equipment-hours.ts` (evening Q5) — NO PER-VALUE SIGNAL EITHER.
    `EquipmentHoursItem` has no confidence/discard field. It has coarse
    ARITHMETIC GUARDS (`actual_hours > available_hours`,
    `available_hours > 24`) that REJECT an entire chunk outright — binary
    accept/reject, not a graded uncertainty signal, and no help against a
    typo that still produces an in-range number. The caller (`evening.ts`)
    does compute an outer `confidence` for `evening_equipment_utilisation`,
    but off "was the reask budget exhausted," never off any per-token
    ambiguity the parser itself detected — a different, coarser signal
    than productivity's.
  * `labour.ts` (morning Q2 workers-planned AND evening Q4a headcount,
    shared) — NO SIGNAL AT ALL. Not yet caught by any incident.

So: THREE of five parsers (`labour.ts`, `equipment.ts`, `equipment-hours.
ts`) have no way to express uncertainty whatsoever; one (`quantities.ts`)
has a signal that reaches storage and dies there unread; one
(`productivity.ts`) is the only fully closed loop, built reactively after
a real report was confidently wrong. This discipline has been applied
REACTIVELY, one parser at a time, ONLY after each was caught — never
designed in up front. Today's equipment.ts finding is the FIRST of the
three zero-signal parsers to be caught by a live incident, not the
"second of four" as first framed — `labour.ts` and `equipment-hours.ts`
remain equally exposed and uncaught.

SECOND FAILURE, UNDERNEATH THE FIRST, CONFIRMED SYSTEMIC — the evidence is
destroyed before any number-handling could run, in every one of these
five files, not just this one. Each parser independently defines its own
copy of `splitDigitBoundaries` (grepped: five separate function bodies,
not a shared import from `lexicon.ts` — `quantities.ts`'s is a
decimal-aware variant, the other four are identical) as its FIRST
tokenisation step. `splitDigitBoundaries("15oo")` produces `["15", "oo"]`
before any digit-run is ever inspected as a whole — the parser sees a
clean "15" indistinguishable from a deliberately-typed "15 oo". A more
careful parseChunk could not have caught this even if `numbers_discarded`
existed on `EquipmentItem` today, because the questionable evidence (the
original contiguous "15oo") is already gone by the time any such check
would run. Malformed-numeric-token detection MUST happen BEFORE this
digit-boundary split, in whichever parser it's added to — not inside
`parseChunk`, where every file currently puts its logic.

PLAN PRIORITY, STATED IN ORDER SO ITEM 3 DOES NOT CROWD OUT 1 AND 2 (item
3 — fuzzy equipment-name matching with an echoed confirmation, per
design-principles.md Rule 3.4 — is real and worth building, but it is not
what produced tonight's wrong rupee figure):
  1. Give these parsers a way to express uncertainty at all — the same
     shape problem `lib/dpr/schema.ts`'s `CapturedCount`
     (`status: 'reported'|'zero'|'not_captured'`) already solved for
     zero-versus-absent, one layer further downstream. This is the parser
     layer's own version of that same problem, one layer earlier in the
     pipeline.
  2. Detect malformed numeric tokens BEFORE `splitDigitBoundaries` runs,
     project-wide (all five files), since tokenisation is what destroys
     the evidence a later check would need.
  3. Fuzzy equipment-name matching with echo-back (Rule 3.4) — the item
     Aravind originally asked about; worth doing, but downstream of 1 and
     2, not a substitute for either.
Not built here — analysis only, same live-E2E-test discipline as the
entry above.

CANDIDATE CI CHECK — NO createServiceClient() WHERE AN INJECTED CLIENT COULD
BE ACCEPTED (opened 2026-08-07, tracked, NOT built). Surfaced while building
the webhook HTTP harness (test/webhook.test.ts, CLOSED above): six functions
in the WhatsApp inbound path — readCurrentFlow, applyMorningFlowTurn,
applyEveningFlowTurn, dispatchInboundTurn, handleWebhookPost, isNewMessage —
each independently constructed its own createServiceClient() instead of
accepting one as a parameter, and the harness could not reach test-db through
ANY of them until all six gained an injected-client parameter. The fix
pattern was not new to invent: clearMessagingBlock (lib/whatsapp/
reactivation.ts) already took its client as a parameter, one directory over,
before any of the six were touched — the pattern existed and was simply not
applied consistently.
  WHAT IT WOULD FORBID: createServiceClient() called inside a function body
  where an injected-client parameter is a viable alternative (i.e. the
  function is reachable from application code that could pass one down) —
  flag the call at write time, not leave it to be rediscovered.
  WHY IT'S WORTH ENFORCING: the failure mode is invisible until someone tries
  to test the code — by which point the constructing function may already
  have several call sites, and the fix becomes a multi-function refactor
  instead of a one-line addition made at write time.
NOT a rule to follow by hand today. Writing this as prose for a human to
self-apply would BE the honour-system enforcement gap the process-hardening
work order's P2 (CI gates) exists to close — so this is captured strictly as
a CANDIDATE CHECK for when P2 is built, not a standing style rule. It belongs
in P2's stage 1 (tsc/lint/test) — it is a TypeScript/source rule, not a
migration-file rule, so it does NOT belong in that work order's stage-2
migration-linter table. The work order itself is NOT committed to this repo
as of 2026-08-07 — the only trace found is docs/reviews/015-review-package.md
§7, which refers to it as an external process audit, not a repo artifact.
Capture only; nothing here is enforced until P2 exists.
CLOSES WHEN: folded into the P2 stage-1 (tsc/lint/test) plan at kickoff.

P3 SCOPE CAPTURE — RULES-FILE STALENESS TRIAGE TEST (opened 2026-08-07,
tracked, NOT applied file-wide). Origin: the §6 migration-numbering fix in
the P1 correction pass (PR #23) replaced a hardcoded range ("001-006 live,
new changes go in 007/008/009") with a rule that names the check command
instead of a number — the reviewer generalized that single fix into a
reusable test during that PR's review, worth recording here rather than
letting it live only in a PR comment.
  THE TRIAGE TEST: any line in this file that will become false through the
  mere passage of normal work — a number, a "pending," a "not yet" — either
  becomes a SELF-VERIFYING rule (name the command, as the §6 fix did) or
  MOVES TO THE DATED LOG (§10, as every other correction in this file
  already does). Applied file-wide, this is most of P3's triage decided in
  advance: for every remaining line, the test itself says which bucket it
  falls into — P3 doesn't need to invent a sorting method, only run this one
  against the whole file.
  THE LENGTH OBSERVATION: P1 added 30 net lines to this file (43
  insertions, 13 deletions — commit 991cc8a), whose
  known failure mode (the reason §1-9 were split out into linked docs at
  all) is length-driven instruction loss — the more that's in front of a
  fresh session, the more of it can silently go unread or deprioritized.
  Each P1 correction correctly carries its dated history, per this file's
  own standing provenance discipline — right for a correction pass, since
  silently rewriting history is exactly what §0 forbids. But that means
  corrections ACCUMULATE length rather than shrink it, which makes evicting
  resolved dated history out of the live instructions (the heart of what P3
  is for) MORE necessary after this pass, not less.
NOT itself a P3 plan — a capture of two inputs P3 should start from, same
spirit as the CANDIDATE CI CHECK entry above: recorded so it's available
when that work starts, not requiring rediscovery from a PR thread.
CLOSES WHEN: folded into the P3 plan at kickoff.

DASH-04 DPR ARCHIVE SHIPS LIST-ONLY IN MIGRATION 023's PR (2026-08-07). The
page (`app/(dashboard)/dprs/page.tsx`) had a "View" link to a per-DPR detail
route that has never existed — `app/(dashboard)/dprs/[id]/page.tsx` was never
built, so bot-flows.md's DASH-04 spec ("list + full view") has only ever
shipped its list half. The link also predated the 023 repoint entirely (it
was broken in the original stub, confirmed via `git show` against the exact
commit that touched this file) and was wrong-shaped on top of being a dead
end: `/dashboard/dprs/${id}` — the `(dashboard)` segment is a Next.js route
GROUP and contributes no URL segment; every other link in this app already
omits it, this href was the one outlier. Removed (link + its `<th>`/`<td>`)
rather than fixed, since a corrected-but-still-dead link would still 404 and
there's no DPR content to view yet regardless (nothing populates `dprs`
until the generator ships — see the Claude API / DPR generation Phase 0-1
work). Whoever builds the detail route needs BOTH facts, not just that a
link is now gone: the route needs to be built from scratch (nothing to
resurrect), and the URL must NOT carry the `(dashboard)` prefix when it is.

DPRS PAGE SWALLOWS QUERY ERRORS (opened 2026-08-07, tracked, NOT fixed —
this instruction failed to land the first time it was sent, mid-session,
while another tool call was running; recorded here now on the retry so it
doesn't depend on a message actually arriving). `app/(dashboard)/dprs/page.tsx`
destructures only `{ data }` from the `dprs` query — `error` is never
read. `dprs = (data ?? []) as unknown as DprRow[]` collapses "genuinely
zero rows" and "the query failed" into the identical empty array, so a
failed read renders the SAME "No DPRs generated yet" state as a working
page with nothing in it yet. A PM has no way to tell "the system hasn't
generated anything" from "the system is broken" — the page actively hides
the exact failure that should make them escalate. NEEDS, before real PMs
are on this page: a distinct error state (visually different from the
empty state) and Sentry capture of the swallowed error — this route
currently violates CLAUDE.md §6's "log to Sentry in production" rule for
external calls.
  WHY THE 023 MERGE-BEFORE-APPLY WINDOW WAS HARMLESS, NOT JUST LUCKY —
  this same bug is the reason, worth recording rather than treating as a
  coincidence. Migration 023 (docs/reviews/023-review-package.md §7,
  option B) merged to `main` and deployed to prod BEFORE its own apply, so
  between merge and apply prod's live `page.tsx` queried a `dprs` table
  that did not exist there yet. That query genuinely errored on every
  request during that window (`relation "public.dprs" does not exist` or
  the PostgREST equivalent) — and because the error is swallowed, prod did
  NOT 500 or show a broken page: it silently rendered the ordinary
  empty-archive state, indistinguishable BY CONSTRUCTION OF THIS BUG from
  "no DPRs generated yet," which is also the page's true state before real
  generation exists regardless. The window was cosmetically silent, not
  functionally safe — the error was real and invisible to Sentry for the
  same reason this needs fixing, not because nothing went wrong.

MIGRATION 023 APPLIED TO PRODUCTION (2026-08-07, 20:44 IST). `public.dprs`
created — Phase 0 of the Claude API / DPR generation build — and
`daily_logs.dpr_content` dropped (0 rows, probe-backed both pre-apply and
again at apply time). `app/(dashboard)/dprs/page.tsx` was already repointed
at the new table and on prod since the PR merged ahead of this apply
(deliberate option-B ordering, docs/reviews/023-review-package.md §7 —
`types/database.ts` was regenerated against test-db BEFORE the apply and
confirmed BYTE-IDENTICAL against a fresh prod regen AFTER it, sha256
match, no drift). PITR observed by direct dashboard inspection before the
apply (CLAUDE.md §0, not a checklist entry); rollback target 20:43 IST, 7
Aug 2026. All six post-apply verification queries on prod matched the
test-db rehearsal exactly — columns, RLS state (`relrowsecurity=true`,
`relforcerowsecurity=false`), policy shape (`dprs_select`,
`roles={authenticated}`), `relacl`
(`{postgres=arwdDxtm,anon=rDxtm,authenticated=rDxtm,service_role=arwdDxtm}`),
constraints, `dpr_content`'s absence. `ensure_rls` (the prod-only event
trigger tracked in the OUT-OF-BAND DB OBJECTS registry above;
023-review-package.md §4) fired exactly as predicted and was a non-event.
Full record: docs/schema.md's own `dprs` entry and
docs/reviews/023-review-package.md §12 — fuller than this pointer, read
those for the complete evidence.
  NOT closed out by this apply: the DPR generator itself (Phase 1 — the
  Claude API client, the `dpr_generate` job handler) does not exist yet;
  `dprs` is schema-only until that ships. Migration 024 (the systemic
  `anon`/`authenticated` TRUNCATE/REFERENCES/TRIGGER grant sweep,
  023-review-package.md §3) stays deferred, not part of this apply. The
  DPRS PAGE SWALLOWS QUERY ERRORS gap above also stays open — unrelated to
  this apply, not fixed by it.

HAND-MIRRORED RECONCILIATION, TWO COPIES, NOTHING ENFORCES AGREEMENT (opened
2026-08-10, tracked, NOT fixed). Migration 025 (unapplied — see below) fixes a
severe productive/idle inversion bug by adding the SAME reconciliation logic
in two places that have to agree by construction and nothing else:
lib/whatsapp/flows/evening.ts's TS "pure mirror" (predicts what the RPC will
do, used by callers before the RPC call) and 025's own PL/pgSQL body (what
actually writes daily_logs). This is not a new pattern — the whole reason 025
needed a SQL change at all, on top of the TS-side fix, is that this same
migration's RPC already had its own independent, duplicate implementation of
the ORIGINAL idle/productive derivation, silently diverged from the parser it
was meant to reflect. The design-review pass that caught Defects 1-3 in 025's
first draft (2026-08-10, before the file was ever committed) found all three
by hand-tracing BOTH copies separately — nothing in the test suite or the
type system would have caught a divergence between them if one copy had been
fixed and the other missed, which is close to what actually happened on the
first pass (the TS fix alone shipped 4 of 5 new integration tests red,
because the SQL copy never read the parser's new fields at all). This is the
FOURTH defect of this general shape found in this repo's history (three
instances fixed by inspection in this review pass, this fourth one is
structural and wasn't). NEEDED: a test that runs both copies (the TS mirror
directly, and the RPC via a real call) against the SAME fixture set and
asserts identical output — ~~not built here, deliberately deferred, and named
as the FIRST item for the next session rather than left to be rediscovered.~~

DATED AMENDMENT (2026-08-11, Aravind's decision): the "FIRST item for the
next session" framing is retired — it slipped three sessions running (this
one included) and would slip again, since a date-based deferral competes
with whatever the next session's actual priority turns out to be and always
loses. Replaced with a CONDITIONAL GATE instead of a date: this pure-mirror
test is REQUIRED BEFORE the next change to `lib/whatsapp/flows/evening.ts`
or to the evening RPC (`apply_evening_flow_turn`) — whichever comes first.
Not required before unrelated work. Rationale: the risk this test guards
against — the TS mirror and the SQL body silently diverging — can only
materialise when that code is next edited; the evening flow is complete and
frozen as of 025's apply, so nothing is at risk while it stays untouched. A
gate tied to the triggering event fires exactly when it matters, instead of
competing with whatever else the next session happens to prioritize.

CONDITIONAL GATE RETIRED, REPLACED BY A CONTINUOUSLY-RUNNING TEST (2026-08-12,
Aravind's decision, external review of the 024+025 catch-up package). The
gate above assumed the risk it guarded — the TS mirror and the SQL body
silently diverging — could only materialise when one of the two copies is
NEXT EDITED, and that "the evening flow is complete and frozen... so nothing
is at risk while it stays untouched." Both halves of that assumption are now
known false, by two independent incidents, neither of which involved editing
either copy:
  1. THE DB PUSH INCIDENT (CLAUDE.md §0, this same file). Rehearsing an
     UNRELATED migration (026) required catching test-db up on 022-025;
     `supabase db push`'s ledger-lag blind spot caused 022's CREATE OR
     REPLACE to silently overwrite test-db's already-correct 025 body with
     a pre-024 one. No one edited evening.ts or apply_evening_flow_turn.
     The SQL copy still drifted.
  2. THE FRESH-BRANCH auth_id REPLAY BUG (docs/reviews/supabase-fresh-
     branch-auth-id-bug.md), earlier and independent: a freshly-provisioned
     Supabase branch's REPLAY of the migration files from scratch was
     observed to come up missing a column two independent branches both
     needed, with no single migration responsible and no edit triggering
     it — schema drift from the mechanics of replay itself, not from
     anyone changing a file.
Two instances of the same shape — drift with no authored edit as the
trigger — is what overturns the gate's premise: a mechanism that only fires
on an intentional edit is structurally blind to drift that doesn't come from
one, and this project now has direct evidence that kind of drift is not
rare enough to assume away. REPLACED with
`test/productivity-reconciliation-mirror.test.ts`: one shared fixture table
(headcount + raw reply -> expected idle_count/productive_count/confidence),
run twice — once against `dispatchEveningFlow` directly (no DB), once
against `apply_evening_flow_turn` via a real RPC call on test-db. A case
added to only one side is not expressible, since both halves iterate the
SAME array. This test runs on every CI invocation, same as any other suite
— it has no dependency on anyone remembering an edit happened, which is
exactly the property the retired gate lacked. Includes explicit NEGATIVE
cases (messages that must stay `confidence: 'high'`) alongside the cases
that must go `'low'` — a suite that only asserts the low-confidence
direction would pass even if every message were pushed toward low
confidence, and a report that never states a number confidently is not a
report anyone pays for.

RECORDED, GATED, NOT BUILT: the long-term shape this points toward. The TS
mirror is not load-bearing at runtime today — the webhook acts on the RPC's
returned outcome and step, never on the mirror's predicted counts
(dispatchEveningFlow's own AUTHORITY NOTE, evening.ts) — so the two-copy
design exists for tests and documentation, not because production needs
both. The eventual right shape is likely a SINGLE source of truth (the RPC)
with the TS copy demoted to a test oracle rather than a second independent
implementation asserted to agree with the first. Gated behind
`productivity-reconciliation-mirror.test.ts` actually existing and staying
green for a while first — demoting the mirror before there's a proven,
continuously-run agreement check would remove the one thing currently
proving the two copies match, with nothing yet in place to prove a
single-source rewrite is equivalent. Not built here.

MIGRATION 025 APPLIED TO PRODUCTION (2026-08-11, 09:35 IST). Supersedes the
entry immediately below — kept struck-through, not deleted, per this file's
own correction discipline.

~~MIGRATION 025 WRITTEN, REHEARSED, NOT YET APPLIED (2026-08-10). Fixes the
productive/idle inversion bug found by the evening-flow sandbox smoke test
(see docs/design-decisions-beta-feedback.md and productivity.ts's own SEVERE
BUG note) plus three further defects found in design review before the file
was ever committed (see 025's own header for the full incident-by-incident
record — a YES_WORD masking a stated idle count, a missing upper guard on
the productive-only derivation, and a stated productive count silently
dropped when headcount is unknown). Rehearsed against test-db twice (before
and after the design-review amendment) — full T-024 suite green both times,
31/31 on the second pass. Confirmed via direct `pg_proc.prosrc` probe, not
just a green suite, that prod is still running 024's original (buggy) body.
Not committed, not pushed, not applied — waiting on explicit go-ahead, same
discipline as every other prod-affecting change this session.~~

DATED UPDATE (2026-08-11, 09:35 IST): applied, verified end to end, not just
by hash. PITR observed by direct API call (`supabase backups list`, not a
logged claim — §0's rule) before touching anything: `pitr_enabled: true`,
`walg_enabled: true`, restore window 2026-08-04 22:00:50 IST -> 2026-08-10
22:07:54 IST. Pre-apply baseline pinned: `apply_evening_flow_turn`
prosrc_md5 `f54ed043bb90515ced8d0e9906882dac` (024's original body, 29620
chars) — the rollback reference if 025 is ever reverted; the actual rollback
ARTIFACT is `git show 10ce89a:supabase/migrations/024_evening_flow_q4_q5.sql`
(the commit that last touched 024, confirmed identical to HEAD), not the
hash — a hash proves drift, it can't restore anything. Post-apply: prosrc_md5
`9bd64d28c9cbf0056c7fd63a83c12d3b` (35150 chars), byte-for-byte identical to
test-db's independently-reprobed reference (test-db was not re-hashed from a
stale log line — confirmed live, both guard strings grepped present in its
current body before trusting it as the reference). Both guards confirmed
present in prod's post-apply body by direct grep:
`v_productive_count_stated > v_headcount` and `v_headcount IS NULL AND
v_productive_count_stated IS NOT NULL`.

BUG PROVEN DEAD ON PROD, not just the right text installed — a matching hash
has fooled this project before (§0). Real webhook round trip:
`whatsapp_sessions` seeded to evening step 4 (Q4a), same substitute
precedent as 020's smoke check (no evening equivalent of
`ENABLE_TEST_FLOW_TRIGGER` exists). Test engineer 3534756b sent headcount
`18`, then `15 productive 3 idle waiting for jamaan` — the reason word
deliberately varied from the original incident's "material," so the proof
isn't keyed to that literal phrase. Stored: `evening_workers_on_site` 18,
`productive_count` 15, `idle_count` 3, `idle_reason` "waiting for jamaan",
`confidence` "high", `raw_text` verbatim. Pre-fix, this shape of input
produced `idle_count` 15 / `productive_count` 3 — inverted. Both the test
engineer (`status='deactivated'`) and its session (flow/step reset to
null/0) were deactivated afterward, per the standing artifact discipline.

PRESERVED ARTIFACT (2026-08-11, before being overwritten): the `daily_logs`
row above was subsequently REUSED and OVERWRITTEN by the same-day evening-
flow sandbox scenario 2/3 smoke run (same engineer, project, log_date — the
RPC upserts on that triple, so a same-day re-run of the flow always lands on
the same row). The values quoted in the paragraph above (18 / 15 / 3 /
"waiting for jamaan") will no longer be readable from `daily_logs` once that
run completes. This is the verbatim pre-overwrite read, the actual record of
what the 025 apply proved, captured for exactly that reason:

```
{
  "engineer_id": "3534756b-2a32-4b91-954b-0bab15c2dba1",
  "project_id": "acef67fe-e775-439d-82b8-5b8526868d6d",
  "log_date": "2026-08-11",
  "evening_workers_on_site": 18,
  "evening_productive_manpower": {
    "confidence": "high",
    "idle_count": 3,
    "idle_reason": "waiting for jamaan",
    "productive_count": 15,
    "raw_text": "15 productive 3 idle waiting for jamaan"
  },
  "evening_equipment_utilisation": {
    "confidence": null,
    "items": [],
    "raw_text": null
  },
  "evening_submitted_at": "2026-08-11 03:59:11.644979+00"
}
```

EVENING FLOW SANDBOX SCENARIOS 2/3 — CLOSED (2026-08-11, same day as the
apply, against prod). The original bug was found by exactly one hand-run
scenario; that same narrowness of coverage is what let the inversion reach
prod in the first place, so the remaining scenarios were run rather than
left implied. Three rounds, all against prod, same test engineer
(3534756b), reactivated and re-deactivated around the work:

- **Round 1 (Scenario 2 — terse/unlabelled replies)**: `yes` (Q2) ->
  `12` (Q4a) -> `2` (Q4b, bare number, no anchor word). Bot replies observed
  directly: `yes` produced the headcount question immediately (Q3 correctly
  skipped), `2` produced "Evening check-in complete" with no equipment
  prompt in between. Stored: `evening_schedule_met` true,
  `evening_workers_on_site` 12, `evening_productive_manpower` `{idle_count:
  2, productive_count: 10, idle_reason: null, confidence: "high", raw_text:
  "2"}`. The unanchored-single-number default (unchanged by the Defect 1
  fix) still works correctly on prod.
- **Round 1 also closes Scenario 3 (Q5 auto-skip, BOT-22)**: no morning
  equipment existed for this engineer/day, so the same round triggered the
  auto-skip path. `evening_equipment_utilisation` stored exactly
  `{"items": [], "confidence": null, "raw_text": null}` — checked precisely,
  not assumed: this is NOT a fabricated zero (no numeric field exists here
  to have defaulted wrong, unlike the idle_count-defaulted-to-0 class of bug
  024 already fixed) and NOT a null column — it is the deliberate
  not-captured shape the auto-skip write path (024) has always produced.
- **Round 2 (Defect 1 phrasing, a YES_WORD plus a number — never
  round-tripped on prod before this)**: re-seeded to step 4, `12` (Q4a) ->
  `Ok 2 idle waiting for cement` (Q4b). Stored: `evening_workers_on_site`
  12, `evening_productive_manpower` `{idle_count: 2, productive_count: 10,
  idle_reason: "waiting for cement", confidence: "high", raw_text: "Ok 2
  idle waiting for cement"}`. `idle_reason` is exactly "waiting for
  cement" — `'ok'` was consumed as a stopword, not leaked into the reason
  text. PRE-FIX this exact message produced `all_productive: true` ->
  `idle_count` 0, `productive_count` 12, confidence "high" — two idle men
  reported and recorded as a fully productive day, confidently wrong. It
  does not on prod today.

Test engineer deactivated and session reset (flow/step null/0) after the
final round, same discipline as every other round this session. **Evening
flow's sandbox coverage is now complete** — all three flow shapes flagged
as never having been round-tripped (terse/unlabelled, auto-skip, and the
Defect-1-specific YES_WORD-plus-number phrasing) have each been proven on
prod, not just on test-db.

Ledger repaired in the same pass: `'023'`, `'024'`, and `'025'` were ALL
THREE missing (023/024 from the pre-existing CLI-tracking lag already
documented elsewhere in this file; 025 because it was new) — 19 -> 22 rows,
observed on both sides, no duplicates. `types/database.ts` regenerated
against prod and diffed empty, confirmed rather than assumed (025 changes a
function body only, same 10-arg signature).

~~PROCESS NOTE — DECISION NEEDED FROM ARAVIND, NOT SETTLED HERE: this apply
used `supabase db query --linked -f <file>` against prod rather than the
Supabase SQL Editor the runbook specified — flagged live during the run, not
silently substituted. No browser/GUI access exists in this environment to do
the visual project-selector confirmation the runbook asked for; `db query`
was independently verified to exist (`supabase db --help`) and to run the
file's own `BEGIN;`/`COMMIT;` as one atomic statement before being used —
the same mechanism already used for every test-db rehearsal this cycle, now
also used once against prod. Open question: amend the standing instruction
to accept `db query --linked -f <file>` as the documented prod-apply path
going forward, or keep "SQL Editor" as the rule and treat this apply as a
one-off exception forced by tooling access, not a precedent. Not resolved
here.~~

DATED RESOLUTION (2026-08-11, Aravind's decision): resolved, not left open.
See §0's new "PROD APPLIES MAY USE `supabase db query --linked -f <file>`"
standing rule — `db query` is now the documented path, conditional on the
three requirements listed there (project ref pasted fresh, hash comparison
against an independently re-probed reference, explicit go-ahead per apply).
This migration's own apply already met all three, evidenced above; the rule
now generalizes that to every future prod apply rather than re-litigating it
each time.

Week 4 (in progress): APPLIED TO PRODUCTION — migration 022, evening check-in
flow Pass 1 + CONTEXT DISCIPLINE, on 2026-08-05. apply_evening_flow_turn
(Q1-Q3) is live, hardened inline (020 discipline); apply_morning_flow_turn
gains 'wrong_flow' (was 018's 'idle') and — reviewer round 2 — both its
context-writing sites now merge instead of replace, closing a defect a
reverse-order regression test found that the original single-site fix did
not cover (full finding: docs/reviews/022-review-package.md §9). PITR
observed before apply (full 7-day window); pre-apply baseline pinned as the
rollback reference (morning's body was still 018's, md5(prosrc)
6a762d496bb0e49f3fc2f29728d154bd — not sha256, corrected per schema.md);
post-apply ACL + both body hashes
confirmed on prod, matching test-db exactly. Ledger entry (version '022')
was MISSING from the original runbook draft — added retroactively once
caught, row count observed 18 -> 19 across the manual INSERT (§0: observed,
not asserted), CLI still 28P01-blocked. Full record: docs/schema.md's own
022 entry (fuller than this pointer — read that one, not this one, for the
complete pre/post-apply evidence).
  NOT closed out by this apply: real webhook-triggered apply_evening_flow_turn
  proof stays OPEN, blocked on the webhook-wiring deliverable
  (022-review-package.md §10) — nothing on prod can reach evening's RPC via
  the real webhook until a cron or the webhook itself is wired to call it,
  which 022 does not do. Restart-semantics decision also stays OPEN
  (design-decisions-beta-feedback.md §10, DECIDE-BEFORE-CRON-PR) — whoever
  builds that wiring inherits both.

019's CORRECTABLE-COLUMN SET DOESN'T COVER WHAT IT NEEDS TO — TWO INSTANCES
(opened 2026-08-10, tracked, NOT fixed; surfaced while planning the DPR fact
assembler, lib/dpr/assemble.ts). Migration 019 made `daily_log_edits` the
source of truth for 9 SCALAR `daily_logs` columns; the 8 JSONB columns were
deliberately excluded ("a different UI problem, deferred pass" — schema.md's
daily_log_edits entry). That exclusion now has two concrete costs, not just
a UI gap:
  * The confidence:'low' flag (024, evening_productive_manpower / evening_
    equipment_utilisation — see lib/dpr/schema.ts's low_confidence field and
    the OPTION C reasoning next to it) lives entirely inside the excluded
    JSONB. A PM reading a low-confidence DPR figure has NO way to correct
    it — the flag points at something unactionable. An unactionable flag is
    worse than no flag: it tells the PM something is wrong without giving
    them a path to fix it.
  * Section 1 has the same shape, sharper: `evening_output` (the free-text
    narrative) IS correctable but feeds no DprFacts field today;
    `evening_output_quantities` (what the DPR actually shows) is NOT
    correctable. A PM who spots a wrong quantity in a generated report has
    no way to fix it at all — not even the indirect "the flag exists but
    can't be acted on" of the first instance; there's no flag either, just
    a wrong number with no correction path.
  Both belong against 019's correctable-column set, not against the
  assembler that surfaced them — recorded here, not solved. Do NOT add a
  field like `execution_narrative_source` to paper over the second instance
  without addressing the underlying JSONB-correctability gap; that would
  hide the problem behind a new Fact field while leaving the actual
  correction path (or lack of one) untouched.

REGENERATION-ON-CORRECTION DOES NOT EXIST (opened 2026-08-10, tracked, NOT
fixed; same origin as the entry above). bot-flows.md's "Late data before
9 PM owner send" section covers new SUBMISSIONS arriving before delivery
(silent UPSERT regen) — it says nothing about a PM CORRECTION arriving at
any time, before or after generation, and nothing in the codebase re-
triggers generation off a `daily_log_edits` write. State the consequence
precisely, because it is worse than it first sounds: this is not merely a
missed 9 PM send. A correction made AFTER a DPR has already generated (and
especially after it has already been delivered to the owner) leaves the
ARCHIVED DPR permanently wrong while `daily_logs`/`daily_log_edits` — the
actual source of truth — are right. A late send is a timing problem; this
is a standing discrepancy between the record a PM believes is correct and
the record an owner already received, with nothing watching for it. Whoever
wires cron/webhook-triggered regeneration (already tracked as OPEN against
migration 022, above) inherits this too — it is a third thing that trigger
needs to account for, not just new submissions and the existing late-data
path.
  FORWARD NOTE, added 2026-08-10: lib/dpr/assemble.ts's parseCorrectedBoolean
  / parseCorrectedInteger throw when a daily_log_edits.new_value's runtime
  type doesn't match its column — deliberately. Throwing means no DPR gets
  generated, which is VISIBLE and gets investigated; silently skipping a
  malformed correction would mean the owner reads a pre-correction number
  with nothing to flag it, which is invisible and wrong. That posture is
  correct today, where assemble.ts has no caller to catch anything. Once the
  `dpr_generate` job handler exists, this throw MUST land in DPR-24's
  failed-delivery path (delivery_status='failed', Sentry alert, PM + founder
  notified — bot-flows.md's own Failed delivery section), not crash a cron
  invocation silently. A fourth thing the dispatch/regeneration layer needs
  to account for, alongside the three above.

JOBS TABLE HAS NO CLAIMED-AT / STALE MECHANISM EITHER — SIBLING GAP TO
`dprs.generation_status='stale'`, NAMED, NOT BUILT (opened 2026-08-11, tracked,
NOT fixed). Surfaced while designing migration 026 (`dprs.generation_
claimed_at` — the mechanism proposed for detecting a `dprs` row stuck at
`generation_status='running'` when the process generating it died mid-call).
Migration 026 itself is NOT committed and NOT shipped: it's a correct design
waiting on a real end-to-end latency measurement (the 3-minute figure
originally proposed was grounded in the Claude API call alone, not the full
handler, and was correctly rejected rather than shipped provisional) and on
DPR-24's hold logic being written to treat `'stale'` as an exhausted-
generation failure — without that, `'stale'` would be a status nothing reacts
to, which is just a different flavour of stuck. Resequenced: build the
`dpr_generate` handler (Phase 3) first, instrument it, measure real p99 over
actual project-days, THEN derive the sweep interval from that and ship 026
with the measurement in its own header.

The sibling gap, found while checking whether `dprs`' mechanism could just
reuse an existing one on `jobs` instead of adding a new column: it can't,
because **`jobs` has no equivalent mechanism to reuse.** `claimJobs`
(`lib/queue/jobs.ts`) marks a job `'running'` via a plain `UPDATE`, with no
claim/heartbeat timestamp recorded anywhere. If the WORKER PROCESS handling a
job dies mid-execution — the identical failure mode migration 026 exists to
catch on `dprs` — the job stays `status='running'` forever. `claimJobs`' own
WHERE clause only ever selects `status IN ('pending', 'failed')` — a job stuck
at `'running'` is invisible to retry permanently, and `jobs.status`'s CHECK
constraint (`pending/running/succeeded/failed`) has no `'stale'`-equivalent
value to transition it to even if something noticed.

Same root cause as the `dprs` gap, one layer down, and broader: it affects
EVERY job type this queue will ever run, not one table. NOT urgent today —
`/api/jobs/tick` claims and dispatches nothing real yet (every case in
`dispatchJob` still throws `'No handler implemented yet'`), so no job has ever
actually been `'running'` long enough for this to matter in practice. TRIGGER
CONDITION, so this doesn't need rediscovering later: **real the day Phase 3
ships** — the first cron-enqueued `dpr_generate` job is also the first job in
this system's history whose worker process can plausibly die mid-execution
(a Claude call, several DB round-trips) while `claimJobs` believes it's still
in progress. Whoever ships Phase 3 inherits this; it should be closed before
or alongside that ship, not treated as later cleanup once real jobs are
actually running unattended.

DATED CORRECTION (2026-08-12): the two paragraphs above originally said
"Phase 4," conflicting with this file's own line naming the `dpr_generate`
handler "Phase 3" a few paragraphs up, and with `cc0d000`'s own commit
message ("Phase 3 dpr_generate handler + trigger"). Corrected to Phase 3 to
match both — the mismatch was an internal inconsistency in this file, not a
disagreement with the shipped commit.

DATED UPDATE (2026-08-12): the TRIGGER CONDITION above has PARTIALLY fired —
stated precisely, not flatly "now-live." `dispatchJob`
(`app/api/jobs/tick/route.ts`) now has a real `case 'dpr_generate'` calling
`handleDprGenerateJob`, landed in `cc0d000`/PR #55 (2026-08-11) — no longer a
placeholder throw. That is the code-level condition this entry names. ~~But
nothing has actually run unattended in production yet: `CRON_SECRET` is
still unprovisioned in Vercel (§8), so `/api/cron/dpr-generate` 401s every
real cron invocation, and prod's `dprs`/`jobs` tables were confirmed empty as
of 2026-08-12 13:44 IST. So: code-level trigger fired, not yet
production-exercised. The gap this entry tracks is imminent, not yet
realized — closing it (or accepting the risk explicitly) is still live work,
not something this update marks done.~~

DATED UPDATE (2026-08-12, ~22:15 IST): SUPERSEDED — the 13:44 IST empty
reading above was correct AT THE TIME, not stale when written; it is the
"before" half of the evidence, not a wrong claim. By 22:15 IST the 8:00 PM
cron had fired for real: `public.dprs` gained one row for today
(`log_date = 2026-08-12`, `delivery_status = 'skipped_no_data'`), which
`app/api/cron/dpr-generate/route.ts`'s `runDprGenerateTrigger` is the sole
writer of, and which requires `CRON_SECRET` authorization to have passed to
be written at all. Full evidence and the "absent job = success on the
zero-data path, not failure" inference trap are recorded under §8's
CRON_SECRET entry — not restated here. So: the system ran unattended in
production for the first time tonight, on a project with no site data for
the day, and behaved correctly — refused to generate a report rather than
enqueueing work against nothing. This closes the "not yet
production-exercised" half of this entry. Still NOT closed by this: an
actual end-to-end `dpr_generate` job has still never run (tonight's project
had zero `daily_logs` rows, so the zero-data branch fired before any job
would have been enqueued) — the `dpr_generate_timing` measurement this
section's JOBS TABLE gap and migration 026's timeout both need is still
outstanding, waiting on a project with real check-in data present at 8 PM.

DATED UPDATE (2026-08-12, pre-midnight) — E2E SMOKE PAUSED, IN PROGRESS.
Attempting to close the gap above: engineer 3534756b reactivated on prod
(`status='active'`) and `apply_morning_flow_turn(p_start_flow: true)` called
directly against prod to seed a real morning check-in for the
`dpr_generate_timing` measurement. Caught before any harm, not after:
the call returned `log_date: 2026-08-12` — TODAY, whose 20:00 IST
`dpr-generate` cron had already fired and already written
`skipped_no_data` for this exact project ~15 minutes earlier (see the
entry immediately above). `runDprGenerateTrigger` computes "today" fresh
at its own invocation and scans only that one day — no backfill path
exists anywhere in the repo — so completing the check-in under `08-12`
would have been permanently invisible to any future automated run, AND
would have made the existing `skipped_no_data` row retroactively false (a
record claiming no data existed for a date that, after the fact, had
some). PAUSED before any question was answered: a live Q1 prompt is
sitting against the `08-12`-dated session, engineer instructed NOT to
answer it. RESTART PLAN: wait for the IST calendar day to roll over past
`2026-08-12`, re-issue `apply_morning_flow_turn(p_start_flow: true)` for
the same engineer/project (BOT-21's previous-day force-reset — confirmed
present in the 022 RPC itself, not only the TS mirror — wipes the stale
`08-12` stub automatically), confirm the return shows
`log_date: 2026-08-13` BEFORE anything is answered, then proceed with a
real morning + evening check-in ahead of that day's 20:00 cron. Standing
rule this incident produced: see §0.

MIGRATION 027 (`checkin_escalations`) APPLIED TO PRODUCTION (2026-08-13,
~12:06 IST). First migration in this project's history to complete a full
PRE-APPLY external review cycle — round 1 (STOP, three blocking findings),
round 2 (the `closed_at` symmetry fix + full test-db rehearsal), sign-off —
before a single byte touched any database. Every prior externally-reviewed
migration (015 onward) was reviewed after it had already run somewhere;
027 is the first where "reviewed" and "never yet applied" were true at the
same time. Full record: `docs/reviews/027-review-package.md`; CLAUDE.md §0
carries the standing observation this apply confirms, not just proposes.

Applied via `supabase db query --linked -f
supabase/migrations/027_checkin_escalations.sql` (never `db push`),
linked ref (`jvxwqignooseazzmwhvl`) confirmed immediately before, PITR
confirmed by direct observation (not a logged claim) —
`pitr_enabled: true`, `walg_enabled: true`, restore window 2026-08-06
16:31:32 UTC → 2026-08-13 05:38:53 UTC. Table confirmed absent pre-apply
(`to_regclass('public.checkin_escalations') IS NULL`); rollback artifact
(a clean `DROP TABLE`, confirmed nothing depends on the table first — no
application code references it anywhere in `app/`/`lib/`) written to a
scratch file BEFORE the apply ran, not composed after the fact.

Post-apply pair, both fingerprints read from the catalog on prod, not
assumed from the file:
  * RLS policy (`checkin_escalations_select`), `pg_policy` readback:
    `polcmd='r'`, `polroles={authenticated}`, `pg_get_expr(polqual,...)`
    shows BOTH the `project_members` membership join AND
    `u.role = ANY (ARRAY['pm','admin'])` present in the LIVE definition —
    byte-identical in structure to what was rehearsed on test-db.
  * Composite FKs, `pg_constraint` readback (016/017 probe shape): all
    three FKs — `checkin_escalations_project_id_fkey`,
    `_engineer_id_fkey`, `_tenant_id_fkey` — show `confupdtype='a'` (NO
    ACTION) and `confdeltype='c'` (CASCADE), proving the chosen delete
    behaviour is actually CARRIED at the catalog level, not merely
    declared in the SQL.

Ledger: 22 → 23 rows, `('027', 'checkin_escalations')` observed present
directly (manual `INSERT` — CLI `migration repair` still 28P01-blocked for
this project). `types/database.ts` regenerated immediately after; diff was
non-empty as expected (unlike 025, this migration adds a table) and
additive-only — `checkin_escalations`' Row/Insert/Update shapes and both
composite FK relationships, nothing else touched; `tsc --noEmit` clean.

NOT closed out by this apply: the escalation sweep job handler and the
DASH-01 exceptions surface are both still unbuilt — this table is schema
only until those exist, same "schema before handler" sequencing as
migration 023's `dprs` table. `docs/schema.md`'s own `checkin_escalations`
entry is not yet written — noted here as a gap, not done in this pass.

THE REVIEWER'S OWN CLOSING FRAME, worth keeping verbatim rather than
paraphrased: the gate's promise was never BETTER findings — the same
three blocking issues (role-blind RLS, referential actions left to
default, cross-tenant reference integrity never asked) would eventually
have been found either way, gate or no gate. Its promise was CHEAPER
ones. Found before apply, they cost an edit to an unapplied file. Found
after, they would have been live defects on a table already readable by
whichever accounts held pm/admin sessions — the exact comparison recorded
earlier in §0, now closed out with a real apply behind it rather than a
prediction.

TRIPWIRE — `3534756b` (renamed "Vikram Rao") IS NOT A REAL ENGINEER, AND NOTHING IN THE
SCHEMA SAYS SO (opened 2026-08-15, migration 028's applied-runbook close-out; reviewer
accepted this as the migration's closing divergence, not an open blocker). Migration 028's
apply gate asked for `3534756b` (Aravind's own WhatsApp sandbox account,
`+919176865600`) to be DEACTIVATED before apply. It was RENAMED instead ("Vikram Rao") —
correct at the time (docs/reviews/028-dpr-engineer-report-review-package.md §23): the
gate's actual purpose was stopping a smoke-test label from appearing as an engineer name in
an owner-facing report, and the rename fully serves that purpose while a deactivation would
have emptied the only roster in prod and removed Aravind's only WhatsApp test path.
  WHAT THE RENAME DOES NOT FIX, stated precisely, not implied: it makes `3534756b`
  INDISTINGUISHABLE from a real engineer, rather than removing it from the pool. Nothing in
  `users` marks this row as a test fixture — no flag, no dedicated test tenant, no
  structural signal at all. This is the correct trade EXACTLY as long as Aravind is the
  only consumer of every report this row appears in. It becomes the wrong state the moment
  he is not — a second person (a real PM, a real owner) reading a report that quietly
  includes "Vikram Rao"'s data would have no way to know that name is a sandbox account, not
  a person on the payroll.
  This narrows, not closes, the pre-existing finding that nothing in this schema separates
  test users from real ones (the general shape of problem this project has hit before with
  test/prod separation — see the ENV VAR CONCATENATION and general test-hygiene entries
  elsewhere in this file for the same class of gap in other surfaces).
  CLOSING CONDITION, named explicitly so it has a trigger, not a memory dependency:
  BEFORE `dprs.delivered_owner_at` is ever stamped for a REAL owner (not Aravind), OR
  BEFORE any non-Aravind PM/owner gets access to this tenant — whichever comes first —
  `3534756b` must be deactivated or moved to a dedicated test tenant. **The delivery PR
  (DPR-24, owner-facing send) is the natural closer and should re-check this condition on
  the record when it lands** — noted there too (see that PR's own description when it's
  opened) so this trigger has an owner, not just a note in a file nobody re-reads. Full
  record: `docs/reviews/028-dpr-engineer-report-review-package.md` §27.

NO PRODUCTION MECHANISM STARTS A MORNING CHECK-IN — SAME CLASS AS THE ALREADY-KNOWN
EVENING GAP, RECORDED TOGETHER FOR THE FIRST TIME (opened 2026-08-15, diagnosed
read-only against a real silent failure — Aravind sent "yes" to the sandbox number at
~11:55 IST, got no reply). **The evening half of this finding was discovered and reported
earlier in this project's life (diagnosing why "hi" returned "already sent morning
check-in" instead of opening the evening flow) but was never written down here — it lived
only in conversation and is being recorded now, retroactively, alongside the morning half,
because writing one without the other would understate what's actually true: NEITHER flow
has a production starter.**

Traced end to end, not assumed, for today's specific failure: `route.ts` ->
`dispatchInboundTurn` -> `readCurrentFlow` sees no active flow -> defaults to morning ->
`applyMorningFlowTurn({..., startFlow: false})` -> outcome `'idle'` ->
`buildMorningReply('idle', ...)` returns `MORNING_IDLE_REPLY = ''` (morning.ts:81,
104-105, its own comment: "idle produces no outbound message") -> `route.ts:310`:
`reply === '' ? twimlEmpty() : twimlMessage(reply)` -> Twilio sends nothing. The message
DID reach the system (`whatsapp_sessions.updated_at` moved to today, ~11:58 IST, matching
the ~11:55 IST send) — it was received, processed, and correctly did nothing, because "yes"
is not a recognized flow-starter and no flow was active.

THE MECHANISM CHECK, whole-codebase, not scoped to today's one message: grepped every call
site passing `startFlow: true` (morning) or its evening equivalent — **exactly one exists
in the entire codebase**, `lib/whatsapp/flows/test-trigger.ts`'s `isTestStartTrigger`,
wired into `route.ts` alone. It requires BOTH `ENABLE_TEST_FLOW_TRIGGER === 'true'` AND the
message body being the exact literal sentinel `__quoco_start_morning__` — a token nobody
would type in ordinary use, and Aravind did not. `vercel.json` has exactly two crons
(`/api/jobs/tick` every minute, `/api/cron/dpr-generate` at 20:00 IST) — neither one ever
calls either flow's RPC with `startFlow: true`. No other route, webhook branch, or job
handler does either.

**THE CONSEQUENCE, stated as plainly as the finding itself: every downstream component this
project has built is complete and currently unreachable.** The parsers, the session state
machine, BOT-07/BOT-21/BOT-27, the per-engineer DPR assembler and its containment-checked
generator (migration 028, shipped and applied this week), the escalation queue schema
(migration 027) — none of it can ever run in production today, because nothing can ask an
engineer the first question. **The outbound-trigger workstream is not a feature on the
roadmap; it is the precondition for the product functioning at all.** Recording this
plainly rather than letting it stay implicit in two separate, smaller-sounding gap notes.

CONFIRMED (2026-08-15, Aravind checked the Vercel dashboard directly): `ENABLE_TEST_FLOW_
TRIGGER` does NOT exist in production's environment variable list at all — not "set to
false," genuinely absent. **The finding above is therefore CONFIRMED, not suspected: there
is no mechanism, of any kind, to start a check-in on production today.** DECISION,
recorded: NOT setting the variable. The code's own comment (`test-trigger.ts`) states it
"MUST NOT be set in production Vercel," and a marginally richer test/smoke-check
capability is not worth overriding that deliberate posture — the fix is the real
outbound-trigger workstream, not a debug backdoor left open.

OPEN QUESTION — SHARPER NOW, STILL UNRESOLVED, INVESTIGATED READ-ONLY 2026-08-15: the
2026-08-13 morning check-in DID demonstrably happen — `daily_logs` row `34f8bbb5...`,
`morning_submitted_at 2026-08-13 04:30:57.055608+00` (10:00:57 IST), real content
(`morning_plan: "Excavation of 1000 sq m earth"`, `morning_equipment` containing the
already-documented "Job 15oo" typo, etc. — matches this file's own EQUIPMENT
`daily_hire_cost` incident entry verbatim, confirming this is genuine historical data, not
fabricated). With the env var confirmed absent today and exactly one `startFlow: true`
call site in the entire codebase, this should not have been possible. Investigated, not
guessed at:
  * `git log --follow` on `test-trigger.ts`: ONE commit ever, `61d8b39` (2026-07-07) — the
    file has never been modified since creation. `git show` on that commit confirms the
    gate's shape was IDENTICAL from day one (env var + exact-token check, both required)
    — the gate was never looser at any point in this repo's history.
  * No audit/event table exists for "how a flow was started" — `whatsapp_sessions` carries
    only current state (no history columns), `processed_messages` stores only
    `message_sid` + timestamps (no body, no phone number). Neither directly names a
    mechanism.
  * `processed_messages` DOES show something load-bearing: five real Twilio-delivered SIDs
    in the window `2026-08-13 04:17:43 → 04:30:56 UTC`, the last one 1 second before
    `morning_submitted_at`. A morning flow start + 4 real answers (Q1-Q4) is exactly 5
    messages. A DIRECT out-of-band RPC call (bypassing the webhook to set
    `p_start_flow=true`) would write NOTHING to `processed_messages` at all — that table
    is only ever written by the webhook's own idempotency check, never by the RPC — so a
    bypass-plus-4-real-answers scenario would predict 4 rows, not 5. Five were found.
  * `dispatchMorningFlow`'s pure mirror (`morning.ts`, AUTHORITY NOTE: mirrors the RPC,
    tested against it directly) confirms outcome `'start'` is reachable from EXACTLY ONE
    branch: `startFlow === true && session.current_flow === null`. No other path — no
    next-day reset, no other outcome — ever produces `'start'`.
  * Grepped `scripts/` for any utility that calls `apply_morning_flow_turn` at all: none
    exists. No dev/seed script in this repo is capable of starting a flow, direct-RPC or
    otherwise.
  **Net read of the evidence, stated at its actual strength, not overclaimed:** everything
  found is CONSISTENT WITH, and the message-count argument specifically FAVORS, "the
  test-trigger fired via a real WhatsApp message, meaning `ENABLE_TEST_FLOW_TRIGGER` was
  `'true'` on Vercel production on 2026-08-13 and has since been removed" — over "a direct
  RPC bypass," which the message count argues against but cannot fully exclude (e.g. a
  bypass call could have been followed by coincidental real traffic). **Two things remain
  genuinely unconfirmable from here and are NOT settled:** the literal body of the first
  SID (`SM24c6712f...`, 04:17:43 UTC) was never read — only its existence and timing are
  known; and Vercel does not expose historical env-var values through what's accessible
  today, only current state, so the variable's value ON 2026-08-13 specifically cannot be
  directly verified, only inferred from this evidence. **Recorded as the leading,
  evidence-supported candidate — not as a settled answer.**

BOT-07 SILENCE IS A RULE 3.5 DEAD-END (opened 2026-08-15, same diagnosis). A real inbound
message — one that consumed a Twilio SID and updated `whatsapp_sessions.updated_at` — 
produces ZERO user-visible feedback when no flow is active (`MORNING_IDLE_REPLY = ''`,
mirrored in evening.ts). An engineer who messages the bot outside a flow cannot tell
whether the system is alive, whether their message arrived, or whether they should try
again — indistinguishable, from the outside, from the number being dead or blocked.
`design-principles.md`'s "never dead-end" instruction is explicit and general; this is a
concrete, confirmed violation of it, not a hypothetical one.
  PROPOSED FIX, named but NOT implemented here — it belongs with the outbound-trigger work
  above, not as an isolated patch, because it touches the same flow-dispatch path that
  work will already be changing: replace `MORNING_IDLE_REPLY`/its evening equivalent with
  one line that says something true and useful — e.g. confirming receipt and pointing at
  what actually starts a check-in, once something does. Do not build this now.

Full milestone plan lives in the ARD §12 (milestone-framed, not calendar).
"Week N" = sequence + estimate, not a deadline. A block is done when its
EXIT GATE is green on a real handset.
