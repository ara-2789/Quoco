import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { selectDprPhotos, buildDprPhotoOverflowLine, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/lib/dpr/select-photos'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
} from './helpers/db'
import { getRunId, deriveRunScopedUuid } from './helpers/run-scoped-fixtures'

// Stage 4 (DPR photo attachments, S1-S7). Integration tests for
// selectDprPhotos against REAL test-db AND real Storage (this project's
// own standing practice for the photo-attachment class of test -- see
// test/hindrance-pm-notify-photos.test.ts for the identical discipline
// one consumer over). Kept in its own file, separate from test/
// owner-deliver-job.test.ts, because selectDprPhotos is deliberately one
// small, independently-testable function (Aravind's own instruction).
//
// F1/F2 (2026-09-16): same @sentry/nextjs mocking convention as
// test/unit/project-manager.test.ts (vi.hoisted + importOriginal, only
// capture* replaced) -- named-export mutation under ESM requires this
// shape, vi.spyOn cannot redefine it. Real test-db/Storage calls are
// otherwise untouched by this mock.
const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }))
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  return { ...actual, captureMessage: captureMessageMock }
})

beforeEach(() => {
  captureMessageMock.mockClear()
})

// F1 -- proves "no Storage download call" directly rather than only
// inferring it from an empty result: monkey-patches the real (cached,
// shared) testClient()'s own storage.from() to count download() calls,
// restored in a `finally` immediately after the one test that uses it, so
// no other test in this file (or a concurrently-running one, if any) sees
// the wrapped client for longer than that single await.
function withDownloadSpy(db: SupabaseClient) {
  let calls = 0
  const originalFrom = db.storage.from.bind(db.storage)
  db.storage.from = ((bucket: string) => {
    const api = originalFrom(bucket)
    const originalDownload = api.download.bind(api)
    api.download = ((...args: Parameters<typeof api.download>) => {
      calls++
      return originalDownload(...args)
    }) as typeof api.download
    return api
  }) as typeof db.storage.from
  return {
    getCalls: () => calls,
    restore: () => {
      db.storage.from = originalFrom
    },
  }
}

const SIBLING_PROJECT_ID = deriveRunScopedUuid(getRunId(), 'ZZ_DPR_PHOTO_SIBLING_PROJECT')
const LOG_DATE = '2026-09-20'

let engineerAId: string
let engineerBId: string

beforeAll(async () => {
  const db = testClient()
  const fixtures = await ensureTwoTenantFixtures()
  engineerAId = fixtures.profileAId
  engineerBId = fixtures.profileBId

  const { error } = await db
    .from('projects')
    .upsert({ id: SIBLING_PROJECT_ID, tenant_id: TEST_TENANT_A_ID, name: 'ZZ DPR photo sibling project', status: 'active' }, { onConflict: 'id' })
  if (error) throw new Error(`seed sibling project failed: ${error.message}`)
})

afterAll(async () => {
  const db = testClient()
  if (uploadedPaths.length > 0) await db.storage.from(PHOTO_BUCKET).remove(uploadedPaths)
  await db.from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_log_photos').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('hindrance_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('hindrance_photos').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('hindrances').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('hindrances').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('daily_logs').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('daily_logs').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('projects').delete().eq('id', SIBLING_PROJECT_ID)
  await removeTwoTenantFixtures()
})

const uploadedPaths: string[] = []

async function uploadPhoto(tenantId: string, sizeBytes: number): Promise<string> {
  const db = testClient()
  const bytes = new Uint8Array(sizeBytes).fill(1)
  const objectPath = `${tenantId}/dpr-photo-test/${randomUUID()}.jpg`
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(objectPath, Buffer.from(bytes), { contentType: 'image/jpeg' })
  if (error) throw new Error(`uploadPhoto failed: ${error.message}`)
  uploadedPaths.push(objectPath)
  return objectPath
}

async function seedDailyLog(
  tenantId: string,
  projectId: string,
  engineerId: string,
  logDate: string,
  eveningPhotosStatus: 'pending' | 'complete' | 'failed' | null = null,
): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .upsert(
      { tenant_id: tenantId, project_id: projectId, engineer_id: engineerId, log_date: logDate, evening_photos_status: eveningPhotosStatus },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedDailyLog failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedEveningPhoto(dailyLogId: string, tenantId: string, sizeBytes = 16): Promise<string> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId, sizeBytes)
  const { error } = await db
    .from('daily_log_photos')
    .insert({ tenant_id: tenantId, daily_log_id: dailyLogId, phase: 'evening', photo_url: objectPath, retention_class: 'evening_progress' })
  if (error) throw new Error(`seedEveningPhoto failed: ${error.message}`)
  return objectPath
}

async function seedMorningPhoto(dailyLogId: string, tenantId: string, sizeBytes = 16): Promise<string> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId, sizeBytes)
  const { error } = await db
    .from('daily_log_photos')
    .insert({ tenant_id: tenantId, daily_log_id: dailyLogId, phase: 'morning', photo_url: objectPath, retention_class: 'attendance' })
  if (error) throw new Error(`seedMorningPhoto failed: ${error.message}`)
  return objectPath
}

