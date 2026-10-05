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

type InitOptions = {
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
  await load()
  expect(init).toHaveBeenCalledTimes(1)
  const scrub = await import('@/lib/observability/scrub-pii')
  let options = init.mock.calls[0][0] as InitOptions
  if (process.env.CONFIG_CONTROL === 'empty') options = { ...options, dataCollection: {} }
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

describe.each(RUNTIMES)('Sentry init options: %s runtime', (_name, load) => {
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
