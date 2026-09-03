import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'

// Owner email confirmation -- 034_owner_email_delivery.sql §5's own
// application-layer spec, built here for the first time. Double opt-in for
// a manually-seeded address (034 §2j/A2): the operator can mistype an
// address as easily as a self-service form could, so a real human click is
// what actually verifies it, never the seeding step.
//
// GET RENDERS, POST CONSUMES -- THE SECURITY FIX (034 §5, external review
// finding S), STATED PRECISELY SO THE REASON SURVIVES ALONGSIDE THE CODE.
// Corporate mail gateways (Microsoft Safe Links and equivalents) fetch
// EVERY link in an email automatically, on arrival, before a human ever
// opens the message -- a GET indistinguishable, at the HTTP layer, from the
// owner's own click. A design where GET itself verifies would let the
// SCANNER's prefetch confirm the address, with no human intent involved at
// all -- double opt-in bypassed by the exact automated-fetch mechanism
// double opt-in exists to defeat. The milder failure is also real and would
// ship invisibly otherwise: the token burns on the scanner's prefetch, the
// real owner clicks minutes or hours later, and sees "expired or already
// used" with no way to tell that apart from a genuinely stale link. GET
// below performs a READ-ONLY validation and renders a page carrying the
// token in a hidden form field; ONLY the POST from that page's own form
// writes anything.
//
// RE-VALIDATED AT THE POST, NOT TRUSTED FROM THE GET. Real time passes
// between a page being rendered and a human clicking its button -- the
// token could expire, or a second tab could already have consumed it, in
// that gap. validateToken() below is the ONE place either handler checks
// expiry/used-state, so the two paths cannot drift.
//
// ENUMERATION-RESISTANCE (034 §5's own note): "not found," "expired," and
// "already used" all render the IDENTICAL generic page below -- an
// attacker who can tell those apart from the response could use that
// oracle to search the token space. A malformed token (wrong length, not
// hex) is rejected before ever reaching the database, and produces the
// exact same generic page too -- see validateToken's own comment.
//
// TOKEN COMPARISON: the raw token from the URL/form is never stored or
// logged -- only SHA-256(raw token) is compared against
// owner_email_verifications.token_hash, matching 034 §3's own storage
// choice (a stolen database dump cannot reconstruct a usable token from
// the hash alone).
//
// SEQUENTIAL WRITES, DELIBERATE ORDER, NOT A LITERAL DB TRANSACTION. 034 §5
// describes the success write as "one transaction" -- this route achieves
// the same SAFETY property (never a state where the token is dead but the
// owner was never actually verified) without one, since PostgREST/
// service-role table writes from application code are each their own
// transaction; there is no multi-table transaction available here without
// introducing an RPC, which 034 §0(a)'s own assessment deliberately avoided
// for this write path (see that file's grant-layer section). Order matters:
// `users.notification_email_verified_at` is written FIRST, THEN
// `owner_email_verifications.used_at` SECOND. If the process dies between
// them, the owner is correctly verified (the fact that matters) and the
// token merely stays usable for one further click -- re-running the same
// branch a second time is idempotent (verified_at just advances to a later
// `now()`) and completes the second write on that retry. The REVERSE order
// would be unsafe: a crash after marking `used_at` but before verifying
// would leave the token permanently dead with the owner never actually
// verified, and no way to retry it (a used token is deliberately never
// revived -- 034 §5's own EXPIRED-TOKEN BEHAVIOUR note, same principle).
//
// RATE LIMITING (034 §5's own required-not-optional note; ships as a merge
// condition, per direct instruction) -- see RATE_LIMIT_WINDOW_MS below for
// the exact limit, key, and the honest limitation of an in-memory limiter
// on serverless.
//
// CLAUDE.md §0(c) ASSESSMENT ("Touches auth or identity") -- TRIPS,
// same finding 034 itself already recorded for the schema this route
// reads/writes: a public, unauthenticated, bearer-token-gated write into
// `users.notification_email_verified_at`, for a person with no Supabase
// Auth session and no login (auth_id NULL by design). This route is where
// that surface actually goes live -- 034's own text: "the guard relocates
// to the confirm-route PR." Full review in this PR's own body.

