import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { readCredentials } from '@/lib/whatsapp/outbound/send'

// PR-C slice C5 -- the `capture_ingest` job handler (docs/plans/pr-c-c5-plan.md; external design review GO,
// docs/reviews/c5-plan-review-round-1.md). Migration 050's engineer RPC inserts one capture_files row per file
// (status 'pending') and one job carrying the Twilio media URLs. This module downloads each file, checks the BYTES
// (never the claimed type), stores the original in the private bucket `capture-documents`, and writes the result
// into the row in ONE guarded UPDATE using the seven-column grant of migration 051.
//
// THE 051 CONTRACT, in short (each item has a test in test/capture-ingest.test.ts or test/unit/):
//   C1 upload upsert:false, contentType = the detected type, to the ROW-owned path
//      <tenant_id>/<project_id>/<document_id>/<file_id> (no extension -- review ruling, Aravind Q3);
//   C2 nothing here overwrites or deletes a storage object (no remove/move/copy/upsert:true -- a static test scans
//      this file);
//   C3 every terminal detail arrives in the SAME single UPDATE as the status;
//   C4 every UPDATE filters id AND tenant_id AND document_id AND ingest_status IN ('pending','failed');
//   C5 QE011 and the other deterministic refusals are an ALERT, never a retry;
//   C6 events and thrown messages name the table (capture_files) and carry no URL, phone, Twilio SID, account SID,
//      token, body, tenant id or user id -- only counts, codes and the job id;
//   C7 the UPDATE column list is a subset of the 051 grant (CAPTURE_FILES_UPDATE_COLUMNS).
// The engineer is told NOTHING at job time (R5/A11): this module sends no message of any kind.

export const CAPTURE_BUCKET = 'capture-documents'
export const CAPTURE_MAX_BYTES = 16 * 1024 * 1024
/** The 051 grant (supabase/migrations/051_capture_files_immutability.sql:288). Every UPDATE's SET keys are a subset. */
export const CAPTURE_FILES_UPDATE_COLUMNS = [
  'ingest_status',
  'content_type',
  'byte_size',
  'sha256',
  'storage_path',
  'reject_reason',
  'preview_state',
] as const

const TABLE = 'capture_files'
const MAX_FILES_PER_JOB = 20
const PDF_HEADER_WINDOW = 1024
const PDF_EOF_WINDOW = 1024

export interface CaptureIngestLimits {
  /** Twilio download, headers + body */
  fetchTimeoutMs: number
  uploadTimeoutMs: number
  /** existing-object download on the duplicate path */
  downloadExistingTimeoutMs: number
  /** each database call */
  dbTimeoutMs: number
  /** no NEW file is started once this much of the job has elapsed */
  startGateMs: number
  /** hard per-job deadline, checked before every network call */
  jobDeadlineMs: number
}

export const DEFAULT_LIMITS: CaptureIngestLimits = {
  fetchTimeoutMs: 15_000,
  uploadTimeoutMs: 30_000,
  downloadExistingTimeoutMs: 15_000,
  dbTimeoutMs: 10_000,
  startGateMs: 20_000,
  jobDeadlineMs: 90_000,
}

export interface CaptureIngestFile {
  file_id: string
  file_no: number
  media_index: number
  claimed_content_type: string | null
  url: string
}

/** The contract with migration 050 (supabase/migrations/050_material_inward_functions.sql:362-385). */
export interface CaptureIngestJobPayload {
  tenant_id: string
  project_id: string
  document_id: string
  source_message_sid: string
  files: CaptureIngestFile[]
}

export type CaptureContentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

export interface CaptureIngestCounts {
  files: number
  stored: number
  rejected: number
  alreadyDone: number
  skipped: number
  quarantined: number
  anomalies: number
  retryable: number
}

export interface CaptureIngestDeps {
  supabaseClient?: SupabaseClient
  fetchFn?: typeof fetch
  now?: () => number
  limits?: Partial<CaptureIngestLimits>
  /** the jobs.id, for events only */
  jobId?: string
}

/** Thrown after the loop when at least one file needs another attempt. The message is counts and codes only. */
export class CaptureIngestIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureIngestIncompleteError'
  }
}

class DeadlineError extends Error {}
class TimeoutError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Pure byte checks
// ---------------------------------------------------------------------------------------------------------------

