import type { NodeOptions } from '@sentry/nextjs'

// S1 (Sentry outgoing-URL scrub): the server tracesSampler.
//
// QUOTA CONTROL ONLY, NOT A PRIVACY CONTROL (the scrub is). The tick (GET /api/jobs/tick, every minute)
// is sampled at 0.02; everything else at 1. The 2% that are sampled still go through the scrub.
//
// MATCH MECHANISM: at sample time Sentry hands us its INFERRED name ('GET /api/jobs/tick', built from
// http.target by inferSpanData/getSanitizedUrl in @sentry/opentelemetry), NOT Next's raw span name, which
// is still the bare 'GET' until Next's updateName (next base-server.js ~515). Do not "fix" the match
// against Next's raw name: that makes this a silent no-op. The match is name AND path, both required: a
// missing path source returns the non-tick branch (toward more data, never toward dropping another route).
//
// CRON CHECK-INS: none exist for the tick today (next.config.ts sets only webpack.automaticVercelMonitors
// => the 'wrapper' strategy, Pages Router only; _sentryVercelCronsConfig is injected only for the 'spans'
// strategy). If _experimental.vercelCronsMonitoring is ever enabled, check-ins start in handleOnSpanStart
// (@sentry/nextjs server/handleOnSpanStart.js:33) for RECORDED spans only, so ~98% of tick check-ins would
// vanish at 0.02.
//
// inheritOrSampleWith keeps an inherited decision with its real rate (parentSampleRate, then parentSampled,
// then the fallback); returning the raw boolean would record rate 1 for inherited traces.

type SamplingContext = Parameters<NonNullable<NodeOptions['tracesSampler']>>[0]

export const TICK_SAMPLE_RATE = 0.02
const TICK_NAME = 'GET /api/jobs/tick'
const TICK_PATH = '/api/jobs/tick'

function stripQueryAndFragment(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

/** The request path, from http.target first (what is available at sample time), then http.route, url.path, normalizedRequest.url. */
function requestPath(ctx: SamplingContext): string | undefined {
  const attributes = ctx.attributes ?? {}
  const target = attributes['http.target']
  if (typeof target === 'string') return stripQueryAndFragment(target)
  for (const key of ['http.route', 'url.path']) {
    const value = attributes[key]
    if (typeof value === 'string') return stripQueryAndFragment(value)
  }
  const url = ctx.normalizedRequest?.url
  if (typeof url === 'string') {
    try {
      return new URL(url, 'http://placeholder.invalid').pathname
    } catch {
      return undefined
    }
  }
  return undefined
}

export function isTickTransaction(ctx: SamplingContext): boolean {
  return ctx.name === TICK_NAME && requestPath(ctx) === TICK_PATH
}

export function tracesSampler(ctx: SamplingContext): number {
  return isTickTransaction(ctx) ? ctx.inheritOrSampleWith(TICK_SAMPLE_RATE) : ctx.inheritOrSampleWith(1)
}
