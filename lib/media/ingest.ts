import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { readCredentials } from '@/lib/whatsapp/outbound/send'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import type { MediaItem } from '@/lib/whatsapp/media-reply'

// Stage 1 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage1-photo-intake-plan.md). The `media_ingest`
// job handler -- downloads each Twilio media item, uploads it to the
// `daily-log-photos` bucket (stage 0), and inserts one `daily_log_photos`
// row per photo with `retention_class` STAMPED AT INSERT TIME by this job.
// `expires_at` is NOT stamped here (external review round 1, item 2) -- it
// is a GENERATED STORED column on the table itself, computed from
// `received_at`/`retention_class`; this job supplies neither directly and
// Postgres would reject an INSERT that tried. Stage 6's own retention job
// still scans `expires_at` directly, unaffected by which side computes it.
//
// NO PM-VISIBLE FAILURE SURFACE EXISTS YET -- STATED PLAINLY, NOT IMPLIED
// OTHERWISE. On exhaustion this writes `daily_logs.{phase}_photos_status =
// 'failed'` and raises a Sentry alert (item 4's own dead-letter shape) --
// that is the ENTIRE failure surface until stage 5 builds a PM dashboard
// that actually reads this column. An engineer sees nothing different
// either way (item 4: "the engineer-facing completion message is
// unconditional... failures surface to the PM, not the engineer"), and
// today "surfacing to the PM" concretely means "a Sentry alert someone who
// monitors Sentry might see" -- not a claim that the PM sees anything in
// the product itself.

// Mirrors the CASE expression in daily_log_photos.expires_at's own
// GENERATED ALWAYS AS clause (043_daily_log_photos.sql, external review
// round 1, item 2) -- kept here ONLY as the expected reference tests
// compare the database-computed value against; this job no longer computes
// or writes expires_at itself. If the schema's durations ever change, this
// map must change with them or the tests silently compare against a stale
// expectation -- there is no single source both read from, by design (the
// migration's own comment records why: a schema-side change here becomes a
// migration to the generated expression, not an edit to this file).
export const RETENTION_DAYS: Readonly<Record<'morning' | 'evening', number>> = {
  morning: 7,
  evening: 60,
}

const RETENTION_CLASS: Readonly<Record<'morning' | 'evening', 'attendance' | 'evening_progress'>> = {
  morning: 'attendance',
  evening: 'evening_progress',
}

export interface MediaIngestJobPayload {
  tenant_id: string
  daily_log_id: string
  phase: 'morning' | 'evening'
  /** The turn's Body, if any -- stored ONLY here, on the photo row. Item 12
   * REVERSED (Aravind, 2026-09-14, first real-use finding, inbound-start.ts's
   * own header has the full incident): a caption used to also reach the
   * answer parser as if typed text; a real prod incident (a photo captioned
   * "Today work" recorded as the evening Q5 answer, discarding the
   * engineer's real "No" sent moments later) showed a caption describes the
   * photo, not whatever question happens to be open. The caption NEVER
   * reaches dispatchInboundTurn/the answer parser now -- this field is its
   * only destination. Null when the photo arrived with no accompanying
   * text. */
  caption: string | null
  media: MediaItem[]
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  // Default to .jpg -- WhatsApp photos are overwhelmingly image/jpeg, and an
  // unrecognized/generic content type (e.g. application/octet-stream, if
  // Twilio ever omits MediaContentType{i}) still needs SOME extension for
  // the object path; .jpg is the least-wrong default, not a claim about
  // the actual bytes' real format.
  return '.jpg'
}

/**
 * Process one media_ingest job: download every item from Twilio, upload
 * each to Storage, insert one daily_log_photos row per item. Throws on the
 * FIRST failure (Twilio download error or Storage upload/DB-insert error)
 * -- lib/queue/jobs.ts's own exponential-backoff retry (NFR-17) is the
 * recovery mechanism, matching every other job handler in this codebase.
 * A partial success (some items already inserted before a later item
 * fails) is accepted, not rolled back -- a retry re-attempts the whole
 * payload, and a duplicate insert for an already-succeeded item is a
 * disposable Storage/table waste, not a correctness issue (photo_id is
 * freshly generated per attempt, so a retry never collides with or
 * overwrites a row from an earlier partial attempt).
 */
