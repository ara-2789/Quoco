# Migration 015 — Reviewer Package (post-c5de865)

Assembled because GitHub is serving a stale cache of the branch. These are the
raw artifacts as they exist on `feat/migration-015-high1` @ `c5de865`.
Verified against the test-db branch `exfccwlrhoutkgrlikod` (NOT prod).

Contents:
1. Migration SQL — supabase/migrations/015_users_update_column_grant.sql
2. Test suite — test/migration-015.test.ts
3. Round-2 PR comment (six-finding response)
4. Raw vitest outputs — clean pre-run (before apply) and clean post-run (after apply)
5. Catalog probes already captured (A/B/C)
6. Extra probe requested: service_role privileges on public.users

---

## 1. supabase/migrations/015_users_update_column_grant.sql

```sql
-- =============================================================
-- 015_users_update_column_grant.sql
-- SECURITY — close the users_update self-privilege-escalation hole.
--
-- HIGH-1 (review §11a). PRE-EXISTING since 002 — NOT introduced by 007;
-- 007 merely re-signed the policy verbatim (id -> auth_id). The users_update
-- RLS policy is:
--     USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid())
-- with NO column restriction. So any authenticated user can UPDATE their OWN
-- row (which satisfies WITH CHECK) and in the same statement set role='admin'
-- or repoint tenant_id to another tenant -> self-serve privilege escalation /
-- tenant hopping, gated only by the client choosing not to send those columns.
--
-- FIX (review §11a): do NOT rely on the policy to bound columns. Revoke the
-- table-level UPDATE from `authenticated` and re-grant it column-wise. Postgres
-- checks column-level privileges at the SQL layer, BEFORE RLS is consulted, so
-- an UPDATE touching any column outside the grant is rejected (SQLSTATE 42501)
-- regardless of the RLS policy. The RLS policy still bounds the write to the
-- caller's own row; the column grant bounds WHICH columns they may write.
--
-- COLUMNS GRANTED: (full_name, avatar_url) — the only two self-service profile
-- columns on users today (verified 001_core_schema.sql:40-41). Deliberately
-- EXCLUDED: role, tenant_id, auth_id, status, messaging_blocked,
-- whatsapp_number, hierarchy_level — the escalation / tenant-hop / impersonation
-- surface. Widen this grant later (a one-line follow-up) ONLY if a real
-- user-writable column is added; never speculatively.
--
-- BROADER GRANT HARDENING (review round-2 finding #2): Supabase's default
-- privileges GRANT ALL on every public table to BOTH `anon` AND `authenticated`
-- at table-creation time. So today `anon` holds INSERT/UPDATE/DELETE on
-- public.users, and `authenticated` holds INSERT/DELETE, purely by default —
-- none of which any code path uses. RLS currently denies `anon` (no policy is
-- written TO anon), so this is not exploitable today. But this migration's whole
-- thesis is that the privilege layer should bound what the privilege layer can
-- bound, rather than leaning on RLS as the only gate. Defence in depth: strip the
-- unused table privileges so a future accidental `TO anon` policy, or an RLS
-- regression, cannot become a write vector. After this migration:
--   * anon:          NO INSERT / UPDATE / DELETE on public.users (SELECT
--                    untouched here — no anon SELECT policy exists, so RLS still
--                    denies reads; we only strip the write verbs by default).
--   * authenticated: UPDATE only, column-scoped to (full_name, avatar_url);
--                    NO INSERT, NO DELETE.
-- Verified (Task 2a) that no legitimate path INSERTs/DELETEs users as either
-- role: handle_new_user INSERTs as its SECURITY DEFINER owner, complete_onboarding
-- only UPDATEs (also DEFINER), the webhook read uses the service role, and the
-- test harness writes via the service-role client — all bypass these grants.
--
-- Plan of record: docs/migration-007-checkpoint-1-review.md §11a (HIGH-1).
-- Requires external review per §11a before prod apply.
--
-- HARD DEADLINE (§11a): land BEFORE a second real user exists in any tenant.
-- Today the only authenticated user is the founder-admin, so the blast radius
-- is self-only; the moment a second PM is invited it becomes cross-user. Gates
-- the ENG-01 / invitations work.
--
-- BLAST RADIUS — every authenticated (non-service-role) writer of users
-- (review §3 audit):
--   * complete_onboarding() RPC (005:76 / 007:191) writes tenant_id/full_name/
--     role, but runs SECURITY DEFINER: its body executes with the FUNCTION
--     OWNER's privileges, not the caller's, so this REVOKE does NOT touch it.
--     Callers keep only EXECUTE (005:86), unchanged here.
--   * handle_new_user() trigger INSERTs (not UPDATE) and is DEFINER-owned.
--   * App server components (review §3c) only READ users (.eq('auth_id', ...));
--     the onboarding page collects full_name via the complete_onboarding RPC,
--     NOT a direct users UPDATE. No app path issues a direct authenticated
--     UPDATE on public.users.
--   * Webhook / 011-014 RPCs use the service role (bypasses grants) and never
--     update users.
-- => No legitimate path breaks. Only the raw-client escalation UPDATE closes.
--
-- RERUN SEMANTICS: fully idempotent. REVOKE and GRANT are declarative — running
-- this twice leaves the same end state. No data touched, no schema changed.
--
-- ROLLBACK: fully reversible, no data/PITR dependency (unlike 007). Down path
-- restores the Supabase default privileges this migration narrowed:
--     GRANT INSERT, UPDATE, DELETE ON public.users TO authenticated;
--     GRANT INSERT, UPDATE, DELETE ON public.users TO anon;
-- (Reverting only step 2's column grant — i.e. `GRANT UPDATE ON public.users TO
--  authenticated` — is what undoes the ORIGINAL, already-applied 015; the two
--  lines above additionally undo step 3's anon/authenticated write revokes.)
--
-- PROD APPLY RUNBOOK: the prod apply step includes observing the PITR restore
-- window state (Database -> Backups -> Point in time) immediately before
-- applying — per CLAUDE.md §0 standing rule (rollback mechanisms verified by
-- observation, never by checklist status). (PITR enabled + observation-verified
-- 2026-07-12: active restore window 05 Jul -> present, 2-min granularity.)
-- Trivial for a grants-only migration; the rule applies regardless.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Drop the blanket table-level UPDATE from authenticated. This is what
--    currently lets a client write ANY column (role, tenant_id, ...) as long
--    as RLS's WITH CHECK passes (the row stays theirs).
-- -------------------------------------------------------------
REVOKE UPDATE ON public.users FROM authenticated;

-- -------------------------------------------------------------
-- 2. Re-grant UPDATE only on the self-service profile columns. Anything not
--    listed here is now rejected at the column-privilege layer (42501), upstream
--    of RLS. RLS (users_update: auth_id = auth.uid()) still bounds the write to
--    the caller's own row.
-- -------------------------------------------------------------
GRANT UPDATE (full_name, avatar_url) ON public.users TO authenticated;

-- -------------------------------------------------------------
-- 3. Defence in depth (review round-2 finding #2): strip the unused,
--    default-granted write privileges. anon loses ALL write verbs; authenticated
--    loses INSERT/DELETE (keeping only the column-scoped UPDATE from step 2).
--    No code path uses these — see the BROADER GRANT HARDENING header + Task 2a.
-- -------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon;
REVOKE INSERT, DELETE ON public.users FROM authenticated;

COMMIT;
```

