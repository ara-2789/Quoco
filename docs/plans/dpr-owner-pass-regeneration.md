# Owner-pass DPR regeneration — building the deferred backstop

STATUS: DESIGN PASS. No code, no migration, no migration number reserved.
**Second rewrite.** This doc is not a fresh design — `docs/plans/dpr-
regeneration-decision.md` and `docs/plans/dpr-regeneration-build-spec.md`
(2026-09-05/07) already decided this feature and explicitly deferred one
piece of it: *"the 20:30 send-time backstop in `owner-send`... Decided in
the record, but it is a send-path change, not a screen. Separate PR, DPR
track."* This doc is the build of that deferred piece. Read both of those
first — they are referenced below, not re-derived. Where this doc's
reasoning extends or sits in tension with theirs, that is flagged
explicitly, not silently resolved into either direction.

**Process note taken.** A search of `docs/plans/`/`docs/reviews/` before
starting is now the reflex, the same way `git fetch` must precede any claim
about `main` — this is the second round in one day that skipped it and
found something load-bearing after the fact.

---

## 0. BLOCKING PREREQUISITE — Part A has not shipped; nothing below can ship before it

**Stated first because everything after it depends on it, not as a
footnote.** `write_dpr_version` (migration 029) already exists — locks the
`dprs` row, computes `current_version + 1`, INSERTs a `dpr_versions` row,
UPDATEs `dprs` — but **nothing calls it**. Confirmed live, this session:
`lib/dpr/dispatch.ts`'s `dprsUpsert` step still does a raw
`.from('dprs').upsert({...}, {onConflict: 'project_id,engineer_id,log_date'})`.
029's own review package already named this exact gap and gave it a name:
*"the dispatch.ts / generate-one-dpr.ts → write_dpr_version() wiring PR...
tracked here, by this name, so it has a title to be referenced by when it's
opened"* (`029-dpr-versioning-review-package.md:389-399`).

**Why this blocks the owner-pass backstop specifically, not just generally:**
a raw upsert with `onConflict: 'project_id,engineer_id,log_date'` **replaces
the row in place**. If the owner pass re-triggers generation for the same
`(project, engineer, log_date)` before Part A ships, the second upsert
silently overwrites the PM's 19:45 content with no history anywhere. That is
strictly worse than today's status quo — today at least the 19:45 version
survives, just possibly stale. **The two-pass model's entire audit-value
argument depends on Part A landing first.** Build order is not negotiable:
Part A → owner-pass backstop, never the reverse.

### What Part A actually involves — read from the RPC and the two call sites, not estimated

`write_dpr_version(p_dpr_id UUID, p_content TEXT, p_structured JSONB,
p_generated_by TEXT, p_generated_by_user UUID DEFAULT NULL) RETURNS UUID`
operates on an **existing** `dprs` row — it takes `p_dpr_id`, not
`(project_id, engineer_id, log_date)`, and cannot create a row from
scratch. `dispatch.ts`'s current upsert does two jobs at once (create the
row on first generation, replace its content on every generation) that
`write_dpr_version` alone cannot do. So Part A is a real two-step change at
each of its two call sites (`dispatch.ts`'s `handleDprGenerateJob`,
`scripts/generate-one-dpr.ts`), not a one-line swap:

1. Ensure a `dprs` row exists for `(project_id, engineer_id, tenant_id,
   log_date)` — a shell upsert carrying identity columns only (no
   `content`/`structured`), `ON CONFLICT DO NOTHING`, to get back the row's
   `id` whether this is the first generation or a later regeneration.
2. Call `write_dpr_version(id, content, structured, 'system', NULL)` to
   actually write the content — on **every** generation, including the
   first, so `dpr_versions` captures complete history from day one rather
   than only "every regeneration after the first." (029's own backfill
   only had to special-case pre-029 rows; a row created after Part A ships
   has no such special case to handle.)

**Already satisfied, confirmed rather than assumed:** `write_dpr_version`'s
own guard requires the `'system'` path to carry no JWT (`auth.uid() IS
NOT NULL` raises `insufficient_privilege` for that branch —
`029_dpr_versioning.sql:321-324`). `dispatch.ts:69` already calls
`createServiceClient()` — `handleDprGenerateJob` already runs as
`service_role` today, so Part A's RPC call satisfies this guard natively;
no auth work is needed to make the call legal, only to make the call exist.

**No schema change** — confirmed by the build spec's own text and by this
session's read of `write_dpr_version`: the RPC and both tables (`dprs`'s
`current_version`/`generated_by`/`generated_by_user`, `dpr_versions`
itself) already exist, already reviewed under 029 (B1/B2/B3 fixed,
re-verified). Part A is pure application code.

### Is it small enough to do now, and should it be its own PR — yes to both

- **Scope is bounded and already named**: two call sites, a shell-upsert +
  RPC-call pattern, test updates to `dpr-generate-job.test.ts` (already
  extensively touched by the 2026-09-12 verdict-disable PR, so this is a
  file under active, well-understood maintenance, not stable ground being
  disturbed for the first time).
