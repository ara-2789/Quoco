import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SendEmailResult } from '@/lib/email/send'
import { handleHindrancePmNotifyJob } from '@/lib/hindrance/pm-notify'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
} from './helpers/db'

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §6). Covers the async
// race between the hindrance PM-notify email (enqueued synchronously at
// flow completion) and the hindrance_media_ingest job (async, may not
// have finished uploading yet) -- and Aravind's 2026-09-14 decision on
// how it resolves: retry while photos_status='pending' (reusing the job
// queue's own exponential backoff, no new hold-timer), then send WITHOUT
// photos once forced (never withhold the email).
//
// sendEmailFn is INJECTED (never a real Resend call) -- the real-send
// deliverability gate (docs/reviews/044-review-package.md) is a separate,
// one-off, credentialed script, not part of this repeatable suite.
// Storage downloads ARE real (against test-db's daily-log-photos bucket)
// -- this is the one behavior these tests exist to prove, alongside the
// retry/exhaustion branching itself.

describe('handleHindrancePmNotifyJob — photo attachment, retry-on-pending, forced exhaustion', () => {
  let pmAId: string

  beforeAll(async () => {
    const db = testClient()
    const fixtures = await ensureTwoTenantFixtures()
    pmAId = fixtures.profileAId
    const { error } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: pmAId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (error) throw new Error(`seed pmA membership failed: ${error.message}`)
  })

  afterAll(async () => {
    const db = testClient()
    await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID)
    await removeTwoTenantFixtures()
  })

  async function seedHindrance(overrides: { description: string; photosStatus: string | null }) {
    const db = testClient()
    const { data, error } = await db
      .from('hindrances')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        reported_by: pmAId,
        description: overrides.description,
        timing: 'active',
        submitted_via: 'whatsapp_adhoc',
        photos_status: overrides.photosStatus,
      })
      .select('id')
      .single<{ id: string }>()
    if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
    return data.id
  }

  async function seedPhoto(hindranceId: string, bytes: Uint8Array): Promise<string> {
    const db = testClient()
    const objectPath = `${TEST_TENANT_A_ID}/hindrance/${hindranceId}/${randomUUID()}.jpg`
    const { error: uploadErr } = await db.storage.from(PHOTO_BUCKET).upload(objectPath, Buffer.from(bytes), { contentType: 'image/jpeg' })
    if (uploadErr) throw new Error(`seedPhoto upload failed: ${uploadErr.message}`)
    const { error: insertErr } = await db.from('hindrance_photos').insert({
      tenant_id: TEST_TENANT_A_ID,
      hindrance_id: hindranceId,
      photo_url: objectPath,
      retention_class: 'hindrance',
    })
    if (insertErr) throw new Error(`seedPhoto insert failed: ${insertErr.message}`)
    return objectPath
  }

  async function cleanup(hindranceId: string, objectPaths: string[]) {
    const db = testClient()
    if (objectPaths.length > 0) await db.storage.from(PHOTO_BUCKET).remove(objectPaths)
    await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceId)
    await db.from('hindrances').delete().eq('id', hindranceId)
  }

  function fakeSendEmail(result: SendEmailResult = { ok: true, status: 200, id: 'em_test' }) {
    const calls: Array<{ to: string; subject: string; text: string; html: string; attachments?: unknown[] }> = []
    const fn = async (params: { to: string; subject: string; text: string; html: string; attachments?: unknown[] }) => {
      calls.push(params)
      return result
    }
    return { fn, calls }
  }

  it('photos_status="pending": throws a retryable error, sends NOTHING -- the job queue\'s own backoff is the wait mechanism', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify pending', photosStatus: 'pending' })
    const { fn, calls } = fakeSendEmail()
    try {
      await expect(
        handleHindrancePmNotifyJob({ hindrance_id: hindranceId }, { supabaseClient: testClient(), sendEmailFn: fn }),
      ).rejects.toThrow(/photos still uploading/)
      expect(calls).toHaveLength(0)
    } finally {
      await cleanup(hindranceId, [])
    }
  })

  it('photos_status="complete" with 2 real photos: sends with 2 attachments, "2 photos attached." line, real Storage bytes fetched', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify complete two photos', photosStatus: 'complete' })
    const path1 = await seedPhoto(hindranceId, new Uint8Array([0xff, 0xd8, 0xff, 1]))
    const path2 = await seedPhoto(hindranceId, new Uint8Array([0xff, 0xd8, 0xff, 2]))
    const { fn, calls } = fakeSendEmail()
    try {
      const result = await handleHindrancePmNotifyJob({ hindrance_id: hindranceId }, { supabaseClient: testClient(), sendEmailFn: fn })
      expect(result.outcome).toBe('sent')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.attachments).toHaveLength(2)
      expect(calls[0]!.text).toContain('2 photos attached.')
      expect(calls[0]!.html).toContain('2 photos attached.')

      const db = testClient()
      const { data: updated } = await db.from('hindrances').select('pm_notified_at').eq('id', hindranceId).single<{ pm_notified_at: string | null }>()
      expect(updated?.pm_notified_at).not.toBeNull()
    } finally {
      await cleanup(hindranceId, [path1, path2])
    }
  })

  it('photos_status=null (no photos ever sent): sends with no photoLine at all', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify no photos', photosStatus: null })
    const { fn, calls } = fakeSendEmail()
    try {
      await handleHindrancePmNotifyJob({ hindrance_id: hindranceId }, { supabaseClient: testClient(), sendEmailFn: fn })
      expect(calls[0]!.attachments).toBeUndefined()
      expect(calls[0]!.text).not.toContain('attached')
      expect(calls[0]!.text).not.toContain('uploading')
    } finally {
      await cleanup(hindranceId, [])
    }
  })

  it('forceSendWithoutPhotos=true with photos_status="pending": sends WITHOUT waiting, "still uploading" copy, no attachments -- Aravind\'s "never withhold the email" decision', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify forced pending', photosStatus: 'pending' })
    const { fn, calls } = fakeSendEmail()
    try {
      const result = await handleHindrancePmNotifyJob(
        { hindrance_id: hindranceId },
        { supabaseClient: testClient(), sendEmailFn: fn, forceSendWithoutPhotos: true },
      )
      expect(result.outcome).toBe('sent')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.attachments).toBeUndefined()
      expect(calls[0]!.text).toContain("Photos are still uploading — they'll be in the dashboard shortly.")
    } finally {
      await cleanup(hindranceId, [])
    }
  })

  it('forceSendWithoutPhotos=true with photos_status="failed": same "still uploading" copy, no attachments -- the ingest job itself dead-lettered', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify forced failed', photosStatus: 'failed' })
    const { fn, calls } = fakeSendEmail()
    try {
      await handleHindrancePmNotifyJob(
        { hindrance_id: hindranceId },
        { supabaseClient: testClient(), sendEmailFn: fn, forceSendWithoutPhotos: true },
      )
      expect(calls[0]!.attachments).toBeUndefined()
      expect(calls[0]!.text).toContain('still uploading')
    } finally {
      await cleanup(hindranceId, [])
    }
  })

  it('already_notified guard still fires even when photos_status is "pending" -- idempotency wins over the photo wait', async () => {
    const hindranceId = await seedHindrance({ description: 'ZZ pm-notify already notified', photosStatus: 'pending' })
    const db = testClient()
    await db.from('hindrances').update({ pm_notified_at: new Date().toISOString() }).eq('id', hindranceId)
    const { fn, calls } = fakeSendEmail()
    try {
      const result = await handleHindrancePmNotifyJob({ hindrance_id: hindranceId }, { supabaseClient: db, sendEmailFn: fn })
      expect(result.outcome).toBe('already_notified')
      expect(calls).toHaveLength(0)
    } finally {
      await cleanup(hindranceId, [])
    }
  })
})
