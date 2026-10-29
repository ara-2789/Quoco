// PR-C C5, tests that need no database: the byte checks, the streaming size cap, the PDF rules, payload and URL
// validation, error classification, and the static guards on lib/media/capture-ingest.ts (C2, C6, R5, dark state).
// Plan: docs/plans/pr-c-c5-plan.md sections 1 and 3. The positive controls are listed in docs/reviews/c5-review-package.md.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  analysePdf,
  CAPTURE_FILES_UPDATE_COLUMNS,
  CAPTURE_MAX_BYTES,
  classifyStorageError,
  detectContentType,
  downloadChecked,
  type DownloadResult,
  isTwilioMediaUrl,
  parsePayload,
  sanitiseCode,
} from '@/lib/media/capture-ingest'
import {
  chunked,
  jpegBytes,
  leakFindings,
  pdfBytes,
  pngBytes,
  streamResponse,
  TEST_ACCOUNT_SID,
  TEST_AUTH_TOKEN,
  twilioUrl,
  wavBytes,
  webpBytes,
} from './capture-ingest-support'

const MiB = 1024 * 1024
const AUTH = 'Basic dGVzdDp0ZXN0'
const URL1 = twilioUrl('unit', 1)

/** A failed assertion must never try to pretty-print a 16 MiB Buffer (it kills the worker): compare this instead. */
function brief(r: DownloadResult): unknown {
  return r.kind === 'ok' ? { kind: 'ok', length: r.bytes.length, type: r.type } : r
}

function fetchReturning(res: Response): typeof fetch {
  return (async () => res) as unknown as typeof fetch
}

describe('detectContentType: the BYTES decide (T-PDF-1)', () => {
  it('recognises the four accepted types', () => {
    expect(detectContentType(jpegBytes(64))).toBe('image/jpeg')
    expect(detectContentType(pngBytes(64))).toBe('image/png')
    expect(detectContentType(webpBytes(64))).toBe('image/webp')
    expect(detectContentType(pdfBytes())).toBe('application/pdf')
  })

  it.each([
    ['html', Buffer.from('<html><body>not a pdf</body></html>')],
    ['empty', Buffer.alloc(0)],
    ['two-byte jpeg head', Buffer.from([0xff, 0xd8])],
    ['RIFF/WAVE (not WebP)', wavBytes(64)],
    ['png with a corrupted 8th byte', Buffer.concat([pngBytes(64).subarray(0, 7), Buffer.from([0x00]), pngBytes(64).subarray(8)])],
    ['pdf header too short', Buffer.from('%PDF')],
  ])('rejects %s', (_name, bytes) => {
    expect(detectContentType(bytes)).toBeNull()
  })

  it('S4: %PDF- is found anywhere in the first 1024 bytes, and not after', () => {
    expect(detectContentType(pdfBytes({ prefix: 0 }))).toBe('application/pdf')
    expect(detectContentType(pdfBytes({ prefix: 200 }))).toBe('application/pdf')
    expect(detectContentType(pdfBytes({ prefix: 1019 }))).toBe('application/pdf') // last window position (1019..1023)
    expect(detectContentType(pdfBytes({ prefix: 1100 }))).toBeNull()
  })
})

describe('analysePdf (T-PDF-2): byte-level only, original bytes are never changed', () => {
  it('plain PDF is previewable; the /Encrypt token alone flips it', () => {
    const plain = pdfBytes({ seed: 7 })
    const enc = pdfBytes({ seed: 7, encrypted: true })
    expect(analysePdf(plain)).toBe('previewable')
    expect(analysePdf(enc)).toBe('not_previewable')
  })
  it('no %%EOF in the last 1024 bytes is not previewable (unparseable)', () => {
    expect(analysePdf(pdfBytes({ eof: false }))).toBe('not_previewable')
    const early = Buffer.concat([pdfBytes(), Buffer.alloc(2000, 0x20)]) // %%EOF is now earlier than the last 1024 bytes
    expect(analysePdf(early)).toBe('not_previewable')
  })
})

