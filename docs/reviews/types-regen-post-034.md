# `types/database.ts` regeneration — post-034 (2026-08-31)

Regenerates `types/database.ts` from production, which now includes
migrations 029 (`dpr_versions`, `dprs.current_version`/`generated_by`/
`generated_by_user`), 031 (`outbound_sends`), 033 (`sweep_stale_morning_
sessions`, `quoco_classify_yes_no`), and 034 (`owner_email_verifications`,
`users.notification_email`/`notification_email_verified_at`/`whatsapp_
declined_at`) — none of which the file previously reflected.

## Why this was needed — root cause, not just "the file was old"

`types/database.ts`'s last real change was commit `d305e4c` (2026-08-25,
the original migration-030 morning-flow PR). That commit did **not** run
`supabase gen types` — it **hand-edited** two fields (renamed
`morning_manpower_planned` → `morning_manpower`, added `attendance`)
directly into the file. This was a deliberate, reasoned choice at the
time: migration 030 was explicitly "NOT APPLIED to test-db or prod" at
that commit (per its own PR body), so there was nothing live to
regenerate against — approximating the two fields the in-flight PR
needed was the only way to keep that PR's own diff type-checking without
inventing a third, disconnected source of truth.

**That hand-edit is exactly why the staleness went unnoticed for six days
and three further migrations (031, 032/033, 034).** A generated file that
gets hand-edited stops looking generated — it stops being a trustworthy
signal of "run `gen types` and see a diff, or don't." Once one hand-edit
landed cleanly with no visible problem, there was nothing left in the
file itself to distinguish "this reflects prod" from "this reflects what
someone typed by hand two weeks ago." The gap was only found because
PR #137's own body flagged it directly (a second hand-edit, this time
explicit and disclosed rather than silent) and a direct question — asked
before marking that PR ready — forced tracing the file's actual git
history rather than trusting its presence.

**The rule that follows, stated plainly:** `types/database.ts` is
generated output. It must never be hand-edited, under any circumstance —
including "just this one field, just until the real migration lands."
If a migration is not yet applied anywhere, the correct move is to leave
the types file alone (accept that the in-flight code touching the new
column needs a local, explicitly-named, explicitly-commented cast or
type override of its own — as `lib/daily-logs/query.ts`'s `DetailRow`
correctly did for `attendance_defaulted`/`attendance_raw`) and regenerate
*after* the apply, once there is a real schema to generate against. A
locally-scoped, visibly-a-workaround cast in the one file that needs it
is recoverable and self-documenting; a hand-edit inside the generated
file itself is indistinguishable from the real thing and silently rots.

## Regen, executed

Breadcrumb-then-relink discipline followed: project ref printed
immediately before the command, re-linked to test-db immediately after.

1. `supabase link --project-ref jvxwqignooseazzmwhvl` → breadcrumb probe
   (`SELECT current_database(), now()`) confirmed live against production.
2. `npx supabase gen types typescript --linked --schema public` → redirected
   straight to a scratch file (2215 lines), never printed raw.
3. `types/database.ts` replaced **wholesale** with the generated output —
   no hand-editing, no partial merge.
4. `supabase link --project-ref exfccwlrhoutkgrlikod` — re-linked to
   test-db immediately after, confirmed via the project-ref file.

## Diff against the previous file — purely additive

`diff` against the pre-regen file: **0 lines removed or changed, 222
lines added.** Every field present before this regen is still present,
unchanged, in the new file — nothing was renamed, retyped, or dropped
for any column that existed in the old file. The additions are exactly
the migrations named above:

- `daily_log_edits.comment` (029)
- `daily_logs.attendance_defaulted: boolean | null`, `attendance_raw: string | null` (030)
- `dpr_versions` table, full Row/Insert/Update/Relationships (029)
- `dprs.current_version`, `generated_by`, `generated_by_user` + new FK (029)
- `outbound_sends` table, full Row/Insert/Update/Relationships (031)
- `owner_email_verifications` table, full Row/Insert/Update/Relationships (034)
- `users.notification_email`, `notification_email_verified_at`, `whatsapp_declined_at` (034)
- Functions: `quoco_classify_yes_no`, `sweep_stale_morning_sessions` (033), `write_dpr_version` (029)

