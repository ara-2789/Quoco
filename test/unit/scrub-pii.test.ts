import { describe, it, expect } from 'vitest'
import type { Breadcrumb, ErrorEvent, Log } from '@sentry/nextjs'
import * as real from '@/lib/observability/scrub-pii'
import type { SpanJSON, TransactionEvent } from '@/lib/observability/scrub-pii'

// POSITIVE CONTROL: SCRUBBER_CONTROL=identity swaps every scrubber for an
// identity function. Every phone/email/crash assertion below must then FAIL.
// A suite that also passes against identity proves nothing.
const identity = <T>(x: T): T => x
const s: typeof real =
  process.env.SCRUBBER_CONTROL === 'identity'
    ? ({
        ...real,
        scrubString: identity,
        scrubErrorEvent: identity,
        scrubTransactionEvent: identity,
        scrubBreadcrumb: identity,
        scrubSpan: identity,
        scrubLog: identity,
      } as typeof real)
    : real

const RUN_TAG = crypto.randomUUID()
const PHONE = '+919876543210'
const PHONE_DIGITS = '919876543210'
const EMAIL_ADDR = `pm-${RUN_TAG.slice(0, 8)}@example.co.in`

function hasNoPersonalData(value: unknown): void {
  const text = JSON.stringify(value)
  expect(text).not.toContain('9876543210')
  expect(text).not.toContain('98765 43210')
  expect(text).not.toContain('98765-43210')
  expect(text).not.toContain('@example.co.in')
  expect(text).not.toContain('%40example.co.in')
}

describe('scrubString: every pattern is redacted', () => {
  const phoneCases: [string, string][] = [
    ['whatsapp:+<digits>', `from whatsapp:${PHONE} ok`],
    ['whatsapp:<digits>', `from whatsapp:${PHONE_DIGITS} ok`],
    ['url-encoded whatsapp colon and plus', `From=whatsapp%3A%2B${PHONE_DIGITS}`],
    ['E.164', `call ${PHONE} now`],
    ['E.164 with spaces', 'call +91 98765 43210 now'],
    ['E.164 with hyphens', 'call +91-98765-43210 now'],
    ['E.164, non-Indian', 'call +14155238886 now'],
    ['URL-encoded E.164', `x=%2B${PHONE_DIGITS}`],
    ['URL-encoded E.164 in a PostgREST filter', `whatsapp_number=eq.%2B${PHONE_DIGITS}`],
    ['bare Indian mobile (9)', 'user 9876543210 here'],
    ['bare Indian mobile (6)', 'user 6123456789 here'],
    ['bare Indian mobile with 91, no plus', `user ${PHONE_DIGITS} here`],
  ]
  for (const [name, input] of phoneCases) {
    it(`phone: ${name}`, () => {
      const out = s.scrubString(`${RUN_TAG} ${input}`)
      expect(out).toContain('[redacted-phone]')
      expect(out).toContain(RUN_TAG)
      expect(out).not.toMatch(/\d{5}[ -]?\d{5}/)
      expect(out).not.toContain('9876543210')
    })
  }

  it('email', () => {
    const out = s.scrubString(`${RUN_TAG} mail ${EMAIL_ADDR} bounced`)
    expect(out).toContain('[redacted-email]')
    expect(out).not.toContain('@example.co.in')
  })

  it('URL-encoded email', () => {
    const out = s.scrubString(`email=eq.pm%40example.co.in&x=${RUN_TAG}`)
    expect(out).toContain('[redacted-email]')
    expect(out).not.toContain('example.co.in')
  })
})

