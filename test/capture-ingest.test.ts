// PR-C C5: the capture_ingest job handler against the REAL test-db (rows, 051 trigger and grants) and its REAL
// Storage bucket `capture-documents`. Twilio is never contacted: every download goes through a fake fetchFn, the
// credentials are dummy strings, Sentry is mocked. Plan: docs/plans/pr-c-c5-plan.md; review: docs/reviews/c5-plan-review-round-1.md.
//
// Test IDs: T-PRE-1, T-OK-1 (+T-C1-1, T-C3-1, T-C7, Q3 path), T-PDF-*, T-SIZE-*, T-ID-*, T-SKIP-*, T-C4-1, T-C5-*,
// T-S1-*, T-S2-*, T-S3-*, T-RETRY-*, T-MULTI-*, T-DL-*, T-TW-*, T-C6-1, T-NET-1, T-HYG-1.
//
// HYGIENE: every identifier is run-scoped (kit tenants, sids); phones come from kit.phone() only (+19995552NNNNNN,
// never +199955503XX); every storage object is recorded and removed in afterAll; T-HYG-1 counts rows and objects
// under this file's tenants before and after with a real list call and prints both. Tests assert DELTAS under their
// own tenant prefix, never the shared bucket's global count.
// RACE/CONCURRENCY: nothing here proves a concurrent property. Two-worker races are "CI-only, not verified locally".
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const sentry = vi.hoisted(() => ({ events: [] as Array<{ message: string; opts: Record<string, unknown> }> }))
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string, opts: Record<string, unknown>) => {
    sentry.events.push({ message, opts })
  },
  captureException: vi.fn(),
}))

import {
  CAPTURE_BUCKET,
  CAPTURE_FILES_UPDATE_COLUMNS,
  CAPTURE_MAX_BYTES,
  CaptureIngestIncompleteError,
  handleCaptureIngestJob,
  markCaptureIngestFailed,
  type CaptureIngestCounts,
  type CaptureIngestDeps,
  type CaptureIngestJobPayload,
} from '@/lib/media/capture-ingest'
import { buildCaptureKit, miTurn, teardownCaptureKit, type CaptureKit } from './helpers/capture-fixtures'
import {
  chunked,
  jpegBytes,
  leakFindings,
  pdfBytes,
  pngBytes,
  sha256hex,
  streamResponse,
  TEST_ACCOUNT_SID,
  TEST_AUTH_TOKEN,
  twilioUrl,
  webpBytes,
} from './unit/capture-ingest-support'

let kit: CaptureKit
const allEvents: Array<{ message: string; opts: Record<string, unknown> }> = []
const allThrown: string[] = []
const allFetchCalls: Array<{ url: string; method: string; authorization: string | null }> = []
const trackedPaths = new Set<string>()
const trackedDocs: Array<{ tenant: string; project: string; doc: string }> = []
const log: string[] = []

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

interface Row {
  id: string
  tenant_id: string
  project_id: string
  document_id: string
  file_no: number
  ingest_status: string
  content_type: string | null
  byte_size: number | null
  sha256: string | null
  storage_path: string | null
  reject_reason: string | null
  preview_state: string | null
  ingested_at: string | null
}

async function rowsOf(docId: string): Promise<Row[]> {
  const { data, error } = await kit.svc.from('capture_files').select('*').eq('document_id', docId).order('file_no')
  if (error) throw new Error(`rowsOf failed: ${error.message}`)
  return (data ?? []) as Row[]
}

const rowPath = (r: Pick<Row, 'tenant_id' | 'project_id' | 'document_id' | 'id'>) => `${r.tenant_id}/${r.project_id}/${r.document_id}/${r.id}`

async function seed(label: string, n: number): Promise<{ docId: string; payload: CaptureIngestJobPayload; rows: Row[] }> {
  const phone = kit.phone(label)
  await miTurn(kit, phone, '4', kit.sid(`${label}-s0`), { start: true })
  await miTurn(kit, phone, '1', kit.sid(`${label}-s1`))
  const fileSid = kit.sid(`${label}-s2`)
  const media = Array.from({ length: n }, (_, i) => ({ index: i, content_type: 'image/jpeg', url: twilioUrl(label, i) }))
  const r = await miTurn(kit, phone, null, fileSid, { media })
  const { data, error } = await kit.svc.from('jobs').select('payload').eq('type', 'capture_ingest').contains('payload', { source_message_sid: fileSid })
  if (error || !data || data.length !== 1) throw new Error(`seed ${label}: expected exactly one capture_ingest job`)
  const payload = data[0].payload as CaptureIngestJobPayload
  const rows = await rowsOf(r.document_id!)
  trackedDocs.push({ tenant: kit.tenantA, project: kit.p1, doc: r.document_id! })
  for (const row of rows) trackedPaths.add(rowPath(row))
  return { docId: r.document_id!, payload, rows }
}

type Responder = () => Response | Promise<Response>

function fakeFetch(map: Map<string, Responder>): { fn: typeof fetch; calls: Array<{ url: string; method: string; authorization: string | null }> } {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = []
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call = { url, method: init?.method ?? 'GET', authorization: headers.Authorization ?? null }
    calls.push(call)
    allFetchCalls.push(call)
    const r = map.get(url)
    if (!r) throw new Error('unexpected fetch (not registered by the test)')
    return r()
  }) as unknown as typeof fetch
  return { fn, calls }
}

const bytesResponder = (b: Uint8Array): Responder => () => new Response(b as unknown as BodyInit, { status: 200 })
const noFetch = () => fakeFetch(new Map())

// --- instrumented client: records updates (+ the filter calls on each), uploads and downloads; can inject faults ---
interface InstrumentOpts {
  beforeUpdate?: (set: Record<string, unknown>, n: number) => Promise<void>
  replaceUpdate?: (n: number) => { data: unknown; error: unknown } | undefined
  uploadError?: (n: number) => unknown | undefined
  downloadError?: boolean
}
interface Instrumented {
  client: SupabaseClient
  updates: Array<{ table: string; set: Record<string, unknown>; filters: Array<[string, ...unknown[]]> }>
  uploads: Array<{ path: string; options: Record<string, unknown>; error: unknown }>
  downloads: string[]
}

