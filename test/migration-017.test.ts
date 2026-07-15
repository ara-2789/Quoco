import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
  TEST_PROJECT_ID,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  applyMorningFlowTurn,
  testPhone,
} from './helpers/db'

// Migration 017 — RLS column-bounding + owner_user_id same-tenant enforcement.
// Negative-control suite (015/016 model): each test asserts the CLOSED (post-fix)
// state, keyed on error.code / SQLSTATE (never message text), matching
// 015 T-015-01/02/03 (42501) and 016 T-016-07 (23503). Running this BEFORE 017 is
// applied to the branch is the "prove the hole OPEN pre-fix" leg — the writes
// succeed and these tests go red; after apply they go green. Two-tenant fixtures
// (TEST_TENANT_A/B) as in the 007 isolation suite; JWT clients so RLS + column
// grants actually apply (service role would bypass both and prove nothing).
//
//   T-017-01  CANARY (runs first): the service-role morning-flow RPC still writes
//             daily_logs engineer_id/project_id — failure ⇒ bot down for all engineers
//   T-017-02  projects.owner_user_id x-tenant (UPDATE) -> 23503
//   T-017-03  projects.owner_user_id x-tenant (INSERT) -> 23503
//   T-017-04  projects.owner_user_id SAME-tenant happy path -> succeeds (no false positive)
//   T-017-05  project_members.user_id x-tenant (INSERT) -> 23503
//   T-017-06  project_members.project_id x-tenant (INSERT) -> 23503
//   T-017-07  projects column-bound: authenticated UPDATE of created_by -> 42501
//   T-017-08  daily_logs column-bound: authenticated UPDATE of engineer_id -> 42501
//   T-017-09  F4 anon write-strip: anon UPDATE rejected
//   T-017-10  REGRESSION (015): authenticated UPDATE of users.role -> 42501
//   T-017-11  REGRESSION: legitimate authenticated writes still succeed

const LOG_DATE_A = '2026-07-15'
// A syntactically valid UUID that is no real users.id — for a belt-and-suspenders leg.
const DANGLING_UUID = '00000000-0000-4000-a000-0000000170ff'

let fx: TwoTenantFixtures
let jwtA: SupabaseClient

function anonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Seed a daily_logs row in tenant A (project A, engineer = user A) for the
// column-bound UPDATE test. Service role (bypasses the very grants under test).
async function seedDailyLogA(): Promise<void> {
  const db = testClient()
  await db.from('daily_logs').upsert(
    {
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: fx.profileAId,
      log_date: LOG_DATE_A,
      morning_plan: 'seed',
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
}

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()
  await ensureMorningFixtures() // for the canary RPC path
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
  await seedDailyLogA()
  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterEach(async () => {
  const db = testClient()
  // Undo mutations a test may have made, keep the seeded rows stable.
  await db.from('projects').update({ owner_user_id: null }).eq('id', TEST_PROJECT_A_ID)
  await db.from('project_members').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await seedDailyLogA()
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID)
  await removeMorningFixtures()
  await removeTwoTenantFixtures()
})

describe('migration 017 — RLS column-bounding + owner_user_id same-tenant FK', () => {
  // T-017-01 — CANARY, runs first. The morning/evening flow writes daily_logs via
  // the service-role RPC (apply_morning_flow_turn), which bypasses grants AND is not
  // blocked by the composite FKs for a same-tenant write. If THIS breaks, the bot has
  // stopped working for every engineer — a far larger blast radius than any single
  // hole staying open, so it is the first thing we assert.
  it('T-017-01 (canary): service-role morning RPC still writes engineer_id/project_id', async () => {
    const phone = testPhone('401')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: '2026-03-16T09:00:00+05:30' })
    const r = await applyMorningFlowTurn({
      phone,
      message: 'Pour slab on level 3',
      startFlow: false,
      now: '2026-03-16T09:00:00+05:30',
    })
    expect(r.outcome).toBe('advance')
    const log = await getDailyLog('2026-03-16')
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    // engineer_id/project_id are set by the RPC from server state — the column REVOKE
    // does not touch the service role, and the write lands.
    expect(log?.project_id).toBe(TEST_PROJECT_ID)
  })

  // T-017-02 — owner_user_id repointed cross-tenant via an authenticated UPDATE:
  // passes RLS (same tenant row) + the owner_user_id column grant, then the composite
  // FK (owner_user_id, tenant_id) -> users(id, tenant_id) rejects it (no tenant-A user
  // with id = the tenant-B user). 23503.
  it('T-017-02: owner_user_id x-tenant UPDATE is rejected (23503)', async () => {
    const { error } = await jwtA
      .from('projects')
      .update({ owner_user_id: fx.profileBId })
      .eq('id', TEST_PROJECT_A_ID)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503') // foreign_key_violation
  })

  // T-017-03 — same cross-tenant binding via INSERT of a fresh tenant-A project.
  it('T-017-03: owner_user_id x-tenant INSERT is rejected (23503)', async () => {
    const { error } = await jwtA.from('projects').insert({
      tenant_id: TEST_TENANT_A_ID,
      name: 'zz-017 x-tenant owner',
      created_by: fx.profileAId,
      owner_user_id: fx.profileBId, // tenant B user -> composite FK violation
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503')
  })

  // T-017-04 — SAME-tenant owner must still succeed (no false positive from the FK).
  it('T-017-04: owner_user_id SAME-tenant UPDATE still succeeds', async () => {
    const { data, error } = await jwtA
      .from('projects')
      .update({ owner_user_id: fx.profileAId })
      .eq('id', TEST_PROJECT_A_ID)
      .select('owner_user_id')
      .single<{ owner_user_id: string }>()
    expect(error).toBeNull()
    expect(data?.owner_user_id).toBe(fx.profileAId)
  })

  // T-017-05 — project_members.user_id bound to a foreign-tenant user (INSERT). Admin
  // A passes the pm/admin RLS; the composite FK on (user_id, tenant_id) rejects. 23503.
  it('T-017-05: project_members.user_id x-tenant INSERT is rejected (23503)', async () => {
    const { error } = await jwtA.from('project_members').insert({
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      user_id: fx.profileBId, // tenant B user
      role: 'pm',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503')
  })

  // T-017-06 — project_members.project_id bound to a foreign-tenant project (INSERT).
  it('T-017-06: project_members.project_id x-tenant INSERT is rejected (23503)', async () => {
    const { error } = await jwtA.from('project_members').insert({
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_B_ID, // tenant B project
      user_id: fx.profileAId,
      role: 'pm',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23503')
  })

  // T-017-07 — projects column-bound: created_by is EXCLUDED from the authenticated
  // UPDATE grant. Setting it to a valid SAME-tenant value (so RLS would pass) is
  // rejected at the column-privilege layer, upstream of RLS. 42501.
  it('T-017-07: authenticated UPDATE of projects.created_by -> 42501', async () => {
    const { error } = await jwtA
      .from('projects')
      .update({ created_by: fx.profileAId })
      .eq('id', TEST_PROJECT_A_ID)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501') // insufficient_privilege (column grant)
  })

  // T-017-08 — daily_logs column-bound: engineer_id is EXCLUDED. Admin A (allowed by
  // daily_logs_update RLS for pm/admin/qs) still cannot repoint engineer_id. 42501.
  it('T-017-08: authenticated UPDATE of daily_logs.engineer_id -> 42501', async () => {
    const { error } = await jwtA
      .from('daily_logs')
      .update({ engineer_id: fx.profileAId })
      .eq('project_id', TEST_PROJECT_A_ID)
      .eq('log_date', LOG_DATE_A)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  // T-017-09 — F4: anon holds no write grant post-017; an anon UPDATE is rejected.
  it('T-017-09: anon UPDATE of projects is rejected', async () => {
    const { error } = await anonClient()
      .from('projects')
      .update({ name: 'zz-017 anon' })
      .eq('id', TEST_PROJECT_A_ID)
    expect(error).not.toBeNull()
  })

  // T-017-10 — REGRESSION: 015's users column-bounding still holds; a self-UPDATE of
  // role is rejected at the column layer. (Belt-and-suspenders: also proves 017's
  // broad grant work did not accidentally re-widen users.)
  it('T-017-10 (regression 015): authenticated UPDATE of users.role -> 42501', async () => {
    const { error } = await jwtA
      .from('users')
      .update({ role: 'admin' })
      .eq('id', fx.profileAId)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  // T-017-11 — REGRESSION: legitimate authenticated writes still succeed — a PM renames
  // a project (granted col) and updates their own full_name (015's granted col). Guards
  // against over-revoking.
  it('T-017-11 (regression): legitimate authenticated writes still succeed', async () => {
    const { error: projErr } = await jwtA
      .from('projects')
      .update({ name: 'zz-017 renamed ok' })
      .eq('id', TEST_PROJECT_A_ID)
    expect(projErr).toBeNull()

    const { error: userErr } = await jwtA
      .from('users')
      .update({ full_name: 'ZZ 017 User A renamed' })
      .eq('id', fx.profileAId)
    expect(userErr).toBeNull()
  })

  // T-017-12 — SF3 / the scenario BF1 is really about. Bind owner_user_id LEGALLY
  // (same-tenant), then try to move the referenced owner to another tenant. The
  // composite FK is ON UPDATE NO ACTION, so the tenant_id UPDATE on USERS is rejected
  // with an FK violation (surfacing on the users update, not projects) — proving a
  // referenced (id, tenant_id) key cannot be moved out from under a live reference.
  // Service role: this is DB-level FK behavior; authenticated can't UPDATE tenant_id
  // at all (015 -> 42501), which would mask the FK check we want to assert.
  it('T-017-12 (SF3): tenant-move of a referenced owner is rejected by NO ACTION (23503)', async () => {
    const db = testClient()

    // (1) legal same-tenant bind
    const { error: bindErr } = await db
      .from('projects')
      .update({ owner_user_id: fx.profileAId })
      .eq('id', TEST_PROJECT_A_ID)
    expect(bindErr).toBeNull()

    // (2) move the referenced owner to tenant B -> composite FK (owner_user_id,
    //     tenant_id) on project A would dangle -> ON UPDATE NO ACTION rejects it.
    const { error: moveErr } = await db
      .from('users')
      .update({ tenant_id: TEST_TENANT_B_ID })
      .eq('id', fx.profileAId)
    expect(moveErr).not.toBeNull()
    expect(moveErr?.code).toBe('23503') // FK violation on the users UPDATE

    // Belt-and-suspenders: the owner did NOT move.
    const { data: still } = await db
      .from('users')
      .select('tenant_id')
      .eq('id', fx.profileAId)
      .single<{ tenant_id: string }>()
    expect(still?.tenant_id).toBe(TEST_TENANT_A_ID)
    // afterEach nulls owner_user_id back out.
  })
})
