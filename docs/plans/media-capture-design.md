# Media on check-in flows — design doc

STATUS: DESIGN PASS, DECIDED WHERE MARKED, NOT BUILT. No code, no migration,
no migration number reserved. This is the second round of this design pass —
the first round's open questions and conflicts are folded in below as
RESOLVED or carried forward as STILL OPEN. Companion edit: this round amends
`docs/design-principles.md` §0's corollary in place (dated note, not a
silent rewrite) — see RESOLVED 1 below for why.

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

## STILL OPEN — options reported, nothing decided

### 6. Off-step photo handling

A photo arriving on a step that doesn't expect one (e.g. sent during Q4
instead of Q2). Three options, trade-offs restated concisely:

| Option | What happens | Pro | Con |
|---|---|---|---|
| **Silent attach** | Store against the day, don't advance the step, nudge back to the pending text question | Matches Rule 3.5's existing "never punish, never dead-end" mechanic; closest to how an unparseable text answer is already handled | §41(c) says a photo's purpose derives from which flow captured it — an off-step photo has no determinable purpose (attendance? progress? evidence?); risks silent misclassification |
| **Answer-substitution** | Treat it as an early/late answer to whichever step actually asks for a photo, skip re-asking that step when reached | Best experience for the engineer; no redundant question | Requires the state machine to track "photo satisfied" independent of `current_step` position — a real addition, not free |
| **Reject-and-nudge** | "That's for a later question — please answer: `<current question>`" | Simplest to build | Closest to "punish" of the three; cuts against Rule 3.5's spirit more than the others |

My prior lean was silent attach, restated here for the trade-off, not as a
recommendation to adopt without a decision — this is explicitly Aravind's
call per the brief.

### 7. One polymorphic `photos` table vs. per-parent tables

- **Polymorphic** (`parent_type`, `parent_id`, `purpose`, `photo_url`, …):
  one table, one RLS policy set, one place to enforce retention-by-type.
  **Real cost, specific to this project**: no `REFERENCES` constraint is
  possible across two different parent tables from one polymorphic FK
  column — Postgres FKs point at exactly one table. This project leans
  hard on real composite/simple FKs everywhere else it links rows
  (`hindrances_project_id_fkey`, `hindrances_reported_by_fkey`, the whole
  `daily_log_edits`/`daily_logs` relationship) specifically so referential
  integrity is enforced by the database, not by application code — a
  polymorphic `parent_id` gives up that guarantee entirely for this one
  table. A stale or mistyped `parent_id` pointing at a deleted `hindrances`
  row would fail silently (no FK to catch it), which is a different and
  arguably worse failure mode than anything this project currently has to
  reason about.
- **Per-parent tables** (`daily_log_photos` → `daily_logs`, a new
  `hindrance_photos` → `hindrances`): real FKs, real cascade behavior,
  consistent with how every other relationship in this schema is built.
  Cost: retention-by-type logic (7d/45d/45d) has to be either duplicated
  across two tables or centralized behind a shared function/view instead of
  a single table scan.

Not deciding this — it's a real fork with a real integrity cost on one
side and a real duplication cost on the other, and it's the kind of call
that should go through review before a migration number gets reserved.

### 8. `hindrances.photo_url` — supersede or leave as dead schema

Confirmed again this round: single TEXT column, CHECK-constrained, zero
rows have ever written to it (`grep` against `038_hindrance_flow_and_
collision_fix.sql` and `lib/hindrance/*.ts` — no hits). Two options: (a)
a future migration formally supersedes it (drops it, once whatever
replaces it — per item 7 above — is live), or (b) it's left in place,
documented as dead, matching this project's own general "don't drop what
becomes unread" convention (§28(p) in `design-decisions-beta-feedback.md`
uses exactly this treatment for other now-unread columns). Leaning toward
(b) for consistency with that precedent, but not deciding it — it depends
on the outcome of item 7, since a polymorphic table could theoretically
still write through it in a degraded single-photo mode, while per-parent
tables make it unambiguously obsolete.

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