function startsWith(buf: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (buf.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (buf[at + i] !== sig[i]) return false
  return true
}

const JPEG = [0xff, 0xd8, 0xff] as const
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const RIFF = [0x52, 0x49, 0x46, 0x46] as const
const WEBP = [0x57, 0x45, 0x42, 0x50] as const
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] as const // "%PDF-"

/**
 * The type of the BYTES. claimed_content_type and the HTTP Content-Type are never consulted. JPEG, PNG and WebP are
 * recognised at byte 0; a PDF header is accepted anywhere in the first 1024 bytes (review S4, Aravind: some scanner
 * apps write a prefix before it; V3:203 said byte 0). Anything else is null.
 */
export function detectContentType(head: Uint8Array): CaptureContentType | null {
  if (startsWith(head, JPEG)) return 'image/jpeg'
  if (startsWith(head, PNG)) return 'image/png'
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp'
  const window = head.subarray(0, PDF_HEADER_WINDOW)
  for (let i = 0; i + PDF.length <= window.length; i++) {
    if (window[i] === PDF[0] && startsWith(window, PDF, i)) return 'application/pdf'
  }
  return null
}

/**
 * Byte-level only, no PDF parser (A12). Not previewable when the file carries an /Encrypt token anywhere, or has no
 * %%EOF in its last 1024 bytes (unparseable, A6). The original bytes are stored either way.
 */
export function analysePdf(bytes: Uint8Array): 'previewable' | 'not_previewable' {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.includes('/Encrypt')) return 'not_previewable'
  const tail = buf.subarray(Math.max(0, buf.length - PDF_EOF_WINDOW))
  if (!tail.includes('%%EOF')) return 'not_previewable'
  return 'previewable'
}

export function previewStateFor(type: CaptureContentType, bytes: Uint8Array): 'previewable' | 'not_previewable' {
  return type === 'application/pdf' ? analysePdf(bytes) : 'previewable'
}

/** Review item 2: the URL carries our credentials, so it must be a Twilio media URL of OUR account. */
export function isTwilioMediaUrl(raw: string, accountSid: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === 'https:' &&
      u.hostname === 'api.twilio.com' &&
      u.port === '' &&
      u.username === '' &&
      u.password === '' &&
      u.pathname.startsWith(`/2010-04-01/Accounts/${accountSid}/`)
    )
  } catch {
    return false
  }
}

/** error.code only if it is exactly five upper-case letters/digits (a SQLSTATE such as QE011, 23514); else 'unknown'. */
export function sanitiseCode(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Z0-9]{5}$/.test(raw) ? raw : 'unknown'
}

// ---------------------------------------------------------------------------------------------------------------
// Payload validation (no zod in this repo; review N1: 1-20 files)
// ---------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

