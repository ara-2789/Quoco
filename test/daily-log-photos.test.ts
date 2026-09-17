import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { selectDailyLogPhotos, resolveDailyLogPhotoSections } from '@/lib/daily-logs/photos'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
} from './helpers/db'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D1/
// D3). Real test-db AND real Storage, same discipline as the Stage 4/5a
// B2 test files this one sits alongside. Fixture-seeding helpers below are
// local (not exported anywhere), same convention as
// test/dpr-photo-candidates.test.ts.

let engineerAId: string
let engineerBId: string

beforeAll(async () => {
  const fixtures = await ensureTwoTenantFixtures()
  engineerAId = fixtures.profileAId
  engineerBId = fixtures.profileBId

  const db = testClient()
  // R1 shape: users.role='admin' (already set by ensureTwoTenantFixtures)
  // PLUS project_members.role='pm' on the owning project -- the real-PM
  // shape, per the R1 revision (docs/reviews/stage5a-review-package.md §4
  // D3, verdict Q7).
  const { error: pmErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: engineerAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  if (pmErr) throw new Error(`seed pmA membership failed: ${pmErr.message}`)
})

afterAll(async () => {
  const db = testClient()
  if (uploadedPaths.length > 0) await db.storage.from(PHOTO_BUCKET).remove(uploadedPaths)
  await db.from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('daily_logs').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_logs').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await removeTwoTenantFixtures()
})

const uploadedPaths: string[] = []

async function uploadPhoto(tenantId: string): Promise<string> {
  const db = testClient()
  const objectPath = `${tenantId}/daily-log-photos-test/${randomUUID()}.jpg`
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(objectPath, Buffer.from(new Uint8Array(16).fill(1)), {
    contentType: 'image/jpeg',
  })
  if (error) throw new Error(`uploadPhoto failed: ${error.message}`)
  uploadedPaths.push(objectPath)
  return objectPath
}

async function seedDailyLog(tenantId: string, projectId: string, engineerId: string, logDate: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .upsert({ tenant_id: tenantId, project_id: projectId, engineer_id: engineerId, log_date: logDate }, { onConflict: 'project_id,engineer_id,log_date' })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedDailyLog failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedPhoto(
  dailyLogId: string,
  tenantId: string,
  phase: 'morning' | 'evening',
  receivedAt?: string,
): Promise<{ id: string; objectPath: string }> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId)
  const { data, error } = await db
    .from('daily_log_photos')
    .insert({
      tenant_id: tenantId,
      daily_log_id: dailyLogId,
      phase,
      photo_url: objectPath,
      retention_class: phase === 'morning' ? 'attendance' : 'evening_progress',
      ...(receivedAt ? { received_at: receivedAt } : {}),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedPhoto failed: ${error?.message ?? 'no row'}`)
  return { id: data.id, objectPath }
}

describe('selectDailyLogPhotos', () => {
  it('returns morning and evening photos split by phase, correct kind/expiresAt', async () => {
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-01')
    const morning = await seedPhoto(logId, TEST_TENANT_A_ID, 'morning')
    const evening = await seedPhoto(logId, TEST_TENANT_A_ID, 'evening')

    const db = testClient()
    const { data: morningRow } = await db.from('daily_log_photos').select('expires_at').eq('id', morning.id).single<{ expires_at: string }>()
    const { data: eveningRow } = await db.from('daily_log_photos').select('expires_at').eq('id', evening.id).single<{ expires_at: string }>()

    const result = await selectDailyLogPhotos({ tenantId: TEST_TENANT_A_ID, dailyLogId: logId }, db)
    expect(result.morning).toEqual([{ id: morning.id, kind: 'daily_log', expiresAt: morningRow!.expires_at }])
    expect(result.evening).toEqual([{ id: evening.id, kind: 'daily_log', expiresAt: eveningRow!.expires_at }])
  })

  it('zero photos on a real log: both lists empty', async () => {
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-02')
    const result = await selectDailyLogPhotos({ tenantId: TEST_TENANT_A_ID, dailyLogId: logId }, testClient())
    expect(result.morning).toEqual([])
    expect(result.evening).toEqual([])
  })

  it('tenant isolation: a tenant-B log id queried under tenant A returns nothing, even though the row exists', async () => {
    const logIdB = await seedDailyLog(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId, '2026-10-03')
    await seedPhoto(logIdB, TEST_TENANT_B_ID, 'morning')

    const result = await selectDailyLogPhotos({ tenantId: TEST_TENANT_A_ID, dailyLogId: logIdB }, testClient())
    expect(result.morning).toEqual([])
    expect(result.evening).toEqual([])
  })

  it('a tombstoned photo (photo_url set NULL) is excluded, a valid sibling still returned', async () => {
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-04')
    const tombstoned = await seedPhoto(logId, TEST_TENANT_A_ID, 'evening', new Date(Date.now() - 60_000).toISOString())
    const valid = await seedPhoto(logId, TEST_TENANT_A_ID, 'evening')

    const db = testClient()
    const { error } = await db.from('daily_log_photos').update({ photo_url: null }).eq('id', tombstoned.id)
    if (error) throw new Error(`tombstone update failed: ${error.message}`)

    const result = await selectDailyLogPhotos({ tenantId: TEST_TENANT_A_ID, dailyLogId: logId }, db)
    expect(result.evening.map((p) => p.id)).toEqual([valid.id])
  })
})

describe('resolveDailyLogPhotoSections (D3 gate)', () => {
  it('R1: the real-PM shape (users.role=admin, project_members.role=pm) sees both sections', async () => {
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-05')
    const morning = await seedPhoto(logId, TEST_TENANT_A_ID, 'morning')

    const db = testClient()
    const result = await resolveDailyLogPhotoSections(db, engineerAId, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, logId)
    expect(result).not.toBeNull()
    expect(result!.morning.map((p) => p.id)).toEqual([morning.id])
  })

  it('non-PM (no project_members row on this project): returns null, not an empty section', async () => {
    // engineerBId has no project_members row on TEST_PROJECT_A_ID at all.
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-06')
    await seedPhoto(logId, TEST_TENANT_A_ID, 'morning')

    const db = testClient()
    const result = await resolveDailyLogPhotoSections(db, engineerBId, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, logId)
    expect(result).toBeNull()
  })

  it('NULL-tenant caller: returns null even if isProjectPm somehow resolved true', async () => {
    const logId = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-10-07')
    await seedPhoto(logId, TEST_TENANT_A_ID, 'evening')

    const db = testClient()
    const result = await resolveDailyLogPhotoSections(db, engineerAId, null, TEST_PROJECT_A_ID, logId)
    expect(result).toBeNull()
  })
})
