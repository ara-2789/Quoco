import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import type { EmailAttachment } from '@/lib/email/send'
import { selectDprPhotoCandidates, type DprPhotoCandidate } from '@/lib/dpr/select-photo-candidates'

// Stage 4 (DPR photo attachments). Selects, downloads, and caps the photos
// attached to an owner's per-engineer DPR report email (lib/dpr/owner-
// deliver-dispatch.ts's own sendEmail call at ~421-426 only -- never the
// no-report notice, S1). ONE small exported function, deliberately
// testable on its own (Aravind's own instruction) -- owner-deliver-
// dispatch.ts owns the readiness-gate/retry decision and the send call;
// this file owns only "what photos, in what order, within what caps."
//
// STAGE 5a, BUILD SLICE B2 (docs/reviews/stage5a-review-package.md, D7;
// verdict Q3): selectDprPhotos below is now a thin, gate-first WRAPPER, not
// the selection logic itself. The "which photos" query (S2 below) moved to
// lib/dpr/select-photo-candidates.ts's own selectDprPhotoCandidates -- a
// separate, email-agnostic module with no Sentry/Storage/EmailAttachment
// imports, so a future dashboard page (B3, not yet built; D9) can call it
// directly without pulling any of this file's email-only baggage in. This
// file's own selectDprPhotos KEEPS its exact name, signature, and return
// shape (D7's own hard condition: test/dpr-photo-selection.test.ts and
// test/owner-deliver-job.test.ts get zero edits) -- it now does exactly
// three things, strictly in order: (1) check readiness (fetchPhotoReadiness
// below, unchanged queries/logic from before the split), (2) return early,
// with ZERO calls into selectDprPhotoCandidates, if requireReady and not
// ready (F1, preserved by the early `return` itself -- nothing after it in
// this function body can run), (3) only otherwise, call
// selectDprPhotoCandidates and run the unchanged download/cap/Sentry loop
// over its result.
//
// KNOWN BEHAVIOUR CHANGE, ACCEPTED BY ARAVIND 2026-09-17: before this
// split, the readiness check (fetchPhotoReadiness) and the hindrance
// candidate query shared ONE `hindrances` fetch -- the same rows were read
// once, used both to decide `anyHindrancePending` and to build the
// candidate hindrance_photos query. After the split, those are TWO
// separate `hindrances` queries (one inside fetchPhotoReadiness, one
// inside selectDprPhotoCandidates), a moment apart, not one atomic read.
// Consequence: a hindrance INSERTed in the gap between those two queries
// (report_date = today, with a photo already attached) can now be picked
// up by the second query and contribute a photo to this send, even though
// the readiness check a moment earlier never saw it and could not have
// gated on its photos_status. Before this split, that was impossible --
// one fetch, one snapshot, no gap. This is a real, if narrow, race,
// accepted as a cost of the split rather than closed (closing it would
// mean threading the readiness query's own hindrance ids into
// selectDprPhotoCandidates as an override, which breaks that function's
// clean "given just the 4 key fields" contract B3's page consumer needs --
// see lib/dpr/select-photo-candidates.ts's own header). Also costs 2 extra
// reads (daily_logs, hindrances) per ready-path call, for the same reason
// -- selectDprPhotoCandidates re-resolves both ids independently rather
// than reusing fetchPhotoReadiness's own fetch.
//
// SAME BYTE-FETCH PATH AS lib/hindrance/pm-notify.ts's own
// fetchHindrancePhotoAttachments (S7, Aravind's explicit instruction):
// service_role, direct Storage download, never a signed URL
// (lib/storage/photo-access.ts is not used or changed here -- that module
// is the PM-dashboard-facing signed-URL path, a different consumer of the
// same bucket).
//
// S2 -- SELECTION. Moved to lib/dpr/select-photo-candidates.ts (see that
// file's own header for the full per-row/tenant filtering rules, unchanged
// in substance from before this split) -- selectDprPhotos below consumes
// its ordered DprPhotoCandidate[] result without re-deriving any of it.
//
// S6, EMERGENT, NOT SEPARATELY CODED: a hindrance created after its day's
// DPR was already sent has a report_date that does not equal the log_date
// this function is called with (report_date is generated from the
// hindrance's own created_at, migration 046) -- the report_date = log_date
// filter in select-photo-candidates.ts's own (b) already excludes it. No
// roll-forward code exists; none is needed.
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
//
// F1 -- READINESS BEFORE DOWNLOAD (Aravind, 2026-09-16). Readiness
// (daily_logs.evening_photos_status, hindrances.photos_status) is
// determined FIRST, from status columns alone -- no candidate-row query,
// no Storage download. When options.requireReady is true and photos are
// not ready, this function returns immediately (photosReady=false, no
// attachments) having made NO Storage download calls at all, and (since
// the B2 split) NO call into selectDprPhotoCandidates at all either -- so
// no daily_log_photos/hindrance_photos query either. The caller (owner-
// deliver-dispatch.ts) still owns the throw-for-retry decision -- this
// function only refuses to touch Storage/candidates early, it has no
// opinion on what the caller does with photosReady=false.
//
// F2 -- FAILED DOWNLOAD = SKIP + ALERT, NEVER BLOCK (Aravind, 2026-09-16).
// A download error for one candidate photo does not throw and does not
// stop the loop -- it is skipped, a Sentry error is raised (fingerprinted,
// never the bytes), and the loop continues with the next candidate. A
// failed photo consumes neither the count cap nor the byte cap (it never
// reaches the cap checks below at all), and is counted in overflowCount
// via the existing eligible-minus-attached definition -- no separate
// failure counter needed. Applies identically whether the send is forced
// or not.