- **No new external review gate trip** — `write_dpr_version` is already
  reviewed; calling an existing, already-gated function from new
  application code doesn't retrip §0. Ordinary code review applies, not
  the heavy package.
- **Zero behavior change from any user's perspective** — the 19:45 report
  looks identical; only the storage mechanism gains version history. Low
  blast radius, easy to verify (compare `dprs.content` before/after,
  confirm a `dpr_versions` row now exists).
- **It unblocks two things, not one** — the build spec states plainly
  *"This blocks Part B [the PM's regenerate button] entirely. Nothing in
  Part B works until this lands."* Shipping Part A now is a prerequisite
  either way, independent of whether the owner-pass backstop or the button
  lands first.

**Recommendation: ship Part A now, as its own PR, before any owner-pass work
starts.** This is not a new decision — it is executing what 029's own
review package already scoped and named. Nothing about the media-capture
pass or the owner-pass backstop changes its shape.

---

## 1. Correction to my own prior claim about idempotency — partially right, not fully

Aravind's message states the AI summary was disabled yesterday (PR #254,
`ebe548d`) and regeneration is now fully deterministic. **Verified directly
against the merged commit — the first half is exactly right, the second
half needs a correction of its own, dated, not silent:**

**Confirmed true**: `dispatch.ts`'s `eveningNeedsModel`-true branch now
reads `verdict = ''; verdictStatus = 'disabled'` — no call to
`generateEngineerVerdict` remains anywhere in the generation path. My prior
doc's "verdict idempotency crack" (a live Claude call meaning two
regenerations of unchanged facts aren't guaranteed byte-identical) **is
closed for the verdict specifically.** Correcting that section of the prior
version of this doc in place, per this project's own discipline.

**Not fully true — a second, separate model call remains, confirmed live**:

```ts
// lib/dpr/dispatch.ts:172-174 — still runs on every generation
const workCorrection = await timed('correctEngineerWorkText', () =>
  correctEngineerWorkText(anthropic, facts.work.planned, facts.work.done_text),
)
facts = {
  ...facts,
  work: { ...facts.work, planned_corrected: workCorrection.planned, done_text_corrected: workCorrection.done_text },
}
```

```ts
// lib/dpr/spelling-correction.ts:251 — the actual model call, inside correctEngineerWorkText
const response = await client.messages.create({
  model: MODEL, max_tokens: 800, system: ENGINEER_SPELLING_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: promptText }],
  output_config: { format: { type: 'json_schema', schema: ENGINEER_SPELLING_CORRECTION_SCHEMA } },
})
```

This call is skipped **only** when both `morning_plan` and `evening_output`
are null (an empty/unusual day) — on an ordinary day where the engineer
typed free text for either field, it fires, and its output
(`planned_corrected`/`done_text_corrected`) is folded into `facts` **before**
rendering. PR #254 did not touch this — it's a separate stage ("Stage 3,"
per `dispatch.ts:163`), added 2026-09-11, one day before the verdict was
disabled, for an unrelated reason (spelling correction, not judgment
language).

**Net effect: the idempotency crack is narrower, not closed.** It no longer
fires on every day needing a verdict (most evening-complete days); it now
fires on every day with reported free text (also most days, by a different
axis). The same underlying risk applies: identical input text is not
guaranteed to produce a byte-identical spelling correction across two
calls, even with structured JSON output constraining the shape of the
response. "Regeneration is fully deterministic" is not accurate as stated —
"regeneration's verdict step is now deterministic; a separate spelling-
correction step is not" is. Flagging this precisely rather than accepting
the fuller claim, since the two-pass model's "identical when nothing
changed" requirement depends on knowing exactly which step could still
diverge.

---

## 2. Regeneration shape — reuse `dpr_generate`, not an inline reimplementation

