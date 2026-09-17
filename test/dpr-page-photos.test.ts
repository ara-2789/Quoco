import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
} from './helpers/db'
import { resolveDprPhotoSections } from '@/lib/dpr/photo-sections'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D2/
// D3/D8/D9). Real test-db AND real Storage. resolveDprPhotoSections lives
// in lib/dpr/photo-sections.ts, not the page file, precisely so importing
// it under vitest never drags in 'server-only' via lib/auth/profile.ts
// (see that new file's own header).

let engineerAId: string
let engineerBId: string

beforeAll(async () => {
  const fixtures = await ensureTwoTenantFixtures()
  engineerAId = fixtures.profileAId
  engineerBId = fixtures.profileBId

  const db = testClient()
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
  await db.from('hindrance_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('hindrances').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_logs').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await removeTwoTenantFixtures()
})

const uploadedPaths: string[] = []

async function uploadPhoto(tenantId: string): Promise<string> {
  const db = testClient()
  const objectPath = `${tenantId}/dpr-page-photos-test/${randomUUID()}.jpg`
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(objectPath, Buffer.from(new Uint8Array(16).fill(1)), {
    contentType: 'image/jpeg',
  })
  if (error) throw new Error(`uploadPhoto failed: ${error.message}`)
  uploadedPaths.push(objectPath)
  return objectPath
}

async function seedDailyLog(projectId: string, engineerId: string, logDate: string, eveningPhotosStatus: 'pending' | 'complete' | null = null): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: projectId, engineer_id: engineerId, log_date: logDate, evening_photos_status: eveningPhotosStatus },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedDailyLog failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedEveningPhoto(dailyLogId: string): Promise<string> {
  const db = testClient()
  const objectPath = await uploadPhoto(TEST_TENANT_A_ID)
  const { data, error } = await db
    .from('daily_log_photos')
    .insert({ tenant_id: TEST_TENANT_A_ID, daily_log_id: dailyLogId, phase: 'evening', photo_url: objectPath, retention_class: 'evening_progress' })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedEveningPhoto failed: ${error?.message ?? 'no row'}`)
  return data.id
}

// report_date is a GENERATED column (derived from created_at's IST
// calendar date, migration 046) -- never insertable directly. Setting
// created_at to 10:00 IST on the target date is the same technique
// test/dpr-photo-candidates.test.ts's own seedHindrance already uses.
async function seedHindrance(projectId: string, reportedBy: string, reportDate: string, photosStatus: 'pending' | 'complete' | null = null): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('hindrances')
    .insert({
      tenant_id: TEST_TENANT_A_ID,
      project_id: projectId,
      reported_by: reportedBy,
      description: 'ZZ dpr-page-photos test hindrance',
      timing: 'active',
      submitted_via: 'whatsapp_adhoc',
      created_at: `${reportDate}T10:00:00+05:30`,
      photos_status: photosStatus,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedHindrancePhoto(hindranceId: string): Promise<string> {
  const db = testClient()
  const objectPath = await uploadPhoto(TEST_TENANT_A_ID)
  const { data, error } = await db
    .from('hindrance_photos')
    .insert({ tenant_id: TEST_TENANT_A_ID, hindrance_id: hindranceId, photo_url: objectPath, retention_class: 'hindrance' })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrancePhoto failed: ${error?.message ?? 'no row'}`)
  return data.id
}