describe('isTwilioMediaUrl (review item 2): our credentials go only to our Twilio media URLs', () => {
  it('accepts a Twilio media url of the same account', () => {
    expect(isTwilioMediaUrl(URL1, TEST_ACCOUNT_SID)).toBe(true)
  })
  it.each([
    ['http scheme', URL1.replace('https:', 'http:')],
    ['other host', 'https://example.invalid/2010-04-01/Accounts/' + TEST_ACCOUNT_SID + '/Messages/MM1/Media/ME1'],
    ['look-alike host', 'https://api.twilio.com.evil.example/2010-04-01/Accounts/' + TEST_ACCOUNT_SID + '/Messages/MM1/Media/ME1'],
    ['userinfo trick', 'https://api.twilio.com@evil.example/2010-04-01/Accounts/' + TEST_ACCOUNT_SID + '/Messages/MM1/Media/ME1'],
    ['other account', twilioUrl('x', 1, 'AC-c5-other-account-not-real')],
    ['explicit port', URL1.replace('api.twilio.com', 'api.twilio.com:8443')],
    ['not a url', 'not a url'],
  ])('rejects %s', (_n, u) => {
    expect(isTwilioMediaUrl(u, TEST_ACCOUNT_SID)).toBe(false)
  })
})

describe('classifyStorageError (review S2)', () => {
  it('duplicate by status, by statusCode, or by message', () => {
    expect(classifyStorageError({ status: 409 })).toBe('duplicate')
    expect(classifyStorageError({ status: 400, statusCode: '409' })).toBe('duplicate')
    expect(classifyStorageError({ message: 'The resource already exists' })).toBe('duplicate')
  })
  it('a deterministic 4xx other than duplicate is not retried', () => {
    expect(classifyStorageError({ status: 400, statusCode: '415' })).toBe('deterministic')
    expect(classifyStorageError({ status: 413 })).toBe('deterministic')
    expect(classifyStorageError({ statusCode: '403' })).toBe('deterministic')
  })
  it('408, 429, 5xx and non-HTTP errors retry', () => {
    expect(classifyStorageError({ status: 408 })).toBe('retry')
    expect(classifyStorageError({ status: 429 })).toBe('retry')
    expect(classifyStorageError({ status: 503 })).toBe('retry')
    expect(classifyStorageError(new Error('fetch failed'))).toBe('retry')
    expect(classifyStorageError(null)).toBe('retry')
  })
})

describe('sanitiseCode / parsePayload (N1, no zod)', () => {
  it('keeps only five-character SQLSTATE-shaped codes', () => {
    expect(sanitiseCode('QE011')).toBe('QE011')
    expect(sanitiseCode('23514')).toBe('23514')
    expect(sanitiseCode('permission denied for https://x')).toBe('unknown')
    expect(sanitiseCode(undefined)).toBe('unknown')
  })

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const file = (n: number) => ({ file_id: id(n), file_no: n, media_index: n - 1, claimed_content_type: 'image/jpeg', url: URL1 })
  const base = (files: unknown[]) => ({ tenant_id: id(901), project_id: id(902), document_id: id(903), source_message_sid: 'SIDX', files })

  it('accepts 1 to 20 files', () => {
    expect(parsePayload(base([file(1)]))?.files).toHaveLength(1)
    expect(parsePayload(base(Array.from({ length: 20 }, (_, i) => file(i + 1))))?.files).toHaveLength(20)
  })
  it.each([
    ['no files', base([])],
    ['21 files', base(Array.from({ length: 21 }, (_, i) => file(i + 1)))],
    ['bad tenant uuid', { ...base([file(1)]), tenant_id: 'nope' }],
    ['duplicate file ids', base([file(1), file(1)])],
    ['non-integer file_no', base([{ ...file(1), file_no: 1.5 }])],
    ['empty url', base([{ ...file(1), url: '' }])],
    ['not an object', 'x'],
    ['null', null],
  ])('rejects %s', (_n, p) => {
    expect(parsePayload(p)).toBeNull()
  })
})