export async function handleMediaIngestJob(
  payload: MediaIngestJobPayload,
  deps: {
    supabaseClient?: SupabaseClient
    fetchFn?: typeof fetch
  } = {},
): Promise<{ inserted: number }> {
  const supabase = deps.supabaseClient ?? createServiceClient()
  const fetchFn = deps.fetchFn ?? fetch
  const { accountSid, authToken } = readCredentials()
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const retentionClass = RETENTION_CLASS[payload.phase]
  const receivedAt = new Date()

  let inserted = 0
  for (const item of payload.media) {
    const twilioRes = await fetchFn(item.url, {
      headers: { Authorization: `Basic ${basicAuth}` },
    })
    if (!twilioRes.ok) {
      throw new Error(
        `handleMediaIngestJob: Twilio download failed for daily_log ${payload.daily_log_id} (${twilioRes.status})`,
      )
    }
    const bytes = Buffer.from(await twilioRes.arrayBuffer())

    const photoId = randomUUID()
    const objectPath = `${payload.tenant_id}/${payload.daily_log_id}/${photoId}${extensionForContentType(item.contentType)}`

    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(objectPath, bytes, { contentType: item.contentType, upsert: false })
    if (uploadError) {
      throw new Error(
        `handleMediaIngestJob: Storage upload failed for ${objectPath}: ${uploadError.message}`,
      )
    }

    // expires_at is NOT supplied here -- it is a GENERATED STORED column
    // (043_daily_log_photos.sql, external review round 1, item 2); Postgres
    // rejects an INSERT that tries to set it directly.
    const { error: insertError } = await supabase.from('daily_log_photos').insert({
      tenant_id: payload.tenant_id,
      daily_log_id: payload.daily_log_id,
      phase: payload.phase,
      photo_url: objectPath,
      caption: payload.caption,
      retention_class: retentionClass,
      received_at: receivedAt.toISOString(),
    })
    if (insertError) {
      throw new Error(
        `handleMediaIngestJob: daily_log_photos insert failed for ${objectPath}: ${insertError.message}`,
      )
    }

    inserted++
  }

  const { error: statusError } = await supabase
    .from('daily_logs')
    .update({ [`${payload.phase}_photos_status`]: 'complete' })
    .eq('id', payload.daily_log_id)
  if (statusError) {
    // The photos themselves are safely stored -- only the status bookkeeping
    // write failed. Alert, don't throw: throwing here would trigger a retry
    // that re-downloads and re-uploads every item, duplicating real Storage
    // writes to fix a status column. Same reasoning as owner-deliver-
    // dispatch.ts's own batchWriteDeliveryStatus.
    Sentry.captureException(statusError, {
      fingerprint: ['media-ingest', 'photos_status_write_failed', payload.daily_log_id],
      tags: { feature: 'media-ingest' },
      extra: { dailyLogId: payload.daily_log_id, phase: payload.phase },
    })
  }

  return { inserted }
}

/**
 * Dead-letter mapping, called from app/api/jobs/tick/route.ts's own
 * dispatch loop ONLY once retries are truly exhausted -- same placement
 * convention as markDprGenerationFailed (lib/dpr/dispatch.ts): this lives
 * in the job-tick layer, not inside the handler itself, matching every
 * other job type's dead-letter shape in this codebase.
 *
 * Writes daily_logs.{phase}_photos_status = 'failed' and raises a Sentry
 * alert carrying the exact action a human can take (Rule 4.2: "every alert
 * carries its action"), matching item 4's own specified dead-letter copy.
 */
export async function markMediaIngestFailed(
  supabase: SupabaseClient,
  payload: MediaIngestJobPayload,
  lastError: string,
): Promise<void> {
  const { error } = await supabase
    .from('daily_logs')
    .update({ [`${payload.phase}_photos_status`]: 'failed' })
    .eq('id', payload.daily_log_id)
  if (error) {
    Sentry.captureException(error, {
      fingerprint: ['media-ingest', 'failed_status_write_failed', payload.daily_log_id],
      tags: { feature: 'media-ingest' },
      extra: { dailyLogId: payload.daily_log_id, phase: payload.phase },
    })
  }

  Sentry.captureMessage('media_ingest: job exhausted all retries -- photos never uploaded', {
    level: 'error',
    fingerprint: ['media-ingest', 'dead_letter', payload.daily_log_id, payload.phase],
    tags: { feature: 'media-ingest' },
    extra: {
      dailyLogId: payload.daily_log_id,
      phase: payload.phase,
      mediaCount: payload.media.length,
      lastError,
      // Rule 4.2 -- every alert carries its action. No PM-visible surface
      // exists yet (stage 5) to phrase this as a product notification; this
      // is the interim, Sentry-only surface item 4's own design accepted.
      action: 'Ask the engineer to resend the photo(s) for this check-in.',
    },
  })
}

