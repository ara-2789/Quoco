# Design Decisions — Outbound Infra & Auth (§25, §26, §29, §36, §41)

> Split from `docs/design-decisions-beta-feedback.md` (2026-09-14, docs-rescue/split pass).
> That file is now the INDEX for every section number in the original doc — consult it
> if a citation elsewhere doesn't match a section below. **Section numbers are unchanged
> from the original file; content below is moved verbatim, not re-worded.**

---

## 25. TEMPLATES and a PRODUCTION SENDER are two separate Meta dependencies —
only the first is removed by the customer service window (2026-08-12)

Verified against Meta's and Twilio's current documentation (not memory —
both this session's and a prior session's recollection of this rule were
checked against source, since the two disagreed): a business-initiated
WhatsApp message sent inside the 24-hour customer service window (opened
and reset by any inbound message from the user) requires no pre-approved
template — Meta's own term for this is a "service" conversation, free of
charge, no category assignment beyond "service." This means the daily
check-in nudge rhythm (morning nudge ~9-12h after the prior evening reply,
evening nudge ~9-12h after the prior morning reply) can run with **zero
Meta template approvals**, provided every engineer has sent at least one
inbound message to open the window.

**This does NOT unblock the production Twilio sender**, and the two must
not be conflated when talking about what's "blocked on Meta." CLAUDE.md §10
tracks the sender application as its own item (~2 weeks, blocked on company
registration) — that dependency is unrelated to templates and is untouched
by this finding. The sender governs WHETHER Quoco can send WhatsApp
messages from a production number at all (currently only the Twilio Sandbox
is available); templates govern WHETHER a specific business-initiated
message needs pre-approval once a number CAN send. Removing the template
requirement for in-window nudges does nothing to the sender's own
~2-week/entity-paperwork timeline — the certificate/company-registration
path stays on the critical path for anything beyond sandbox testing
regardless of this finding.

**What the finding actually buys**: the ability to build and test the full
nudge/check-in rhythm against the Sandbox now, without waiting on template
approval — the template-approval tail is removed from the timeline, not the
sender-application blocker. The Sandbox carries its own separate
constraints (72-hour join expiry per engineer, no custom templates at all,
1 msg/3s rate limit) that don't apply to production but do shape how a
multi-day sandbox beta actually runs.

**The one case this doesn't cover**: a gap >24h since an engineer's last
inbound (a skipped day, weekend, sick day) closes the window, and the next
scheduled nudge would need either a template or the engineer to
self-initiate. Full analysis in the conversation this decision came from,
not restated here — see also CLAUDE.md's WhatsApp-flow entries.

## 26. AUTH DECISIONS — recorded as a SEPARATE workstream, NOT planned or built here (2026-08-15)

**Recorded only. No plan, no scoping, no code from this entry.** Aravind's decisions,
captured so they exist on the record before the workstream itself starts:

- **First user creation → magic link (unchanged, existing behaviour). Every login after
  the first → OTP delivered over WhatsApp**, not magic link, not password.
- **Session expiry: 7 days, SLIDING** — inactivity-based (each real request resets the
  7-day window forward), not a fixed ceiling from login time.
- **Trips CLAUDE.md §0 condition (c)** ("touches auth or identity") on its own terms,
  unambiguously — **this workstream goes to external review from the PLAN stage**, not
  just before apply. Named explicitly so nobody has to re-derive it from the gate's general
  wording when this work actually starts.
- **WhatsApp OTP needs its own Meta template category: Authentication.** Distinct approval
  track from the Utility-category check-in templates already in flight — purely functional
  wording required, a mandatory validity-period line, and the variable slot MUST be the
  bare numeric code (no surrounding sentence fragment in that slot). Priced at
  **~₹0.115 per delivered message in India, roughly half the equivalent SMS OTP cost.**
- **⚠ Authentication-category templates are billed on EVERY delivery, including inside an
  already-open 24-hour session window — unlike every other template category.** The
  "in-window sends are free" reasoning this project's check-in design leans on (§25 above)
  does NOT carry over to OTP sends. Every login OTP is a real, metered cost, full stop.