---

## 2. test/migration-015.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
  type TwoTenantFixtures,
} from './helpers/db'

// Migration 015 (users_update column grant) verification suite. Proves the
// HIGH-1 self-privilege-escalation hole (review §11a) is closed by the
// REVOKE UPDATE + column-wise GRANT, and that legitimate writes still work.
//
//   T-015-01  authenticated UPDATE of role     -> rejected at column-priv layer
//   T-015-02  authenticated UPDATE of tenant_id -> rejected (tenant hop denied)
//   T-015-03  mixed UPDATE (granted + ungranted col) -> rejected atomically
//   T-015-04  authenticated UPDATE of full_name/avatar_url -> allowed
//   T-015-05  complete_onboarding RPC (SECURITY DEFINER) still writes role/
//             tenant_id/full_name -> the REVOKE did not break the privileged writer
//   T-015-06  cross-row write on a GRANTED column (A -> B's full_name) -> RLS
//             row-bounds it to a zero-row no-op; B's row is untouched
//
// All escalation attempts fail with SQLSTATE 42501 (insufficient_privilege) at
// the column-privilege layer — strictly upstream of RLS, NOT a silent zero-row
// policy denial. Reuses the 007 two-tenant, JWT-scoped harness: an isolation
// test run as the service role bypasses grants and would be green by definition
// (review §6), so these MUST run through real user JWTs.
// Runs against the test-db branch (guarded by test/setup/guard.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// User A's seeded profile full_name (helpers/db.ts claimProfile). T-015-04
// mutates and restores it, so the fixture stays stable across the suite.
const USER_A_FULL_NAME = 'ZZ 007 User A'
// User B's seeded profile full_name — T-015-06 asserts it stays untouched.
const USER_B_FULL_NAME = 'ZZ 007 User B'

