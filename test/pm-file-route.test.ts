import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PM_BUCKET,
  buildPmKit,
  captureAnon,
  makeDocWithFile,
  removeStoredObjects,
  teardownCaptureKit,
  type CaptureKit,
  type CaptureUserLabel,
  type MadeDoc,
} from './helpers/pm-fixtures'
import { handleCaptureFileGet, type CaptureFileDeps } from '@/lib/capture/pm-file-access'

// T-FILE-1..n, T-FILE-CTRL (real data), T-SIGN-0, T-CACHE-1 (route half) for PR-D. Shared test-db, run-scoped data only.
// handleCaptureFileGet is the SAME function GET calls in production (cf. test/photo-access-route.test.ts); every call
// injects a fresh rate-limit store so the module-level limiter never carries state between tests.
//
// CONTROLS (source mutations are done by the operator, not by this file; they print HEAD + sha256 and revert):
//   * PM_CONTROL=service makes the step-2 row read a SERVICE-ROLE read (rowClient) for the negatives;
//   * with the app check ALSO removed from lib/capture/pm-file-access.ts, the negatives must go RED.

let kit: CaptureKit
let dcA1: MadeDoc & { fileId: string }
let pdfA1: MadeDoc & { fileId: string }
let dcA2: MadeDoc & { fileId: string }
let dcB: MadeDoc & { fileId: string }
let pending: MadeDoc & { fileId: string }
let failed: MadeDoc & { fileId: string }
let rejected: MadeDoc & { fileId: string }

// HOOK TIMEOUT (this file only). The default hookTimeout (30 s, vitest.config.ts) is too tight for this setup. Measured on
// test-db, 31 Oct 2026 (diagnostic run, raw timings in /tmp/quoco/pr-d-tests.txt): buildPmKit 11.4 s (six logins minted),
// then seven makeDocWithFile at 1.9-3.2 s each (three engineer RPC turns plus an upload), TOTAL 29.5 s. No step hangs or
// retries; it is simply slow, and the first run missed 30 s by a hair. 60 s is about 2x the measured total.
// One timing line per step is kept so a future overrun is attributable.
const HOOK_TIMEOUT_MS = 60_000

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[pm-file-route] ${label}: ${Date.now() - t0} ms`)
  }
}

// The setup promise is kept so afterAll can WAIT for it. A beforeAll that times out does not stop the async function: it
// keeps creating documents and uploading objects while afterAll runs, and anything created after the cleanup is leaked.
let setup: Promise<void> | undefined

beforeAll(() => {
  setup = (async () => {
    kit = await timed('buildPmKit', () => buildPmKit('pmf', ['admMem']))
    dcA1 = await timed('makeDocWithFile f-dca1 (stored)', () => makeDocWithFile(kit, 'dc', 'f-dca1', 'stored'))
    pdfA1 = await timed('makeDocWithFile f-pdf (stored_pdf)', () => makeDocWithFile(kit, 'dc', 'f-pdf', 'stored_pdf'))
    dcA2 = await timed('makeDocWithFile f-dca2 (stored, P2)', () => makeDocWithFile(kit, 'dc', 'f-dca2', 'stored', { projectId: kit.p2, userId: kit.uid('engP2') }))
    dcB = await timed('makeDocWithFile f-dcb (stored, tenant B)', () => makeDocWithFile(kit, 'dc', 'f-dcb', 'stored', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') }))
    pending = await timed('makeDocWithFile f-pend (pending)', () => makeDocWithFile(kit, 'dc', 'f-pend', 'pending'))
    failed = await timed('makeDocWithFile f-fail (failed)', () => makeDocWithFile(kit, 'dc', 'f-fail', 'failed'))
    rejected = await timed('makeDocWithFile f-rej (rejected)', () => makeDocWithFile(kit, 'dc', 'f-rej', 'rejected_type'))
  })()
  return setup
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  // Let an in-flight (possibly timed-out) setup finish first, so every object it uploads is tracked before we remove them.
  if (setup) await setup.catch(() => undefined)
  if (!kit) return
  await timed('removeStoredObjects', () => removeStoredObjects(kit))
  await timed('teardownCaptureKit', () => teardownCaptureKit(kit))
}, HOOK_TIMEOUT_MS)

const req = (id: string) => new NextRequest(`http://localhost/api/capture-files/${id}`)

function baseDeps(session: SupabaseClient): CaptureFileDeps {
  return {
    supabaseClient: session,
    serviceClient: kit.svc,
    rateLimit: { store: new Map() },
    // control switch: a service-role step-2 read for the negatives
    ...(process.env.PM_CONTROL === 'service' ? { rowClient: kit.svc } : {}),
  }
}
const get = async (label: CaptureUserLabel, fileId: string, extra: Partial<CaptureFileDeps> = {}) =>
  handleCaptureFileGet(req(fileId), { fileId }, { ...baseDeps(await kit.jwt(label)), ...extra })

async function expectRefusal(res: NextResponse) {
  expect(res.status).toBe(404)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  expect(res.headers.get('location')).toBeNull()
  expect(await res.text()).toBe('')
}