function chain(target: object, before: () => Promise<void>, replace: (() => { data: unknown; error: unknown } | undefined) | undefined, onCall: (name: string, args: unknown[]) => void): object {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'then') {
        return (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
          before()
            .then(() => replace?.())
            .then((rep) => (rep !== undefined ? rep : (t as unknown as PromiseLike<unknown>).then((x) => x)))
            .then(onF, onR)
      }
      const v = Reflect.get(t, prop)
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          onCall(String(prop), args)
          const r = (v as (...a: unknown[]) => unknown).apply(t, args)
          return typeof r === 'object' && r !== null ? chain(r, before, replace, onCall) : r
        }
      }
      return v
    },
  })
}

function instrument(real: SupabaseClient, o: InstrumentOpts = {}): Instrumented {
  const out: Instrumented = { client: undefined as unknown as SupabaseClient, updates: [], uploads: [], downloads: [] }
  let updateN = 0
  let uploadN = 0
  const client = {
    from(table: string) {
      const b = real.from(table)
      return new Proxy(b, {
        get(t, prop) {
          if (prop === 'update') {
            return (set: Record<string, unknown>) => {
              updateN++
              const n = updateN
              const rec = { table, set, filters: [] as Array<[string, ...unknown[]]> }
              out.updates.push(rec)
              const nb = (t as unknown as { update: (s: unknown) => object }).update(set)
              return chain(
                nb,
                async () => {
                  await o.beforeUpdate?.(set, n)
                },
                () => o.replaceUpdate?.(n),
                (name, args) => {
                  if (name === 'eq' || name === 'in') rec.filters.push([name, ...args])
                },
              )
            }
          }
          const v = Reflect.get(t, prop)
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
        },
      })
    },
    storage: {
      from(bucket: string) {
        const sb = real.storage.from(bucket)
        return {
          upload: async (path: string, body: unknown, options: Record<string, unknown>) => {
            uploadN++
            const injected = o.uploadError?.(uploadN)
            const r = injected ? { data: null, error: injected } : await sb.upload(path, body as Buffer, options)
            out.uploads.push({ path, options, error: r.error })
            return r
          },
          download: async (path: string) => {
            out.downloads.push(path)
            if (o.downloadError) return { data: null, error: { message: 'injected', status: 500 } }
            return sb.download(path)
          },
        }
      },
    },
  }
  out.client = client as unknown as SupabaseClient
  return out
}

interface RunResult {
  counts?: CaptureIngestCounts
  error?: Error
  events: Array<{ message: string; opts: Record<string, unknown> }>
}

async function run(payload: unknown, fetchFn: typeof fetch, inst: Instrumented, deps: Partial<CaptureIngestDeps> = {}): Promise<RunResult> {
  sentry.events.length = 0
  let counts: CaptureIngestCounts | undefined
  let error: Error | undefined
  try {
    counts = await handleCaptureIngestJob(payload, { supabaseClient: inst.client, fetchFn, jobId: 'job-test', ...deps })
  } catch (e) {
    error = e as Error
    allThrown.push(error.message)
  }
  const events = [...sentry.events]
  allEvents.push(...events)
  return { counts, error, events }
}

const extraOf = (e: { opts: Record<string, unknown> }) => e.opts.extra as Record<string, unknown>
const kindsOf = (r: RunResult) => r.events.map((e) => (e.opts.fingerprint as string[])[1])

async function countObjects(prefix: string): Promise<number> {
  const { data, error } = await kit.svc.storage.from(CAPTURE_BUCKET).list(prefix, { limit: 1000 })
  if (error) throw new Error(`list ${prefix} failed: ${error.message}`)
  let n = 0
  for (const e of data ?? []) {
    if (e.id === null) n += await countObjects(`${prefix}/${e.name}`)
    else n++
  }
  return n
}

async function objectBytes(path: string): Promise<Buffer | null> {
  const { data, error } = await kit.svc.storage.from(CAPTURE_BUCKET).download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

async function totalRows(): Promise<number> {
  const { count, error } = await kit.svc.from('capture_files').select('id', { count: 'exact', head: true }).in('tenant_id', [kit.tenantA, kit.tenantB])
  if (error) throw new Error(`count failed: ${error.message}`)
  return count ?? 0
}

let rowsAtStart = 0
let objectsAtStart = 0

beforeAll(async () => {
  vi.stubEnv('TWILIO_ACCOUNT_SID', TEST_ACCOUNT_SID)
  vi.stubEnv('TWILIO_AUTH_TOKEN', TEST_AUTH_TOKEN)
  vi.stubEnv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+10000000000')
  kit = await buildCaptureKit('capture-ingest', ['eng', 'engB'])
  rowsAtStart = await totalRows()
  objectsAtStart = (await countObjects(kit.tenantA)) + (await countObjects(kit.tenantB))
})

beforeEach(() => {
  sentry.events.length = 0
})

afterAll(async () => {
  vi.unstubAllEnvs()
  if (!kit) return
  // objects first (this is TEST code; C2 constrains lib/media/capture-ingest.ts, not test teardown)
  const paths = [...trackedPaths]
  const rowsPeak = await totalRows()
  const objectsPeak = (await countObjects(kit.tenantA)) + (await countObjects(kit.tenantB))
  for (let i = 0; i < paths.length; i += 100) await kit.svc.storage.from(CAPTURE_BUCKET).remove(paths.slice(i, i + 100))
  const objectsAfter = (await countObjects(kit.tenantA)) + (await countObjects(kit.tenantB))
  await teardownCaptureKit(kit)
  const rowsAfter = await totalRows()
  let jobsAfter = 0
  for (const tenantId of [kit.tenantA, kit.tenantB]) {
    const { count } = await kit.svc
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'capture_ingest')
      .contains('payload', { tenant_id: tenantId })
    jobsAfter += count ?? 0
  }
  // T-HYG-1: both numbers printed, then asserted
  console.info(
    `T-HYG-1 rows: start=${rowsAtStart} peak=${rowsPeak} after=${rowsAfter}; objects: start=${objectsAtStart} peak=${objectsPeak} after=${objectsAfter}; jobs after=${jobsAfter ?? 0}; tracked paths=${paths.length}`,
  )
  console.info(log.join('\n'))
  expect(rowsAfter).toBe(rowsAtStart)
  expect(objectsAfter).toBe(objectsAtStart)
  expect(jobsAfter ?? 0).toBe(0)
})

