import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as copy from '@/lib/capture/pm-copy'
import { PM_ACK_LABEL, PM_ERR_MESSAGES, PM_PENDING_TIMEOUT_MINUTES } from '@/lib/capture/pm-copy'
import { isReportableErr, mapPmRpcError } from '@/lib/capture/pm-errors'
import { fileDisplayState, istDaysSince } from '@/lib/capture/pm-queries'
import {
  appCheckCaptureFile,
  downloadFileName,
  handleCaptureFileGet,
  PM_CAPTURE_BUCKET,
  PM_FILE_URL_TTL_SECONDS,
  type CaptureFileRow,
} from '@/lib/capture/pm-file-access'
import { runApprove, runLink, runReject, runSetDetails, runUnlink, type PmActionDeps } from '@/lib/capture/pm-actions'
import { CAPTURE_BUCKET } from '@/lib/media/capture-ingest'

// PR-D pure unit tests: ZERO database calls, no network. (The globalSetup guard only reads env.)
// Covers: T-15-1, the error map (T-ERR-1 mapping half), step-3 forged-row cases (T-FILE-CTRL unit half), the action
// validators and the "unknown result is never success" rule (D7), the D1/D2 static facts (T-CACHE-1 static half), and
// the string rules (placeholders, no "DC missing"/"paid").

const NOW = new Date('2026-10-31T10:15:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('T-15-1: the 15-minute rule (D9)', () => {
  const pending = (m: number) => ({ ingest_status: 'pending', reject_reason: null, created_at: minutesAgo(m) })
  it('constant is 15', () => expect(PM_PENDING_TIMEOUT_MINUTES).toBe(15))
  it('14:59 is still pending', () => expect(fileDisplayState(pending(14.983), NOW)).toBe('pending'))
  it('exactly 15:00 is still pending (strictly older than 15 minutes)', () => expect(fileDisplayState(pending(15), NOW)).toBe('pending'))
  it('15:01 shows the timeout state, which is NOT "failed"', () => {
    const s = fileDisplayState(pending(15.017), NOW)
    expect(s).toBe('pending_timeout')
    expect(s).not.toBe('failed')
  })
  it('stored, failed, rejected are not derived from age', () => {
    const old = minutesAgo(600)
    expect(fileDisplayState({ ingest_status: 'stored', reject_reason: null, created_at: old }, NOW)).toBe('stored')
    expect(fileDisplayState({ ingest_status: 'failed', reject_reason: null, created_at: old }, NOW)).toBe('failed')
    expect(fileDisplayState({ ingest_status: 'rejected', reject_reason: 'wrong_type', created_at: old }, NOW)).toBe('rejected_type')
    expect(fileDisplayState({ ingest_status: 'rejected', reject_reason: 'too_large', created_at: old }, NOW)).toBe('rejected_size')
  })
  it('invoice-expected days count IST calendar days (23:59 vs 00:01 IST)', () => {
    expect(istDaysSince('2026-10-30', new Date('2026-10-31T18:29:00Z'))).toBe(1) // 23:59 IST on 31 Oct
    expect(istDaysSince('2026-10-30', new Date('2026-10-31T18:31:00Z'))).toBe(2) // 00:01 IST on 1 Nov
  })
})