let fx: TwoTenantFixtures

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()
})

afterAll(async () => {
  await removeTwoTenantFixtures()
})

// Belt-and-braces: reset User A's mutable profile columns to the fixture
// baseline after every test, so a mid-suite failure can't leak state.
afterEach(async () => {
  const db = testClient()
  await db
    .from('users')
    .update({ full_name: USER_A_FULL_NAME, avatar_url: null })
    .eq('id', fx.profileAId)
})

describe('migration 015 — users_update column grant', () => {
  // -------------------------------------------------------------------------
  // T-015-01 — the escalation itself: an authenticated user cannot write the
  // `role` column, even on their OWN row (which RLS would otherwise permit).
  // The column-privilege check is value-independent, so writing any role is
  // denied; we assert the row's role is untouched afterwards.
  // -------------------------------------------------------------------------
  it('T-015-01: authenticated UPDATE of role is rejected at the privilege layer', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('users')
        .update({ role: 'pm' }) // A is 'admin'; any role write must be denied
        .eq('id', fx.profileAId)
        .select('id')
      expect(error).not.toBeNull()
      // 42501 = insufficient_privilege: rejected BEFORE RLS by the column grant,
      // not a coincidental CHECK/FK/typo and not a silent zero-row policy filter.
      expect(error?.code).toBe('42501')
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }

    // Service-role read: the role never changed.
    const db = testClient()
    const { data: row } = await db
      .from('users')
      .select('role')
      .eq('id', fx.profileAId)
      .single<{ role: string }>()
    expect(row?.role).toBe('admin')
  })

  // -------------------------------------------------------------------------
  // T-015-02 — tenant hopping: an authenticated user cannot repoint tenant_id.
  // -------------------------------------------------------------------------
  it('T-015-02: authenticated UPDATE of tenant_id is rejected (tenant hop denied)', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('users')
        .update({ tenant_id: TEST_TENANT_B_ID }) // hop into tenant B
        .eq('id', fx.profileAId)
        .select('id')
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }

    const db = testClient()
    const { data: row } = await db
      .from('users')
      .select('tenant_id')
      .eq('id', fx.profileAId)
      .single<{ tenant_id: string }>()
    expect(row?.tenant_id).toBe(TEST_TENANT_A_ID)
  })

  // -------------------------------------------------------------------------
  // T-015-03 — an UPDATE mixing a GRANTED column (full_name) with an UNGRANTED
  // one (role) is rejected in FULL: the presence of any ungranted column
  // poisons the whole statement. Proves no partial write — full_name must also
  // be unchanged, so a client cannot smuggle role past by pairing it with a
  // legitimate column.
  // -------------------------------------------------------------------------
  it('T-015-03: mixed granted+ungranted UPDATE is rejected atomically', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('users')
        .update({ full_name: 'Smuggled Name', role: 'admin' })
        .eq('id', fx.profileAId)
        .select('id')
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }

    // Neither column was written — the statement failed whole.
    const db = testClient()
    const { data: row } = await db
      .from('users')
      .select('full_name, role')
      .eq('id', fx.profileAId)
      .single<{ full_name: string; role: string }>()
    expect(row?.full_name).toBe(USER_A_FULL_NAME)
    expect(row?.role).toBe('admin')
  })

  // -------------------------------------------------------------------------
  // T-015-04 — legitimate self-service update still works: an authenticated
  // user CAN write the granted columns (full_name, avatar_url) on their own row.
  // RLS (auth_id = auth.uid()) still scopes it to their own row.
  // -------------------------------------------------------------------------
  it('T-015-04: authenticated UPDATE of full_name/avatar_url is allowed', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('users')
        .update({ full_name: 'Updated Name A', avatar_url: 'https://example.test/a.png' })
        .eq('id', fx.profileAId)
        .select('id, full_name, avatar_url')
        .single<{ id: string; full_name: string; avatar_url: string }>()
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.full_name).toBe('Updated Name A')
      expect(data!.avatar_url).toBe('https://example.test/a.png')
    } finally {
      await clientA.auth.signOut()
    }
    // afterEach restores the fixture baseline.
  })

  // -------------------------------------------------------------------------
  // T-015-05 — the SECURITY DEFINER writer is untouched: complete_onboarding
  // still writes tenant_id/full_name/role for a fresh signup, proving the REVOKE
  // did not collaterally break the privileged path (§3 audit, verified
  // behaviourally). Runs as a real JWT — the production onboarding call path.
  // -------------------------------------------------------------------------
  it('T-015-05: complete_onboarding still writes role/tenant_id/full_name', async () => {
    const db = testClient()
    const email = 'zz-015-onboarding@quoco.test'
    // Unique slug per run so the tenant INSERT inside the RPC never collides.
    const slug = `zz-015-onboard-${Date.now()}`

    // Clean any leftover auth user + its trigger-created profile from a prior run.
    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const stale = pre?.users.find((u) => u.email === email)
    if (stale) {
      await db.from('users').delete().eq('auth_id', stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password: TEST_007_PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    const authId = created!.user!.id

    let client: SupabaseClient | null = null
    let createdTenantId: string | null = null
    try {
      client = await jwtClient(email, TEST_007_PASSWORD)

      const { data: tenantId, error: rpcErr } = await client.rpc('complete_onboarding', {
        p_company_name: 'ZZ 015 Onboard Co',
        p_slug: slug,
        p_full_name: 'ZZ 015 Onboarded Admin',
      })
      expect(rpcErr).toBeNull()
      expect(tenantId).toMatch(UUID_RE)
      createdTenantId = tenantId as string

      // The DEFINER RPC wrote all three columns despite the authenticated caller
      // having no table-level UPDATE grant on users.
      const { data: row } = await db
        .from('users')
        .select('tenant_id, full_name, role')
        .eq('auth_id', authId)
        .single<{ tenant_id: string; full_name: string; role: string }>()
      expect(row?.tenant_id).toBe(createdTenantId)
      expect(row?.full_name).toBe('ZZ 015 Onboarded Admin')
      expect(row?.role).toBe('admin')
    } finally {
      if (client) await client.auth.signOut()
      // FK-safe cleanup: profile row first, then auth user, then the tenant the
      // RPC minted.
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
      if (createdTenantId) await db.from('tenants').delete().eq('id', createdTenantId)
    }
  })

  // -------------------------------------------------------------------------
  // T-015-06 — cross-row write on a GRANTED column. full_name IS granted, so the
  // column-privilege layer PERMITS this UPDATE; what must stop it is RLS bounding
  // the write to the caller's own row. User A targets User B's row by id. Expect
  // a zero-row NO-OP (no error — the column grant is satisfied — but B's row is
  // filtered out by users_update's USING (auth_id = auth.uid())).
  //
  // Grants bound COLUMNS; RLS bounds ROWS. T-015-01..03 guard the column half;
  // this test guards the row half, so a future policy loosening (e.g. widening
  // users_update's USING clause) cannot silently pass the suite.
  // -------------------------------------------------------------------------
  it('T-015-06: A cannot write B\'s row even on a granted column (RLS row-bounds it)', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('users')
        .update({ full_name: 'hijacked' })
        .eq('id', fx.profileBId) // B's row, not A's -> RLS USING filters it out
        .select('id')
      // No privilege error (full_name is granted); RLS makes it a zero-row no-op.
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }

    // Service-role read-back: B's full_name is exactly the fixture baseline.
    const db = testClient()
    const { data: row } = await db
      .from('users')
      .select('full_name')
      .eq('id', fx.profileBId)
      .single<{ full_name: string }>()
    expect(row?.full_name).toBe(USER_B_FULL_NAME)
  })
})
```

---

## 3. Round-2 PR comment (six-finding response)

> **Reviewer round-2 — all three gating fixes + three suggestions addressed.** Revised migration + tests pushed as `c5de865`.
>
> **#1 — PITR / stale docs.** PITR **is** enabled and observation-verified on prod as of **2026-07-12** (Database → Backups → Point in time: active restore window 05 Jul → present, 2-min granularity). Your finding fired because the docs you read predated this — the CLAUDE.md dated update was committed but its push had been held; it's now on `origin/main` (`cfaccfc`). Screenshot attached below. [attach PITR screenshot]
>
> **#2 — broader default grants (done).** Added defence-in-depth revokes: `REVOKE INSERT, UPDATE, DELETE … FROM anon` and `REVOKE INSERT, DELETE … FROM authenticated`. Rationale in a new "BROADER GRANT HARDENING" header section — Supabase grants ALL to both roles by default; RLS denies anon today, but the migration's own thesis is that the privilege layer should bound what it can bound rather than leaning on RLS as the only gate. Verified no legitimate path INSERT/DELETEs `users` as either role (handle_new_user is DEFINER-owned; complete_onboarding only UPDATEs; webhook + test harness use the service role).
>
> **#3 — tainted evidence (done).** You were right that the original negative control raced my SQL Editor apply. Redone cleanly, no overlap: revert → clean pre-run → apply revised → clean post-run. Results: **pre-fix 39/42** with exactly T-015-01/02/03 red (escalation succeeding — the hole, demonstrated), **post-fix 42/42** with only those three flipping green. Raw outputs below (§4).
>
> **#4 — cross-row denial (done).** Added **T-015-06**: User A (JWT) updating User B's row on a *granted* column (`full_name`) is an RLS-bounded zero-row no-op; B's row verified unchanged. Grants bound columns, RLS bounds rows — this guards the row half so a future policy loosening can't silently pass the suite. (Confirmed green both pre- and post-fix, as expected — row-bounding predates 015.)
>
> **#5 — false review claim (done).** Header line "Reviewed on its own by the external reviewer per §11a's requirement" → "Requires external review per §11a before prod apply." The committed file shouldn't have asserted a review that hadn't happened.
>
> **#6 — pooler / migration tracking.** The session-pooler investigation happened and dead-ended at a `28P01` auth failure after two password resets, so **SQL Editor remains the deliberate fallback** for this branch (as with 013/014). Migration tracking for **both 013 and 014 was repaired on 2026-07-10** — `schema_migrations` verified at 11 rows. The ledger will be re-confirmed before 015's prod apply per the runbook (`supabase migration repair --status applied 015`).
>
> Status: applied + verified on the **test-db branch only**; NOT on prod. Prod apply gated on your sign-off, then the runbook (PITR window observation → SQL Editor apply → probes A/B/C → migration repair).

---

## 4. Raw vitest outputs (clean re-sequence, no apply/run overlap)

### 4a. Clean PRE-run — started 12:56:49, EXIT 1, taken BEFORE the revised-015 apply

Expected pre-fix: 39/42, with exactly T-015-01/02/03 red (escalation UPDATEs
succeed because table-level UPDATE was restored for the negative control).

```text