Restating on top of, not instead of, the already-decided mechanism.
`dpr-regeneration-decision.md`'s backstop text: *"At 20:30, before sending,
`owner-send` checks the same staleness condition... If edits exist,
regenerate, stamp `last_regenerated_at`, then send... If regeneration
fails, send the last good version anyway."* The button (Part B) resolves
"regenerate" as **re-enqueuing the existing `dpr_generate` job** — same job
type, same handler, async (*"the button enqueues, it does not await... the
client polls"*).

**Recommendation: the owner-pass backstop should be a third caller of that
same mechanism** — `owner-send`'s job enqueues a `dpr_generate` job for any
stale row, waits for it, then reads the fresh `dprs` row and sends — rather
than reimplementing assembly + render inline in `owner-deliver-dispatch.ts`.
Reasoning unchanged from the prior round: `handleDprGenerateJob` is not
thin (containment checks, the spelling-correction stage just confirmed
still live, and — once Part A ships — `write_dpr_version` integration);
duplicating any of it in a second file risks the same "two places decide
one thing" drift this project has already been bitten by
(`buildBodyCorpus`/`isHireRateTrusted`). Cost, named plainly: `owner-send`'s
job needs to wait on an async job it just enqueued — real orchestration,
same shape the button already accepted client-side, moved server-side here.
The 40-45 minute window is generous headroom for a job expected (not yet
measured — build spec's own still-open item) to take tens of seconds.

This is a recommendation, not a resolution — see Open Decisions.

---

## 3. Two things left open, unchanged in substance, sharpened by the new information

- **Unconditional vs. the already-decided conditional staleness gate.** The
  decision doc gates on `daily_log_edits.created_at > COALESCE(
  last_regenerated_at, generated_at)` specifically *to avoid a pointless
  Claude call and a junk version row every night nothing changed.* That
  cost argument is now **weaker than when it was written**, given §1's
  finding: the verdict call is gone, but the spelling-correction call is
  not, and it still fires on most nights regardless of whether an edit
  happened — so "conditional" no longer avoids *all* model-call cost the
  way it did when the decision was written, only the (now free) verdict
  half. This shifts the tradeoff; it does not settle it, and it is
  Aravind's call whether the remaining savings still justify the gate's
  complexity. **This doc is flagging a change in the reasoning behind an
  existing decision, not overriding the decision itself.**
- **The staleness gate cannot see photos, unchanged.** It only reads
  `daily_log_edits`. A late-arriving photo (media-capture design pass,
  itself still unbuilt) writes to a photos table / status column, neither
  of which this gate checks. If the conditional gate is kept, it needs a
  second clause for photo-completion timing — no schema exists for that
  yet. Recorded, not solved.

---

## 4. PM EDITS section — unchanged from the prior round, restated briefly

No new investigation needed here; nothing in today's corrections touches
this section's facts.

- **Diff**: fully derivable from `daily_log_edits.old_value`/`new_value`
  today. Needs new application code (a query scoped to edits since the
  previous version, joined `daily_logs_id -> daily_logs.engineer_id`, the
  same join the button's own staleness gate already requires) — no schema
  change.
- **Comment**: `daily_log_edits.comment TEXT NULL` already exists (029).
  `correct_daily_log(UUID, TEXT, JSONB)`'s signature has never been
  extended to accept one. **Confirmed this trips CLAUDE.md's `CREATE OR
  REPLACE`-only-preserves-grants-when-signature-unchanged rule** — a fourth
  parameter changes the argument type list and would create a second, live
  overload rather than replacing the original. Fix: explicit `DROP
  FUNCTION IF EXISTS public.correct_daily_log(UUID, TEXT, JSONB)` ahead of
  the new `CREATE OR REPLACE`, with the exact grant shape 019/040 both
  already use (`REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated;`)
  re-asserted explicitly. **Open, not decided**: extend the existing
  function this way, or ship a new name (`correct_daily_log_v2`) to
  sidestep the hazard entirely — this project has precedent for both
  patterns.
- **Gate**: this migration trips CLAUDE.md §0 condition (a) — modifies a
  live `SECURITY DEFINER` function's logic/signature — regardless of which
  option above is chosen. Full external review package required.
- By contrast, neither Part A nor the owner-pass regeneration mechanism
  (§2) needs a new migration — both call only already-existing, already-
  reviewed functions. §0's gate is keyed on migrations; it doesn't trip
  here.

---

## 5. Photo race — accepted as narrowed, not closed; unchanged

Not building the hold-and-recheck logic now, per instruction. DPR-24's
existing pattern remains the one to reach for if a real late-photo
incident justifies closing this properly: *"9 PM delivery holds if
generation_status='running' OR an unprocessed job... exists. Hold up to
5 min... send committed content + log a Sentry anomaly."* The photo
analogue — hold briefly on a `pending`/`running` `media_ingest` job before
finalizing, send without the photo past a short timeout — is the fix
pattern, not built. This is the same mechanism §3's photo-blindness gap
would need to close for real.

---

## Open decisions, collected

1. Reuse `dpr_generate` via re-enqueue (recommended, §2) vs. an inline
   reimplementation in `owner-deliver-dispatch.ts` — is the duplication
   risk of the inline route acceptable to whoever weighs it against the
   async-orchestration cost of reuse?
2. Unconditional regeneration every night vs. the already-decided
   conditional staleness gate — sharpened, not resolved, by §1's finding
   that the gate now only saves a spelling-correction call, not a verdict
   call too. And if conditional is kept, the gate still needs to learn to
   see photos, which have no schema yet.
3. Extend `correct_daily_log`'s signature (DROP+CREATE, re-grant) vs. ship
   a new function name for the optional PM comment.
4. Photo-aware hold-and-recheck for the owner pass (DPR-24's pattern) —
   explicitly not built now, named as the fix if a real late-photo
   incident ever justifies it.

**Not open, settled by this round**: Part A ships now, as its own PR,
before anything else here (§0). The verdict-call idempotency crack is
closed; the spelling-correction idempotency crack is not (§1) — this is a
finding, not a decision, and needs no vote, only awareness before anyone
claims regeneration is fully deterministic.