describe('T-ERR-1 (mapping half): every code maps to its key; QE015 is one shape', () => {
  const cases: Array<[Parameters<typeof mapPmRpcError>[0], string, string]> = [
    ['approve', 'QE015', 'PM_ERR_NOT_AVAILABLE'],
    ['link', 'QE015', 'PM_ERR_NOT_AVAILABLE'],
    ['approve', 'QE011', 'PM_ERR_STATE_CHANGED'],
    ['reject', 'QE011', 'PM_ERR_STATE_CHANGED'],
    ['set_details', 'QE011', 'PM_ERR_STATE_CHANGED'],
    ['link', 'QE011', 'PM_ERR_LINK_AUTO_APPROVED'],
    ['unlink', 'QE011', 'PM_ERR_ALREADY_UNLINKED'],
    ['approve', 'QE016', 'PM_ERR_TYPE_REQUIRED'],
    ['reject', 'QE017', 'PM_ERR_REJECT_REASON'],
    ['link', 'QE012', 'PM_ERR_INVALID_INPUT'],
    ['set_details', '23514', 'PM_ERR_INVALID_INPUT'],
    ['link', '23503', 'PM_ERR_INVALID_INPUT'],
    ['link', 'QE008', 'PM_ERR_ALREADY_LINKED'],
    ['unlink', 'QE010', 'PM_ERR_SELF_LINK_FIXED'],
    ['set_details', 'QE006', 'PM_ERR_RETYPE_LINKED'],
    ['set_details', 'QE007', 'PM_ERR_RETYPE_AUTOMATIC'],
    ['link', 'QE003', 'PM_ERR_LINK_TARGET_INELIGIBLE'],
    ['link', 'QE004', 'PM_ERR_LINK_TARGET_INELIGIBLE'],
    ['link', 'QE005', 'PM_ERR_LINK_TARGET_INELIGIBLE'],
    ['approve', 'QE001', 'PM_ERR_SAVE_FAILED'],
    ['approve', 'QE009', 'PM_ERR_SAVE_FAILED'],
    ['approve', 'QE013', 'PM_ERR_SAVE_FAILED'],
    ['approve', 'QE014', 'PM_ERR_SAVE_FAILED'],
    ['approve', 'XX000', 'PM_ERR_SAVE_FAILED'],
  ]
  it.each(cases)('%s + %s -> %s', (action, code, key) => expect(mapPmRpcError(action, code)).toBe(key))
  it('null/undefined code -> PM_ERR_SAVE_FAILED', () => {
    expect(mapPmRpcError('approve', null)).toBe('PM_ERR_SAVE_FAILED')
    expect(mapPmRpcError('approve', undefined)).toBe('PM_ERR_SAVE_FAILED')
  })
  it('only the catch-all is reported to Sentry', () => {
    expect(isReportableErr('PM_ERR_SAVE_FAILED')).toBe(true)
    expect(isReportableErr('PM_ERR_STATE_CHANGED')).toBe(false)
    expect(isReportableErr('PM_ERR_NOT_AVAILABLE')).toBe(false)
  })
  it('every key has a message', () => {
    for (const [, , key] of cases) expect(PM_ERR_MESSAGES[key as keyof typeof PM_ERR_MESSAGES]).toBeTruthy()
  })
})

