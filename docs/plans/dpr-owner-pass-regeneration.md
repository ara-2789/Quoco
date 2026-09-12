# Owner-pass DPR regeneration — design doc

STATUS: DESIGN PASS. No code, no migration, no migration number reserved.
Continuation of the media-capture design pass's photo-race question, now
folded into DPR regeneration.

## Correction, and prior art this doc builds on rather than re-derives

Two things from the prior investigation round need correcting/extending
before this design makes sense, per this project's own correct-in-place
discipline:

1. **My prior claim "no comment/reason field exists on `daily_log_edits`"
   was wrong** — I read migration 019 only. Migration 029 already added
   `daily_log_edits.comment TEXT NULL` explicitly *"for §4b's worked
   correction example"* (`029_dpr_versioning.sql:455-460`). The column is
   real and live. What's actually true, confirmed by grep: `correct_daily_
   log`'s signature has never changed to accept it — `019_daily_log_
   corrections.sql:149` and `040_evening_q5_tomorrow_needs.sql:263` both
   define it as `correct_daily_log(UUID, TEXT, JSONB)`, unchanged. The
   column is schema-only, unwired — this project's usual "schema before
   handler" shape, not a missing column.
2. **`docs/plans/dpr-regeneration-decision.md` and `-build-spec.md`
   (2026-09-05/06/07 — five to seven days before this pass) already decided
   almost this exact feature.** I didn't have these in context during the
   prior investigation round and should have found them before reporting.
   They decided: a PM-facing "Regenerate the report" button (Part B, not yet
   built), a prerequisite wiring PR routing `handleDprGenerateJob` through
   `write_dpr_version` instead of a raw upsert (Part A, **not yet built —
   confirmed live: `dispatch.ts:240` still does `.from('dprs').upsert(...)`
   directly**), and — named but explicitly deferred — *"the 20:30
   send-time backstop in `owner-send`... Decided in the record, but it is a
   send-path change, not a screen. Separate PR, DPR track."*

**That deferred backstop is exactly what Aravind is now asking for.** This
isn't a new feature competing with the button design — it's the next,
already-anticipated piece of it. Everything below is written to fit into
that existing decision, not replace it, and flags everywhere the two don't
yet line up.

---

## 1. Regeneration shape

### The already-decided mechanism, restated because it changes the shape of the question

The backstop as already specced in `dpr-regeneration-decision.md`:

> At 20:30, before sending, `owner-send` checks the same staleness
> condition [`daily_log_edits.created_at > COALESCE(last_regenerated_at,
> generated_at)`]. If edits exist, regenerate, stamp `last_regenerated_at`,
> then send... If regeneration fails, send the last good version anyway.

And the button's own mechanism (Part B), which the backstop should almost
certainly reuse rather than reinvent: **regeneration means re-enqueuing the
existing `dpr_generate` job** for that `(project_id, engineer_id,
log_date)` — the same job type the 19:45 pass and the PM's button both use
— not a new job type, and not an inline re-implementation of assembly +
verdict + render inside a different file.

**This reframes the two shapes the brief asked about.** (a) and (b) as
posed were "inline in owner-deliver-dispatch.ts" vs. "a distinct new
regeneration job type." Recon surfaces a **third, already-precedented
shape that is neither**: owner-send's job enqueues a `dpr_generate` job
(reusing the exact handler `dispatch.ts` already has, the same one the
button will call), waits for it to complete, then reads the now-fresh
`dprs` row and sends — matching the button's own already-decided pattern
("the button enqueues, it does not await... the client polls").

**Recommendation: this third shape, not (a) as posed.** Reasoning:

- `handleDprGenerateJob` is not a thin function — it's containment checks,
  narrative context, a verdict-denylist retry/fallback ladder, and (once
  Part A ships) `write_dpr_version` integration. Reimplementing any slice
  of that inline in `owner-deliver-dispatch.ts` (literal shape (a)) means
  two files independently computing "the report" — the same "two places
  decide one thing" shape this project has already been bitten by
  (`buildBodyCorpus`/`isHireRateTrusted`, per the 2026-09-05 admin-merge
  retrospective). A future fix to the verdict pipeline would need to be
  applied in two places, and the two would silently drift if it wasn't.
- Reusing `dpr_generate` means the owner-pass backstop, the PM's button,
  and the 19:45 automatic pass are three callers of **one** canonical
  pipeline — consistent with how `write_dpr_version` was designed
  (`029`'s own header: "the pipeline... already exists and carries real
  rows") and with the button design's own "async, enqueue-and-poll" shape.
- Cost of this recommendation, named plainly: owner-send's job now needs to
  wait on an async job it just enqueued before it can send — real
  orchestration, not free. This is the same complexity the button design
  already accepted server-adjacent-side (client polls a job row); here it
  moves inside a cron job instead of a browser. The 40-45 minute window
  this project already has is generous headroom for a job that (per the
  build spec's own still-open item 2) has never been measured but is
  expected to be tens of seconds, not minutes.

**Literal shape (a) (inline call, no job re-enqueue) is not recommended**,
for the duplication reason above — but it is the cheaper build if the
duplication risk is judged acceptable. Not fully closing this — see Open
Decisions.

### Hard prerequisite: Part A must ship first, or this makes the audit story worse, not better

This is the direct answer to *"whether the owner's regenerated copy should
be stored anywhere."* **`write_dpr_version` already exists for exactly
this** (`029_dpr_versioning.sql`, verified behavior per the build spec:
locks the `dprs` row `FOR UPDATE`, computes `current_version + 1`, INSERTs
a new `dpr_versions` row, then UPDATEs `dprs` — one transaction, append-only
history, no silent overwrite). Routing the owner pass's regeneration through
it means the PM's 19:45 render survives forever in `dpr_versions` as
version 1, `dprs.structured`/`content` become "whatever's most current"
(version 2, the owner's), and nothing is lost.

**But `write_dpr_version` is not wired into `dispatch.ts` today** — the
live code still does a raw `.from('dprs').upsert(...)` with
`onConflict: 'project_id,engineer_id,log_date'`. If the owner-pass backstop
ships by re-enqueuing `dpr_generate` **before** Part A lands, the *second*
run of the same raw upsert **silently overwrites the PM's 19:45 snapshot
with no history at all** — worse than "the owner's copy exists nowhere,"
because it also destroys the one snapshot that existed today. **Part A is
not optional prior work for this feature — it's a hard sequencing
dependency.** Build order: Part A (wiring PR, no schema change, already
scoped) → then the owner-pass backstop, never the reverse.

### Two things this recommendation leaves genuinely open — not resolved here

- **Unconditional regeneration vs. the already-decided staleness gate.**
  The existing backstop design is *conditional* — regenerate only if
  `daily_log_edits.created_at > COALESCE(last_regenerated_at,
  generated_at)`, to avoid a pointless Claude call and a junk version row
  every night nothing changed. Aravind's framing in this pass ("regenerated
  so it picks up any PM edits... and any photos") reads as
  *unconditional* — always regenerate at ~20:25, gate or no gate. These are
  different designs with different costs: conditional is cheaper (no
  redundant nightly Claude spend) but, as the next point shows, **currently
  blind to photos entirely**; unconditional is simpler and photo-safe by
  construction, at the cost of a second Claude call per engineer per night,
  every night, forever. Not deciding this here.
- **The staleness gate, as it exists today, cannot see photos at all.**
  It only reads `daily_log_edits`. A late-arriving photo (per the
  media-capture design pass) would write to a photos table and/or a
  `evening_photos_status`-shaped column — neither is `daily_log_edits`, so
  the existing condition would never detect it and the conditional
  backstop would skip regeneration on a night where the only thing that
  changed was a photo finishing upload. **If the conditional gate is kept,
  it needs a second clause added — something like "a photo attached to
  this engineer's day completed upload after `generated_at`" — which has
  no schema to check against yet, since the photos table itself is still
  undesigned** (media-capture design doc, open item 7). This is a real,
  concrete gap between the two design passes, not a hypothetical one.

### A third tension, worth naming precisely: pipeline reuse vs. idempotency

The "identical when nothing changed" requirement (see §4 below) and "reuse
`dpr_generate` unmodified" pull in different directions. `dpr_generate`'s
pipeline calls `generateEngineerVerdict` — a live Claude API call — every
time it runs. Identical input facts do not guarantee an identical output
sentence from a model call (even at low temperature, exact-byte
reproduction isn't a documented guarantee). So: reusing the pipeline
as-is means a no-edit night's owner copy will very likely say something
*substantively* the same as the PM's copy, but is not guaranteed
*byte-identical* — whereas guaranteeing byte-identical would mean **not**
blindly reusing the pipeline (e.g., skip the verdict call and carry the
prior version's verdict forward when facts are unchanged), which is itself
a real change to `dispatch.ts`, not a free addition. Flagged, not resolved.

---

## 2. PM EDITS section — diff (no schema change) plus an optional comment (real migration)

### What needs no migration

The diff itself ("Manpower — was: 18 on site | now: 22 on site") is fully
derivable from `daily_log_edits.old_value`/`new_value`, already captured on
every correction. **New logic needed, not new schema**: a query scoped to
"edits made to this engineer's log since the version currently being
superseded" — i.e. `daily_log_edits.created_at > <previous version's
generated_at/created_at>`, joined `daily_logs_id -> daily_logs.engineer_id`
(the exact join the button's own staleness-gate design already had to make,
for the identical reason — `daily_log_edits` carries no `engineer_id`
column). This is new application code (in `assemble.ts` or a sibling
module, plus render support in `render.ts`/`render-email.ts`), not a
migration.

### What needs a migration: `correct_daily_log`'s signature

The column exists (`daily_log_edits.comment TEXT NULL`, migration 029).
Nothing writes to it. To let a PM attach an optional comment to a
correction, `correct_daily_log(UUID, TEXT, JSONB)` needs a fourth
parameter, e.g. `p_comment TEXT DEFAULT NULL`, plus:

- the Server Action (`correctDailyLogField`) passing it through,
- a UI field on the correction row (optional, shown only alongside an
  edit, not as its own standalone action — matching §4b's "section only on
  edit" framing),
- the render layer reading `daily_log_edits.comment` (when present)
  alongside `old_value`/`new_value` for the diff line.

**Confirmed: this trips CLAUDE.md's standing `CREATE OR REPLACE` grants
rule, exactly as suspected.** Appending even a `DEFAULT NULL` fourth
parameter changes `correct_daily_log`'s argument type list —
`(UUID, TEXT, JSONB)` vs. `(UUID, TEXT, JSONB, TEXT)` are different
signatures to Postgres. A bare `CREATE OR REPLACE FUNCTION
correct_daily_log(UUID, TEXT, JSONB, TEXT DEFAULT NULL)` would **not**
replace the existing 3-arg function — it would create a second, distinct,
live overload, exactly the migration-030 incident this rule exists to
prevent (`CLAUDE.md`'s own "CREATE OR REPLACE FUNCTION only preserves
grants when the argument signature is unchanged" entry). The fix, per that
same rule: an explicit `DROP FUNCTION IF EXISTS public.correct_daily_log
(UUID, TEXT, JSONB)` ahead of the new `CREATE OR REPLACE`, paired with
re-asserting the exact grant shape 019 and 040 both already used
(`REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO
authenticated;`) — never a bare signature-widening `CREATE OR REPLACE`.

**Open, not decided: extend the existing function, or ship a new one
(`correct_daily_log_v2`)?** Extending avoids two RPCs doing overlapping
work forever but requires the DROP+CREATE dance above, done correctly, on a
function every correction in this product goes through. A new function
name sidesteps the grant hazard entirely (no existing signature to
collide with) at the cost of a second RPC name in the codebase doing
almost the same thing — this project has precedent for both patterns
(`quoco_evening_checkin_v3`, `quoco_engineer_optin_v2` on the template
side; `CREATE OR REPLACE` in place everywhere on the SQL side). Not
deciding it here.

### This migration trips the external-review gate; item 1 above does not

Per CLAUDE.md §0: this migration modifies a live `SECURITY DEFINER`
function's logic and signature — condition (a) trips unambiguously,
independent of which of the two options above is chosen. It needs the full
external review package before it applies anywhere.

**By contrast, item 1's regeneration mechanism (reusing `dpr_generate` +
`write_dpr_version`, once Part A ships) needs no new migration at all** —
both the RPC and the tables it touches already exist and were already
reviewed under 029. §0's gate is keyed on migrations; a pure
application-code change that calls only already-reviewed functions doesn't
trip it, though ordinary code review still applies. **Part A itself is the
same story** — the build spec states plainly "No schema change" for it.

---

## 3. Photo race — accepted as narrowed, not closed; recorded, not built

Per instruction, not building the hold-and-recheck logic now. Recorded
plainly: **the 40-45 minute window between generation and owner-send
covers the overwhelming majority of cases**, and DPR-24's existing pattern
is the one to reach for if a real late-photo incident ever justifies
closing this properly:

> *"9 PM delivery holds if `generation_status='running'` OR an unprocessed
> job for that DPR exists in jobs... Hold up to 5 min; if still blocked...
> send committed content + log a Sentry anomaly."* (`docs/bot-flows.md`)

The analogous version for photos: before the owner pass finalizes, check
whether a `media_ingest` job for this engineer's day is still
`pending`/`running`; hold briefly; if still blocked past a short timeout,
send without the late photo and log an anomaly — never block the owner's
report indefinitely on a stalled upload. Not built. This is also the exact
mechanism that would need to exist for the "staleness gate can't see
photos" gap named in §1 to close for real.

---

## 4. Also reported

**Where the owner's regenerated copy is stored** — answered in §1: nowhere
new. `dprs` already carries `current_version`/`generated_by`/
`generated_by_user`; `dpr_versions` already exists as the append-only
history. The owner's regeneration becomes version 2 (or higher) of the
same row, via `write_dpr_version`, once Part A wires that RPC into
`dispatch.ts`. No new table, no new column, contingent entirely on Part A
shipping first.

**Idempotency when nothing changed** — mostly holds, with one named gap.
`assembleEngineerDprFacts` and `deriveHalfCompleteness` take no time
parameter and read no clock — confirmed by their signatures — so identical
underlying data produces identical `facts` regardless of whether the call
happens at 19:45 or 20:25. `renderEmailReport`/`renderEngineerReport`
embed no generation timestamp into their output (grepped — zero hits for
`new Date()`/`toISOString()` in either render file). **The one place this
breaks: the verdict.** If regeneration reuses `dpr_generate`'s pipeline
unmodified, the verdict sentence comes from a fresh Claude call every time,
which is not guaranteed byte-identical even for identical input facts —
see the tension named at the end of §1. "Identical when nothing changed"
holds for every Fact in the report; it does not currently hold, guaranteed,
for the one model-authored sentence, unless the pipeline is changed to
carry the prior verdict forward when nothing changed (itself an open,
un-scoped change to `dispatch.ts`).

**External-review gate** — split findings, not one answer:
- Item 1 (reuse `dpr_generate` + `write_dpr_version` for the owner pass,
  once Part A ships): no new migration, does not trip §0.
- Part A itself (route `dispatch.ts` through `write_dpr_version`): no
  schema change per its own build spec, does not trip §0.
- Item 2 (`correct_daily_log` signature change for the optional comment):
  **trips condition (a)** — modifies a live `SECURITY DEFINER` function's
  logic/signature. Full external review package required before this one
  applies anywhere, regardless of which of the two shapes in §2 is chosen.

---

## Open decisions, collected

1. Literal inline-call shape (a) vs. re-enqueuing `dpr_generate` (recommended) — is the duplication risk of (a) acceptable to whoever weighs it against the async-orchestration cost of the recommendation?
2. Unconditional regeneration every night vs. the already-decided conditional staleness gate — and if conditional is kept, how does it learn to see photos, which have no schema yet?
3. Extend `correct_daily_log`'s signature (DROP+CREATE, re-grant) vs. ship a new function name for the optional comment.
4. Freeze the verdict on regeneration (guarantees byte-identical idempotency, requires a `dispatch.ts` change) vs. reuse the pipeline unmodified (simpler, verdict text can drift even with unchanged facts).
5. Photo-aware hold-and-recheck for the owner pass (DPR-24's pattern) — explicitly not built now, named as the fix if a real late-photo incident ever justifies it.

None of these are resolved by this doc.
