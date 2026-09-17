import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { selectDprPhotoCandidates } from '@/lib/dpr/select-photo-candidates'
import { selectDprPhotos, MAX_ATTACHMENTS } from '@/lib/dpr/select-photos'
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

// Stage 5a, build slice B2 (docs/reviews/stage5a-review-package.md, D7;
// verdict Q3). New coverage for the shared "which photos" selector,
// selectDprPhotoCandidates (lib/dpr/select-photo-candidates.ts), split out
// of the old monolithic selectDprPhotos. Kept in its own file, separate
// from test/dpr-photo-selection.test.ts and test/owner-deliver-job.test.ts
// (D7's own hard condition: those two files get ZERO edits) -- everything
// this file needs from those files' own fixture-seeding conventions is
// re-declared locally, since nothing there is exported for reuse.
//
// Real test-db AND real Storage, same discipline as the Stage 4 test
// files this one sits alongside.

// --- gate-first proof (T3): spies on db.from(), the same monkey-patch
// technique test/dpr-photo-selection.test.ts's own withDownloadSpy already
// uses for db.storage.from() -- applied here to db.from() instead, scoped
// to the two candidate-photo table names only, so it can prove "zero
// candidate-row queries" without also having to (falsely) prove "zero
// queries of any kind" (the two allowed readiness queries, against
// daily_logs/hindrances, are not candidate-row queries). Purely an
// external spy on the `client` param selectDprPhotos already accepts for
// DI -- no production code changes, no test-only hook. ---
function withFromSpy(db: SupabaseClient, tableNames: string[]) {
  const calls: Record<string, number> = Object.fromEntries(tableNames.map((t) => [t, 0]))
  const originalFrom = db.from.bind(db)
  db.from = ((table: string) => {
    if (tableNames.includes(table)) calls[table] = (calls[table] ?? 0) + 1
    return originalFrom(table)
  }) as typeof db.from
  return {
    calls,
    restore: () => {
      db.from = originalFrom
    },
  }
}

const SIBLING_PROJECT_ID = deriveRunScopedUuid(getRunId(), 'ZZ_DPR_CANDIDATES_SIBLING_PROJECT')

let engineerAId: string
let engineerBId: string