describe('downloadChecked: type from bytes, size cap enforced WHILE streaming (T-SIZE-1, T-PDF-1)', () => {
  it('sends the Authorization header it is given, as a plain GET with an abort signal', async () => {
    const f = vi.fn(async () => streamResponse(chunked(jpegBytes(2048))).res)
    await downloadChecked(f as unknown as typeof fetch, URL1, AUTH, 1000)
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.headers).toEqual({ Authorization: AUTH })
    expect(init.method).toBeUndefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('stores the type of the bytes, not the HTTP header, and keeps the bytes untouched', async () => {
    const pdf = pdfBytes({ prefix: 200, seed: 9 })
    const { res } = streamResponse(chunked(pdf, 300), { headers: { 'content-type': 'image/jpeg' } })
    const r = await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.type).toBe('application/pdf')
      expect(Buffer.compare(r.bytes, pdf)).toBe(0)
    }
  })

  it('S4: header at byte 0 and after a 200-byte prefix are accepted; only after 1024 is wrong_type', async () => {
    for (const [prefix, want] of [
      [0, 'ok'],
      [200, 'ok'],
      [1100, 'rejected'],
    ] as const) {
      const { res } = streamResponse(chunked(pdfBytes({ prefix })))
      expect((await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)).kind).toBe(want)
    }
  })

  it('wrong magic is rejected as wrong_type and the body is abandoned after the first chunk', async () => {
    const html = Buffer.alloc(4 * MiB, 0x41)
    html.write('<html>', 0)
    const { res, stats } = streamResponse(chunked(html, 64 * 1024))
    const r = await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)
    expect(r).toEqual({ kind: 'rejected', reason: 'wrong_type' })
    expect(stats.pulledBytes).toBeLessThanOrEqual(2 * 64 * 1024)
    expect(stats.cancelled).toBe(true)
  })

  it('an empty body and a bodyless 200 are wrong_type', async () => {
    expect(await downloadChecked(fetchReturning(streamResponse([]).res), URL1, AUTH, 1000)).toEqual({ kind: 'rejected', reason: 'wrong_type' })
    expect(await downloadChecked(fetchReturning(new Response(null, { status: 200 })), URL1, AUTH, 1000)).toEqual({
      kind: 'rejected',
      reason: 'wrong_type',
    })
  })

  it('boundary: exactly 16777216 bytes is accepted, 16777217 is too_large with the detected type (S5)', async () => {
    const at = streamResponse(chunked(jpegBytes(CAPTURE_MAX_BYTES), 1 * MiB)).res
    const okR = await downloadChecked(fetchReturning(at), URL1, AUTH, 20_000)
    expect(okR.kind).toBe('ok')
    if (okR.kind === 'ok') expect(okR.bytes.length).toBe(CAPTURE_MAX_BYTES)
    const over = streamResponse(chunked(jpegBytes(CAPTURE_MAX_BYTES + 1), 1 * MiB)).res
    expect(brief(await downloadChecked(fetchReturning(over), URL1, AUTH, 20_000))).toEqual({ kind: 'rejected', reason: 'too_large', type: 'image/jpeg' })
  })

  it('an endless body is abandoned after about 16 MiB: the cap is enforced while streaming', async () => {
    let first = true
    const { res, stats } = streamResponse(() => {
      const c = Buffer.alloc(1 * MiB, 0x11)
      if (first) {
        jpegBytes(8).copy(c, 0)
        first = false
      }
      return c
    })
    const r = await downloadChecked(fetchReturning(res), URL1, AUTH, 20_000)
    expect(r).toEqual({ kind: 'rejected', reason: 'too_large', type: 'image/jpeg' })
    expect(stats.pulledBytes).toBeLessThanOrEqual(18 * MiB)
    expect(stats.cancelled).toBe(true)
  })

  it('CONTROL for the cap test: a naive arrayBuffer() reader pulls the WHOLE body, so the counter can tell the designs apart', async () => {
    const total = 40 * MiB
    let sent = 0
    const { res, stats } = streamResponse(() => {
      if (sent >= total) return null
      sent += 1 * MiB
      return Buffer.alloc(1 * MiB, 0x22)
    })
    await res.arrayBuffer()
    expect(stats.pulledBytes).toBe(total)
  })

  it('a lying Content-Length does not defeat the cap', async () => {
    const { res } = streamResponse(chunked(jpegBytes(20 * MiB), 1 * MiB), { headers: { 'content-length': '100' } })
    expect(brief(await downloadChecked(fetchReturning(res), URL1, AUTH, 20_000))).toEqual({ kind: 'rejected', reason: 'too_large', type: 'image/jpeg' })
  })

  it('an honest huge Content-Length is an early-out after the magic check', async () => {
    const { res, stats } = streamResponse(chunked(jpegBytes(4096), 4096), { headers: { 'content-length': '99999999999' } })
    expect(await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)).toEqual({ kind: 'rejected', reason: 'too_large', type: 'image/jpeg' })
    expect(stats.pulledBytes).toBeLessThanOrEqual(4096)
  })

  it('wrong_type beats too_large (fixed precedence)', async () => {
    const { res } = streamResponse([Buffer.from('<html>' + 'x'.repeat(2000))], { headers: { 'content-length': '99999999999' } })
    expect(await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)).toEqual({ kind: 'rejected', reason: 'wrong_type' })
  })

  it.each([401, 404, 410, 429, 500, 503])('HTTP %i is retryable and reports the status digits only', async (status) => {
    const { res } = streamResponse([Buffer.from('error body that must not be echoed')], { status })
    expect(await downloadChecked(fetchReturning(res), URL1, AUTH, 1000)).toEqual({ kind: 'retry', code: `http${status}` })
  })

  it('a thrown fetch is retryable "network"; its message is discarded', async () => {
    const f = (async () => {
      throw new Error(`fetch failed for ${URL1}`)
    }) as unknown as typeof fetch
    expect(await downloadChecked(f, URL1, AUTH, 1000)).toEqual({ kind: 'retry', code: 'network' })
  })

  it('T-TW-3: a fetch that honours the signal and never resolves is aborted at the timeout', async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
    expect(await downloadChecked(f, URL1, AUTH, 25)).toEqual({ kind: 'retry', code: 'timeout' })
  })

  it('a fetch that ignores the signal still times out', async () => {
    const f = (() => new Promise(() => {})) as unknown as typeof fetch
    expect(await downloadChecked(f, URL1, AUTH, 25)).toEqual({ kind: 'retry', code: 'timeout' })
  })

  it('a body that stalls after the first chunk times out', async () => {
    let n = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ === 0) c.enqueue(jpegBytes(512))
        else return new Promise(() => {})
      },
    })
    expect(await downloadChecked(fetchReturning(new Response(body)), URL1, AUTH, 40)).toEqual({ kind: 'retry', code: 'timeout' })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Static guards on the module source