async function seedHindrance(
  tenantId: string,
  projectId: string,
  reportedBy: string,
  createdAtIst: string,
  photosStatus: 'pending' | 'complete' | 'failed' | null = null,
): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('hindrances')
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      reported_by: reportedBy,
      description: 'ZZ dpr-photo-selection test hindrance',
      timing: 'active',
      submitted_via: 'whatsapp_adhoc',
      created_at: createdAtIst,
      photos_status: photosStatus,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedHindrancePhoto(hindranceId: string, tenantId: string, sizeBytes = 16): Promise<string> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId, sizeBytes)
  const { error } = await db.from('hindrance_photos').insert({ tenant_id: tenantId, hindrance_id: hindranceId, photo_url: objectPath, retention_class: 'hindrance' })
  if (error) throw new Error(`seedHindrancePhoto failed: ${error.message}`)
  return objectPath
}

// F2 fixture helper -- the daily_log_photos/hindrance_photos row keeps
// pointing at objectPath (a real, already-inserted row), but the
// underlying Storage object is gone, so a real download attempt fails
// exactly the way an orphaned/corrupted upload would. Removing an
// already-broken path a second time in afterAll's cleanup is harmless
// (Supabase Storage's remove() is a no-op for a missing object).
async function breakPhoto(objectPath: string): Promise<void> {
  const db = testClient()
  const { error } = await db.storage.from(PHOTO_BUCKET).remove([objectPath])
  if (error) throw new Error(`breakPhoto failed: ${error.message}`)
}