> quocoai@0.1.0 pretest
> npm run check:profile-lookups


> quocoai@0.1.0 check:profile-lookups
> node scripts/check-profile-lookups.mjs

✓ profile-lookup guard: no from('users') + .eq('id', ...) in app/ or lib/

> quocoai@0.1.0 test
> vitest run

◇ injected env (4) from .env.test // tip: ◈ secrets for agents [www.dotenvx.com]

 RUN  v3.2.7 /Users/aravindanrajamani/Desktop/quocoai

 ❯ test/migration-015.test.ts (6 tests | 3 failed) 10143ms
   × migration 015 — users_update column grant > T-015-01: authenticated UPDATE of role is rejected at the privilege layer 814ms
     → expected null not to be null
   × migration 015 — users_update column grant > T-015-02: authenticated UPDATE of tenant_id is rejected (tenant hop denied) 788ms
     → expected null not to be null
   × migration 015 — users_update column grant > T-015-03: mixed granted+ungranted UPDATE is rejected atomically 842ms
     → expected null not to be null
   ✓ migration 015 — users_update column grant > T-015-04: authenticated UPDATE of full_name/avatar_url is allowed  825ms
   ✓ migration 015 — users_update column grant > T-015-05: complete_onboarding still writes role/tenant_id/full_name  1952ms
   ✓ migration 015 — users_update column grant > T-015-06: A cannot write B's row even on a granted column (RLS row-bounds it)  934ms
 ✓ test/migration-007.test.ts (9 tests) 12310ms
   ✓ migration 007 — auth surgery > T-007-01: inserts an engineer row with auth_id NULL and a standalone id  324ms
   ✓ migration 007 — auth surgery > T-007-02: get_user_tenant_id() resolves the signed-in user tenant via auth_id  640ms
   ✓ migration 007 — auth surgery > T-007-03: tenant A cannot read tenant B rows (and vice versa)  1455ms
   ✓ migration 007 — auth surgery > T-007-04: handle_new_user makes one row with generated id and auth_id = NEW.id  992ms
   ✓ migration 007 — auth surgery > T-007-06: users_select shows only same-tenant rows (A sees A, not B; mirrored)  1257ms
   ✓ migration 007 — auth surgery > T-007-07: A cannot insert a project_members row scoped to tenant B  715ms
   ✓ migration 007 — auth surgery > T-007-08: A cannot insert a daily_logs row with another tenant engineer_id  627ms
   ✓ migration 007 — auth surgery > T-007-09: deleting an auth user with a linked profile fails (RESTRICT)  1166ms
   ✓ migration 007 — auth surgery > T-007-10: a fresh signup can self-read its pre-onboarding row (tenant_id NULL)  1522ms
 ✓ test/morning-flow.test.ts (8 tests) 10448ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > start: asks Q1, no daily_logs row materialised yet  629ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q1: writes morning_plan and advances to Q4  795ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q4: completes — both fields + submitted_at, session current_flow reset  1103ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > already_complete: post-completion inbound, no daily_logs write  1241ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > resume: same IST day resumes at Q4, does not restart at Q1  954ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > reask: whitespace answer re-asks the current question, no write  913ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > concurrency: two simultaneous turns are serialised by the row lock  2060ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > startFlow:false on idle session -> idle, no flow started, no write  623ms
 ✓ test/session-transition.test.ts (5 tests) 3759ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > A: queues a different flow behind the active one, keeps current_flow  479ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits  1154ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: same IST day → resume (flow/step/context preserved)  468ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: previous IST day → fresh start (flow/step/context wiped)  458ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > D: draining an empty queue is a safe no-op  464ms
 ✓ test/unit/morning-dispatch.test.ts (8 tests) 7ms
 ✓ test/unit/test-trigger.test.ts (6 tests) 6ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/migration-015.test.ts > migration 015 — users_update column grant > T-015-01: authenticated UPDATE of role is rejected at the privilege layer
