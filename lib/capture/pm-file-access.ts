import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { profileForAuthId, type Profile } from '@/lib/auth/profile-query'
import { isProjectPm } from '@/lib/auth/is-project-pm'

// PR-D file access: GET /api/capture-files/[fileId] (app/api/capture-files/[fileId]/route.ts).
//
// BUILD DEVIATION FROM pr-c-plan.md:406-407 (Q9, "the capture kind moves into photo-access.ts / the photo route"),
// APPROVED by Aravind 31 Oct (D4): this is its own route. Reasons: (1) tenant + active + PM-on-project come from an
// RLS read with the USER's client first, instead of a service-role lookup; (2) lib/storage/photo-access.ts and
// app/api/photos/** stay untouched, so the live photo path cannot regress; (3) different tables, different bucket.
//
// ORDER (D5): UUID check -> auth.getUser -> profile -> rate limit -> read the capture_files row with the USER client
// (RLS) -> app check -> service-role createSignedUrl -> 302.
//
// The service role signs and does nothing else: 049:1016-1017 creates NO storage.objects policy ("access is
// service_role plus app membership checks"), so a user JWT cannot sign. This module is the access boundary for the
// capture-documents bucket; there is no second barrier behind it.
//
// ONE refusal shape (404, no body) for every failure; every response, refusals included, carries
// Cache-Control: no-store and Referrer-Policy: no-referrer (D1).

/** Same string as CAPTURE_BUCKET in lib/media/capture-ingest.ts (the writer). Not imported: that module pulls the
 *  Twilio send path into this route. test/pm-file-route.test.ts asserts the two are equal. */
export const PM_CAPTURE_BUCKET = 'capture-documents'
/** D1: 60 s. Minted on click only, never on render. */
export const PM_FILE_URL_TTL_SECONDS = 60
export const PM_FILE_RATE_LIMIT_MAX_REQUESTS = 120
export const PM_FILE_RATE_LIMIT_WINDOW_MS = 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RateLimitEntry {
  count: number
  windowStart: number
}
interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  store: Map<string, RateLimitEntry>
}
// Per-warm-instance, per-user, fixed window: the same (non-distributed) limitation as the photo route's limiter,
// which is module-private there and therefore reproduced here rather than touching that file.
const defaultRateLimitStore = new Map<string, RateLimitEntry>()