describe('T-FILE-1: PM-A1 opens a stored file', () => {
  it('302 to a signed URL on the capture-documents bucket, with both headers', async () => {
    const res = await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain(`/storage/v1/object/sign/${PM_BUCKET}/`)
    expect(loc).toContain('token=')
    expect(loc).not.toContain('download=') // an image opens inline
  })
  it('the signed URL really serves the object, with the stored Content-Type and no attachment disposition', async () => {
    const res = await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    const out = await fetch(res.headers.get('location')!)
    expect(out.status).toBe(200)
    expect(out.headers.get('content-type')).toContain('image/png')
    expect(out.headers.get('content-disposition') ?? '').not.toMatch(/attachment/i)
  })
  it('a not-previewable PDF is signed with download=dc-<file_no>.pdf and is served as an attachment', async () => {
    const res = await handleCaptureFileGet(req(pdfA1.fileId), { fileId: pdfA1.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('download=dc-1.pdf')
    const out = await fetch(loc)
    expect(out.status).toBe(200)
    expect(out.headers.get('content-disposition') ?? '').toMatch(/attachment/i)
    expect(out.headers.get('content-disposition') ?? '').toContain('dc-1.pdf')
  })
  it('the TTL on the signed URL is 60 seconds', async () => {
    const res = await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    const token = new URL(res.headers.get('location')!).searchParams.get('token')!
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number; iat?: number }
    const ttl = payload.exp - Math.floor(Date.now() / 1000)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })
})

describe('T-FILE-2..n: every refusal is the identical 404', () => {
  it.each<[string, CaptureUserLabel]>([
    ['PM of another project in the same tenant', 'pm2'],
    ['PM of another tenant', 'pmB'],
    ['qs member of the project (not a PM)', 'qs'],
    ['deactivated PM of the project', 'deact'],
  ])('%s', async (_n, label) => {
    await expectRefusal(await get(label, dcA1.fileId))
  })
  it('anon (no session)', async () => {
    await expectRefusal(await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, baseDeps(captureAnon())))
  })
  it.each([
    ['pending', () => pending.fileId],
    ['failed', () => failed.fileId],
    ['rejected', () => rejected.fileId],
  ])('a %s file (no object) as the owning PM', async (_n, id) => {
    await expectRefusal(await handleCaptureFileGet(req(id()), { fileId: id() }, { supabaseClient: await kit.jwt('pm1'), serviceClient: kit.svc, rateLimit: { store: new Map() } }))
  })
  it.each(['not-a-uuid', '', '00000000-0000-4000-8000-000000000000', "x' or '1'='1"])('malformed or unknown id %#', async (id) => {
    await expectRefusal(await handleCaptureFileGet(req(id), { fileId: id }, { supabaseClient: await kit.jwt('pm1'), serviceClient: kit.svc, rateLimit: { store: new Map() } }))
  })
  it('the rate limit refuses with the same shape', async () => {
    const store = new Map()
    const session = await kit.jwt('pm1')
    const deps = { supabaseClient: session, serviceClient: kit.svc, rateLimit: { maxRequests: 1, store } }
    expect((await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, deps)).status).toBe(302)
    await expectRefusal(await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, deps))
  })
})

describe('T-FILE-CTRL: step 2 swapped for a SERVICE-ROLE read; the app check alone must refuse (real cross-tenant data)', () => {
  it('PM-A1 asks for tenant B\'s real stored file: 404 even though the row is returned to the route', async () => {
    const pmA = await kit.jwt('pm1')
    // proof the swap is real: the service-role read DOES return tenant B's row
    const seen = await kit.svc.from('capture_files').select('id, tenant_id').eq('id', dcB.fileId).maybeSingle()
    expect(seen.data?.tenant_id).toBe(kit.tenantB)
    const res = await handleCaptureFileGet(req(dcB.fileId), { fileId: dcB.fileId }, {
      supabaseClient: pmA,
      rowClient: kit.svc,
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    await expectRefusal(res)
  })
  it('same swap, same-tenant OTHER project (A2) as PM-A1: 404 (isProjectPm refuses)', async () => {
    const res = await handleCaptureFileGet(req(dcA2.fileId), { fileId: dcA2.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      rowClient: kit.svc,
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    await expectRefusal(res)
  })
  it('same swap, a qs member of A1 asking for A1\'s stored file: 404 (not a PM)', async () => {
    const res = await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, {
      supabaseClient: await kit.jwt('qs'),
      rowClient: kit.svc,
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    await expectRefusal(res)
  })
  it('POSITIVE CONTROL: the owning PM with the same swap still gets the 302', async () => {
    const res = await handleCaptureFileGet(req(dcA1.fileId), { fileId: dcA1.fileId }, {
      supabaseClient: await kit.jwt('pm1'),
      rowClient: kit.svc,
      serviceClient: kit.svc,
      rateLimit: { store: new Map() },
    })
    expect(res.status).toBe(302)
  })
})

describe('T-SIGN-0: a user JWT cannot sign (there is no storage.objects policy, 049:1016-1017)', () => {
  it('the signed-in PM\'s own storage client is refused; the service role signs the same path', async () => {
    const path = `${kit.tenantA}/${kit.p1}/${dcA1.docId}/${dcA1.fileId}`
    const pmClient = await kit.jwt('pm1')
    const user = await pmClient.storage.from(PM_BUCKET).createSignedUrl(path, 60)
    expect(user.data).toBeNull()
    expect(user.error).not.toBeNull()
    const svc = await kit.svc.storage.from(PM_BUCKET).createSignedUrl(path, 60)
    expect(svc.error).toBeNull()
    expect(svc.data?.signedUrl).toContain('token=')
  })
})

// LAST: removes a PM from the project, then asks again. The same user opened the same file just before (positive control).
describe('T-FILE (PM removed from the project)', () => {
  it('a PM who was a member opens the file; after the membership row is removed the same request is the 404', async () => {
    const before = await get('admMem', dcA1.fileId, { rowClient: undefined })
    expect(before.status).toBe(302)
    const del = await kit.svc.from('project_members').delete().eq('user_id', kit.uid('admMem')).eq('project_id', kit.p1)
    expect(del.error).toBeNull()
    await expectRefusal(await get('admMem', dcA1.fileId))
  })
})
