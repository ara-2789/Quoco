import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'
import {
  scrubBreadcrumb,
  scrubErrorEvent,
  scrubSpan,
  scrubString,
  scrubTransactionEvent,
  scrubWithTraversal,
} from '@/lib/observability/scrub-pii'
import type { SpanJSON, TransactionEvent } from '@/lib/observability/scrub-pii'

// S1 (Sentry outgoing-URL scrub), plan sections A, C5, J1, J5, M1, M4, M6.
//
// Rows that exercise the PRODUCTION HOOKS (scrubSpan, scrubBreadcrumb, scrubTransactionEvent,
// scrubErrorEvent) import only exports that already exist, so on the unfixed tree they fail on
// content, not on a missing module. Rows for the new pure functions load scrub-url dynamically.
//
// CONTROLS (read by test code only; run as `env NAME=value npx vitest run ...`):
//   URL_SCRUB_CONTROL=identity   vi.mock makes applyTier1/applyTier2 no-ops: the tier, B2 and N7 rows must FAIL
//   URL_TEXT_CONTROL=identity    vi.mock makes reduceUrlsInText a no-op: the free-text rows must FAIL
//   SEAM_CONTROL=show            the two J5 seam controls run their assertion un-inverted, so they FAIL visibly
//   CLASSIFIER_CONTROL=rev2-classifier   (S7) vi.mock swaps ONLY the classifier for Rev 2's presence-based one
//                                        (the real Tier 2 stays): "Next root span is Tier 1 only" must FAIL

// Rev 2's presence-based classifier, transcribed: any key from Rev 2's URL_KEYS makes an item "outgoing".
// A function declaration with its key list INSIDE it: this vi.mock factory runs while scrub-pii.ts is being
// imported (before any top-level const here is initialised), so it may not read a top-level const.
function rev2Classify(item: { data?: unknown }): boolean {
  const keys = ['url', 'url.full', 'http.url', 'url.path', 'http.target', 'url.query', 'http.query', 'url.fragment', 'http.fragment', 'url.template', 'next.span_name']
  const data = item.data
  return typeof data === 'object' && data !== null && keys.some((k) => k in data)
}

vi.mock('@/lib/observability/scrub-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/observability/scrub-url')>()
  const swapped: Record<string, unknown> = { ...actual }
  if (process.env.CLASSIFIER_CONTROL === 'rev2-classifier') swapped.classifyOutgoing = rev2Classify
  if (process.env.URL_SCRUB_CONTROL === 'identity') {
    swapped.applyTier1 = <T,>(item: T): T => item
    swapped.applyTier2 = <T,>(item: T): T => item
  }
  if (process.env.URL_TEXT_CONTROL === 'identity') swapped.reduceUrlsInText = (s: string): string => s
  return swapped
})

const PHONE = '+919876543210'
const CANARY = 'S1CANARY_QUERY'