One nuance confirmed directly, not assumed: `dprs.delivery_status` remains
typed as plain `string` after the regen, unchanged by migration 034's
5→11 value widening. Supabase's generator does not turn a CHECK-
constrained TEXT column into a literal union — a CHECK constraint isn't
introspectable as an enum the way a real Postgres `ENUM` type is. The
widening therefore never showed up as a type diff, correctly.

## `lib/daily-logs/query.ts`'s hand-written `DetailRow` — now redundant, not removed here

`DetailRow` (`lib/daily-logs/query.ts:215-224`) declares
`attendance_defaulted: boolean | null` and `attendance_raw: string | null`
by hand, cast in at line 257 via `rowData as unknown as DetailRow` — the
same pattern this record's own root-cause section names as the
recoverable, correct way to handle a not-yet-regenerated field (as
opposed to hand-editing the generated file itself).

**Confirmed field-for-field against the freshly regenerated
`Database['public']['Tables']['daily_logs']['Row']`: every field
`DetailRow` declares (`id`, `project_id`, `engineer_id`, `log_date`,
`morning_submitted_at`, `evening_submitted_at`, `attendance_defaulted`,
`attendance_raw`) now has an exact match, same name, same type, in the
generated type.** `DetailRow` is now fully redundant with (a `Pick` of)
the generated `daily_logs` Row type, and the `as unknown as` cast at line
257 could become a real, checked assertion instead of an unchecked one.
**Not changed in this PR**, per instruction — this section states the
finding for a follow-up to act on.

No other hand-written shape elsewhere in the codebase was found to
overlap with what this regen added. Checked specifically:
- `lib/dpr/*.ts` — zero references to `dpr_versions`, `current_version`,
  or `generated_by_user` anywhere. The versioning RPC (`write_dpr_version`,
  migration 029) has no application-code caller yet.
- `owner_email_verifications` / `notification_email` /
  `whatsapp_declined_at` — zero references in `lib/` or `app/`. Expected:
  the owner-delivery handler these support has not been built yet.
- `lib/whatsapp/outbound/*.ts` and `app/api/whatsapp/status-callback/
  route.ts` (031's `outbound_sends`, already built and live) — these
  files type their Supabase client as bare `SupabaseClient`, never
  `SupabaseClient<Database>`. The regen has no effect on them either way;
  `.from('outbound_sends')` was never checked against the generated
  schema before this regen and still isn't after it. Not a redundancy —
  a pre-existing, unrelated gap in typed-client adoption, out of this
  record's scope.

## What the regen revealed that was silently wrong — nothing, stated plainly

This is the actual point of the exercise, so it gets a direct answer
rather than a buried one: **nothing.** The diff against the previous file
is purely additive (0 removed/changed lines, confirmed above), and the
one real dependency in the codebase on a not-yet-regenerated field
(`DetailRow`'s `attendance_defaulted`/`attendance_raw`, in `lib/daily-
logs/query.ts`) turned out to be typed exactly correctly — verified
independently against `030_morning_flow_attendance.sql:163-164`'s actual
DDL (`BOOLEAN`, `TEXT`) before this regen ran, and now confirmed a second
way by the generated output matching it exactly. `npx tsc --noEmit`
against the new file: **clean, 0 errors.**

Worth stating the limit of that clean result rather than overstating it:
`tsc` passing does not prove every `as unknown as` cast in the codebase
is correct — a cast bypasses checking by design, so a genuinely wrong
one would compile clean either way. What this record can actually claim
is narrower and real: the one cast this investigation traced end-to-end
(`DetailRow`) is independently confirmed correct against the live DDL,
and no field that existed in the previous generated file changed shape
in a way that could newly break anything depending on it.