AssertionError: expected null not to be null
 ❯ test/migration-015.test.ts:78:25
     76|         .eq('id', fx.profileAId)
     77|         .select('id')
     78|       expect(error).not.toBeNull()
       |                         ^
     79|       // 42501 = insufficient_privilege: rejected BEFORE RLS by the co…
     80|       // not a coincidental CHECK/FK/typo and not a silent zero-row po…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/migration-015.test.ts > migration 015 — users_update column grant > T-015-02: authenticated UPDATE of tenant_id is rejected (tenant hop denied)
AssertionError: expected null not to be null
 ❯ test/migration-015.test.ts:108:25
    106|         .eq('id', fx.profileAId)
    107|         .select('id')
    108|       expect(error).not.toBeNull()
       |                         ^
    109|       expect(error?.code).toBe('42501')
    110|       expect(data ?? []).toHaveLength(0)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/migration-015.test.ts > migration 015 — users_update column grant > T-015-03: mixed granted+ungranted UPDATE is rejected atomically
AssertionError: expected null not to be null
 ❯ test/migration-015.test.ts:139:25
    137|         .eq('id', fx.profileAId)
    138|         .select('id')
    139|       expect(error).not.toBeNull()
       |                         ^
    140|       expect(error?.code).toBe('42501')
    141|       expect(data ?? []).toHaveLength(0)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  1 failed | 5 passed (6)
      Tests  3 failed | 39 passed (42)
   Start at  12:56:49
   Duration  40.00s (transform 581ms, setup 0ms, collect 667ms, tests 36.67s, environment 1ms, prepare 586ms)