describe('scrubString: non-matches are preserved byte for byte', () => {
  const preserved: [string, string][] = [
    ['a UUID', RUN_TAG],
    ['a Twilio SID (letters + hex)', `SM${RUN_TAG.replace(/-/g, '')}`],
    ['a Twilio media SID', `MM${RUN_TAG.replace(/-/g, '')}`],
    ['an ISO date', '2026-09-10'],
    ['an ISO timestamp', '2026-09-10T10:00:00.000Z'],
    ['an amount with decimals', '70446.00'],
    ['an amount without decimals', '59700'],
    ['a 10-digit decimal amount', '9876543210.00'],
    ['a 10-digit number starting 1 (epoch seconds)', '1759708800'],
    ['epoch milliseconds', '1759708800000'],
    ['a 12-digit number without the 91 prefix', '123456789012'],
    ['a 12-digit number starting 7, not 91', '776543210987'],
    ['a 12-digit number starting 91 but not followed by 6-9', '912345678901'],
  ]
  for (const [name, input] of preserved) {
    it(name, () => {
      expect(s.scrubString(input)).toBe(input)
      const sentence = `total ${input} for ${RUN_TAG}`
      expect(s.scrubString(sentence)).toBe(sentence)
    })
  }
})

describe('scrubErrorEvent: every field type', () => {
  function dirtyEvent(): ErrorEvent {
    return {
      type: undefined,
      event_id: RUN_TAG.replace(/-/g, ''),
      message: `failed for whatsapp:${PHONE}`,
      fingerprint: ['x', PHONE],
      exception: { values: [{ type: 'Error', value: `lookup failed for ${PHONE}: boom` }] },
      extra: { phoneNumber: PHONE, nested: { email: EMAIL_ADDR }, list: [PHONE], tenantId: RUN_TAG },
      tags: { phone: PHONE, feature: 'x' },
      contexts: { custom: { whatsapp_number: `whatsapp:${PHONE}` } },
      request: {
        url: `https://x.example/rest/v1/users?whatsapp_number=eq.%2B${PHONE_DIGITS}`,
        query_string: `From=whatsapp%3A%2B${PHONE_DIGITS}`,
        data: `From=whatsapp%3A%2B${PHONE_DIGITS}&Body=hi`,
        headers: { 'x-forwarded-for': 'a', 'x-contact': EMAIL_ADDR },
      },
      breadcrumbs: [{ message: `sent to ${PHONE}`, data: { to: `+91 98765 43210` } }],
      user: { email: EMAIL_ADDR, username: PHONE },
    } as unknown as ErrorEvent
  }

  it('redacts every string field and keeps internal UUIDs', () => {
    const out = s.scrubErrorEvent(dirtyEvent())
    hasNoPersonalData(out)
    expect((out.extra as { tenantId: string }).tenantId).toBe(RUN_TAG)
    expect(out.event_id).toBe(RUN_TAG.replace(/-/g, ''))
  })

  it('never returns null for a normal event', () => {
    expect(s.scrubErrorEvent(dirtyEvent())).not.toBeNull()
  })

  it('an exception message containing whatsapp:+919876543210', () => {
    const e = { exception: { values: [{ value: `session read failed for whatsapp:${PHONE}` }] } } as unknown as ErrorEvent
    expect(JSON.stringify(s.scrubErrorEvent(e))).not.toContain('9876543210')
  })

  it('CRASH: a throwing field yields the minimal event, with no original content', () => {
    const event = dirtyEvent()
    Object.defineProperty(event, 'extra', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    const out = s.scrubErrorEvent(event)
    expect(out).toEqual({ message: 'pii-scrubber-failed', level: 'error', event_id: RUN_TAG.replace(/-/g, '') })
    hasNoPersonalData(out)
  })
})

describe('scrubTransactionEvent', () => {
  function dirtyTx(): TransactionEvent {
    return {
      type: 'transaction',
      event_id: RUN_TAG.replace(/-/g, ''),
      transaction: `POST /api/whatsapp/webhook ${PHONE}`,
      contexts: { trace: { data: { 'http.url': `https://x/?To=%2B${PHONE_DIGITS}` } } },
      request: { data: `From=whatsapp%3A%2B${PHONE_DIGITS}` },
      spans: [{ description: `GET /users?whatsapp_number=eq.%2B${PHONE_DIGITS}`, data: { to: PHONE } }],
    } as unknown as TransactionEvent
  }

  it('redacts transaction name, contexts, request data and spans', () => {
    const out = s.scrubTransactionEvent(dirtyTx())
    hasNoPersonalData(out)
    expect(out).not.toBeNull()
  })

  it('CRASH: the transaction is dropped (null), never replaced by an error event', () => {
    const tx = dirtyTx()
    Object.defineProperty(tx, 'contexts', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    expect(s.scrubTransactionEvent(tx)).toBeNull()
  })
})

describe('scrubBreadcrumb', () => {
  it('redacts message and data', () => {
    const b: Breadcrumb = {
      category: 'fetch',
      message: `to ${PHONE}`,
      data: { url: `https://x/?whatsapp_number=eq.%2B${PHONE_DIGITS}`, email: EMAIL_ADDR },
    }
    const out = s.scrubBreadcrumb(b)
    hasNoPersonalData(out)
    expect(out).not.toBeNull()
  })

  it('CRASH: minimal breadcrumb, no original content', () => {
    const b: Breadcrumb = { message: `to ${PHONE}`, timestamp: 123 }
    Object.defineProperty(b, 'data', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    const out = s.scrubBreadcrumb(b)
    expect(out).toEqual({ message: 'pii-scrubber-failed', level: 'error', timestamp: 123 })
  })
})

describe('scrubSpan', () => {
  function dirtySpan(): SpanJSON {
    return {
      span_id: 'abcdef0123456789',
      trace_id: RUN_TAG.replace(/-/g, ''),
      start_timestamp: 1,
      description: `GET /rest/v1/users?whatsapp_number=eq.%2B${PHONE_DIGITS}`,
      data: {
        'http.url': `https://x.supabase.co/rest/v1/users?whatsapp_number=eq.%2B${PHONE_DIGITS}`,
        'http.query': `whatsapp_number=eq.%2B${PHONE_DIGITS}`,
        'http.status_code': 200,
      },
    }
  }

  it('redacts a span http.url carrying whatsapp_number=eq.%2B919876543210', () => {
    const out = s.scrubSpan(dirtySpan())
    expect(String(out.data['http.url'])).not.toContain('9876543210')
    hasNoPersonalData(out)
    expect(out.data['http.status_code']).toBe(200)
    expect(out.trace_id).toBe(RUN_TAG.replace(/-/g, ''))
  })

  it('CRASH: string attributes replaced, ids kept, item still returned', () => {
    const span = dirtySpan()
    let reads = 0
    const realData = span.data
    Object.defineProperty(span, 'data', {
      enumerable: true,
      get() {
        reads++
        if (reads === 1) throw new Error('boom')
        return realData
      },
    })
    const out = s.scrubSpan(span)
    expect(out).not.toBeNull()
    expect(out.description).toBe('pii-scrubber-failed')
    expect(out.data['http.url']).toBe('pii-scrubber-failed')
    expect(out.data['http.status_code']).toBe(200)
    expect(out.span_id).toBe('abcdef0123456789')
    hasNoPersonalData(out)
  })

  it('CRASH on every read: last-resort span still carries no original content', () => {
    const span = dirtySpan()
    Object.defineProperty(span, 'data', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    const out = s.scrubSpan(span)
    expect(out.description).toBe('pii-scrubber-failed')
    expect(out.data).toEqual({})
    hasNoPersonalData(out)
  })
})

describe('scrubLog', () => {
  function dirtyLog(): Log {
    return {
      level: 'error',
      message: `could not reach +91 98765 43210 (${RUN_TAG})` as Log['message'],
      attributes: { to: PHONE, mail: EMAIL_ADDR, count: 3 },
    }
  }

  it('redacts a log record containing +91 98765 43210', () => {
    const out = s.scrubLog(dirtyLog())
    hasNoPersonalData(out)
    expect(String(out.message)).toContain(RUN_TAG)
    expect(out.attributes?.count).toBe(3)
    expect(out).not.toBeNull()
  })

  it('CRASH: message and string attributes replaced, item still returned', () => {
    const log = dirtyLog()
    let reads = 0
    const realAttrs = log.attributes
    Object.defineProperty(log, 'attributes', {
      enumerable: true,
      get() {
        reads++
        if (reads === 1) throw new Error('boom')
        return realAttrs
      },
    })
    const out = s.scrubLog(log)
    expect(out).not.toBeNull()
    expect(out.message).toBe('pii-scrubber-failed')
    expect(out.attributes?.to).toBe('pii-scrubber-failed')
    expect(out.attributes?.count).toBe(3)
    hasNoPersonalData(out)
  })
})
