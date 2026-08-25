# QUOCO — Current Build Status

Split verbatim out of CLAUDE.md §10 on 2026-08-23 (original CLAUDE.md
lines 1076-2538, pure cut/paste, no rewording). See CLAUDE.md §10 for why.

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
  DATED ADDENDUM (2026-08-20, template design v2, Y5): this gap just moved from a design
  finding to a WRITTEN, Meta-facing commitment. `quoco_engineer_optin` (template 8,
  `docs/whatsapp-templates.md`) now includes the line "Reply STOP at any time to
  stop these messages" — a real product promise submitted for approval, not an internal
  note. The STOP line is being KEPT in the template, deliberately — it is the right
  promise and it helps approval — which means this entry is no longer merely a
  correctness gap to close eventually; it is a promise the code does not yet keep, made in
  writing, to a real audience. Named here explicitly as a PRE-LAUNCH BLOCKER for the
  production sender going live with that template approved, not just for "opt-out
  traffic" generally as the paragraph above already said.

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

DASH-04 DPR ARCHIVE SHIPS LIST-ONLY IN MIGRATION 023's PR (2026-08-07). ~~The
page (`app/(dashboard)/dprs/page.tsx`) had a "View" link to a per-DPR detail
route that has never existed — `app/(dashboard)/dprs/[id]/page.tsx` was never
built, so bot-flows.md's DASH-04 spec ("list + full view") has only ever
shipped its list half.~~ The link also predated the 023 repoint entirely (it
was broken in the original stub, confirmed via `git show` against the exact
commit that touched this file) and was wrong-shaped on top of being a dead
end: `/dashboard/dprs/${id}` — the `(dashboard)` segment is a Next.js route
GROUP and contributes no URL segment; every other link in this app already
omits it, this href was the one outlier. Removed (link + its `<th>`/`<td>`)
rather than fixed, since a corrected-but-still-dead link would still 404 and
there's no DPR content to view yet regardless (nothing populates `dprs`
until the generator ships — see the Claude API / DPR generation Phase 0-1
work). ~~Whoever builds the detail route needs BOTH facts, not just that a
link is now gone: the route needs to be built from scratch (nothing to
resurrect), and the URL must NOT carry the `(dashboard)` prefix when it is.~~