// ---------------------------------------------------------------------------------------------------------------

const SRC = readFileSync(resolve(__dirname, '../../lib/media/capture-ingest.ts'), 'utf8')
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n') // comments may name what is forbidden

/** C2 + C6 + R5: constructs that must never appear in the module's code. */
export function forbiddenConstructs(src: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ['storage remove', /\.remove\(/],
    ['storage move', /\.move\(/],
    ['storage copy', /\.copy\(/],
    ['upsert true', /upsert:\s*true/],
    ['signed upload url', /createSignedUploadUrl/],
    ['storage update', /CAPTURE_BUCKET\)\s*\.update\(/],
    ['console', /\bconsole\./],
    ['send path', /sendWhatsApp|Messages\.json|outbound\/templates|outbound\/trigger|outbound\/roster/],
  ]
  return patterns.filter(([, re]) => re.test(src)).map(([n]) => n)
}

describe('static guards on lib/media/capture-ingest.ts', () => {
  it('U-C2-static / U-C6-static / T-R5-1: no overwrite, delete, console or send path in the module', () => {
    expect(forbiddenConstructs(CODE)).toEqual([])
  })

  it('CONTROL: the scanner sees each planted construct', () => {
    expect(forbiddenConstructs("bucket.remove([p])")).toEqual(['storage remove'])
    expect(forbiddenConstructs('upload(p, b, { upsert: true })')).toEqual(['upsert true'])
    expect(forbiddenConstructs('console.log(x)')).toEqual(['console'])
    expect(forbiddenConstructs("import { sendWhatsAppTemplate } from 'x'")).toEqual(['send path'])
    expect(forbiddenConstructs('.from(CAPTURE_BUCKET).update(')).toEqual(['storage update'])
  })

  it('T-R5-1: the only import from lib/whatsapp is readCredentials from outbound/send', () => {
    const imports = [...CODE.matchAll(/from '@\/lib\/whatsapp\/[^']+'/g)].map((m) => m[0])
    expect(imports).toEqual(["from '@/lib/whatsapp/outbound/send'"])
    expect(CODE).toMatch(/import \{ readCredentials \} from '@\/lib\/whatsapp\/outbound\/send'/)
  })

  it('T-C1-static: every upload passes upsert:false and a contentType', () => {
    const uploads = [...CODE.matchAll(/\.upload\([^)]*\)/g)].map((m) => m[0])
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toContain('upsert: false')
    expect(uploads[0]).toContain('contentType: type')
  })

  it('U-C7-1: the exported column list is exactly the 051 grant', () => {
    const grant = readFileSync(resolve(__dirname, '../../supabase/migrations/051_capture_files_immutability.sql'), 'utf8').match(
      /GRANT UPDATE \(([^)]*)\)/,
    )
    expect(grant).not.toBeNull()
    const names = grant![1].split(',').map((s) => s.trim())
    expect([...CAPTURE_FILES_UPDATE_COLUMNS].sort()).toEqual(names.sort())
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules' || e === '.next') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

/** Producers of a capture_ingest job in TypeScript: an enqueue call or an insert carrying the type. */
export function capturePro(src: string): boolean {
  return /enqueueJob\(\s*['"]capture_ingest['"]/.test(src) || /type:\s*['"]capture_ingest['"]/.test(src)
}

describe('U-DARK-1: nothing in TypeScript creates a capture_ingest job (only migration 050 does)', () => {
  it('no file under app/ or lib/ enqueues or inserts one', () => {
    const root = resolve(__dirname, '../..')
    const offenders = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))].filter((f) => capturePro(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
  it('CONTROL: the scanner sees a planted producer', () => {
    expect(capturePro("await enqueueJob('capture_ingest', {})")).toBe(true)
    expect(capturePro("insert({ type: 'capture_ingest', payload })")).toBe(true)
    expect(capturePro("case 'capture_ingest':")).toBe(false)
  })
})

describe('C6 leak scanner', () => {
  it('flags a url, a phone, a Twilio sid, the token and a known literal', () => {
    expect(leakFindings('see https://api.twilio.com/x')).toContain('url')
    expect(leakFindings('call +19995552000001')).toContain('phone')
    expect(leakFindings(`sid ${TEST_ACCOUNT_SID}`)).toContain('twilio-sid')
    expect(leakFindings(`t ${TEST_AUTH_TOKEN}`)).toContain('auth-token')
    expect(leakFindings('tenant 1234abcd-aaaa', ['1234abcd-aaaa'])).toHaveLength(1)
    expect(leakFindings({ table: 'capture_files', fileCount: 3 })).toEqual([])
  })
})
