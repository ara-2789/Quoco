import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { handleConfirmEmailGet, handleConfirmEmailPost } from '@/app/api/owner/confirm-email/route'
import { testClient, TEST_TENANT_ID, ensureMorningFixtures, removeMorningFixtures } from './helpers/db'

// Integration tests for app/api/owner/confirm-email (034 §5) -- exercises
// handleConfirmEmailGet/handleConfirmEmailPost directly with an injected
// test-db client, the SAME functions GET/POST call in production (same
// shape as test/webhook.test.ts's own handleWebhookPost pattern) -- no
// mocks, no separate assembly that can drift from what production runs.
//
// SCOPE, PER DIRECT INSTRUCTION: prefetch-then-click (GET is idempotent and
// non-consuming); a second POST with the same token fails; an expired
// token fails; a malformed token fails IDENTICALLY to a nonexistent one
// (enumeration-resistance). A rate-limit test is included as a good-faith
// completeness measure since that mechanism ships as its own merge
// condition -- not explicitly asked for, but it's new, real behaviour this
// file is the only place that can exercise it.
//
// EACH TEST USES A UNIQUE x-forwarded-for IP so the module-level rate
// limiter (a shared Map, by design -- see the route's own header) cannot
// leak state between tests. Same isolation principle as testPhone(slot)
// elsewhere in this suite, applied to IPs instead of phone numbers.

const CONFIRM_URL = 'https://quoco.test/api/owner/confirm-email'
let nextTestIp = 9000

function testIp(): string {
  nextTestIp += 1
  return `203.0.113.${nextTestIp % 250}-${nextTestIp}` // unique per test, never a real routable IP
}

function buildGetRequest(token: string | null, ip: string): NextRequest {
  const url = token !== null ? `${CONFIRM_URL}?token=${encodeURIComponent(token)}` : CONFIRM_URL
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

function buildPostRequest(token: string, ip: string): NextRequest {
  return new NextRequest(CONFIRM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip,
    },
    body: new URLSearchParams({ token }).toString(),
  })
}

async function bodyText(response: Response): Promise<string> {
  return response.text()
}

// Test-only equivalent of scripts/provision-beta-owner.ts's own steps 1+3,
// with full control over the raw token / expiry / used_at so each test can
// construct exactly the state it needs. Not reusing the real script here
// deliberately -- that script sends a real email via Resend, which these
// tests must never do.
const createdUserIds: string[] = []
const createdVerificationIds: string[] = []

async function createTestOwner(): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_ID,
      full_name: 'ZZ Test Owner',
      role: 'owner',
      auth_id: null,
      whatsapp_number: null,
      status: 'active',
      notification_email: 'zz-test-owner@quoco.test',
    })
    .select('id')
    .single()
  if (error) throw new Error(`createTestOwner failed: ${error.message}`)
  createdUserIds.push(data.id as string)
  return data.id as string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// expiresInMs must stay POSITIVE and comfortably larger than real network
// round-trip time -- owner_email_verifications' own CHECK constraint
// (owner_email_verifications_expires_after_created) forbids a row from
// ever being born already-expired (created_at is the DB SERVER's clock at
// INSERT time; too small a buffer here can put expires_at before it purely
// from network latency, independent of the test's own intent). A token can
// only expire because real time passes -- create it with SOON_EXPIRY_MS
// and await ALREADY_EXPIRED_WAIT_MS (which must exceed it) to genuinely
// cross the boundary.
const SOON_EXPIRY_MS = 3000
const ALREADY_EXPIRED_WAIT_MS = 4000

