# `lib/whatsapp/outbound/*.ts` — untyped Supabase client, on a live path (2026-08-31)

Small, standalone finding. **Not fixed in this pass** — recorded for
whoever next touches these files. Surfaced as a side effect of
`docs/reviews/types-regen-post-034.md`'s sweep for hand-written shapes the
regen might cover, but it is a pre-existing gap, unrelated to that regen,
and would exist identically whether or not `types/database.ts` had ever
gone stale.

## The gap

Five files declare their Supabase client parameter as bare `SupabaseClient`
(from `@supabase/supabase-js`), never `SupabaseClient<Database>`:

- `lib/whatsapp/outbound/checkpoint-trigger.ts:156,220`
- `lib/whatsapp/outbound/roster.ts:148,196,249,290`
- `lib/whatsapp/outbound/coverage-sweep.ts:112,128,143,175,192,202`
- `lib/whatsapp/outbound/trigger.ts:117`
- `app/api/whatsapp/status-callback/route.ts:50`

All five hold real `.from('outbound_sends')` calls
(`.insert`/`.update`/`.select`) — this is the outbound-send primitive
itself (migration 031, item B/D, PR #120/#126), a **live path**, not
scaffolding or a not-yet-wired feature. Every query against
`outbound_sends` in these files is checked by TypeScript against nothing
more specific than the untyped default the `supabase-js` package falls
back to. Generated types for this exact table have existed since
migration 031 shipped and `types/database.ts` was regenerated to include
it (confirmed again, unchanged, by this week's regen) — they are simply
never consulted from here.

Consequence, concretely: a query built against a wrong column name, a
wrong nullability assumption, or a value outside `outbound_sends.status`'s
CHECK set would compile clean in any of these five files today. The same
class of thing `lib/daily-logs/query.ts`'s `DetailRow` cast is at least
*visibly* asserting (and was verified correct, per the regen record) is,
here, not asserted at all — there's no cast to even audit, because
nothing is being checked in the first place.

## What it would take to close

1. Add `import type { Database } from '@/types/database'` to each of the
   five files (matching the convention already used in `lib/supabase/
   server.ts` and `lib/daily-logs/query.ts`).
2. Change every `SupabaseClient` annotation listed above to
   `SupabaseClient<Database>`.
3. Run `npx tsc --noEmit` and **expect it to surface real errors**, not
   just pass — that's the point of doing this, not a sign something went
   wrong. Five files' worth of previously-unchecked `.insert()`/
   `.update()`/`.select()` calls against `outbound_sends`, `daily_logs`,
   `whatsapp_sessions`, and whatever else these files touch will be
   checked against the real schema for the first time; any of them could
   turn out to assume a field or shape that doesn't match. Budget time to
   fix whatever surfaces — this is not a one-line signature change with
   no further consequence, the same way the `types/database.ts` regen
   itself surfaced nothing only *because* it was checked, not by default.
4. Re-verify against production behavior (or at minimum test-db, per this
   project's own concurrency/CI-only caveats for anything genuinely
   concurrent — `docs/reviews/sandbox-cannot-test-concurrency.md`) after
   the fix, since this path is exercised twice daily by the trigger crons
   (`CLAUDE.md` §3) and any real mismatch this uncovers would be fixing a
   live, currently-silent risk, not a hypothetical one.

Not started here. This record exists so the next person opening any of
these five files sees the gap named, with a concrete first step, rather
than rediscovering it the way this session rediscovered `types/
database.ts`'s own staleness.
