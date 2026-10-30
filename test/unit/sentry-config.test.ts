import { describe, it, expect, vi, beforeEach } from 'vitest'
// P0 (Sentry PII): an empty `dataCollection: {}` is NOT "off" -- the SDK
// resolves it to its full defaults (userInfo, cookies, headers, query
// params, request/response bodies, stack-frame variables all collected;
// node_modules/@sentry/core/build/cjs/utils/data-collection/
// resolveDataCollectionOptions.js:5-14). This test imports each runtime's
// real init file with Sentry.init mocked and asserts the options it passes.
//
// POSITIVE CONTROLS (test-only switches, no source file is edited; run them
// as `env NAME=value npx vitest run ...` so the control is visible in a log):
//   CONFIG_CONTROL=empty   substitutes `dataCollection: {}` (what the old
//                          files set) before asserting.
//   HOOKS_CONTROL=none     removes all five hooks from the captured options.
//   HOOKS_CONTROL=identity replaces all five hooks with identity functions.
// The corresponding assertions must then FAIL.
const { init } = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({
  init,
  captureRouterTransitionStart: vi.fn(),
  captureRequestError: vi.fn(),
}))

// S1 additions (plan A4, B, J6): tracePropagationTargets limited to own origin in all three
// runtimes, and tracesSampler (0.02 for the tick, 1 otherwise) in the server runtime only.
//   TARGETS_CONTROL=undefined  deletes tracePropagationTargets before asserting (propagate-to-all)
//   TARGETS_CONTROL=all        substitutes /.*/ (the third-party "does not match" assertions must FAIL)
//   SAMPLER_CONTROL=const1     replaces tracesSampler with () => 1 (the tick sampler wiring row must FAIL)
const APP_URL = 'https://app.example.test'

type InitOptions = {
  tracesSampleRate?: unknown
  tracesSampler?: unknown
  tracePropagationTargets?: unknown
  dataCollection?: Record<string, unknown>
  beforeSend?: unknown
  beforeBreadcrumb?: unknown
  beforeSendTransaction?: unknown
  beforeSendSpan?: unknown
  beforeSendLog?: unknown
}

const RUNTIMES: [string, () => Promise<unknown>][] = [
  ['server', () => import('@/sentry.server.config')],
  ['edge', () => import('@/sentry.edge.config')],
  ['client', () => import('@/instrumentation-client')],
]

type Scrub = typeof import('@/lib/observability/scrub-pii')

async function initOptionsFor(load: () => Promise<unknown>): Promise<{ options: InitOptions; scrub: Scrub }> {
  // The scrubber is imported AFTER the reset so it is the same module
  // instance the config file just imported (identity comparison below).
  vi.resetModules()
  init.mockClear()
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
  await load()
  expect(init).toHaveBeenCalledTimes(1)
  const scrub = await import('@/lib/observability/scrub-pii')
  let options = init.mock.calls[0][0] as InitOptions
  if (process.env.CONFIG_CONTROL === 'empty') options = { ...options, dataCollection: {} }
  if (process.env.TARGETS_CONTROL === 'undefined') {
    options = { ...options }
    delete options.tracePropagationTargets
  }
  if (process.env.TARGETS_CONTROL === 'all') options = { ...options, tracePropagationTargets: [/.*/] }
  if (process.env.SAMPLER_CONTROL === 'const1' && options.tracesSampler !== undefined) options = { ...options, tracesSampler: () => 1 }
  if (process.env.HOOKS_CONTROL === 'none') {
    options = { ...options }
    for (const hook of HOOK_NAMES) delete options[hook]
  }
  if (process.env.HOOKS_CONTROL === 'identity') {
    options = { ...options }
    for (const hook of HOOK_NAMES) options[hook] = (item: unknown) => item
  }
  return { options, scrub }
}

const HOOK_NAMES = [
  'beforeSend',
  'beforeBreadcrumb',
  'beforeSendTransaction',
  'beforeSendSpan',
  'beforeSendLog',
] as const

const PHONE = '+919876543210'
const PHONE_DIGITS = '9876543210'
type Hook = (item: unknown) => unknown

