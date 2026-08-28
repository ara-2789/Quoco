# Pass 1 — outbound send primitive: scoping plan (2026-08-22)

**PLAN ONLY. No code, no migration file, no branch. PR #69 not touched.**

Source materials read: `/tmp/outbound-send-primitive-plan.md` (PR #69's plan — its
prose/reasoning is reused below where sound; its accompanying file DIFF, 47 commits
stale, is NOT reused anywhere), `/tmp/031.sql`, `/tmp/031-review-package.md`,
`docs/design-decisions-beta-feedback.md` §28 (l)/(w)/(x)/(z)/(bb) on `main`,
`docs/whatsapp-templates.md`'s GATE 1 / GATE 2 on `main`.

## Scope recap

**IN Pass 1:**
- A. STOP detection (BOT-27 SET-half), evaluated before every other inbound branch.
- B. The send primitive: raw `fetch` to the Messages API, no Twilio SDK.
- C. Migration 031 (`outbound_sends`) as the idempotency gate.
- D. `app/api/whatsapp/status-callback/route.ts`.
- E. Two cron entries: morning trigger 08:30 IST, evening trigger 18:30 IST.

**OUT of Pass 1** (explicit, per instruction): morning nudge, evening nudge, PM
escalation, DPR-ready-to-PM, weekly engineer feedback, owner delivery (email, #67).
Rationale, as given: the two triggers are the only sends that START a flow and
therefore touch session state; everything else is fire-and-forget. Do the stateful
design once, get it right, then the fire-and-forget sends (D onward in the eventual
full build) reuse the same send primitive with no new session-state question to
answer.

**ACCEPTED AS THE BASIS FOR THE BUILD (2026-08-22)**, with the amendments in the new
section at the end of this file folded in — original reasoning above and below is
unchanged, not rewritten. **Item A is SUPERSEDED, not merely amended — see Amendments
(a) below: §29(a) decides against a STOP keyword entirely; BOT-27's SET-half is OUT
of Pass 1.** Everywhere below that still reads as if item A ships, read it as
historical reasoning from the scoping pass, superseded by the Amendments section.
**Item F added** (Amendments (b)): a daily cron-did-not-fire comparison job, running
inside the existing `/api/jobs/tick` cron. Current true scope, after all amendments:
**B, C, D, E, F** — A is retracted, nothing else added or removed.

## A LOAD-BEARING FINDING NOT ASKED FOR, SURFACED BECAUSE THE REQUIRED READING SURFACED IT

Migration 031's own review package (`/tmp/031-review-package.md`, §"Sequencing") names
**two** blocking dependencies for applying 031, not one:
1. The trigger-cron workstream (satisfied by Pass 1 item E — this is the dependency
   everyone has been tracking).
2. **"B3's cross-flow RPC fix"** (`outbound-send-primitive-plan.md:337-380`) — a
   SEPARATE, already-DECIDED-but-NOT-BUILT bug, distinct from GATE 1. Its own
   description: an `eveningSend` trigger arriving while an engineer's session is still
   `current_flow='morning'` (never finished, or never even started, that day's
   morning flow) hits the evening RPC's `ELSE` branch, which "returns `'reask'`, but
   re-sends whatever question morning was on, not an evening question, because the
   branch doesn't check WHICH flow is active, only THAT one is." DECIDED fix (round 3
   external review): cutoff-close any session still stuck at `'morning'` past
   `morningCutoff` (15:00 IST) via a sweep, plus a force-switch backstop at
   `eveningSend`. ~~**Neither half is built.**~~

**CORRECTED, 2026-08-26 (Pass 1 freshness check, before code was written).** B3
shipped: migration 033 (`sweep_stale_morning_sessions`), applied to production
2026-08-25, confirmed live inside the deployed `jobs/tick` cron (`app/api/jobs/tick/
route.ts`, calling `sweepStaleMorningSessions` unconditionally every tick — verified
directly against `origin/main`, not assumed). It closes any `current_flow='morning'`
session past `morningCutoff`, live or parked, with no minimum-age check — see
`design-decisions-beta-feedback.md` §35b. The force-switch backstop at `eveningSend`
named above was never separately built and is now moot: with `routeInboundMessage`'s
own morning-window refusal (§35a/b, also 2026-08-26) preventing a morning session
from ever starting past `morningCutoff` in the first place, there is no longer a
"session stuck at `'morning'` past `eveningSend`" case for a force-switch to catch —
the cutoff-close sweep alone now closes the gap this finding originally named.

~~**This is not a future concern — it is directly exercised by Pass 1's own scope.**
Pass 1 item E puts a real evening-trigger cron into production at 18:30 IST, 3.5 hours
after `morningCutoff` (15:00). Any engineer who never finished (or never started)
their morning flow that day will, at 18:30, have `apply_evening_flow_turn` called
against a session still parked at `current_flow='morning'` — hitting the exact
mis-routed `ELSE` branch B3 describes. **Pass 1 cannot safely ship its own evening
trigger (item E) without B3's fix landing first, or as part of the same change.**
This is a second hard blocker, alongside GATE 1 (Q3, below), not a nice-to-have.~~
**SUPERSEDED, 2026-08-26 — B3 is built and live (above). This is no longer a
blocker; it is a cleared precondition. See item 3 of tonight's freshness check for
the fresh evidence.**