function isRateLimited(key: string, config: RateLimitConfig): boolean {
  const now = Date.now()
  const entry = config.store.get(key)
  if (!entry || now - entry.windowStart > config.windowMs) {
    config.store.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > config.maxRequests
}

/** D1: both headers on EVERY response from this route. */
export function withPmFileHeaders<T extends NextResponse>(response: T): T {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

function refusal(): NextResponse {
  return withPmFileHeaders(new NextResponse(null, { status: 404 }))
}

export interface CaptureFileRow {
  id: string
  tenant_id: string
  project_id: string
  document_id: string
  file_no: number
  ingest_status: string
  storage_path: string | null
  content_type: string | null
  preview_state: string | null
}

const FILE_COLUMNS = 'id, tenant_id, project_id, document_id, file_no, ingest_status, storage_path, content_type, preview_state'

/**
 * The application check (D5), run AFTER the RLS read and BEFORE anything is signed. Returns the storage path to sign,
 * or null on any failure (callers cannot tell the causes apart).
 *
 * NOTE what it can and cannot rely on: `isProjectPm` checks project_members.role = 'pm' ONLY (lib/auth/is-project-pm.ts
 * :18-30: no users.status, no tenant), and the profile lookup ignores users.status (lib/auth/profile-query.ts selects
 * 'id, tenant_id, full_name, role' by auth_id). So ACTIVE status relies on the RLS read in step 2 (049 policy:
 * `u.status = 'active'`), and tenant is compared here explicitly, against the PROFILE's tenant, not the row's.
 *
 * The path must EQUAL what the writer produces: `${tenant_id}/${project_id}/${document_id}/${id}`, no extension
 * (lib/media/capture-ingest.ts:500-502, rowPath). Migration 051 pins the same string as a PREFIX CHECK
 * (051:173-174, capture_files_storage_path_row_chk). tenant_id comes from the profile; the other three from the row.
 */
export async function appCheckCaptureFile(
  row: CaptureFileRow,
  profile: { tenant_id: string | null },
  isPm: (projectId: string) => Promise<boolean>,
): Promise<string | null> {
  if (profile.tenant_id === null) return null
  if (row.tenant_id !== profile.tenant_id) return null
  if (row.ingest_status !== 'stored') return null
  if (row.storage_path === null) return null
  if (row.storage_path !== `${profile.tenant_id}/${row.project_id}/${row.document_id}/${row.id}`) return null
  if (!(await isPm(row.project_id))) return null
  return row.storage_path
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** The raw value of capture_documents.kind: CHECK (kind IN ('dc', 'invoice')), supabase/migrations/049_capture_tables.sql:286. */
export type CaptureDocumentKind = 'dc' | 'invoice'

/**
 * Download file name for a not-previewable file: <kind>-<file_no>.<ext>, where <kind> is the raw document-type value
 * ('dc' or 'invoice'). Never derived from the storage path.
 */
export function downloadFileName(kind: CaptureDocumentKind | null, fileNo: number, contentType: string | null): string {
  const ext = (contentType && EXT_BY_CONTENT_TYPE[contentType]) || 'bin'
  // Null kind (tolerated for PR-D2 / MI-KIND-REMOVAL; the column is NOT NULL today): a neutral name, file-<file_no>.<ext>.
  if (kind === null) return `file-${fileNo}.${ext}`
  return `${kind}-${fileNo}.${ext}`
}

/**
 * The download name for a document whose kind was read as `docKind`: 'dc' / 'invoice' -> <kind>-<n>.<ext>; null ->
 * file-<n>.<ext>; ANY other value is unknown and returns null, which the route turns into the one refusal (never a guessed name).
 */
export function resolveDownloadName(docKind: string | null, fileNo: number, contentType: string | null): string | null {
  if (docKind === null) return downloadFileName(null, fileNo, contentType)
  if (docKind === 'dc' || docKind === 'invoice') return downloadFileName(docKind, fileNo, contentType)
  return null
}

export interface CaptureFileDeps {
  /** Session client: auth.getUser, profile lookup, isProjectPm, and (by default) the step-2 row read. */
  supabaseClient?: SupabaseClient
  /** Client for the step-2 row read. Defaults to supabaseClient (RLS). Tests swap in a service-role client to prove
   *  the app check refuses on its own (T-FILE-CTRL). Production never sets this. */
  rowClient?: SupabaseClient
  /** service_role client, used ONLY to sign. */
  serviceClient?: SupabaseClient
  rateLimit?: { maxRequests?: number; windowMs?: number; store?: Map<string, RateLimitEntry> }
}

export async function handleCaptureFileGet(
  _request: NextRequest,
  params: { fileId: string },
  deps: CaptureFileDeps = {},
): Promise<NextResponse> {
  try {
    if (!UUID_RE.test(params.fileId)) return refusal()

    const session = deps.supabaseClient ?? (await createClient())
    const {
      data: { user },
    } = await session.auth.getUser()
    if (!user) return refusal()

    let profile: Profile
    try {
      profile = await profileForAuthId(session, user.id)
    } catch {
      return refusal()
    }

    const limit: RateLimitConfig = {
      maxRequests: deps.rateLimit?.maxRequests ?? PM_FILE_RATE_LIMIT_MAX_REQUESTS,
      windowMs: deps.rateLimit?.windowMs ?? PM_FILE_RATE_LIMIT_WINDOW_MS,
      store: deps.rateLimit?.store ?? defaultRateLimitStore,
    }
    if (isRateLimited(profile.id, limit)) return refusal()

    // Step 2: RLS read (tenant + active + PM on the project). Keyed by id only; the tenant is compared in the app
    // check below, which is what makes T-FILE-CTRL meaningful when this client is swapped for a service-role one.
    const { data: row, error: rowErr } = await (deps.rowClient ?? session)
      .from('capture_files')
      .select(FILE_COLUMNS)
      .eq('id', params.fileId)
      .maybeSingle<CaptureFileRow>()
    if (rowErr || !row) return refusal()

    const path = await appCheckCaptureFile(row, profile, (projectId) => isProjectPm(session, profile.id, projectId))
    if (!path) return refusal()

    // A not-previewable file downloads as <kind>-<file_no>.<ext>. The kind is the DOCUMENT's raw type value, read here with
    // the same client as step 2 (RLS) and the profile's tenant. Anything other than the two CHECK values is refused: the
    // route never guesses a name.
    let download: string | undefined
    if (row.preview_state === 'not_previewable') {
      const { data: doc, error: docErr } = await (deps.rowClient ?? session)
        .from('capture_documents')
        .select('kind')
        .eq('id', row.document_id)
        .eq('tenant_id', profile.tenant_id as string)
        .maybeSingle<{ kind: string | null }>()
      if (docErr || !doc) return refusal()
      const name = resolveDownloadName(doc.kind, row.file_no, row.content_type)
      if (name === null) return refusal() // a non-null kind that is not 'dc' or 'invoice'
      download = name
    }

    const service = deps.serviceClient ?? createServiceClient()
    const { data: signed, error: signErr } = await service.storage
      .from(PM_CAPTURE_BUCKET)
      .createSignedUrl(path, PM_FILE_URL_TTL_SECONDS, download ? { download } : undefined)
    if (signErr || !signed?.signedUrl) return refusal()

    return withPmFileHeaders(NextResponse.redirect(signed.signedUrl, 302))
  } catch (err) {
    // The error object only; never the URL, the path or the row.
    Sentry.captureException(err, { tags: { feature: 'pr-d-capture-file-route' } })
    return refusal()
  }
}