function mkSpan(fields: Record<string, unknown>): SpanJSON {
  return { span_id: 'a1a1a1a1a1a1a1a1', trace_id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', start_timestamp: 1, ...fields } as unknown as SpanJSON
}

function dataOf(item: { data?: unknown }): Record<string, unknown> {
  return (item.data ?? {}) as Record<string, unknown>
}

async function urlModule() {
  return await import('@/lib/observability/scrub-url')
}

describe('reduceUrlsInText (D1)', () => {
  const schemeless = [
    '',
    'plain text',
    `apply_material_inward_turn failed for ${PHONE}: boom`,
    'a/b?c=d#e',
    '70446.00',
    '9876543210.00',
    '2026-09-10T10:00:00.000Z',
    'webpack-internal:///(rsc)/./app/page.tsx',
    'ftp://files.test/a?b=c',
    'file:///Users/x/y.js',
    'app:///_next/static/chunks/a.js',
  ]
  it.each(schemeless)('a string without http(s):// is returned byte-identical: %j', async (input) => {
    const { reduceUrlsInText } = await urlModule()
    expect(reduceUrlsInText(input)).toBe(input)
  })

  const rows: [string, string, string][] = [
    ['trailing sentence punctuation is kept outside the match', 'see https://api.twilio.com/2010-04-01/x?y=1.', 'see https://api.twilio.com.'],
    ['two URLs in one string', 'a https://one.test/p?q=1 b http://two.test:8080/x#f c', 'a https://one.test b http://two.test c'],
    ['userinfo and port are dropped', 'https://user:pw@host.test:8443/p?q#f', 'https://host.test'],
    ['uppercase scheme and host', 'HTTPS://Host.TEST/Path', 'https://host.test'],
    ['URL at the end of the string', 'failed: https://h.test/a/b', 'failed: https://h.test'],
    ['PostgREST parentheses stay inside the match', 'GET https://x.test/rest/v1/t?id=in.(a,b)&tenant_id=eq.U failed', 'GET https://x.test failed'],
    ['closing parenthesis after the URL is kept', '(see https://a.test/c)', '(see https://a.test)'],
    ['unparseable http(s) URL', 'bad https://[oops here', 'bad [unparseable-url] here'],
  ]
  it.each(rows)('%s', async (_label, input, expected) => {
    const { reduceUrlsInText } = await urlModule()
    expect(reduceUrlsInText(input)).toBe(expected)
  })

  it('is idempotent', async () => {
    const { reduceUrlsInText } = await urlModule()
    const once = reduceUrlsInText('x https://u:p@h.test:1/a?b#c y')
    expect(reduceUrlsInText(once)).toBe(once)
  })

  it('scrubString(one argument) still runs the URL pass; { urls: false } leaves a URL; phone and email always run', () => {
    expect(scrubString('see https://api.twilio.com/a?b=1')).toBe('see https://api.twilio.com')
    expect(scrubString('see https://api.twilio.com/a?b=1', { urls: false })).toBe('see https://api.twilio.com/a?b=1')
    expect(scrubString(`to ${PHONE}`, { urls: false })).toBe('to [redacted-phone]')
    expect(scrubString('mail pm@example.co.in', { urls: false })).toBe('mail [redacted-email]')
  })

  it('a phone inside a URL path is gone after the URL pass, and the phone regex still works on its own', () => {
    expect(scrubString(`x https://h.test/a/${PHONE}/b`)).toBe('x https://h.test')
    expect(scrubString(`call ${PHONE} now`)).toBe('call [redacted-phone] now')
  })
})

describe('J1 two-tier classifier, through the production hooks', () => {
  it('Next root span is Tier 1 only: http.target loses its query, names are untouched (S1 half of /auth/callback?code=)', () => {
    const tx = {
      type: 'transaction',
      transaction: 'GET /auth/callback',
      contexts: {
        trace: {
          trace_id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          span_id: 'a1a1a1a1a1a1a1a1',
          data: {
            'next.span_name': 'GET',
            'next.span_type': 'BaseServer.handleRequest',
            'http.method': 'GET',
            'http.target': `/auth/callback?code=${CANARY}`,
            'http.route': '/auth/callback',
          },
        },
      },
    } as unknown as TransactionEvent
    const out = scrubTransactionEvent(tx)
    const data = dataOf((out?.contexts?.trace ?? {}) as { data?: unknown })
    expect(data['http.target']).toBe('/auth/callback')
    expect(data['next.span_name']).toBe('GET')
    expect(data['http.route']).toBe('/auth/callback')
    expect(JSON.stringify(out)).not.toContain(CANARY)
  })

  it('an INTERNAL Next span with next.span_name / next.span_type is byte-identical (rule 4 is an exact match, not a presence check)', () => {
    const child = mkSpan({
      description: 'executing api route (app) /api/jobs/tick',
      data: { 'next.span_name': 'executing api route (app) /api/jobs/tick', 'next.span_type': 'AppRouteRouteHandlers.runHandler', 'next.route': '/api/jobs/tick' },
    })
    expect(scrubSpan(child)).toEqual(child)
  })

  it('an undici-shaped span (op http.client, origin auto.http.otel.node_fetch) is Tier 1 + Tier 2', () => {
    const span = mkSpan({
      op: 'http.client',
      origin: 'auto.http.otel.node_fetch',
      description: 'GET https://api.twilio.com/2010-04-01/Accounts/ACxxxxS1TEST/Messages/MMxxxxS1TEST/Media/MExxxxS1TEST',
      data: {
        'http.request.method': 'GET',
        'url.full': `https://api.twilio.com/2010-04-01/Accounts/ACxxxxS1TEST/Messages/MMxxxxS1TEST/Media/MExxxxS1TEST?q=${CANARY}`,
        'url.path': '/2010-04-01/Accounts/ACxxxxS1TEST',
        'url.query': `?q=${CANARY}`,
        'url.scheme': 'https',
        'server.address': 'api.twilio.com',
        'http.response.status_code': 403,
      },
    })
    const out = scrubSpan(span)
    expect(out.description).toBe('GET api.twilio.com')
    const d = dataOf(out)
    expect(d['url.full']).toBe('https://api.twilio.com')
    expect(d).not.toHaveProperty('url.path')
    expect(d).not.toHaveProperty('url.query')
    expect(d['http.response.status_code']).toBe(403)
    expect(d['http.request.method']).toBe('GET')
    expect(JSON.stringify(out)).not.toContain(CANARY)
  })

  it('an `http` breadcrumb is Tier 1 + Tier 2: url is scheme+host; method and status are kept; http.query is deleted', () => {
    const crumb = {
      category: 'http',
      type: 'http',
      data: { url: 'https://api.twilio.com/2010-04-01/x', 'http.method': 'GET', 'http.query': `?q=${CANARY}`, status_code: 403 },
    } as unknown as Breadcrumb
    const out = scrubBreadcrumb(crumb)
    expect(out.data).toEqual({ url: 'https://api.twilio.com', 'http.method': 'GET', status_code: 403 })
  })

  it('web-vitals (origin auto.http.browser.lcp) and server (auto.http.otel.http) spans are NOT Tier 2: descriptions untouched', () => {
    const vital = mkSpan({ op: 'ui.webvital.lcp', origin: 'auto.http.browser.lcp', description: 'largest-contentful-paint', data: { 'http.method': 'GET' } })
    expect(scrubSpan(vital).description).toBe('largest-contentful-paint')
    const server = mkSpan({
      op: 'http.server',
      origin: 'auto.http.otel.http',
      description: 'GET /api/x',
      data: { 'http.method': 'GET', 'http.target': '/api/x?a=b', 'url.full': 'https://app.test/api/x?a=b', 'server.address': 'app.test' },
    })
    const out = scrubSpan(server)
    expect(out.description).toBe('GET /api/x')
    expect(dataOf(out)['http.target']).toBe('/api/x')
    expect(dataOf(out)['url.full']).toBe('https://app.test')
  })

  it('data["otel.kind"] === "CLIENT" alone makes a span Tier 2 (SpanJSON has no kind field)', () => {
    const span = mkSpan({
      description: 'GET https://h.test/p',
      data: { 'otel.kind': 'CLIENT', 'http.method': 'GET', 'http.url': 'https://h.test/p?q=1', 'net.peer.name': 'h.test', 'http.target': '/p?q=1' },
    })
    const out = scrubSpan(span)
    expect(out.description).toBe('GET h.test')
    expect(dataOf(out)).not.toHaveProperty('http.target')
    expect(dataOf(out)['http.url']).toBe('https://h.test')
  })

  it('rename guard: a Tier 2 span with a method but no host, or a host but no method, keeps its description', () => {
    const noHost = mkSpan({ op: 'http.client', description: 'GET', data: { 'http.method': 'GET' } })
    expect(scrubSpan(noHost).description).toBe('GET')
    const noMethod = mkSpan({ op: 'http.client', description: 'something odd', data: { 'server.address': 'h.test' } })
    expect(scrubSpan(noMethod).description).toBe('something odd')
  })

  it('http.route and next.route are untouched in both tiers', () => {
    const span = mkSpan({ op: 'http.client', description: 'GET', data: { 'http.method': 'GET', 'http.route': '/r/:id', 'next.route': '/r/[id]' } })
    expect(dataOf(scrubSpan(span))).toMatchObject({ 'http.route': '/r/:id', 'next.route': '/r/[id]' })
  })

  it('breadcrumbs: fetch, xhr and `type: http` are Tier 2; a console breadcrumb is Tier 1 only', () => {
    const fetchCrumb = scrubBreadcrumb({ category: 'fetch', type: 'http', data: { url: '/rsc?_rsc=abc#f', method: 'GET' } } as unknown as Breadcrumb)
    expect(fetchCrumb.data?.url).toBe('[same-origin]')
    const consoleCrumb = scrubBreadcrumb({ category: 'console', message: 'x', data: { url: '/p?q=1#f' } } as unknown as Breadcrumb)
    expect(consoleCrumb.data?.url).toBe('/p')
  })

  it('transaction event: contexts.trace.data and every event.spans[] entry go through the tiers', () => {
    const tx = {
      type: 'transaction',
      transaction: 'GET /x',
      contexts: { trace: { data: { 'http.target': `/x?q=${CANARY}`, 'url.full': `https://app.test/x?q=${CANARY}` } } },
      spans: [
        mkSpan({ op: 'http.client', description: 'GET https://h.test/a?q=1', data: { 'http.request.method': 'GET', 'url.full': 'https://h.test/a?q=1', 'url.path': '/a', 'url.query': '?q=1' } }),
      ],
    } as unknown as TransactionEvent
    const out = scrubTransactionEvent(tx)
    expect(JSON.stringify(out)).not.toContain(CANARY)
    expect(out?.spans?.[0].description).toBe('GET h.test')
    expect(dataOf(out?.spans?.[0] as { data?: unknown })).not.toHaveProperty('url.path')
  })

  it('error event: contexts.trace.data http.target loses its query too', () => {
    const ev = { message: 'm', contexts: { trace: { data: { 'http.target': `/auth/callback?code=${CANARY}` } } } } as unknown as ErrorEvent
    expect(JSON.stringify(scrubErrorEvent(ev))).not.toContain(CANARY)
  })

  it('fail closed: a span whose data throws on access comes out without the URL (never the raw item)', () => {
    const data: Record<string, unknown> = {}
    Object.defineProperty(data, 'url', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    const out = scrubSpan(mkSpan({ op: 'http.client', description: `GET https://h.test/p?q=${CANARY}`, data }))
    expect(out).toBeDefined()
    expect(JSON.stringify(out)).not.toContain(CANARY)
  })

  it('applyTier1 / applyTier2 are idempotent', async () => {
    const { applyTier1, applyTier2 } = await urlModule()
    const span = mkSpan({ op: 'http.client', description: 'GET https://h.test/a?q=1', data: { 'http.request.method': 'GET', 'url.full': 'https://h.test/a?q=1', 'url.path': '/a' } })
    const once = applyTier2(applyTier1(span))
    expect(applyTier2(applyTier1(once))).toEqual(once)
  })
})

describe('B2: relative URLs (browser fetch spans and xhr/fetch breadcrumbs)', () => {
  const REL = `/api/x?tenant_id=${CANARY}#f`

  it('browser fetch span with a relative url: Tier 2 output is [same-origin]; the canary is absent', () => {
    // shape per @sentry/core/build/cjs/fetch.js:189-209 for a relative URL (no http.url / server.address)
    const span = mkSpan({
      op: 'http.client',
      origin: 'auto.http.browser',
      description: 'GET /api/x',
      data: { url: REL, type: 'fetch', 'http.method': 'GET', 'http.query': `?tenant_id=${CANARY}`, 'http.fragment': '#f' },
    })
    const out = scrubSpan(span)
    const d = dataOf(out)
    expect(d.url).toBe('[same-origin]')
    expect(out.description).toBe('GET [same-origin]')
    expect(d).not.toHaveProperty('http.query')
    expect(d).not.toHaveProperty('http.fragment')
    expect(JSON.stringify(out)).not.toContain(CANARY)
  })

  it('xhr breadcrumb with a relative url: data.url is [same-origin]; method and status kept; canary absent', () => {
    const crumb = { category: 'xhr', type: 'http', data: { method: 'GET', url: REL, status_code: 200 } } as unknown as Breadcrumb
    const out = scrubBreadcrumb(crumb)
    expect(out.data).toEqual({ method: 'GET', url: '[same-origin]', status_code: 200 })
    expect(JSON.stringify(out)).not.toContain(CANARY)
  })

  it('Tier 1 only: a non-outgoing item with a relative url keeps its path and loses query and fragment', () => {
    const out = scrubSpan(mkSpan({ op: 'custom', description: 'x', data: { url: REL } }))
    expect(dataOf(out).url).toBe('/api/x')
  })

  const unparseable: [string, string][] = [
    ['data: URL', 'data:text/plain;base64,AAAA'],
    ['free text', 'not a url'],
    ['protocol-relative', '//evil.test/x?q=1'],
  ]
  it.each(unparseable)('a %s under http.url becomes [unparseable-url]', (_label, value) => {
    const out = scrubSpan(mkSpan({ op: 'custom', description: 'x', data: { 'http.url': value } }))
    expect(dataOf(out)['http.url']).toBe('[unparseable-url]')
  })
})

describe('N7: Tier 2 host', () => {
  const base = { op: 'http.client', description: 'GET', data: { 'http.method': 'GET' } }
  it('server.address with a port: the port is stripped (core/fetch.js:200 sets server.address to parsedUrl.host)', () => {
    const out = scrubSpan(mkSpan({ ...base, data: { ...base.data, 'server.address': 'host.test:8443' } }))
    expect(out.description).toBe('GET host.test')
  })
  it('a bracketed IPv6 server.address keeps its brackets', () => {
    const out = scrubSpan(mkSpan({ ...base, data: { ...base.data, 'server.address': '[::1]:8443' } }))
    expect(out.description).toBe('GET [::1]')
  })
  it('a server.address without a port is unchanged', () => {
    expect(scrubSpan(mkSpan({ ...base, data: { ...base.data, 'server.address': 'host.test' } })).description).toBe('GET host.test')
  })
  it('the host comes from the reduced URL value first', () => {
    const out = scrubSpan(mkSpan({ ...base, data: { ...base.data, 'url.full': 'https://other.test/x', 'server.address': 'host.test:8443' } }))
    expect(out.description).toBe('GET other.test')
  })
})

describe('J5: urlPass, skip set, keys', () => {
  const FILENAME = 'https://app.example.test/_next/static/chunks/a.js?dpl=x'
  function frameEvent(): ErrorEvent {
    return {
      message: 'boom',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: { frames: [{ filename: FILENAME, abs_path: FILENAME, context_line: `call("${PHONE}")` }] },
          },
        ],
      },
    } as unknown as ErrorEvent
  }
  // A verdict, not a throw: a control that is "expected to throw" would pass vacuously on a TypeError
  // when the seam does not exist yet.
  function verdict(out: ErrorEvent): { filenameKept: boolean; phoneRedacted: boolean } {
    const frame = (out.exception?.values?.[0].stacktrace?.frames ?? [])[0]
    return {
      filenameKept: frame.filename === FILENAME && frame.abs_path === FILENAME,
      phoneRedacted: !JSON.stringify(out).includes('9876543210'),
    }
  }

  it('POSITIVE (through production scrubErrorEvent): a client frame filename survives byte-identical AND the phone in context_line is redacted', () => {
    expect(verdict(scrubErrorEvent(frameEvent()))).toEqual({ filenameKept: true, phoneRedacted: true })
  })

  it('CONTROL 1: with the skip removed the filename is NOT kept (the filename assertion would FAIL)', () => {
    const v = verdict(scrubWithTraversal(frameEvent(), { skip: [] }))
    expect(v.phoneRedacted).toBe(true)
    // SEAM_CONTROL=show runs the production expectation un-inverted, so the control goes RED visibly
    expect(v.filenameKept).toBe(process.env.SEAM_CONTROL === 'show')
  })

  it('CONTROL 2: with descent stopped at the skip keys the phone is NOT redacted (the phone assertion would FAIL); stopDescent is a P0 regression by design, test-only', () => {
    const v = verdict(scrubWithTraversal(frameEvent(), { stopDescent: true }))
    expect(v.filenameKept).toBe(true)
    expect(v.phoneRedacted).toBe(process.env.SEAM_CONTROL === 'show')
  })

  it('keys get the URL pass with their owning object flag; two keys that reduce to the same string collide, last wins', () => {
    const out = scrubErrorEvent({ extra: { 'https://a.test/x?1': 1, 'https://a.test/y?2': 2 } } as unknown as ErrorEvent)
    expect(out.extra).toEqual({ 'https://a.test': 2 })
  })

  it('phone and email in keys are redacted even inside a skipped subtree', () => {
    const out = scrubErrorEvent({ exception: { values: [{ stacktrace: { vars: { 'pm@example.co.in': 1 } } }] } } as unknown as ErrorEvent)
    expect(JSON.stringify(out)).toContain('[redacted-email]')
    expect(JSON.stringify(out)).not.toContain('example.co.in')
  })

  it('debug_meta, sdk and modules are skipped by the URL pass', () => {
    const ev = { debug_meta: { images: [{ code_file: FILENAME }] }, sdk: { name: 'x', packages: [{ name: FILENAME }] }, modules: { [FILENAME]: '1' } } as unknown as ErrorEvent
    const out = scrubErrorEvent(ev)
    expect(JSON.stringify(out)).toContain(FILENAME)
  })

  it('the seam is referenced by NONE of the three Sentry configs and reads no env var (static)', () => {
    for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts']) {
      expect(readFileSync(resolve(__dirname, '../..', file), 'utf8'), file).not.toContain('scrubWithTraversal')
    }
    const src = readFileSync(resolve(__dirname, '../../lib/observability/scrub-pii.ts'), 'utf8')
    expect(src).not.toMatch(/process\.env/)
  })
})
