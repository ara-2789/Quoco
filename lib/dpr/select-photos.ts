import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import type { EmailAttachment } from '@/lib/email/send'

// Stage 4 (DPR photo attachments). Selects, downloads, and caps the photos
// attached to an owner's per-engineer DPR report email (lib/dpr/owner-
// deliver-dispatch.ts's own sendEmail call at ~421-426 only -- never the
// no-report notice, S1). ONE small exported function, deliberately
// testable on its own (Aravind's own instruction) -- owner-deliver-
// dispatch.ts owns the readiness-gate/retry decision and the send call;
// this file owns only "what photos, in what order, within what caps."
//
// SAME BYTE-FETCH PATH AS lib/hindrance/pm-notify.ts's own
// fetchHindrancePhotoAttachments (S7, Aravind's explicit instruction):
// service_role, direct Storage download, never a signed URL
// (lib/storage/photo-access.ts is not used or changed here -- that module
// is the PM-dashboard-facing signed-URL path, a different consumer of the
// same bucket).
//
// S2 -- SELECTION, PER DPR ROW (project_id, engineer_id, log_date), ALWAYS
// ALSO FILTERED BY tenant_id:
//   a. Evening photos: daily_log_photos for the daily_logs row matching
//      (project_id, engineer_id, log_date), phase='evening', photo_url NOT
//      NULL, ordered by received_at. Morning (attendance) photos are NEVER
//      attached -- the phase='evening' filter is the entire mechanism; no
//      separate morning-exclusion code exists because there is nothing to
//      exclude once the phase filter is in place.
//   b. THEN hindrance photos: hindrance_photos joined to hindrances where
//      hindrances.project_id = project_id AND hindrances.reported_by =
//      engineer_id AND hindrances.report_date = log_date (migration 046,
//      already live on prod), photo_url NOT NULL, ordered by received_at.
//   Never select by date or tenant alone -- every query below carries the
//   full (tenant_id, project_id, engineer_id/reported_by, log_date/
//   report_date) key, per S2's own explicit instruction, so a same-tenant
//   sibling project or a same-date row in a different tenant can never
//   contribute a photo.
//
// S6, EMERGENT, NOT SEPARATELY CODED: a hindrance created after its day's
// DPR was already sent has a report_date that does not equal the log_date
// this function is called with (report_date is generated from the
// hindrance's own created_at, migration 046) -- the report_date = log_date
// filter in (b) above already excludes it. No roll-forward code exists;
// none is needed.
//
// S3 -- CAPS. At most MAX_ATTACHMENTS photos AND at most MAX_ATTACHMENT_
// BYTES total, measured on the base64-encoded `content` string actually
// sent (the wire bytes, per lib/email/send.ts's own EmailAttachment shape
// -- base64 inflates raw bytes by ~4/3, so measuring the encoded string is
// the only way to honor "measured on the bytes actually sent (after any
// encoding)" literally). Stop adding (a hard break, not skip-and-continue)
// the moment either cap would be exceeded by the NEXT candidate -- every
// candidate from that point on, including ones that might individually
// have fit under the byte cap, counts as overflow. Evening candidates are
// tried before hindrance candidates (S2's own ordering), so overflow always
// falls on hindrance photos first once evening photos alone are already at
// a cap boundary.

export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB, wire (base64) bytes

export interface SelectDprPhotosParams {
  tenantId: string
  projectId: string
  engineerId: string
  logDate: string
}

export interface SelectDprPhotosResult {
  attachments: EmailAttachment[]
  eligibleCount: number
  attachedCount: number
  /** eligible - attached, per S3's own definition. */
  overflowCount: number
  /**
   * S5 readiness gate. false when daily_logs.evening_photos_status is
   * 'pending' for this (project, engineer, log_date), OR any matching
   * hindrances.photos_status (report_date = log_date) is 'pending'.
   * PURELY INFORMATIONAL -- this function always selects and attaches
   * whatever photo_url rows exist right now, regardless of this flag.
   * The caller (owner-deliver-dispatch.ts) decides whether to throw for a
   * job retry (photosReady === false, not yet forced) or proceed anyway
   * (photosReady === true, or the caller has exhausted retries and is
   * forcing a send) -- this function has no opinion on that decision, it
   * only reports the fact.
   */
  photosReady: boolean
}

interface PhotoCandidate {
  photoUrl: string
}

