import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  testEngineerId,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  TEST_007_PASSWORD,
} from './helpers/db'

// Migration 016 (corrections) verification suite. Covers the column/type fixes
// and the role rename evicted from 007 (review §1b) plus the §11b RPC guard.
//
//   T-016-01  users.role CHECK: 'owner' now accepted, 'client' now rejected
//   T-016-02  complete_onboarding zero-row guard: RAISE (no_data_found), tenant
//             mint rolled back — no orphan
//   T-016-03  complete_onboarding happy path still writes (regression on the
//             CREATE OR REPLACE; DEFINER path, real JWT)
//   T-016-04  invoices.amount is DECIMAL(12,2): accepts a value beyond (10,2)
//   T-016-05  safety_incidents.submitted_via CHECK: allowed set accepted, junk /
//             legacy 'whatsapp' rejected; default aligned to a legal value
//   T-016-06  daily_logs: is_holiday defaults false; morning_dependencies /
//             morning_hindrances / evening_dependencies are JSONB; the superseded
//             evening_dependencies_tomorrow column is gone
//   T-016-07  projects.owner_user_id FK: rejects a dangling id, accepts a real one
//
// Schema-shape and constraint tests run through the SERVICE-ROLE client — they
// assert CHECK / FK / type / DEFAULT, which the DB enforces regardless of RLS.
// The one RLS-sensitive path (complete_onboarding happy path) uses a real JWT,
// mirroring 015 T-015-05. Runs against the test-db branch (test/setup/guard.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A syntactically valid UUID that is NOT any real users.id — for the FK-reject leg.
const DANGLING_UUID = '00000000-0000-4000-a000-0000000160ff'
const TODAY = '2026-07-12'

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

// Purge anything a test inserted into the correction-target tables under the
// fixture tenant/project, so re-runs stay clean and independent.
afterEach(async () => {
  const db = testClient()
  await db.from('invoices').delete().eq('project_id', TEST_PROJECT_ID)
  await db.from('safety_incidents').delete().eq('project_id', TEST_PROJECT_ID)
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_ID)
  // Undo any owner_user_id we set on the fixture project.
  await db.from('projects').update({ owner_user_id: null }).eq('id', TEST_PROJECT_ID)
})

