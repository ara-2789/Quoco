import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '@/lib/email/send'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('sendEmail', () => {
  // Injected directly, never via vi.stubGlobal -- same reasoning as
  // test/unit/outbound-send.test.ts's own fetchMock (stubbing global fetch
  // would also intercept the Supabase JS client's own HTTP calls).
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'zz-test-resend-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'noreply@quoco.co.in')
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws if either required env var is missing -- never proceeds with a partial credential set', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(
      sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock),
    ).rejects.toThrow(/RESEND_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts JSON to the emails endpoint with Bearer auth and the configured from address', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'em_abc123' }))

    const result = await sendEmail(
      { to: 'owner@example.com', subject: 'Daily Progress', text: 'plain text body', html: '<p>html body</p>' },
      fetchMock,
    )

    expect(result).toEqual({ ok: true, status: 200, id: 'em_abc123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer zz-test-resend-key')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      from: 'noreply@quoco.co.in',
      to: 'owner@example.com',
      subject: 'Daily Progress',
      text: 'plain text body',
      html: '<p>html body</p>',
    })
  })

  it('returns ok:false with the provider error message on a 4xx, plus a shape descriptor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { message: 'Invalid `to` field' }))
    const result = await sendEmail({ to: 'not-an-email', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.status).toBe(422)
    expect(result.errorMessage).toBe('Invalid `to` field')
    expect(result.responseShape.parsed).toBe(true)
    expect(result.responseShape.parsedKeys).toEqual(['message'])
    expect(result.responseShape.bodyHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns ok:false on a 5xx, still reporting the status for the caller to classify', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { message: 'Service unavailable' }))
    const result = await sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
  })

  it('refuses to treat a 2xx with no "id" field as success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'queued' }))
    const result = await sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errorMessage).toBe('Resend returned 2xx with valid JSON with no "id" field.')
    expect(result.responseShape.parsedKeys).toEqual(['status'])
  })

  it('refuses to treat a 2xx with an empty body as success', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const result = await sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.errorMessage).toBe('Resend returned 2xx with an empty response body.')
    expect(result.responseShape.bodyLength).toBe(0)
  })

  it('a thrown network error propagates -- the caller decides how to treat it, this function does not swallow it', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))
    await expect(
      sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock),
    ).rejects.toThrow('ECONNRESET')
  })

  it('never includes the API key in a thrown error message', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('RESEND_FROM_EMAIL', '')
    try {
      await sendEmail({ to: 'owner@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
      throw new Error('expected sendEmail to throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain('zz-test-resend-key')
    }
  })
})

// Stage 2 of the media capability (docs/plans/media-capture-design.md item
// 20; docs/plans/stage2-hindrance-photos-plan.md §5). Attachments API
// shape verified live against Resend's own current documentation,
// 2026-09-14 (see lib/email/send.ts's own EmailAttachment header for the
// URLs/date) -- these tests assert the WIRE shape this codebase actually
// sends matches that verified shape, not a re-verification of Resend's
// docs themselves.
describe('sendEmail — attachments (stage 2)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'zz-test-resend-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'noreply@quoco.co.in')
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('omits the attachments key entirely when none are given -- no empty array sent to Resend', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'em_noattach' }))
    await sendEmail({ to: 'pm@example.com', subject: 'x', text: 'x', html: '<p>x</p>' }, fetchMock)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body).not.toHaveProperty('attachments')
  })

  it('omits the attachments key when given an empty array -- same as omitted entirely', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'em_emptyattach' }))
    await sendEmail({ to: 'pm@example.com', subject: 'x', text: 'x', html: '<p>x</p>', attachments: [] }, fetchMock)
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body).not.toHaveProperty('attachments')
  })

  it('serializes attachments with filename/content verbatim and contentType mapped to snake_case content_type on the wire', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'em_withattach' }))
    const base64Bytes = Buffer.from([0xff, 0xd8, 0xff]).toString('base64')
    await sendEmail(
      {
        to: 'pm@example.com',
        subject: 'Hindrance reported',
        text: 'x',
        html: '<p>x</p>',
        attachments: [
          { filename: 'photo1.jpg', content: base64Bytes, contentType: 'image/jpeg' },
          { filename: 'photo2.png', content: base64Bytes, contentType: 'image/png' },
        ],
      },
      fetchMock,
    )
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.attachments).toEqual([
      { filename: 'photo1.jpg', content: base64Bytes, content_type: 'image/jpeg' },
      { filename: 'photo2.png', content: base64Bytes, content_type: 'image/png' },
    ])
    // Verified live against Resend's own docs (this file's own header):
    // `path` is never used -- this codebase always sends bytes directly.
    expect(JSON.stringify(body.attachments)).not.toContain('"path"')
  })

  it('an attachment with no contentType omits content_type entirely -- Resend derives it from filename, per its own documented default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'em_nocontenttype' }))
    await sendEmail(
      { to: 'pm@example.com', subject: 'x', text: 'x', html: '<p>x</p>', attachments: [{ filename: 'photo.jpg', content: 'aGVsbG8=' }] },
      fetchMock,
    )
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.attachments).toEqual([{ filename: 'photo.jpg', content: 'aGVsbG8=' }])
    expect(body.attachments[0]).not.toHaveProperty('content_type')
  })
})
