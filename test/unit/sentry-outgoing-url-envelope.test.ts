import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createRequire } from 'node:module'
import { trace, SpanKind } from '@opentelemetry/api'
import * as Sentry from '@sentry/nextjs'
import { leakFindings } from './capture-ingest-support'
import { S1_LITERALS, composedFindings, scanEnvelopes, describeFindings } from '../helpers/s1-url-findings'
import {
  isRecord,
  parseEnvelopeBody,
  payloadsOfType,
  startRecordingServer,
  type ParsedEnvelope,
  type RecordingServer,
} from '../helpers/sentry-envelope-capture'

// S1 (Sentry outgoing-URL scrub), docs/plans via /tmp/quoco/s1-plan-rev3.md sections C, J, M.
//
// REAL client: the REAL sentry.server.config.ts is imported with @sentry/nextjs wrapped so
// that ONLY the transport is replaced; every option (hooks, dataCollection, sampler,
// propagation targets) is the production file's own. Real undici and node:http traffic goes
// to local servers; the captured envelopes are scanned. Nothing here touches a database.
//
// CONTROLS (env switches, read by TEST code only -- run each as `env NAME=value npx vitest run ...`):
//   TRIPWIRE_CONTROL=skip     harness passes skipOpenTelemetrySetup:true; the tripwire must FAIL
//   CLASSIFIER_CONTROL=rev2   vi.mock swaps the Rev 2 presence-based classifier + transform
//                             pair into the real hooks; J2.1 must FAIL
//   URL_SCRUB_CONTROL=identity   the tier functions become no-ops; the A1/J2/SIDE-BY-SIDE tests must FAIL
//   URL_TEXT_CONTROL=identity    the free-text URL pass becomes a no-op; the D1 test must FAIL
//   TARGETS_CONTROL=undefined    harness deletes tracePropagationTargets from the init options;
//                                the HEADERS (third party) test must FAIL

const captured = vi.hoisted(() => ({ bodies: [] as string[] }))

// N3: vi.mock is hoisted above every import and const, so state the factory uses comes from vi.hoisted.
// DEVIATION from the plan's J7 snippet: `{ ...actual, init }` parses but does not work, because the
// spread of the externalised CJS module drops its exports (vitest then reports captureMessage etc. as
// undefined on the mock). A Proxy over the real module forwards every export except `init`.
vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>()
  type InitOptions = Parameters<typeof actual.init>[0]
  type TransportOptions = Parameters<typeof actual.createTransport>[0]
  const init = (options: InitOptions) => {
    // skipOpenTelemetrySetup is a NodeOptions field the @sentry/nextjs init type does not list
    const next: Record<string, unknown> = { ...options }
    if (process.env.TRIPWIRE_CONTROL === 'skip') next.skipOpenTelemetrySetup = true
    if (process.env.TARGETS_CONTROL === 'undefined') delete next.tracePropagationTargets
    return actual.init({
      ...(next as InitOptions),
      transport: ((transportOptions: TransportOptions) =>
        actual.createTransport(transportOptions, async (request) => {
          captured.bodies.push(typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'))
          return { statusCode: 200 }
        })) as InitOptions['transport'],
    })
  }
  return new Proxy(actual, {
    get: (target, prop, receiver) => (prop === 'init' ? init : Reflect.get(target, prop, receiver)),
  })
})

// ---- Rev 2's presence-based classifier + unconditional rename (the struck design), transcribed ----
// Used ONLY under CLASSIFIER_CONTROL=rev2. Swapping the classifier alone cannot make J2.1 fail,
// because the Rev 3 rename guard (method AND host) would protect a hostless child, so the pair
// is swapped (plan M3). The "[no-host]" token is this transcription's choice; Rev 2 defined nothing.
const REV2_URL_KEYS = [
  'url', 'url.full', 'http.url', 'url.path', 'http.target', 'url.query', 'http.query',
  'url.fragment', 'http.fragment', 'url.template', 'next.span_name',
]
interface Loose {
  description?: string
  data?: unknown
}
function rev2Classify(item: Loose): boolean {
  return isRecord(item.data) && REV2_URL_KEYS.some((k) => k in (item.data as Record<string, unknown>))
}
function rev2Transform<T extends Loose>(item: T): T {
  const data: Record<string, unknown> = isRecord(item.data) ? { ...item.data } : {}
  const method = typeof data['http.method'] === 'string' ? data['http.method'] : undefined
  const host = typeof data['server.address'] === 'string' ? data['server.address'] : undefined
  const renamed = `${method ?? 'HTTP'} ${host ?? '[no-host]'}`
  for (const k of ['url.path', 'http.target', 'url.template']) delete data[k]
  if ('next.span_name' in data) data['next.span_name'] = renamed
  return { ...item, ...(typeof item.description === 'string' ? { description: renamed } : {}), data } as T
}

