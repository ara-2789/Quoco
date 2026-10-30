import { describe, it, expect } from 'vitest'

// S1 (Sentry outgoing-URL scrub), plan section A4: tracePropagationTargets limited to own origin.
// Unset means "propagate sentry-trace and baggage to EVERY host" (@sentry/core
// utils/tracePropagationTargets.js:8-11), so the helper fails closed and never returns nothing.
// Entries match the ENTIRE absolute URL: a string by substring, a RegExp by test.

type Target = string | RegExp

async function targets(appUrl: string | undefined): Promise<Target[]> {
  const { ownOriginTraceTargets } = await import('@/lib/observability/trace-targets')
  return ownOriginTraceTargets(appUrl)
}

function matches(list: Target[], url: string): boolean {
  return list.some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)))
}

describe('ownOriginTraceTargets', () => {
  const OWN = 'https://app.example.test'

  it('matches the own origin (with and without a path or query) and relative same-origin URLs', async () => {
    const t = await targets(OWN)
    for (const url of [OWN, `${OWN}/`, `${OWN}/api/x`, `${OWN}/api/x?y=1`, '/api/x', '/']) expect(matches(t, url), url).toBe(true)
  })

  it('does not match third parties, lookalikes, or a protocol-relative URL (N1)', async () => {
    const t = await targets(OWN)
    const other = [
      'https://api.twilio.com/x',
      'https://xyz.supabase.co/rest/v1/x',
      'https://api.anthropic.com/v1/messages',
      'https://api.resend.com/emails',
      'https://evil-app.example.test/',
      'https://app.example.test.attacker.test/',
      'https://app.example.testx/',
      'http://app.example.test/',
      '//attacker.test/x',
      '//app.example.test/x',
    ]
    for (const url of other) expect(matches(t, url), url).toBe(false)
  })

  it('an origin with a port matches that port only', async () => {
    const t = await targets('http://127.0.0.1:3000/ignored/path')
    expect(matches(t, 'http://127.0.0.1:3000/a')).toBe(true)
    expect(matches(t, 'http://127.0.0.1:30001/a')).toBe(false)
    expect(matches(t, 'http://127.0.0.1/a')).toBe(false)
  })

  it('regex metacharacters in the host are escaped', async () => {
    const t = await targets('https://a.b')
    expect(matches(t, 'https://a.b/x')).toBe(true)
    expect(matches(t, 'https://aXb/x')).toBe(false)
  })

  const failClosed: [string, string | undefined][] = [
    ['undefined', undefined],
    ['empty', ''],
    ['not a URL', 'not a url'],
    ['non-http scheme', 'ftp://files.test'],
    ['javascript scheme', 'javascript:alert(1)'],
  ]
  it.each(failClosed)('fails closed (only the relative pattern, never an empty or undefined list) when the app URL is %s', async (_label, appUrl) => {
    const t = await targets(appUrl)
    expect(Array.isArray(t)).toBe(true)
    expect(t.length).toBeGreaterThan(0)
    expect(matches(t, '/api/x')).toBe(true)
    expect(matches(t, 'https://api.twilio.com/x')).toBe(false)
    expect(matches(t, 'https://app.example.test/x')).toBe(false)
  })
})