// ---------------------------------------------------------------------------------------------------------------
// U3: the bucket (observed)
// ---------------------------------------------------------------------------------------------------------------

describe('T-PRE-1 (U3): the capture-documents bucket on test-db matches migration 049', () => {
  it('has the approved settings', async () => {
    const { data, error } = await kit.svc.storage.getBucket(CAPTURE_BUCKET)
    expect(error).toBeNull()
    console.info(`T-PRE-1 RAW bucket: ${JSON.stringify(data)}`)
    expect(data?.id).toBe('capture-documents')
    expect(data?.public).toBe(false)
    expect(data?.file_size_limit).toBe(16777216)
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  })

  it('T-S2-REAL: the bucket refuses a non-allowed content type (why uploadOnce must pass contentType)', async () => {
    const { rows } = await seed('s2real', 1)
    const path = `${rowPath(rows[0])}-probe`
    trackedPaths.add(path)
    const { error } = await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, Buffer.from('plain text'), { upsert: false, contentType: 'text/plain' })
    console.info(`T-S2-REAL RAW error: ${JSON.stringify({ status: (error as { status?: number })?.status, statusCode: (error as { statusCode?: string })?.statusCode, message: error?.message })}`)
    expect(error).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The happy path and the contract items it carries
// ---------------------------------------------------------------------------------------------------------------

describe('T-OK-1: one JPEG is downloaded, checked, stored and certified in ONE update', () => {
  it('stores the original bytes at the row-owned extensionless path', async () => {
    const { docId, payload, rows } = await seed('ok1', 1)
    const jpg = jpegBytes(5000, 11)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ files: 1, stored: 1, rejected: 0, retryable: 0 })
    expect(r.events).toHaveLength(0)

    const [row] = await rowsOf(docId)
    expect(row).toMatchObject({
      ingest_status: 'stored',
      content_type: 'image/jpeg',
      byte_size: jpg.length,
      sha256: sha256hex(jpg),
      preview_state: 'previewable',
      reject_reason: null,
    })
    expect(row.ingested_at).not.toBeNull()
    // Q3: the path is exactly the row-derived path, with no '.'-suffix after the file id
    expect(row.storage_path).toBe(`${kit.tenantA}/${kit.p1}/${docId}/${rows[0].id}`)
    expect(row.storage_path!.split('/').pop()).not.toContain('.')
    // the original bytes, untouched
    const got = await objectBytes(row.storage_path!)
    expect(got && Buffer.compare(got, jpg)).toBe(0)

    // T-C1-1 / S2: upsert:false AND the detected contentType on every upload, to the row-owned path
    expect(inst.uploads).toHaveLength(1)
    expect(inst.uploads[0].options).toEqual({ upsert: false, contentType: 'image/jpeg' })
    expect(inst.uploads[0].path).toBe(row.storage_path)
    // T-C3-1: exactly ONE update, carrying every terminal detail
    expect(inst.updates).toHaveLength(1)
    expect(Object.keys(inst.updates[0].set).sort()).toEqual(['byte_size', 'content_type', 'ingest_status', 'preview_state', 'sha256', 'storage_path'])
    // T-C4-1 (shape): the filters
    const f4 = inst.updates[0].filters
    expect(f4).toContainEqual(['in', 'id', [rows[0].id]])
    expect(f4).toContainEqual(['eq', 'tenant_id', kit.tenantA])
    expect(f4).toContainEqual(['eq', 'document_id', docId])
    expect(f4).toContainEqual(['in', 'ingest_status', ['pending', 'failed']])
    // T-TW-1: a plain GET with exactly Basic base64(sid:token)
    expect(f.calls).toEqual([
      { url: payload.files[0].url, method: 'GET', authorization: `Basic ${Buffer.from(`${TEST_ACCOUNT_SID}:${TEST_AUTH_TOKEN}`).toString('base64')}` },
    ])
  })
})

describe('T-PDF / T-SIZE-4: types from bytes, rejections, preview_state (one document, six files)', () => {
  it('handles every kind of file independently and writes the right shape for each', async () => {
    const { docId, payload, rows } = await seed('types', 6)
    const pdfPrefixed = pdfBytes({ prefix: 200, seed: 1 })
    const pdfEnc = pdfBytes({ encrypted: true, seed: 2 })
    const pdfNoEof = pdfBytes({ eof: false, seed: 3 })
    const png = pngBytes(3000, 4)
    const webp = webpBytes(3000, 5)
    const html = Buffer.from('<html><body>an error page, not a document</body></html>' + ' '.repeat(2000))
    const bodies = [pdfPrefixed, pdfEnc, pdfNoEof, png, webp, html]
    const f = fakeFetch(new Map(payload.files.map((file, i) => [file.url, bytesResponder(bodies[i])])))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ stored: 5, rejected: 1 })

    const got = await rowsOf(docId)
    // S4: a PDF with a 200-byte prefix is stored as application/pdf with IDENTICAL bytes (claimed type was image/jpeg)
    expect(got[0]).toMatchObject({ ingest_status: 'stored', content_type: 'application/pdf', preview_state: 'previewable', sha256: sha256hex(pdfPrefixed) })
    const stored0 = await objectBytes(got[0].storage_path!)
    expect(stored0 && Buffer.compare(stored0, pdfPrefixed)).toBe(0)
    // T-PDF-2
    expect(got[1]).toMatchObject({ content_type: 'application/pdf', preview_state: 'not_previewable', ingest_status: 'stored' })
    expect(got[2]).toMatchObject({ content_type: 'application/pdf', preview_state: 'not_previewable', ingest_status: 'stored' })
    expect(got[3]).toMatchObject({ content_type: 'image/png', preview_state: 'previewable' })
    expect(got[4]).toMatchObject({ content_type: 'image/webp', preview_state: 'previewable' })
    // wrong type: reject_reason ONLY, no content_type, no byte_size, nothing stored
    expect(got[5]).toMatchObject({ ingest_status: 'rejected', reject_reason: 'wrong_type', content_type: null, byte_size: null, sha256: null, storage_path: null, preview_state: null })
    expect(await objectBytes(rowPath(rows[5]))).toBeNull()
    const rejectedUpdate = inst.updates.find((u) => u.set.ingest_status === 'rejected')!
    expect(Object.keys(rejectedUpdate.set).sort()).toEqual(['ingest_status', 'reject_reason'])
    // every upload: upsert:false + the detected type
    expect(inst.uploads.map((u) => u.options)).toEqual([
      { upsert: false, contentType: 'application/pdf' },
      { upsert: false, contentType: 'application/pdf' },
      { upsert: false, contentType: 'application/pdf' },
      { upsert: false, contentType: 'image/png' },
      { upsert: false, contentType: 'image/webp' },
    ])
    // C7: across all outcomes every SET key is inside the 051 grant
    const granted = new Set<string>(CAPTURE_FILES_UPDATE_COLUMNS)
    for (const u of inst.updates) for (const k of Object.keys(u.set)) expect(granted.has(k)).toBe(true)
  })

  it('S4: %PDF- only after byte 1024 is wrong_type, nothing stored', async () => {
    const { docId, payload } = await seed('pdf1100', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(pdfBytes({ prefix: 1100 }))]]))
    const r = await run(payload, f.fn, instrument(kit.svc))
    expect(r.counts).toMatchObject({ rejected: 1, stored: 0 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'rejected', reject_reason: 'wrong_type' })
  })

  it('T-SIZE-4 / S5: too_large records reject_reason AND the type detected on the first chunk; byte_size stays NULL; nothing stored', async () => {
    const { docId, payload, rows } = await seed('big', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, () => streamResponse(chunked(jpegBytes(CAPTURE_MAX_BYTES + 1), 1024 * 1024)).res]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.counts).toMatchObject({ rejected: 1, stored: 0 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'rejected', reject_reason: 'too_large', content_type: 'image/jpeg', byte_size: null, sha256: null, storage_path: null })
    expect(Object.keys(inst.updates[0].set).sort()).toEqual(['content_type', 'ingest_status', 'reject_reason'])
    expect(inst.uploads).toHaveLength(0)
    expect(await objectBytes(rowPath(rows[0]))).toBeNull()
  })

  it('T-SIZE-1: a file of exactly 16777216 bytes is stored (the bucket limit is the same number)', async () => {
    const { docId, payload } = await seed('edge', 1)
    const big = jpegBytes(CAPTURE_MAX_BYTES, 21)
    const f = fakeFetch(new Map([[payload.files[0].url, () => streamResponse(chunked(big, 1024 * 1024)).res]]))
    const r = await run(payload, f.fn, instrument(kit.svc))
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ stored: 1 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'stored', byte_size: CAPTURE_MAX_BYTES, sha256: sha256hex(big) })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 1. Payload trust
// ---------------------------------------------------------------------------------------------------------------