describe('selectDprPhotos', () => {
  it('cross-project isolation (SAME tenant): a sibling project with evening + hindrance photos on the same date contributes nothing', async () => {
    const logDate = LOG_DATE
    const siblingLog = await seedDailyLog(TEST_TENANT_A_ID, SIBLING_PROJECT_ID, engineerAId, logDate)
    await seedEveningPhoto(siblingLog, TEST_TENANT_A_ID)
    const siblingHindrance = await seedHindrance(TEST_TENANT_A_ID, SIBLING_PROJECT_ID, engineerAId, `${logDate}T10:00:00+05:30`)
    await seedHindrancePhoto(siblingHindrance, TEST_TENANT_A_ID)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(0)
    expect(result.attachments).toHaveLength(0)
  })

  it('cross-tenant isolation: a project in a DIFFERENT tenant with evening + hindrance photos on the same date contributes nothing', async () => {
    const logDate = LOG_DATE
    const otherTenantLog = await seedDailyLog(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId, logDate)
    await seedEveningPhoto(otherTenantLog, TEST_TENANT_B_ID)
    const otherTenantHindrance = await seedHindrance(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId, `${logDate}T10:00:00+05:30`)
    await seedHindrancePhoto(otherTenantHindrance, TEST_TENANT_B_ID)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(0)
    expect(result.attachments).toHaveLength(0)
  })

  it('morning photos are NEVER attached -- only evening survives the phase filter', async () => {
    const logDate = '2026-09-21'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate)
    await seedMorningPhoto(dailyLog, TEST_TENANT_A_ID)
    await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(1)
    expect(result.attachedCount).toBe(1)
  })

  it('ordering: evening photos come before hindrance photos', async () => {
    const logDate = '2026-09-22'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate)
    const eveningPath = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    const hindrance = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`)
    const hindrancePath = await seedHindrancePhoto(hindrance, TEST_TENANT_A_ID)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.attachedCount).toBe(2)
    expect(result.attachments[0]!.filename).toBe(eveningPath.split('/').pop())
    expect(result.attachments[1]!.filename).toBe(hindrancePath.split('/').pop())
  })

  it('10-photo cap: 12 eligible evening photos attach exactly 10, overflow = 2', async () => {
    const logDate = '2026-09-23'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate)
    for (let i = 0; i < 12; i++) {
      await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    }

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(12)
    expect(result.attachedCount).toBe(MAX_ATTACHMENTS)
    expect(result.attachments).toHaveLength(10)
    expect(result.overflowCount).toBe(2)
  })

  it('15 MB cap: two ~8 MB photos -- only the first fits, the second overflows on bytes alone (well under the 10-count cap)', async () => {
    const logDate = '2026-09-24'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate)
    const EIGHT_MB = 8 * 1024 * 1024
    await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID, EIGHT_MB)
    await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID, EIGHT_MB)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(2)
    expect(result.attachedCount).toBe(1)
    expect(result.overflowCount).toBe(1)
    const totalBytes = result.attachments.reduce((sum, a) => sum + Buffer.byteLength(a.content, 'utf8'), 0)
    expect(totalBytes).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES)
  }, 60000)

  it('a hindrance whose report_date does NOT equal log_date is excluded (S6 -- no roll-forward)', async () => {
    const logDate = '2026-09-25'
    const laterDayHindrance = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, '2026-09-26T10:00:00+05:30')
    await seedHindrancePhoto(laterDayHindrance, TEST_TENANT_A_ID)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(0)
  })

  it('readiness: daily_logs.evening_photos_status="pending" -> photosReady=false', async () => {
    const logDate = '2026-09-27'
    await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'pending')

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.photosReady).toBe(false)
  })

  it('readiness: a matching hindrance with photos_status="pending" -> photosReady=false', async () => {
    const logDate = '2026-09-28'
    await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`, 'pending')

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.photosReady).toBe(false)
  })

  it('readiness: both complete/null -> photosReady=true', async () => {
    const logDate = '2026-09-29'
    await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`, 'complete')

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.photosReady).toBe(true)
  })

  // --- F1: readiness before download (Aravind, 2026-09-16) -------------

  it('F1: requireReady=true + evening_photos_status="pending" -> returns immediately, ZERO Storage download calls', async () => {
    const logDate = '2026-09-30'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'pending')
    // A real photo row exists -- if the gate didn't hold, this would be
    // downloaded. Its presence is what makes "zero download calls" a real
    // assertion rather than a vacuous one.
    await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)

    const db = testClient()
    const spy = withDownloadSpy(db)
    try {
      const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: true }, db)

      expect(result.photosReady).toBe(false)
      expect(result.attachments).toHaveLength(0)
      expect(result.eligibleCount).toBe(0)
      expect(result.attachedCount).toBe(0)
      expect(result.overflowCount).toBe(0)
      expect(spy.getCalls()).toBe(0)
    } finally {
      spy.restore()
    }
  })

  it('F1: requireReady=true + ready -> proceeds and downloads normally', async () => {
    const logDate = '2026-10-01'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const eveningPath = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)

    const db = testClient()
    const spy = withDownloadSpy(db)
    try {
      const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: true }, db)

      expect(result.photosReady).toBe(true)
      expect(result.attachedCount).toBe(1)
      expect(result.attachments[0]!.filename).toBe(eveningPath.split('/').pop())
      expect(spy.getCalls()).toBe(1)
    } finally {
      spy.restore()
    }
  })

  // --- F2: failed download = skip + alert, never block (Aravind, 2026-09-16) ---

  it('F2: one broken photo among valid ones is skipped, alerted via Sentry with the exact fingerprint, and does not block the rest', async () => {
    const logDate = '2026-10-02'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const brokenPath = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    const validPath = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    await breakPhoto(brokenPath)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(2)
    expect(result.attachedCount).toBe(1)
    expect(result.attachments[0]!.filename).toBe(validPath.split('/').pop())
    expect(result.overflowCount).toBe(1)

    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessageMock.mock.calls[0]
    expect(message).toBe('dpr-photo-attach: download failed')
    expect(options.level).toBe('error')
    expect(options.fingerprint).toEqual(['dpr-photo-attach', 'download_failed'])
    expect(options.tags).toEqual({ feature: 'owner-deliver' })
    expect(options.extra).toMatchObject({
      photoUrl: brokenPath,
      tenantId: TEST_TENANT_A_ID,
      projectId: TEST_PROJECT_A_ID,
      engineerId: engineerAId,
      logDate,
    })
    expect(options.extra).toHaveProperty('errorMessage')
    expect(JSON.stringify(options.extra)).not.toContain('base64')
    expect(Object.keys(options.extra)).not.toContain('content')
  })

  it('F2: a failed photo does not consume the 10-photo cap -- the next valid photo is attached', async () => {
    const logDate = '2026-10-03'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const brokenPath = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    await breakPhoto(brokenPath)
    const validPaths: string[] = []
    for (let i = 0; i < 10; i++) {
      validPaths.push(await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID))
    }

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(11)
    expect(result.attachedCount).toBe(10)
    expect(result.attachments.map((a) => a.filename)).toEqual(validPaths.map((p) => p.split('/').pop()))
    expect(result.overflowCount).toBe(1)
    expect(captureMessageMock).toHaveBeenCalledTimes(1)
  }, 30000)

  it('F2: forced send where EVERY photo fails -> attachments empty, overflow = full eligible count', async () => {
    const logDate = '2026-10-04'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const brokenPathA = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    const brokenPathB = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    await breakPhoto(brokenPathA)
    await breakPhoto(brokenPathB)

    const result = await selectDprPhotos({ tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }, { requireReady: false }, testClient())

    expect(result.eligibleCount).toBe(2)
    expect(result.attachments).toHaveLength(0)
    expect(result.attachedCount).toBe(0)
    expect(result.overflowCount).toBe(2)
    expect(captureMessageMock).toHaveBeenCalledTimes(2)
  })
})

describe('buildDprPhotoOverflowLine', () => {
  it('renders the exact approved-pending template, no link of any kind', () => {
    const line = buildDprPhotoOverflowLine(3)
    expect(line).toBe('3 more photo(s) from today were not attached.')
    expect(line).not.toMatch(/https?:\/\//)
  })
})