vi.mock('@/lib/observability/scrub-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/observability/scrub-url')>()
  const swapped: Record<string, unknown> = { ...actual }
  if (process.env.CLASSIFIER_CONTROL === 'rev2') {
    swapped.classifyOutgoing = rev2Classify
    swapped.applyTier2 = rev2Transform
  }
  if (process.env.URL_SCRUB_CONTROL === 'identity') {
    swapped.applyTier1 = <T,>(item: T): T => item
    swapped.applyTier2 = <T,>(item: T): T => item
  }
  if (process.env.URL_TEXT_CONTROL === 'identity') swapped.reduceUrlsInText = (s: string): string => s
  return swapped
})

// node:http is loaded AFTER the config import (createRequire), as it would be in the real server where
// Sentry's init runs first. A static `import { request } from 'node:http'` at the top of this file binds
// the unpatched function before init and no client span or breadcrumb is produced (harness artifact found
// in the first RED run; see the build log's diagnostic section).
let nodeHttp: typeof import('node:http')

function nodeHttpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = nodeHttp.request(url, (res) => {
      res.resume()
      res.on('end', () => resolve())
    })
    req.on('error', reject)
    req.end()
  })
}

const MESSAGE_CLEAN = 's1 envelope test event'
const MESSAGE_TEXT_PROBE = 's1 free-text url probe'
const TWILIO_SHAPED = '/2010-04-01/Accounts/ACxxxxS1TEST/Messages/MMxxxxS1TEST/Media/MExxxxS1TEST/S1CANARY_PATH'

let a: RecordingServer // "own origin"
let b: RecordingServer // "third party"
let envelopes: ParsedEnvelope[] = []
let tripwire: string | undefined

beforeAll(async () => {
  a = await startRecordingServer()
  b = await startRecordingServer()
  process.env.NEXT_PUBLIC_APP_URL = a.origin
  await import('@/sentry.server.config')
  nodeHttp = createRequire(import.meta.url)('node:http') as typeof import('node:http')
  tripwire = process.env.NEXT_OTEL_FETCH_DISABLED

  // 1-6, 7: traffic inside a root span (undici instrumentation is onlyIfParent)
  await Sentry.startSpan({ name: 'GET /s1-test-root', op: 'http.server' }, async () => {
    await fetch(`${a.origin}${TWILIO_SHAPED}`) // Twilio-shaped
    await fetch(`${a.origin}/rest/v1/daily_logs?tenant_id=eq.00000000-0000-4000-8000-000000000001&select=id&q=S1CANARY_QUERY`) // PostgREST-shaped
    await nodeHttpGet(`${a.origin}/node-http/S1CANARY_PATH?q=S1CANARY_QUERY`) // node:http
    await fetch(`${a.origin}/forbidden/S1CANARY_PATH?q=S1CANARY_QUERY`) // 403
    // capture-ingest-shaped (capture-ingest.ts N1-N6), obviously fake ids
    await fetch(`${a.origin}/storage/v1/object/capture-documents/S1-TENANT-0000/S1-PROJECT-0000/S1-DOCUMENT-0000/S1-FILE-0000`, { method: 'POST', body: 'x' })
    await fetch(
      `${a.origin}/rest/v1/capture_files?id=in.(S1-FILE-0000)&tenant_id=eq.S1-TENANT-0000&document_id=eq.S1-DOCUMENT-0000&ingest_status=in.(pending,failed)&select=id`,
      { method: 'PATCH', body: '{}' },
    )
    await fetch(`${a.origin}/rest/v1/users?select=id&whatsapp_number=eq.S1-PHONE-PLACEHOLDER`)
    // header propagation probe: own origin vs third party
    await fetch(`${a.origin}/own-origin`)
    await fetch(`${b.origin}/third-party?x=S1CANARY_QUERY`)

    // Scan M's subject: an explicit payload exactly as C5's T-C6-1 builds one (table, counts, job id only)
    Sentry.captureMessage(MESSAGE_CLEAN, { level: 'error', extra: { table: 'capture_files', jobId: 'S1-JOB-0000', fileCount: 1 } })
    // D1 probe: a free-text URL with a path and a query inside an `extra` string
    Sentry.captureMessage(MESSAGE_TEXT_PROBE, {
      level: 'error',
      extra: { note: 'upstream said see https://api.twilio.com/2010-04-01/Accounts/ACxxxxS1TEST/Messages?q=S1CANARY_QUERY.' },
    })
  })

  // J2: a root created the way Next does, through the real OpenTelemetry tracer Sentry installs
  const tracer = trace.getTracer('next.js')
  await new Promise<void>((resolve) => {
    tracer.startActiveSpan(
      'GET',
      {
        kind: SpanKind.SERVER,
        attributes: {
          'next.span_name': 'GET',
          'next.span_type': 'BaseServer.handleRequest',
          'http.method': 'GET',
          'http.target': '/s1-root?code=S1CANARY_QUERY',
        },
      },
      (root) => {
        tracer.startActiveSpan(
          'executing api route (app) /s1-root',
          {
            attributes: {
              'next.span_name': 'executing api route (app) /s1-root',
              'next.span_type': 'AppRouteRouteHandlers.runHandler',
            },
          },
          (child) => {
            child.end()
          },
        )
        root.end()
        resolve()
      },
    )
  })

  await Sentry.flush(5000)
  envelopes = captured.bodies.map(parseEnvelopeBody)
}, 90_000)

