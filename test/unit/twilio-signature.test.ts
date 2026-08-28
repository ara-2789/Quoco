import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'
import { getAllowedWebhookOrigins, validateTwilioSignature, PRODUCTION_WEBHOOK_ORIGIN } from '@/lib/whatsapp/twilio-signature'

// D1 -- the pinned allowlist, unit-tested directly (docs/plans/pass1-
// outbound-send-plan.md's own Amendment (a); the incident this closes is
// documented in this module's own header, restated in the coordination
// checkpoint's D1 report, not repeated here).

function signTwilioParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

const AUTH_TOKEN = 'zz-test-auth-token'
const PARAMS = { MessageSid: 'SMabc123', MessageStatus: 'delivered' }
const PATH = '/api/whatsapp/webhook'

describe('getAllowedWebhookOrigins', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('the current production host (app.quoco.co.in) is definitely present', () => {
    expect(getAllowedWebhookOrigins()).toContain(PRODUCTION_WEBHOOK_ORIGIN)
    expect(PRODUCTION_WEBHOOK_ORIGIN).toBe('https://app.quoco.co.in')
  })

  it('the OLD retired host (quoco-six.vercel.app) is NOT present -- dead surface area, not defense in depth', () => {
    expect(getAllowedWebhookOrigins()).not.toContain('https://quoco-six.vercel.app')
  })

  it('adds NEXT_PUBLIC_APP_URL as a second candidate when set and different from the pinned origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://some-preview-env.example.com')
    const origins = getAllowedWebhookOrigins()
    expect(origins).toContain(PRODUCTION_WEBHOOK_ORIGIN)
    expect(origins).toContain('https://some-preview-env.example.com')
    expect(origins.length).toBe(2)
  })

  it('does not duplicate the pinned origin when NEXT_PUBLIC_APP_URL happens to equal it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', PRODUCTION_WEBHOOK_ORIGIN)
    expect(getAllowedWebhookOrigins()).toEqual([PRODUCTION_WEBHOOK_ORIGIN])
  })
})

describe('validateTwilioSignature', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('each allowed host validates -- pinned production origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const signature = signTwilioParams(`${PRODUCTION_WEBHOOK_ORIGIN}${PATH}`, PARAMS, AUTH_TOKEN)
    expect(validateTwilioSignature(PATH, PARAMS, signature, AUTH_TOKEN)).toBe(true)
  })

  it('each allowed host validates -- env-derived candidate', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://some-preview-env.example.com')
    const signature = signTwilioParams(`https://some-preview-env.example.com${PATH}`, PARAMS, AUTH_TOKEN)
    expect(validateTwilioSignature(PATH, PARAMS, signature, AUTH_TOKEN)).toBe(true)
  })

  it('an unlisted host is rejected', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const signature = signTwilioParams(`https://evil.example.com${PATH}`, PARAMS, AUTH_TOKEN)
    expect(validateTwilioSignature(PATH, PARAMS, signature, AUTH_TOKEN)).toBe(false)
  })

  it('the retired old host (quoco-six.vercel.app) no longer validates', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const signature = signTwilioParams(`https://quoco-six.vercel.app${PATH}`, PARAMS, AUTH_TOKEN)
    expect(validateTwilioSignature(PATH, PARAMS, signature, AUTH_TOKEN)).toBe(false)
  })

  it('a wrong auth token never validates against any allowed host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const signature = signTwilioParams(`${PRODUCTION_WEBHOOK_ORIGIN}${PATH}`, PARAMS, 'wrong-token')
    expect(validateTwilioSignature(PATH, PARAMS, signature, AUTH_TOKEN)).toBe(false)
  })

  it('a garbage/wrong-length signature is rejected, not thrown (RangeError guard)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(() => validateTwilioSignature(PATH, PARAMS, 'short', AUTH_TOKEN)).not.toThrow()
    expect(validateTwilioSignature(PATH, PARAMS, 'short', AUTH_TOKEN)).toBe(false)
  })
})
