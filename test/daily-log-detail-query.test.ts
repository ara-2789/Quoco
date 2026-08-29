import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
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
} from './helpers/db'
import { getDailyLogDetail } from '@/lib/daily-logs/query'

// getDailyLogDetail — the DASH-03 correction detail read. Proves the two
// things unique to this query (not already covered by migration-019.test.ts,
// which proves the WRITE-side guard): membership scoping on the READ side
// (RLS on daily_logs is tenant-wide, not project-scoped — 007:282 — so this
// query re-checks project_members explicitly, same reason 019's own RPC
// guard (f) does it at the write layer), and the latest-edit-per-column
// reduction.
//
// Dates unique to THIS suite, clear of migration-019.test.ts's own project-A
// seeds (2026-09-19 / 2026-01-05) and any other suite using project A + the
// shared fixture user as engineer_id.
const LOG_DATE = '2026-10-11'

const PROJECT_A2_ID = '00000000-0000-4000-a000-00000000019d' // tenant A, non-member (fresh id, distinct from migration-019.test.ts's own PROJECT_A2_ID)
const ROW_MEMBER = '00000000-0000-4000-a000-0000000190d1' // project A (member)
const ROW_NONMEMBER = '00000000-0000-4000-a000-0000000190d2' // project A2 (non-member)
const ROW_XTENANT = '00000000-0000-4000-a000-0000000190d3' // project B (tenant B)

let fx: TwoTenantFixtures
let jwtA: SupabaseClient

async function seedLog(
  id: string,
  tenantId: string,
  projectId: string,
  engineerId: string,
  cols: Record<string, unknown> = {},
): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      id,
      tenant_id: tenantId,
      project_id: projectId,
      engineer_id: engineerId,
      log_date: LOG_DATE,
      weather: 'cloudy',
      morning_plan: 'pour slab',
      ...cols,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seedLog(${id}) failed: ${error.message}`)
}

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()

  const db = testClient()
  // PM role + project membership for the MEMBER project only, mirroring
  // migration-019.test.ts's own setup exactly.
  await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
  await db.from('project_members').upsert(
    { project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, tenant_id: TEST_TENANT_A_ID, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  await db.from('projects').upsert(
    { id: PROJECT_A2_ID, tenant_id: TEST_TENANT_A_ID, created_by: fx.profileAId, name: 'ZZ Detail-Query Non-Member Project' },
    { onConflict: 'id' },
  )

  await seedLog(ROW_MEMBER, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, fx.profileAId)
  await seedLog(ROW_NONMEMBER, TEST_TENANT_A_ID, PROJECT_A2_ID, fx.profileAId)
  await seedLog(ROW_XTENANT, TEST_TENANT_B_ID, TEST_PROJECT_B_ID, fx.profileBId)

  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_log_edits').delete().in('daily_logs_id', [ROW_MEMBER, ROW_NONMEMBER, ROW_XTENANT])
  await db.from('daily_logs').delete().in('id', [ROW_MEMBER, ROW_NONMEMBER, ROW_XTENANT])
  await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID).eq('user_id', fx.profileAId)
  await db.from('projects').delete().eq('id', PROJECT_A2_ID)
  await db.from('users').update({ role: 'admin' }).eq('id', fx.profileAId)
  await removeTwoTenantFixtures()
})

describe('getDailyLogDetail', () => {
  it('happy path: PM member of the project gets the full row', async () => {
    const result = await getDailyLogDetail(jwtA, fx.profileAId, ROW_MEMBER)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.data.id).toBe(ROW_MEMBER)
    expect(result.data.projectId).toBe(TEST_PROJECT_A_ID)
    expect(result.data.logDate).toBe(LOG_DATE)
    expect(result.data.columns.weather).toBe('cloudy')
    expect(result.data.columns.morning_plan).toBe('pour slab')
    expect(result.data.edits).toEqual({})
  })

  it('SCOPE GAP (read side): same-tenant non-member project -> not-found, indistinguishable from missing', async () => {
    const result = await getDailyLogDetail(jwtA, fx.profileAId, ROW_NONMEMBER)
    expect(result.status).toBe('not-found')
  })

  it('cross-tenant target -> not-found (blocked by RLS before membership is even checked)', async () => {
    const result = await getDailyLogDetail(jwtA, fx.profileAId, ROW_XTENANT)
    expect(result.status).toBe('not-found')
  })

  it('a genuinely nonexistent id -> not-found', async () => {
    const result = await getDailyLogDetail(jwtA, fx.profileAId, '00000000-0000-4000-a000-000000000000')
    expect(result.status).toBe('not-found')
  })

  it('latest edit per column: two edits to the same column -> only the newest survives in `edits`', async () => {
    const db = testClient()
    const older = new Date(Date.now() - 60_000).toISOString()
    const newer = new Date().toISOString()
    await db.from('daily_log_edits').insert([
      {
        tenant_id: TEST_TENANT_A_ID,
        daily_logs_id: ROW_MEMBER,
        project_id: TEST_PROJECT_A_ID,
        log_date: LOG_DATE,
        column_name: 'morning_plan',
        old_value: JSON.stringify('pour slab'),
        new_value: JSON.stringify('pour slab v1'),
        edited_by: fx.profileAId,
        created_at: older,
      },
      {
        tenant_id: TEST_TENANT_A_ID,
        daily_logs_id: ROW_MEMBER,
        project_id: TEST_PROJECT_A_ID,
        log_date: LOG_DATE,
        column_name: 'morning_plan',
        old_value: JSON.stringify('pour slab v1'),
        new_value: JSON.stringify('pour slab v2 — final'),
        edited_by: fx.profileAId,
        created_at: newer,
      },
    ])

    const result = await getDailyLogDetail(jwtA, fx.profileAId, ROW_MEMBER)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const edit = result.data.edits.morning_plan
    expect(edit).toBeDefined()
    expect(edit?.newValue).toBe('pour slab v2 — final')
    expect(edit?.oldValue).toBe('pour slab v1') // the NEWER edit's own old_value, not the original
    expect(edit?.editedByName).toBe('you') // edited_by === viewerId
  })
})