describe('migration 016 — corrections', () => {
  // -------------------------------------------------------------------------
  // T-016-01 — the role rename lands in the CHECK: 'owner' is now a legal role
  // (it was NOT in the 001 constraint), and the retired 'client' value is now
  // rejected. Insert both via the service role (auth_id NULL — the ENG/owner
  // shape) and assert accept/reject.
  // -------------------------------------------------------------------------
  it('T-016-01: users.role CHECK accepts owner, rejects client', async () => {
    const db = testClient()

    const { data: ok, error: okErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_ID,
        full_name: 'ZZ 016 Owner',
        role: 'owner',
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    expect(okErr).toBeNull()
    expect(ok?.id).toMatch(UUID_RE)
    if (ok) await db.from('users').delete().eq('id', ok.id)

    const { error: badErr } = await db.from('users').insert({
      tenant_id: TEST_TENANT_ID,
      full_name: 'ZZ 016 Client',
      role: 'client',
      auth_id: null,
    })
    expect(badErr).not.toBeNull()
    // 23514 = check_violation: 'client' is no longer in users_role_check.
    expect(badErr?.code).toBe('23514')
  })

  // -------------------------------------------------------------------------
  // T-016-02 — §11b zero-row guard. Called through the service-role client there
  // is no session, so auth.uid() is NULL and the UPDATE matches no users row.
  // Pre-016 this silently returned the fresh tenant_id (orphaning a tenant);
  // post-016 it must RAISE, and the tenant INSERT must roll back with it.
  // -------------------------------------------------------------------------
  it('T-016-02: complete_onboarding raises and rolls back the tenant on zero-row', async () => {
    const db = testClient()
    const slug = `zz-016-orphan-${Date.now()}`

    const { data, error } = await db.rpc('complete_onboarding', {
      p_company_name: 'ZZ 016 Orphan Co',
      p_slug: slug,
      p_full_name: 'ZZ 016 Nobody',
    })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
    // no_data_found is raised with SQLSTATE P0002.
    expect(error?.code).toBe('P0002')

    // The tenant the RPC INSERTed before the UPDATE must NOT survive — the RAISE
    // aborts the whole function call (one transaction), rolling the INSERT back.
    const { data: leaked } = await db.from('tenants').select('id').eq('slug', slug)
    expect(leaked ?? []).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // T-016-03 — regression: the guarded CREATE OR REPLACE still writes on the
  // happy path. Real JWT (the production onboarding call path), mirrors 015
  // T-015-05. A matched row means v_rows > 0, so the guard does not fire.
  // -------------------------------------------------------------------------
  it('T-016-03: complete_onboarding still writes role/tenant_id/full_name (happy path)', async () => {
    const db = testClient()
    const email = 'zz-016-onboarding@quoco.test'
    const slug = `zz-016-onboard-${Date.now()}`

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
        p_company_name: 'ZZ 016 Onboard Co',
        p_slug: slug,
        p_full_name: 'ZZ 016 Onboarded Admin',
      })
      expect(rpcErr).toBeNull()
      expect(tenantId).toMatch(UUID_RE)
      createdTenantId = tenantId as string

      const { data: row } = await db
        .from('users')
        .select('tenant_id, full_name, role')
        .eq('auth_id', authId)
        .single<{ tenant_id: string; full_name: string; role: string }>()
      expect(row?.tenant_id).toBe(createdTenantId)
      expect(row?.full_name).toBe('ZZ 016 Onboarded Admin')
      expect(row?.role).toBe('admin')
    } finally {
      if (client) await client.auth.signOut()
      await db.from('users').delete().eq('auth_id', authId)
      await db.auth.admin.deleteUser(authId)
      if (createdTenantId) await db.from('tenants').delete().eq('id', createdTenantId)
    }
  })

  // -------------------------------------------------------------------------
  // T-016-04 — invoices.amount widened to DECIMAL(12,2). A value of
  // 100,000,000.00 overflows (10,2) (max 99,999,999.99) but fits (12,2). Insert
  // succeeds and the value round-trips exactly.
  // -------------------------------------------------------------------------
  it('T-016-04: invoices.amount accepts a value beyond DECIMAL(10,2)', async () => {
    const db = testClient()
    const { data, error } = await db
      .from('invoices')
      .insert({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        submitted_by: testEngineerId(),
        amount: 100000000.0, // 1e8 — rejected by (10,2), fine for (12,2)
      })
      .select('amount')
      .single<{ amount: number }>()
    expect(error).toBeNull()
    expect(Number(data?.amount)).toBe(100000000.0)
  })

  // -------------------------------------------------------------------------
  // T-016-05 — safety_incidents.submitted_via CHECK. The allowed set inserts
  // cleanly; the retired default value 'whatsapp' (and any junk) is rejected.
  // Also proves the default was realigned to a legal value: an insert omitting
  // submitted_via must NOT trip the new constraint.
  // -------------------------------------------------------------------------
  it('T-016-05: safety_incidents.submitted_via enforces the allowed set', async () => {
    const db = testClient()
    const base = {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      reported_by: testEngineerId(),
    }

    const { error: okErr } = await db
      .from('safety_incidents')
      .insert({ ...base, submitted_via: 'web_app' })
    expect(okErr).toBeNull()

    const { error: badErr } = await db
      .from('safety_incidents')
      .insert({ ...base, submitted_via: 'whatsapp' }) // retired default value
    expect(badErr?.code).toBe('23514')

    // Default omitted -> realigned to exactly 'whatsapp_scheduled' (was the
    // now-illegal 'whatsapp' in 001).
    const { data: def, error: defErr } = await db
      .from('safety_incidents')
      .insert({ ...base })
      .select('submitted_via')
      .single<{ submitted_via: string }>()
    expect(defErr).toBeNull()
    expect(def?.submitted_via).toBe('whatsapp_scheduled')
  })

  // -------------------------------------------------------------------------
  // T-016-06 — daily_logs corrections. is_holiday defaults false; the three
  // dependency/hindrance columns accept JSON arrays (they are JSONB now); the
  // superseded evening_dependencies_tomorrow column no longer exists.
  // -------------------------------------------------------------------------
  it('T-016-06: daily_logs holiday + JSONB columns behave, tomorrow column dropped', async () => {
    const db = testClient()
    const { data, error } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        engineer_id: testEngineerId(),
        log_date: TODAY,
        morning_dependencies: [{ item: 'steel', responsible_party: 'PM' }],
        morning_hindrances: [{ description: 'rain', responsible_party: 'nature' }],
        evening_dependencies: [{ item: 'crane', responsible_party: 'PM', required_by_time: '09:00' }],
      })
      .select('is_holiday, morning_dependencies, morning_hindrances, evening_dependencies')
      .single<{
        is_holiday: boolean
        morning_dependencies: { item: string; responsible_party: string }[]
        morning_hindrances: { description: string }[]
        evening_dependencies: { item: string; required_by_time: string }[]
      }>()
    expect(error).toBeNull()
    expect(data?.is_holiday).toBe(false) // DEFAULT false
    expect(data?.morning_dependencies?.[0]?.item).toBe('steel')
    expect(data?.morning_hindrances?.[0]?.description).toBe('rain')
    expect(data?.evening_dependencies?.[0]?.required_by_time).toBe('09:00')

    // The retired column is gone: selecting it errors (undefined column, 42703).
    const { error: goneErr } = await db
      .from('daily_logs')
      .select('evening_dependencies_tomorrow')
      .limit(1)
    expect(goneErr).not.toBeNull()
    expect(goneErr?.code).toBe('42703')
  })

  // -------------------------------------------------------------------------
  // T-016-07 — projects.owner_user_id FK to users(id). A dangling id is rejected
  // (foreign_key_violation); a real users id is accepted.
  // -------------------------------------------------------------------------
  it('T-016-07: projects.owner_user_id FK rejects a dangling id, accepts a real one', async () => {
    const db = testClient()

    const { error: badErr } = await db
      .from('projects')
      .update({ owner_user_id: DANGLING_UUID })
      .eq('id', TEST_PROJECT_ID)
    expect(badErr).not.toBeNull()
    expect(badErr?.code).toBe('23503') // foreign_key_violation

    const { data, error: okErr } = await db
      .from('projects')
      .update({ owner_user_id: testEngineerId() })
      .eq('id', TEST_PROJECT_ID)
      .select('owner_user_id')
      .single<{ owner_user_id: string }>()
    expect(okErr).toBeNull()
    expect(data?.owner_user_id).toBe(testEngineerId())
    // afterEach nulls owner_user_id back out.
  })
})