describe('T-ID: the payload is checked against the rows BEFORE any download (the whole job fails closed)', () => {
  async function expectUntouched(label: string, make: (p: CaptureIngestJobPayload) => CaptureIngestJobPayload, n = 1) {
    const { docId, payload } = await seed(label, n)
    const f = noFetch()
    const inst = instrument(kit.svc)
    const r = await run(make(payload), f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(f.calls).toHaveLength(0)
    expect(inst.updates).toHaveLength(0)
    expect(inst.uploads).toHaveLength(0)
    expect(kindsOf(r)).toEqual(['identity_mismatch'])
    expect(extraOf(r.events[0])).toMatchObject({ table: 'capture_files', jobId: 'job-test' })
    for (const row of await rowsOf(docId)) expect(row.ingest_status).toBe('pending')
  }

  it('T-ID-1 cross-tenant: the payload names tenant B for tenant A\'s files', () => expectUntouched('id1', (p) => ({ ...p, tenant_id: kit.tenantB })))
  it('T-ID-2a wrong project', () => expectUntouched('id2a', (p) => ({ ...p, project_id: kit.p2 })))
  it('T-ID-2b wrong document', () => expectUntouched('id2b', (p) => ({ ...p, document_id: '00000000-0000-4000-8000-00000000d0c1' })))
  it('T-ID-2c wrong message SID', () => expectUntouched('id2c', (p) => ({ ...p, source_message_sid: 'ZZTestCapture-not-the-sid' })))
  it('T-ID-2d a file id that does not exist', () =>
    expectUntouched('id2d', (p) => ({ ...p, files: [{ ...p.files[0], file_id: '00000000-0000-4000-8000-0000000f11e1' }] })))
  it('T-ID-3 one mismatched file poisons the whole job (the other two are NOT processed)', () =>
    expectUntouched('id3', (p) => ({ ...p, files: [p.files[0], { ...p.files[1], file_no: 99 }, p.files[2]] }), 3))
  it('T-ID-4 an invalid payload is a payload_invalid event, no database call', async () => {
    const f = noFetch()
    const inst = instrument(kit.svc)
    const r = await run({ tenant_id: 'x', files: [] }, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(kindsOf(r)).toEqual(['payload_invalid'])
    expect(inst.updates).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 5. Rows already terminal
// ---------------------------------------------------------------------------------------------------------------

describe('T-SKIP: stored and rejected rows are skipped (no download, no storage call, no write)', () => {
  it('T-SKIP-1/2: a second run over a stored and a rejected row touches nothing', async () => {
    const { docId, payload } = await seed('skip', 2)
    const first = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(900, 31))], [payload.files[1].url, bytesResponder(Buffer.from('<html>' + 'x'.repeat(2000)))]]))
    await run(payload, first.fn, instrument(kit.svc))
    const before = await rowsOf(docId)
    expect(before.map((r) => r.ingest_status)).toEqual(['stored', 'rejected'])

    const f = noFetch()
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ skipped: 2, stored: 0, rejected: 0 })
    expect(f.calls).toHaveLength(0)
    expect(inst.updates).toHaveLength(0)
    expect(inst.uploads).toHaveLength(0)
    expect(inst.downloads).toHaveLength(0)
    const after = await rowsOf(docId)
    expect(after.map((x) => x.ingested_at)).toEqual(before.map((x) => x.ingested_at))
  })

  it('CONTROL: the same payload over PENDING rows does fetch', async () => {
    const { payload } = await seed('skipctl', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(900, 32))]]))
    await run(payload, f.fn, instrument(kit.svc))
    expect(f.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// C4 / C5: the filters and the refusals
// ---------------------------------------------------------------------------------------------------------------

describe('T-C4-1 / T-C5: filtered updates touch 0 rows on a terminal row; a refusal is an alert, never a retry', () => {
  it('T-C4-1 + control: with the status filter a stored row is 0 rows and NO error; without it the 051 trigger answers QE011', async () => {
    const { docId, payload } = await seed('c4', 1)
    await run(payload, fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(700, 41))]])).fn, instrument(kit.svc))
    const [row] = await rowsOf(docId)
    expect(row.ingest_status).toBe('stored')

    const filtered = await kit.svc
      .from('capture_files')
      .update({ ingest_status: 'failed' })
      .in('id', [row.id])
      .eq('tenant_id', row.tenant_id)
      .eq('document_id', row.document_id)
      .in('ingest_status', ['pending', 'failed'])
      .select('id')
    expect(filtered.error).toBeNull()
    expect(filtered.data).toEqual([])

    const unfiltered = await kit.svc.from('capture_files').update({ ingest_status: 'failed' }).eq('id', row.id)
    console.info(`T-C5-2 RAW QE011 error.code from test-db: ${JSON.stringify({ code: unfiltered.error?.code, message: unfiltered.error?.message })}`)
    expect(unfiltered.error?.code).toBe('QE011')
    expect((await rowsOf(docId))[0].ingest_status).toBe('stored')
  })

  it.each(['QE011', 'QE009', 'QE014', '23514', '42501'])('T-C5-1: error code %s is ONE event, exactly one update attempt, the job completes (no retry)', async (code) => {
    const { docId, payload } = await seed(`c5-${code}`, 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(700, 42))]]))
    const inst = instrument(kit.svc, { replaceUpdate: () => ({ data: null, error: { code, message: 'refused' } }) })
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(inst.updates).toHaveLength(1)
    expect(kindsOf(r)).toEqual(['db_refused'])
    expect(extraOf(r.events[0])).toMatchObject({ table: 'capture_files', errorCode: code, count: 1 })
    expect(r.counts).toMatchObject({ anomalies: 1, stored: 0, retryable: 0 })
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
  })

  it('CONTROL: a code outside the set takes the retry path (the handler throws)', async () => {
    const { payload } = await seed('c5ctl', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(700, 43))]]))
    const inst = instrument(kit.svc, { replaceUpdate: () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) })
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeInstanceOf(CaptureIngestIncompleteError)
    expect(r.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (update:1)')
    expect(r.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// S1: a 0-row UPDATE
// ---------------------------------------------------------------------------------------------------------------

describe('T-S1: a 0-row UPDATE is re-read and is never counted as a fresh store', () => {
  async function moveToStored(row: Row, sha: string, path: string): Promise<void> {
    const { error } = await kit.svc
      .from('capture_files')
      .update({ ingest_status: 'stored', content_type: 'image/jpeg', byte_size: 777, sha256: sha, storage_path: path, preview_state: 'previewable' })
      .eq('id', row.id)
    if (error) throw new Error(`moveToStored failed: ${error.message}`)
  }

  it('T-S1-1: the row becomes stored (different sha) between the step-2 read and the UPDATE -> update_noop, not counted', async () => {
    const { docId, payload, rows } = await seed('s1a', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(800, 51))]]))
    const inst = instrument(kit.svc, { beforeUpdate: () => moveToStored(rows[0], sha256hex(Buffer.from('someone else')), `${rowPath(rows[0])}`) })
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ stored: 0, alreadyDone: 0, anomalies: 1 })
    expect(kindsOf(r)).toEqual(['update_noop'])
    expect((await rowsOf(docId))[0].sha256).toBe(sha256hex(Buffer.from('someone else')))
  })

  it('T-S1-2: the row became stored with the SAME sha256 and storage_path -> "already done", not a fresh store, no event', async () => {
    const { docId, payload, rows } = await seed('s1b', 1)
    const jpg = jpegBytes(800, 52)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst = instrument(kit.svc, { beforeUpdate: () => moveToStored(rows[0], sha256hex(jpg), rowPath(rows[0])) })
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ stored: 0, alreadyDone: 1, anomalies: 0 })
    expect(r.events).toHaveLength(0)
    expect((await rowsOf(docId))[0].ingest_status).toBe('stored')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// S2: storage errors
