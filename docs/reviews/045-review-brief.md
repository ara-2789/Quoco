# Migration 045 review brief — claim_media_nudge (stage 3 idle-photo nudge)

**Status: HELD. Not applied to any database — not test-db, not prod.** This
round's own instruction was explicit: no apply anywhere. This brief exists so
Aravind (or any external reviewer) has everything needed to review
`docs/reviews/045_media_nudge_throttle.sql` before any apply is even
proposed. Written for a reader who was not in the building session — every
claim below is either a pasted command transcript or a citation to a specific
file/line, per this project's own "artifact provenance is pinned, not
paraphrased" standing rule (CLAUDE.md §0).

**Repo-state header** (per CLAUDE.md §0's "review requests at this tier open
with a repo-state header" rule):
- Branch: `feat/stage3-media-nudge`, created from `origin/main` at `fbced4b`
  (`fix(hindrance): Q3 photo question is now answerable by photos (#277)`).
- `supabase migration list` was not run against any linked project — this
  environment has no Supabase credentials (no `.env.local`, no `.env.test`,
  no `supabase/.temp/project-ref`). Highest migration file on
  `origin/main`/this branch: `044_hindrance_photos.sql`. Highest reservation
  in `scripts/migration-number-reservations.json`, checked against every
  sibling `.claude/worktrees/*/` on this machine: `044` (this worktree
  itself). `045` reserved by this round — see that file's own new entry.
- Last runbook executed against a real database: none, this round. The last
  real apply anywhere is migration 044 to prod, 2026-09-15 (per that
  migration's own reservation-file entry and `docs/reviews/044-apply-record.md`).

---

## 1. What the function does

`claim_media_nudge(p_phone_number, p_tenant_id, p_user_id, p_now,
p_window_seconds) RETURNS boolean` — a per-phone-number burst throttle for
the new idle-photo nudge (stage 3). Returns `true` the first time it's called
for a phone number, or the first time again after `p_window_seconds` has
elapsed since the last `true`; `false` for every call inside that window.

Callers: `lib/whatsapp/inbound-start.ts`'s `handleIdlePhoto`, via the
`claimMediaNudge` wrapper in `lib/whatsapp/session.ts`. Reached only when
`params.isPhoto` is true and no flow is active (`readCurrentFlow` returned
`null`) — see `routeInboundMessage`'s idle branch.

**Row lock**: identical acquire pattern to `acquire_and_transition_session`
(`012_whatsapp_session_transition.sql:99-105`) and `apply_hindrance_flow_turn`
(`044_hindrance_photos.sql:441-447`) — `INSERT ... ON CONFLICT (phone_number)
DO UPDATE SET phone_number = s.phone_number RETURNING * INTO v_session`. The
`DO UPDATE` is the same deliberate no-op those two functions use: it exists
only to take the row lock and return current values, whether the row already
existed or this exact statement just created it. This is what makes 5
concurrent photos from one phone number resolve to exactly one `true` (§4
below) — the same mechanism this project already trusts for
`acquire_and_transition_session`.

**Write**: exactly one context key, merge-only (`context || jsonb_build_object('last_media_nudge_at', p_now)`)
— every other key already in context is left byte-identical. No write to
`current_flow`, `current_step`, `pending_flows`, or `expires_at` on an
existing row. See §2 for `updated_at`.

**Deviation from the illustrative signature named in the build instruction**
(`claim_media_nudge(p_phone_number text, p_now timestamptz, p_window_seconds
int)` — three arguments, no tenant/user identity): that signature cannot be
used as given. `whatsapp_sessions.tenant_id` is `NOT NULL`
(`001_core_schema.sql:89`) with no default, and the acquire step's own
`INSERT` materialises the row on a phone number's genuinely first-ever
inbound message — nothing upstream of `routeInboundMessage`'s idle branch
ever pre-creates a `whatsapp_sessions` row (`readCurrentFlow`,
`session.ts:44-66`, is an unlocked `SELECT`, never an `INSERT`), so "first
message this phone has ever sent is an idle photo" is a real, reachable
case, not contrived. `p_tenant_id` (required, mirroring `012`/`044`'s own
`p_tenant_id`) and `p_user_id` (nullable, `DEFAULT NULL`, mirroring
`012`/`044`'s own `p_user_id`) were added so the acquire step can
materialise a genuinely first-ever row exactly like every other flow RPC
already does. Flagged here rather than silently changed, per CLAUDE.md's own
"a document submitted for external review is audited for asserted-but-
nonexistent artifacts" discipline — this is a deviation from what was asked
for verbatim, not a hidden one.

## 2. The `updated_at` constraint, and why it's critical

`whatsapp_sessions.updated_at` is what `quoco_same_ist_day(p_now, updated_at)`
reads, in every flow RPC (`acquire_and_transition_session`,
`012:115`; `apply_hindrance_flow_turn`, `044:454`), to decide whether the
NEXT call for that phone number is a same-day resume or a fresh-day reset
(wiping `current_flow`/`current_step`/`context`/`pending_flows`). If
`claim_media_nudge` bumped `updated_at` on every idle photo, an idle session
sitting near a day boundary would look freshly-active to that check — the
cross-day reset would silently stop firing for any phone number that
happens to receive an off-step photo close to midnight IST, and stale
`current_step`/`context` from the PREVIOUS day could leak into what should
have been a fresh start.

**Checked before writing anything**, per this round's own instruction: is
there an `updated_at`-maintaining trigger anywhere in this project that
could touch this regardless of what the function itself does? Searched every
migration:

```
$ grep -n "CREATE TRIGGER" supabase/migrations/*.sql
supabase/migrations/005_auth_trigger.sql:51:CREATE TRIGGER on_auth_user_created
supabase/migrations/007_auth_surgery.sql:167:CREATE TRIGGER on_auth_user_created
```

Both are `on_auth_user_created`, on `auth.users` — nothing on
`whatsapp_sessions`, nothing generic. The project's own explicit statement,
found in a table comment written for exactly this reason
(`027_checkin_escalations.sql:284-292`, `COMMENT ON COLUMN
public.checkin_escalations.updated_at`):

> "NOT trigger-maintained — no trigger exists anywhere in this project for
> any updated_at column (checked: grepped every migration; the house pattern
> is explicit setting at every write site, e.g. whatsapp_sessions.updated_at,
> labelled 'SESSION WRITE — ALWAYS' at each RPC call site that touches it)."

**Consequence for this function's own design**: `claim_media_nudge`'s single
`UPDATE` statement writes only `context` — no `updated_at`, no
`expires_at`, no `current_flow`/`current_step`/`pending_flows`. The ONE
place `updated_at` is written at all is the acquire `INSERT`'s own `VALUES`
clause (`p_now`), which fires only when the row does not yet exist — that is
the row's true creation moment, not a "change" to an existing row, exactly
matching what `012`/`044`'s own first-ever-`INSERT` already does.

Verified directly (not just by design) — see §4 below: a pre-existing row's
`updated_at` was seeded far in the past and confirmed unchanged across THREE
calls (a claim, a throttled call, and a claim again after the window).

## 3. Grants

```sql
REVOKE EXECUTE ON FUNCTION public.claim_media_nudge(
  text, uuid, uuid, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_nudge(
  text, uuid, uuid, timestamptz, integer
) TO service_role;
```

Matches `apply_hindrance_flow_turn`'s own convention exactly
(`044_hindrance_photos.sql:650-655`) — explicit per-role `REVOKE`, not a bare
`FROM PUBLIC` (Supabase's own default ACL grants `EXECUTE` to `anon`,
`authenticated`, AND `service_role` individually, per-role, not through the
`PUBLIC` pseudo-role — this is the exact gap migration 020 found once and
029 (`write_dpr_version`) re-introduced once; see CLAUDE.md §6's "EVERY NEW
FUNCTION IN THE public SCHEMA REQUIRES AN EXPLICIT PER-ROLE REVOKE" rule).
`SECURITY DEFINER` + `SET search_path = public` also match `044`'s
convention exactly.

**Not yet verified live** (no database this function has ever been applied
to exists) — the standard `has_function_privilege` catalog readback plus a
real anon-key call confirming `42501` (per CLAUDE.md's own "STANDARD
EVIDENCE SHAPE" for a new `SECURITY DEFINER` function) is owed at apply
time, same as every other function this project has shipped.

## 4. Verification performed this round

**No credentials exist in this environment** for any Supabase project (no
`.env.local`, no `.env.test`) — the same gap named in migrations 042/043's
own reservation entries. `supabase db dump --linked` is therefore not
possible. Two consequences, both handled the way CLAUDE.md's own rules
anticipate rather than skipped silently:

### 4a. Disposable local Postgres, schema built by REPLAYING THE REAL migration history (not hand-built)

CLAUDE.md §7's own dry-run rule requires the scaffold come from a real
structural dump, specifically because a hand-built scaffold can only ever
agree with the file being tested. With no `supabase db dump --linked`
available, the next-best real-schema source was used instead: every actual
committed migration file, `001` through `044`, replayed in order against a
fresh local Postgres 17.11 (Homebrew) — matching the server's own major
version (prod/test-db run 17.6, confirmed live in a prior round's own
transcript, cited in CLAUDE.md §7's `POSTGRES VERSION MUST MATCH THE SERVER`
entry). This is the real DDL history that produced prod's schema, not a
guess at what it should contain.

Named stubs, per CLAUDE.md §7's own list, plus one addition:
```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN CREATEROLE;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid $$ LANGUAGE sql STABLE;
-- ADDITIONAL, beyond CLAUDE.md §7's original two named stubs -- needed only
-- because this replay goes through migration 042 (storage_bucket_setup) to
-- reach the real pre-045 schema. Named explicitly per that rule's own
-- instruction to extend the stub list when a new platform schema comes up:
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
```

Replay, all 44 files, `ON_ERROR_STOP=1`, one at a time:
```
=== supabase/migrations/001_core_schema.sql ===
...
=== supabase/migrations/044_hindrance_photos.sql ===
BEGIN
ALTER TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
COMMENT
ALTER TABLE
CREATE POLICY
REVOKE
GRANT
GRANT
CREATE FUNCTION
REVOKE
GRANT
COMMIT
ALL MIGRATIONS APPLIED OK
```
Exit 0. Zero `ERROR` lines across all 44 files (first pass caught one real
gap — `storage.buckets` missing — fixed by the additional stub above, then
a clean re-run from a fresh database).

### 4b. Migration 045 itself, applied against that real schema

```
$ psql ... -f docs/reviews/045_media_nudge_throttle.sql
BEGIN
CREATE FUNCTION
REVOKE
GRANT
COMMIT
```
Exit 0.

### 4c. Functional tests, against the real schema, real function

Setup: a tenant, an `auth.users` + `users` row, and a PRE-EXISTING idle
`whatsapp_sessions` row seeded with a known `updated_at`
(`2026-09-01T00:00:00Z`) and an unrelated context key
(`{"other_key": "should_survive"}`), so the tests can prove both
preservation properties directly rather than inferring them.

```sql
-- T1: pre-existing row, before any claim
 phone_number |             context             |        updated_at
--------------+---------------------------------+---------------------------
 +19995550001 | {"other_key": "should_survive"} | 2026-09-01 05:30:00+05:30

-- T2: first claim -> expect true
 claimed
---------
 t

-- T3: other_key survives, updated_at UNCHANGED, last_media_nudge_at set
                                       context                                       |        updated_at
-------------------------------------------------------------------------------------+---------------------------
 {"other_key": "should_survive", "last_media_nudge_at": "2026-09-15T15:30:00+05:30"} | 2026-09-01 05:30:00+05:30

-- T4: second claim 60s later (within 300s window) -> expect false
 claimed
---------
 f

-- T5: state after throttled call -- identical to T3
                                       context                                       |        updated_at
-------------------------------------------------------------------------------------+---------------------------
 {"other_key": "should_survive", "last_media_nudge_at": "2026-09-15T15:30:00+05:30"} | 2026-09-01 05:30:00+05:30

-- T6: third claim 301s after the first -> expect true again
 claimed
---------
 t

-- T7: other_key STILL survives, updated_at STILL unchanged, last_media_nudge_at advanced
                                       context                                       |        updated_at
-------------------------------------------------------------------------------------+---------------------------
 {"other_key": "should_survive", "last_media_nudge_at": "2026-09-15T15:35:01+05:30"} | 2026-09-01 05:30:00+05:30

-- T8: malformed timestamp in context -- must be treated as absent
UPDATE 1
                                    context
--------------------------------------------------------------------------------
 {"other_key": "should_survive", "last_media_nudge_at": "not-a-real-timestamp"}

 claimed_after_malformed
-------------------------
 t

                                       context                                       |        updated_at
-------------------------------------------------------------------------------------+---------------------------
 {"other_key": "should_survive", "last_media_nudge_at": "2026-09-15T16:30:00+05:30"} | 2026-09-01 05:30:00+05:30

-- T9: genuinely first-ever phone number (no pre-existing row) -- INSERT path
 claimed_new_phone
-------------------
 t

 phone_number |              tenant_id               | user_id | current_flow | current_step |                       context                        |        updated_at         |        expires_at
--------------+--------------------------------------+---------+--------------+--------------+------------------------------------------------------+---------------------------+---------------------------
 +19995550099 | 00000000-0000-0000-0000-000000000001 |         |              |            0 | {"last_media_nudge_at": "2026-09-15T17:30:00+05:30"} | 2026-09-15 17:30:00+05:30 | 2026-09-15 18:00:00+05:30
```

All nine assertions hold: `other_key` survives every single call (T3, T5,
T7, T8); `updated_at` never moves across a claim, a throttled call, or a
second claim after the window (T3=T5=T7=T8, all `2026-09-01 05:30:00+05:30`,
the seeded value); a malformed `last_media_nudge_at` string is treated as
absent (T8 claims `true`); a genuinely first-ever phone number materialises
correctly via the `INSERT` path, with `tenant_id` populated and `user_id`
correctly `NULL` (T9).

### 4d. Concurrency — 5 genuinely concurrent OS processes, local Postgres

Not the Supabase JS-client/`Promise.all` shape (`test/media-nudge-
throttle.test.ts`'s own concurrency test uses that shape for consistency
with the rest of this suite, but per CLAUDE.md's own standing rule
`docs/reviews/sandbox-cannot-test-concurrency.md`, a LOCAL run of THAT shape
is not evidence — this sandbox has been shown, directly, to dispatch
"concurrent" JS-client RPC calls serially). Instead: 5 separate `psql`
processes, launched together via shell backgrounding (`&`) against the same
local Postgres, each calling `claim_media_nudge` for a phone number that has
never been seen before (the hardest case — concurrent first-`INSERT` race
AND concurrent throttle check, together):

```
--- individual results ---
call_1: f
call_2: f
call_3: f
call_4: t
call_5: f
--- count of true ---
       1
--- count of false ---
       4
```

Repeated on 3 more fresh phone numbers for confidence against a scheduling
fluke:
```
=== phone +19995550078 === true=1 false=4
=== phone +19995550079 === true=1 false=4
=== phone +19995550080 === true=1 false=4
```

4 for 4: exactly one `true` every time. This is genuine evidence the row
lock serializes concurrent callers correctly AT THE POSTGRES LEVEL — it is
NOT evidence about Supabase's own PostgREST/JS-client dispatch path in
production, which is a separate question this sandbox has been shown before
not to be able to answer (same standing-rule document). The vitest
concurrency test (`test/media-nudge-throttle.test.ts`, described below)
still needs to run in CI, against real test-db, once 045 is applied there.

## 5. Fail-open choice (app-side, `lib/whatsapp/inbound-start.ts`'s `handleIdlePhoto`)

If `claimMediaNudge` throws (a Postgres or network error surfaced through the
`.rpc()` call), the error is logged to Sentry
(`fingerprint: ['media-nudge-throttle', 'claim_media_nudge_failed']`, same
shape as `applyHindranceFlowTurn`'s own existing Sentry call,
`lib/whatsapp/flows/hindrance.ts:245-252`) and the function falls back to
sending the SAME nudge+progress+menu reply the `true` case sends — never to
silence. Rationale, stated in code (`inbound-start.ts`'s own
`handleIdlePhoto` doc comment): an engineer who gets one extra nudge message
he didn't strictly need is a minor annoyance; an engineer who gets no reply
at all because the throttle check happened to fail looks, from his side,
identical to a broken bot. Silence is the worse failure mode, so a
throttle-check failure always resolves to "speak."

## 6. Tests written this round, and what actually ran

**Nothing ran via `npm test`/`vitest run` this round — for ANY test file,
unit or integration.** This project's own vitest `globalSetup` guard
(`test/setup/guard.ts`) hard-aborts the entire run, before any test file
even loads, the moment `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`/
`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_PROJECT_REF` are missing or
malformed:
```
Error: [guard] ABORT: .env.test is missing SUPABASE_TEST_URL,
SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ANON_KEY, or
SUPABASE_TEST_PROJECT_REF. Refusing to run.
```
This environment has no `.env.test` at all. This is a HARDER limit than
"the DB tests can't run" — it means even the pure-logic unit test additions
(`test/unit/media-reply.test.ts`) could not be executed, confirmed directly
above. What DID run: `npx tsc --noEmit` (clean, zero errors, after every
code and test change in this round) and `npx eslint` on every changed file
(0 errors, one pre-existing unrelated warning). Neither is a substitute for
the test suite actually running; both are reported as exactly what they are.

Files, and their real status:
- `test/unit/media-reply.test.ts` — copy-constant assertions
  (`MEDIA_NUDGE_REPLY`, `MEDIA_NUDGE_PROGRESS_LINE` including the "not
  during your evening check-in" negative assertion, `MEDIA_NUDGE_WINDOW_
  SECONDS`). Pure logic, no DB — WRITTEN, NOT RUN (guard blocks the whole
  process before this file's own describe blocks matter).
- `test/inbound-start.test.ts`, new `describe('routeInboundMessage — idle
  photo nudge (stage 3, migration 045)')` block — first photo → nudge+menu +
  session materialised; second within window → empty reply; third after
  window → nudge again; photo captioned "1" → nudge, no hindrance flow.
  Uses this file's own `now`-injection convention (`baseParams`), so the
  throttle window is deterministic once it can run. WRITTEN, NOT RUN — same
  guard, plus `claim_media_nudge` does not exist on test-db until 045 is
  applied there.
- `test/webhook.test.ts`, T-WH-14 rewritten — real end-to-end HTTP path has
  no `now`-injection point (matches production), so only the fixed
  nudge+progress-line prefix is asserted exactly; the trailing live-menu
  text is real-time-dependent and deliberately not pinned here. Also
  asserts a session row IS now created (reversing the pre-stage-3 assertion
  that none was). WRITTEN, NOT RUN.
- `test/media-nudge-throttle.test.ts` (new file) — direct RPC tests:
  first-claim materialises a row; second-within-window returns false;
  third-after-window returns true; other context keys survive; `updated_at`
  never changes across three calls on a pre-seeded row; a malformed
  timestamp is treated as absent; and the 5-concurrent-calls test named in
  this round's own instruction (`Promise.all` over `testClient().rpc(...)`,
  explicitly commented as NOT verified locally per CLAUDE.md's standing
  concurrency-sandbox rule, with the real local-Postgres/raw-psql evidence
  from §4d cited instead). WRITTEN, NOT RUN.

## 7. Files touched this round

- `docs/reviews/045_media_nudge_throttle.sql` (new, HELD)
- `scripts/migration-number-reservations.json` (045 reserved)
- `lib/whatsapp/media-reply.ts` (`PHOTO_REPLY` removed; `MEDIA_NUDGE_REPLY`,
  `MEDIA_NUDGE_PROGRESS_LINE`, `MEDIA_NUDGE_WINDOW_SECONDS` added;
  `replyForMediaKind` narrowed to `'voice'` only)
- `lib/whatsapp/session.ts` (`claimMediaNudge` wrapper added)
- `lib/whatsapp/inbound-start.ts` (`resolveIdleHeaderState` extracted,
  `buildIdleMenu` extracted from `buildIdleReply`, `handleIdlePhoto` added,
  idle photo branch rewritten to call it)
- `test/unit/media-reply.test.ts`, `test/inbound-start.test.ts`,
  `test/webhook.test.ts` (updated), `test/media-nudge-throttle.test.ts` (new)
- `docs/plans/media-capture-design.md` (stage 3 decisions appended as
  "RESOLVED — ROUND 8"; item 6's superseded draft copy struck through)
- This file.

## 8. What is still owed before this can ever apply anywhere

1. Aravind's own review of this package and the migration file.
2. A real test-db rehearsal — this round's disposable-local-Postgres dry-run
   (§4) is the CLAUDE.md §7 pre-review gate, not a substitute for the actual
   test-db rehearsal every apply still requires.
3. Tamil pairs for both new copy constants (item 21 of
   `docs/plans/media-capture-design.md`, unchanged — not resolved by this
   round).
4. The standard post-apply ACL fingerprint (§3 above) once an apply
   actually happens.
5. `npm test` (or at minimum the four files named in §6) actually run
   against real test-db, in CI or an environment that has the credentials
   this one lacks.