/**
 * Resolve daily_log_id for a (project_id, engineer_id, log_date) triple --
 * the same UNIQUE constraint evening.ts's own fetchMorningEquipmentEcho
 * already uses for a different field. Recommended over extending
 * apply_morning_flow_turn/apply_evening_flow_turn's own return shape
 * (docs/plans/stage1-photo-intake-plan.md §4's own reasoning: this avoids
 * touching two live SECURITY DEFINER functions and the external-review-gate
 * cost that would trip). Returns null if no daily_logs row exists yet for
 * that triple (should not happen for an in-progress flow, since starting a
 * flow already creates/touches the row, but this is a real query result,
 * not assumed).
 */
export async function resolveDailyLogId(
  params: { projectId: string; engineerId: string; logDate: string },
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('id')
    .eq('project_id', params.projectId)
    .eq('engineer_id', params.engineerId)
    .eq('log_date', params.logDate)
    .maybeSingle<{ id: string }>()
  if (error) {
    throw new Error(`resolveDailyLogId failed for project ${params.projectId}: ${error.message}`)
  }
  return data?.id ?? null
}

/**
 * Like resolveDailyLogId, but CREATES the row when it doesn't exist yet.
 *
 * FIX (Aravind, 2026-09-13, stage 1 post-build review). Before this fix, a
 * photo landing on the very first turn of a flow -- before any answer's own
 * RPC write has materialised the daily_logs row -- was silently NOT
 * enqueued, with the engineer told nothing. That is the exact silent-loss
 * shape this project has already been bitten by twice (the unrevoked
 * `dpr_versions` grant, `service_role`'s default table ACL) -- a real gap,
 * not a hypothetical one, and it is now closed here rather than left named
 * in a comment.
 *
 * Upserts ONLY the four columns that alone satisfy daily_logs' NOT NULL
 * constraints (docs/schema.md's own column list) -- the same minimal shape
 * apply_morning_flow_turn's own step-1 INSERT already uses to materialise
 * the row for the identical reason (030_morning_flow_attendance.sql:550-557,
 * `v_col = 'attendance'`). `ON CONFLICT (project_id, engineer_id, log_date)`
 * (the same UNIQUE constraint every flow RPC's own upsert already keys on)
 * means a genuine race against the RPC's own concurrent write -- or a
 * second photo in the same burst -- can never collide; it just resolves to
 * the same row either way, never a duplicate-key error.
 *
 * Returns null ONLY on a real write failure. The caller's contract for that
 * null is deliberately different from resolveDailyLogId's own null (which
 * means "no row yet, ordinary and expected"): here it means the photo could
 * not be accepted AT ALL, and the caller must tell the engineer immediately
 * -- see inbound-start.ts's own PHOTO_SAVE_FAILED_REPLY. This is NOT the
 * same failure surface as a background media_ingest job failing AFTER
 * acceptance (markMediaIngestFailed below): that failure is silent to the
 * engineer (he has moved on by the time it resolves) and surfaces to the PM
 * at stage 5 instead. The two must never be merged into one handler --
 * "never accepted" (told now) and "accepted, then lost" (told later, to a
 * different person) are different facts about different moments.
 */
export async function resolveOrCreateDailyLogId(
  params: { tenantId: string; projectId: string; engineerId: string; logDate: string },
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('daily_logs')
    .upsert(
      {
        tenant_id: params.tenantId,
        project_id: params.projectId,
        engineer_id: params.engineerId,
        log_date: params.logDate,
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error) {
    return null
  }
  return data?.id ?? null
}

/**
 * Count photos RECEIVED so far this phase, for the completion message
 * (docs/plans/stage1-photo-intake-plan.md TASK 3). Counts by summing each
 * enqueued media_ingest job's own media array length -- NOT by counting
 * daily_log_photos rows, deliberately: this function is called at
 * completion time, synchronously, inside the same webhook request that
 * closes out the check-in, well before the async job has necessarily run.
 * A job row exists the instant it's enqueued (a fast DB insert, same
 * request that received the photo); a daily_log_photos row exists only
 * once the job actually processes it. "Received," not "stored" (item 4's
 * own distinction) is exactly what counting jobs, not photos, measures.
 */
export async function countReceivedPhotos(
  dailyLogId: string,
  phase: 'morning' | 'evening',
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase
    .from('jobs')
    .select('payload')
    .eq('type', 'media_ingest')
    .contains('payload', { daily_log_id: dailyLogId, phase })
  if (error) {
    throw new Error(`countReceivedPhotos failed for daily_log ${dailyLogId}: ${error.message}`)
  }
  return (data ?? []).reduce((total, row) => {
    const payload = row.payload as unknown as MediaIngestJobPayload
    return total + (payload.media?.length ?? 0)
  }, 0)
}
