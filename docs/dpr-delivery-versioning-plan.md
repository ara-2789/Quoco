# PLAN ONLY — two-stage DPR delivery and versioning (2026-08-15)

**Status: PLAN ONLY. No implementation. No migration written. No code touched.** This
document is Part 2 of tonight's session (Part 1: MVP schedule freeze + restart semantics,
PR #66; Part 3: outbound send primitive, separate plan doc). Read alongside
`docs/dpr-engineer-report-spec.md` (Aravind's same-day edits, §4/§4b) and
`lib/daily-logs/cutoffs.ts` (`eveningClose` 19:45, `ownerSend` 20:30, FROZEN FOR MVP).

---

## 2a. LOAD-BEARING — the 20:30 owner send is automatic and unconditional

Restated because it constrains everything below, not because it needs justifying further:
**if the PM does nothing between 19:45 and 20:30, the owner receives the report exactly as
generated.** The PM's window is an opportunity, never a gate. Any design in this plan where
the owner-send code path checks "has the PM finished editing" or waits on a PM action is
wrong by construction — the 20:30 cron fires and sends whatever `dprs` currently holds as
its delivered content, full stop. This shapes 2d/2e directly: versioning exists so an edit
made in-window is captured, not so the send can be gated on one existing.

## 2b. The 19:45 PM message and the edit surface — no mobile app, the dashboard already exists

**The 19:45 PM message is a notification with a link, not an editing session.** It fires
from the same trigger as DPR generation (one moment, per `cutoffs.ts`'s `eveningClose`) and
should read, in substance, "tonight's report for [project] is ready — review before 20:30:
[link]." Editing happens entirely on the existing web dashboard
(`app/(dashboard)/dprs/[id]/page.tsx`), which is already responsive and already opens on a
PM's phone via that link. **There is no mobile app to build, and none is scoped here.**

**What exists today** (read in full, not assumed): `getDprDetail` selects `id, log_date,
content, engineer_id, projects(name)` — it does NOT select `structured`, and the page
renders `content` (the pre-rendered string) directly in a `<pre>` block. Zero
interactivity — no client component, no form, no edit affordance, no role check beyond
whatever `dprs_select`'s RLS already enforces at the row level.

**What an edit mode needs on top of this, concretely:**
1. **Select `structured`, not just `content`.** The edit form must be built from
   `dprs.structured.facts` (the actual Fact values: `work.planned`, `work.done_text`,
   `schedule.met`, `manpower.on_site`, etc.) — never from the rendered `content` string.
   Editing rendered text and re-deriving Facts from it would invert the traceability this
   whole design exists to protect (spec's own Rule in 2c, below).
2. **A Client Component island**, not a full client page — the current page is a Server
   Component for good reason (RLS-scoped fetch, no client bundle needed for read-only
   viewing). An `<EditDprForm>` island, hydrated only for viewers whose role permits
   editing (see the role-check gap named below), keeps the read path exactly as fast and
   simple as it is today.
3. **A role check that does not exist yet.** `dprs_select`'s RLS (023) scopes by
   `project_members` membership, not by role — confirmed by reading the policy: any project
   member who can SEE the row today (including, structurally, an `engineer` or `owner` role
   if either ever gained a web login) is not currently distinguished from a `pm`. Correction
   (`correct_daily_log`) is already PM-only at the RPC layer (019's own `IF v_editor_role <>
   'pm'` guard) — the edit UI must gate on the SAME check client-side (to not render an edit
   affordance nobody's allowed to use) but the RPC's own guard remains the real boundary,
   not the UI.
4. **A "submit for regeneration" action**, not autosave-per-field — matches 2c/2d below:
   edits accumulate as `daily_log_edits` (or its equivalent widened mechanism) rows, and a
   single explicit "Regenerate" action is what actually produces a new version, calling the
   same `dpr_generate` job machinery that already exists (`lib/dpr/dispatch.ts`), not a new
   parallel path.
5. **A comment field per edit** — see 2c: no home for this exists in the schema today.

## 2c. PM edits DATA, never report text — checked against the real correctable-column set, not assumed sufficient

**Confirmed by reading `daily_log_edits`'s CHECK constraint and `correct_daily_log`'s own
CASE whitelist (both, migration 019, deliberately double-gated so they must agree) — the
correctable set is 9 SCALAR columns:** `is_holiday`, `holiday_reason`, `weather`,
`morning_plan`, `morning_execution_plan`, `evening_output`, `evening_schedule_met`,
`evening_schedule_miss_reason`, `evening_workers_on_site`. Nothing else. No JSONB column is
correctable at all — v1 was deliberately scalar-only.

**Mapped against the per-engineer report's actual Facts** (`EngineerDprFacts`, `schema.ts`,
cross-checked against `assemble.ts`'s real field sourcing, not the type alone):

| Fact | Sourced from | Correctable today? |
|---|---|---|
| `work.planned` | `morning_plan` | ✅ yes |
| `work.done_text` | `evening_output` | ✅ yes |
| `work.done_quantity` / `unit` | `evening_output_quantities` (JSONB) | ❌ no |
| `schedule.met` | `evening_schedule_met` | ✅ yes |
| `manpower.on_site` | `evening_workers_on_site` | ✅ yes |
| `manpower.planned` | `morning_manpower_planned` (JSONB) | ❌ no |
| `manpower.working` | `evening_productive_manpower.productive_count` (JSONB) | ❌ no |
| `equipment.items[].*` (all fields) | `morning_equipment` + `evening_equipment_utilisation` (both JSONB) | ❌ no |

**This is the finding, stated plainly: `daily_log_edits` and `correct_daily_log` do NOT
carry what §4b needs — they carry less than half of it.** And it's not an abstract gap —
**§4b's own worked example, written today, edits exactly the two fields that are NOT
correctable:** `manpower.working` ("15 working" → "19 working") and `work.done_quantity`
("780 sq m" → "850 sq m"). The spec's own sample cannot be performed by the mechanism that
exists. Either the JSONB-correctable-column gap (already tracked as an open item in
CLAUDE.md's build-status history, pre-dating tonight) gets closed as PART of this
workstream, or §4b's example needs to be rewritten to only demonstrate what's actually
buildable (`work.planned`, `work.done_text`, `schedule.met`, `manpower.on_site`) until it
is. **Not resolved here — named for the next decision.**

**Separately, no comment field exists anywhere in the correction mechanism.**
`daily_log_edits` has `old_value` / `new_value` / `edited_by` / `source` — no `comment` or
`note` column. §4b's sample shows a PM comment attached to every edit
("Two extra masons joined after lunch..."). This needs a new column
(`daily_log_edits.comment TEXT NULL`, most likely) — additive, but still a schema change,
folded into 2d's own migration since both touch the same review-gated territory.

**`last_regenerated_at`** — the column exists on `dprs` (023) but is written by **nothing**
anywhere in the current codebase (grepped `lib/`, `app/`, `scripts/` — zero writers). It's
exactly the kind of column this project's own §0 history warns about: present, typed, and
silently never populated. The regeneration flow this plan proposes is what would finally
give it a real writer.

## 2d. Versioning — recommendation reviewed, not reflexively accepted; I agree with it

**The reviewer's recommendation (do NOT widen migration 028's `UNIQUE(project_id,
engineer_id, log_date)` to include version; keep `dprs` as one current-version row per
engineer-day, add an append-only history table instead) — evaluated on its own merits, not
rubber-stamped. I agree with it, for three independent reasons, not one:**

1. **Every existing `dprs` reader assumes one row per engineer-day.** The claim/final
   upserts in `dispatch.ts` both target `onConflict: 'project_id,engineer_id,log_date'`;
   both dashboard pages `.select()` without an explicit version filter. Widening the key to
   include version would make every one of those a latent multi-row bug — the identical
   failure class 028's own B2 inventory caught and fixed (a widened key silently breaking
   call sites built for the narrower one), reintroduced deliberately if this path is taken.
2. **This exact constraint was migrated yesterday**, went through a full external-review
   cycle, and was applied under real production pressure (the merge/deploy incident, §20 of
   the 028 package). Re-touching it again immediately for an unrelated reason (versioning,
   not the engineer-id reformat) costs a second full apply-gate cycle for something the
   alternative design avoids needing at all.
3. **An append-only history table is the more honest shape for what's being modeled** — a
   generation event log, not a second dimension of the primary key. This project already
   has the identical pattern one migration away: `daily_log_edits` is exactly this shape
   relative to `daily_logs` (current values in the row, every correction as an append-only
   audit entry). Versioning `dprs` the same way is consistent with, not a new pattern
   alongside, what's already built.

**Concrete shape, sketched (not final SQL, not written to a migration file):**

```
dprs (existing table, minimal additions):
  + current_version   INT NOT NULL DEFAULT 1
  + generated_by       TEXT CHECK (generated_by IN ('system','pm'))  -- who produced the CURRENT version
  + generated_by_user  UUID NULL REFERENCES users(id)                -- set only when generated_by = 'pm'
  (delivered_owner_at, generated_at, last_regenerated_at: existing columns, finally get real writers)

dpr_versions (NEW, append-only):
  id                    UUID PK DEFAULT gen_random_uuid()
  dpr_id                UUID NOT NULL REFERENCES dprs(id) ON DELETE CASCADE
  version               INT NOT NULL
  generated_by          TEXT NOT NULL CHECK (generated_by IN ('system','pm'))
  generated_by_user     UUID NULL REFERENCES users(id)
  content               TEXT NOT NULL
  structured            JSONB NOT NULL
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  delivered_to_owner_at TIMESTAMPTZ NULL   -- set on EXACTLY the one version actually sent at 20:30
  UNIQUE (dpr_id, version)
```

`dprs.current_version` + `dprs.content`/`dprs.structured` stay a denormalized "latest"
projection (fast reads for the dashboard list/detail pages, unchanged query shape) while
`dpr_versions` is the source of truth for history. "Which version was delivered to the
owner" is answered by whichever `dpr_versions` row has `delivered_to_owner_at` set — set
once, at 20:30, by the owner-send job, pointed at whatever `dprs.current_version` was at
that exact moment.

**This touches the schema — it goes through the same review path 028 went through**, per
direct instruction. Not written as a migration file in this pass. `daily_log_edits`'s new
`comment` column (2c) rides in the same migration, since both are part of the same
delivery-versioning feature and both need the same review pass regardless of being split
or combined.

## 2e. `delivery_status` cannot express the two-stage state — proposed states

Current CHECK (023): `pending / delivered / paused / skipped_no_data / failed`. None of
these distinguish "PM has been notified, owner has not" from either endpoint. **Proposed,
additive (existing values kept, meanings tightened where the two-stage flow requires it):**

- `pending` — unchanged: no delivery action taken yet (should be near-instantaneous now,
  since PM-notify fires atomically with generation at `eveningClose`).
- **`pm_notified`** *(NEW)* — the PM has been sent the 19:45 notification+link; this is the
  state for the entire 19:45→20:30 window, edited or not.
- `delivered` — re-scoped, not renamed: now specifically means "delivered to the **owner**"
  (the terminal success state), set at or after `ownerSend` (20:30).
- `failed` — unchanged, NFR-17 dead-letter. Deliberately NOT split into
  `pm_notify_failed`/`owner_send_failed` sub-states — which stage failed is Sentry/log
  context (`extra: {stage: 'pm_notify' | 'owner_send'}`), not a new CHECK value; keeps the
  state machine small and matches this project's existing preference (`generation_status`/
  `delivery_status` are already kept orthogonal and minimal rather than cross-producted).
- `paused` — unchanged, out of scope for this plan (whatever its existing semantics are).
- `skipped_no_data` — kept for the record, likely DEAD going forward under the per-engineer
  pipeline (its only writer was the old project-level trigger; Q8's zero-roster case
  writes no row at all instead) — same "leave retained-but-unused logic in place" pattern
  `archive-status.ts` already uses for this exact status value. Not removed.

## 2f. PM escalation persistence — confirmed sufficient, no schema change needed

**Checked, not assumed.** `checkin_escalations` (migration 027) already models this
correctly for the purpose named in 1a: `status` (`awaited/nudged/escalated/submitted/
not_submitted`) is a real column on a real row that **persists** until an explicit
transition — there is no ephemeral notification, no expiring flag, nothing that needs a
cron to "re-show" it. `determineTargetStatus` (checked against the live logic, not assumed)
computes the target fresh from wall-clock time on every sweep invocation and converges to
the correct state regardless of how many checkpoints were missed — exactly "persistent
until submit or cutoff," already built, already correct for the frozen 10:30-appears/
15:00-closes schedule (§1a). **No schema change needed. Not stopping here — confirmed
sufficient as designed.**

---

## Summary of what this plan requires before it can ship

1. Decide §4b's example vs. widening `correct_daily_log`'s column set (2c) — these are not
   independent; the example can't ship as written without the widening, or needs rewriting.
2. A migration (2d + 2c's `comment` column) — full external-review path, same as 028.
3. `delivery_status`'s CHECK widened by one value (2e) — folds into the same migration.
4. The dashboard edit surface (2b) — new Client Component, role-gated, built against
   `structured`, not `content`.
5. A "regenerate" action wired to the existing `dpr_generate` job machinery, now versioned.

None of this is built in this pass. Branch/PR for this document only — no code.