describe('T-FILE-CTRL (unit half): the app check refuses forged rows with no DB', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111'
  const PROJECT = '22222222-2222-4222-8222-222222222222'
  const DOC = '33333333-3333-4333-8333-333333333333'
  const FILE = '44444444-4444-4444-8444-444444444444'
  const OTHER = '55555555-5555-4555-8555-555555555555'
  const good: CaptureFileRow = {
    id: FILE,
    tenant_id: TENANT,
    project_id: PROJECT,
    document_id: DOC,
    file_no: 1,
    ingest_status: 'stored',
    storage_path: `${TENANT}/${PROJECT}/${DOC}/${FILE}`,
    content_type: 'image/png',
    preview_state: 'previewable',
  }
  const pm = async () => true
  const notPm = async () => false
  const profile = { tenant_id: TENANT }

  it('POSITIVE CONTROL: the exact row and a PM returns the path', async () => {
    expect(await appCheckCaptureFile(good, profile, pm)).toBe(good.storage_path)
  })
  it('row tenant differs from the PROFILE tenant (path consistent with the row)', async () => {
    const row = { ...good, tenant_id: OTHER, storage_path: `${OTHER}/${PROJECT}/${DOC}/${FILE}` }
    expect(await appCheckCaptureFile(row, profile, pm)).toBeNull()
  })
  it('FORGED: row says tenant A but the path names tenant B (cannot exist on test-db, 051:173-174)', async () => {
    expect(await appCheckCaptureFile({ ...good, storage_path: `${OTHER}/${PROJECT}/${DOC}/${FILE}` }, profile, pm)).toBeNull()
  })
  it.each([
    ['wrong project', `${TENANT}/${OTHER}/${DOC}/${FILE}`],
    ['wrong document', `${TENANT}/${PROJECT}/${OTHER}/${FILE}`],
    ['wrong file id', `${TENANT}/${PROJECT}/${DOC}/${OTHER}`],
    ['extension appended (the writer adds none)', `${TENANT}/${PROJECT}/${DOC}/${FILE}.pdf`],
    ['trailing slash', `${TENANT}/${PROJECT}/${DOC}/${FILE}/`],
    ['empty', ''],
  ])('FORGED path: %s', async (_name, path) => {
    expect(await appCheckCaptureFile({ ...good, storage_path: path }, profile, pm)).toBeNull()
  })
  it.each(['pending', 'failed', 'rejected'])('status %s is refused', async (status) => {
    expect(await appCheckCaptureFile({ ...good, ingest_status: status }, profile, pm)).toBeNull()
  })
  it('null storage_path is refused', async () => {
    expect(await appCheckCaptureFile({ ...good, storage_path: null }, profile, pm)).toBeNull()
  })
  it('a null-tenant profile is refused', async () => {
    expect(await appCheckCaptureFile(good, { tenant_id: null }, pm)).toBeNull()
  })
  it('not a PM on the project is refused (and is asked about the ROW project)', async () => {
    expect(await appCheckCaptureFile(good, profile, notPm)).toBeNull()
    let asked = ''
    await appCheckCaptureFile(good, profile, async (p) => {
      asked = p
      return true
    })
    expect(asked).toBe(PROJECT)
  })
  it('download file name: <document kind>-<file_no>.<ext> with the raw kind value, never the storage path', () => {
    expect(downloadFileName('dc', 3, 'application/pdf')).toBe('dc-3.pdf')
    expect(downloadFileName('invoice', 3, 'application/pdf')).toBe('invoice-3.pdf')
    expect(downloadFileName('dc', 1, 'image/jpeg')).toBe('dc-1.jpg')
    expect(downloadFileName('invoice', 2, 'image/png')).toBe('invoice-2.png')
    expect(downloadFileName('invoice', 2, 'image/webp')).toBe('invoice-2.webp')
    expect(downloadFileName('dc', 1, null)).toBe('dc-1.bin')
  })
  it('bucket constant equals the writer (lib/media/capture-ingest.ts) and TTL is 60 s (D1)', () => {
    expect(PM_CAPTURE_BUCKET).toBe(CAPTURE_BUCKET)
    expect(PM_FILE_URL_TTL_SECONDS).toBe(60)
  })
})

