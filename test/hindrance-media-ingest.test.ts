import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { handleHindranceMediaIngestJob, markHindranceMediaIngestFailed, HINDRANCE_RETENTION_DAYS } from '@/lib/media/hindrance-ingest'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { testClient, TEST_TENANT_ID, TEST_PROJECT_ID, testEngineerId, ensureMorningFixtures, removeMorningFixtures } from './helpers/db'

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §4). Mirrors test/media-
// ingest.test.ts's own retention/failure coverage, one table over --
// hindrance_photos has exactly one retention class (60 days, no `phase`
// concept), so there is one expiry case here, not two.

const fakeFetch: typeof fetch = (async () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg' },
  })) as unknown as typeof fetch

async function seedHindrance(description: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('hindrances')
    .insert({
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      reported_by: testEngineerId(),
      description,
      timing: 'active',
      submitted_via: 'whatsapp_adhoc',
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function cleanupHindrance(hindranceId: string) {
  const db = testClient()
  const { data: rows } = await db.from('hindrance_photos').select('id, photo_url').eq('hindrance_id', hindranceId)
  for (const row of rows ?? []) {
    if (row.photo_url) await db.storage.from(PHOTO_BUCKET).remove([row.photo_url])
  }
  await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceId)
  await db.from('hindrances').delete().eq('id', hindranceId)
}

beforeAll(async () => {
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
  vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
  vi.unstubAllEnvs()
})

describe('handleHindranceMediaIngestJob — download, upload, insert', () => {
  it('inserts one hindrance_photos row per media item, path convention {tenant}/hindrance/{hindrance_id}/{photo_id}.ext, sets photos_status=complete', async () => {
    const hindranceId = await seedHindrance('ZZ hindrance-media-ingest happy path')
    try {
      const { inserted } = await handleHindranceMediaIngestJob(
        {
          tenant_id: TEST_TENANT_ID,
          hindrance_id: hindranceId,
          caption: 'crack near column B',
          media: [
            { url: 'https://api.twilio.com/media/ZZHindrance0', contentType: 'image/jpeg' },
            { url: 'https://api.twilio.com/media/ZZHindrance1', contentType: 'image/png' },
          ],
        },
        { supabaseClient: testClient(), fetchFn: fakeFetch },
      )
      expect(inserted).toBe(2)

      const db = testClient()
      const { data: photos } = await db
        .from('hindrance_photos')
        .select('photo_url, caption, retention_class, expires_at, received_at')
        .eq('hindrance_id', hindranceId)
      expect(photos).toHaveLength(2)

      for (const photo of photos ?? []) {
        expect(photo.photo_url).toMatch(new RegExp(`^${TEST_TENANT_ID}/hindrance/${hindranceId}/[0-9a-f-]+\\.(jpg|png)$`))
        expect(photo.caption).toBe('crack near column B')
        expect(photo.retention_class).toBe('hindrance')
        const diffDays = (new Date(photo.expires_at).getTime() - new Date(photo.received_at).getTime()) / (24 * 60 * 60 * 1000)
        expect(diffDays).toBeCloseTo(HINDRANCE_RETENTION_DAYS, 5)
      }

      const { data: hindrance } = await db
        .from('hindrances')
        .select('photos_status')
        .eq('id', hindranceId)
        .single<{ photos_status: string | null }>()
      expect(hindrance?.photos_status).toBe('complete')
    } finally {
      await cleanupHindrance(hindranceId)
    }
  })

  it('null caption is stored as null, not the empty string', async () => {
    const hindranceId = await seedHindrance('ZZ hindrance-media-ingest no caption')
    try {
      await handleHindranceMediaIngestJob(
        { tenant_id: TEST_TENANT_ID, hindrance_id: hindranceId, caption: null, media: [{ url: 'https://api.twilio.com/media/ZZNoCaption', contentType: 'image/jpeg' }] },
        { supabaseClient: testClient(), fetchFn: fakeFetch },
      )
      const db = testClient()
      const { data: photo } = await db
        .from('hindrance_photos')
        .select('caption')
        .eq('hindrance_id', hindranceId)
        .single<{ caption: string | null }>()
      expect(photo?.caption).toBeNull()
    } finally {
      await cleanupHindrance(hindranceId)
    }
  })
})

describe('hindrance_media_ingest — failure and dead-letter', () => {
  it('handleHindranceMediaIngestJob throws on a Twilio download failure, before touching Storage or hindrance_photos', async () => {
    const failingFetch: typeof fetch = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch

    await expect(
      handleHindranceMediaIngestJob(
        { tenant_id: TEST_TENANT_ID, hindrance_id: randomUUID(), caption: null, media: [{ url: 'https://api.twilio.com/media/ZZWillFail', contentType: 'image/jpeg' }] },
        { supabaseClient: testClient(), fetchFn: failingFetch },
      ),
    ).rejects.toThrow(/Twilio download failed/)
  })

  it('markHindranceMediaIngestFailed records hindrances.photos_status = failed -- the fact handleHindrancePmNotifyJob\'s own exhaustion path depends on', async () => {
    const hindranceId = await seedHindrance('ZZ hindrance-media-ingest dead-letter')
    try {
      const db = testClient()
      await markHindranceMediaIngestFailed(
        db,
        { tenant_id: TEST_TENANT_ID, hindrance_id: hindranceId, caption: null, media: [{ url: 'https://api.twilio.com/media/ZZDeadLetter', contentType: 'image/jpeg' }] },
        'exhausted retries: Twilio download failed (503)',
      )
      const { data: updated } = await db
        .from('hindrances')
        .select('photos_status')
        .eq('id', hindranceId)
        .single<{ photos_status: string | null }>()
      expect(updated?.photos_status).toBe('failed')
    } finally {
      await cleanupHindrance(hindranceId)
    }
  })
})
