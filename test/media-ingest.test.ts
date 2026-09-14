import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { routeInboundMessage } from '@/lib/whatsapp/inbound-start'
import { handleMediaIngestJob, markMediaIngestFailed, RETENTION_DAYS } from '@/lib/media/ingest'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { MORNING_QUESTIONS } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS } from '@/lib/whatsapp/flows/evening'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  seedSession,
  seedDailyLogSubmission,
  getDailyLog,
  testPhone,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  testEngineerId,
} from './helpers/db'

// Stage 1 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage1-photo-intake-plan.md). Covers the three
// cases the T-WH-13 rewrite (test/webhook.test.ts) does not:
//   - a captioned photo (caption reaches the parser AND is stored on the
//     photo's own job payload -- item 12)
//   - a burst of several photos in ONE turn (all stored, one reply -- item 13)
//   - retention class / expires_at, stamped at insert time (item 15) --
//     REQUIRES migration 043 (daily_log_photos) actually applied. If that
//     table does not exist on the target database, this describe block's
//     own beforeAll throws immediately and vitest reports every case in it
//     as a real failure, not a skip -- see this file's own report for
//     whether that happened.
//   - a failed ingest recorded as failed (the Twilio-download-failure path
//     never touches daily_log_photos at all, so it runs regardless of
//     whether migration 043 is applied)

const LOG_DATE = '2026-08-21'
const NOW = `${LOG_DATE}T12:00:00+05:30`

function baseParams(phone: string, message: string, media?: { url: string; contentType: string }[]) {
  return {
    phoneNumber: phone,
    tenantId: TEST_TENANT_ID,
    userId: testEngineerId(),
    projectId: TEST_PROJECT_ID,
    message,
    now: NOW,
    ...(media !== undefined ? { media } : {}),
    supabaseClient: testClient(),
  }
}

async function mediaIngestJobsFor(dailyLogId: string, phase: 'morning' | 'evening') {
  const db = testClient()
  const { data, error } = await db
    .from('jobs')
    .select('payload')
    .eq('type', 'media_ingest')
    .contains('payload', { daily_log_id: dailyLogId, phase })
  if (error) throw new Error(`mediaIngestJobsFor failed: ${error.message}`)
  return data ?? []
}

beforeAll(async () => {
  await ensureMorningFixtures()
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('routeInboundMessage — captioned photo (item 12)', () => {
  it('a caption that parses as a valid answer reaches the parser AND is stored on the job payload', async () => {
    const phone = testPhone('828')
    await seedDailyLogSubmission({ logDate: LOG_DATE })
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 2, // workers by trade -- parsed, gated
      context: {},
      updatedAt: NOW,
    })

    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, '8 masons', [
        { url: 'https://api.twilio.com/media/ZZTestCaptioned', contentType: 'image/jpeg' },
      ]),
    )

    expect(resolvedFlow).toBe('evening')
    // The caption parsed as a valid answer -- the step ADVANCES, exactly as
    // an ordinary text-only "8 masons" reply would (item 12: no RPC changes
    // needed, this falls out of not eating the message first).
    expect(reply).toBe(EVENING_QUESTIONS[3])

    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_manpower).toBeTruthy()

    const dailyLog = await getDailyLog(LOG_DATE)
    expect(dailyLog).not.toBeNull()
    // Find the daily_log_id the same way the interceptor does, to query jobs.
    const db = testClient()
    const { data: row } = await db
      .from('daily_logs')
      .select('id')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('engineer_id', testEngineerId())
      .eq('log_date', LOG_DATE)
      .single<{ id: string }>()
    const jobs = await mediaIngestJobsFor(row!.id, 'evening')
    expect(jobs.length).toBe(1)
    const payload = jobs[0].payload as { caption: string | null; media: unknown[] }
    expect(payload.caption).toBe('8 masons')
    expect(payload.media).toHaveLength(1)
  })
})

