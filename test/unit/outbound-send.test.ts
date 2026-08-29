import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/outbound/send'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('sendWhatsAppTemplate', () => {
  // Injected directly as the second argument, never via vi.stubGlobal --
  // stubbing GLOBAL fetch would also intercept the Supabase JS client's own
  // HTTP calls anywhere else in the same process (confirmed the hard way in
  // test/outbound-trigger.test.ts's own CI round; see send.ts's own doc on
  // the fetchFn parameter). This file makes no DB calls, but the injection
  // pattern is exercised here too so both test files stay consistent.
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACzztest0000000000000000000000000')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-test-auth-token')
    vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '+14155238886')
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws if any of the three required env vars is missing -- never proceeds with a partial credential set', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    await expect(
      sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: { '1': 'x' } }, fetchMock),
    ).rejects.toThrow(/TWILIO_ACCOUNT_SID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts form-encoded (NOT JSON) to the classic Messages endpoint, with Basic auth and the whatsapp: prefix on From/To', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMabc123' }))

    const result = await sendWhatsAppTemplate(
      {
        to: '+919876543210',
        contentSid: 'HXd4a896b66bfd7b237f53dc4dca77fb76',
        contentVariables: { '1': 'Arjun Nair', '2': 'Emerald Heights' },
      },
      fetchMock,
    )

    expect(result).toEqual({ ok: true, status: 201, sid: 'SMabc123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACzztest0000000000000000000000000/Messages')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('ACzztest0000000000000000000000000:zz-test-auth-token').toString('base64')}`,
    )
    const body = new URLSearchParams(init.body as string)
    expect(body.get('From')).toBe('whatsapp:+14155238886')
    expect(body.get('To')).toBe('whatsapp:+919876543210')
    expect(body.get('ContentSid')).toBe('HXd4a896b66bfd7b237f53dc4dca77fb76')
    expect(JSON.parse(body.get('ContentVariables')!)).toEqual({ '1': 'Arjun Nair', '2': 'Emerald Heights' })
    // Item D dependency: without this, Twilio has nowhere to POST delivery
    // status, and the status-callback route (app/api/whatsapp/status-
    // callback/route.ts) never receives anything in production. Pinned to
    // the production origin, never an env-derived one -- see send.ts's own
    // header.
    expect(body.get('StatusCallback')).toBe('https://app.quoco.co.in/api/whatsapp/status-callback')
  })

  it('does not double-prefix a "to" that already carries "whatsapp:"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMabc123' }))
    await sendWhatsAppTemplate({ to: 'whatsapp:+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    const [, init] = fetchMock.mock.calls[0]!
    const body = new URLSearchParams(init.body as string)
    expect(body.get('To')).toBe('whatsapp:+919876543210')
  })

  it('returns ok:false with the Twilio error code/message on a 4xx (non-retryable), plus a shape descriptor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: 21211, message: "The 'To' number is not a valid phone number." }))
    const result = await sendWhatsAppTemplate({ to: '+91000', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.status).toBe(400)
    expect(result.errorCode).toBe('21211')
    expect(result.errorMessage).toBe("The 'To' number is not a valid phone number.")
    expect(result.responseShape.parsed).toBe(true)
    expect(result.responseShape.contentType).toBe('application/json')
    expect(result.responseShape.parsedKeys).toEqual(['code', 'message'])
    expect(result.responseShape.bodyLength).toBeGreaterThan(0)
    expect(result.responseShape.bodyHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns ok:false on a 5xx, still reporting the status for the caller to classify as retryable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 20003, message: 'Service unavailable' }))
    const result = await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
  })

  // The four distinguishable response shapes send.ts must now tell apart --
  // docs/reviews/first-cron-fire-record.md's own finding #2. Before this
  // change all three failure shapes below produced the identical error
  // string; each now has both a distinct message AND a distinct
  // `responseShape` (never distinct by CONTENT -- see send.ts's own header
  // for why content is never captured, only structure).

  it('shape 1/4 -- valid JSON WITH sid: unchanged success path, ok:true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SMabc123' }))
    const result = await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result).toEqual({ ok: true, status: 201, sid: 'SMabc123' })
  })

  it('shape 2/4 -- valid JSON WITHOUT sid: parsed=true, parsedKeys present, distinct message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { status: 'queued', to: 'whatsapp:+919876543210' }))
    const result = await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errorMessage).toBe('Twilio returned 2xx with valid JSON with no "sid" field.')
    expect(result.responseShape.parsed).toBe(true)
    expect(result.responseShape.parsedKeys).toEqual(['status', 'to'])
    expect(result.responseShape.bodyLength).toBeGreaterThan(0)
    // SHAPE ONLY -- the fixture's own `to` VALUE must never leak into the
    // error message or anywhere else in the result, only its presence as
    // a key name.
    expect(result.errorMessage).not.toContain('919876543210')
    expect(JSON.stringify(result)).not.toContain('919876543210')
  })

  it('shape 3/4 -- non-JSON body: parsed=false, bodyLength>0, distinct message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>Bad Gateway</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    )
    const result = await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errorMessage).toBe('Twilio returned 2xx with a body that is not valid JSON.')
    expect(result.responseShape.parsed).toBe(false)
    expect(result.responseShape.parsedKeys).toBeUndefined()
    expect(result.responseShape.contentType).toBe('text/html')
    expect(result.responseShape.bodyLength).toBeGreaterThan(0)
    // SHAPE ONLY -- the HTML body's own content must never appear in the
    // error message.
    expect(result.errorMessage).not.toContain('Bad Gateway')
  })

  it('shape 4/4 -- empty body: parsed=false, bodyLength=0, distinct message from the non-JSON case', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const result = await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errorMessage).toBe('Twilio returned 2xx with an empty response body.')
    expect(result.responseShape.parsed).toBe(false)
    expect(result.responseShape.bodyLength).toBe(0)
    // Same `parsed:false` as shape 3, but distinguishable by bodyLength and
    // by the error message itself -- this is the whole point: the old code
    // could not tell these two apart at all.
  })

  it('a thrown network error (no HTTP response at all) propagates -- the caller decides how to treat it, this function does not swallow it', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))
    await expect(
      sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock),
    ).rejects.toThrow('ECONNRESET')
  })

  it('never includes the auth token or its Basic header value in a thrown error message', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'zz-super-secret-token-must-not-leak')
    try {
      await sendWhatsAppTemplate({ to: '+919876543210', contentSid: 'HXabc', contentVariables: {} }, fetchMock)
      throw new Error('expected sendWhatsAppTemplate to throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain('zz-super-secret-token-must-not-leak')
    }
  })
})