afterAll(async () => {
  await Promise.all([a?.close(), b?.close()])
})

function eventWithMessage(message: string): Record<string, unknown> {
  const hit = payloadsOfType(envelopes, 'event').find((e) => e.message === message)
  if (!hit) throw new Error(`no captured error event with message ${JSON.stringify(message)}; captured ${envelopes.length} envelopes`)
  return hit
}

function transactionNamed(name: string): Record<string, unknown> {
  const hit = payloadsOfType(envelopes, 'transaction').find((t) => t.transaction === name)
  if (!hit) throw new Error(`no captured transaction named ${JSON.stringify(name)}`)
  return hit
}

function spansOf(tx: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(tx.spans) ? tx.spans.filter(isRecord) : []
}

function dataOf(item: Record<string, unknown>): Record<string, unknown> {
  return isRecord(item.data) ? item.data : {}
}

function outgoingSpansWithOrigin(origin: string): Record<string, unknown>[] {
  return spansOf(transactionNamed('GET /s1-test-root')).filter((s) => s.origin === origin)
}

function j2Transaction(): Record<string, unknown> {
  const hit = payloadsOfType(envelopes, 'transaction').find((t) => {
    const traceCtx = isRecord(t.contexts) && isRecord(t.contexts.trace) ? t.contexts.trace : {}
    return dataOf(traceCtx)['next.span_type'] === 'BaseServer.handleRequest'
  })
  if (!hit) throw new Error('no captured Next-shaped (BaseServer.handleRequest) transaction')
  return hit
}

