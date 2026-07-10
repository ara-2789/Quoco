import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_USER_B_EMAIL,
  TEST_007_PASSWORD,
  type TwoTenantFixtures,
} from './helpers/db'

// Migration 007 (auth surgery) verification suite. Proves the schema after the
// FK drop + auth_id introduction behaves as the approved plan requires:
//   T-007-01  standalone engineer row (auth_id NULL) inserts        — schema
//   T-007-02  get_user_tenant_id() resolves via auth_id             — JWT client
//   T-007-03  two-tenant RLS isolation                              — JWT clients
//   T-007-04  handle_new_user makes exactly one row, id != auth uid — trigger/R4
// Runs against the test-db branch (guarded by test/setup/guard.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let fx: TwoTenantFixtures

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()
})

afterAll(async () => {
  await removeTwoTenantFixtures()
})

describe('migration 007 — auth surgery', () => {
  // -------------------------------------------------------------------------
  // T-007-01 — the whole point of the FK drop: a users row with no auth login.
  // Service-role insert is appropriate here; this proves the SCHEMA, not RLS.
  // -------------------------------------------------------------------------
  it('T-007-01: inserts an engineer row with auth_id NULL and a standalone id', async () => {
    const db = testClient()
    const phone = '+19995550701'
    let insertedId: string | null = null
    try {
      const { data, error } = await db
        .from('users')
        .insert({
          tenant_id: TEST_TENANT_A_ID,
          full_name: 'ZZ 007 Standalone Engineer',
          role: 'engineer',
          whatsapp_number: phone,
          auth_id: null,
        })
        .select('id, auth_id')
        .single<{ id: string; auth_id: string | null }>()

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      insertedId = data!.id
      // Generated id (via the 4b default), and no auth link.
      expect(data!.id).toMatch(UUID_RE)
      expect(data!.auth_id).toBeNull()
    } finally {
      if (insertedId) await db.from('users').delete().eq('id', insertedId)
    }
  })

  // -------------------------------------------------------------------------
  // T-007-02 — the rewritten helper resolves the caller's tenant via auth_id.
  // Must run through a real user JWT, not the service role.
  // -------------------------------------------------------------------------
  it('T-007-02: get_user_tenant_id() resolves the signed-in user tenant via auth_id', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA.rpc('get_user_tenant_id')
      expect(error).toBeNull()
      expect(data).toBe(TEST_TENANT_A_ID)
    } finally {
      await clientA.auth.signOut()
    }
  })

  // -------------------------------------------------------------------------
  // T-007-03 — RLS isolation across two tenants, exercised as two real JWTs.
  // This is the test that is green-by-definition under the service role, so it
  // MUST use the user-scoped clients.
  // -------------------------------------------------------------------------
  it('T-007-03: tenant A cannot read tenant B rows (and vice versa)', async () => {
    let clientA: SupabaseClient | null = null
    let clientB: SupabaseClient | null = null
    try {
      clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
      clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)

      // A sees only project A.
      const { data: aProjects, error: aErr } = await clientA
        .from('projects')
        .select('id, tenant_id')
      expect(aErr).toBeNull()
      const aIds = (aProjects ?? []).map((p) => p.id)
      expect(aIds).toContain(TEST_PROJECT_A_ID)
      expect(aIds).not.toContain(TEST_PROJECT_B_ID)
      expect((aProjects ?? []).every((p) => p.tenant_id === TEST_TENANT_A_ID)).toBe(true)

      // Targeted read of B's project by A returns nothing (RLS filters it out).
      const { data: crossRead } = await clientA
        .from('projects')
        .select('id')
        .eq('id', TEST_PROJECT_B_ID)
      expect(crossRead ?? []).toHaveLength(0)

      // Symmetric: B sees only project B.
      const { data: bProjects, error: bErr } = await clientB
        .from('projects')
        .select('id, tenant_id')
      expect(bErr).toBeNull()
      const bIds = (bProjects ?? []).map((p) => p.id)
      expect(bIds).toContain(TEST_PROJECT_B_ID)
      expect(bIds).not.toContain(TEST_PROJECT_A_ID)
    } finally {
      if (clientA) await clientA.auth.signOut()
      if (clientB) await clientB.auth.signOut()
    }
  })

  // -------------------------------------------------------------------------
  // T-007-04 — a fresh signup: handle_new_user inserts exactly ONE users row
  // with a generated id (!= auth uid) and auth_id = NEW.id. Proves R4 didn't
  // happen (no blind (id) VALUES (NEW.id) regression) and the 4b default works.
  // -------------------------------------------------------------------------
  it('T-007-04: handle_new_user makes one row with generated id and auth_id = NEW.id', async () => {
    const db = testClient()
    const email = 'zz-007-fresh-signup@quoco.test'

    // Clean any leftover from a prior aborted run (users row first, then auth).
    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const stale = pre?.users.find((u) => u.email === email)
    if (stale) {
      await db.from('users').delete().eq('auth_id', stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }

    let authId: string | null = null
    try {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email,
        email_confirm: true,
      })
      expect(createErr).toBeNull()
      authId = created!.user!.id

      const { data: rows, error } = await db
        .from('users')
        .select('id, auth_id')
        .eq('auth_id', authId)
      expect(error).toBeNull()
      expect(rows).toHaveLength(1)
      expect(rows![0].auth_id).toBe(authId)
      expect(rows![0].id).toMatch(UUID_RE)
      // The decoupling: the generated profile id is NOT the auth uid.
      expect(rows![0].id).not.toBe(authId)
    } finally {
      if (authId) {
        await db.from('users').delete().eq('auth_id', authId)
        await db.auth.admin.deleteUser(authId)
      }
    }
  })
})
