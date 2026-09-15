# Media on check-in flows — design doc

STATUS: DESIGN PASS, DECIDED WHERE MARKED, NOT BUILT. No code, no migration,
no migration number reserved. This is the second round of this design pass —
the first round's open questions and conflicts are folded in below as
RESOLVED or carried forward as STILL OPEN. Companion edit: this round amends
`docs/design-principles.md` §0's corollary in place (dated note, not a
silent rewrite) — see RESOLVED 1 below for why.

DATED NOTE (2026-09-13, round 3): items 6, 7, and 8 from round 2's STILL OPEN
list are now DECIDED — see "RESOLVED — ROUND 3" below, inserted after the
original RESOLVED section rather than renumbered in place, so every existing
cross-reference to items 1-10 by number still resolves correctly. Items 9 and
10 remain open; STILL OPEN below now carries only those two. Still a design
pass — no code, no migration, no migration number reserved by this round
either.

DATED NOTE (2026-09-13, round 4 — later the same day): round 3's item 14 is
REVERSED (struck through in place, not silently rewritten), items 9 and 10 are
now DECIDED, item 5's retention windows change for two of the three classes,
and item 6's draft copy is replaced. See "ROUND 4" below. STILL OPEN is now
empty — every numbered item in this doc is decided as of this round. Still a
design pass — no code, no migration, no migration number reserved.

DATED NOTE (2026-09-13, round 5 — later still): item 10's "embedded" language
is SUPERSEDED (struck through in place) — an `<img src>` is a hotlink, not a
copy, and does not survive retention or stay PM-only; photos are now decided
as real email attachments instead. New items 18-21 record the media-
interceptor placement reversal, the payload-agnostic caption design, the
6-stage build sequence with its gates, and the outstanding user-facing
strings in one place. Item 8's provenance flag is updated to reflect
Aravind's confirmation. See "ROUND 5" below. Still a design pass — no code,
no migration, no migration number reserved.

DATED NOTE (2026-09-13, round 6 — a fourth pass the same day): item 3's own
fix, once applied, surfaced a real access gap in items 10/14 — the DPR email
goes to the owner (no web login), but item 14's overflow photos are PM-only
dashboard links, and item 10's durable attached copy would land in the
owner's inbox while the PM is who needs the evidence. New item 22 decides
the DPR email now also goes to the project's PM(s). Items 4 and 5 also had
stale, unflagged numbers/cross-references left over from round 4's cap
reversal and retention extension — corrected in place below (struck through,
not rewritten), not new decisions. See "ROUND 6" below.

