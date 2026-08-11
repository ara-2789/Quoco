import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { isCronRequestAuthorized } from '@/lib/cron/auth'

// Pure-ish unit tests for the shared cron-request auth check — the fix for
// /api/jobs/tick having no auth at all (live in production) and
// /api/cron/dpr-generate inheriting the same gap on day one had this not
// been caught (2026-08-12). No NextRequest construction ceremony needed —
// isCronRequestAuthorized only ever reads request.headers.get('authorization'),
// so a minimal fake with that one method is enough.

function fakeRequest(authHeader: string | null): NextRequest {
  return { headers: { get: (name: string) => (name === 'authorization' ? authHeader : null) } } as unknown as NextRequest
}

describe('isCronRequestAuthorized', () => {
  const ORIGINAL_ENV = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret-value-16chars'
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_ENV
  })

  it('authorizes a request carrying the exact "Bearer <CRON_SECRET>" header', () => {
    expect(isCronRequestAuthorized(fakeRequest('Bearer test-secret-value-16chars'))).toBe(true)
  })

  it('rejects a missing Authorization header', () => {
    expect(isCronRequestAuthorized(fakeRequest(null))).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(isCronRequestAuthorized(fakeRequest('Bearer wrong-value'))).toBe(false)
  })

  it('rejects a header missing the "Bearer " prefix', () => {
    expect(isCronRequestAuthorized(fakeRequest('test-secret-value-16chars'))).toBe(false)
  })

  it('FAILS CLOSED: CRON_SECRET unset means unauthorized, never "allow everything"', () => {
    delete process.env.CRON_SECRET
    // Even a request that happens to carry the literal string "Bearer undefined"
    // must not slip through via naive template-literal coercion.
    expect(isCronRequestAuthorized(fakeRequest('Bearer undefined'))).toBe(false)
    expect(isCronRequestAuthorized(fakeRequest('Bearer '))).toBe(false)
    expect(isCronRequestAuthorized(fakeRequest(null))).toBe(false)
  })
})