async function createVerification(
  userId: string,
  opts: { expiresInMs?: number } = {},
): Promise<{ rawToken: string; verificationId: string }> {
  const db = testClient()
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 7 * 24 * 60 * 60 * 1000)).toISOString()
  const { data, error } = await db
    .from('owner_email_verifications')
    .insert({
      tenant_id: TEST_TENANT_ID,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createVerification failed: ${error.message}`)
  createdVerificationIds.push(data.id as string)
  return { rawToken, verificationId: data.id as string }
}

// Marks a verification row used AFTER it already exists -- the same CHECK
// constraint (owner_email_verifications_used_after_created) forbids
// used_at earlier than created_at, so this must be a follow-up UPDATE with
// a genuinely later timestamp, never part of the original INSERT.
async function markVerificationUsed(verificationId: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('owner_email_verifications').update({ used_at: new Date().toISOString() }).eq('id', verificationId)
  if (error) throw new Error(`markVerificationUsed failed: ${error.message}`)
}

beforeAll(async () => {
  // TEST_TENANT_ID's row doesn't exist until this runs (ensureTestTenant,
  // called internally) -- users.tenant_id's FK requires it. The engineer/
  // project fixtures this also creates are unused here but harmless.
  await ensureMorningFixtures()
})

afterEach(async () => {
  const db = testClient()
  if (createdVerificationIds.length > 0) {
    await db.from('owner_email_verifications').delete().in('id', createdVerificationIds)
    createdVerificationIds.length = 0
  }
  if (createdUserIds.length > 0) {
    await db.from('users').delete().in('id', createdUserIds)
    createdUserIds.length = 0
  }
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('app/api/owner/confirm-email', () => {
  it('prefetch-then-click: GET is idempotent and non-consuming -- a scanner prefetch does not burn the token', async () => {
    const db = testClient()
    const userId = await createTestOwner()
    const { rawToken, verificationId } = await createVerification(userId)
    const ip = testIp()

    // Simulate a mail gateway's automated prefetch, then the owner's own
    // click -- both GET, same token, same IP (well within the rate limit).
    const prefetch = await handleConfirmEmailGet(buildGetRequest(rawToken, ip), { supabaseClient: db })
    expect(prefetch.status).toBe(200)
    expect(await bodyText(prefetch)).toContain('Confirm my email')

    const realClick = await handleConfirmEmailGet(buildGetRequest(rawToken, ip), { supabaseClient: db })
    expect(realClick.status).toBe(200)
    expect(await bodyText(realClick)).toContain('Confirm my email')

    // Neither GET wrote anything.
    const { data: owner } = await db.from('users').select('notification_email_verified_at').eq('id', userId).single()
    expect(owner?.notification_email_verified_at).toBeNull()
    const { data: verification } = await db.from('owner_email_verifications').select('used_at').eq('id', verificationId).single()
    expect(verification?.used_at).toBeNull()

    // The token is still genuinely usable -- the real point of this test.
    const post = await handleConfirmEmailPost(buildPostRequest(rawToken, testIp()), { supabaseClient: db })
    expect(post.status).toBe(200)
    expect(await bodyText(post)).toContain('confirmed')

    const { data: ownerAfter } = await db.from('users').select('notification_email_verified_at').eq('id', userId).single()
    expect(ownerAfter?.notification_email_verified_at).not.toBeNull()
  })

  it('a second POST with the same token fails -- single-use, not idempotent success', async () => {
    const db = testClient()
    const userId = await createTestOwner()
    const { rawToken } = await createVerification(userId)

    const first = await handleConfirmEmailPost(buildPostRequest(rawToken, testIp()), { supabaseClient: db })
    expect(first.status).toBe(200)
    expect(await bodyText(first)).toContain('confirmed')

    const second = await handleConfirmEmailPost(buildPostRequest(rawToken, testIp()), { supabaseClient: db })
    expect(second.status).toBe(200)
    const secondBody = await bodyText(second)
    expect(secondBody).toContain('expired or already been used')
    expect(secondBody).not.toContain('confirmed')

    // The first POST's own verification is not undone by the second's failure.
    const { data: owner } = await db.from('users').select('notification_email_verified_at').eq('id', userId).single()
    expect(owner?.notification_email_verified_at).not.toBeNull()
  })

  it('an expired token fails, on both GET and POST', async () => {
    const db = testClient()
    const userId = await createTestOwner()
    const { rawToken } = await createVerification(userId, { expiresInMs: SOON_EXPIRY_MS })
    await sleep(ALREADY_EXPIRED_WAIT_MS) // let real time cross expires_at -- see createVerification's own note

    const get = await handleConfirmEmailGet(buildGetRequest(rawToken, testIp()), { supabaseClient: db })
    expect(get.status).toBe(200)
    expect(await bodyText(get)).toContain('expired or already been used')

    const post = await handleConfirmEmailPost(buildPostRequest(rawToken, testIp()), { supabaseClient: db })
    expect(post.status).toBe(200)
    expect(await bodyText(post)).toContain('expired or already been used')

    const { data: owner } = await db.from('users').select('notification_email_verified_at').eq('id', userId).single()
    expect(owner?.notification_email_verified_at).toBeNull()
  })

  it('a malformed token fails IDENTICALLY to a well-formed but nonexistent one -- no enumeration oracle', async () => {
    const malformed = 'not-a-real-token'
    const wellFormedButNonexistent = randomBytes(32).toString('hex') // never inserted anywhere

    const malformedGet = await handleConfirmEmailGet(buildGetRequest(malformed, testIp()), { supabaseClient: testClient() })
    const nonexistentGet = await handleConfirmEmailGet(buildGetRequest(wellFormedButNonexistent, testIp()), {
      supabaseClient: testClient(),
    })

    expect(malformedGet.status).toBe(nonexistentGet.status)
    expect(await bodyText(malformedGet)).toBe(await bodyText(nonexistentGet))

    const malformedPost = await handleConfirmEmailPost(buildPostRequest(malformed, testIp()), { supabaseClient: testClient() })
    const nonexistentPost = await handleConfirmEmailPost(buildPostRequest(wellFormedButNonexistent, testIp()), {
      supabaseClient: testClient(),
    })

    expect(malformedPost.status).toBe(nonexistentPost.status)
    expect(await bodyText(malformedPost)).toBe(await bodyText(nonexistentPost))
  })

  it('used and expired tokens also render the SAME generic page as not-found -- no distinguishing signal anywhere', async () => {
    const db = testClient()
    const userId = await createTestOwner()
    const { rawToken: usedToken, verificationId } = await createVerification(userId)
    await markVerificationUsed(verificationId)
    const { rawToken: expiredToken } = await createVerification(userId, { expiresInMs: SOON_EXPIRY_MS })
    await sleep(ALREADY_EXPIRED_WAIT_MS)
    const nonexistentToken = randomBytes(32).toString('hex')

    const usedResp = await handleConfirmEmailGet(buildGetRequest(usedToken, testIp()), { supabaseClient: db })
    const expiredResp = await handleConfirmEmailGet(buildGetRequest(expiredToken, testIp()), { supabaseClient: db })
    const nonexistentResp = await handleConfirmEmailGet(buildGetRequest(nonexistentToken, testIp()), { supabaseClient: db })

    const [usedBody, expiredBody, nonexistentBody] = await Promise.all([
      bodyText(usedResp),
      bodyText(expiredResp),
      bodyText(nonexistentResp),
    ])
    expect(usedBody).toBe(expiredBody)
    expect(expiredBody).toBe(nonexistentBody)
  })

  it('missing token query param on GET renders the generic page, not an error', async () => {
    const response = await handleConfirmEmailGet(buildGetRequest(null, testIp()), { supabaseClient: testClient() })
    expect(response.status).toBe(200)
    expect(await bodyText(response)).toContain('expired or already been used')
  })

  it('rate limiting: the 21st request from one IP within the window is refused with 429', async () => {
    const ip = testIp()
    const db = testClient()
    let last: Response | null = null
    for (let i = 0; i < 21; i++) {
      last = await handleConfirmEmailGet(buildGetRequest(null, ip), { supabaseClient: db })
    }
    expect(last?.status).toBe(429)
  })
})