export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB, wire (base64) bytes

export interface SelectDprPhotosParams {
  tenantId: string
  projectId: string
  engineerId: string
  logDate: string
}

export interface SelectDprPhotosOptions {
  /**
   * F1. When true and photos are not ready (see SelectDprPhotosResult.
   * photosReady's own comment for the exact readiness definition), this
   * function returns immediately -- photosReady=false, attachments=[],
   * eligibleCount=0, attachedCount=0, overflowCount=0 -- without querying
   * a single candidate-photo row or making a single Storage download call.
   * owner-deliver-dispatch.ts passes `requireReady: !forceSendWithoutPhotos`.
   */
  requireReady: boolean
}

export interface SelectDprPhotosResult {
  attachments: EmailAttachment[]
  eligibleCount: number
  attachedCount: number
  /** eligible - attached, per S3's own definition. Also covers F2 failures. */
  overflowCount: number
  /**
   * F1/S5 readiness gate. false when daily_logs.evening_photos_status is
   * 'pending' for this (project, engineer, log_date), OR any matching
   * hindrances.photos_status (report_date = log_date) is 'pending'.
   * When options.requireReady is false, this function still selects and
   * attaches whatever photo_url rows exist right now regardless of this
   * flag -- the caller (owner-deliver-dispatch.ts) decides whether to
   * throw for a job retry (photosReady === false, not yet forced) or
   * proceed anyway (photosReady === true, or the caller is forcing a
   * send) -- this function has no opinion on that decision beyond F1's own
   * early-return short-circuit, it only reports the fact.
   */
  photosReady: boolean
}