describe('T-CACHE-1 (static + no-DB half): D1/D2', () => {
  const root = resolve(__dirname, '..')
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
  it.each([
    'app/(dashboard)/material-inward/page.tsx',
    'app/(dashboard)/material-inward/[deliveryId]/page.tsx',
    'app/api/capture-files/[fileId]/route.ts',
  ])("%s exports dynamic = 'force-dynamic'", (p) => {
    expect(read(p)).toMatch(/^export const dynamic = 'force-dynamic'$/m)
  })
  it.each([
    'lib/capture/pm-actions.ts',
    'lib/capture/pm-queries.ts',
    'lib/capture/pm-file-access.ts',
    'lib/capture/pm-errors.ts',
    'app/(dashboard)/material-inward/page.tsx',
    'app/(dashboard)/material-inward/[deliveryId]/page.tsx',
    'app/(dashboard)/material-inward/actions.ts',
    'app/api/capture-files/[fileId]/route.ts',
  ])('%s has no unstable_cache, no use cache, no fetch cache options', (p) => {
    const src = read(p)
    expect(src).not.toMatch(/unstable_cache/)
    expect(src).not.toMatch(/['"]use cache['"]/)
    expect(src).not.toMatch(/next:\s*\{\s*revalidate/)
    expect(src).not.toMatch(/cache:\s*['"]force-cache['"]/)
  })
  it('a malformed id is refused with 404, no body, and BOTH headers (no DB is touched)', async () => {
    const res = await handleCaptureFileGet(new NextRequest('http://localhost/api/capture-files/nope'), { fileId: 'nope' })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await res.text()).toBe('')
  })
  it('the route module exports only GET and dynamic (no page-level cache config)', () => {
    const src = read('app/api/capture-files/[fileId]/route.ts')
    expect([...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]).sort()).toEqual(['GET', 'dynamic'])
  })
})

describe('strings: placeholders only, nothing invented (Aravind, 31 Oct)', () => {
  const entries = Object.entries(copy).filter(([, v]) => typeof v === 'string') as Array<[string, string]>
  it('the module has string constants', () => expect(entries.length).toBeGreaterThan(70))
  it.each(entries.filter(([k]) => k !== 'PM_PAGE_TITLE'))('%s is the literal placeholder [KEY]', (key, value) => {
    expect(value).toBe(`[${key}]`)
  })
  it('PM_PAGE_TITLE is the one approved string', () => expect(copy.PM_PAGE_TITLE).toBe('Material Inward'))
  it('no string contains "DC missing" or "paid" (A16 / A17)', () => {
    for (const [, v] of entries) {
      expect(v).not.toMatch(/dc missing/i)
      expect(v).not.toMatch(/\bpaid\b/i)
    }
  })
  it('ack slots exist for every DB value of BOTH kinds, and differ across kinds', () => {
    for (const ack of ['yes', 'no', 'partial', 'unclear'] as const) {
      expect(PM_ACK_LABEL.invoice[ack]).toMatch(/^\[PM_ACK_INVOICE_/)
      expect(PM_ACK_LABEL.dc[ack]).toMatch(/^\[PM_ACK_DC_/)
      expect(PM_ACK_LABEL.invoice[ack]).not.toBe(PM_ACK_LABEL.dc[ack])
    }
    expect(copy.PM_ACK_NONE).toBe('[PM_ACK_NONE]')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// D7: validators run BEFORE any RPC, and an unknown result is never success. A stub client that fails the test if
// touched proves the first; canned RPC results prove the second. No database.
// ---------------------------------------------------------------------------------------------------------------
const ID = '66666666-6666-4666-8666-666666666666'
const ID2 = '77777777-7777-4777-8777-777777777777'

function untouched(): PmActionDeps {
  const trap = () => {
    throw new Error('the client was touched')
  }
  const client = new Proxy({}, { get: trap }) as unknown as PmActionDeps['client']
  return { client, profile: { id: ID, tenant_id: ID2 } }
}

function canned(rpc: { data: unknown; error: { code?: string; message?: string } | null }): { deps: PmActionDeps; calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args])
      return rpc
    },
  } as unknown as SupabaseClient
  return { deps: { client: client as PmActionDeps['client'], profile: { id: ID, tenant_id: ID2 } }, calls }
}

describe('D7: validation first (no client call on bad input)', () => {
  it('approve: malformed id', async () => expect(await runApprove(untouched(), { deliveryId: 'x' })).toMatchObject({ status: 'error', key: 'PM_ERR_INVALID_INPUT' }))
  it('unlink: malformed id', async () => expect(await runUnlink(untouched(), { linkId: '' })).toMatchObject({ status: 'error', key: 'PM_ERR_INVALID_INPUT' }))
  it.each(['', '   ', 'x'.repeat(1001)])('reject: bad reason %#', async (reason) => {
    expect(await runReject(untouched(), { deliveryId: ID, reason })).toMatchObject({ status: 'error', key: 'PM_ERR_REJECT_REASON' })
  })
  it('reject: malformed id', async () => expect(await runReject(untouched(), { deliveryId: 'x', reason: 'r' })).toMatchObject({ key: 'PM_ERR_INVALID_INPUT' }))
  it.each([
    ['empty array', ID, []],
    ['21 ids', ID, Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)],
    ['duplicate ids', ID, [ID2, ID2]],
    ['non-uuid member', ID, ['nope']],
    ['non-uuid invoice', 'nope', [ID2]],
  ])('link: %s', async (_n, inv, ids) => {
    expect(await runLink(untouched(), { invoiceDocumentId: inv as string, deliveryIds: ids as string[] })).toMatchObject({ key: 'PM_ERR_INVALID_INPUT' })
  })
  const loaded = { status: 'incomplete', deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
  it.each([
    ['type not in the CHECK', { deliveryType: 'other', vehicleNumber: null, dcNumber: null, dcDate: null }],
    ['vehicle > 64', { deliveryType: null, vehicleNumber: 'v'.repeat(65), dcNumber: null, dcDate: null }],
    ['dc number > 64', { deliveryType: null, vehicleNumber: null, dcNumber: 'd'.repeat(65), dcDate: null }],
    ['impossible date', { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: '2026-02-30' }],
    ['non-iso date', { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: '31/10/2026' }],
  ])('set details: %s', async (_n, next) => {
    expect(await runSetDetails(untouched(), { deliveryId: ID, loaded, next })).toMatchObject({ key: 'PM_ERR_INVALID_INPUT' })
  })
  it('set details: a null-tenant profile is NOT_AVAILABLE before any read', async () => {
    const deps = untouched()
    deps.profile.tenant_id = null
    expect(await runSetDetails(deps, { deliveryId: ID, loaded, next: loaded })).toMatchObject({ key: 'PM_ERR_NOT_AVAILABLE' })
  })
})

describe('D7: an unknown result is never reported as success', () => {
  it('POSITIVE CONTROL: error null + the id echoed = ok', async () => {
    const { deps, calls } = canned({ data: { delivery_id: ID, status: 'approved' }, error: null })
    expect(await runApprove(deps, { deliveryId: ID })).toEqual({ status: 'ok' })
    expect(calls).toEqual([['pm_approve_delivery', { p_delivery_id: ID }]])
  })
  it.each([
    ['null data', null],
    ['empty object', {}],
    ['the wrong id echoed', { delivery_id: ID2 }],
    ['an array', [{ delivery_id: ID }]],
    ['a string', 'ok'],
  ])('approve with %s -> PM_ERR_SAVE_FAILED', async (_n, data) => {
    const { deps } = canned({ data, error: null })
    expect(await runApprove(deps, { deliveryId: ID })).toMatchObject({ status: 'error', key: 'PM_ERR_SAVE_FAILED' })
  })
  it('an RPC error is mapped, not swallowed', async () => {
    const { deps } = canned({ data: null, error: { code: 'QE011', message: 'E11' } })
    expect(await runApprove(deps, { deliveryId: ID })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
  })
  it('a thrown exception becomes PM_ERR_SAVE_FAILED', async () => {
    const client = {
      rpc: async () => {
        throw new Error('network')
      },
    } as unknown as PmActionDeps['client']
    expect(await runApprove({ client, profile: { id: ID, tenant_id: ID2 } }, { deliveryId: ID })).toMatchObject({ key: 'PM_ERR_SAVE_FAILED' })
  })
  it('link echoes invoice_document_id; unlink echoes link_id; reject echoes delivery_id', async () => {
    const a = canned({ data: { invoice_document_id: ID, linked: 1, superseded_automatic: false }, error: null })
    expect(await runLink(a.deps, { invoiceDocumentId: ID, deliveryIds: [ID2] })).toEqual({ status: 'ok' })
    const b = canned({ data: { link_id: ID, restored_automatic: false }, error: null })
    expect(await runUnlink(b.deps, { linkId: ID })).toEqual({ status: 'ok' })
    const c = canned({ data: { delivery_id: ID, status: 'rejected', restored_automatic: false }, error: null })
    expect(await runReject(c.deps, { deliveryId: ID, reason: '  too late  ' })).toEqual({ status: 'ok' })
    expect(c.calls[0][1]).toEqual({ p_delivery_id: ID, p_reason: 'too late' })
  })
})