export interface EmailVerificationRow {
  id: string
  user_id: string
  used_at: string | null
  expires_at: string
}

type TokenValidation = { valid: true; row: EmailVerificationRow } | { valid: false }

// A raw token is always crypto.randomBytes(32).toString('hex') -- exactly
// 64 lowercase hex characters (034 §3, script/provision-beta-owner.ts).
// Anything else is rejected before ever touching the database; the
// response is identical to a well-formed-but-nonexistent token either way
// (GENERIC_RESULT_PAGE below), so short-circuiting here changes no
// observable behaviour, only avoids an unnecessary round-trip.
const RAW_TOKEN_SHAPE = /^[0-9a-f]{64}$/

async function validateToken(client: SupabaseClient, rawToken: string): Promise<TokenValidation> {
  if (!RAW_TOKEN_SHAPE.test(rawToken)) {
    return { valid: false }
  }
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const { data, error } = await client
    .from('owner_email_verifications')
    .select('id, user_id, used_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle<EmailVerificationRow>()
  if (error) throw error
  if (!data) return { valid: false }
  if (data.used_at !== null) return { valid: false }
  if (new Date(data.expires_at).getTime() <= Date.now()) return { valid: false }
  return { valid: true, row: data }
}

// ---------------------------------------------------------------------------
// Rate limiting -- in-memory, per-warm-instance, fixed window. Keyed on the
// client IP (first hop of x-forwarded-for, which Vercel sets on every
// request); shared across GET and POST on this route, per 034 §5's own
// note that a single limit covering both "is simplest to build and is not
// wrong to apply to both."
//
// HONEST LIMITATION, NAMED RATHER THAN OVERSOLD: this is NOT a distributed
// rate limiter. Vercel serverless functions do not share memory across
// instances, regions, or cold starts, so a determined attacker spread
// across many concurrent invocations is not meaningfully throttled by this
// alone. It is real within one warm instance, and it is PROPORTIONATE to
// the actual threat here: the token space is crypto.randomBytes(32) (256
// bits), making brute-force guessing computationally infeasible regardless
// of how aggressive a rate an attacker sustains against any single
// instance. This limiter is defense-in-depth against one client hammering
// one instance -- the SHA-256 comparison plus the fully generic response
// (never distinguishing not-found/expired/used) are what actually make
// enumeration infeasible, not this counter.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const RATE_LIMIT_MAX_REQUESTS = 20 // per IP, per window, GET+POST combined
const rateLimitState = new Map<string, { count: number; windowStart: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitState.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > RATE_LIMIT_MAX_REQUESTS
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const first = forwardedFor?.split(',')[0]?.trim()
  // Falls back to a single shared bucket (not per-request-unique) when the
  // header is absent -- local dev only in practice; Vercel always sets it
  // in production. A shared fallback still rate-limits SOMETHING rather
  // than silently never triggering.
  return first && first.length > 0 ? first : 'unknown'
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${bodyHtml}</body></html>`
}

// The SAME page for "no such token," "expired," and "already used" --
// enumeration-resistance, per this file's own header note. Never state
// which of the three actually happened.
function genericResultPage(): NextResponse {
  return htmlResponse(
    pageShell(
      'Link expired or already used',
      '<p>This confirmation link has expired or already been used.</p><p>If you were expecting a new confirmation email, ask whoever set up your Quoco reports to send a new one.</p>',
    ),
  )
}

function rateLimitedPage(): NextResponse {
  return htmlResponse(pageShell('Too many attempts', '<p>Too many attempts. Please try again later.</p>'), 429)
}

// GET's success page -- the token travels in a hidden form field, not a
// second query-string round trip, per 034 §5's own text. No write has
// happened by the time this renders.
function confirmationFormPage(rawToken: string): NextResponse {
  return htmlResponse(
    pageShell(
      'Confirm your email',
      [
        '<p>Confirm your email address to start receiving Quoco daily reports.</p>',
        '<form method="POST" action="/api/owner/confirm-email">',
        `<input type="hidden" name="token" value="${escapeHtml(rawToken)}">`,
        '<button type="submit">Confirm my email</button>',
        '</form>',
      ].join(''),
    ),
  )
}

function successPage(): NextResponse {
  return htmlResponse(pageShell('Email confirmed', '<p>Your email is confirmed. You will start receiving Quoco daily reports.</p>'))
}

/**
 * GET -- read-only. Renders the confirmation form for a valid token, or the
 * generic result page for anything else. NEVER writes to the database --
 * see this file's own header for why that is the entire point of this
 * split.
 */
export async function handleConfirmEmailGet(
  request: NextRequest,
  deps: { supabaseClient?: SupabaseClient } = {},
): Promise<NextResponse> {
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return rateLimitedPage()
  }

  const rawToken = request.nextUrl.searchParams.get('token')
  if (!rawToken) {
    return genericResultPage()
  }

  const client = deps.supabaseClient ?? createServiceClient()
  const result = await validateToken(client, rawToken)
  if (!result.valid) {
    return genericResultPage()
  }

  return confirmationFormPage(rawToken)
}

/**
 * POST -- the only path that writes anything. Re-validates the token from
 * scratch (never trusts that the GET's own check still holds) and, only on
 * success, performs the two sequential writes described in this file's
 * header.
 */
export async function handleConfirmEmailPost(
  request: NextRequest,
  deps: { supabaseClient?: SupabaseClient } = {},
): Promise<NextResponse> {
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return rateLimitedPage()
  }

  const formData = await request.formData()
  const rawToken = formData.get('token')
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return genericResultPage()
  }

  const client = deps.supabaseClient ?? createServiceClient()
  const result = await validateToken(client, rawToken)
  if (!result.valid) {
    return genericResultPage()
  }

  // Write 1 of 2, FIRST -- see this file's header for why this order,
  // specifically, is the safe one under a partial failure.
  //
  // profile-lookup-guard:allow-id-eq -- result.row.user_id is
  // owner_email_verifications.user_id, itself FK'd to users(id, tenant_id)
  // (034's own owner_email_verifications_user_id_fkey) -- a resolved
  // users.id, never an auth uid. Same reasoning as owner-deliver-
  // dispatch.ts's identical tag, one column over; this row's owner has
  // auth_id NULL by design (CLAUDE.md §5) and no auth uid to confuse it
  // with in the first place.
  const { error: verifyError } = await client
    .from('users')
    .update({ notification_email_verified_at: new Date().toISOString() })
    .eq('id', result.row.user_id)
  if (verifyError) throw verifyError

  // Write 2 of 2, SECOND. A failure here is a real anomaly worth a loud
  // alert (the token stays usable for one further click, not a security
  // hole given the owner is already correctly verified by write 1) -- not
  // a silent accept, matching this project's own "loud alert, not silent"
  // convention for a residual-risk branch (lib/whatsapp/outbound/trigger.ts's
  // own "RPC did not return start" case is the precedent for this shape).
  const { error: usedError } = await client
    .from('owner_email_verifications')
    .update({ used_at: new Date().toISOString() })
    .eq('id', result.row.id)
  if (usedError) {
    Sentry.captureMessage('owner-confirm-email: verified but failed to mark token used', {
      level: 'error',
      fingerprint: ['owner-confirm-email', 'used_at_write_failed', result.row.id],
      tags: { feature: 'owner-confirm-email' },
      extra: { verificationRowId: result.row.id, userId: result.row.user_id, errorMessage: usedError.message },
    })
  }

  return successPage()
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleConfirmEmailGet(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleConfirmEmailPost(request)
}