async function fetchAttachment(client: SupabaseClient, photoUrl: string): Promise<{ content: string; contentType?: string }> {
  const { data: blob, error: downloadError } = await client.storage.from(PHOTO_BUCKET).download(photoUrl)
  if (downloadError || !blob) {
    throw new Error(`selectDprPhotos: download failed for ${photoUrl}: ${downloadError?.message}`)
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  return { content: bytes.toString('base64'), contentType: blob.type || undefined }
}

const EMPTY_NOT_READY_RESULT: SelectDprPhotosResult = {
  attachments: [],
  eligibleCount: 0,
  attachedCount: 0,
  overflowCount: 0,
  photosReady: false,
}

interface PhotoReadiness {
  photosReady: boolean
}

// F1's own readiness query, unchanged in logic from before the B2 split --
// only its OWN, single-purpose function now, called by selectDprPhotos
// BEFORE selectDprPhotoCandidates is ever reached (see this file's own
// header for why that ordering is what preserves F1's "zero candidate-row
// queries when not ready" guarantee). Private -- not exported, not used by
// any dashboard/page consumer (D9: the page never adopts this gate).
async function fetchPhotoReadiness(params: SelectDprPhotosParams, client: SupabaseClient): Promise<PhotoReadiness> {
  const { tenantId, projectId, engineerId, logDate } = params

  const { data: dailyLog, error: dailyLogError } = await client
    .from('daily_logs')
    .select('evening_photos_status')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('engineer_id', engineerId)
    .eq('log_date', logDate)
    .maybeSingle<{ evening_photos_status: 'pending' | 'complete' | 'failed' | null }>()
  if (dailyLogError) throw dailyLogError
  const eveningPending = dailyLog?.evening_photos_status === 'pending'

  const { data: hindranceRows, error: hindranceError } = await client
    .from('hindrances')
    .select('photos_status')
    .eq('tenant_id', tenantId)
    .eq('project_id', projectId)
    .eq('reported_by', engineerId)
    .eq('report_date', logDate)
  if (hindranceError) throw hindranceError

  const anyHindrancePending = ((hindranceRows ?? []) as { photos_status: 'pending' | 'complete' | 'failed' | null }[]).some(
    (r) => r.photos_status === 'pending',
  )

  return { photosReady: !eveningPending && !anyHindrancePending }
}

export async function selectDprPhotos(
  params: SelectDprPhotosParams,
  options: SelectDprPhotosOptions,
  client?: SupabaseClient,
): Promise<SelectDprPhotosResult> {
  const supabase = client ?? createServiceClient()
  const { tenantId, projectId, engineerId, logDate } = params

  // --- F1: readiness first -- gate BEFORE selectDprPhotoCandidates is
  // ever called, so a not-ready return makes zero candidate-row queries
  // and zero Storage calls (see this file's own header). ---
  const { photosReady } = await fetchPhotoReadiness(params, supabase)

  if (options.requireReady && !photosReady) {
    return EMPTY_NOT_READY_RESULT
  }

  const candidates: DprPhotoCandidate[] = await selectDprPhotoCandidates(params, supabase)

  const attachments: EmailAttachment[] = []
  let totalBytes = 0
  for (const candidate of candidates) {
    if (attachments.length >= MAX_ATTACHMENTS) break

    let fetched: { content: string; contentType?: string }
    try {
      fetched = await fetchAttachment(supabase, candidate.photoUrl)
    } catch (err) {
      // F2 -- skip + alert, never block. Never throw; never log the bytes.
      // Fingerprint is grouped (no photo path), amended 2026-09-17 (Aravind):
      // one photo path per fingerprint would open a distinct Sentry issue
      // per failing photo, which fans out unboundedly under any real
      // Storage-wide outage instead of surfacing as one alertable issue.
      // The path stays in `extra` only, not in the fingerprint.
      Sentry.captureMessage('dpr-photo-attach: download failed', {
        level: 'error',
        fingerprint: ['dpr-photo-attach', 'download_failed'],
        tags: { feature: 'owner-deliver' },
        extra: {
          photoUrl: candidate.photoUrl,
          tenantId,
          projectId,
          engineerId,
          logDate,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
      continue
    }

    const { content, contentType } = fetched
    const attachmentBytes = Buffer.byteLength(content, 'utf8')
    if (totalBytes + attachmentBytes > MAX_ATTACHMENT_BYTES) break
    const filename = candidate.photoUrl.split('/').pop() ?? 'photo.jpg'
    attachments.push({ filename, content, contentType })
    totalBytes += attachmentBytes
  }

  return {
    attachments,
    eligibleCount: candidates.length,
    attachedCount: attachments.length,
    overflowCount: candidates.length - attachments.length,
    photosReady,
  }
}

// S4 -- overflow line. Aravind's own exact wording, APPROVED 2026-09-16.
// Tamil pair is owed and NOT approved -- do not invent one. Rendered only
// when overflowCount > 0 (owner-deliver-dispatch.ts's own call site); no
// link of any kind, per S4's own explicit instruction -- the template
// below has none.
export function buildDprPhotoOverflowLine(overflowCount: number): string {
  return `${overflowCount} more photo(s) from today were not attached.`
}