export function parsePayload(raw: unknown): CaptureIngestJobPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (!isUuid(p.tenant_id) || !isUuid(p.project_id) || !isUuid(p.document_id)) return null
  if (typeof p.source_message_sid !== 'string' || p.source_message_sid.length === 0 || p.source_message_sid.length > 200) {
    return null
  }
  if (!Array.isArray(p.files) || p.files.length < 1 || p.files.length > MAX_FILES_PER_JOB) return null
  const seen = new Set<string>()
  const files: CaptureIngestFile[] = []
  for (const f of p.files as unknown[]) {
    if (typeof f !== 'object' || f === null) return null
    const e = f as Record<string, unknown>
    if (!isUuid(e.file_id) || seen.has(e.file_id)) return null
    if (!Number.isInteger(e.file_no) || (e.file_no as number) < 1) return null
    if (!Number.isInteger(e.media_index) || (e.media_index as number) < 0) return null
    if (typeof e.url !== 'string' || e.url.length === 0 || e.url.length > 2048) return null
    if (e.claimed_content_type != null && typeof e.claimed_content_type !== 'string') return null
    seen.add(e.file_id)
    files.push({
      file_id: e.file_id,
      file_no: e.file_no as number,
      media_index: e.media_index as number,
      claimed_content_type: (e.claimed_content_type as string | null | undefined) ?? null,
      url: e.url,
    })
  }
  return {
    tenant_id: p.tenant_id,
    project_id: p.project_id,
    document_id: p.document_id,
    source_message_sid: p.source_message_sid,
    files,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Time budget: ONE per-job deadline covers every network call (review S3)
// ---------------------------------------------------------------------------------------------------------------

class Budget {
  private readonly startedAt: number
  constructor(
    private readonly clock: () => number,
    private readonly limits: CaptureIngestLimits,
  ) {
    this.startedAt = clock()
  }
  elapsed(): number {
    return this.clock() - this.startedAt
  }
  remaining(): number {
    return this.limits.jobDeadlineMs - this.elapsed()
  }
  /** Throws DeadlineError when the hard deadline has passed. Call before EVERY network call. */
  guard(): void {
    if (this.remaining() <= 0) throw new DeadlineError()
  }
  /** A per-call timeout, never longer than what is left of the job. */
  cap(ms: number): number {
    return Math.max(1, Math.min(ms, this.remaining()))
  }
  startGateOpen(): boolean {
    return this.elapsed() < this.limits.startGateMs
  }
}

async function withTimeout<T>(ms: number, p: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms)
  })
  try {
    return await Promise.race([Promise.resolve(p), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Download with the size cap enforced WHILE streaming (never res.arrayBuffer())
// ---------------------------------------------------------------------------------------------------------------

export type DownloadResult =
  | { kind: 'ok'; bytes: Buffer; type: CaptureContentType }
  | { kind: 'rejected'; reason: 'wrong_type' }
  | { kind: 'rejected'; reason: 'too_large'; type: CaptureContentType }
  | { kind: 'retry'; code: string }

export async function downloadChecked(
  fetchFn: typeof fetch,
  url: string,
  authorization: string,
  timeoutMs: number,
  maxBytes: number = CAPTURE_MAX_BYTES,
): Promise<DownloadResult> {
  const controller = new AbortController()
  let timedOut = false
  let abortReject: (e: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    abortReject = reject
  })
  aborted.catch(() => {})
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    abortReject(new TimeoutError())
  }, timeoutMs)
  const stop = (): void => {
    controller.abort()
  }
  try {
    let res: Response
    try {
      res = await Promise.race([fetchFn(url, { headers: { Authorization: authorization }, signal: controller.signal }), aborted])
    } catch {
      return { kind: 'retry', code: timedOut ? 'timeout' : 'network' }
    }
    if (!res.ok) {
      try {
        await res.body?.cancel()
      } catch {
        // the status is the finding; a failed cancel changes nothing
      }
      return { kind: 'retry', code: `http${res.status}` }
    }
    if (!res.body) return { kind: 'rejected', reason: 'wrong_type' }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let type: CaptureContentType | null = null
    let decided = false
    const declared = Number(res.headers.get('content-length'))
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted])
        if (value && value.length > 0) {
          chunks.push(value)
          total += value.length
        }
        // The type is decided on the first 1024 bytes (the PDF window) or at the end of a shorter body, BEFORE any
        // size decision, so wrong_type always beats too_large.
        if (!decided && (total >= PDF_HEADER_WINDOW || done)) {
          decided = true
          type = detectContentType(Buffer.concat(chunks, total))
          if (!type) {
            await reader.cancel().catch(() => {})
            stop()
            return { kind: 'rejected', reason: 'wrong_type' }
          }
          if (Number.isFinite(declared) && declared > maxBytes) {
            await reader.cancel().catch(() => {})
            stop()
            return { kind: 'rejected', reason: 'too_large', type }
          }
        }
        if (total > maxBytes && type) {
          await reader.cancel().catch(() => {})
          stop()
          return { kind: 'rejected', reason: 'too_large', type }
        }
        if (done) break
      }
    } catch {
      await reader.cancel().catch(() => {})
      return { kind: 'retry', code: timedOut ? 'timeout' : 'network' }
    }
    if (!type) return { kind: 'rejected', reason: 'wrong_type' }
    return { kind: 'ok', bytes: Buffer.concat(chunks, total), type }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Events (C6): the only Sentry caller. Table name, counts, codes, job id. Nothing else.
// ---------------------------------------------------------------------------------------------------------------