- **⚠ WhatsApp-only auth is a single point of lockout.** This codebase already has a named
  `messaging_blocked` state precisely because WhatsApp delivery fails for some users
  (opt-outs, carrier issues, number changes) — under WhatsApp-only OTP, a user in that
  state could not receive a login code to fix their own account. **Recorded as an
  accepted, dated MVP risk, not a blocker and not silently ignored** — SMS fallback is
  named as the eventual closer, not built now.
- **Shares the Meta template-approval dependency already on the critical path** for the
  check-in flows (§25's own finding: the certificate/company-registration timeline, not
  the template review itself, is the long pole) — Authentication-category approval is a
  SEPARATE submission from the Utility-category check-in templates, so this cannot go live
  ahead of its own approval landing, independent of whatever happens with the check-in
  templates' timeline.

**Why recorded here and not scoped further:** per direct instruction, this is capture
only. The workstream's own plan — when it starts — inherits condition (c)'s external-review
requirement from its first draft, not as a gate discovered partway through.

## 29. Pass 1 outbound send primitive — five decisions (2026-08-22) — DECIDED, not built

Recorded alongside `docs/plans/pass1-outbound-send-plan.md`, which these decisions were
folded into as amendments. Plan and documentation only — no code, no migration file in
`supabase/migrations/`, no cron entries.

### a. NO STOP KEYWORD — BOT-27's SET-half is OUT of Pass 1's scope

Engineer opt-out is a PM decision, using the existing `status='deactivated'`.
`messaging_blocked` remains engineer CONSENT state and is never PM-clearable — this does
not reopen or contradict PR #69's own already-reasoned B2 (round 1) finding
(`outbound-send-primitive-plan.md`, "`messaging_blocked` is NOT a delivery-failure flag";
it stays a consent flag written only by `clearMessagingBlock`, which only ever writes
`false`) — it goes further: no code path is ever added to write `messaging_blocked=true`
from an inbound STOP keyword either. The scoping plan's own item A (STOP detection,
"ships first") is retracted by this decision, not merely deferred.

**Accepted cost, recorded plainly, not minimised:** with no in-product opt-out route, an
engineer who wants the messages to stop has exactly one option — WhatsApp's own Block —
which is invisible to this system (no signal, no row, no way to ever know it happened),
counts against the sending number's own quality rating under Meta's rules, and cannot be
undone by anyone on either side once it happens (unlike `messaging_blocked`, which
`clearMessagingBlock` can always reverse). This is a real, accepted trade, not an
oversight — see (b) for what replaces it, and its own dependency on the still-unbuilt
ad-hoc menu.

### b. OPT-OUT BECOMES AN AD-HOC MENU ITEM

A free-text-comment opt-out request, routed to the PM as a request rather than acted on
as a silent removal. Rationale: cannot be triggered accidentally (unlike a bare keyword
match, which a garbled or unrelated message could theoretically collide with); captures
WHY the engineer wants out, which distinguishes "I've left this project" (a roster
problem, PM should reassign) from "too many messages" (a product/frequency problem, PM
should reconsider cadence) — two situations with OPPOSITE correct PM responses that a
bare STOP keyword can never tell apart.

**Recorded as a dependency of §28(x):** until the ad-hoc menu is actually built, there is
**NO opt-out path of any kind** in this product — not the keyword (a, retracted), not the
menu item (this decision, unbuilt). Acceptable at beta scale, where the PM/founder can
plausibly notice and handle an unhappy engineer directly; this carries a real compliance
obligation once real engineers beyond the beta cohort are on the system, and that
obligation is not discharged by this decision, only named by it.

### c. TEMPLATE 8 COPY MUST CHANGE — and this decision is what LIFTS GATE 2

