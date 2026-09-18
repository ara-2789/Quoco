import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
} from './helpers/db'

// UI slice 5 (Aravind, 2026-09-18). Real test-db proof for getDailyLogsBoard's
// own NEW photoOptions gate (lib/daily-logs/query.ts) -- the actual
// access-control logic behind the "gated by isProjectPm exactly as the
// detail page is" requirement. This is a DIFFERENT, additional proof from
// test/daily-log-card-photo-gate-render.test.ts's own rendered-output
// test: that one proves the COMPONENT (HalfColumn) renders no markup for
// a null photoSections; this one proves the QUERY actually PRODUCES null
// for a real non-PM viewer, against a real database with a real photo row
// present -- the same testClient()-as-service-role-with-an-explicit-
// viewerId style test/daily-log-photos.test.ts's own "resolveDailyLogPhotoSections
// (D3 gate)" describe block already uses for the identical class of gate
// on the detail page's own query, one level up (the whole board, not one
// log).

const LOG_DATE = '2026-07-22'
let engineerId: string
let nonPmMemberId: string
let logId: string
let uploadedPath: string
let pmUserId: string

beforeAll(async () => {
  const fx: TwoTenantFixtures = await ensureTwoTenantFixtures()
  pmUserId = fx.profileAId
  const db = testClient()

  // profileA becomes a real PM member of project A (R1 shape: project_members.role='pm').
  const { error: pmErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  if (pmErr) throw new Error(`seed pm member failed: ${pmErr.message}`)

  // A distinct, non-PM viewer with a REAL project_members row on the SAME
  // project (role='qs') -- proves the gate is isProjectPm's own role='pm'
  // check, not merely "has any project_members row at all" (which the
  // board's own project-scoping query at the top of getDailyLogsBoard
  // already treats as sufficient for READ access to the board itself).
  const { data: qsUser, error: qsErr } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_A_ID,
      full_name: 'ZZ 007 QS A (slice 5 photo gate)',
      role: 'qs',
      status: 'active',
      messaging_blocked: false,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (qsErr || !qsUser) throw new Error(`seed qs user failed: ${qsErr?.message ?? 'no row'}`)
  nonPmMemberId = qsUser.id

  const { error: qsMemberErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: nonPmMemberId, role: 'qs' },
    { onConflict: 'project_id,user_id' },
  )
  if (qsMemberErr) throw new Error(`seed qs member failed: ${qsMemberErr.message}`)

  // An engineer (ENG-01 shape) on the same project, with a daily_logs row for LOG_DATE.
  const { data: eng, error: engErr } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_A_ID,
      full_name: 'ZZ 007 Engineer A (slice 5 photo gate)',
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

  const { data: log, error: logErr } = await db
    .from('daily_logs')
    .upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, engineer_id: engineerId, log_date: LOG_DATE },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .single<{ id: string }>()
  if (logErr || !log) throw new Error(`seed daily_log failed: ${logErr?.message ?? 'no row'}`)
  logId = log.id

  // A real morning photo on that log -- present in the database either way;
  // whether it ever reaches the caller is exactly what this test checks.
  uploadedPath = `${TEST_TENANT_A_ID}/board-photo-gate-test/${randomUUID()}.jpg`
  const { error: uploadErr } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(uploadedPath, Buffer.from(new Uint8Array(16).fill(1)), { contentType: 'image/jpeg' })
  if (uploadErr) throw new Error(`uploadPhoto failed: ${uploadErr.message}`)

  const { error: photoErr } = await db.from('daily_log_photos').insert({
    tenant_id: TEST_TENANT_A_ID,
    daily_log_id: logId,
    phase: 'morning',
    photo_url: uploadedPath,
    retention_class: 'attendance',
  })
  if (photoErr) throw new Error(`seed photo failed: ${photoErr.message}`)
})

afterAll(async () => {
  const db = testClient()
  await db.storage.from(PHOTO_BUCKET).remove([uploadedPath])
  await db.from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID)
  await removeTwoTenantFixtures()
})

describe('getDailyLogsBoard — photoOptions gate (UI slice 5)', () => {
  it('a real PM (project_members.role=pm) sees the real photo, via photoOptions', async () => {
    const result = await getDailyLogsBoard(
      testClient() as unknown as SupabaseClient<Database>,
      pmUserId,
      LOG_DATE,
      { tenantId: TEST_TENANT_A_ID },
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    const eng = board?.engineers.find((e) => e.engineerId === engineerId)
    expect(eng?.photoSections).not.toBeNull()
    expect(eng?.photoSections?.morning).toHaveLength(1)
    expect(eng?.photoSections?.evening).toHaveLength(0)
  })

  it('a real project_members row that is NOT role=pm (role=qs): photoSections is null, even though the photo genuinely exists', async () => {
    const result = await getDailyLogsBoard(
      testClient() as unknown as SupabaseClient<Database>,
      nonPmMemberId,
      LOG_DATE,
      { tenantId: TEST_TENANT_A_ID },
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    const eng = board?.engineers.find((e) => e.engineerId === engineerId)
    // The board itself is still visible (read access is role-agnostic) --
    // only the photo section is gated.
    expect(board).toBeDefined()
    expect(eng?.photoSections).toBeNull()
  })

  it('omitting photoOptions entirely (the Today page\'s own call shape): photoSections is undefined, no photo query runs at all', async () => {
    const result = await getDailyLogsBoard(testClient() as unknown as SupabaseClient<Database>, pmUserId, LOG_DATE)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    const eng = board?.engineers.find((e) => e.engineerId === engineerId)
    expect(eng?.photoSections).toBeUndefined()
  })
})