describe('S1 real-client envelope test', () => {
  it('captured envelopes at all (positive control for the harness)', () => {
    expect(envelopes.length).toBeGreaterThan(0)
    expect(payloadsOfType(envelopes, 'transaction').length).toBeGreaterThan(1)
    expect(payloadsOfType(envelopes, 'event').length).toBeGreaterThan(1)
  })

  it('TRIPWIRE: NEXT_OTEL_FETCH_DISABLED is "1" after importing the real server config (S2/J4)', () => {
    expect(tripwire).toBe('1')
  })

  describe('A1 locations (each must be RED on the unfixed tree)', () => {
    it('A1 breadcrumbs: outgoing http breadcrumbs carry scheme+host only and no query/fragment keys', () => {
      const crumbs = (eventWithMessage(MESSAGE_CLEAN).breadcrumbs as unknown[] | undefined ?? []).filter(isRecord).filter((c) => c.category === 'http')
      expect(crumbs.length).toBeGreaterThan(0)
      for (const c of crumbs) {
        const d = dataOf(c)
        expect(d.url, 'breadcrumb data.url').toBe('http://127.0.0.1')
        expect(d, 'breadcrumb data keys').not.toHaveProperty('http.query')
        expect(d, 'breadcrumb data keys').not.toHaveProperty('http.fragment')
        expect(d['http.method'], 'method kept').toBeTypeOf('string')
        expect(d.status_code, 'status kept').toBeTypeOf('number')
      }
    })

    it('A1 undici spans: description is "<METHOD> 127.0.0.1"; url.full is scheme+host; no url.path / url.query / http.target', () => {
      const spans = outgoingSpansWithOrigin('auto.http.otel.node_fetch')
      expect(spans.length).toBeGreaterThan(5)
      for (const s of spans) {
        expect(s.description, 'span description').toMatch(/^(GET|POST|PATCH) 127\.0\.0\.1$/)
        const d = dataOf(s)
        expect(d['url.full'], 'url.full').toBe('http://127.0.0.1')
        for (const k of ['url.path', 'url.query', 'http.target', 'http.query', 'http.fragment']) expect(d, `span data ${k}`).not.toHaveProperty(k)
        expect(d['http.response.status_code'], 'status kept').toBeTypeOf('number')
      }
    })

    it('A1 node:http span: http.url is scheme+host; no http.target / url.query', () => {
      const spans = outgoingSpansWithOrigin('auto.http.client')
      expect(spans.length).toBeGreaterThan(0)
      for (const s of spans) {
        const d = dataOf(s)
        expect(s.description, 'span description').toMatch(/^GET 127\.0\.0\.1$/)
        expect(d['http.url'], 'http.url').toBe('http://127.0.0.1')
        for (const k of ['http.target', 'url.query', 'url.path', 'http.query']) expect(d, `span data ${k}`).not.toHaveProperty(k)
      }
    })

    it('A1 D1: a free-text URL with a path and query inside `extra` is reduced to scheme+host', () => {
      const note = (eventWithMessage(MESSAGE_TEXT_PROBE).extra as Record<string, unknown>).note
      expect(note).toBe('upstream said see https://api.twilio.com.')
    })

    it('A1 PostgREST / capture-ingest shapes: no tenant, project, document, file id or phone placeholder anywhere in the envelopes', () => {
      const all = envelopes.map((e) => e.raw).join('\n')
      for (const needle of ['S1-TENANT-0000', 'S1-PROJECT-0000', 'S1-DOCUMENT-0000', 'S1-FILE-0000', 'S1-PHONE-PLACEHOLDER', '00000000-0000-4000-8000-000000000001', 'tenant_id=']) {
        expect(all.includes(needle), `envelope text contains ${needle}`).toBe(false)
      }
    })

    it('A1 raw envelope text: none of the S1 canaries or Twilio-shaped path pieces', () => {
      const all = envelopes.map((e) => e.raw.replace(/"dsn":"[^"]*"/g, '')).join('\n')
      for (const needle of ['S1CANARY_PATH', 'S1CANARY_QUERY', 'ACxxxxS1TEST', 'MMxxxxS1TEST', 'MExxxxS1TEST', '/2010-04-01']) {
        expect(all.includes(needle), `envelope text contains ${needle}`).toBe(false)
      }
    })
  })

  describe('J2: Next-shaped root + INTERNAL child (review B1)', () => {
    it('J2.1 the child description is byte-identical', () => {
      const child = spansOf(j2Transaction()).find((s) => dataOf(s)['next.span_type'] === 'AppRouteRouteHandlers.runHandler')
      expect(child, 'child span present').toBeDefined()
      expect(child?.description).toBe('executing api route (app) /s1-root')
    })

    it("J2.2 the root's http.target has its query stripped", () => {
      const traceCtx = (j2Transaction().contexts as Record<string, unknown>).trace as Record<string, unknown>
      expect(dataOf(traceCtx)['http.target']).toBe('/s1-root')
    })

    it('J2.3 the canary is absent from the raw envelope text of the J2 transaction', () => {
      const env = envelopes.find((e) => e.items.some((i) => i.type === 'transaction' && isRecord(i.payload) && i.payload === j2Transaction()))
      expect(env, 'envelope carrying the J2 transaction').toBeDefined()
      expect(env?.raw.includes('S1CANARY_QUERY')).toBe(false)
    })

    it('J2.4 (extra) the root keeps next.span_name "GET"; the child, whose next.span_type is present but is not AppRender.fetch, is untouched (rule 4 is an exact match)', () => {
      const traceCtx = (j2Transaction().contexts as Record<string, unknown>).trace as Record<string, unknown>
      expect(dataOf(traceCtx)['next.span_name']).toBe('GET')
      const child = spansOf(j2Transaction()).find((s) => dataOf(s)['next.span_type'] === 'AppRouteRouteHandlers.runHandler')
      expect(dataOf(child ?? {})['next.span_name']).toBe('executing api route (app) /s1-root')
    })
  })

  describe('HEADERS: tracePropagationTargets limited to own origin (A4)', () => {
    it('HEADERS own origin received sentry-trace and baggage', () => {
      const own = a.requests.find((r) => r.url === '/own-origin')
      expect(own, 'request reached the own-origin server').toBeDefined()
      expect(own?.headers['sentry-trace']).toBeTypeOf('string')
      expect(own?.headers.baggage).toBeTypeOf('string')
    })

    it('HEADERS the third party received neither sentry-trace nor baggage', () => {
      const third = b.requests.find((r) => r.url.startsWith('/third-party'))
      expect(third, 'request reached the third-party server').toBeDefined()
      expect(third?.headers['sentry-trace'], 'sentry-trace at third party').toBeUndefined()
      expect(third?.headers.baggage, 'baggage at third party').toBeUndefined()
    })
  })

  describe('SIDE-BY-SIDE: the blind spot (C6 mocked scan vs real envelope scan)', () => {
    // Scan M: exactly what test/capture-ingest.test.ts:925-947 does -- the explicit payload the code
    // passes to captureMessage, through the unedited C5 scanner. Scan R: the composed scanner over the
    // real captured envelopes. On the unfixed tree M passes and R fails.
    const explicitPayload = { message: MESSAGE_CLEAN, opts: { level: 'error', extra: { table: 'capture_files', jobId: 'S1-JOB-0000', fileCount: 1 } } }

    it('SIDE-BY-SIDE scan M (mocked, C5-style) is clean', () => {
      expect(leakFindings(explicitPayload, S1_LITERALS)).toEqual([])
    })

    it('SIDE-BY-SIDE scan R (real envelopes) is clean', () => {
      const findings = scanEnvelopes(envelopes)
      const scanM = leakFindings(explicitPayload, S1_LITERALS)
      console.log(`SIDE-BY-SIDE  scan M findings: ${JSON.stringify(scanM)}  |  scan R findings: ${findings.length}`)
      expect(findings, `leaking location classes:\n${describeFindings(findings)}`).toEqual([])
    })

    it('scanner positive control: the composed scanner flags a planted leak in each enumerated location', () => {
      expect(composedFindings('https://api.twilio.com/2010-04-01/x?y=1')).toEqual(expect.arrayContaining(['url-path', 'url-query']))
      expect(composedFindings('https://api.twilio.com')).toEqual([])
      expect(composedFindings('S1CANARY_QUERY')).toContain('literal:S1CANARY')
    })
  })

  describe('scanner self-test (no SDK): one planted leak per location must be flagged', () => {
    // A scanner that cannot see contexts.trace.data (or any other field) would pass vacuously.
    const planted: [string, string, Record<string, unknown>, string][] = [
      ['breadcrumb data.url', 'event', { breadcrumbs: [{ category: 'http', data: { url: 'https://x.test/S1CANARY_PATH' } }] }, 'breadcrumbs[0].data.url'],
      ['breadcrumb http.query key', 'event', { breadcrumbs: [{ category: 'http', data: { 'http.query': '?q=1' } }] }, 'data.http.query'],
      ['span description', 'transaction', { spans: [{ op: 'http.client', description: 'GET https://x.test/a?S1CANARY_QUERY' }] }, 'spans[0].description'],
      ['span data url.full', 'transaction', { spans: [{ op: 'http.client', data: { 'url.full': 'https://x.test/a/b' } }] }, "spans[0].data.url.full"],
      ['span data url.path (outgoing)', 'transaction', { spans: [{ op: 'http.client', data: { 'url.path': '/a' } }] }, 'data.url.path'],
      ['extra', 'event', { extra: { note: 'see https://x.test/a?q=1' } }, 'extra.note'],
      ['contexts.trace.data http.target', 'transaction', { contexts: { trace: { op: 'http.server', data: { 'http.target': '/a?S1CANARY_QUERY' } } } }, 'contexts.trace.data.http.target'],
      ['transaction name', 'transaction', { transaction: 'GET https://x.test/S1CANARY_PATH' }, 'transaction'],
      ['exception value', 'event', { exception: { values: [{ value: 'failed https://x.test/p?q=1' }] } }, 'exception.values[0].value'],
      ['tags', 'event', { tags: { t: 'S1CANARY_PATH' } }, 'tags.t'],
    ]
    it.each(planted)('flags %s', (_label, type, payload, locationFragment) => {
      const env: ParsedEnvelope = { header: {}, items: [{ type, payload }], raw: JSON.stringify(payload) }
      const findings = scanEnvelopes([env])
      expect(findings.some((f) => f.location.includes(locationFragment)), `no finding at ${locationFragment}; got ${describeFindings(findings)}`).toBe(true)
    })
    it('does not flag a clean item (scheme+host only)', () => {
      const payload = { spans: [{ op: 'http.client', description: 'GET api.twilio.com', data: { 'url.full': 'https://api.twilio.com' } }] }
      expect(scanEnvelopes([{ header: {}, items: [{ type: 'transaction', payload }], raw: JSON.stringify(payload) }])).toEqual([])
    })
  })
})