describe('routeInboundMessage — burst of several photos in one turn (item 13)', () => {
  it('all photos in one inbound message are stored as a single job, with the turn\'s own natural reply and no per-photo acknowledgement', async () => {
    const phone = testPhone('829')
    await seedDailyLogSubmission({ logDate: LOG_DATE })
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 3, // workers by trade -- parsed, gated
      context: {},
      updatedAt: NOW,
    })

    const media = [
      { url: 'https://api.twilio.com/media/ZZBurst0', contentType: 'image/jpeg' },
      { url: 'https://api.twilio.com/media/ZZBurst1', contentType: 'image/jpeg' },
      { url: 'https://api.twilio.com/media/ZZBurst2', contentType: 'image/png' },
    ]
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, '12 mason 8 helper', media))

    expect(resolvedFlow).toBe('morning')
    // The turn's own natural reply -- caption parsed as a valid labour
    // answer, step advances. No photo-specific text anywhere in it.
    expect(reply).toBe(MORNING_QUESTIONS[4])
    expect(reply).not.toContain('photo')

    const db = testClient()
    const { data: row } = await db
      .from('daily_logs')
      .select('id')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('engineer_id', testEngineerId())
      .eq('log_date', LOG_DATE)
      .single<{ id: string }>()
    const jobs = await mediaIngestJobsFor(row!.id, 'morning')
    // ONE job for this one turn, carrying all three media items -- not
    // three separate jobs.
    expect(jobs.length).toBe(1)
    const payload = jobs[0].payload as { media: unknown[] }
    expect(payload.media).toHaveLength(3)
  })
})

describe('handleMediaIngestJob — retention class stamped at insert, expires_at generated (item 15)', () => {
  // REQUIRES migration 043 (daily_log_photos) applied on the target
  // database. If it is not, the INSERT below fails with a real Postgres
  // error ("relation does not exist") and these tests report that failure
  // directly -- not silently skipped.
  //
  // expires_at is a GENERATED STORED column (external review round 1, item
  // 2) -- handleMediaIngestJob no longer computes or supplies it (see
  // ingest.ts's own insert call). The two cases below therefore assert the
  // DATABASE's own computed value, read back after insert, not a value this
  // job constructed -- RETENTION_DAYS here is only the expected reference
  // the readback is checked against, mirroring the migration's CASE
  // expression by convention, not a shared source of truth with it.
  async function seedDailyLog(logDate: string): Promise<string> {
    await seedDailyLogSubmission({ logDate })
    const db = testClient()
    const { data } = await db
      .from('daily_logs')
      .select('id')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('engineer_id', testEngineerId())
      .eq('log_date', logDate)
      .single<{ id: string }>()
    return data!.id
  }

  async function cleanupPhotos(dailyLogId: string) {
    const db = testClient()
    const { data: rows } = await db
      .from('daily_log_photos')
      .select('id, photo_url')
      .eq('daily_log_id', dailyLogId)
    for (const row of rows ?? []) {
      if (row.photo_url) await db.storage.from(PHOTO_BUCKET).remove([row.photo_url])
    }
    await db.from('daily_log_photos').delete().eq('daily_log_id', dailyLogId)
  }

  const fakeFetch: typeof fetch = (async () =>
    new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    })) as unknown as typeof fetch

  it('morning: retention_class="attendance", expires_at = received_at + 7 days', async () => {
    const dailyLogId = await seedDailyLog('2026-08-22')
    try {
      const before = Date.now()
      const { inserted } = await handleMediaIngestJob(
        {
          tenant_id: TEST_TENANT_ID,
          daily_log_id: dailyLogId,
          phase: 'morning',
          caption: null,
          media: [{ url: 'https://api.twilio.com/media/ZZRetentionMorning', contentType: 'image/jpeg' }],
        },
        { supabaseClient: testClient(), fetchFn: fakeFetch },
      )
      expect(inserted).toBe(1)

      const db = testClient()
      const { data: photo } = await db
        .from('daily_log_photos')
        .select('retention_class, expires_at, received_at')
        .eq('daily_log_id', dailyLogId)
        .single<{ retention_class: string; expires_at: string; received_at: string }>()
      if (!photo) throw new Error('expected a daily_log_photos row')

      expect(photo.retention_class).toBe('attendance')
      const expiresMs = new Date(photo.expires_at).getTime()
      const receivedMs = new Date(photo.received_at).getTime()
      const diffDays = (expiresMs - receivedMs) / (24 * 60 * 60 * 1000)
      expect(diffDays).toBeCloseTo(RETENTION_DAYS.morning, 5)
      expect(receivedMs).toBeGreaterThanOrEqual(before)
    } finally {
      await cleanupPhotos(dailyLogId)
    }
  })

  it('evening: retention_class="evening_progress", expires_at = received_at + 60 days', async () => {
    const dailyLogId = await seedDailyLog('2026-08-23')
    try {
      const { inserted } = await handleMediaIngestJob(
        {
          tenant_id: TEST_TENANT_ID,
          daily_log_id: dailyLogId,
          phase: 'evening',
          caption: 'work done',
          media: [{ url: 'https://api.twilio.com/media/ZZRetentionEvening', contentType: 'image/png' }],
        },
        { supabaseClient: testClient(), fetchFn: fakeFetch },
      )
      expect(inserted).toBe(1)

      const db = testClient()
      const { data: photo } = await db
        .from('daily_log_photos')
        .select('retention_class, expires_at, received_at, caption')
        .eq('daily_log_id', dailyLogId)
        .single<{ retention_class: string; expires_at: string; received_at: string; caption: string | null }>()
      if (!photo) throw new Error('expected a daily_log_photos row')

      expect(photo.retention_class).toBe('evening_progress')
      const diffDays =
        (new Date(photo.expires_at).getTime() - new Date(photo.received_at).getTime()) / (24 * 60 * 60 * 1000)
      expect(diffDays).toBeCloseTo(RETENTION_DAYS.evening, 5)
      expect(photo.caption).toBe('work done')

      const dailyLog = await db
        .from('daily_logs')
        .select('evening_photos_status')
        .eq('id', dailyLogId)
        .single<{ evening_photos_status: string | null }>()
      expect(dailyLog.data?.evening_photos_status).toBe('complete')
    } finally {
      await cleanupPhotos(dailyLogId)
    }
  })
})

