import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
} from './helpers/db'

// B2 (DASH-03 review) — prove the board scopes by the resolved public.users.id,
// NOT the raw auth uid. Post-007 the two are DECOUPLED: getProfile() resolves the
// caller via `auth_id = auth.uid()` and returns users.id (see
// lib/auth/profile-query.ts), and getDailyLogsBoard filters
// project_members.user_id on THAT id. If anything conflated the two, a real PM
// (generated id, auth_id set, id ≠ auth uid) would see an empty board.
//
// Uses the two-tenant JWT fixtures (profileAId is the generated users.id;
// authUserAId is the auth uid — deliberately different). The board is read
// through a real user-JWT client so RLS + get_user_tenant_id() actually apply
// (service role would bypass both and prove nothing).

const LOG_DATE = '2026-07-18'
let engineerId: string

describe('DASH-03 board — scopes by resolved users.id, not auth uid (B2)', () => {
  let fx: TwoTenantFixtures
  let clientA: SupabaseClient

  beforeAll(async () => {
    fx = await ensureTwoTenantFixtures()
    const db = testClient() // service role, for seeding only

    // Sanity: the whole point of the test — the PM's profile id is NOT the auth uid.
    expect(fx.profileAId).not.toBe(fx.authUserAId)

    // profileA becomes a PM member of project A.
    const { error: pmErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (pmErr) throw new Error(`seed pm member failed: ${pmErr.message}`)

    // An engineer (ENG-01 shape: auth_id null, generated id) on the same project.
    const { data: eng, error: engErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        full_name: 'ZZ 007 Engineer A',
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (engErr || !eng) throw new Error(`seed engineer failed: ${engErr?.message ?? 'no row'}`)
    engineerId = eng.id

    const { error: memErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: engineerId, role: 'engineer' },
      { onConflict: 'project_id,user_id' },
    )
    if (memErr) throw new Error(`seed engineer member failed: ${memErr.message}`)

    // A daily_logs row: morning submitted, evening not.
    const { error: logErr } = await db.from('daily_logs').upsert(
      {
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE,
        morning_submitted_at: '2026-07-18T04:00:00Z',
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (logErr) throw new Error(`seed daily_log failed: ${logErr.message}`)

    clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
  })

  afterAll(async () => {
    const db = testClient()
    // daily_logs is not swept by removeTwoTenantFixtures — clear it first (FK).
    await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID)
    await removeTwoTenantFixtures()
  })

  it('the PM sees their project + engineer, keyed on the resolved users.id', async () => {
    const result = await getDailyLogsBoard(
      clientA as unknown as SupabaseClient<Database>,
      fx.profileAId, // the users.id, NOT authUserAId
      LOG_DATE,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    expect(board).toBeDefined()
    const eng = board!.engineers.find((e) => e.engineerId === engineerId)
    expect(eng).toBeDefined()
    // Compare as instants — PostgREST's timestamptz string format is not contractual.
    expect(new Date(eng!.log!.morning_submitted_at!).toISOString()).toBe('2026-07-18T04:00:00.000Z')
    expect(eng!.log?.evening_submitted_at).toBeNull()
  })

  it('passing the auth uid instead of the profile id yields NO board (the bug this guards)', async () => {
    const result = await getDailyLogsBoard(
      clientA as unknown as SupabaseClient<Database>,
      fx.authUserAId, // wrong id on purpose — proves the two are not interchangeable
      LOG_DATE,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)).toBeUndefined()
  })
})