describe.each(RUNTIMES)('Sentry init options: %s runtime', (runtimeName, load) => {
  let options: InitOptions
  let scrub: Scrub
  beforeEach(async () => {
    ;({ options, scrub } = await initOptionsFor(load))
  })

  it('sets every dataCollection field explicitly (D1)', () => {
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      queryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    })
  })

  it('leaves frameContextLines at its default', () => {
    expect(options.dataCollection).not.toHaveProperty('frameContextLines')
  })

  it('tracePropagationTargets is a defined array limited to the own origin (S1/A4)', () => {
    const targets = options.tracePropagationTargets
    expect(Array.isArray(targets), 'tracePropagationTargets must be set (unset = propagate to every host)').toBe(true)
    const matches = (url: string) => (targets as (string | RegExp)[]).some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)))
    expect(matches(`${APP_URL}/api/x`)).toBe(true)
    expect(matches('/api/x')).toBe(true)
    for (const third of [
      'https://api.twilio.com/x',
      'https://xyz.supabase.co/rest/v1/x',
      'https://api.anthropic.com/v1/messages',
      'https://api.resend.com/emails',
      'https://evil-app.example.test/',
      '//attacker.test/x',
    ]) {
      expect(matches(third), third).toBe(false)
    }
  })

  it('sampling: the server runtime has the tick tracesSampler and NO tracesSampleRate; edge and client keep tracesSampleRate 1 and no sampler (S1/B)', () => {
    if (runtimeName === 'server') {
      expect(options.tracesSampler).toBeTypeOf('function')
      expect(options).not.toHaveProperty('tracesSampleRate')
      const inheritOrSampleWith = (fallback: number) => fallback
      const tick = { name: 'GET /api/jobs/tick', attributes: { 'http.target': '/api/jobs/tick' }, inheritOrSampleWith }
      const other = { name: 'GET /api/x', attributes: { 'http.target': '/api/x' }, inheritOrSampleWith }
      expect((options.tracesSampler as (c: unknown) => number)(tick)).toBe(0.02)
      expect((options.tracesSampler as (c: unknown) => number)(other)).toBe(1)
    } else {
      expect(options.tracesSampleRate).toBe(1)
      expect(options.tracesSampler).toBeUndefined()
    }
  })

  it('wires the scrubber into all five hooks', () => {
    expect(options.beforeSend).toBe(scrub.scrubErrorEvent)
    expect(options.beforeBreadcrumb).toBe(scrub.scrubBreadcrumb)
    expect(options.beforeSendTransaction).toBe(scrub.scrubTransactionEvent)
    expect(options.beforeSendSpan).toBe(scrub.scrubSpan)
    expect(options.beforeSendLog).toBe(scrub.scrubLog)
  })

  // Behavioural: whatever function is configured, an item carrying a phone
  // number must come out of it without one.
  const items: [string, (typeof HOOK_NAMES)[number], unknown][] = [
    ['error event', 'beforeSend', { message: `failed for whatsapp:${PHONE}`, extra: { to: PHONE } }],
    ['breadcrumb', 'beforeBreadcrumb', { message: `sent to whatsapp:${PHONE}` }],
    ['transaction', 'beforeSendTransaction', { type: 'transaction', transaction: `POST ${PHONE}` }],
    [
      'span',
      'beforeSendSpan',
      { span_id: 'a', trace_id: 'b', start_timestamp: 1, data: { 'http.url': `/u?whatsapp_number=eq.%2B91${PHONE_DIGITS}` } },
    ],
    ['log record', 'beforeSendLog', { level: 'error', message: `unreachable whatsapp:${PHONE}` }],
  ]
  it.each(items)('the configured hook for a %s strips whatsapp:+919876543210', (_label, hookName, item) => {
    const hook = options[hookName] as Hook | undefined
    expect(hook).toBeTypeOf('function')
    const out = (hook as Hook)(item)
    expect(out).not.toBeNull()
    expect(JSON.stringify(out)).not.toContain(PHONE_DIGITS)
  })
})