`quoco_engineer_optin`'s current body promises "Reply STOP at any time to stop these
messages" — no longer accurate, per (a). The copy must be rewritten to describe the
PM-managed route (b) instead, once the menu exists to describe. **This template is
unsubmitted and held under GATE 2 (`docs/whatsapp-templates.md`), so this correction is
free to make now, before it is ever seen by Meta or an engineer — no resubmission,
no re-approval cost, no 30-day name lock at risk.**

**This decision is what LIFTS GATE 2.** GATE 2 existed for exactly one reason — the
template's body carried a promise (`messaging_blocked` set by a STOP reply) that no code
ever kept. Once the promise itself is rewritten to match what (a)/(b) actually build,
there is nothing left for GATE 2 to guard against. GATE 2 lifts when this rewrite lands,
not before.

**Do not resubmit yet — flagged for approval, not actioned here.** This entry records the
decision and its consequence for GATE 2; it does not edit `docs/whatsapp-templates.md` or
resubmit anything. Per direct instruction: "Do not touch templates."

### d. MORNING CUTOFF SUBMITS AS-IS

At `morningCutoff` (15:00 IST), any session still at `current_flow='morning'` is closed
AND stamped submitted with whatever was actually answered — not merely reset to idle.

**This is broader than B3's originally decided fix** (`outbound-send-primitive-plan.md`
§"B3", options 1+3: cutoff-close the stale session so the evening trigger routes
correctly — a session-STATE fix only, silent on what happens to any partial answers
sitting in it). This decision adds the missing half: the partial morning data is REAL
data, submitted by the engineer, and is kept as the record — not discarded just because
the flow never reached its normal completion step. Same principle already applied
elsewhere in this project (an engineer's real answer always wins over a clean-but-empty
default). Widens what "B3's fix" has to build — recorded in
`docs/plans/pass1-outbound-send-plan.md`'s own Amendments (d) and review-package item 4.

### e. NO PARTIAL/COMPLETE DISTINCTION IN THE DPR

The DPR renders whatever was recorded and marks the rest missing — exactly the existing
behaviour, unchanged. Evidenced directly: the 2026-08-21 generated DPR already rendered
"not reported" for every evening field on a day evening was never submitted, with no
special-cased "partial day" framing anywhere in the output. No new state, no new column,
no new branching in the report generator. Same principle as §28(f): show what was said,
mark what was not — a morning session closed early by (d) is just one more case of a
field with nothing to report, handled by machinery that already exists.

### Two hard preconditions for enabling Pass 1's cron entries — recorded here too

Same two conditions as `docs/plans/pass1-outbound-send-plan.md`'s own closing section,
stated once each place rather than only cross-referenced, since both documents need to
stand on their own:

1. **GATE 1** — the flow migration (§28(l), attendance-as-Q1) shipped and verified live.
2. **B3's cross-flow fix, widened by (d) above** — built and verified: closes stale
   morning sessions AND stamps their partial answers as submitted.

Neither is scheduled. The Pass 1 CODE may merge before both are done. The two
`vercel.json` cron entries may not be added until both are confirmed true by direct
observation.

**CORRECTED, 2026-08-22 (§30(i)) — these are NOT parallel/independent preconditions.**
The numbered list above presented GATE 1 and B3 as two separate conditions with no
stated relationship between them — that framing is corrected here, not silently, since
no single sentence above asserted independence to strike through; the numbered-list
shape itself is what implied it. B3's 15:00 sweep must know which morning question
each `current_step` value means, in order to correctly preserve partial answers when it
stamps a stuck session as submitted. The morning flow migration CHANGES that mapping
(step 2 shifts from "workers" to "plan", step 3 from "equipment" to "workers," per the
re-scoping plan's own line-number table). Writing B3 before the migration ships means
writing it against a mapping the migration then invalidates — B3 would need
rewriting, not just re-verifying. **Corrected order: the morning flow migration ships
FIRST, THEN B3's sweep is written (once, against the mapping it will actually run
against), THEN the two `vercel.json` cron entries may be added** — not two
independently-satisfiable gates, a sequence. See §30(i) for the full reasoning.

## 36. UNIQUE index on `project_members(user_id)` — DECIDED IN PRINCIPLE, NOT SCHEDULED, 2026-08-26