beforeAll(async () => {
  const db = testClient()
  const fixtures = await ensureTwoTenantFixtures()
  engineerAId = fixtures.profileAId
  engineerBId = fixtures.profileBId

  const { error } = await db
    .from('projects')
    .upsert({ id: SIBLING_PROJECT_ID, tenant_id: TEST_TENANT_A_ID, name: 'ZZ DPR photo candidates sibling project', status: 'active' }, { onConflict: 'id' })
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

async function uploadPhoto(tenantId: string, sizeBytes = 16): Promise<string> {
  const db = testClient()
  const bytes = new Uint8Array(sizeBytes).fill(1)
  const objectPath = `${tenantId}/dpr-photo-candidates-test/${randomUUID()}.jpg`
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

async function seedEveningPhoto(dailyLogId: string, tenantId: string, receivedAt?: string): Promise<{ objectPath: string; id: string }> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId)
  const { data, error } = await db
    .from('daily_log_photos')
    .insert({
      tenant_id: tenantId,
      daily_log_id: dailyLogId,
      phase: 'evening',
      photo_url: objectPath,
      retention_class: 'evening_progress',
      ...(receivedAt ? { received_at: receivedAt } : {}),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedEveningPhoto failed: ${error?.message ?? 'no row'}`)
  return { objectPath, id: data.id }
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
      description: 'ZZ dpr-photo-candidates test hindrance',
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

async function seedHindrancePhoto(hindranceId: string, tenantId: string, receivedAt?: string): Promise<{ objectPath: string; id: string }> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId)
  const { data, error } = await db
    .from('hindrance_photos')
    .insert({
      tenant_id: tenantId,
      hindrance_id: hindranceId,
      photo_url: objectPath,
      retention_class: 'hindrance',
      ...(receivedAt ? { received_at: receivedAt } : {}),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrancePhoto failed: ${error?.message ?? 'no row'}`)
  return { objectPath, id: data.id }
}

describe('selectDprPhotoCandidates', () => {
  // --- T1: D2 agreement, including the >10-photo case -----------------
  it('T1: agrees with the email path on ids/order for the same key, including a >10-photo case where the selector returns all but the email attaches at most 10', async () => {
    const logDate = '2026-11-01'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const baseTime = Date.now()
    const eveningResults = await Promise.all(
      Array.from({ length: 12 }, (_, i) => seedEveningPhoto(dailyLog, TEST_TENANT_A_ID, new Date(baseTime + i).toISOString())),
    )
    const hindrance = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`, 'complete')
    const hindranceResults = await Promise.all(
      Array.from({ length: 3 }, (_, i) => seedHindrancePhoto(hindrance, TEST_TENANT_A_ID, new Date(baseTime + 1000 + i).toISOString())),
    )

    const params = { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }
    const candidates = await selectDprPhotoCandidates(params, testClient())
    const emailResult = await selectDprPhotos(params, { requireReady: false }, testClient())

    const expectedOrderIds = [...eveningResults.map((r) => r.id), ...hindranceResults.map((r) => r.id)]
    expect(candidates.map((c) => c.id)).toEqual(expectedOrderIds)
    expect(candidates).toHaveLength(15)

    expect(emailResult.eligibleCount).toBe(candidates.length)
    expect(emailResult.attachments).toHaveLength(MAX_ATTACHMENTS)
    expect(emailResult.attachments.map((a) => a.filename)).toEqual(
      candidates.slice(0, MAX_ATTACHMENTS).map((c) => c.photoUrl.split('/').pop()),
    )
  }, 90_000)

  // --- T2: D9 -- (a) ignores readiness; email path still gates --------
  it('T2: (a) returns photos even while a same-day hindrance is still pending; selectDprPhotos(requireReady=true) still reports not-ready for the same key', async () => {
    const logDate = '2026-11-02'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const evening = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    const hindrance = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`, 'pending')
    const hindrancePhoto = await seedHindrancePhoto(hindrance, TEST_TENANT_A_ID)

    const params = { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }

    const candidates = await selectDprPhotoCandidates(params, testClient())
    expect(candidates.map((c) => c.id)).toEqual([evening.id, hindrancePhoto.id])

    const emailResult = await selectDprPhotos(params, { requireReady: true }, testClient())
    expect(emailResult.photosReady).toBe(false)
    expect(emailResult.attachments).toHaveLength(0)
    expect(emailResult.eligibleCount).toBe(0)
    expect(emailResult.attachedCount).toBe(0)
    expect(emailResult.overflowCount).toBe(0)
  })

  // --- T3: gate-first proof --------------------------------------------
  it('T3: requireReady=true + not ready -> ZERO queries against daily_log_photos/hindrance_photos (gate-first, proven via a from() call-count spy)', async () => {
    const logDate = '2026-11-03'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'pending')
    // A real photo row exists -- if the gate didn't hold, selectDprPhotoCandidates
    // would find and return it. Its presence is what makes "zero candidate-row
    // queries" a real assertion rather than a vacuous one.
    await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)

    const db = testClient()
    const spy = withFromSpy(db, ['daily_log_photos', 'hindrance_photos'])
    try {
      const params = { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate }
      const result = await selectDprPhotos(params, { requireReady: true }, db)

      expect(result.photosReady).toBe(false)
      expect(result.attachments).toHaveLength(0)
      expect(result.eligibleCount).toBe(0)
      expect(result.attachedCount).toBe(0)
      expect(result.overflowCount).toBe(0)

      expect(spy.calls['daily_log_photos']).toBe(0)
      expect(spy.calls['hindrance_photos']).toBe(0)
    } finally {
      spy.restore()
    }
  })

  // --- T4: isolation, tombstones, kind/expiresAt correctness ----------
  it('T4: cross-project (same tenant) isolation contributes nothing', async () => {
    const logDate = '2026-11-04'
    const siblingLog = await seedDailyLog(TEST_TENANT_A_ID, SIBLING_PROJECT_ID, engineerAId, logDate)
    await seedEveningPhoto(siblingLog, TEST_TENANT_A_ID)
    const siblingHindrance = await seedHindrance(TEST_TENANT_A_ID, SIBLING_PROJECT_ID, engineerAId, `${logDate}T10:00:00+05:30`)
    await seedHindrancePhoto(siblingHindrance, TEST_TENANT_A_ID)

    const candidates = await selectDprPhotoCandidates(
      { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate },
      testClient(),
    )
    expect(candidates).toHaveLength(0)
  })

  it('T4: cross-tenant isolation contributes nothing', async () => {
    const logDate = '2026-11-05'
    const otherTenantLog = await seedDailyLog(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId, logDate)
    await seedEveningPhoto(otherTenantLog, TEST_TENANT_B_ID)
    const otherTenantHindrance = await seedHindrance(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId, `${logDate}T10:00:00+05:30`)
    await seedHindrancePhoto(otherTenantHindrance, TEST_TENANT_B_ID)

    const candidates = await selectDprPhotoCandidates(
      { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate },
      testClient(),
    )
    expect(candidates).toHaveLength(0)
  })

  it('T4: a tombstoned photo (photo_url set NULL) is excluded, valid siblings still returned', async () => {
    const logDate = '2026-11-06'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const tombstoned = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID, new Date(Date.now() - 60_000).toISOString())
    const valid = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)

    const db = testClient()
    const { error } = await db.from('daily_log_photos').update({ photo_url: null }).eq('id', tombstoned.id)
    if (error) throw new Error(`tombstone update failed: ${error.message}`)

    const candidates = await selectDprPhotoCandidates(
      { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate },
      testClient(),
    )
    expect(candidates.map((c) => c.id)).toEqual([valid.id])
  })

  it('T4: each candidate carries the correct kind and expiresAt matching the row', async () => {
    const logDate = '2026-11-07'
    const dailyLog = await seedDailyLog(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, logDate, 'complete')
    const evening = await seedEveningPhoto(dailyLog, TEST_TENANT_A_ID)
    const hindrance = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId, `${logDate}T10:00:00+05:30`, 'complete')
    const hindrancePhoto = await seedHindrancePhoto(hindrance, TEST_TENANT_A_ID)

    const db = testClient()
    const { data: eveningRow, error: eveningReadErr } = await db
      .from('daily_log_photos')
      .select('expires_at')
      .eq('id', evening.id)
      .single<{ expires_at: string }>()
    if (eveningReadErr || !eveningRow) throw new Error(`readback failed: ${eveningReadErr?.message}`)
    const { data: hindranceRow, error: hindranceReadErr } = await db
      .from('hindrance_photos')
      .select('expires_at')
      .eq('id', hindrancePhoto.id)
      .single<{ expires_at: string }>()
    if (hindranceReadErr || !hindranceRow) throw new Error(`readback failed: ${hindranceReadErr?.message}`)

    const candidates = await selectDprPhotoCandidates(
      { tenantId: TEST_TENANT_A_ID, projectId: TEST_PROJECT_A_ID, engineerId: engineerAId, logDate },
      testClient(),
    )
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({ id: evening.id, kind: 'daily_log', expiresAt: eveningRow.expires_at })
    expect(candidates[1]).toMatchObject({ id: hindrancePhoto.id, kind: 'hindrance', expiresAt: hindranceRow.expires_at })
  })
})