EXIT=1
```

### 4b. Clean POST-run — started 13:05:36, EXIT 0, taken AFTER the revised-015 apply

Expected post-fix: 42/42, the three escalation tests flipped green, nothing else moved.

```text

> quocoai@0.1.0 pretest
> npm run check:profile-lookups


> quocoai@0.1.0 check:profile-lookups
> node scripts/check-profile-lookups.mjs

✓ profile-lookup guard: no from('users') + .eq('id', ...) in app/ or lib/

> quocoai@0.1.0 test
> vitest run

◇ injected env (4) from .env.test // tip: ⌘ custom filepath { path: '/custom/path/.env' }

 RUN  v3.2.7 /Users/aravindanrajamani/Desktop/quocoai

 ✓ test/migration-015.test.ts (6 tests) 10934ms
   ✓ migration 015 — users_update column grant > T-015-01: authenticated UPDATE of role is rejected at the privilege layer  1049ms
   ✓ migration 015 — users_update column grant > T-015-02: authenticated UPDATE of tenant_id is rejected (tenant hop denied)  999ms
   ✓ migration 015 — users_update column grant > T-015-03: mixed granted+ungranted UPDATE is rejected atomically  931ms
   ✓ migration 015 — users_update column grant > T-015-04: authenticated UPDATE of full_name/avatar_url is allowed  767ms
   ✓ migration 015 — users_update column grant > T-015-05: complete_onboarding still writes role/tenant_id/full_name  1839ms
   ✓ migration 015 — users_update column grant > T-015-06: A cannot write B's row even on a granted column (RLS row-bounds it)  1017ms
 ✓ test/migration-007.test.ts (9 tests) 12389ms
   ✓ migration 007 — auth surgery > T-007-01: inserts an engineer row with auth_id NULL and a standalone id  322ms
   ✓ migration 007 — auth surgery > T-007-02: get_user_tenant_id() resolves the signed-in user tenant via auth_id  731ms
   ✓ migration 007 — auth surgery > T-007-03: tenant A cannot read tenant B rows (and vice versa)  1422ms
   ✓ migration 007 — auth surgery > T-007-04: handle_new_user makes one row with generated id and auth_id = NEW.id  903ms
   ✓ migration 007 — auth surgery > T-007-06: users_select shows only same-tenant rows (A sees A, not B; mirrored)  1329ms
   ✓ migration 007 — auth surgery > T-007-07: A cannot insert a project_members row scoped to tenant B  646ms
   ✓ migration 007 — auth surgery > T-007-08: A cannot insert a daily_logs row with another tenant engineer_id  712ms
   ✓ migration 007 — auth surgery > T-007-09: deleting an auth user with a linked profile fails (RESTRICT)  1095ms
   ✓ migration 007 — auth surgery > T-007-10: a fresh signup can self-read its pre-onboarding row (tenant_id NULL)  1463ms
 ✓ test/morning-flow.test.ts (8 tests) 10128ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > start: asks Q1, no daily_logs row materialised yet  632ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q1: writes morning_plan and advances to Q4  784ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > Q4: completes — both fields + submitted_at, session current_flow reset  1107ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > already_complete: post-completion inbound, no daily_logs write  1231ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > resume: same IST day resumes at Q4, does not restart at Q1  922ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > reask: whitespace answer re-asks the current question, no write  915ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > concurrency: two simultaneous turns are serialised by the row lock  1808ms
   ✓ apply_morning_flow_turn (morning flow, Pass 1) > startFlow:false on idle session -> idle, no flow started, no write  611ms
 ✓ test/session-transition.test.ts (5 tests) 3924ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > A: queues a different flow behind the active one, keeps current_flow  479ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > B: caller 2 blocks on the row lock until caller 1 commits  1193ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: same IST day → resume (flow/step/context preserved)  464ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > C: previous IST day → fresh start (flow/step/context wiped)  465ms
   ✓ acquire_and_transition_session / drain_next_pending_flow > D: draining an empty queue is a safe no-op  462ms
 ✓ test/unit/morning-dispatch.test.ts (8 tests) 7ms
 ✓ test/unit/test-trigger.test.ts (6 tests) 4ms

 Test Files  6 passed (6)
      Tests  42 passed (42)
   Start at  13:05:36
   Duration  40.46s (transform 502ms, setup 0ms, collect 558ms, tests 37.39s, environment 2ms, prepare 554ms)