**Citation correction, on read:** this entry was requested citing "§35's
multi-project gap" as one of the three things it closes. §35 (above) is
about check-in window timing and does not discuss multi-project anything —
the actual multi-project discussion is `docs/reviews/033-sweep-review-
package.md` §13.4 ("the real closer for the multi-project gap"). Corrected
here rather than propagated into a new permanent record.

**The proposal.** Add `CREATE UNIQUE INDEX ... ON project_members(user_id)`
— makes "one engineer belongs to exactly one project" (already a DECIDED
product rule, migration 031's own header, 2026-08-26) a database
constraint instead of an assumption every consumer has to individually
trust or defensively guard against.

**What it closes, three places at once, all already paid for by the same
underlying ambiguity:**
1. **`sweep_stale_morning_sessions`'s multi-project skip becomes dead
   code.** Migration 033 counts an engineer's `project_members` rows and
   skips (does not guess) when the count isn't exactly 1 — correct given
   today's unenforced schema, per `docs/reviews/033-sweep-review-package.md`
   §13.4's own "real closer" note: capturing `project_id` into the session
   at flow start is the actual fix, this index is what makes that capture
   safe to trust. With the index in place, the count can only ever be 0 or
   1 — the `!= 1` branch stops being reachable for any row the index
   allowed to exist, though the skip-and-alert code (B2, external review
   round 1) stays as defense-in-depth, not deleted.
2. **Migration 031's `project_id` ambiguity vanishes.** 031's own header
   (PROJECT SCOPE section, 2026-08-26) already states its correctness
   depends on this exact rule holding, and already states the schema
   doesn't enforce it. This index is that dependency's actual closure.
3. **The multi-project gap named in `033-sweep-review-package.md` §13.4
   closes** — the session-capture fix proposed there becomes safe to build
   on top of, rather than being its own separate source of the same
   ambiguity this index removes at the root.

**Its own migration, its own review — not folded into 031 or anything
else.** Per CLAUDE.md §0's EXTERNAL REVIEW GATE, a new constraint on an
existing table with live data trips condition (b) (grants/constraints
changing what's permitted) on its own terms.

**Must be checked against existing data FIRST — a duplicate today would
make the index fail to create.** `CREATE UNIQUE INDEX` on a column with
existing duplicate values simply errors; before this migration is written
for real, `SELECT user_id, count(*) FROM project_members GROUP BY user_id
HAVING count(*) > 1` must return zero rows, checked live, not assumed from
"the product rule says this shouldn't happen." If it returns any rows, per
this project's own decided rule that's a data-integrity violation to fix
first (which engineer's second project row is wrong), not a reason to
weaken the index.

**Recorded plainly, because this project has spent a week learning which
one it actually was:** "we decided" and "the database enforces it" are
different things. Migration 033's own skip-and-guard exists because the
first one was assumed to be the second. This index is the one place in
this specific chain where that gap can actually close, rather than being
individually re-guarded against at every consumer that touches
`project_members`.

## 41. Photos are a first-customer requirement, not a Fast-Follow (2026-08-31) — DECIDED, not built

**DECIDED (Aravind, 2026-08-31).** Docs only — no schema, no code, no migration. This
entry reorders the roadmap; it does not build any part of it.

### a. Rationale, recorded because it reorders the roadmap

Indian construction sites already run on photos — a PM's WhatsApp is a photo feed. A
text-only product asks engineers to translate out of the medium they already use, and
competes with a habit that works. This moves inbound media handling from §28(aa)(1)'s
"load-bearing but unscheduled" framing (2026-08-21: "Invoices, delivery notes and cash
receipts are all photographs. Needs Twilio media download, a storage bucket, and a
retention policy") to a **prerequisite for onboarding a first customer.**

### b. It collapses three items into one build

Three of the ad-hoc menu's six CAPTURE items (`docs/plans/adhoc-menu-spec.md` §c —
excluding item 7, stop-messages, which is not a capture) are photographs: **material
received** (item 4) and **site document** (item 6) are each marked, verbatim,
"Buildable without media: **no**. Blocked on `§28(aa)(1)`"; **invoice** (item 5) is
blocked on the same section for the same reason, worded slightly differently in the
spec's own text ("blocked on `§28(aa)(1)` directly (its own photo) AND structurally on
item 4"). Checked directly against the spec's own per-item flow, not restated from
memory. §6's compulsory evening work-completed photo is the same missing capability.
**The menu without media ships half its items degraded** — three of six capture items
simply cannot function.

**REVISED ORDER: owner delivery → inbound media handling → ad-hoc menu.** This
sequences three pieces of work already recorded but never ordered against each other:
owner delivery (§28(bb), still email-only, no owner-facing WhatsApp template exists)
comes first; inbound media handling (§28(aa)(1)) second, now elevated by this entry;
the ad-hoc menu (§28(x), "the engineer's front door") third, since half its items
depend on the second. **Does not change CLAUDE.md §2's SPINE/FAST-FOLLOW
classification** — ad-hoc safety/invoice/hindrance flows remain listed there as
Fast-Follow; this entry orders the prerequisite work *within* what CLAUDE.md already
leaves unscheduled, it does not move anything across that boundary.

### c. Photos carry a purpose at capture

Relevance is a property of the purpose, decided at write time, never a judgement made
later. This is a **product** rule the schema will not enforce: a photo's purpose
derives from which flow captured it, so the enforcement is that hindrance photos can
only ever arrive through the hindrance flow (and so on for each of the other
photo-bearing capture items) — never a general upload with a purpose assigned
afterward.

### d. Three tiers in the DPR

- **EMBEDDED: work-completed photos only.** This is what an owner opens the report to
  see. Home: DPR Section 1, "Execution Output" (`docs/bot-flows.md`'s "The 6 Spine DPR
  sections" — "what was done, with quantities"), beside the activity the photo
  documents, per (e) below.
- **LINKED: everything else owner-facing** — safety, hindrance, invoice, site expense,
  site document. Each link must be **clearly named, never ambiguous**: the owner must
  know what he is opening before he opens it. Name the item and its subject, e.g.
  "Invoice — Ambuja Cement, ₹42,000," never "Photo 3."
- **NOT IN THE DPR: attendance photos.** Proof-of-presence for the PM, nothing an
  owner acts on. **This is §6's existing "morning = team/site/machinery photos"
  decision** (`design-decisions-beta-feedback.md` §6, "Compulsory photos") and §28(e)'s
  own "photo attendance... DEFERRED to §6's compulsory-photos work" — traced explicitly
  here so the mapping is not left implicit: morning's compulsory photo is what this
  entry calls an attendance photo, and §28(e)'s own trap ("attendance must NOT be
  inferred from photo arrival... a photo is evidence a message was sent with an
  attachment — it is not proof of presence") is exactly why it stays out of an
  owner-facing report rather than merely out of the embedded tier.

### e. The cap applies to embeds only

Maximum 10 embedded photos per DPR. Links are unbounded — a link costs a line of text,
not a screen, so capping them would hide activity for no benefit.

Photos sit **with their section**, not in a gallery at the end — the brickwork photo
beside "brickwork, 8 m³," inside DPR Section 1 (per (d) above), not a separate photos
block.

**OPEN, decide before build: what happens at an eleventh work-completed photo.** State
the drop rule, and require the DPR to **state** the truncation — "12 work photos
captured, 10 shown" — never silently omit. Silent truncation makes a report look
complete when it is not, contradicting the standard the DPR already holds for missing
data (`docs/dpr-engineer-report-spec.md`, rule 1, "Missing-ness is structural, not
conditional" — that document numbers rules, not `§`-sections; cited by name to avoid
the bare-`§N` ambiguity CLAUDE.md's own citation rule warns against). **Not decided
here** — named as an open question for whoever designs the actual capture/render
logic, not resolved by this entry.

### f. What this costs, stated honestly and not deferred

- **Twilio media download, a storage bucket, a `photos` table.** No schema authored by
  this entry — `daily_log_photos` (§6, "Compulsory photos": `{daily_log_id, phase,
  photo_url, caption, received_at}`) is the closest existing shape on record, built for
  a narrower case (morning/evening compulsory photos only); this entry's own
  ad-hoc-menu photos (material received, invoice, site document) need their own storage
  path per table (`hindrances.photo_url`, `invoices.image_url` already exist per
  `docs/schema.md`; `material_received` and a site-document equivalent do not exist at
  all — no schema for either).
- **A retention policy, which has no answer today.** §28(aa)(3) records that the thread
  becomes a financial record with statutory retention once it holds invoices and
  delivery notes. Photos make that concrete — the first thing built with a compliance
  clock attached.
- **The first recurring storage cost per project per month.** §6's own "Compulsory
  photos" entry already named this direction ("this becomes the product's largest
  object-storage consumer") — this entry confirms it as a recurring cost, not a
  one-time build cost.
- **Links need hosting the owner can reach WITHOUT logging in.** A real design
  question, and it interacts with the owner mobile app (§28(cc), "BLOCKED ON DATA, NOT
  ON CLIENT WORK" — "site photos... do not exist anywhere" is named there as one of
  the missing data surfaces the mobile app itself is blocked on; this entry is the
  decision that makes that data surface real).

### g. PRECONDITION, RECORDED 2026-09-03, BEFORE ANY §41 PHOTO-LINK WORK STARTS —
Resend click tracking is enabled on `quoco.co.in` and cannot be disabled from the
dashboard UI (checked directly by Aravind while completing domain verification for
owner-email delivery, same session). **Today this affects nothing** — checked directly
against the two email templates that actually send (`lib/dpr/render-email.ts`,
`lib/dpr/owner-no-report.ts`), full source read, not grepped-and-assumed: neither
contains an `<a href>`, a constructed URL, or any link markup anywhere. Every value
rendered into either template's HTML is `escapeHtml`'d plain content (project name,
engineer name, dates, verdict, body text) — there is nothing in a DPR or no-report
email for a click tracker to rewrite.

**This becomes load-bearing the moment §41 ships a photo link into an email body** —
that's the entry this precondition attaches to, since §41(f) above already names "links
need hosting the owner can reach without logging in" as an open question, and whatever
answers it will be an `<a href>` this same click-tracking layer touches. The concern,
named precisely: a Resend-rewritten link means the recipient's first hop goes through
Resend's own tracking domain before (presumably) redirecting to the real destination —
if that destination is a Supabase Storage SIGNED URL (a `photo_url`-shaped value,
carrying its own signature/expiry in the query string), the request is routed through a
third party before it ever reaches Supabase, regardless of whether the redirect
ultimately preserves the signature correctly. **Not verified either way in this
entry** — whether Resend's rewrite preserves a signed URL's query string intact through
its redirect, whether the redirect exposes the destination URL in a referer header, and
whether disabling tracking per-send (vs. only at the domain level) is possible via the
API even though the dashboard doesn't expose it, are all open questions this entry
raises but does not answer. **Consequence: whoever builds §41's actual link/hosting
answer verifies Resend's click-tracking behavior against a real signed URL BEFORE
shipping it, not after** — this is a precondition on that work, not a today problem;
nothing currently sending is affected.

---

**RESCUED (2026-09-13, docs-rescue pass).** The section below was written 2026-09-03
(plus one addendum on 2026-09-05) on `worktree-engineer-append-correction-decision` and
never merged — this file stopped at §41 until now. Its own numbering choice (§43, not
§42) is re-verified against `main` as of this rescue, not just carried over: §42 is
still live, cited repeatedly in `docs/plans/evening-flow-restructuring-scope.md` (the
unmatched-parse-token capture rule from migration 035), and no `## 42.` heading exists
anywhere in this file — so §43 remains correct and non-colliding today. **DECIDED, NOT
BUILT** — brought across as-is; nothing described below has been implemented.