Same round, continued: a full audit of every item found six more of the same
class — stale 45-day retention figures (items 5's pricing arithmetic, 7, 11)
and stale "embed(ded)" terminology left over from before item 10's round-5
attachment correction (items 14, 9) — all corrected in place below, struck
through, not rewritten. Still a design pass — no code, no migration, no
migration number reserved.

DATED NOTE (2026-09-13, stage 1 planning pass, new branch off main
post-merge): item 19 is upgraded from UNVERIFIED to VERIFIED for the
captioned-photo case — a captioned photo confirmed to populate `Body`,
confirmed live against Twilio's own inbound log. The uncaptioned case
remains genuinely unknown; this pass could not determine it (no Twilio
credentials in the planning environment) and does not assume an answer.
`media-reply.ts`'s own header comment is now known-wrong for the captioned
case; the correction is recorded in item 19 for whoever lands the
interceptor move (item 18) in code — not fixed in the source file by this
pass, which is plan-only. Full stage-1 build plan: `docs/plans/
stage1-photo-intake-plan.md`.

---

## RESOLVED

### 1. §0 ceiling conflict — Aravind's override stands, doc amended

Evening goes 5→6 with the new photo Q2. `docs/design-principles.md` §0's
corollary previously read as an unconditional "never append," which this
decision knowingly violates. Rather than leave the doc asserting a rule the
codebase now contradicts, §0 is amended (dated note, original text kept,
per this project's own correction discipline) to say what's actually true:
six is a hard ceiling either way; append is the one-time exception below
the ceiling, not the default mechanism; and evening has now spent it.
**Evening is AT the ceiling — any future evening capture must replace an
existing question, never append a seventh.** Full wording: see the dated
note in `design-principles.md` §0 itself, not restated here.

### 2. "Morning-absent evening opener" — not a missing artifact, my error

Corrected: this was discussed in chat and never written down anywhere in
the repo. There was nothing to find. If it's ever batched into a template
submission, it gets its own write-up first — not inferred from this design
pass.

### 3. Overflow link (>10 photos) — ~~deferred, not designed~~ SUPERSEDED (2026-09-13, round 4)

~~Ship ≤10 embeds only, per §41(e)'s existing cap. No link-to-dashboard for
photo 11+ in this pass — the owner has no web login yet (CLAUDE.md §5,
`design-principles.md` Rule 1.2), and owner web login is queued as the same
piece of work as employee onboarding, separately. Building a link today
would be a dead link for the owner and a half-designed one for the PM
(conflict #2 from the prior round — PM-only access vs. a dashboard surface
that doesn't exist yet either). When owner login ships, the overflow link
becomes a small, well-scoped enhancement on top of a real destination —
not built ahead of that.~~

**DATED CORRECTION (2026-09-13, round 4, surfaced round 5).** Struck through,
not deleted, per this project's correction discipline. This conclusion no
longer holds: round 4's item 14 decided overflow photos (11+) **are**
delivered as links to the web dashboard (and the mobile app, once it
exists) — never storage URLs, never signed public links — reversing the
"deferred, not designed" call above outright rather than refining it. Round
5's item 20 (build sequence), stage 5, includes actually building them,
alongside the rest of the PM-facing surfaces. See item 14 for the decision
and item 20 for where it ships.

### 4. Ingestion architecture — queued job, not inline in the webhook

**Decided: media ingestion runs through the jobs table, the same pattern
this project already uses for Claude API calls (NFR-16) and DPR
generation.** ~~Up to 10~~ An **uncapped number of** Twilio downloads +
Storage uploads cannot fit inside the webhook's 15-second response budget
(CLAUDE.md §6) alongside everything else the webhook already does.

**The turn-taking shape:**

1. Engineer replies to evening Q2 with photos (or "none").
2. `apply_evening_flow_turn` records the answer for Q2 — count of photos
   received (or the "none" case) — and **advances `current_step` to 3
   immediately**, in the same RPC call, without waiting on any upload. This
   matches the existing pattern where the RPC never does slow I/O itself
   (all of today's parsing already happens before the RPC call, not inside
   it).
3. In the **same webhook request**, right after the RPC returns
   successfully, the TS layer inserts one row into `jobs` (a new job type —
   name TBD, e.g. `media_ingest` — carrying the Twilio `MediaUrl0..N`
   values, content types, and enough identifying context — tenant, project,
   phone number, `daily_log_id`, log_date — to attribute the photos once
   uploaded). This insert is a single fast DB write, well inside the 15s
   budget; the actual downloads happen later, off this request entirely.
4. The webhook replies immediately: an acknowledgment ("Got your photos")
   folded into the **same message** as Q3's text — this is not a Rule 3.2
   violation (one question per message); it's the same ack+next-question
   shape Rule 3.4 already establishes ("✓ Masons: 8, Helpers: 12. Next
   question…"), not two questions in one message.
5. The engineer answers Q3–Q6 as normal — realistically a minute or more of
   wall-clock time — while the `media_ingest` job runs in the background,
   picked up by a poll cycle (see the cron-placement note below).
6. Q6 completes the flow. **The engineer-facing completion message is
   unconditional and identical regardless of media job state** — per the
   explicit design instruction, failures surface to the PM, not the
   engineer, because by completion time he has moved on. The completion
   text does not query or wait on job status at all.

**Threading job state to "completion" — the real design question, since the
flow and the job are now two independent completion events:**

"Completion" used to be one fact (Q6 answered). It is now two, and nothing
downstream should conflate them:

- **Flow completion** — Q6 answered, `daily_logs` row stamped, unconditional
  and synchronous, exactly as today. This is what the engineer sees and
  what closes the WhatsApp side of the interaction.
- **Media completion** — a separate status, tracked per day
  (`daily_logs.evening_photos_status` or equivalent: `pending` / `complete`
  / `failed`, updated by the job as it runs) — asynchronous, invisible to
  the engineer, and the thing everything downstream (PM dashboard, DPR
  generation) actually needs to check.

Consequences of splitting them, each a real design point:

- **Retry / dead-letter**: the `media_ingest` job follows the existing NFR-17
  shape — exponential backoff, and a job that exhausts retries →
  `status='failed'`, Sentry alert, matching the DPR dead-letter pattern
  already in `bot-flows.md`. On failure, the PM is notified — Rule 4.2's
  "every alert carries its action" applies here too (e.g. "Evening photos
  failed to upload — Rajesh, Emerald Heights, today — [Ask him to resend]").
- **DPR generation timing interaction — a real race, flagged not solved.**
  DPR generation fires at 19:45 IST regardless. §41(d) puts work-completed
  photos directly inside DPR Section 1 — meaning DPR generation needs the
  media job to be `complete`, not just `pending`, before it can embed
  anything. For a typical evening check-in (started well before 19:45),
  the job will have long finished by generation time. For a **late**
  responder — someone who starts evening close to the 19:45 cutoff — the
  media job could still be `pending` when generation runs. This is
  structurally the same shape as DPR-24's existing owner-send hold ("holds
  if `generation_status='running'` OR an unprocessed job exists... hold up
  to 5 min; if still blocked, send committed content + log a Sentry
  anomaly"). **Recommendation, not yet decided: extend that same hold
  logic to also check the relevant `media_ingest` job's status before
  finalizing a DPR that has photos pending** — reusing an existing
  mechanism rather than inventing a second one. Left as a recommendation
  for whoever scopes the DPR-generation change, not decided here.
- **Cron placement**: `bot-flows.md`'s own ASYNC QUEUE section already
  establishes "separate cron entries per job type to avoid head-of-line
  blocking" (the reason `dpr-generate` and `owner-deliver` are separate
  crons from the generic `jobs/tick`). ~~Ten~~ An **uncapped number of**
  downloads+uploads per engineer, potentially several engineers finishing
  evening around the same trigger window, is enough I/O that `media_ingest`
  likely wants its own cron entry rather than competing for `jobs/tick`'s
  existing 3-jobs-per-tick budget against DPR generation and everything else
  already polling there. Not decided — flagged for whoever scopes the
  actual job handler.

**DATED CORRECTION (2026-09-13, round 6).** Both "10"/"Ten" quantifiers
above are struck through, not silently rewritten. They assumed the intake
cap round 3's item 14 later reversed to uncapped intake (round 4). Neither
correction changes the decision either quantifier supported — queueing was
already required to handle 10 downloads inside a 15-second webhook budget,
and an uncapped count only makes that argument stronger, never weaker. See
item 14 for the cap reversal itself.
- **The media-interception check itself has to move.** Today,
  `lib/whatsapp/media-reply.ts` rejects ALL media unconditionally, upstream
  of `routeInboundMessage`/`dispatchInboundTurn` — that only worked because
  the answer was always "no" regardless of flow state. Once a photo is
  sometimes the correct answer (evening Q2, morning Q3's piggyback), the
  interception has to become **step-aware**: it needs to know whether the
  currently active step expects a photo before deciding accept vs. reject.
  That means either moving the check inside the flow dispatch (where
  `current_flow`/`current_step` are already resolved) or having it perform
  its own lookup of the same fact `routeInboundMessage` already resolves —
  the latter is the exact "two places decide one thing" shape this project
  has already been bitten by once (`buildBodyCorpus`/`isHireRateTrusted`,
  per the 2026-09-05 admin-merge retrospective). Flagging this now so
  whoever builds it doesn't rediscover it mid-implementation.

### 5. Retention — scheduled job, verified against current docs

**Verified live against Supabase's own current documentation and pricing
page (not asserted from training, which is 8 months stale as of this
pass):** Supabase Storage does **not** offer native object lifecycle /
TTL expiration as of September 2026 — confirmed via Supabase's own GitHub
discussion tracking this as a still-open feature request, cross-checked
against current third-party pricing writeups. No dashboard toggle, no API
call, nothing S3-style exists to expire an object automatically.

**Consequence: this has to be a scheduled job, and it will be the FIRST
retention mechanism this project has ever built.** Worth stating plainly,
per `docs/build-status.md`'s own 2026-07-27 audit: *"NOTHING deletes or
archives a row anywhere in the system: no DELETE/TRUNCATE in any migration,
no pg_cron job in the migration set, no TTL trigger, no archival table."*
Every table in this project today grows unbounded or is pruned by nothing
at all. This is not "add to the existing retention system" — there isn't
one.

The job (mechanism, not yet built): runs on the existing cron pattern, scans
the photos table for rows past their type-specific retention window (7d
attendance / ~~45d hindrance / 45d evening progress~~ **60d hindrance / 60d
evening progress — see item 15**), deletes the Storage object via the
`service_role` Storage client (Postgres has no native way to delete an
S3-backed object — this has to run from the app layer, same reason media
ingestion itself can't be pure SQL), and updates the row. What "updates the
row" means exactly is ~~STILL OPEN — see item 9 below~~ **DECIDED — a
tombstone; see item 9**.

**DATED CORRECTION (2026-09-13, round 6).** Both corrections above are
struck through, not silently rewritten. The 45-day figures were superseded
by item 15's 2026-09-13 (round 4) extension to 60 days for hindrance and
evening progress (attendance stays at 7 days, unchanged). The "STILL OPEN"
cross-reference to item 9 was factually wrong as written by the time this
was read back — item 9 was decided (tombstone) the same round item 15
extended the clock, and this sentence was simply never updated to match.

**Pricing, verified against `supabase.com/pricing` directly (fetched
2026-09-12, not from training):**
- File storage: 100 GB included on the Pro plan; $0.0213/GB/month beyond
  that.
- Egress: 250 GB included on the Pro plan; $0.09/GB beyond that
  (uncached), $0.03/GB for cached egress.

~~Against the prior pass's rough volume estimate (~1–1.5 GB resident storage
at ~50 engineers, low single-digit GB/month of egress from DPR embeds and
dashboard views): **this sits entirely inside the Pro plan's included
100 GB storage and 250 GB egress — effectively zero incremental cost at
this scale.** It stops being free only if engineer count or photo-per-day
volume grows by roughly two orders of magnitude, or if attendance/evening
retention windows are lengthened well past 7d/45d. Re-check this arithmetic
if either of those changes materially — this is a scale-dependent
conclusion, not a permanent one.~~

**DATED CORRECTION (2026-09-13, round 6).** Struck through, not deleted.
This conclusion was built on two assumptions round 4 later superseded: a
**capped** daily photo count (item 14 reversed this to uncapped intake) and
**45-day** hindrance/evening-progress retention (item 15 extended both to
60 days; the "7d/45d" figure above is itself stale on that count alone).
**Not re-derived here** — items 14 and 15 both already flagged this
arithmetic as needing a redo once real engineer behavior under uncapped
intake is observed, and that flag stands; this entry marks the conclusion
itself superseded rather than silently leaving it to read as still current.

---

## RESOLVED — ROUND 3 (2026-09-13)

### 6. Off-step photo handling — DECIDED

Not any of the three options round 2 weighed (silent attach /
answer-substitution / reject-and-nudge) — the question is narrower than it
looked, once each ad-hoc menu item is given its own capture:

- Each ad-hoc menu item (hindrance now; safety and invoice when they land)
  carries its own photo capture. A photo belonging to one of those is not an
  off-step photo — it is captured inside that flow. This follows §41(c)
  (`design-decisions-beta-feedback.md`): a photo's purpose derives from the
  flow that captured it.
- The only true off-step case left is a bare photo with no check-in flow
  active and no menu item chosen. Such a photo is NOT stored, NOT held, NOT
  parked. The bot replies with a nudge pointing at the menu; the engineer
  re-sends inside the flow he picks.
- **Rationale:** every stored photo enters through a flow that defines its
  purpose, its parent row, and its retention class. No orphan storage, no
  store-before-consent problem, no unclaimed-photo expiry semantics.

~~**Draft copy — NOT APPROVED, English only, pending Tamil pairs and
confirmation of the live menu numbering (per `inbound-start.ts`'s current
`ACTION_LINE`, hindrance is item "1" today):**

> Photo not saved — please choose a menu option and send it there.
> Reply 1 to report a hindrance, then send the photo again.
> Progress photos: send them during the evening check-in.~~

**REVISED, 2026-09-13 (round 4).** Struck through, not deleted, per this
project's correction discipline. Why it changed: there is no enumerated
numbered menu in the product — `inbound-start.ts`'s `ACTION_LINE` advertises
only "reply 1"; the struck-through draft's "choose a menu option" pointed at
a menu the engineer has never seen. The revision also now covers both
check-ins, since morning accepts photos too (item 11).

~~**Draft copy — NOT APPROVED, English only, Tamil pair pending:**

> Photo not saved — a photo has to go inside a report.
> To report a site hindrance, reply 1 — then send the photo again.
> Progress photos: send them during your morning or evening check-in.~~

**SUPERSEDED, 2026-09-15 (stage 3 build) — struck through, not deleted, per
this project's own correction discipline. See "RESOLVED — ROUND 8" at the
end of this doc for the copy actually approved and shipped**, which differs
from the draft above in two ways: it points at "the menu below" (composed
live, not a static numbered list) rather than naming "reply 1" directly in
the nudge itself, and it throttles to one reply per 5-minute window per
phone number rather than replying to every off-step photo — this doc's own
earlier text above never specified a throttle at all.

### 7. Photo parents: polymorphic vs. per-parent tables — DECIDED, per-parent

Resolved in favour of **per-parent tables**, extending
`design-decisions-beta-feedback.md` §6's existing pattern rather than
reopening it. §6 already specified `daily_log_photos` (keyed to
`daily_logs`, with a `phase` column) — that decision stands, unchanged.

What's new: hindrance photos need a **different** parent (`hindrances`),
which §6 never contemplated. A second per-parent table (e.g.
`hindrance_photos`, keyed to `hindrances`) is added alongside
`daily_log_photos` — not folded into it, and no polymorphic `photos` table
is introduced.

This keeps the real-FK guarantee round 2 flagged as the deciding factor
(`hindrances_project_id_fkey`-style referential integrity, enforced by the
database rather than application code) for both parents, at the accepted
cost: retention-by-type logic (7d attendance / ~~45d evening progress / 45d
hindrance~~ **60d evening progress / 60d hindrance — see item 15**) has to
be either duplicated across the two tables or centralized behind a shared
function/view — not a single table scan.

**DATED CORRECTION (2026-09-13, round 6).** The 45-day figures above were
superseded by item 15's 60-day extension for both non-attendance classes;
struck through in place, not silently rewritten.

### 8. `hindrances.photo_url` — DECIDED, left as dead schema

**PROVENANCE FLAG, added 2026-09-13 (round 4), UPDATED 2026-09-13 (round 5):
inferred by Claude, confirmed by Aravind 2026-09-13.** This closure
**began as Claude's own inference** — chaining item 7's supplied decision
through this doc's own pre-written round-2 conditional, backed by a fresh
grep — and was **not** a decision Aravind supplied directly when it was
first written, unlike items 6, 7, 11-14, which were. That history is kept
here, not erased, per this project's own correction discipline: the column
stays in place, documented dead, per §28(p) — the inference turned out
correct, and Aravind has now confirmed it directly, but the record of how
this item reached "DECIDED" (mechanical inference first, explicit
confirmation second) is preserved rather than rewritten as if it had always
been a direct decision.

Closed as a direct consequence of item 7 above, per this doc's own
round-2 conditional ("per-parent tables make it unambiguously obsolete" —
the degraded single-photo-via-polymorphic-table path that would have kept
this column live as an option no longer exists once per-parent is chosen).
Option (b) from round 2 stands: the column is **left in place, documented
as dead**, matching this project's general "don't drop what becomes
unread" convention (§28(p) in `design-decisions-beta-feedback.md`).

Re-confirmed this round (2026-09-13): `grep -rn "photo_url" lib/ app/
supabase/migrations/*.sql` returns only the column's own definition
(`001_core_schema.sql:189`) and a comment in `039_hindrance_
acknowledgement.sql` listing it among hindrances' "long-unpopulated,
intentionally provisioned fields" — zero writes. `lib/whatsapp/flows/
hindrance.ts` and `038_hindrance_flow_and_collision_fix.sql`
(`apply_hindrance_flow_turn`) have zero references to "photo" at all.

### 11. Photo window — DECIDED, supersedes the Q2-only design in item 4

Photos are accepted across **all** questions of the evening check-in, not
only at Q2. Same for **all** questions of the morning check-in.

- Evening photos → evening progress class, ~~45-day retention (per item 5's
  existing retention table)~~ **60-day retention — see item 15**.
  **DATED CORRECTION (2026-09-13, round 6):** superseded by item 15's
  extension; the cross-reference now points at item 15, not item 5's
  original (now-stale) table.
- Morning photos → attendance class, 7-day retention. A photo sent at any
  point in the morning flow is classified as attendance and expires in 7
  days; the hindrance flow (item 7's `hindrance_photos`) is the durable
  channel for anything that needs to survive longer.
- A "none" reply at evening Q2 is not final: a photo sent later in the same
  flow still attaches, and the completion message reports the real stored
  count.
- Photos arriving inside an active check-in are stored silently — no
  per-photo acknowledgement. The count surfaces once, in the completion
  message.

This widens item 4's own flagged consequence — "the media-interception
check itself has to move... it needs to know whether the currently active
step expects a photo" — from **step-aware** to **flow-aware**: the
interception now needs to know only whether morning or evening is active at
all, not which specific step, since every step of both now accepts a
photo. The relocation item 4 already flagged (out of the unconditional
`media-reply.ts` intercept) is unchanged; only the acceptance window
widens.

### 12. Caption handling — ~~DECIDED~~ REVERSED (2026-09-14, first real-use finding)

~~Text accompanying a photo is never dropped. The caption is passed to the
normal answer parser for whichever question is currently open. If it
parses, it is recorded as that question's answer **and** stored in the
photo's existing `caption` field (item 7's `daily_log_photos` /
`hindrance_photos` shape). If it fails validation, the standard re-prompt
fires (Rule 3.5) and the text is still stored on the photo.~~

**DATED CORRECTION (2026-09-14) — a first real-use finding, not a design
refinement.** Kept struck through above rather than deleted, per this
project's correction discipline. This is not a round of design iteration
catching an edge case before build — it is stage 1 in real production use,
producing a real bad DPR row on its very first real trigger.

**What happened, prod, 2026-09-14 evening check-in.** An engineer sent a
photo captioned "Today work" while evening Q5 ("Anything extra needed
tomorrow?") was open, then typed "No" separately, moments later. Per this
item as originally decided, the caption went to the answer parser and was
recorded as the Q5 answer — the live DPR row reads
`evening_tomorrow_needs = 'Today work'`. The engineer's actual answer,
"No", arrived after the flow had already closed on the caption and went
nowhere.

**New decision (Aravind, 2026-09-14): ITEM 12 IS REVERSED. A CAPTION IS
NEVER AN ANSWER.**
- A caption is stored on the photo row, exactly as before. It is NEVER
  passed to the answer parser.
- The current question stays open and is re-asked — the same handling
  item 23 already gives a bare (uncaptioned) photo. A captioned photo now
  takes the identical path an uncaptioned one already did.
- **Consequence, stated plainly:** with items 12 and 23 both now in force
  the same way, ANY message carrying a photo never answers a question,
  captioned or not. Only a text-only message can answer. Nothing carried
  on a photo can reach a DPR field.
- **Rationale:** a caption describes the photo, not the question that
  happens to be open. "Today work", "east wall", "crack near column B" are
  captions, not answers. No timing or fallback rule can distinguish a
  caption that answers from one that describes — a fallback keyed on "no
  answer recorded yet" would have produced this exact bad data, since the
  field WAS empty when the caption arrived.
- **The standalone evening photo Q2 (the original design in item 4, before
  item 11 superseded it) does NOT remove this risk.** Item 11 accepts
  photos at ALL questions by deliberate decision, so a captioned photo at
  any step — not only Q2 — remains possible by design, and this reversal
  has to hold at every one of them, not just the dedicated photo question.

### 13. Burst handling — DECIDED

Twilio delivers each image in a burst as a separate message with its own
SID, so SID idempotency (`processed_messages`) does not dedupe a burst —
a fact about delivery, not a defect to fix.

- In-flow bursts generate no replies at all (item 11: photos stored
  silently), so no dedupe is needed there.
- Out-of-flow bursts: at most **one** nudge per session per 10 minutes,
  suppressed via a `last_media_nudge_at` timestamp on the `whatsapp_
  sessions` row. No new table.

**STORAGE LOCATION, DECIDED 2026-09-13 (round 4) — supersedes "one new column
is required" above.** `last_media_nudge_at` is stored as a key inside
`whatsapp_sessions.context` (JSONB, already exists) — **not** a new column.
Rationale: this is throttle state, not a record anything else depends on or
queries against, and does not justify a migration. The prior pass's finding
that no existing *column* serves this purpose still stands and is not
contradicted — `context` was always there; it just wasn't counted as an
option until now.

### 14. 10-photo cap — ~~DECIDED~~ REVERSED THE SAME DAY (2026-09-13, round 4)

~~The cap of 10 photos per daily log stands (the same number item 3 and
§41(d)'s own cap already fixed for DPR embeds). **What's new:** the cap now
also applies at **intake**, not only at DPR-render time — photo 11 is
rejected outright, never accepted-and-truncated later. This moots §41(e)'s
own "OPEN, decide before build: what happens at an eleventh work-completed
photo" truncation-display question for photos entering through the
compulsory check-in flow specifically: since a daily log can never hold an
11th `daily_log_photos` row in the first place, there is nothing left for
the DPR to truncate at render time for that source. (Ad-hoc-menu photos —
hindrance now, invoice/material-received later — live in their own
per-parent tables per item 7 and are outside this specific cap.)

- Photo 11 triggers one over-cap message, once per check-in, suppressed by
  the same `last_media_nudge_at` mechanism (item 13).
- Photos 12+ are silent — no repeated over-cap messages.
- Over-cap photos are **rejected, not accepted-and-truncated**: the
  engineer is told; the system never silently discards something he sent.
- 10 is a **product promise, not a storage constraint**: define it as a
  single named constant so raising it is a one-line change.

**Draft copy — NOT APPROVED, English only, pending Tamil pairs:**

> That's 10 photos for today — the most I can attach. Send any others
> tomorrow, or report them as a hindrance.~~

**DATED CORRECTION (2026-09-13, round 4) — a reversal, not a refinement.**
Kept struck through above rather than deleted, per this project's correction
discipline. New decision:

- **Intake is UNCAPPED.** The engineer sends as many photos as he wants; all
  are stored. There is no photo 11 rejection, no over-cap message, no
  `last_media_nudge_at`-suppressed over-cap nudge — that entire mechanism is
  withdrawn along with the cap it enforced. The over-cap draft string struck
  through above is **withdrawn**, not carried forward.
- **The DPR email ~~embeds~~ attaches the first 10 photos by arrival order.**
  Photos 11+ appear as **links to the web dashboard** (and the mobile app,
  once it exists) — never as raw storage URLs, and never as signed public
  links. This preserves PM-only access and does not reopen the deferred
  owner-login work (round 2's item 3).
- **Known consequence, accepted, not overlooked:** the durable copy is the
  10 ~~embedded~~ **attached** images only. Overflow photos exist solely in
  Supabase Storage and are unrecoverable once retention fires on them.
  ~~Embedding~~ **Attachment** order is **arrival order**, not importance —
  which photos survive past the retention window is determined by upload
  sequence, not by which ones mattered most.
- **The removed ceiling:** uncapped intake means photos now have no upper
  bound on object storage, in a product where photos were already the
  identified largest storage consumer (§6, `design-decisions-beta-
  feedback.md`; item 5 above). Item 5's pricing arithmetic assumed a bounded
  per-day photo count; it should be re-checked once real engineer behavior
  under an uncapped intake is observed, not re-derived speculatively here.

**DATED CORRECTION (2026-09-13, round 6).** The three "embed(s)"/"embedded"/
"Embedding" strike-throughs above correct terminology only, not the
decision itself: item 10's round-5 correction changed the DPR email's
delivery mechanism from a hotlinked `<img>` embed to a real email
attachment, but this item's own text — written in round 4, before that
correction existed — was never updated to match. First 10 by arrival order,
overflow as dashboard links: unchanged. How the first 10 arrive: attached,
not embedded.

---

## RESOLVED — ROUND 4 (2026-09-13, later the same day)

### 9. "Expired" semantics per type — DECIDED, tombstone

Same treatment for **all three classes** (attendance, evening progress,
hindrance) — not different per type, contrary to round 2's own lean toward
splitting them.

- When a photo's retention period elapses, the **stored object is deleted**
  but the **metadata row is retained** (a tombstone: `photo_url` set NULL,
  `caption`/`purpose`/timestamps kept — the shape round 2 already sketched
  under "Delete file, keep row as tombstone").
- The DPR and dashboard show a tombstone stating **how many photos existed
  and when they expired**.
- **Rationale:** "no photos were sent that day" and "photos existed and were
  deleted" are opposite facts on a disputed claim, and a blank section
  cannot distinguish them.
- **No advance expiry warning.** ~~The embedded-10 email (item 14 above)
  already gives the PM a copy he retains~~ **The attached-10 email (item 10's
  attachment mechanism, item 22's PM recipient) already gives the PM a copy
  he retains**, which is what a warning would have protected.

**DATED CORRECTION (2026-09-13, round 6).** Struck through, not deleted.
"Embedded" corrected to "attached," per item 10's round-5 mechanism change.
The citation is repointed to item 10 (the attachment decision itself, not
item 14, which only decided the 10-vs-overflow split) and to item 22 (the
reason the PM specifically receives a copy at all — until item 22 ships,
the DPR email's only recipient is the owner, per CLAUDE.md §5).

**User-facing string: NEEDED, NOT DRAFTED, pending approval.** No wording is
invented here — whoever builds the tombstone display writes and clears the
copy separately.

### 10. Email image delivery — ~~DECIDED~~ SUPERSEDED (2026-09-13, round 5)

~~- **DPR email:** first 10 photos **embedded**, by arrival order. Overflow as
  **dashboard links** (per item 14's reversal above).
- **Hindrance email:** photos **embedded, not linked**. This email is the
  durable archive that justifies the 60-day hindrance retention (item 15
  below) — a link would die with retention, and the archive claim would
  collapse the moment the linked object is gone.
- **Delivery detail flagged for build time, not decided now:** Resend
  click-tracking (§41(g), already recorded as unresolved for `<a href>`) must
  not rewrite or wrap embedded image content. Verify this against a real
  send before shipping either embed path — not asserted here either way.~~

**DATED CORRECTION (2026-09-13, round 5) — this supersedes the "embedded"
language above; it assumed embedding meant a durable copy, which is wrong.**
Struck through, not deleted, per this project's correction discipline.

**Finding that forced this:** `SendEmailParams` (`lib/email/send.ts`) carries
only `{to, subject, text, html}`. An `<img src>` in the `html` field is a
**hotlink** to Supabase Storage, not a copy — it breaks the moment retention
deletes the object, and it is fetched by the mail client **without
authentication**, so it is neither durable nor PM-only. Everything the
struck-through text above said about "embedded" photos being the archive
copy was built on that wrong assumption.

**DECIDED:** photos are delivered as **email attachments**. `sendEmail`
gains an attachment capability (Resend supports attachments; the current
wrapper does not — this is real, if small, new work, not a config flip).
Applies to both the DPR email (first 10 photos) and the hindrance email
(its photos).

- **This is what makes the email a real archive**, and is the **sole basis**
  on which the 60-day retention clock (item 15) is defensible. Dependency
  recorded explicitly: **if attachments are not built, the 60-day clock must
  be revisited** — a hotlinked photo dying at 60 days with no durable copy
  anywhere is a materially worse position than the 45-day window item 15
  replaced.
- **Risk, recorded plainly:** 10 site photos is roughly 3–8MB. Large emails
  get clipped by Gmail, delayed by corporate mail filters, and can bounce
  outright. A real-world size and deliverability test against actual
  provider limits is a **REQUIRED gate** before this is promised to a
  customer, not a nice-to-have (carried into item 20's build sequence as
  stage 4's gate).
- **Overflow photos (11+) remain dashboard links, unchanged** — not
  attached, not durable, exactly as item 14 already decided. Item 14's own
  "This preserves PM-only access" claim is unaffected by this correction and
  is, if anything, strengthened: a real attachment has no external link at
  all, so nobody without inbox access can reach it.
- Resend click-tracking (§41(g)) is no longer a live concern for the
  attached-10 — click-tracking rewrites links, not attachment content — but
  remains a build-time detail for the overflow dashboard links, unchanged
  from item 14's own treatment.

### 15. Retention clock — extended for two of three classes

- **Hindrance and evening progress retention: 45 days → 60 days.**
- **Attendance stays at 7 days** — unchanged.
- **Rationale:** hindrance photos are evidence for delay and payment
  disputes, which run in months, not weeks. 60 days plus the email copy —
  now a real **attachment**, per item 10's round-5 correction, not the
  hotlinked "embed" this rationale originally assumed — covers the common
  cases; the policy may extend further later, based on real customer
  experience — not decided in advance of having any.
- **Retention is FORWARD-ONLY.** Photos deleted under a 60-day rule cannot
  be recovered if the policy is later extended — a longer future window
  does not retroactively restore what a shorter past window already
  deleted.
- **Open operational question, not a decision to make now:** whether the
  deletion job should stay switched off until a real customer is running,
  preserving the option to revise the clock before anything is
  irreversibly lost to it. Named here so it isn't decided by default the
  moment the job is built.
- **The retention policy must be visible to the PM in-product**, not only
  in onboarding — where and how is not decided here, only that onboarding
  alone is not sufficient.

This amends item 5's retention table (7d attendance / 45d hindrance / 45d
evening progress) and its downstream pricing arithmetic, which assumed the
now-superseded 45-day hindrance/evening-progress windows and a capped daily
intake (also superseded — item 14). Not re-derived here; flagged for
whoever next touches item 5's numbers.

### 16. Hindrance photo capture — ordering constraint

- Hindrance photos are captured **inside the hindrance flow**. That capture
  **does not exist today**: confirmed this pass (see TASK 9 evidence below)
  that `hindrances.photo_url` has zero writers, and `lib/whatsapp/flows/
  hindrance.ts` and migration 038 contain no photo handling at all.
- **HARD ORDERING CONSTRAINT:** hindrance photo capture must ship **before**
  the off-step nudge (item 6). Until capture exists, the nudge instructs the
  engineer to reply 1 and re-send a photo into a flow that will reject it via
  the same `media-reply.ts` interceptor that intercepts everywhere else
  today — a **second** failed upload on poor signal, which is worse than
  today's honest "photos aren't used yet" reply. Shipping the nudge ahead of
  the capture it points at would make the product actively worse for exactly
  the engineer it's trying to help.
- The existing hindrance email (`lib/hindrance/pm-notify.ts`; confirmed live
  this pass, fires immediately on report, reaches the PM — see TASK 9
  evidence below) is **extended** to carry the photos. This is not a new
  trigger, a new recipient rule, or a new template — the same email, same
  send path, same recipients, with photos added to its body.

### 17. Correction to the review record — hindrance email already exists

**DATED CORRECTION (2026-09-13).** Earlier today, the design-review layer
stated that no hindrance email exists and that hindrance notification would
be a new build. **That was wrong.** `lib/hindrance/pm-notify.ts` is live,
fires on every completed hindrance report via `enqueueHindrancePmNotify`
(called from the hindrance flow's completion branch) and
`handleHindrancePmNotifyJob` (the queue job that actually sends it), and was
demonstrated working end to end on 2026-09-07 (Phase A, a real delivered
send from `reports@quoco.co.in`, per that file's own header). Recorded here,
in the same style as item 2's earlier correction, so this doc does not carry
the false claim forward. Item 16 above is written against the real,
already-live email — it is an extension of existing infrastructure, not new
notification plumbing.

---

## RESOLVED — ROUND 5 (2026-09-13, later still)

### 18. Media interceptor placement — reversal of the 2026-09-06 decision

**REVERSED, dated, original reasoning kept intact.** `lib/whatsapp/
media-reply.ts`'s own header records a 2026-09-06 decision: the media check
sits **upstream** of all flow logic (ahead of both `isTestStartTrigger` and
`routeInboundMessage`) and **deliberately does not branch on active-flow
state** — one fixed reply per media kind, regardless of whether a flow
question is pending, specifically to avoid a second `readCurrentFlow` lookup
duplicating a fact `routeInboundMessage`/`dispatchInboundTurn` already
resolve (the `buildBodyCorpus`/`isHireRateTrusted` "two places decide one
thing" shape, per the 2026-09-05 admin-merge retrospective).

**Reason for reversal:** the photo-window decision (item 11) requires
distinguishing a photo sent **inside an active check-in** (store silently)
from a **bare off-step photo** (nudge, do not store — item 6). That
distinction cannot be made upstream of flow state by construction — the
2026-09-06 design's whole point was to avoid needing flow state at all,
which is exactly the information this now depends on.

**DECIDED approach:** move the media decision **downstream**, to the point
that already reads current flow state (`routeInboundMessage`/
`dispatchInboundTurn`), rather than adding a second `readCurrentFlow` lookup
upstream. This **preserves the principle** behind the original 2026-09-06
decision — no two places deciding the same fact — even though the placement
changes: the fact "is a flow active, and does it want a photo" is still
decided in exactly one place, it's just no longer the upstream interceptor.

**OPEN IMPLEMENTATION QUESTION, not a decision:** the original header's own
mid-flow empty-Body hazard — "a media reply sent mid-flow... would reach
`dispatchInboundTurn` with an empty Body and be parsed as an invalid text
answer if this check lived inside `routeInboundMessage` alone" — was the
original justification for the upstream placement in the first place. That
hazard must be **re-checked once the check moves downstream**, not assumed
solved by the move. Not resolved here; flagged for whoever implements item
20's stage 1.

### 19. Caption arrival — ~~payload-agnostic by design~~ VERIFIED for captions, PARTIALLY (2026-09-13, stage 1 planning)

~~**UNVERIFIED FACT, named as such, both sources on record:** whether Twilio
co-populates `Body` on an inbound photo with a caption. `media-reply.ts`'s
own header asserts a mid-flow photo arrives with an **empty** `Body`; this
design pass's own earlier Twilio research could not confirm either answer
from current public docs. Neither source wins by default — this is recorded
as **UNVERIFIED**, not resolved by picking one.~~

**DATED CORRECTION (2026-09-13).** Struck through, not deleted. The fact is
now **settled for the captioned case, confirmed live**: a captioned photo
**does** populate `Body`. Confirmed 2026-09-13 from Twilio's own inbound
message log — SID `MM1b568a6b25d047a6c302851d36102784`, message body "This
is a fan" delivered alongside the media. `media-reply.ts`'s header comment
— "a media reply sent mid-flow... would reach `dispatchInboundTurn` with an
**empty** Body" — is **WRONG** for the captioned case, as written today.
This is a correction owed to that file's own comment when the interceptor
move (item 18) actually lands in code; not fixed here, since this pass is
plan-only, but recorded here so the correction isn't lost before then.

**STILL UNKNOWN, not assumed:** what `Body` contains for an **uncaptioned**
photo — empty string, or the key absent entirely. Checked this pass against
Twilio's inbound log for the uncaptioned photo received at approximately
10:20 the same morning, from the same number — **undetermined**: this
session has no Twilio credentials available to query the message log
directly (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are not present in this
sandboxed environment, and `.env.local` lives outside this worktree's
isolation boundary). Not assumed either way. Whoever builds stage 1 needs
this confirmed directly against the log before relying on it.

**DECIDED design, which holds under either answer for the uncaptioned
case:** the photo is handled on its own path (per item 12), and any
accompanying text is passed to the normal answer parser for the currently
open question. If an uncaptioned photo's `Body` is empty (or absent, which
today's flows already treat as empty), that path simply never fires and
nothing breaks — the flow's existing empty-answer handling (Rule 3.5,
unlimited reask) governs, unchanged. If it carries text, the text is
captured exactly as item 12 already describes. The design does not need the
still-open uncaptioned-`Body` question resolved to be correct either
way — that remains the point of building it payload-agnostic on that half.

**Verification step still owed, not a design blocker:** confirm what
`Body` contains for an uncaptioned photo directly against Twilio's inbound
log (or a live test send), from an environment with real Twilio
credentials. This must be done **before** stage 1 ships, but it does not
block finishing stage 1's plan.

**UPDATED 2026-09-13 (item 23, this same pass):** item 23's "a photo is
never an answer" decision means this uncaptioned-`Body` question is now
**doubly** not a blocker — not only does the design already hold under
either answer (as this item already said), but the specific failure mode
that made it feel urgent (a blank answer silently recorded) is now closed
categorically by item 23, regardless of what `Body` turns out to contain.
The verification step immediately above still stands and is still owed —
it's needed for the code to correctly detect "no accompanying text" either
way — it just no longer carries the weight of "if we get this wrong, a
real answer goes blank."

### 20. Build sequence — the implementation plan

Seven stages (renumbered 2026-09-13 — stage 0 inserted below; stages 1–6
**keep their existing numbers**, deliberately, so none of this item's own
internal cross-references by number — e.g. stage 2's "must ship before
stage 3" — need auditing and rewriting one by one), each **separately
shippable**, in this order, with the stated gates. This is the doc's
implementation plan, not a new design decision on top of items 1-19 — it
sequences work those items already describe.

0. **Storage setup.** Bucket creation, path convention, access rules
   (~~Storage RLS~~ **service_role only, no Storage RLS at all** —
   corrected 2026-09-13, same day, after the plan below was first written;
   see `docs/plans/stage0-storage-setup-plan.md`'s own dated correction).
   **NEW, 2026-09-13, split out from what was originally
   scoped as part of stage 1** — stage 1's own planning found that no
   Supabase Storage bucket has ever existed in this project (this would be
   the first object write in the product's history), and a mistake in
   access rules exposes one tenant's photos to another — a risk profile
   that earns its own review, separate from ingestion mechanics. Full plan:
   `docs/plans/stage0-storage-setup-plan.md`. **Gates every other stage
   below** — none of them can write or read a real object until this
   exists.
1. **Photo intake during check-ins.** Requires item 18's interceptor move
   (downstream, flow-aware) **and stage 0 complete** (added 2026-09-13 —
   intake cannot store anything without a bucket to store it in). Full
   plan: `docs/plans/stage1-photo-intake-plan.md`.
2. **Hindrance photo capture.** **HARD GATE: must ship before stage 3** —
   per item 16's own ordering constraint (the nudge must not point at a
   capture path that doesn't exist yet).
3. ~~**Off-step nudge** (item 6). Gated on approved copy + the Tamil pair
   (item 21).~~ ~~**STATUS (2026-09-15): LIVE ON PROD, E2E PROOF OWED.**~~
   **STATUS (2026-09-15): DONE, LIVE ON PROD, E2E VERIFIED 2026-09-15.**
   `claim_media_nudge` (migration 045) applied to prod
   (`jvxwqignooseazzmwhvl`) — see `docs/reviews/045-prod-apply-record.md`
   for the full apply transcript (PITR observed, CI proof pinned to the
   merged SHA, all grants/hash/lock verification by observation) and its
   own "WhatsApp end-to-end proof" section for Aravind's recorded live
   verification (burst-of-3 → exactly one nudge, throttle window
   re-tested, zero Sentry failures). Stage 3 app code was already live on
   prod (Vercel `main @ 3fb18c7`) calling this function before the apply
   — see that record's own opening line.
   Struck through above, not deleted, per this project's own correction
   discipline: the original "gated on approved copy + Tamil pair" framing
   is now stale — the English copy shipped (Tamil pair remains separately
   owed, item 21, unchanged by this status). Real-world WhatsApp
   end-to-end proof (burst of 3 idle photos → exactly 1 reply, against a
   live number) is OWED, tracked in that same apply record's own section.
4. **Email attachments** (DPR + hindrance, item 10's round-5 correction).
   Gated on the size/deliverability test (item 10's own required gate).
   **SEQUENCING:** the hindrance email's recipient lookup resolves the PM's
   email via `users.auth_id -> auth.users` (`lib/hindrance/pm-notify.ts`,
   `resolveProjectPMEmails`) — the same auth-identity coupling migration 007
   is surgery on. **Do not begin stage 4 while 007 is mid-apply.**
   **ADDED 2026-09-13 (round 6):** this stage now also includes item 22 —
   the DPR email's recipient list gains the project's PM(s), via the same
   `resolveProjectPMEmails` lookup and therefore the same 007 sequencing
   constraint already stated above, now doubly applicable since both emails
   this stage touches share the identical resolution path.
5. **PM surfaces** — photos in dashboard and DPR, overflow links (item 14),
   retention policy visible in-product (item 15).
6. **Retention deletion job.** **LAST**, and the **only irreversible
   mechanism** in the feature. Recommendation, restated from item 15: build
   it, but leave it **switched OFF until a real customer is running**,
   preserving the option to revise the clock — retention is forward-only
   (item 15) and deleted photos cannot be recovered if the policy is later
   extended.

### 21. Outstanding user-facing strings — all NOT APPROVED

Every string this design pass still owes, collected in one place. None are
drafted here beyond what already exists in the doc; nothing new is invented
by this entry.

- **Tombstone string** (item 9) — NEEDED, NOT DRAFTED.
- **Off-step nudge** (item 6) — English draft exists; **Tamil pair owed.**
- **Hindrance email copy** — NEEDED, NOT DRAFTED. The existing copy
  (`buildHindrancePmNotifyEmail`, per item 17's evidence) has no language
  for attached photos; it needs revision once item 10's attachment decision
  ships.
- **DPR email copy, overflow-links section** — NEEDED, NOT DRAFTED. No
  existing copy names or explains the dashboard-link overflow path (item
  14); one is owed before that section ships.

---

## RESOLVED — ROUND 6 (2026-09-13, a fourth pass the same day)

### 22. DPR email recipients — now includes the PM

**Finding that forced this** (surfaced auditing item 3's own fix): the DPR
email goes to the **owner** per CLAUDE.md §5, and the owner has no web
login. Item 14's overflow photos (11+) are **PM-only dashboard links** — the
owner receives links he cannot open, the exact dead-link problem item 3
originally raised, relocated rather than solved by round 4's fix. Worse:
item 10's durable copy (the attached first-10 photos) lands in the
**owner's** inbox, while the **PM** is the person who actually needs that
evidence day to day.

**DECIDED:** the DPR email is delivered to the project's **PM(s) as well as
the owner** — not a replacement recipient, an addition. This resolves the
access gap above **and** fixes a separate, standing gap: the PM currently
receives **no daily record at all** — DPR review today happens only via the
PM web dashboard's Daily Logs/DPR Archive views (CLAUDE.md §1), never
pushed to the PM proactively the way it already is to the owner.

- **PM resolution reuses the existing pattern**, not a new one:
  `resolveProjectPMEmails` (`lib/hindrance/pm-notify.ts`) — `project_members`
  filtered on `role='pm'` for that project, notify **all** PMs on the
  project, same "notify all, not skip-and-surface" policy that function
  already implements for hindrance notifications.
- **007 coupling, recorded explicitly:** that lookup resolves each PM's
  email via `users.auth_id -> auth.users` — the same auth-identity seam
  migration 007 is surgery on. The same sequencing constraint item 20's
  stage 4 already states for the hindrance email's recipient lookup applies
  here too, now that the DPR email uses the identical resolution path:
  **do not begin stage 4 while 007 is mid-apply.**
- **Open question, NOT decided:** whether the **owner's** copy should keep
  the overflow dashboard links at all, or instead state the overflow count
  without a link he cannot use — now that the PM's copy of the same email
  carries a link he genuinely can open. Left open; not resolved by this
  entry.

This is added to item 20's build sequence as part of **stage 4** (email
attachments), since both changes touch the same email — see item 20 below.

---

## RESOLVED — ROUND 7 (2026-09-13, stage 0/1 planning pass)

### 23. A photo is never an answer

**DECIDED (Aravind, 2026-09-13).** If a photo arrives during a check-in
with **no accompanying text**, the photo is stored and the **current
question stays open and is re-asked**. Only non-empty typed text is ever
passed to the answer parser.

**What this closes:** stage 1's own planning found a real, live gap —
both `apply_morning_flow_turn` (step 2, "Plan of action") and
`apply_evening_flow_turn` (step 1, "Work completed + quantity") accept
**any** `Body`, including an empty string, and unconditionally advance,
writing the empty string verbatim into `morning_plan` / `evening_output`.
An uncaptioned photo landing on one of these ungated free-text steps would
have silently recorded a blank answer and advanced — degrading DPR content
with no re-ask and no error, ever surfacing it. **Confirmed directly
against the live SQL** (not inferred from TypeScript comments) as part of
this same planning pass — see `docs/plans/stage0-storage-setup-plan.md`
§8.2 for both functions' relevant bodies, pasted verbatim. This decision
closes that gap at the design level, for **every** step, not just the two
confirmed ungated ones — a photo alone is categorically never sufficient
to satisfy any question, gated or not.

**Consequence for item 19:** the still-unresolved uncaptioned-`Body`
question (empty string vs. key entirely absent — item 19) is **no longer a
blocker for stage 1**. Whichever it turns out to be, this decision already
says: if there's no non-empty typed text, the question re-asks — the
implementation does not need to distinguish "empty string" from "absent"
to behave correctly, since both are treated as "no accompanying text"
either way. **It should still be resolved** (item 19's own verification
step stands, restated there), since exactly *how* "no accompanying text"
is detected in code depends on knowing which shape Twilio actually sends —
but the design no longer depends on the answer to be correct.

**Implementation note, not a new decision:** this likely means the
existing per-question reask mechanic (Rule 3.5) is what fires — a photo
with no text is treated the same way an empty/whitespace text message
already is at that step, not a new, third re-ask pathway. Confirming that
reuse (rather than building a parallel mechanism) is stage 1's own job, not
decided here.

---

## Also flagged, not corrected here

`CLAUDE.md` §2's Fast-Follow list still reads "Ad-hoc safety / invoice /
hindrance flows — DO NOT build yet." This is stale — migration 038 shipped
the hindrance flow to `main` (PR #239). Per instruction, not corrected as
part of this pass; naming it again here so it isn't lost between rounds.

## Sources for the verified facts above

- [Expiring objects (Storage) · supabase discussion #20171](https://github.com/orgs/supabase/discussions/20171) — lifecycle expiration confirmed not yet a native feature.
- [Supabase Pricing](https://supabase.com/pricing) — fetched directly, 2026-09-12: 100 GB storage / 250 GB egress included on Pro; $0.0213/GB storage, $0.09/GB egress ($0.03/GB cached) beyond that.

## RESOLVED — ROUND 8 (2026-09-15, stage 3 build)

Stage 3 (item 20's build sequence, "Off-step nudge," item 6) built on branch
`feat/stage3-media-nudge`. Item 6's own earlier draft copy (struck through
above, not deleted) is SUPERSEDED by the copy actually approved and shipped
this round. Decisions, stated plainly so a later round can strike through
what this one gets wrong rather than silently rewrite it:

- **5-minute throttle window, not "reply to every off-step photo."** Item
  6's original text never specified a throttle at all — a burst of several
  idle photos in a row (an engineer sending progress shots one at a time,
  not realising none of them are being saved) would have produced one nudge
  reply PER photo. `claim_media_nudge` (migration 045, HELD — not applied to
  any database yet, see `docs/reviews/045-review-brief.md`) throttles this
  to at most one reply per phone number per `MEDIA_NUDGE_WINDOW_SECONDS`
  (300s) window, using the same per-phone-number row-lock acquire pattern
  every other session RPC in this project already uses (012/044).
- **No reply at all on a throttled photo, not a shorter/quieter reply.**
  The first photo in a window gets the full nudge+menu; every further photo
  inside that same window gets NOTHING — an empty TwiML response
  (`<Response></Response>`), which Twilio delivers as no message at all.
  Considered and rejected: a shorter acknowledgement ("still not saved") for
  the throttled case — rejected because it re-introduces the exact
  one-reply-per-photo burst problem the window exists to prevent, just with
  shorter text.
- **Nudge + the LIVE idle menu, composed, not a static numbered list.** Item
  6's own struck-through draft named "reply 1" directly inside the nudge
  text — this shipped version instead appends the SAME live menu (header
  line + action line, via `buildIdleMenu`) every other idle reply already
  composes, so the nudge never goes stale relative to whatever the ad-hoc
  menu's real state is (a site-holiday header, a morning-closed header,
  etc.) the way a hardcoded "reply 1" line could. Reply order, always:
  `MEDIA_NUDGE_REPLY`, then `MEDIA_NUDGE_PROGRESS_LINE`, then the live menu
  — three lines, in that order, every time a nudge is sent.
- **`MEDIA_NUDGE_PROGRESS_LINE` is TEMPORARY, named as such in code.**
  "Progress photos: send them during your morning or evening check-in." is
  only true because the ad-hoc menu has no progress-photo item of its own
  yet — the moment it gains one, this line's own claim (morning/evening
  check-in is the only place a progress photo can go) becomes false, and
  the line should be removed, not reworded. Flagged in
  `lib/whatsapp/media-reply.ts`'s own comment on this constant so the
  removal isn't missed when that menu item ships.
- **A photo's caption never drives idle routing (item 12, extended).** A
  photo captioned "1" at idle gets the nudge, never the hindrance flow —
  `classifyAdhocInput` is never called for a photo at all. This is the same
  "a photo/caption is never an answer" principle items 12/23 already
  established for in-flow photos, extended to the idle router.
- **Tamil pair still owed, unchanged from item 21's own list.** Both
  `MEDIA_NUDGE_REPLY` and `MEDIA_NUDGE_PROGRESS_LINE` carry the same "Tamil
  pair is owed and NOT approved — do not invent one" comment convention
  every other stage-1/stage-2 copy constant already uses. Not resolved by
  this round; item 21's own list is the tracker, not restated here as a
  second copy.

~~**Migration 045 is HELD, not applied anywhere** (not test-db, not prod) —
this build's own instruction was explicit: no apply to any database this
round. Full review package: `docs/reviews/045-review-brief.md` and
`docs/reviews/045_media_nudge_throttle.sql`.~~

**SUPERSEDED (2026-09-15): APPLIED — test-db, then prod.** Struck through
above, not deleted, per this project's own correction discipline. Test-db
apply: `docs/reviews/045-test-db-apply-record.md`. Prod apply (PITR
observed, CI proof pinned to the merged SHA): `docs/reviews/045-prod-
apply-record.md`. File now lives at `supabase/migrations/
045_media_nudge_throttle.sql`, not `docs/reviews/`. Stage 3 status: live
on prod, ~~WhatsApp end-to-end proof owed~~ **DATED (2026-09-15): E2E
verified** (see item 20's own stage 3 line, above, for the same status
stated at the build-sequence level).

**BACKLOG NOTE (2026-09-15).** Copy: after both check-ins are complete,
`MEDIA_NUDGE_PROGRESS_LINE` points to check-ins that are no longer
available today. Accepted as-is while the line is temporary; revisit with
the menu's progress-photo item.