**DATED CORRECTION (2026-08-21, found while auditing template 6's CTA button URL for
Meta submission readiness):** the struck-through claim is stale. `app/(dashboard)/dprs/
[id]/page.tsx` **exists** — confirmed directly this session (`find app -iname "*dpr*"`
and a full read of the file's content, RLS-aware, not a stub). DASH-04's per-DPR detail
route has been built at some point since 2026-08-07; this entry was never updated to
reflect it. Whoever relies on this file to check the DPR archive's status should read
the current codebase, not this entry, for that question — recorded as the standing
lesson `docs/whatsapp-templates.md`'s own dated note (§ CTA button, template 6) already
states in the other direction. The URL does NOT carry the `(dashboard)` prefix
(`https://app.quoco.co.in/dprs/<id>`), consistent with what this entry's own now-struck
guidance anticipated.

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
  **THE CONSEQUENCE, one line, stated plainly:** if the variable was set then and is
  confirmed absent now, the only successful production conversation this system has ever
  had happened under a configuration that no longer exists — and nobody currently knows
  when it changed, or why.

DATED UPDATE (2026-08-20, II3 build, `lib/whatsapp/inbound-start.ts`) — PARTIALLY CLOSED,
STATED PRECISELY SO IT ISN'T MISREAD AS FULLY CLOSED. This entry's finding was about TWO
distinct absences: no SCHEDULED mechanism sends the 8:30am/6:30pm prompts (still true,
unchanged — that is the #69/031 outbound-send primitive, per CLAUDE.md's own STANDING
ARCHITECTURAL FACT in §3, still unbuilt), and no path exists for a check-in to start AT
ALL outside the env-gated test sentinel. The second half is now closed for the case where
the ENGINEER messages in first: `routeInboundMessage` treats any inbound with no active
session as a real start trigger (window/submission-state logic per
`docs/inbound-start-trigger-plan.md`), no flag, live in production the moment this
build's PR merges. **What this does NOT do:** it does not send anything unprompted — an
engineer who never messages the bot still never hears from it. "The outbound-trigger
workstream is not a feature on the roadmap; it is the precondition for the product
functioning at all" (above) remains true for the scheduled-send half; it is no longer
true for the reply-only half, which now functions for any engineer willing to message
first.
  FURTHER DATED UPDATE (2026-08-20, PP2, design-decisions-beta-feedback.md §27): the
  paragraph above is still an accurate description of what runs today, but "closed for
  the reply-only half" is not the permanent state — PP2 decides check-ins are
  cron-triggered, never inbound-triggered, and names `routeInboundMessage`'s
  no-active-session branch (everything the paragraph above describes) as SCAFFOLDING to
  be replaced by a short acknowledgement once the #69/031 outbound-send primitive and its
  cron exist. Not reverted here — still live, still correct for today — but do not read
  this entry as describing the intended final shape.

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
  RESOLVED (2026-08-20, II3 build). `routeInboundMessage` (`lib/whatsapp/inbound-start.ts`)
  replaces the bare `dispatchInboundTurn` call at this exact site (`route.ts`): the
  no-active-flow, no-active-session case that used to fall through to
  `MORNING_IDLE_REPLY`/`EVENING_IDLE_REPLY` (`''`) now always gets a real reply — a start
  prompt, `REPORT_READY_REPLY` (after 19:45 IST), or an already-done reply. `MORNING_IDLE_
  REPLY`/`EVENING_IDLE_REPLY` themselves are unchanged and still `''` (buildMorningReply/
  buildEveningReply are pure functions with no session-read of their own) — the fix is
  that `routeInboundMessage` now decides BEFORE the RPC is ever called whether `idle`
  would even be the right outcome to ask for, rather than asking for it and rendering its
  silent reply. Full design: `docs/inbound-start-trigger-plan.md`.

PROCESS BREACH (2026-08-15, corrected 2026-08-15 same day — the first write-up of this
entry overstated it) — PR #64 WAS RE-RUN TO GREEN AND MERGED WITHOUT EVER CLASSIFYING THE
ORIGINAL RED CHECK, AGAINST AN EXPLICIT HOLD-UNTIL-CLASSIFIED INSTRUCTION. Stated
precisely, because the precise version differs from what was first recorded here: PR #64
did NOT merge while red. `Test (real test-db)` failed on the PR's first CI run
(`test/migration-024.test.ts`, `ensureMorningEngineer insert failed: no row returned`)
under an instruction to classify that failure before merging. A later push to the same
branch (made for an unrelated content reason, not to retry the check) re-ran CI, which
came back green, and the PR was merged on that green result — WITHOUT the original red run
ever being classified first, which is what the hold instruction actually required. A
network-timeout message on the merge command's own HTTP response was reported in the same
turn, which is a different thing from the check and does not stand in for classifying it.
**The breach is the re-run-until-green pattern itself — treating a later green result as
license to skip diagnosing the earlier red one — not "merging a still-failing check."**
Content impact: none — the PR was docs-only, so nothing on `main` broke. Process impact:
this was the fourth test-db CI incident in four days and the first with a NEW signature
(an insert returning no row, not a query timeout) — re-running to green without
classifying is exactly the pattern that lets a real regression through disguised as "it
passed on retry." Recorded per instruction so the precedent doesn't stand uncorrected, and
corrected in place (not silently) once the first write-up's own overstatement was flagged.

TEST-DB INCIDENT #4, CLASSIFIED (2026-08-15) — DOES NOT REPRODUCE IN ISOLATION;
MECHANICAL CANDIDATES NARROWED, ROOT CAUSE NOT PROVEN. `test/migration-024.test.ts` run
alone, twice, back to back, against test-db: 31/31 passed both times, no failure of any
kind. Does not reproduce on demand — recorded plainly, per instruction, rather than
defaulting to "contention" because the signature is different from the prior three
incidents (all of which were 30s query timeouts; this one is a successful-looking insert
whose client-side response carried zero rows and no error).
  `ensureMorningEngineer` (test/helpers/db.ts): SELECT-by-`whatsapp_number` first: if
  found, return its id (no insert attempted); otherwise INSERT the fixture row with
  `.select('id').single()`. On failure it throws
  ``ensureMorningEngineer insert failed: ${error?.message ?? 'no row returned'}`` — the
  CI failure's exact text means `error` was falsy AND the insert's own RETURNING carried
  zero rows: the insert request itself did not error, it returned successfully with
  nothing in it.
  CANDIDATES CHECKED AGAINST THE LIVE CATALOG, not assumed:
  * Unique-conflict-silently-no-opping — CHECKED, DOES NOT FIT. `users_whatsapp_number_key`
    is a real UNIQUE constraint (`pg_constraint` readback). A genuine race — two inserts
    for the same fixture number — would throw a real 23505 unique-violation with a real
    `error.message`, populating the FIRST half of the `??` fallback, not the second. The
    literal failure text proves this candidate wrong, not just unlikely.
  * A suppressing trigger — CHECKED, DOES NOT FIT. Zero non-internal triggers exist on
    `public.users` (`pg_trigger` readback) — nothing could `RETURN NULL` a row out from
    under the insert.
  * An RLS/RETURNING visibility gap — the mechanically correct shape for "insert succeeds,
    RETURNING comes back empty, no error": Postgres RLS filters what a statement's own
    RETURNING clause can see by the acting role's SELECT policy, not just its INSERT
    policy — a role that can write but not read the row it just wrote gets exactly this
    symptom. `public.users` has `relrowsecurity=true`. This helper uses `testClient()`
    (the SERVICE ROLE key), which carries `BYPASSRLS` and should never hit this — and
    since nearly every other insert across the rest of this suite (including this same
    file's own 31 tests, all of which use the identical service-role client) works
    correctly, a wrong/non-service key in CI is inconsistent with the rest of the suite
    passing. Not ruled out with certainty, but not a clean fit either.
  * A leftover row from a prior run — CHECKED LIVE: zero rows currently exist for the
    fixture `whatsapp_number` on test-db. This does not rule the candidate out; it's
    consistent with a specific reconstruction worth naming precisely because it's
    falsifiable, not because it's proven: `ensureMorningFixtures`'s cleanup
    (`removeMorningFixtures`) only deletes the fixture user when the module-level
    `engineerId` was successfully set — if the ORIGINAL failing insert actually wrote the
    row server-side while the CLIENT received a truncated/empty response and threw before
    assigning `engineerId`, the row would have been silently ORPHANED (uncleaned) after
    that CI run, sitting in test-db until a LATER run's own `ensureMorningEngineer`
    SELECT found and adopted it as "existing," then correctly cleaned it up in that later
    run's own `afterAll` — which would explain both today's clean re-runs AND the current
    absence of any leftover row, without requiring a race.
  **Classification: UNRESOLVED, not "contention."** The evidence rules out a real unique
  violation and a suppressing trigger with reasonable confidence (both checked against the
  live catalog, not assumed); it's consistent with, but does not prove, a transient
  response-truncation on the original INSERT — a CI-runner/network-level symptom this
  project has no tracing access to confirm. This is genuinely a different failure class
  from the prior three timeout incidents and should not be filed under the same label.

`main`'s own CI (the merge commit's independent run, not the PR's pre-merge check):
GREEN — `039c30c728eb02c30098a34c2cc6a22f1706085d`, all checks `success`. Confirmed
directly, not assumed from the PR having merged.

RECORDED, NOT FIXED (2026-08-15, MVP schedule freeze pass) — TWO SMALL FINDINGS, BOTH
DELIBERATELY LEFT ALONE:
  1. `whatsapp_sessions.expires_at` is written by every RPC generation
     (`p_now + INTERVAL '30 minutes'` — 012, 013, 014, 018, 022, 024, 025, all identical)
     and read by NOTHING repo-wide (grepped `lib/`, `app/` for any consumer — zero). No
     cleanup job exists that would act on it either. Sessions do not actually expire after
     30 minutes — the only real reset is BOT-07's next-IST-day wipe
     (`quoco_same_ist_day`). This column is a schema that lies about what it does. Two
     options, neither chosen here: read it for real, or drop it.
  2. `lib/whatsapp/dispatch.ts:8-14` cites "design-decisions §11" for the restart-start
     note. The restart note is §10, not §11 — a stale/wrong cross-reference, not fixed in
     this pass (recorded per direct instruction).

SCOPE CORRECTION (2026-08-15, Aravind's own instruction): merging PR #66 deployed the
`dpr-generate` reschedule same-night (accepted — not reverted). **"Commit but do not
deploy" means do not merge, not just "don't add the missing-route cron entry" — merging to
`main` deploys, full stop, same fact this file's own merge/deploy incident already
established for a different PR.**

`morning.ts:188` TS/SQL MIRROR DIVERGENCE — TRACKED, NOT FIXED (opened 2026-08-19, found
during #67/#69's package-stage review, external review). `dispatchMorningFlow`'s `startFlow`
branch (`lib/whatsapp/flows/morning.ts:188`) does a bare `context: {}` replace on session
start. The live SQL (`apply_morning_flow_turn`, currently 022's body) does NOT do this —
migration 022 fixed exactly this spot to `context - 'q2_reask' - 'q3_reask'` (a strip,
never a bare wipe — "CONTEXT DISCIPLINE, site 1 of 4," 022's own header). The TS mirror's
own AUTHORITY NOTE (`morning.ts:24-32`) claims to mirror the `wrong_flow` outcome and the
Q4-completion merge only — it does not claim to mirror the START fix, and the code confirms
it doesn't. **Correctly flagged-not-fixed in a plan-only pass** (docs/outbound-send-
primitive-plan.md, B3 condition 1) — recorded here so it isn't lost the moment that
document graduates to a migration and stops being the place anyone re-reads for open
findings. Not urgent on its own (the TS mirror is a prediction/test-oracle only —
`dispatchMorningFlow`'s own AUTHORITY NOTE states production acts on the RPC's real return
value, never the mirror's), but real: any future RPC change in this same area (B3's
cross-flow fix, when it ships) should close this divergence in the same pass, not leave a
third context-writing pattern where two are already meant to agree by construction.

Full milestone plan lives in the ARD §12 (milestone-framed, not calendar).
"Week N" = sequence + estimate, not a deadline. A block is done when its
EXIT GATE is green on a real handset.

WEBHOOK SIGNATURE VALIDATION IS HOST-PINNED, NOT HEADER-DERIVED — A DOMAIN MOVE BROKE IT
FOR A DAY, UNDETECTED (2026-08-20, QQ1-QQ3, first real end-to-end sandbox test of the II3
build). `app/api/whatsapp/webhook/route.ts:138` builds the signature-validation URL as
`${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook` — read directly from the code,
not assumed: a single, fixed env var, nothing derived from `Host`/`x-forwarded-host`/
`x-forwarded-proto`. Twilio signs its webhook request over the FULL URL it actually
posted to, including host. `NEXT_PUBLIC_APP_URL` moved to `https://app.quoco.co.in` on
2026-08-19; the Twilio sandbox's own "WHEN A MESSAGE COMES IN" field still posted to the
old `https://quoco-six.vercel.app`. Different host string on each side → different
expected signature → every real inbound got a 403, confirmed directly via Twilio's
Request Inspector (status 403 at the real webhook path — not a 404, not a redirect,
meaning the route was reachable and the signature specifically did not validate).
**Undetected for a full day because nobody had messaged the bot in that window** — the
exact kind of gap a synthetic check would have caught same-day instead of on the first
real test.

**FIXED (2026-08-20): the Twilio sandbox's inbound webhook was repointed at
`https://app.quoco.co.in/api/whatsapp/webhook`, method POST — a console-only change, no
code, no deploy.** Verified by database read-back, not by the phone screen (per LL3's own
discipline): `processed_messages` gained exactly one new row for the test message;
`whatsapp_sessions` for the test number was UNCHANGED (`current_flow` still null,
`updated_at` still five days stale) and `daily_logs` still had no row for today — both
correctly reflecting the after-hours refusal path, which returns before ever calling an
RPC. The reply the phone showed (`REPORT_READY_REPLY`) is real, not cosmetic.

**ROBUST FIX, TRACKED, NOT BUILT (upgraded from QQ3's monitoring-only framing to an
actual code item):** replace the single hardcoded `NEXT_PUBLIC_APP_URL` string with a
PINNED ALLOWLIST of valid hosts that `validateTwilioSignature` tries in turn (construct
the candidate URL for each allowlisted host, accept the first one whose signature
matches). Safe specifically because the list is NOT taken from the incoming request's own
`Host` header — an attacker-controlled header can't add itself to the allowlist — it's a
small, explicitly-maintained set of known-good production domains. This survives the next
domain move without becoming a silent, day-long outage: a request signed against any
allowlisted host validates; a request against a host that's been retired can be caught by
a startup assertion or a periodic check instead of by nobody noticing until the next real
message. Not built here — a real code change to `route.ts`'s signature-validation path,
its own migration-free but review-worthy PR when it ships.

**SEPARATE, NAMED SO IT ISN'T CONFLATED WITH THE ABOVE:** the production WABA sender's own
INBOUND webhook field is a DIFFERENT Twilio configuration surface from the sandbox's, and
remains entirely unwired — this is a strong candidate for explaining the WABA sender's own
observed silence (`docs/twilio-sender-swap-runbook.md`'s own §1 already traces
`TWILIO_AUTH_TOKEN`'s account-dependency for this reason), tracked there, not
investigated further until the sender swap itself is authorized. Fixing the sandbox's
webhook tonight does nothing for the production sender's inbound path — they are
independently configured in Twilio and must each be pointed at the app separately.


### [2026-08-23] DECIDED — design-decisions-beta-feedback.md is NOT split at this time

Considered splitting this file at the same §1-27-settled / §28-onward-live boundary
this file itself already treats as the natural line, mirroring CLAUDE.md's own §10
move (above) — and stood down. Aravind's correction, not a fresh finding: the premise
motivating the CLAUDE.md §10 move does not carry over. **The 150,000-char truncation
risk (silent tail-drop past the limit) is specific to CLAUDE.md, because CLAUDE.md is
auto-loaded into every session. This file is read on demand.** It crosses the
120,000-char WARN line (139,273 chars as of 2026-08-23), not a 140,000 hard-fail —
that threshold does not apply to this file at all. A warn is a nudge, not a
truncation risk.

Given there is no truncation risk to mitigate today, splitting would only add cost:
a permanent two-hop redirect in front of whichever half moves. And the half that
would move under the §10-mirrored plan is the WRONG half to redirect — the opposite
of the §10 case, where nothing of consequence pointed at the content that moved.
Section-count and citation inventory carried forward here so this analysis is not
re-derived:

- **Section inventory (30 sections + title, byte counts via `wc -c`-equivalent):**
  title 456B; §1 1,164B; §2 549B; §3 5,954B; §4 254B; §5 380B; §6 2,563B; §7 2,928B;
  §8 5,180B; §9 3,725B; §10 6,354B; §11 3,005B; §12 10,411B; §13 5,600B; §14 2,042B;
  §15 1,596B; §16 2,488B; §17 2,158B; §18 2,636B; §19 2,486B; §20 3,084B; §21 2,649B;
  §22 6,706B; §23 1,571B; §24 11,033B; §25 2,577B; §26 2,902B; §27 3,311B; §28 27,455B;
  §29 7,463B; §30 8,593B. §1-27 sum: 95,306B (+ 456B title = 95,762B). §28-30 sum:
  43,511B. Total: 139,273B — matches `wc -c` exactly.
- **Text-wise, §1-27 is frozen**: every commit since §28 was first appended
  (`3d2f422`, 2026-08-21) touched only line ranges ≥1585 — confirmed via
  `git show --format= | grep '^@@'` on all 7 commits since. Nothing in §1-27 has been
  edited in place since.
- **Relevance-wise, §1-27 is the MORE-cited half, not the less.** Repo-wide grep for
  section-numbered citations of this file (excluding its own internal §28-30
  self-references) found 58 hits: **41 point into §1-27** — §10 alone draws 15, the
  single most-cited section in the project, cited live from `lib/whatsapp/dispatch.ts`
  and `lib/whatsapp/inbound-start.ts` (application code, not just docs); §9 draws 5;
  §3.1/§3.2 draw 5; §6/§12/§13/§11/§19/§1 draw 2 each; §5/§3/§22/§18 draw 1 each — vs
  **17 pointing into §28-30**. §28 also actively amends/reverses earlier sections in
  its own text ("DECIDED, narrower than §1's full design," "§9 REVERSAL," "resolves a
  live conflict [with] §7") — §1-27 is textually frozen but still very much
  load-bearing.

**Net: relocating §1-27 would put a two-hop redirect in front of the most-consulted
content in the project, to solve a truncation risk that does not exist for this
file.** Not split.

**WHEN IT DOES NEED SPLITTING** (revisit at 150,000 chars — used here only as a
round trigger point, not because the CLAUDE.md hard-fail threshold itself applies):
the cheaper move is the REVERSE of §10's — freeze this file as-is, under its current
name, and open a new file for §31 onward, rather than relocating the heavily-cited
§1-27 out from under its existing citations. Zero citations change, no redirect
needed for anything that already exists — new sections simply accrue in the new file
from the split point forward. Cost: decisions live in two files split by date instead
of one, handled by grepping across docs/ rather than reading one file top to bottom.

**HAZARD RECORDED, SAME ENTRY — bare "§N" citations are now ambiguous project-wide.**
"§10" means two different things depending on which file: RESTART SEMANTICS in
`design-decisions-beta-feedback.md`, or CURRENT BUILD STATUS in this file
(`docs/build-status.md`), which only exists as a numbered §10 because of the
2026-08-23 CLAUDE.md split recorded above. Code comments and docs already cite this
project's design/build history by bare section number in a majority of cases. Not a
new failure shape, either — this file's own `morning.ts:188` TS/SQL mirror
divergence entry (2026-08-19, above) already records `lib/whatsapp/dispatch.ts`
mis-citing "design-decisions §11" for what should have been §10, before this
second-file ambiguity even existed: a bare section number was already fragile on its
own, and now two live documents each have their own §9, §10, etc. **Standing
guidance: cite the FILENAME plus section, never a bare "§N"** — e.g.
`design-decisions-beta-feedback.md §10`, never just "§10". Promoted to a one-line
standing rule in CLAUDE.md §0 (see that section) since this is a citation convention
to follow every session, not a one-off historical note.

---

**INCIDENT — test-db (`exfccwlrhoutkgrlikod`) credentials printed to a
session transcript, THREE times across two dates (2026-08-23 ×2,
2026-08-24 ×1 — see INCIDENT 3 below).**

`supabase projects api-keys`, run to obtain a project breadcrumb during
migration 030's test-db rehearsal, printed the anon, service_role, and
secret API keys for test-db in full. **Contained: local transcript only,
not a public repo or shared log.**

**WIDENED (2026-08-23, same day): the exposure's scope is recorded as
`.env.test`'s FULL contents, not only the three Supabase API keys
originally caught.** Within the hour of the first exposure being recorded
and CLAUDE.md's first (narrower) rule being written, a second command
inspecting `.env.test` printed matched lines — values included — a second
time. Rather than trust a reconstruction of exactly which lines that
second command matched, the exposure is recorded conservatively as
covering the file's full contents — the safer failure direction for a
credential-scope estimate is wide, not narrow (same logic this project
already applies to destructive-statement pinning). `.env.test`'s variable
NAMES (values never repeated here — see CLAUDE.md's widened §0 rule for
why): `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_ROLE_KEY`,
`SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_PROJECT_REF`,
`DOTENV_CONFIG_QUIET`, ~~`TWILIO_AUTH_TOKEN`~~, `NEXT_PUBLIC_APP_URL`. ~~Of
these, `SUPABASE_TEST_SERVICE_ROLE_KEY`, `SUPABASE_TEST_ANON_KEY`, and
`TWILIO_AUTH_TOKEN` are real credentials; the rotation scope below is
widened to include the Twilio auth token alongside the Supabase keys, not
just the three originally named.~~

**CORRECTED (2026-08-24, Aravind): `TWILIO_AUTH_TOKEN` in `.env.test` is a
DUMMY value, not the live Twilio account token** — already independently
noted elsewhere in this same file (this file's T-WH-01 entry: "`.env.test
TWILIO_AUTH_TOKEN` is a fixed, obviously-fake value"), which the paragraph
above should have checked before including it in the genuinely-exposed
set. The second exposure (the `grep -n` against `.env.test`) printed a
FAKE value for this variable — the live Twilio token was never exposed by
either incident. **The genuinely exposed credentials, from both
incidents, remain the test-db Supabase keys only:
`SUPABASE_TEST_SERVICE_ROLE_KEY` and `SUPABASE_TEST_ANON_KEY`.**
`TWILIO_AUTH_TOKEN` is removed from the rotation scope below. FAILURE
CLASS, same one this file already tracks elsewhere (the 2026-08-21
"plausibility is not verification" entry): the variable's NAME was read
as evidence it held a live credential, without checking whether the VALUE
behind it was real — a plausible-looking claim acted on before
verification, not a new mistake shape.

~~**Risk accepted and deferred (Aravind, 2026-08-23): test-db holds
disposable schema and no customer data.** The Twilio token addition to
scope does not change this acceptance — it is also test/sandbox-scoped,
per this project's Twilio sandbox setup (§7's bot-flow testing rule) — but
it does widen what "done" means for the deferred rotation below.~~

**Risk accepted and deferred (Aravind, 2026-08-23): test-db holds
disposable schema and no customer data.**

**DEFERRED ACTION, NOT OPTIONAL — legacy `anon`/`service_role` keys CANNOT
be rotated in place.** Checked directly in the Supabase dashboard (JWT Keys
→ Legacy JWT Secret): this project's legacy JWT secret has already migrated
to the newer ECC JWT Signing Keys system, and Supabase's own documented
path from here is migrating to publishable (`sb_publishable_...`) and
secret (`sb_secret_...`) keys, then explicitly disabling the legacy keys —
not rotating them as a like-for-like swap. Legacy keys are deprecated by
Supabase end-2026 regardless, so this is scheduled work brought forward by
this incident, not new work invented because of it.

**Deferred until after migration 030 ships.** Scope when done: `test/
helpers/db.ts`'s `testClient()` (currently a plain `createClient(url,
serviceRoleKey)` call assuming a JWT-shaped key — needs checking against
whichever client-construction shape the new key type requires), `.env.local`,
`.env.test`, the GitHub Actions repo secrets `SUPABASE_TEST_URL`/
`SUPABASE_TEST_SERVICE_ROLE_KEY`/`SUPABASE_TEST_ANON_KEY`/
`SUPABASE_TEST_PROJECT_REF` read by `.github/workflows/ci.yml`'s "Test
(real test-db)" job, then the disable step itself in Settings → API Keys.
~~Plus, per the widened scope above, the test/sandbox `TWILIO_AUTH_TOKEN`
(rotated in the Twilio console, updated in `.env.test` and its GitHub
Actions secret alongside the Supabase keys, same pass — not a separate
follow-up).~~ **CORRECTED (2026-08-24): `TWILIO_AUTH_TOKEN` removed from
this scope — see the correction above; it was never a live credential, so
there is nothing to rotate.** `.env.test.example` already holds only
placeholders, unaffected. **WIDENED again (2026-08-24, see the third
incident below): add the `cli_login_postgres` connection password
(`PGPASSWORD`) Supabase's own CLI generates for `supabase db dump`
sessions against test-db to this scope.** This is a platform-generated,
short-lived connection credential, not a stored project key — there is no
dashboard "rotate" action for it the way there is for the anon/
service_role keys; it is included here as a flag that any future
`supabase db dump`/`--dry-run` invocation generates a NEW one each time,
so the specific value printed on 2026-08-24 needs no action beyond the
containment already done (below), but the CLASS of credential this
represents is now correctly in scope for whoever eventually audits
test-db's full credential surface, not just the three originally named.

**INCIDENT 3 — a THIRD exposure, same underlying failure class, one day
later (2026-08-24).** `supabase db dump --linked --schema public
--dry-run`, run while building a disposable local-scaffold proof for
migration 030's transaction-wrapper fix (external review round 2, B1;
`docs/reviews/morning-flow-migration-review-package.md` §11.2), prints its
generated `pg_dump` invocation script to stdout — that script embeds a
live `PGPASSWORD` for test-db's `cli_login_postgres` connection role.
Piping the output through `head -30` to inspect the invocation (a
previously-unremarkable way to peek at a command's output) printed the
password into the session transcript. **This happened AFTER the rule had
already been WIDENED once (following incidents 1 and 2, same day prior)
— the widened category version was in effect, obeyed, and the hazard
recurred anyway via a route neither version named:** `supabase db dump`
was not itself a banned command, and `head` was not itself a banned
command; the specific combination — piping a CLI's own generated,
not-yet-inspected script through a raw-print tool — was the actual gap.
**Contained: file deleted immediately** (`rm` on the file that held the
printed script), **the dump regenerated with direct file redirection and
never printed again** (the same `supabase db dump` command re-run,
output written straight to a file, then only grepped/read for the
specific non-sensitive lines actually needed — the shebang line, the line
count — never the full script). **Standing rule REPLACED, not widened a
third time** (CLAUDE.md's §0, this same date): naming individual commands
failed once, naming a category of commands failed a second time within
the same category's own effective window — two enumerations, two
recurrences. The rule is now stated as a procedure (never pipe unfamiliar
output through `head`/`cat`/`tail`/`less` into the transcript; redirect
to a file first, read selectively) rather than a third list, on the
reasoning that a procedure has no "next item" for a future surprising
command to fall outside of. See that entry for the full three-incident
record and the procedure itself.

---

**A REHEARSAL ON THE SHARED TEST-DB BLOCKS CI FOR EVERY OTHER BRANCH, NOT
JUST THE ONE BEING REHEARSED — recorded as a known cost, no fix proposed
(2026-08-23, migration 030's test-db rehearsal).**

Migration 030 was applied to test-db (`exfccwlrhoutkgrlikod`) for a real
rehearsal, and — deliberately, per an earlier decision — left applied
rather than immediately torn down. The next unrelated event to touch CI
(a docs-only PR against `main`, containing none of 030's changes) came
back with its `Test (real test-db)` check failing: not from anything in
that PR's own diff, but because `main`'s code has none of 030's changes
while test-db, still carrying 030, was running the new RPC shape `main`'s
tests don't expect. Confirmed directly, not assumed: re-running the full
suite against `main`'s own unmodified code while test-db still carried
030 failed far more broadly than the set of tests actually written
against 030's assumptions — files with no connection to migration 030 at
all failed too, because `main` is missing the entire changeset, not just
one team's follow-up fixes.

**Why the existing concurrency guard doesn't cover this.**
`.github/workflows/ci.yml`'s `Test (real test-db)` job already runs under
a project-wide (not branch-scoped) concurrency group,
`ci-test-db-suite` — deliberately, per that job's own comment, because the
test fixtures (`TEST_TENANT_ID`, `TEST_PROJECT_ID`, `TEST_ENGINEER_PHONE`)
are fixed, deterministic rows shared project-wide, and two different PRs'
jobs running at the same literal moment would corrupt each other's
fixture writes. **That guard serialises ACCESS to test-db — it says
nothing about whether test-db's SCHEMA/RPC STATE matches what the branch
currently running expects.** Two runs from different branches, run one
after another as the concurrency group intends, still fail identically if
test-db's actual applied migrations don't match either branch's code —
serialised access doesn't imply compatible state.

**This is not a one-off; it will recur on every future migration
rehearsal that leaves its migration applied on test-db for any length of
time**, for as long as this project has exactly one shared test-db and no
per-branch database isolation (`CLAUDE.md` §0's TEST-DB IS NOT
CONFIDENTLY REBUILDABLE entry already records `supabase branches list`
returning a `403` — Supabase branching is not available on this
account's tier). Recorded here as an accepted, known cost of the
shared-test-db model this project currently runs on — **not resolved in
this pass, and no fix proposed**: the resolution used this time (write a
verified rollback, apply it, confirm restoration by observation before
relying on it) is a real, repeatable pattern for THIS incident, not a
structural fix for the underlying one-shared-database constraint.

---

**MIGRATION 032 IS THE FIRST MIGRATION THIS PROJECT HAS DELIBERATELY LEFT
PERMANENTLY APPLIED TO TEST-DB, NOT AS A REHEARSAL — A DIFFERENT CASE FROM
THE ENTRY ABOVE, RECORDED SEPARATELY (2026-08-24, session-transition Test
B ordering-guarantee fix, PR #104).**

Full incident: `docs/reviews/session-transition-lock-wait-flake.md`. In
short: Test B's real ordering guarantee (does caller 2 wait until caller
1 is OBSERVED holding the row lock, not just "probably has by now") can
only be proven by querying live Postgres lock state from a second
connection — `pg_locks`/`pg_try_advisory_lock` would do it, but neither
is reachable through PostgREST without a wrapper function, and every
schema-only alternative considered (a marker column written before or
during the hold, `pg_notify`) only ever proves "about to lock" or
"already released," never "currently holds" — the specific proposition
the guarantee needs (full alternatives analysis:
`session-transition-lock-wait-flake.md`'s "Client-side alternatives"
section). So `032_session_transition_lock_probe_nowait.sql` — a single
read-only, `service_role`-only function,
`quoco_test_row_is_locked(text)` — is not optional scaffolding; it is the
only mechanism that can express this guarantee at all.

**Why PERMANENT, unlike every prior rehearsal (030 included, entry
above).** Every migration rehearsed on test-db so far was rehearsed and
then rolled back BECAUSE the code exercising it doesn't live on `main`
yet — leaving it applied would silently change behavior for every other
branch's CI run against schema/RPC shapes `main` doesn't have (exactly
the cost the entry above documents; migration 030's own rehearsal is the
worked example). Migration 032 is a different shape: it changes NOTHING
about any existing function's behavior, is called from exactly one place
(`test/session-transition.test.ts`, which lives on `main` once this PR
merges), touches no table other tests read production data through, and
has no callers outside that one test file. The known cost above — "a
rehearsal blocks CI for every other branch because state doesn't match
code" — doesn't apply here, because leaving 032 applied doesn't change
what any OTHER branch's code expects; it only adds a function that a
branch either calls (if it has this test file) or never touches at all.
The actual first CI attempt against this migration (PR #104, run
`32750655063`) failed with the OPPOSITE problem — "function not found,"
because the standard rollback discipline was followed even for this
non-standard case — which is what forced this distinction to be drawn
explicitly rather than left as an unstated exception.

**Confirmed safe to leave applied, by observation, before deciding to
leave it:** full local suite run against test-db with 032 applied —
585/587 tests green. The one failure
(`test/session-transition.test.ts`'s Test B itself) is the
ALREADY-DOCUMENTED sandbox RPC-serialization limit
(`docs/reviews/sandbox-cannot-test-concurrency.md`), not a new problem —
a local run cannot sustain the concurrent RPC calls the test needs, so
the probe never observes caller 1's lock within the timeout locally. CI
is the only environment that can actually validate this test; that
verification is still open (see the flake doc's status line).

**Consequence for future migrations, stated so this isn't mistaken for a
precedent that test-only migrations are always safe to leave applied:**
the deciding factor was never "it's test-only" — it was that 032 has no
existing caller anywhere to conflict with. A test-only migration that
CHANGED an existing function's behavior, or that other tests would
implicitly depend on once present, would still need the
apply-verify-rollback discipline the entry above describes. Evaluate each
case on that basis, not on this one as a shortcut.

---

**LOCAL FULL-SUITE VERIFICATION AGAINST TEST-DB HUNG THREE TIMES IN A ROW,
LIKELY THIS SANDBOX'S NETWORK PATH, NOT THE TESTS — NOT CHASED FURTHER
(2026-08-25, "clear the board" pre-apply verification pass).**

Attempting a final local `npm test` run against updated `main` (a
"clear the board before prod apply" step, distinct from — and in
addition to — the CI runs that already validated this same tree) hung
three consecutive times in an isolated worktree: once with `node_modules`
symlinked from the main checkout, once after a clean `npm ci`, and once
again with live progress monitoring in place. All three stalled at the
identical point — immediately after vitest's `RUN` banner, before any
test file reported a result — with near-zero CPU on the `vitest`
processes sustained for 30+ minutes. Not a slow run: the equivalent
suite completed in 5-10 minutes in two other worktrees earlier in this
same session.

**This window included the machine sleeping mid-response** (per direct
observation, not inferred). Combined with an earlier, unexplained
anomaly the same session — a ~48-minute gap between two `vitest` process
start timestamps during an earlier hang, well past anything the suite's
own runtime accounts for — the pattern points at this sandbox's network
path to test-db during/around a sleep-wake cycle, not at a defect in the
tests themselves or in the code under test. Not chased further: three
hangs is enough to establish the pattern without spending more cycles on
root-causing infrastructure that CI does not share.

**Standing consequence: CI is the authority for full-suite runs against
test-db, not local.** This sandbox was already established
(`docs/reviews/sandbox-cannot-test-concurrency.md`) as unable to produce
genuine concurrency; this incident adds that it cannot even reliably
*complete* a full suite run against test-db, for reasons that appear
environmental (machine sleep, network path) rather than code-related. A
local green was already the wrong evidence for anything concurrency-shaped;
after this, a local run's ABSENCE of a green result is not evidence of a
problem either, for the same class of run — CI is the only environment
whose result should be trusted either way. This session's actual
verification of the merged state (PR #104 and PR #105) came from their
own CI runs, not from this failed local attempt, and that CI evidence
stands regardless of this local hang.

**Note for the prod apply this verification precedes:** the apply itself
runs through the SQL Editor (per the PROD APPLIES rule, `CLAUDE.md` §0),
which does not depend on this local sandbox's network path at all — the
apply is not at risk from this. But the apply runbook's own pre/post
probes (`supabase db query --linked -f`) DO run from this same sandbox.
If a probe hangs during the apply, read that as a network symptom
consistent with this entry, not as a finding about the database or the
migration — retry the probe rather than escalating it as a database
problem on first hang.
