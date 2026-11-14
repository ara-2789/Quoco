// 052 block 2c, item 2: the file route for a document that is NOT YET classified (capture_documents.kind IS NULL).
//
// Question: the owning PM opens a stored, not-previewable PDF of an UNCLASSIFIED document. The route builds the download name
// from the document's kind (lib/capture/pm-file-access.ts:216-231, resolveDownloadName at :139). A NULL kind is tolerated there
// (:131-135 -> the neutral name file-<file_no>.<ext>), but the plan (rev 8.1) has no rule for it, so this test records what the
// route really returns, with a classified-PDF control that returns 302 beside it.
//
// This is a NEW file on purpose: the pm-* test files are not edited in block 2c. It calls the same function GET calls in
// production (handleCaptureFileGet), as test/pm-file-route.test.ts does. The signed URL carries a token: it is masked in the
// printed output.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { buildPmKit, filesOfDoc, makeDocWithFile, removeStoredObjects, storeFile, teardownCaptureKit, type CaptureKit } from './helpers/pm-fixtures'
import { classifyAsPm, makeUnclassifiedDoc } from './helpers/capture-fixtures'
import { handleCaptureFileGet } from '@/lib/capture/pm-file-access'

vi.setConfig({ testTimeout: 60_000 })

let kit: CaptureKit
let unclassifiedFileId: string
let unclassifiedDocId: string
let classifiedFileId: string

beforeAll(async () => {
  kit = await buildPmKit('pmu', [])
  const u = await makeUnclassifiedDoc(kit, 'u-pdf')
  unclassifiedDocId = u.docId
  const files = await filesOfDoc(kit, u.docId)
  unclassifiedFileId = files[0]!.id
  await storeFile(kit, unclassifiedFileId, 'pdf_not_previewable')
  const c = await makeDocWithFile(kit, 'dc', 'c-pdf', 'stored_pdf')
  classifiedFileId = c.fileId
}, 90_000)

afterAll(async () => {
  if (!kit) return
  await removeStoredObjects(kit)
  await teardownCaptureKit(kit)
}, 90_000)

const req = (id: string) => new NextRequest(`http://localhost/api/capture-files/${id}`)
const open = async (fileId: string): Promise<NextResponse> =>
  handleCaptureFileGet(req(fileId), { fileId }, { supabaseClient: await kit.jwt('pm1'), serviceClient: kit.svc, rateLimit: { store: new Map() } })

/** The raw status and headers, with the signed-URL token masked. */
function raw(label: string, res: NextResponse): string {
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v.replace(/token=[^&]+/g, 'token=<masked>')
  })
  const line = `${label}: HTTP ${res.status} headers=${JSON.stringify(headers)}`
  console.info(line)
  return line
}

describe('T-FILE-UNCLASSIFIED the route for a stored, not-previewable PDF', () => {
  it('control: a CLASSIFIED document\'s PDF returns 302 with download=dc-<n>.pdf', async () => {
    const res = await open(classifiedFileId)
    raw('classified PDF', res)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('download=dc-1.pdf')
  })

  it('an UNCLASSIFIED document\'s PDF, opened by the owning PM: raw result recorded; the document really is unclassified', async () => {
    const { data } = await kit.svc.from('capture_documents').select('kind').eq('id', unclassifiedDocId).single<{ kind: string | null }>()
    expect(data!.kind).toBeNull() // the premise
    const res = await open(unclassifiedFileId)
    raw('unclassified PDF', res)
    // The route's own code gives the neutral name file-<n>.<ext> for a NULL kind (pm-file-access.ts:134). If this is 404, the
    // result is reported as it is and the route is NOT changed in this block.
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toContain('download=file-1.pdf')
    expect(loc).not.toMatch(/download=(dc|invoice)-/)
    // and the signed URL serves it as an attachment under that neutral name
    const out = await fetch(loc)
    expect(out.status).toBe(200)
    expect(out.headers.get('content-disposition') ?? '').toMatch(/attachment/i)
    expect(out.headers.get('content-disposition') ?? '').toContain('file-1.pdf')
  })

  it('after the PM classifies that document, the SAME file downloads under the kind name (the name follows the classification)', async () => {
    expect((await classifyAsPm(kit, unclassifiedDocId, 'dc')).error).toBeNull()
    const res = await open(unclassifiedFileId)
    raw('same PDF after classification', res)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('download=dc-1.pdf')
  })
})