async function fetchAttachment(client: SupabaseClient, photoUrl: string): Promise<{ content: string; contentType?: string }> {
  const { data: blob, error: downloadError } = await client.storage.from(PHOTO_BUCKET).download(photoUrl)
  if (downloadError || !blob) {
    throw new Error(`selectDprPhotos: download failed for ${photoUrl}: ${downloadError?.message}`)
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  return { content: bytes.toString('base64'), contentType: blob.type || undefined }
}

export async function selectDprPhotos(
  params: SelectDprPhotosParams,
  client?: SupabaseClient,
): Promise<SelectDprPhotosResult> {
  const supabase = client ?? createServiceClient()
  const { tenantId, projectId, engineerId, logDate } = params

  // --- S2a: evening photos, via the one daily_logs row for this key. ---
  const { data: dailyLog, error: dailyLogError } = await supabase
    .from('daily_logs')
    .select('id, evening_photos_status')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('engineer_id', engineerId)
    .eq('log_date', logDate)
    .maybeSingle<{ id: string; evening_photos_status: 'pending' | 'complete' | 'failed' | null }>()
  if (dailyLogError) throw dailyLogError

  const eveningCandidates: PhotoCandidate[] = []
  let eveningPending = false
  if (dailyLog) {
    eveningPending = dailyLog.evening_photos_status === 'pending'

    const { data: eveningPhotos, error: eveningError } = await supabase
      .from('daily_log_photos')
      .select('photo_url')
      .eq('tenant_id', tenantId)
      .eq('daily_log_id', dailyLog.id)
      .eq('phase', 'evening')
      .not('photo_url', 'is', null)
      .order('received_at', { ascending: true })
    if (eveningError) throw eveningError
    for (const row of (eveningPhotos ?? []) as { photo_url: string | null }[]) {
      if (row.photo_url) eveningCandidates.push({ photoUrl: row.photo_url })
    }
  }

  // --- S2b: hindrance photos, via every hindrance matching this key. ---
  const { data: hindranceRows, error: hindranceError } = await supabase
    .from('hindrances')
    .select('id, photos_status')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('reported_by', engineerId)
    .eq('report_date', logDate)
  if (hindranceError) throw hindranceError

  const hindranceRowsTyped = (hindranceRows ?? []) as { id: string; photos_status: 'pending' | 'complete' | 'failed' | null }[]
  const hindranceIds = hindranceRowsTyped.map((r) => r.id)
  const anyHindrancePending = hindranceRowsTyped.some((r) => r.photos_status === 'pending')

  const hindranceCandidates: PhotoCandidate[] = []
  if (hindranceIds.length > 0) {
    const { data: hindrancePhotos, error: hpError } = await supabase
      .from('hindrance_photos')
      .select('photo_url')
      .eq('tenant_id', tenantId)
      .in('hindrance_id', hindranceIds)
      .not('photo_url', 'is', null)
      .order('received_at', { ascending: true })
    if (hpError) throw hpError
    for (const row of (hindrancePhotos ?? []) as { photo_url: string | null }[]) {
      if (row.photo_url) hindranceCandidates.push({ photoUrl: row.photo_url })
    }
  }

  // S2's own ordering: evening before hindrance.
  const eligible = [...eveningCandidates, ...hindranceCandidates]

  const attachments: EmailAttachment[] = []
  let totalBytes = 0
  for (const candidate of eligible) {
    if (attachments.length >= MAX_ATTACHMENTS) break
    const { content, contentType } = await fetchAttachment(supabase, candidate.photoUrl)
    const attachmentBytes = Buffer.byteLength(content, 'utf8')
    if (totalBytes + attachmentBytes > MAX_ATTACHMENT_BYTES) break
    const filename = candidate.photoUrl.split('/').pop() ?? 'photo.jpg'
    attachments.push({ filename, content, contentType })
    totalBytes += attachmentBytes
  }

  return {
    attachments,
    eligibleCount: eligible.length,
    attachedCount: attachments.length,
    overflowCount: eligible.length - attachments.length,
    photosReady: !eveningPending && !anyHindrancePending,
  }
}

// S4 -- overflow line. PROPOSED COPY (Aravind's own exact wording, given
// verbatim in this feature's own task -- shown in this feature's own PR
// for approval, not yet confirmed). Tamil pair is owed and NOT approved --
// do not invent one. Rendered only when overflowCount > 0 (owner-deliver-
// dispatch.ts's own call site); no link of any kind, per S4's own explicit
// instruction -- the template below has none.
export function buildDprPhotoOverflowLine(overflowCount: number): string {
  return `${overflowCount} more photo(s) from today were not attached.`
}
