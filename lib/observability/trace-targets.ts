// S1 (Sentry outgoing-URL scrub): tracePropagationTargets limited to the app's own origin.
//
// When tracePropagationTargets is UNSET the SDK attaches sentry-trace and baggage (trace id, release,
// environment, public key, sometimes the transaction name) to every outgoing request -- Twilio,
// Supabase, Anthropic, Resend (@sentry/core utils/tracePropagationTargets.js:8-11 returns true for all
// URLs when the option is missing). Entries are matched against the ENTIRE absolute URL: a string by
// substring, a RegExp by test. So: anchored regexes, never a bare string, and never an undefined or empty
// result -- an unset, empty or unparseable app URL falls back to the relative-path pattern only, which
// fails closed (no third party matches).
//
// The relative pattern is /^\/(?!\/)/: a protocol-relative URL such as //attacker.test/x starts with a
// slash too and must not match (the SDK's own same-origin test is the same expression,
// @sentry/browser tracing/request.js:112). On the server the URL is always absolute, so only the
// own-origin entry can match there.
//
// Pure TypeScript, no Node APIs -- used by all three Sentry runtimes.

const RELATIVE_SAME_ORIGIN = /^\/(?!\/)/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function ownOriginTraceTargets(appUrl: string | undefined): (string | RegExp)[] {
  const targets: (string | RegExp)[] = [RELATIVE_SAME_ORIGIN]
  if (!appUrl) return targets
  try {
    const url = new URL(appUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return targets
    targets.push(new RegExp(`^${escapeRegExp(`${url.protocol}//${url.host}`)}(?:/|$)`))
  } catch {
    // unparseable app URL: relative pattern only
  }
  return targets
}