describe('resolveDprPhotoSections', () => {
  it('a real PM sees Evening and Hindrance sublists, correctly split by kind', async () => {
    const logDate = '2026-11-11'
    const dailyLog = await seedDailyLog(TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const evening = await seedEveningPhoto(dailyLog)
    const hindrance = await seedHindrance(TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const hindrancePhoto = await seedHindrancePhoto(hindrance)

    const dpr = { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }
    const result = await resolveDprPhotoSections(testClient(), engineerAId, {
      tenant_id: dpr.tenantId,
      project_id: dpr.projectId,
      engineer_id: dpr.engineerId,
      log_date: dpr.logDate,
    })

    expect(result).not.toBeNull()
    expect(result!.evening.map((p) => p.id)).toEqual([evening])
    expect(result!.hindrance.map((p) => p.id)).toEqual([hindrancePhoto])
    expect(result!.evening.every((p) => p.kind === 'daily_log')).toBe(true)
    expect(result!.hindrance.every((p) => p.kind === 'hindrance')).toBe(true)
  })

  it('non-PM (no project_members row on this project): returns null', async () => {
    const logDate = '2026-11-12'
    const dailyLog = await seedDailyLog(TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    await seedEveningPhoto(dailyLog)

    // engineerBId has no project_members row on TEST_PROJECT_A_ID.
    const result = await resolveDprPhotoSections(testClient(), engineerBId, {
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: engineerAId,
      log_date: logDate,
    })
    expect(result).toBeNull()
  })

  it('D9: a same-day pending hindrance does not hide the completed evening photos', async () => {
    const logDate = '2026-11-13'
    const dailyLog = await seedDailyLog(TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const evening = await seedEveningPhoto(dailyLog)
    const hindrance = await seedHindrance(TEST_PROJECT_A_ID, engineerAId, logDate, 'pending')
    const hindrancePhoto = await seedHindrancePhoto(hindrance)

    const result = await resolveDprPhotoSections(testClient(), engineerAId, {
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: engineerAId,
      log_date: logDate,
    })
    expect(result).not.toBeNull()
    expect(result!.evening.map((p) => p.id)).toEqual([evening])
    // The shared selector (D7/D9) is indifferent to photos_status -- the
    // photo already uploaded for the pending hindrance still shows.
    expect(result!.hindrance.map((p) => p.id)).toEqual([hindrancePhoto])
  })

  it('zero photos for a real PM: returns the empty shape, not null (D8 "no section" is a rendering decision, not this function\'s)', async () => {
    const logDate = '2026-11-14'
    await seedDailyLog(TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')

    const result = await resolveDprPhotoSections(testClient(), engineerAId, {
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: engineerAId,
      log_date: logDate,
    })
    expect(result).toEqual({ evening: [], hindrance: [] })
  })

  it('cross-tenant isolation: a same-log_date tenant-B photo contributes nothing to tenant A\'s own key', async () => {
    // selectDprPhotoCandidates's own cross-tenant isolation is already
    // proven directly in test/dpr-photo-candidates.test.ts (B2, T4); this
    // confirms the page-level wrapper doesn't weaken it when a coincidentally
    // same log_date exists on both tenants.
    const sharedLogDate = '2026-11-16'
    const tenantBDailyLog = await testClient()
      .from('daily_logs')
      .upsert(
        { tenant_id: TEST_TENANT_B_ID, project_id: TEST_PROJECT_B_ID, engineer_id: engineerBId, log_date: sharedLogDate },
        { onConflict: 'project_id,engineer_id,log_date' },
      )
      .select('id')
      .single<{ id: string }>()
    if (tenantBDailyLog.error || !tenantBDailyLog.data) throw new Error('tenant B daily log seed failed')
    const objectPath = await uploadPhoto(TEST_TENANT_B_ID)
    const { error: photoErr } = await testClient()
      .from('daily_log_photos')
      .insert({ tenant_id: TEST_TENANT_B_ID, daily_log_id: tenantBDailyLog.data.id, phase: 'evening', photo_url: objectPath, retention_class: 'evening_progress' })
    if (photoErr) throw new Error(`tenant B photo seed failed: ${photoErr.message}`)

    await seedDailyLog(TEST_PROJECT_A_ID, engineerAId, sharedLogDate, 'complete')

    const result = await resolveDprPhotoSections(testClient(), engineerAId, {
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: engineerAId,
      log_date: sharedLogDate,
    })
    expect(result).toEqual({ evening: [], hindrance: [] })

    await testClient().from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_B_ID)
    await testClient().from('daily_logs').delete().eq('id', tenantBDailyLog.data.id)
  })
})