function captureEvent(kind: string, jobId: string | undefined, extra: Record<string, number | string>): void {
  Sentry.captureMessage(`capture_ingest: ${kind}`, {
    level: 'error',
    fingerprint: ['capture-ingest', kind],
    tags: { feature: 'capture-ingest' },
    extra: { table: TABLE, ...(jobId ? { jobId } : {}), ...extra },
  })
}

/** Deterministic refusals from the database: alert, never retry (review Q5). */
const NON_RETRY_DB_CODES = new Set(['QE011', 'QE009', 'QE014', '23514', '42501'])

function errorField(err: unknown, field: string): unknown {
  return typeof err === 'object' && err !== null ? (err as Record<string, unknown>)[field] : undefined
}

function asHttp(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) ? n : null
}

/** The first 4xx HTTP code of a storage error as a 3-digit string, else 'unknown'. Never the message. */
function httpCodeOf(err: unknown): string {
  // statusCode first: the storage API reports the specific condition there (415) under a generic HTTP 400
  const codes = [asHttp(errorField(err, 'statusCode')), asHttp(errorField(err, 'status'))]
  const c = codes.find((n): n is number => n !== null && n >= 400 && n < 500)
  return c === undefined ? 'unknown' : String(c)
}

/** supabase-js Storage error -> duplicate | deterministic (4xx, not 408/429) | retry. */
export function classifyStorageError(err: unknown): 'duplicate' | 'deterministic' | 'retry' {
  const codes = [asHttp(errorField(err, 'status')), asHttp(errorField(err, 'statusCode'))].filter(
    (n): n is number => n !== null,
  )
  const message = String(errorField(err, 'message') ?? '')
  if (codes.includes(409) || /already exists/i.test(message)) return 'duplicate'
  if (codes.some((c) => c >= 400 && c < 500 && c !== 408 && c !== 429)) return 'deterministic'
  return 'retry'
}

// ---------------------------------------------------------------------------------------------------------------
// The one UPDATE (C3, C4)
// ---------------------------------------------------------------------------------------------------------------

interface FileRow {
  id: string
  tenant_id: string
  project_id: string
  document_id: string
  source_message_sid: string
  media_index: number
  file_no: number
  ingest_status: string
}

type UpdateSet = {
  ingest_status: 'stored' | 'rejected' | 'failed'
  content_type?: CaptureContentType
  byte_size?: number
  sha256?: string
  storage_path?: string
  reject_reason?: 'wrong_type' | 'too_large'
  preview_state?: 'previewable' | 'not_previewable'
}

interface UpdateResult {
  rows: number
  errorCode: string | null
  errored: boolean
}

/**
 * The ONLY writer of capture_files. Filters id, tenant_id, document_id and ingest_status IN ('pending','failed'); a
 * retry on a terminal row therefore touches 0 rows instead of reaching the 051 trigger. `onlyPending` adds the
 * narrower = 'pending' used by the dead letter so the returned count means "moved just now".
 */
