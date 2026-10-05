import { describe, it, expect, vi, beforeEach } from 'vitest'
// P0 (Sentry PII): an empty `dataCollection: {}` is NOT "off" -- the SDK
// resolves it to its full defaults (userInfo, cookies, headers, query
// params, request/response bodies, stack-frame variables all collected;
// node_modules/@sentry/core/build/cjs/utils/data-collection/
// resolveDataCollectionOptions.js:5-14). This test imports each runtime's
// real init file with Sentry.init mocked and asserts the options it passes.
//
// POSITIVE CONTROL: CONFIG_CONTROL=empty substitutes `dataCollection: {}`
// (what the old files set) before asserting; the assertions must then FAIL.
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
  const options = init.mock.calls[0][0] as InitOptions
  return { options: process.env.CONFIG_CONTROL === 'empty' ? { ...options, dataCollection: {} } : options, scrub }
}

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
})
