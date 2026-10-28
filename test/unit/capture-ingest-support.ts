// Shared builders for the C5 tests (test/unit/capture-ingest-bytes.test.ts and test/capture-ingest.test.ts).
// Not a *.test.ts file, so vitest does not collect it. Lives outside test/helpers/** on purpose (that directory is
// frozen for this PR). Everything here is fake: dummy credentials, Twilio-SHAPED urls that are never contacted.
import { createHash } from 'node:crypto'

// Deliberately NOT shaped like a real account SID (AC + 32 hex): GitHub push protection rightly refuses that shape.
export const TEST_ACCOUNT_SID = 'AC-c5-test-account-not-a-real-sid'
export const TEST_AUTH_TOKEN = 'zz-c5-test-token-0123456789abcdef'

export function sha256hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex')
}

/** A Twilio-shaped media URL of the test account. `n` and `tag` only make it unique. */
export function twilioUrl(tag: string, n = 0, accountSid = TEST_ACCOUNT_SID): string {
  const hex = createHash('sha256').update(`${tag}:${n}`).digest('hex')
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/MM${hex.slice(0, 32)}/Media/ME${hex.slice(32, 64)}`
}

function fill(head: number[], size: number, seed: number): Buffer {
  const b = Buffer.alloc(Math.max(size, head.length))
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + seed) & 0xff
  Buffer.from(head).copy(b, 0)
  return b
}

export function jpegBytes(size = 4096, seed = 1): Buffer {
  return fill([0xff, 0xd8, 0xff, 0xe0], size, seed)
}
export function pngBytes(size = 4096, seed = 2): Buffer {
  return fill([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size, seed)
}
export function webpBytes(size = 4096, seed = 3): Buffer {
  const b = fill([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], size, seed)
  return b
}
export function wavBytes(size = 4096): Buffer {
  return fill([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], size, 4)
}

/** A small text PDF. prefix = junk written BEFORE the header (scanner apps); encrypted adds a trailer /Encrypt. */
export function pdfBytes(o: { prefix?: number; encrypted?: boolean; eof?: boolean; seed?: number } = {}): Buffer {
  const prefix = Buffer.alloc(o.prefix ?? 0, 0x20)
  const trailer = o.encrypted ? 'trailer\n<< /Size 6 /Root 1 0 R /Encrypt 5 0 R >>\n' : 'trailer\n<< /Size 6 /Root 1 0 R >>\n'
  const body = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${trailer}startxref\n0\n${o.eof === false ? '' : '%%EOF\n'}`
  return Buffer.concat([prefix, Buffer.from(body, 'latin1'), Buffer.from(`% seed ${o.seed ?? 0}\n`, 'latin1')].filter((x) => x.length > 0)).subarray(
    0,
  )
}

/** A Response whose body streams `chunks` (or a pull-based generator) and records how many bytes were pulled. */
export function streamResponse(
  source: Uint8Array[] | (() => Uint8Array | null),
  o: { status?: number; headers?: Record<string, string> } = {},
): { res: Response; stats: { pulledBytes: number; cancelled: boolean } } {
  const stats = { pulledBytes: 0, cancelled: false }
  let i = 0
  const next = (): Uint8Array | null => {
    if (typeof source === 'function') return source()
    return i < source.length ? source[i++] : null
  }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const c = next()
      if (c === null) {
        controller.close()
        return
      }
      stats.pulledBytes += c.length
      controller.enqueue(c)
    },
    cancel() {
      stats.cancelled = true
    },
  })
  return { res: new Response(body, { status: o.status ?? 200, headers: o.headers }), stats }
}

/** Split a buffer into chunks of `size` bytes. */
export function chunked(b: Uint8Array, size = 64 * 1024): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < b.length; i += size) out.push(b.subarray(i, Math.min(i + size, b.length)))
  return out
}

/**
 * C6 leak scanner: returns the findings in `value` (stringified). Flags URLs, phone numbers, Twilio SIDs
 * (SM/MM/AC/ME + 32 hex), the test token, and any extra literal the caller knows must not appear (tenant id, user
 * id, body text).
 */
export function leakFindings(value: unknown, literals: string[] = []): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const found: string[] = []
  if (/https?:\/\//i.test(text)) found.push('url')
  if (/\+\d{8,}/.test(text)) found.push('phone')
  if (/\b(SM|MM|AC|ME)[0-9a-f]{32}\b/.test(text) || text.includes(TEST_ACCOUNT_SID)) found.push('twilio-sid')
  if (text.includes(TEST_AUTH_TOKEN)) found.push('auth-token')
  for (const l of literals) if (l && text.includes(l)) found.push(`literal:${l.slice(0, 8)}`)
  return found
}