describe('media_ingest — failed ingest recorded as failed', () => {
  it('handleMediaIngestJob throws on a Twilio download failure, before touching Storage or daily_log_photos', async () => {
    const failingFetch: typeof fetch = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch

    await expect(
      handleMediaIngestJob(
        {
          tenant_id: TEST_TENANT_ID,
          daily_log_id: randomUUID(), // never reached -- the download fails first
          phase: 'morning',
          caption: null,
          media: [{ url: 'https://api.twilio.com/media/ZZWillFail', contentType: 'image/jpeg' }],
        },
        { supabaseClient: testClient(), fetchFn: failingFetch },
      ),
    ).rejects.toThrow(/Twilio download failed/)
  })

  it('markMediaIngestFailed records daily_logs.{phase}_photos_status = failed', async () => {
    await seedDailyLogSubmission({ logDate: '2026-08-24' })
    const db = testClient()
    const { data: row } = await db
      .from('daily_logs')
      .select('id')
      .eq('project_id', TEST_PROJECT_ID)
      .eq('engineer_id', testEngineerId())
      .eq('log_date', '2026-08-24')
      .single<{ id: string }>()

    await markMediaIngestFailed(
      db,
      {
        tenant_id: TEST_TENANT_ID,
        daily_log_id: row!.id,
        phase: 'evening',
        caption: null,
        media: [{ url: 'https://api.twilio.com/media/ZZDeadLetter', contentType: 'image/jpeg' }],
      },
      'exhausted retries: Twilio download failed (503)',
    )

    const { data: updated } = await db
      .from('daily_logs')
      .select('evening_photos_status')
      .eq('id', row!.id)
      .single<{ evening_photos_status: string | null }>()
    expect(updated?.evening_photos_status).toBe('failed')
  })
})