---

## 1. Session activation ordering

**Claim → SEND → activate. Not claim → activate → send.** Argued, not asserted:

The two writes (the `outbound_sends` ledger claim, and "activation" — calling
`apply_morning_flow_turn`/`apply_evening_flow_turn` with `startFlow: true`, which sets
`current_flow`/`current_step=1`, per §28(a)/(h)) sit on either side of an external
HTTP call (the Twilio `Messages` POST) that cannot be wrapped inside a single Postgres
transaction with them. Three points in time, two possible orderings for the middle
step relative to the Twilio call:

- **claim → activate → send (rejected):** if the Twilio call then fails — network
  timeout, Twilio 5xx, an async 63016-class rejection — the session has ALREADY been
  committed to `current_step=1`, but the engineer never received Q1. Their next real
  inbound (about anything, to anyone) gets consumed by the RPC as an answer to a
  question they were never asked. **This is the identical bug PR #69's own plan
  already found and fixed for skip-and-record** (`outbound-send-primitive-plan.md`
  §"B2 (round 2)": *"If no template exists, the RPC has already committed the
  engineer's session to step 1 — they never actually received Q1... their next real
  inbound message... gets consumed by the RPC as if it were an answer."* That fix
  reordered skip-and-record to precede the RPC call; the same reasoning applies with
  equal force to a Twilio failure, not just a missing-template skip.
- **claim → send → activate (adopted):** the RPC (and therefore any session-state
  write) is only ever called AFTER Twilio has confirmed synchronous acceptance. If
  the Twilio call fails, nothing about session state changes — the engineer's session
  stays exactly where it was, correctly reflecting that they received nothing.

**Within "send → activate," a second ordering question, same reasoning applied one
level deeper:** after Twilio confirms acceptance, does the RPC (session activation)
or the ledger update (`outbound_sends` → `'sent'`) run first? **RPC first, ledger
update second.** If the process crashes between these two writes: RPC-first leaves
the session correctly activated (matching reality — the message really was sent) with
only the LEDGER stale at `'sending'` — a bookkeeping gap, recoverable by a sweep (the
status-callback route, item D, or a stale-row reconciliation job, closes this the same
way `dprs.generation_claimed_at`/a stuck `'running'` row is meant to be recoverable
elsewhere in this codebase). Ledger-first would instead leave the ledger correctly
saying `'sent'` while the SESSION was never actually activated — a worse
inconsistency: a real message went out, asking a real question, but the backend has
no record that anyone is waiting on an answer, so the reply that eventually arrives
gets misrouted as an idle/ad-hoc case instead of Q1's answer.

**Full ordering:** `INSERT outbound_sends (status='sending')`, committed → `POST
.../Messages` → on 2xx: call `apply_{morning,evening}_flow_turn(startFlow: true)` →
`UPDATE outbound_sends SET status='sent', twilio_sid=...` → on non-2xx: `UPDATE
outbound_sends SET status='failed', error=...`, no RPC call, session untouched.

**What happens if the API call fails after activation — residual risk, named, not
solved here:** under this ordering, activation never happens BEFORE a confirmed
Twilio success, so a synchronous failure cannot strand the session. But Twilio can
accept a send synchronously (2xx, session correctly activated) and have Meta reject
it ASYNCHRONOUSLY moments later (error-63016-class, per PR #69's own B4 finding) — in
that case activation already happened, correctly, on the information available at
the time, but the message never actually reached the engineer. The status-callback
route (item D) can tell us this happened after the fact, but **nothing in Pass 1
automatically un-activates the session or re-nudges the engineer once that async
failure is learned** — this is named explicitly in §6 below as something Pass 1
cannot prove/close, not solved here.

---

## 2. Idle inbound, per §28(w) — interim behaviour

**§28(w)'s resolved shape:** cron starts scheduled flows; unrecognised inbound at
idle opens the ad-hoc menu (unbuilt, explicitly out of scope for Pass 1 too — "Do not
build the menu").

**What Pass 1 should do in the interim, and why:**

1. **Retire the CURRENT inbound-triggered flow-START path.** `routeInboundMessage`'s
   no-active-session branch (`lib/whatsapp/inbound-start.ts`, built for II3, explicitly
   labelled "SCAFFOLDING" by PP2/§27 itself — "to be replaced by a short
   acknowledgement once the #69/031 outbound-send primitive and its cron exist") must
   stop calling `startFlow: true` on an idle inbound, once Pass 1's cron exists. §28(w)
   is explicit: **"starting is the cron's job exclusively."** Leaving the scaffolding's
   start-on-inbound behaviour live alongside a working cron creates two independent
   flow-starters for the same session — even though the RPC's own `current_flow`
   branching would likely absorb a same-day double-start as a `'reask'` rather than a
   true duplicate, this is exactly the kind of two-writers-for-one-fact risk this
   codebase's own "HAND-MIRRORED RECONCILIATION" history warns against, and it costs
   nothing to just not have two starters when one (the cron) is now real.
2. **Do not build a menu.** In place of the START behaviour being retired, an
   unrecognised inbound at idle falls back to the SAME acknowledgement-only reply
   `routeInboundMessage` already produces for its other non-start branches (the
   "already-done"/`REPORT_READY_REPLY`-style responses this session's own live
   evidence already showed in production). This is not a new code path — it's the
   scaffolding's EXISTING fallback behaviour, now reached from every idle-inbound case
   instead of only some of them, until the ad-hoc menu (§7/§28(x)) is actually built.
3. **Consequence, stated plainly:** for the length of Pass 1, an engineer who messages
   in unprompted at idle gets an acknowledgement, never a flow, never a menu. This is
   a real product regression from what §28(x) ultimately wants (the menu as a "front
   door") but it is honest about the current state (never silent, never a dead end,
   per design-principles' own rule) and it correctly stops the scaffolding from doing
   the ONE thing §28(w) says it must not do anymore — start a flow.

**CORRECTION, 2026-08-26 (Pass 1's own freshness check, reviewing side's own
error, recorded so it isn't repeated).** Aravind's own kickoff message for
the freshness check asserted this section "was SILENT" on §28(w) — from
memory of an earlier report, not from re-reading this file. It is not
silent; the three numbered items above are an explicit, already-made
decision, unchanged since 2026-08-22. Corrected on read, not left standing.

**OPEN, 2026-08-26 — recorded, NOT decided, must be answered before the
`vercel.json` cron entries ship, not at cron-enable time.** Item 1 above
instructs retiring `routeInboundMessage`'s `startFlow: true` call on an
idle inbound once Pass 1's cron exists. `design-decisions-beta-feedback.md`
§35's two window guards (morning refuses at/after `morningCutoff`, evening
refuses before `eveningSend`, added 2026-08-26 — after this section was
written, hence the gap) live INSIDE that exact branch, immediately before
the same `applyMorningFlowTurn`/`applyEveningFlowTurn` calls item 1 says
must stop firing. Once the cron exists and item 1's retirement happens,
the guards' own CHECKS become dead code — there is nothing left to guard,
since `startFlow: true` is never called from this path again. But their
COPY (*"...will be sent automatically"*) is more useful to a real engineer
than the generic acknowledgement item 2 above falls back to, once that
promise is actually true (§35f, once the crons exist). Proposed reading,
recorded as a proposal, not a decision: **the checks die with the
retirement item 1 already calls for; the copy survives, repointed as a
time-aware idle acknowledgement** (an inbound before 15:00 gets one
acknowledgement shape, 15:00-18:30 another, matching what §35's guards
already say, without the now-dead `startFlow: true` call behind them).
Not decided here — answer this before item E ships, not discovered as a
loose end at cron-enable time.

---

## 3. GATE 1 — how Pass 1 avoids it

**Recommendation: block on the flow migration, via withholding the cron entries, not
a feature flag.**

Three options, argued:
- **Ship dark** (deploy the send code, let the cron fire for real) — rejected outright.
  This reproduces GATE 1's exact violation the first time the cron fires: template 1
  asks attendance, the live unmigrated RPC still stores a "yes"/"no" reply as
  `morning_plan` free text. Not a residual risk — a certainty, the first real send.
- **Ship behind a flag** — technically prevents the violation (flag defaults off) but
  introduces a runtime toggle this codebase has no other precedent for and no other
  need for once the real gate (below) exists. Runs against this project's own coding
  rule: don't reach for a flag/shim when the code can just be sequenced correctly
  instead.
- **Block on the flow migration by withholding the cron entries (recommended):** write
  and merge the send-primitive CODE in Pass 1 (items A-D), including the `event_key`
  format and the RPC-call sites, but do **not** add the two `vercel.json` cron entries
  (item E) until GATE 1 is independently confirmed lifted — the flow migration
  (§28(l), attendance-as-Q1) shipped and verified live. Without a cron entry, nothing
  ever calls the trigger path; the code sits inert and reviewable, exactly the same
  mechanism this project already relies on for `CRON_SECRET`-gated routes and the
  `dpr-generate` cron's own rollout. **Reversible and inspectable by reading a
  committed file, not by trusting a runtime flag's current value** — matches this
  project's own "verify by observation" standard better than a flag would.
- Also recall this doesn't ONLY gate on GATE 1: the B3 cross-flow fix (§0 above) is a
  second, equally hard precondition for the evening half of item E specifically — both
  must be true before `vercel.json` gets its two new entries.

**GATE 1: LIFTED, 2026-08-25.** Recorded 2026-08-26, during Pass 1's own freshness
check, before any Pass 1 code was written — both prior sentences above described this
as a still-pending future condition; it is no longer pending. Evidence, fresh, not
assumed (re-verified live against production the night this was recorded, breadcrumb
confirmed `jvxwqignooseazzmwhvl` before each read, link restored to test-db after):
```
schema_migrations: version 030, name morning_flow_attendance — present
apply_morning_flow_turn signature: p_phone_number, p_tenant_id, p_user_id, p_project_id,
  p_message, p_start_flow, p_manpower, p_manpower_ok, p_equipment, p_equipment_ok,
  p_now, p_test_sleep_ms — byte-identical to 030's 12-arg signature
apply_morning_flow_turn body mentions 'attendance': true
daily_logs.attendance column: present
```
Plus, from code on `main`: `MORNING_QUESTIONS[1]` = `'Good morning. Are you on site
today? Reply yes or no.'` — matches template 1's approved copy verbatim. Both halves
of GATE 1's own condition (030 applied; RPC's actual Q1 agrees with the approved
template) are satisfied. **This does not by itself mean `vercel.json`'s two cron
entries should be added tonight** — see the "Two hard preconditions" section below,
which now separately records that withholding them tonight is deliberate pacing, not
something the gate itself still requires. Same correction owed to
`docs/whatsapp-templates.md`'s own GATE 1 section, which reads the same stale way —
recorded there too, same date.

---

## 4. Cost

**Rate, cited:** Meta's WhatsApp Business Platform India rate card, revised
2026-01-01: **Utility/Authentication ₹0.115 per delivered template message**
(per-message pricing, not the pre-2025-07-01 conversation-based model). Marketing
₹0.8631/message; service replies free. Source: live web search, 2026-08-22 (Meta's
own rate-card change is corroborated by multiple third-party WhatsApp BSP pricing
summaries dated 2026; not independently re-verified against Meta's own primary
developer-docs page in this pass — flagged as a fact worth a direct-source check
before this number is used to set a real budget line, per this project's own "verify,
don't assume" standard for facts that might have changed).

**Pass 1 (2 sends/engineer/day — the two triggers, always-template per §0 above):**

| Projects (×3 engineers) | Engineers | Daily | Monthly (×30) |
|---|---|---|---|
| 1  | 3   | 3 × 2 × ₹0.115 = ₹0.69   | ≈ ₹20.70   |
| 10 | 30  | 30 × 2 × ₹0.115 = ₹6.90  | ≈ ₹207.00  |
| 50 | 150 | 150 × 2 × ₹0.115 = ₹34.50 | ≈ ₹1,035.00 |

**Full set once Pass 2 lands (up to 6 sends/engineer/day, worst case — both triggers,
both nudges, and headroom for PM-escalation/DPR-ready-to-PM amortized per engineer):**

| Projects (×3 engineers) | Engineers | Daily | Monthly (×30) |
|---|---|---|---|
| 1  | 3   | 3 × 6 × ₹0.115 = ₹2.07   | ≈ ₹62.10   |
| 10 | 30  | 30 × 6 × ₹0.115 = ₹20.70 | ≈ ₹621.00  |
| 50 | 150 | 150 × 6 × ₹0.115 = ₹103.50 | ≈ ₹3,105.00 |

**Does this change the always-template choice for nudges? No.** Even at 50 projects
under the Pass-2 worst case, the monthly template spend (≈₹3,105, roughly $37 USD/mo)
is trivial for a B2B SaaS at that scale — the same conclusion this project already
reached for DPR generation cost (`design-decisions-beta-feedback.md`'s own "cost
nothing measurable" finding). The always-template decision for trigger sends was made
to eliminate an entire reachability-race bug class (B1/error 63016), not to save
money — cost was never the argument for it and isn't a reason to revisit it now.

---

## 5. Failure modes

| Failure | Intended behaviour |
|---|---|
| **Engineer `messaging_blocked=true`** | Excluded from the roster query BEFORE any claim/send attempt (per PR #69's plan §"messaging_blocked belongs in 3a's ROSTER FILTER, not only in 3e's write path" — the roster the cron iterates never includes a blocked engineer in the first place; no ledger row, no Twilio call, no error). |
| **Number not on WhatsApp** | Twilio 4xx (invalid/unreachable recipient) — non-retryable. Ledger row → `'failed'`, `error` populated. Sentry alert (real, actionable — this is a genuine bad-number/deregistered-number problem, not the expected template-gap state). Session NOT activated (per §1's ordering). |
| **Template rejected by Meta AFTER approval** (e.g. Meta later disables an approved template) | Twilio 4xx on the send call referencing that ContentSid. Non-retryable — same template, same rejection, every time until resubmitted. Ledger → `'failed'`, Sentry (configuration-class bug, always loud). Session not activated. |
| **Error 63016 (free-form outside window)** | Does not apply to items A/B/C/D/E as scoped — Pass 1's ONLY sends are the two always-template triggers (§0's "always-template for trigger sends" decision), so 63016 can only occur on the ACCEPTED-then-asynchronously-rejected class PR #69's plan names as "the failure this table originally missed entirely" (B4) — handled via the status-callback route (item D): ledger flips from `'sent'` to `'failed'` once the async status arrives. Session was already activated on the synchronous accept (per §1) — the residual "session activated but message never truly delivered" gap is named in §6, not closed here. |
| **Twilio 5xx / network timeout on the send call itself** | Retryable. Ledger row left at `'sending'` (ambiguous — did Twilio receive it or not, per PR #69's own 3d/3e table). Cron's own idempotency (claim via the `UNIQUE(tenant_id, recipient_user_id, event_key)` constraint) makes a RETRY of the same checkpoint safe: a second cron invocation for the same `event_key` hits the unique constraint and no-ops rather than double-sending. A stale `'sending'` row needing reconciliation is a known, named gap — see §6. |
| **Cron fires twice** (duplicate Vercel invocation, or a retry) | Safe by construction: the `INSERT INTO outbound_sends` claim is the idempotency gate. The second invocation's INSERT hits `UNIQUE(tenant_id, recipient_user_id, event_key)` and is rejected/no-ops before any Twilio call is made — no double-send possible for the same checkpoint+engineer+day. |
| **Cron does not fire at all** (Vercel outage, deploy gap, misconfigured schedule) | Nothing sends, nothing is recorded — no ledger row is created for that checkpoint at all, for any engineer. This is INDISTINGUISHABLE, from inside the system, from "there was nothing to send" unless something external (uptime monitoring on the cron route itself, or a daily count check: "roster size vs. ledger rows created for `event_key` LIKE 'morning_send:%'") notices the absence. **PROMOTED TO IN-SCOPE, see Amendments (b) below — no longer "not solved in Pass 1."** |

---

## 6. What Pass 1 cannot prove

- **A real, successful, unattended, end-to-end cron-triggered send has never happened.**
  Everything about this design is reasoned from the RPC's existing behaviour (already
  proven, via the manual/test-trigger sandbox rounds this session's own history
  records) and from Twilio's documented API contract — but no code in this plan has
  ever actually been run against the real Content API's send endpoint. The first real
  cron firing is the first real proof.
- **Whether the async-rejection gap (§1's residual risk, §5's 63016 row) is rare
  enough to ignore or common enough to need closing in Pass 1 after all** — Pass 1
  has no data on how often Meta's asynchronous rejection actually fires versus the
  synchronous-4xx case, because nothing has ever sent a real template through this
  account's production sender yet.
- **Whether "cron did not fire" (§5's last row) is a real operational risk or a
  theoretical one** — ~~no monitoring exists yet to even notice this class of silent
  failure, so Pass 1 cannot demonstrate it would be caught if it happened~~ — SUPERSEDED,
  see Amendments (b): a daily count check is now IN Pass 1's scope, so this bullet no
  longer applies as originally written. Left visible, struck, not deleted, per this
  project's own correction convention.
- **B3's fix, once built, actually closes the cross-flow interference gap** — Pass 1's
  plan assumes B3 lands (a hard precondition, §0 above) but building and verifying B3
  is not part of this plan; whether the cutoff-sweep + force-switch combination
  behaves correctly under real concurrent load is untested by anything in Pass 1.
- **Whether retiring the inbound-start scaffolding's flow-start behaviour (§2) has any
  user-visible side effect this plan hasn't anticipated** — e.g. an engineer who has
  come to rely on messaging in early to start their day (a real, if unintended,
  behaviour PP2 itself calls "scaffolding") loses that capability the moment Pass 1
  ships item E, in favour of waiting for the 08:30/18:30 cron. This is a real UX
  change with no user-facing communication planned as part of Pass 1.
- **The cost model (§4) is a per-message rate multiplied by an assumed send count** —
  it has not been checked against a real Twilio invoice, and the "up to 6/engineer/day"
  Pass-2 figure is a stated assumption from the brief, not independently derived or
  verified here.
- **THE FAST-REPLY RACE (added 2026-08-22, Amendments (c)):** under claim → send →
  activate (§1), there is a real window between Twilio delivering the message and the
  RPC call that activates the session. An engineer who replies inside that window hits
  a session that is, from the database's point of view, still idle — his reply is
  processed as an idle inbound (per §2's interim behaviour: an acknowledgement, not
  Q2) rather than as the answer it actually is. The window is small (one HTTP round
  trip plus one RPC call) but it is the FIRST message of the engineer's day, so a
  narrow window still has a real chance of being hit precisely when it matters most.
  Not closed in Pass 1 — named here alongside the async-rejection gap because it is
  the same shape of problem (session state momentarily out of step with what the
  engineer has actually experienced), and because Pass 1's own architecture (an
  external HTTP call sitting between two states that cannot share one transaction) is
  what creates it.

---

## 7. Review-package artifacts this pass will need

Migration 031 adds a new table (no existing function touched by 031 itself, but the
workstream as a whole trips CLAUDE.md §0 via B3's own RPC change — see 031's own
already-completed gate evaluation, reused, not re-derived: (b)/(d)/(e) trip). Per the
standing external-review gate and this project's own established package shape
(027/029/031's own precedent):

1. **Repo-state header** — `main @ <sha>`, `supabase migration list` (local/remote),
   last runbook executed + date. Ten seconds, required since PR #69/031 predate this
   by 47 commits — the reviewer must not work from a stale mental model of `main`.
2. **The migration file itself, re-pinned** — 031's SQL, at whatever commit it's
   finally applied from (NOT the 47-commits-stale one currently in PR #69), with the
   disposable dry-run scaffold run against it (per the standing "EVERY NEW MIGRATION
   GETS A DISPOSABLE DRY-RUN" rule) — a real `pg_dump`-scaffolded local Postgres, not
   a hand-built one.
3. **Test-db rehearsal**, on a cleaned existing branch (per the standing rule against
   fresh-provision rehearsal), with pre/post-apply catalog probes: RLS policy text,
   grants (`has_table_privilege`), and — per the standing U1-U5 rule — a real anon-key
   call proving `anon`/`authenticated` cannot INSERT/UPDATE/DELETE `outbound_sends`,
   not just an absence from the catalog.
4. **B3's own fix**, as its own migration/PR, reviewed on its own terms — named as a
   hard precondition here, not folded into 031's own package. **Widened scope, see
   Amendments (d) below** — must also cover the morning-cutoff-submits-as-is decision
   (§29(d)), not only the session-state reset the original B3 decision covered.
5. **GATE 1's lift**, verified live (the flow migration shipped, template 1's copy
   and the RPC's actual Q1 now agree) — evidence, not a checklist tick, per this
   project's own "rollback mechanisms are verified by observation" standard extended
   to this gate too.
6. **The retryable-vs-terminal failure table** (§5 above) and the cost table (§4
   above), both carried into the package as-is — already reasoned here, not
   re-derived at review time.
7. **The status-callback route's own signature/idempotency test** — Twilio retries
   status callbacks; the route must be idempotent on `MessageSid`, proven by a real
   test, not asserted. **Now also needs the host-allowlist signature-validation test —
   see Amendments (a).**
8. **A dated statement of what Pass 1 does NOT cover** (§6 above), carried verbatim
   into the package so the reviewer evaluates this pass on its actual, bounded scope —
   not an implied "the whole primitive," which this pass explicitly is not.

---

## Amendments (2026-08-22)

Folded in per direct instruction, after the plan above was accepted as the build
basis. The reasoning above is unchanged; these are additions, not rewrites.

### (a) Status-callback signature validation inherits the host-pinning bug

`app/api/whatsapp/status-callback/route.ts` (item D) is a SECOND Twilio-facing
endpoint, alongside the existing inbound webhook — it therefore needs the identical
signature validation `app/api/whatsapp/webhook/route.ts` already does
(`validateTwilioSignature`), and by inheriting that code path, it inherits the SAME
unfixed bug CLAUDE.md already tracks: the validation URL is built from a single,
fixed `NEXT_PUBLIC_APP_URL`-derived string (`webhook/route.ts:138`), not a pinned
allowlist of valid hosts — the exact gap a 2026-08-20 domain move already turned into
a full day of silently-rejected inbound traffic (CLAUDE.md's own "WEBHOOK SIGNATURE
VALIDATION IS HOST-PINNED, NOT HEADER-DERIVED" entry, which named the allowlist fix as
"tracked, not built," gated only on the production WABA sender's own inbound-webhook
wiring, item 6 in that entry's own accounting).

**Consequence: the host-allowlist fix is now ALSO a Pass 1 dependency, not only a
production-sender dependency.** A NEW endpoint (status-callback) reusing the SAME
single-string validation approach would carry the identical fragility forward into a
second route from day one, rather than fixing it once, in the one place both routes
would otherwise duplicate it. Build the allowlist as part of item D, shared by both
the inbound webhook and the new status-callback route, not as a status-callback-only
patch.

### (b) Cron-did-not-fire check — promoted from "cannot prove" (§6) to IN SCOPE

**§5's own last row and §6's own "cron did not fire" bullet are both amended by this
decision — struck through in place, not deleted, above.** Rationale, as given: this
is the ONE failure mode where literally nothing is recorded anywhere in the system —
every other row in §5's failure table produces at least a `'failed'` ledger row or a
stale `'sending'` one; a cron that never fires produces zero rows, indistinguishable
from a quiet day with nothing to send. The `outbound_sends` ledger (item C) makes this
a one-line comparison — expected roster size for a checkpoint vs. count of rows
created for that day's `event_key` prefix (e.g. `morning_send:2026-08-22:%`) — and the
table is being built regardless, so the check costs one query, not new
infrastructure. **Added to Pass 1's scope as item F: a daily comparison job** (runs
inside the existing `/api/jobs/tick` cron per Amendment (d) below, not a new
`vercel.json` entry), alerting (Sentry) when a checkpoint's row count is materially
below its expected roster size.

**CORRECTED, 2026-08-26 — the spec above undercounted its own failure mode; migration
031's own design notes carry the full argument, restated here since this is item F's
original spec.** ~~"count of rows created for that day's `event_key` prefix"~~ is
wrong: a claim commits `status='sending'` BEFORE the Twilio call, so a process death
in that window leaves a row that counts toward "created" without ever having sent
anything — the exact case item F exists to catch, hidden by its own original query
shape. **Fix (a):** the comparison counts `status = 'sent'` rows, not all rows for the
`event_key`. **Fix (b):** because the ledger's `UNIQUE(tenant_id, recipient_user_id,
event_key)` constraint means a stuck `'sending'` row has no natural retry path
(tomorrow's `event_key` is a different string; nothing re-claims today's), item F is
widened to ALSO scan for rows stuck at `status='sending'` past a 10-minute threshold
and alert (Sentry, deduplicated per row) rather than auto-retry — argued in full in
031's own header, under "STUCK-CLAIM RECONCILIATION": a blind age-based reclaim cannot
tell "died before the Twilio call" (safe to retry) from "died after Twilio's 2xx,
before the status update" (retrying would double-send a real, delivered message) —
both leave an identical ledger signature, and a threshold makes the ambiguous case
less likely, never impossible. Resolution stays a human decision (checking Twilio's
own delivery record for that window), not an automated retry — the only way to keep
"no code path ever double-sends" an absolute guarantee rather than a probabilistic
one. This was NOT future work deferred past Pass 1 — it was mis-scoped as such in
this section's original text, caught only because item F and the stuck-row gap turned
out to be the same failure mode viewed from two sides, both already in this Pass.

### (c) Fast-reply race — added to §6

Full text folded into §6 above, at the point where it belongs alongside the
async-rejection gap (same failure shape: session state momentarily behind what the
engineer has actually experienced). Not repeated here.

### (d) 15:00 sweep placement — inside `jobs/tick`, not a new cron entry

**B3's decided fix (cutoff-close any session stuck at `current_flow='morning'` past
`morningCutoff`) runs inside the EXISTING `/api/jobs/tick` cron** (already fires every
minute, per `vercel.json`), not as a new, separately-scheduled `vercel.json` entry.
Reasoning: `vercel.json`'s two new trigger entries (item E) are being deliberately
WITHHELD until GATE 1 and B3 are both confirmed lifted (§3 above) — but the sweep
itself is not one of the two trigger sends being withheld; it is the FIX that makes
the evening trigger safe to enable in the first place. Running it inside `jobs/tick`
means it can ship, and start actually closing stale morning sessions, entirely
independently of when `vercel.json` gets its two new trigger entries — the sweep does
not need to wait for its own precondition to be lifted, since it IS the thing lifting
one half of that precondition. `jobs/tick`'s own one-poller-not-per-job-type
convention (already an accepted deviation elsewhere in this codebase, per CLAUDE.md's
NFR-16 note) is reused here, not a new pattern.

**Widened scope, per §29(d) (see `design-decisions-beta-feedback.md`):** the sweep's
job is no longer only "reset `current_flow`/`current_step` to idle" (the original B3
decision) — it must also STAMP the session's partial answers as submitted, keeping
whatever was actually recorded as real data, not discarding it. This is a real,
substantive widening of what "B3's fix" has to do, not a cosmetic rename — item 4 in
§7's review-package list is updated to reflect it.

### (e) Roster filter change — site-holiday exclusion (2026-08-22, §30(d))

**The evening trigger's roster (item E) must ALSO exclude any engineer whose
`daily_logs` row for that date has `attendance = 'site_holiday'`, not only those with
`messaging_blocked=true`.** Per §30(b)/(d) (`design-decisions-beta-feedback.md`), a
site-holiday engineer's evening trigger must never fire — the site was closed, there
is nothing to ask. §5's failure-mode table above (the `messaging_blocked` roster-filter
row) is amended by this addition, not superseded: both exclusions apply to the same
roster query, checked before any claim/send attempt, for the same reason (an
engineer who should never be sent this trigger at all is filtered out upstream of the
ledger, not sent-then-skipped). **The same exclusion applies to the nudge and
PM-escalation rosters once Pass 2 builds them** — named here so it isn't
independently rediscovered when those rosters are built.

**Sequencing note:** this exclusion depends on `daily_logs.attendance` existing (§30(c),
part of the morning flow migration, §30(a)) — the roster filter change and the morning
migration are not independent; the filter cannot be written correctly before the
column it reads exists.

### (f) Roster filter — the evening trigger must NOT gate on morning submission (2026-08-27, §37(a))

**The evening trigger's roster (item E) must NOT inherit `routeInboundMessage`'s
`morningSubmitted` gate.** Per §37(a) (`design-decisions-beta-feedback.md`), confirmed
against §30(b)/(d) above: an engineer who missed the morning window entirely may have
been on site all day, and the evening trigger asking what happened does not depend on
whether he already answered a different, earlier question. The roster's only two
exclusions remain exactly as (e) above states them — `messaging_blocked=true` and
`attendance='site_holiday'` — nothing else, and specifically not morning-submission
state.

**Why this needs saying explicitly, not left implied by (e)'s silence on the topic:**
`routeInboundMessage` (`lib/whatsapp/inbound-start.ts`), the INBOUND path already built
and live, nests its own evening-start branch inside `else(morningSubmitted)` — an
engineer who never touches morning cannot self-start evening via that path, for the rest
of the day (full trace: `design-decisions-beta-feedback.md` §37(b)). That gate is specific to the inbound code path and was
never a decided requirement for the roster query this item describes. Named here so the
same gate is not accidentally carried into the OUTBOUND roster query by a future
implementer reasoning from `routeInboundMessage`'s existing shape as precedent — it is
not precedent for this query.

### (g) 429 re-claim is UNBOUNDED in item B — item E must decide the retry
budget explicitly, not inherit one that doesn't exist (2026-08-28)

**RECORDED HERE ON PURPOSE, NOT SOLVED — a decisions-file note alone will not be read at
build time; this file is where item E's own author will actually look.** Item B
(`lib/whatsapp/outbound/trigger.ts`) makes a 429 genuinely retryable: a rejected send
marks its `outbound_sends` row re-claimable, and the *next* `triggerCheckIn` call for the
same `event_key` wins it back via an atomic conditional `UPDATE`. Nothing in item B caps
how many times this can happen. The bound, if any, belongs entirely to the **caller's own
retry cadence** — and that caller is item E, which does not exist yet. Item B was written
deliberately not to own this decision (the mechanism only answers "can a retry succeed
when attempted," never "how often should one be attempted") — but that means the decision
is currently unowned, not that it doesn't need making.

**Why this is a real question, not a hypothetical one.** This project's own account sits
on the unverified-business messaging tier — **250 business-initiated conversations per
rolling 24 hours** (`docs/reviews/whatsapp-template-submission-status.md`'s own
"Answered-on-attempt" table, closed 2026-08-23). The morning cron fires the whole day's
roster in one burst against that cap. A sustained 429 condition across some slice of the
roster during that burst is a realistic STEADY STATE at anything beyond a handful of
engineers, not an exotic edge case — this is the same premise §37(a)'s own 429-retryable
decision was made against.

**The question item E must answer explicitly, before its own `vercel.json` cron entries
ship:**
- How many times may a persistently rate-limited engineer be retried for the same
  checkpoint, in one day?
- Does that budget apply **per engineer**, **per checkpoint** (i.e., shared across every
  engineer hitting the SAME burst), or is it a property of the cron's own invocation
  cadence with no explicit cap at all?
- What happens when the budget (if any) is exhausted — does the engineer's day end
  silently at whatever the row's last state was (`'sending'`, marker still set), or does
  something explicitly close it out (analogous to item F's own stuck-row reconciliation,
  but for a row still genuinely re-claimable rather than ambiguously stuck)?

Not answered here. Item E's own review package must state its answer, not assume item B
already provided one.

---

## Two hard preconditions for enabling Pass 1's cron entries (`vercel.json` item E)

Stated once, plainly, here and in `design-decisions-beta-feedback.md` §29:

1. **GATE 1** — the flow migration (§28(l), attendance-as-Q1) shipped and verified
   live (template 1's approved copy and the RPC's actual Q1 agree).
2. **B3's cross-flow fix, WIDENED by Amendment (d)/§29(d)** — built and verified: the
   sweep both closes stale morning sessions AND stamps their partial answers as
   submitted real data.

**Neither is scheduled. The Pass 1 CODE (items A [now retired, see above]/B/C/D/F)
may merge before both are done. The two `vercel.json` entries (item E) may not be
added until both are confirmed true by direct observation** — not by a checklist
line, per this project's own standing "rollback mechanisms are verified by
observation" discipline extended to this gate.

**CORRECTED, 2026-08-22 (§30(i)):** the two conditions above are not
independently-satisfiable — they are ORDERED. B3's sweep must know which morning
question each `current_step` value means to correctly preserve partial answers, and
the morning flow migration (§30(a)/(b)) changes that exact mapping. **Corrected
order: morning flow migration ships first, then B3's sweep is written once against
its final shape, then Pass 1's two `vercel.json` cron entries may be added.** Full
reasoning in `design-decisions-beta-feedback.md` §29's own corresponding correction
and §30(i).

**ADDED, 2026-08-26 (`design-decisions-beta-feedback.md` §35f) — not a
precondition to enabling the crons, a required VERIFICATION at the moment
they're enabled.** `routeInboundMessage`'s two check-in-window refusal
strings (morning after `morningCutoff`, evening before `eveningSend`)
both promise "will be sent automatically" — a promise that is FALSE until
these crons exist. When Pass 1's `vercel.json` entries land, confirm by
direct observation (same discipline as GATE 1/B3 above, not a checklist
tick) that an engineer refused during either window actually receives
the automatic message the copy promises, before treating this item as
closed. If Pass 1 slips, or real engineers arrive before it ships, this
copy must be rewritten to something honest BEFORE that happens — accepted
as a known-false string only at current scale (one engineer, days not
months away), not indefinitely.

**BOTH PRECONDITIONS CONFIRMED CLEARED, 2026-08-26 (Pass 1's own freshness
check, before any Pass 1 code was written).** GATE 1: LIFTED (evidence in
§3 above). B3: shipped and live — migration 033, applied to production
2026-08-25, confirmed calling `sweepStaleMorningSessions` inside the
deployed `jobs/tick` cron. **This does NOT mean the two `vercel.json`
entries are being added tonight.** Withholding them tonight is Aravind's
own pacing on top of the now-satisfied gate, not something the gate
itself still requires: nothing has ever sent a real message, and the
primitive (items B/C/D/F) is being built and reviewed first, before
anything fires unattended at 08:30. Tonight's scope: migration 031
(written fresh, held in `docs/reviews/`, not applied), and, once
reviewed, the send primitive. `vercel.json` stays untouched.
