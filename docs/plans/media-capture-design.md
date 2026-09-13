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

### 3. Overflow link (>10 photos) — deferred, not designed

Ship ≤10 embeds only, per §41(e)'s existing cap. No link-to-dashboard for
photo 11+ in this pass — the owner has no web login yet (CLAUDE.md §5,
`design-principles.md` Rule 1.2), and owner web login is queued as the same
piece of work as employee onboarding, separately. Building a link today
would be a dead link for the owner and a half-designed one for the PM
(conflict #2 from the prior round — PM-only access vs. a dashboard surface
that doesn't exist yet either). When owner login ships, the overflow link
becomes a small, well-scoped enhancement on top of a real destination —
not built ahead of that.

### 4. Ingestion architecture — queued job, not inline in the webhook

**Decided: media ingestion runs through the jobs table, the same pattern
this project already uses for Claude API calls (NFR-16) and DPR
generation.** Up to 10 Twilio downloads + Storage uploads cannot fit inside
the webhook's 15-second response budget (CLAUDE.md §6) alongside everything
else the webhook already does.

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
  crons from the generic `jobs/tick`). Ten downloads+uploads per engineer,
  potentially several engineers finishing evening around the same trigger
  window, is enough I/O that `media_ingest` likely wants its own cron
  entry rather than competing for `jobs/tick`'s existing 3-jobs-per-tick
  budget against DPR generation and everything else already polling there.
  Not decided — flagged for whoever scopes the actual job handler.
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
attendance / 45d hindrance / 45d evening progress), deletes the Storage
object via the `service_role` Storage client (Postgres has no native way to
delete an S3-backed object — this has to run from the app layer, same
reason media ingestion itself can't be pure SQL), and updates the row.
What "updates the row" means exactly is STILL OPEN — see item 9 below.

**Pricing, verified against `supabase.com/pricing` directly (fetched
2026-09-12, not from training):**
- File storage: 100 GB included on the Pro plan; $0.0213/GB/month beyond
  that.
- Egress: 250 GB included on the Pro plan; $0.09/GB beyond that
  (uncached), $0.03/GB for cached egress.

Against the prior pass's rough volume estimate (~1–1.5 GB resident storage
at ~50 engineers, low single-digit GB/month of egress from DPR embeds and
dashboard views): **this sits entirely inside the Pro plan's included
100 GB storage and 250 GB egress — effectively zero incremental cost at
this scale.** It stops being free only if engineer count or photo-per-day
volume grows by roughly two orders of magnitude, or if attendance/evening
retention windows are lengthened well past 7d/45d. Re-check this arithmetic
if either of those changes materially — this is a scale-dependent
conclusion, not a permanent one.

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

**Draft copy — NOT APPROVED, English only, pending Tamil pairs and
confirmation of the live menu numbering (per `inbound-start.ts`'s current
`ACTION_LINE`, hindrance is item "1" today):**

> Photo not saved — please choose a menu option and send it there.
> Reply 1 to report a hindrance, then send the photo again.
> Progress photos: send them during the evening check-in.

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
cost: retention-by-type logic (7d attendance / 45d evening progress / 45d
hindrance) has to be either duplicated across the two tables or centralized
behind a shared function/view — not a single table scan.

### 8. `hindrances.photo_url` — DECIDED, left as dead schema

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

- Evening photos → evening progress class, 45-day retention (per item 5's
  existing retention table).
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

### 12. Caption handling — DECIDED

Text accompanying a photo is never dropped. The caption is passed to the
normal answer parser for whichever question is currently open. If it
parses, it is recorded as that question's answer **and** stored in the
photo's existing `caption` field (item 7's `daily_log_photos` /
`hindrance_photos` shape). If it fails validation, the standard re-prompt
fires (Rule 3.5) and the text is still stored on the photo.

### 13. Burst handling — DECIDED

Twilio delivers each image in a burst as a separate message with its own
SID, so SID idempotency (`processed_messages`) does not dedupe a burst —
a fact about delivery, not a defect to fix.

- In-flow bursts generate no replies at all (item 11: photos stored
  silently), so no dedupe is needed there.
- Out-of-flow bursts: at most **one** nudge per session per 10 minutes,
  suppressed via a `last_media_nudge_at` timestamp on the `whatsapp_
  sessions` row. No new table. (No existing column serves this today — see
  the TASK 4 finding below; one new column is required.)

### 14. 10-photo cap — DECIDED

The cap of 10 photos per daily log stands (the same number item 3 and
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
> tomorrow, or report them as a hindrance.

---

## STILL OPEN — options reported, nothing decided

### 9. "Expired" semantics per type

What retention's scheduled job (item 5) actually does to a row once its
window passes:

- **Delete file + delete row.** Cleanest, but loses all audit trail — not
  even "a photo existed and was reviewed on date X" survives.
- **Delete file, keep row as tombstone** (`photo_url` set NULL,
  `caption`/`purpose`/timestamps retained). Preserves audit value — matters
  specifically for hindrance photos given §41(f)'s already-recorded note
  that this becomes a statutory-retention financial record the moment
  invoices/delivery-note photos exist alongside them.
- **Keep both indefinitely.** Not real retention — listed for completeness,
  not as a live option.

Not decided, and plausibly **different per type** — attendance is pure
personal data with no dispute-evidence value once its purpose (proof of
presence that day) has passed, so full deletion may be the honest answer
there, while hindrance's compliance angle argues for a tombstone. This is
squarely a product/compliance call, not an engineering one.

### 10. Email image delivery — signed URL vs. inline embedding

- **Remote `<img src>` pointing at a Supabase Storage signed URL**: simplest
  to build, but the signed URL's expiry has to outlive however long the
  email might realistically be opened — which for a 45-day-retention photo
  means either a long-lived signed URL (verify Supabase's current max
  `expiresIn` before assuming one is available) or a proxy endpoint that
  mints a fresh signed URL per view. This is also exactly where §41(g)'s
  already-recorded, unresolved concern lives: Resend's click-tracking is
  enabled on `quoco.co.in` and cannot be disabled from the dashboard;
  §41(g) flagged this for `<a href>` links specifically and left open
  whether it also touches `<img src>` — worth re-confirming, since image
  tags are not typically rewritten by link-tracking the way anchor tags
  are, but "typically" is not the same as verified against this specific
  Resend configuration.
- **Inline/CID embedding** (photo bytes attached to the email itself, not
  fetched from a URL): avoids both the signed-URL-expiry question and the
  click-tracking question entirely, at the cost of a heavier email payload
  and no lazy-loading — every recipient downloads every embedded photo
  whether or not they open the email fully.
- Neither is decided. Both interact with the "nothing empty, nothing
  stale" rule for owner-facing content (`design-principles.md` Rule 5.6) —
  a broken image in a report the owner never re-requests is a silent
  failure mode worth designing against explicitly, whichever path is
  chosen.

---

## Also flagged, not corrected here

`CLAUDE.md` §2's Fast-Follow list still reads "Ad-hoc safety / invoice /
hindrance flows — DO NOT build yet." This is stale — migration 038 shipped
the hindrance flow to `main` (PR #239). Per instruction, not corrected as
part of this pass; naming it again here so it isn't lost between rounds.

## Sources for the verified facts above

- [Expiring objects (Storage) · supabase discussion #20171](https://github.com/orgs/supabase/discussions/20171) — lifecycle expiration confirmed not yet a native feature.
- [Supabase Pricing](https://supabase.com/pricing) — fetched directly, 2026-09-12: 100 GB storage / 250 GB egress included on Pro; $0.0213/GB storage, $0.09/GB egress ($0.03/GB cached) beyond that.