// ---------------------------------------------------------------------------------------------------------------

describe('T-S2: a deterministic storage 4xx other than duplicate ends the file as failed + one event, no retry', () => {
  it('mime/size-style rejection', async () => {
    const { docId, payload } = await seed('s2', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(800, 61))]]))
    const inst = instrument(kit.svc, { uploadError: () => ({ status: 400, statusCode: '415', message: 'mime type is not supported for bucket /secret/path' }) })
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(kindsOf(r)).toEqual(['storage_rejected'])
    expect(extraOf(r.events[0])).toMatchObject({ errorCode: '415', count: 1, markedCount: 1 })
    expect(r.counts).toMatchObject({ quarantined: 1, retryable: 0 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'failed', content_type: null, byte_size: null, storage_path: null })
    expect(Object.keys(inst.updates[0].set)).toEqual(['ingest_status'])
  })

  it('a 5xx storage error is retryable and writes nothing', async () => {
    const { docId, payload } = await seed('s2b', 1)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(800, 62))]]))
    const inst = instrument(kit.svc, { uploadError: () => ({ status: 503, statusCode: '503', message: 'unavailable' }) })
    const r = await run(payload, f.fn, inst)
    expect(r.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (storage:1)')
    expect(inst.updates).toHaveLength(0)
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 4. Retry after a partial job
// ---------------------------------------------------------------------------------------------------------------

describe('T-RETRY: the object already exists at the row-owned path', () => {
  it('T-RETRY-1 (U2): equal bytes -> certified without a second write; the raw duplicate error is printed', async () => {
    const { docId, payload, rows } = await seed('retry1', 1)
    const jpg = jpegBytes(1500, 71)
    const path = rowPath(rows[0])
    const pre = await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, jpg, { upsert: false, contentType: 'image/jpeg' })
    expect(pre.error).toBeNull()
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    const raw = inst.uploads[0].error as Record<string, unknown> | null
    log.push(
      `U2 RAW duplicate-upload error object from test-db: ${JSON.stringify({ name: raw?.name, status: raw?.status, statusCode: raw?.statusCode, message: raw?.message })}`,
    )
    console.info(log[log.length - 1])
    expect(raw).not.toBeNull()
    expect(r.error).toBeUndefined()
    expect(r.counts).toMatchObject({ stored: 1 })
    expect(inst.uploads).toHaveLength(1) // one attempt, refused as a duplicate; nothing was overwritten
    expect(inst.uploads[0].options).toEqual({ upsert: false, contentType: 'image/jpeg' })
    expect(inst.downloads).toEqual([path])
    const [row] = await rowsOf(docId)
    expect(row).toMatchObject({ ingest_status: 'stored', sha256: sha256hex(jpg), storage_path: path })
    expect(await countObjects(`${kit.tenantA}/${kit.p1}/${docId}`)).toBe(1)
    const got = await objectBytes(path)
    expect(got && Buffer.compare(got, jpg)).toBe(0)
  })

  it('T-RETRY-2: DIFFERENT bytes -> the row is failed, one object_conflict event, the existing object is NOT overwritten', async () => {
    const { docId, payload, rows } = await seed('retry2', 1)
    const x = jpegBytes(1500, 72)
    const y = jpegBytes(1500, 73)
    const path = rowPath(rows[0])
    await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, x, { upsert: false, contentType: 'image/jpeg' })
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(y)]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.error).toBeUndefined()
    expect(kindsOf(r)).toEqual(['object_conflict'])
    expect(extraOf(r.events[0])).toMatchObject({ count: 1, markedCount: 1 })
    expect(r.counts).toMatchObject({ quarantined: 1, stored: 0 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'failed', sha256: null, storage_path: null })
    const got = await objectBytes(path)
    expect(got && Buffer.compare(got, x)).toBe(0) // still X
    expect(inst.uploads).toHaveLength(1)
    expect(inst.uploads[0].options).toMatchObject({ upsert: false })
  })

  it('CONTROL for T-RETRY-2: a raw upsert:true DOES overwrite, so the byte read-back assertion can fail', async () => {
    const { rows } = await seed('retryctl', 1)
    const path = rowPath(rows[0])
    const x = jpegBytes(900, 74)
    const y = jpegBytes(900, 75)
    await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, x, { upsert: false, contentType: 'image/jpeg' })
    await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, y, { upsert: true, contentType: 'image/jpeg' })
    const got = await objectBytes(path)
    expect(got && Buffer.compare(got, y)).toBe(0)
    expect(got && Buffer.compare(got, x)).not.toBe(0)
  })

  it('T-RETRY-3: the existing-object download fails -> retryable, row stays pending, the object is untouched', async () => {
    const { docId, payload, rows } = await seed('retry3', 1)
    const jpg = jpegBytes(1200, 76)
    const path = rowPath(rows[0])
    await kit.svc.storage.from(CAPTURE_BUCKET).upload(path, jpg, { upsert: false, contentType: 'image/jpeg' })
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst = instrument(kit.svc, { downloadError: true })
    const r = await run(payload, f.fn, inst)
    expect(r.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (storage:1)')
    expect(inst.updates).toHaveLength(0)
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
  })

  it('T-RETRY-4: upload ok, UPDATE fails -> attempt 2 certifies the same object; one object, one row, upsert:false throughout', async () => {
    const { docId, payload } = await seed('retry4', 1)
    const jpg = jpegBytes(1200, 77)
    const f = fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst1 = instrument(kit.svc, { replaceUpdate: () => ({ data: null, error: { code: '08006', message: 'connection failure' } }) })
    const r1 = await run(payload, f.fn, inst1)
    expect(r1.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (update:1)')
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
    expect(await countObjects(`${kit.tenantA}/${kit.p1}/${docId}`)).toBe(1)

    const inst2 = instrument(kit.svc)
    const r2 = await run(payload, f.fn, inst2)
    expect(r2.error).toBeUndefined()
    expect(r2.counts).toMatchObject({ stored: 1 })
    expect((await rowsOf(docId))[0]).toMatchObject({ ingest_status: 'stored', sha256: sha256hex(jpg) })
    expect(await countObjects(`${kit.tenantA}/${kit.p1}/${docId}`)).toBe(1)
    for (const u of [...inst1.uploads, ...inst2.uploads]) expect(u.options).toMatchObject({ upsert: false, contentType: 'image/jpeg' })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 6. Multi-file independence, time budget
// ---------------------------------------------------------------------------------------------------------------

describe('T-MULTI / T-S3: per-file independence and the per-job deadline', () => {
  it('T-MULTI-1/2: a failing file does not block the others; the retry only touches what is unfinished', async () => {
    const { docId, payload } = await seed('multi', 3)
    const [u1, u2, u3] = payload.files.map((f) => f.url)
    const good = jpegBytes(900, 81)
    const first = fakeFetch(
      new Map<string, Responder>([
        [u1, () => new Response('server error', { status: 500 })],
        [u2, bytesResponder(good)],
        [u3, bytesResponder(Buffer.from('<html>' + 'x'.repeat(2000)))],
      ]),
    )
    const r1 = await run(payload, first.fn, instrument(kit.svc))
    expect(r1.error).toBeInstanceOf(CaptureIngestIncompleteError)
    expect(r1.error?.message).toBe('capture_files ingest: 1 of 3 files not completed (http500:1)')
    expect((await rowsOf(docId)).map((r) => r.ingest_status)).toEqual(['pending', 'stored', 'rejected'])

    const second = fakeFetch(new Map<string, Responder>([[u1, bytesResponder(jpegBytes(900, 82))]]))
    const r2 = await run(payload, second.fn, instrument(kit.svc))
    expect(r2.error).toBeUndefined()
    expect(second.calls.map((c) => c.url)).toEqual([u1]) // only the unfinished file was fetched
    expect(r2.counts).toMatchObject({ stored: 1, skipped: 2 })
    expect((await rowsOf(docId)).map((r) => r.ingest_status)).toEqual(['stored', 'stored', 'rejected'])
  })

  it('T-MULTI-3: after the start gate (20 s) no NEW file is started; the rest are deferred and stay pending', async () => {
    const { docId, payload } = await seed('gate', 3)
    let t = 1_000_000
    const map = new Map<string, Responder>([
      [payload.files[0].url, () => ((t += 21_000), bytesResponder(jpegBytes(900, 91))())],
      [payload.files[1].url, bytesResponder(jpegBytes(900, 92))],
      [payload.files[2].url, bytesResponder(jpegBytes(900, 93))],
    ])
    const f = fakeFetch(map)
    const r = await run(payload, f.fn, instrument(kit.svc), { now: () => t })
    expect(f.calls).toHaveLength(1)
    expect(r.error?.message).toBe('capture_files ingest: 2 of 3 files not completed (deferred:2)')
    expect((await rowsOf(docId)).map((x) => x.ingest_status)).toEqual(['stored', 'pending', 'pending'])
  })

  it('T-S3-1: the 90 s job deadline passes before the upload -> NO upload, the file is deferred, the row stays pending', async () => {
    const { docId, payload } = await seed('deadline', 1)
    let t = 5_000_000
    const f = fakeFetch(new Map<string, Responder>([[payload.files[0].url, () => ((t += 91_000), bytesResponder(jpegBytes(900, 94))())]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst, { now: () => t })
    expect(inst.uploads).toHaveLength(0)
    expect(inst.updates).toHaveLength(0)
    expect(r.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (deferred:1)')
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
  })

  it('T-S3-2: the deadline passes between the upload and the UPDATE -> no UPDATE; the retry certifies the identical object', async () => {
    const { docId, payload } = await seed('deadline2', 1)
    const jpg = jpegBytes(900, 95)
    let t = 7_000_000
    const f = fakeFetch(new Map<string, Responder>([[payload.files[0].url, bytesResponder(jpg)]]))
    const inst = instrument(kit.svc)
    const realUpload = inst.client.storage.from(CAPTURE_BUCKET).upload.bind(inst.client.storage.from(CAPTURE_BUCKET))
    const wrapped = {
      ...inst.client,
      from: inst.client.from.bind(inst.client),
      storage: {
        from: () => ({
          upload: async (p: string, b: Buffer, o: Record<string, unknown>) => {
            const res = await realUpload(p, b, o as never)
            t += 91_000
            return res
          },
          download: inst.client.storage.from(CAPTURE_BUCKET).download.bind(inst.client.storage.from(CAPTURE_BUCKET)),
        }),
      },
    } as unknown as SupabaseClient
    const r = await run(payload, f.fn, { ...inst, client: wrapped }, { now: () => t })
    expect(inst.updates).toHaveLength(0)
    expect(r.error?.message).toBe('capture_files ingest: 1 of 1 files not completed (deferred:1)')
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
    const r2 = await run(payload, f.fn, instrument(kit.svc))
    expect(r2.counts).toMatchObject({ stored: 1 })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 7. Dead letter
// ---------------------------------------------------------------------------------------------------------------

describe('T-DL: after the last attempt, rows still pending are moved to failed in ONE update', () => {
  it('T-DL-1: 3 pending -> failed, the stored one is untouched, one counts-only event', async () => {
    const { docId, payload } = await seed('dl1', 4)
    // finish file 4 first (a payload holding only that file)
    const only4 = { ...payload, files: [payload.files[3]] }
    await run(only4, fakeFetch(new Map([[payload.files[3].url, bytesResponder(jpegBytes(900, 101))]])).fn, instrument(kit.svc))
    expect((await rowsOf(docId))[3].ingest_status).toBe('stored')

    sentry.events.length = 0
    const inst = instrument(kit.svc)
    await markCaptureIngestFailed(inst.client, payload, 'capture_files ingest: 3 of 4 files not completed (http500:3)', 'job-dl')
    allEvents.push(...sentry.events)
    expect(inst.updates).toHaveLength(1)
    expect(inst.updates[0].set).toEqual({ ingest_status: 'failed' })
    expect(inst.updates[0].filters).toContainEqual(['eq', 'ingest_status', 'pending'])
    expect(inst.updates[0].filters).toContainEqual(['in', 'ingest_status', ['pending', 'failed']])
    expect((await rowsOf(docId)).map((r) => r.ingest_status)).toEqual(['failed', 'failed', 'failed', 'stored'])
    expect(sentry.events).toHaveLength(1)
    expect(extraOf(sentry.events[0])).toMatchObject({ table: 'capture_files', jobId: 'job-dl', fileCount: 4, failedCount: 3 })
  })

  it('T-DL-1b: nothing pending -> no event, no error', async () => {
    const { payload } = await seed('dl1b', 1)
    await run(payload, fakeFetch(new Map([[payload.files[0].url, bytesResponder(jpegBytes(700, 102))]])).fn, instrument(kit.svc))
    sentry.events.length = 0
    await markCaptureIngestFailed(kit.svc, payload, 'x', 'job-dl')
    expect(sentry.events).toHaveLength(0)
  })

  it('T-DL-2: a payload naming ANOTHER tenant cannot move this tenant\'s rows', async () => {
    const { docId, payload } = await seed('dl2', 2)
    sentry.events.length = 0
    await markCaptureIngestFailed(kit.svc, { ...payload, tenant_id: kit.tenantB }, 'x', 'job-dl')
    expect((await rowsOf(docId)).map((r) => r.ingest_status)).toEqual(['pending', 'pending'])
    expect(sentry.events).toHaveLength(0)
  })

  it('T-DL-3: a database error throws (the tick wraps it and sends its own event)', async () => {
    const { payload } = await seed('dl3', 1)
    const inst = instrument(kit.svc, { replaceUpdate: () => ({ data: null, error: { code: '42501', message: 'denied' } }) })
    await expect(markCaptureIngestFailed(inst.client, payload, 'x', 'job-dl')).rejects.toThrow('capture_files ingest: dead letter update failed (42501)')
  })

  it('T-DL-4 / T-R5-1: the engineer receives nothing -- every fetch in this file is a GET of a media URL', () => {
    expect(allFetchCalls.length).toBeGreaterThan(0)
    for (const c of allFetchCalls) {
      expect(c.method).toBe('GET')
      expect(c.url).toMatch(/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/[^/]+\/Messages\/MM[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/)
      expect(c.url).not.toContain('Messages.json')
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 8. Twilio download
// ---------------------------------------------------------------------------------------------------------------

describe('T-TW: the download', () => {
  it.each([401, 404, 410, 429, 500, 503])('T-TW-2: HTTP %i writes nothing, stays pending, and the message carries the digits only', async (status) => {
    const { docId, payload } = await seed(`tw2-${status}`, 1)
    const f = fakeFetch(new Map<string, Responder>([[payload.files[0].url, () => new Response('upstream said no', { status })]]))
    const inst = instrument(kit.svc)
    const r = await run(payload, f.fn, inst)
    expect(r.error?.message).toBe(`capture_files ingest: 1 of 1 files not completed (http${status}:1)`)
    expect(inst.updates).toHaveLength(0)
    expect(inst.uploads).toHaveLength(0)
    expect((await rowsOf(docId))[0].ingest_status).toBe('pending')
  })

  it.each([
    ['http scheme', (u: string) => u.replace('https:', 'http:')],
    ['other host', (u: string) => u.replace('api.twilio.com', 'example.invalid')],
    ['other account', (u: string) => u.replace(TEST_ACCOUNT_SID, 'AC-c5-other-account-not-real')],
  ])('T-TW-5: a url with the wrong %s is never fetched; the row is failed with one url_guard event', async (_n, mutate) => {
    const { docId, payload } = await seed(`tw5-${_n.replace(' ', '')}`, 1)
    const bad = { ...payload, files: [{ ...payload.files[0], url: mutate(payload.files[0].url) }] }
    const f = noFetch()
    const inst = instrument(kit.svc)
    const r = await run(bad, f.fn, inst)
    expect(f.calls).toHaveLength(0)
    expect(r.error).toBeUndefined()
    expect(kindsOf(r)).toEqual(['url_guard'])
    expect(extraOf(r.events[0])).toMatchObject({ count: 1, markedCount: 1 })
    expect(Object.keys(inst.updates[0].set)).toEqual(['ingest_status'])
    expect((await rowsOf(docId))[0].ingest_status).toBe('failed')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// C6 and the network
// ---------------------------------------------------------------------------------------------------------------

describe('T-C6-1 / T-NET-1: nothing sensitive in any event or thrown message; the table is always named', () => {
  it('scans every Sentry event and every thrown message produced by this file', () => {
    expect(allEvents.length).toBeGreaterThan(10)
    const literals = [kit.tenantA, kit.tenantB, kit.p1, kit.p2, kit.uid('eng'), kit.uid('engB'), 'ZZTestCapture', 'an error page', 'upstream said no', 'secret/path']
    for (const e of allEvents) {
      expect(leakFindings({ message: e.message, opts: e.opts }, literals)).toEqual([])
      expect(extraOf(e).table).toBe('capture_files')
      expect(Object.keys(extraOf(e)).sort().every((k) => ['table', 'jobId', 'fileCount', 'count', 'markedCount', 'errorCode', 'mismatchCount', 'failedCount', 'lastError', 'phase'].includes(k))).toBe(true)
    }
    for (const m of allThrown) {
      expect(leakFindings(m, literals)).toEqual([])
      expect(m.startsWith('capture_files ingest:')).toBe(true)
    }
  })

  it('CONTROL: a planted event carrying a URL is caught by the same scan', () => {
    expect(leakFindings({ message: 'x', opts: { extra: { u: twilioUrl('p', 1) } } }, [])).not.toEqual([])
  })

  it('every handler call used only the fake fetch (no network): registered urls only', () => {
    for (const c of allFetchCalls) expect(c.url.startsWith('https://api.twilio.com/')).toBe(true)
  })
})