EXIT=0
```

---

## 5. Catalog probes already captured (post-apply, test-db branch)

- **Probe A** — `information_schema.column_privileges`, grantee `authenticated`,
  privilege `UPDATE`, table `public.users`: returned **exactly two rows —
  `avatar_url` and `full_name`** (column-scoped UPDATE, nothing else).
- **Probe B** — `information_schema.table_privileges`, grantee `authenticated`,
  privilege `UPDATE`, table `public.users`: returned **zero rows** (no blanket
  table-level UPDATE survives).
- **Probe C** — `information_schema.table_privileges`, grantees `anon` +
  `authenticated`, privileges `INSERT`/`UPDATE`/`DELETE`, table `public.users`:
  returned **zero rows** (all table-level write verbs stripped for both roles;
  authenticated's surviving UPDATE is column-scoped, so it shows only in
  column_privileges — Probe A — not here).

---

## 6. Extra probe requested — service_role untouched on public.users

Run in the test-db SQL Editor:

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND grantee      = 'service_role'
ORDER BY privilege_type;
```

**Expected result:** service_role still holds its full default privilege set on
public.users — rows for **DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
UPDATE** (all 7). Migration 015 only names `anon` and `authenticated` in its
REVOKE/GRANT statements, so `service_role` is untouched — which is why the webhook
(service-role client) and the test harness (service-role client) keep working.
This is the second half of check #1 and the last item of #5.