async function guardedUpdate(
  supabase: SupabaseClient,
  budget: Budget,
  limits: CaptureIngestLimits,
  where: { ids: string[]; tenantId: string; documentId: string },
  set: UpdateSet,
  onlyPending = false,
): Promise<UpdateResult> {
  budget.guard()
  let q = supabase
    .from(TABLE)
    .update(set)
    .in('id', where.ids)
    .eq('tenant_id', where.tenantId)
    .eq('document_id', where.documentId)
    .in('ingest_status', ['pending', 'failed'])
  if (onlyPending) q = q.eq('ingest_status', 'pending')
  try {
    const { data, error } = await withTimeout(budget.cap(limits.dbTimeoutMs), q.select('id'))
    if (error) return { rows: 0, errorCode: sanitiseCode(error.code), errored: true }
    return { rows: Array.isArray(data) ? data.length : 0, errorCode: null, errored: false }
  } catch (e) {
    if (e instanceof DeadlineError) throw e
    return { rows: 0, errorCode: 'unknown', errored: true }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------------------------------------------

type FileOutcome =
  | { kind: 'stored' }
  | { kind: 'rejected' }
  | { kind: 'already_done' }
  | { kind: 'quarantined'; event: string; code?: string }
  | { kind: 'anomaly'; event: string; code?: string }
  | { kind: 'retry'; code: string }

interface JobContext {
  supabase: SupabaseClient
  fetchFn: typeof fetch
  budget: Budget
  limits: CaptureIngestLimits
  authorization: string
  accountSid: string
}

function rowPath(row: FileRow): string {
  return `${row.tenant_id}/${row.project_id}/${row.document_id}/${row.id}`
}

async function sha256OfBlob(blob: Blob): Promise<string> {
  return createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')
}

/**
 * Run guardedUpdate for one row and turn the result into an outcome. 0 rows (review S1): re-read the row, scoped to
 * the tenant; terminal with the same sha256 AND storage_path (stored), or the same reject_reason (rejected), is
 * "already done" -- not a fresh store; anything else is an 'update_noop' anomaly, not retried.
 */
async function finishFile(ctx: JobContext, row: FileRow, set: UpdateSet & { ingest_status: 'stored' | 'rejected' }): Promise<FileOutcome> {
  const where = { ids: [row.id], tenantId: row.tenant_id, documentId: row.document_id }
  const res = await guardedUpdate(ctx.supabase, ctx.budget, ctx.limits, where, set)
  if (res.errored) {
    if (res.errorCode !== null && NON_RETRY_DB_CODES.has(res.errorCode)) {
      return { kind: 'anomaly', event: 'db_refused', code: res.errorCode }
    }
    return { kind: 'retry', code: 'update' }
  }
  if (res.rows === 1) {
    return { kind: set.ingest_status === 'stored' ? 'stored' : 'rejected' }
  }
  // 0 rows: someone else finished this row, or it is no longer pending/failed.
  ctx.budget.guard()
  try {
    const { data, error } = await withTimeout(
      ctx.budget.cap(ctx.limits.dbTimeoutMs),
      ctx.supabase
        .from(TABLE)
        .select('ingest_status,sha256,storage_path,reject_reason')
        .eq('id', row.id)
        .eq('tenant_id', row.tenant_id)
        .maybeSingle(),
    )
    if (error) return { kind: 'retry', code: 'read' }
    const cur = data as { ingest_status: string; sha256: string | null; storage_path: string | null; reject_reason: string | null } | null
    if (cur) {
      if (set.ingest_status === 'stored' && cur.ingest_status === 'stored' && cur.sha256 === set.sha256 && cur.storage_path === set.storage_path) {
        return { kind: 'already_done' }
      }
      if (set.ingest_status === 'rejected' && cur.ingest_status === 'rejected' && cur.reject_reason === set.reject_reason) {
        return { kind: 'already_done' }
      }
    }
  } catch (e) {
    if (e instanceof DeadlineError) throw e
    return { kind: 'retry', code: 'read' }
  }
  return { kind: 'anomaly', event: 'update_noop' }
}

async function markFailed(ctx: JobContext, row: FileRow, event: string, code?: string): Promise<FileOutcome> {
  const where = { ids: [row.id], tenantId: row.tenant_id, documentId: row.document_id }
  const res = await guardedUpdate(ctx.supabase, ctx.budget, ctx.limits, where, { ingest_status: 'failed' })
  if (res.errored && !NON_RETRY_DB_CODES.has(res.errorCode ?? '')) return { kind: 'retry', code: 'update' }
  return { kind: 'quarantined', event, code }
}

async function processOneFile(ctx: JobContext, row: FileRow, file: CaptureIngestFile): Promise<FileOutcome> {
  if (!isTwilioMediaUrl(file.url, ctx.accountSid)) return markFailed(ctx, row, 'url_guard')

  ctx.budget.guard()
  const dl = await downloadChecked(ctx.fetchFn, file.url, ctx.authorization, ctx.budget.cap(ctx.limits.fetchTimeoutMs))
  if (dl.kind === 'retry') return { kind: 'retry', code: dl.code }
  if (dl.kind === 'rejected') {
    return finishFile(
      ctx,
      row,
      dl.reason === 'wrong_type'
        ? { ingest_status: 'rejected', reject_reason: 'wrong_type' }
        : { ingest_status: 'rejected', reject_reason: 'too_large', content_type: dl.type },
    )
  }

  const { bytes, type } = dl
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const storagePath = rowPath(row)
  const stored: UpdateSet & { ingest_status: 'stored' } = {
    ingest_status: 'stored',
    content_type: type,
    byte_size: bytes.length,
    sha256,
    storage_path: storagePath,
    preview_state: previewStateFor(type, bytes),
  }

  // C1/S2: upsert:false and the detected contentType on every upload (the bucket enforces allowed_mime_types).
  ctx.budget.guard()
  let uploadError: unknown = null
  try {
    const { error } = await withTimeout(
      ctx.budget.cap(ctx.limits.uploadTimeoutMs),
      ctx.supabase.storage.from(CAPTURE_BUCKET).upload(storagePath, bytes, { upsert: false, contentType: type }),
    )
    uploadError = error
  } catch (e) {
    if (e instanceof DeadlineError) throw e
    return { kind: 'retry', code: 'storage' }
  }

  if (uploadError) {
    const kind = classifyStorageError(uploadError)
    if (kind === 'retry') return { kind: 'retry', code: 'storage' }
    if (kind === 'deterministic') return markFailed(ctx, row, 'storage_rejected', httpCodeOf(uploadError))
    // Duplicate: an earlier attempt already put an object at this row-owned path. Verify, never overwrite.
    ctx.budget.guard()
    let existingSha: string
    try {
      const { data, error } = await withTimeout(
        ctx.budget.cap(ctx.limits.downloadExistingTimeoutMs),
        ctx.supabase.storage.from(CAPTURE_BUCKET).download(storagePath),
      )
      if (error || !data) return { kind: 'retry', code: 'storage' }
      existingSha = await sha256OfBlob(data)
    } catch (e) {
      if (e instanceof DeadlineError) throw e
      return { kind: 'retry', code: 'storage' }
    }
    if (existingSha !== sha256) return markFailed(ctx, row, 'object_conflict')
    // byte-identical: certify the existing object without writing to storage
  }

  return finishFile(ctx, row, stored)
}

// ---------------------------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------------------------

export async function handleCaptureIngestJob(rawPayload: unknown, deps: CaptureIngestDeps = {}): Promise<CaptureIngestCounts> {
  const supabase = deps.supabaseClient ?? createServiceClient()
  const fetchFn = deps.fetchFn ?? fetch
  const limits: CaptureIngestLimits = { ...DEFAULT_LIMITS, ...deps.limits }
  const budget = new Budget(deps.now ?? Date.now, limits)
  const jobId = deps.jobId

  const counts: CaptureIngestCounts = {
    files: 0,
    stored: 0,
    rejected: 0,
    alreadyDone: 0,
    skipped: 0,
    quarantined: 0,
    anomalies: 0,
    retryable: 0,
  }

  const payload = parsePayload(rawPayload)
  if (!payload) {
    captureEvent('payload_invalid', jobId, {})
    return counts
  }
  counts.files = payload.files.length

  let accountSid: string
  let authorization: string
  try {
    const creds = readCredentials()
    accountSid = creds.accountSid
    authorization = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`
  } catch {
    throw new CaptureIngestIncompleteError('capture_files ingest: credentials unavailable')
  }

  // Read the rows. The tenant filter is in the WHERE (CLAUDE.md section 4); a payload tenant that differs from a
  // row's returns no row for that id, which is a mismatch just like a wrong project, document or SID.
  let rows: FileRow[]
  try {
    budget.guard()
    const { data, error } = await withTimeout(
      budget.cap(limits.dbTimeoutMs),
      supabase
        .from(TABLE)
        .select('id,tenant_id,project_id,document_id,source_message_sid,media_index,file_no,ingest_status')
        .in(
          'id',
          payload.files.map((f) => f.file_id),
        )
        .eq('tenant_id', payload.tenant_id),
    )
    if (error) throw new Error('read')
    rows = (data ?? []) as FileRow[]
  } catch {
    throw new CaptureIngestIncompleteError('capture_files ingest: row read failed')
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  let mismatches = 0
  for (const f of payload.files) {
    const r = byId.get(f.file_id)
    if (
      !r ||
      r.tenant_id !== payload.tenant_id ||
      r.project_id !== payload.project_id ||
      r.document_id !== payload.document_id ||
      r.source_message_sid !== payload.source_message_sid ||
      r.file_no !== f.file_no ||
      r.media_index !== f.media_index
    ) {
      mismatches++
    }
  }
  if (mismatches > 0 || rows.length !== payload.files.length) {
    // Fail the whole job closed: nothing is downloaded or written.
    captureEvent('identity_mismatch', jobId, { fileCount: payload.files.length, mismatchCount: Math.max(mismatches, 1) })
    counts.anomalies = payload.files.length
    return counts
  }

  const ctx: JobContext = { supabase, fetchFn, budget, limits, authorization, accountSid }
  const eventCounts = new Map<string, { n: number; code?: string }>()
  const retryCodes = new Map<string, number>()
  const bumpRetry = (code: string): void => {
    counts.retryable++
    retryCodes.set(code, (retryCodes.get(code) ?? 0) + 1)
  }

  const ordered = [...payload.files].sort((a, b) => a.file_no - b.file_no)
  let deadlineHit = false
  for (const file of ordered) {
    const row = byId.get(file.file_id)
    if (!row) continue
    if (row.ingest_status === 'stored' || row.ingest_status === 'rejected') {
      counts.skipped++
      continue
    }
    if (deadlineHit || !budget.startGateOpen()) {
      bumpRetry('deferred')
      continue
    }
    let outcome: FileOutcome
    try {
      outcome = await processOneFile(ctx, row, file)
    } catch (e) {
      if (e instanceof DeadlineError) {
        deadlineHit = true
        outcome = { kind: 'retry', code: 'deferred' }
      } else {
        outcome = { kind: 'retry', code: 'unexpected' }
      }
    }
    switch (outcome.kind) {
      case 'stored':
        counts.stored++
        break
      case 'rejected':
        counts.rejected++
        break
      case 'already_done':
        counts.alreadyDone++
        break
      case 'quarantined':
      case 'anomaly': {
        if (outcome.kind === 'quarantined') counts.quarantined++
        else counts.anomalies++
        const cur = eventCounts.get(outcome.event) ?? { n: 0 }
        cur.n++
        if (outcome.code && !cur.code) cur.code = outcome.code
        eventCounts.set(outcome.event, cur)
        break
      }
      case 'retry':
        bumpRetry(outcome.code)
        break
    }
  }

  for (const [kind, { n, code }] of eventCounts) {
    captureEvent(kind, jobId, { fileCount: payload.files.length, count: n, ...(code ? { errorCode: code } : {}) })
  }

  if (counts.retryable > 0) {
    const breakdown = [...retryCodes].map(([c, n]) => `${c}:${n}`).join(' ')
    throw new CaptureIngestIncompleteError(
      `capture_files ingest: ${counts.retryable} of ${payload.files.length} files not completed (${breakdown})`,
    )
  }
  return counts
}

// ---------------------------------------------------------------------------------------------------------------
// Dead letter (called by the tick only when retries are exhausted)
// ---------------------------------------------------------------------------------------------------------------

const SAFE_LAST_ERROR = /^capture_files ingest: [A-Za-z0-9 :()_-]{1,200}$/

/**
 * One UPDATE moves every payload file still 'pending' to 'failed' (051 allows pending -> failed), then ONE counts-only
 * event if at least one row moved. The engineer receives nothing (R5/A11). Throws on a database error so the tick can
 * send its own event.
 */
export async function markCaptureIngestFailed(
  supabase: SupabaseClient,
  rawPayload: unknown,
  lastError: string,
  jobId?: string,
  deps: { now?: () => number; limits?: Partial<CaptureIngestLimits> } = {},
): Promise<void> {
  const payload = parsePayload(rawPayload)
  if (!payload) {
    captureEvent('payload_invalid', jobId, { phase: 'dead_letter' })
    return
  }
  const limits: CaptureIngestLimits = { ...DEFAULT_LIMITS, ...deps.limits }
  const budget = new Budget(deps.now ?? Date.now, limits)
  const res = await guardedUpdate(
    supabase,
    budget,
    limits,
    { ids: payload.files.map((f) => f.file_id), tenantId: payload.tenant_id, documentId: payload.document_id },
    { ingest_status: 'failed' },
    true,
  )
  if (res.errored) throw new Error(`capture_files ingest: dead letter update failed (${res.errorCode ?? 'unknown'})`)
  if (res.rows > 0) {
    captureEvent('dead_letter', jobId, {
      fileCount: payload.files.length,
      failedCount: res.rows,
      lastError: SAFE_LAST_ERROR.test(lastError) ? lastError : 'unclassified',
    })
  }
}
