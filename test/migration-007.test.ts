import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { profileForAuthId } from '@/lib/auth/profile-query'
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
//   T-007-03  two-tenant RLS isolation (project reads)              — JWT clients
//   T-007-04  handle_new_user makes exactly one row, id != auth uid — trigger/R4
//   T-007-05  RESERVED — deferred invitations re-link test (review §6);
//             NOT part of the 007 gate. Intentionally absent below.
//   T-007-06  users_select isolation (the one OR-policy), both directions — JWT
//   T-007-07  cross-tenant WRITE denial: project_members tenant arm  — JWT
//   T-007-08  cross-tenant WRITE denial: daily_logs WITH CHECK arm   — JWT
//   T-007-09  RESTRICT FK executable: deleting a linked auth user fails — schema
//   T-007-10  pre-onboarding self-read: fresh signup (tenant_id NULL) reads its
//             own row via the REAL profileForAuthId — JWT client
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
      // Destructure error too: if the query ERRORED, data would be null and the
      // `?? []` would make this pass for the wrong reason.
      const { data: crossRead, error: crossErr } = await clientA
        .from('projects')
        .select('id')
        .eq('id', TEST_PROJECT_B_ID)
      expect(crossErr).toBeNull()
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

  // (T-007-05 is intentionally reserved for the deferred invitations re-link
  //  test — review §6 — and is NOT part of the 007 gate. Next id is 06.)

  // -------------------------------------------------------------------------
  // T-007-06 — users_select isolation. That policy is the one rewritten with an
  // OR (auth_id = auth.uid() OR tenant_id = get_user_tenant_id()), so it's the
  // likeliest to be subtly wrong. Positive + negative, both directions.
  // -------------------------------------------------------------------------
  it('T-007-06: users_select shows only same-tenant rows (A sees A, not B; mirrored)', async () => {
    let clientA: SupabaseClient | null = null
    let clientB: SupabaseClient | null = null
    try {
      clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
      clientB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)

      const { data: aUsers, error: aErr } = await clientA.from('users').select('id, tenant_id')
      expect(aErr).toBeNull()
      const aIds = (aUsers ?? []).map((u) => u.id)
      expect(aIds).toContain(fx.profileAId) // sees itself
      expect(aIds).not.toContain(fx.profileBId) // NOT tenant B's user
      expect((aUsers ?? []).every((u) => u.tenant_id === TEST_TENANT_A_ID)).toBe(true)

      const { data: bUsers, error: bErr } = await clientB.from('users').select('id, tenant_id')
      expect(bErr).toBeNull()
      const bIds = (bUsers ?? []).map((u) => u.id)
      expect(bIds).toContain(fx.profileBId)
      expect(bIds).not.toContain(fx.profileAId)
      expect((bUsers ?? []).every((u) => u.tenant_id === TEST_TENANT_B_ID)).toBe(true)
    } finally {
      if (clientA) await clientA.auth.signOut()
      if (clientB) await clientB.auth.signOut()
    }
  })

  // -------------------------------------------------------------------------
  // T-007-07 — cross-tenant WRITE denial (project_members). A is admin, so the
  // role arm of the WITH CHECK passes; the TENANT arm must still deny a write
  // scoped to tenant B. Makes the tenant arm executable, not faith-based.
  // -------------------------------------------------------------------------
  it('T-007-07: A cannot insert a project_members row scoped to tenant B', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('project_members')
        .insert({
          tenant_id: TEST_TENANT_B_ID, // not A's tenant -> WITH CHECK denies
          project_id: TEST_PROJECT_B_ID,
          user_id: fx.profileBId,
          role: 'pm',
        })
        .select('id')
      expect(error).not.toBeNull()
      // 42501 = RLS violation specifically — proves the WITH CHECK denied it,
      // not a coincidental NOT NULL / CHECK / FK / typo failure.
      expect(error?.code).toBe('42501')
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }
  })

  // -------------------------------------------------------------------------
  // T-007-08 — cross-tenant WRITE denial (daily_logs). tenant_id is A's (arm 1
  // passes) but engineer_id is B's profile, so the rewritten
  // `engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())` arm denies.
  // Exercises the rewritten WITH CHECK subquery directly.
  // -------------------------------------------------------------------------
  it('T-007-08: A cannot insert a daily_logs row with another tenant engineer_id', async () => {
    const clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
    try {
      const { data, error } = await clientA
        .from('daily_logs')
        .insert({
          tenant_id: TEST_TENANT_A_ID, // A's tenant -> arm 1 passes
          project_id: TEST_PROJECT_A_ID,
          engineer_id: fx.profileBId, // NOT A's profile -> arm 2 denies
          log_date: '2026-07-10',
        })
        .select('id')
      expect(error).not.toBeNull()
      // 42501 = RLS violation specifically — proves the WITH CHECK subquery
      // denied it, not a coincidental NOT NULL / CHECK / FK / typo failure.
      expect(error?.code).toBe('42501')
      expect(data ?? []).toHaveLength(0)
    } finally {
      await clientA.auth.signOut()
    }
  })

  // -------------------------------------------------------------------------
  // T-007-09 — the RESTRICT FK, executable. §10a says deleting an auth user
  // that still has a linked profile must fail (users.auth_id -> auth.users is
  // ON DELETE RESTRICT). Turns "the FK error is the system working as designed"
  // into a passing assertion.
  // -------------------------------------------------------------------------
  it('T-007-09: deleting an auth user with a linked profile fails (RESTRICT)', async () => {
    const db = testClient()
    const email = 'zz-007-restrict@quoco.test'

    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const stale = pre?.users.find((u) => u.email === email)
    if (stale) {
      await db.from('users').delete().eq('auth_id', stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    const authId = created!.user!.id
    try {
      // Trigger created a profile with auth_id = authId. Deleting the auth user
      // must fail on the RESTRICT FK.
      const { error: delErr } = await db.auth.admin.deleteUser(authId)
      expect(delErr).not.toBeNull()

      // And the profile survives (RESTRICT blocked; no cascade nulled it).
      const { data: still } = await db.from('users').select('id').eq('auth_id', authId)
      expect((still ?? []).length).toBe(1)
    } finally {
      // FK-safe cleanup: profile row first, THEN the auth user.
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
    }
  })

  // -------------------------------------------------------------------------
  // T-007-10 — pre-onboarding self-read. A brand-new signup has tenant_id NULL
  // the instant handle_new_user fires, BEFORE onboarding sets a tenant. This is
  // the exact state the auth callback hits in production: profileForAuthId runs
  // right after exchangeCodeForSession, against a tenant-less row. No other test
  // exercises it. users_select resolves it via its FIRST arm
  // (auth_id = auth.uid()); the tenant arm can't help (get_user_tenant_id() is
  // NULL here). Calls the REAL profileForAuthId (extracted to
  // lib/auth/profile-query.ts, no 'server-only') with the signup's JWT client —
  // the actual production code path, not a replica.
  // -------------------------------------------------------------------------
  it('T-007-10: a fresh signup can self-read its pre-onboarding row (tenant_id NULL)', async () => {
    const db = testClient()
    const email = 'zz-007-preonboard@quoco.test'

    const { data: pre } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const stale = pre?.users.find((u) => u.email === email)
    if (stale) {
      await db.from('users').delete().eq('auth_id', stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }

    // Password so the JWT client can sign in; email_confirm so login succeeds.
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password: TEST_007_PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    const authId = created!.user!.id

    let client: SupabaseClient | null = null
    try {
      client = await jwtClient(email, TEST_007_PASSWORD)

      // The REAL function the auth callback runs post-exchange. It throws if the
      // row is missing (0 rows) or on any query/RLS error, so reaching the
      // assertions already proves exactly-one-row-and-it's-theirs.
      const profile = await profileForAuthId(client, authId)

      expect(profile.tenant_id).toBeNull() // pre-onboarding: no tenant yet
      expect(profile.id).toMatch(UUID_RE)
      expect(profile.id).not.toBe(authId) // decoupled: profile id != auth uid
    } finally {
      if (client) await client.auth.signOut()
      // FK-safe cleanup: profile row first, THEN the auth user.
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
    }
  })
})
