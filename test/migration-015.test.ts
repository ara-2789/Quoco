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
