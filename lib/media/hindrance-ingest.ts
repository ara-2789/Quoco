import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { readCredentials } from '@/lib/whatsapp/outbound/send'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import type { MediaItem } from '@/lib/whatsapp/media-reply'

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage2-hindrance-photos-plan.md). The
// `hindrance_media_ingest` job handler -- a SIBLING of `media_ingest`
// (lib/media/ingest.ts), not a branch inside it: different target table
// (hindrance_photos, not daily_log_photos), no `phase` concept, one fixed
// retention class (60 days). Reuses the SAME bucket as media_ingest
// (`daily-log-photos` -- Aravind's 2026-09-14 decision: a second bucket
// would duplicate lib/storage/photo-access.ts's own access-barrier risk
// rather than share it), under an EXTENDED path convention:
// {tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext} -- four segments,
// the literal string "hindrance" disambiguating from media_ingest's own
// three-segment {tenant_id}/{daily_log_id}/{photo_id}.{ext} convention.
//
// A photo NEVER reaches this job for a hindrance BEFORE the parent row
// exists (Q1/Q2 open) -- Aravind's 2026-09-14 decision, docs/plans/
// stage2-hindrance-photos-plan.md "DECISIONS" item 1: such a photo is not
// stored at all, told, re-asked, by lib/whatsapp/inbound-start.ts's own
// hindrance photo branch, which never enqueues this job for that case.
// Every payload this handler ever processes already carries a real
// hindrance_id.

const RETENTION_DAYS = 60

function extensionForContentType(contentType: string): string {
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  return '.jpg'
}

export interface HindranceMediaIngestJobPayload {
  tenant_id: string
  hindrance_id: string
  /** The turn's Body, if any -- stored ONLY here, on the photo row, per
   * item 12 (reversed): never passed to the answer parser. Null when the
   * photo arrived with no accompanying text. */
  caption: string | null
  media: MediaItem[]
}

/**
 * Process one hindrance_media_ingest job: download every item from
 * Twilio, upload each to Storage, insert one hindrance_photos row per
 * item. Same retry/partial-success posture as handleMediaIngestJob
 * (lib/media/ingest.ts) -- throws on the FIRST failure, lib/queue/jobs.ts's
 * own exponential-backoff retry (NFR-17) is the recovery mechanism, and a
 * partial success is accepted, not rolled back (photo_id is freshly
 * generated per attempt, so a retry never collides with an earlier
 * attempt's own rows).
 */
export async function handleHindranceMediaIngestJob(
  payload: HindranceMediaIngestJobPayload,
  deps: {
    supabaseClient?: SupabaseClient
    fetchFn?: typeof fetch
  } = {},
): Promise<{ inserted: number }> {
  const supabase = deps.supabaseClient ?? createServiceClient()
  const fetchFn = deps.fetchFn ?? fetch
  const { accountSid, authToken } = readCredentials()
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const receivedAt = new Date()

  let inserted = 0
  for (const item of payload.media) {
    const twilioRes = await fetchFn(item.url, {
      headers: { Authorization: `Basic ${basicAuth}` },
    })
    if (!twilioRes.ok) {
      throw new Error(
        `handleHindranceMediaIngestJob: Twilio download failed for hindrance ${payload.hindrance_id} (${twilioRes.status})`,
      )
    }
    const bytes = Buffer.from(await twilioRes.arrayBuffer())

    const photoId = randomUUID()
    const objectPath = `${payload.tenant_id}/hindrance/${payload.hindrance_id}/${photoId}${extensionForContentType(item.contentType)}`

    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(objectPath, bytes, { contentType: item.contentType, upsert: false })
    if (uploadError) {
      throw new Error(
        `handleHindranceMediaIngestJob: Storage upload failed for ${objectPath}: ${uploadError.message}`,
      )
    }

    // expires_at is NOT supplied here -- it is a GENERATED STORED column
    // (044_hindrance_photos.sql), computed from received_at (fixed 60-day
    // interval, one retention class). Postgres rejects an INSERT that
    // tries to set it directly.
    const { error: insertError } = await supabase.from('hindrance_photos').insert({
      tenant_id: payload.tenant_id,
      hindrance_id: payload.hindrance_id,
      photo_url: objectPath,
      caption: payload.caption,
      retention_class: 'hindrance',
      received_at: receivedAt.toISOString(),
    })
    if (insertError) {
      throw new Error(
        `handleHindranceMediaIngestJob: hindrance_photos insert failed for ${objectPath}: ${insertError.message}`,
      )
    }

    inserted++
  }

  const { error: statusError } = await supabase
    .from('hindrances')
    .update({ photos_status: 'complete' })
    .eq('id', payload.hindrance_id)
  if (statusError) {
    // The photos themselves are safely stored -- only the status
    // bookkeeping write failed. Alert, don't throw: throwing here would
    // trigger a retry that re-downloads and re-uploads every item to fix
    // a status column. Same reasoning as media_ingest's own handler.
    Sentry.captureException(statusError, {
      fingerprint: ['hindrance-media-ingest', 'photos_status_write_failed', payload.hindrance_id],
      tags: { feature: 'hindrance-media-ingest' },
      extra: { hindranceId: payload.hindrance_id },
    })
  }

  return { inserted }
}

/**
 * Dead-letter mapping, called from app/api/jobs/tick/route.ts's own
 * dispatch loop ONLY once retries are truly exhausted -- same placement
 * convention as markMediaIngestFailed. Writes hindrances.photos_status =
 * 'failed' and raises a Sentry alert. UNLIKE media_ingest's own
 * dead-letter (whose only downstream consumer is a future PM dashboard,
 * stage 5), this dead-letter has a REAL, LIVE downstream consumer TODAY:
 * handleHindrancePmNotifyJob's own retry-until-ready check reads
 * photos_status directly, and its own forced-send-on-exhaustion path
 * (Aravind's "never withhold the email" decision) depends on this column
 * actually reaching 'failed' rather than staying stuck at 'pending'
 * forever.
 */
export async function markHindranceMediaIngestFailed(
  supabase: SupabaseClient,
  payload: HindranceMediaIngestJobPayload,
  lastError: string,
): Promise<void> {
  const { error } = await supabase
    .from('hindrances')
    .update({ photos_status: 'failed' })
    .eq('id', payload.hindrance_id)
  if (error) {
    Sentry.captureException(error, {
      fingerprint: ['hindrance-media-ingest', 'failed_status_write_failed', payload.hindrance_id],
      tags: { feature: 'hindrance-media-ingest' },
      extra: { hindranceId: payload.hindrance_id },
    })
  }

  Sentry.captureMessage('hindrance_media_ingest: job exhausted all retries -- photos never uploaded', {
    level: 'error',
    fingerprint: ['hindrance-media-ingest', 'dead_letter', payload.hindrance_id],
    tags: { feature: 'hindrance-media-ingest' },
    extra: {
      hindranceId: payload.hindrance_id,
      mediaCount: payload.media.length,
      lastError,
      action: 'Ask the engineer to resend the photo(s) for this hindrance report.',
    },
  })
}

// Exported for tests/documentation of the fixed retention window --
// mirrors lib/media/ingest.ts's own RETENTION_DAYS export, kept here as
// the expected reference tests compare the database-computed expires_at
// against; the job never computes or writes expires_at itself.
export const HINDRANCE_RETENTION_DAYS = RETENTION_DAYS
