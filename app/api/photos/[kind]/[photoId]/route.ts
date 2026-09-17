import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { profileForAuthId, type Profile } from '@/lib/auth/profile-query'
import { getAuthorizedPhotoPath, PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS, type PhotoKind } from '@/lib/storage/photo-access'

// Stage 5a (docs/reviews/stage5a-review-package.md, D6; verdict Q1/Q2/Q4/
// Q5). The ONE photo route: on every request, requires a logged-in
// session, resolves the caller's public.users row, loads the photo row by
// id via service_role (getAuthorizedPhotoPath, lib/storage/photo-access.ts),
// checks tenant match + PM-on-owning-project + photo_url not null, mints a
// short-lived signed URL, and 302-redirects to it. Replaces the retired
// getSignedPhotoUrl (C4) as the entire access-control boundary for photo
// objects, together with the function it calls.
//
// PROFILE RESOLUTION USES profileForAuthId (lib/auth/profile-query.ts),
// NOT getProfile (lib/auth/profile.ts) -- DELIBERATE DEVIATION FROM D6'S
// OWN TEXT, NOT AN OVERSIGHT. getProfile redirects to /login on no session
// and throws (uncaught) on a missing profile row -- neither fits a route
// that must return the SAME identical response for every refusal (C6).
// profileForAuthId is the pure, 'server-only'-free half of that same
// module (its own header already documents the split exists so it can be
// called under vitest) -- exactly what this route's own DI-for-testing
// need requires, not a new reason invented here.
//
// ONE FAILURE SHAPE (C6, mirroring the retired getSignedPhotoUrl's own
// design principle): bad kind, malformed id, no session, a failure
// resolving the profile, rate limited, any authorization failure, or a
// Storage error -- ALL return the exact same response, built by refusal()
// below and never hand-constructed per branch. Status and body only;
// timing is explicitly NOT required to be uniform (verdict Q2).
//
// RATE LIMITING (C5, verdict Q5) -- per-user, not per-IP: an authenticated
// per-photo route's abuse unit is the session, and the limiter must
// accommodate a legitimate DPR render firing dozens of near-simultaneous
// calls (D2 has no photo-count cap). Same in-memory, per-warm-instance,
// fixed-window shape as app/api/owner/confirm-email/route.ts's own
// isRateLimited, ported to a per-user key. HONEST LIMITATION, same as that
// file's: this is NOT distributed across Vercel instances.
//
// The limit config (max requests, window, and the store itself) is
// INJECTABLE via deps.rateLimit, for tests only -- production always gets
// the exported defaults below via the module-level store. No test-only
// code path exists beyond this deps parameter.
export const DEFAULT_PHOTO_RATE_LIMIT_MAX_REQUESTS = 120
export const DEFAULT_PHOTO_RATE_LIMIT_WINDOW_MS = 60_000

interface RateLimitEntry {
  count: number
  windowStart: number
}

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  store: Map<string, RateLimitEntry>
}

const defaultRateLimitStore = new Map<string, RateLimitEntry>()

function isRateLimited(key: string, config: RateLimitConfig): boolean {
  const now = Date.now()
  const entry = config.store.get(key)
  if (!entry || now - entry.windowStart > config.windowMs) {
    config.store.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > config.maxRequests
}

// public.users.id is always a UUID (gen_random_uuid() default, CLAUDE.md
// §6) -- reject anything else before ever querying, same "malformed input
// refuses immediately" precedent the retired getSignedPhotoUrl set for
// object paths.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refusal(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

function isPhotoKind(value: string): value is PhotoKind {
  return value === 'daily_log' || value === 'hindrance'
}

export interface PhotoRouteParams {
  kind: string
  photoId: string
}

export interface PhotoRouteDeps {
  /** Session-context client -- defaults to the cookie-based server client.
   * Tests inject an authenticated jwtClient() (or a signed-out anon
   * client, for the "logged-out" case) instead, so createClient()'s
   * next/headers dependency is never exercised under vitest. */
  supabaseClient?: SupabaseClient
  /** service_role client used both for getAuthorizedPhotoPath's own
   * lookups and for signing -- the SAME instance for both, so tests can
   * inject one shared client rather than two. Defaults to
   * createServiceClient(). */
  serviceClient?: SupabaseClient
  /** Rate-limit overrides -- tests only. Any field omitted falls back to
   * the production default. */
  rateLimit?: {
    maxRequests?: number
    windowMs?: number
    store?: Map<string, RateLimitEntry>
  }
}

export async function handlePhotoGet(
  request: NextRequest,
  params: PhotoRouteParams,
  deps: PhotoRouteDeps = {},
): Promise<NextResponse> {
  try {
    if (!isPhotoKind(params.kind)) return refusal()
    if (!UUID_RE.test(params.photoId)) return refusal()

    const supabase = deps.supabaseClient ?? (await createClient())
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return refusal()

    let profile: Profile
    try {
      profile = await profileForAuthId(supabase, user.id)
    } catch {
      return refusal()
    }

    const rateLimitConfig: RateLimitConfig = {
      maxRequests: deps.rateLimit?.maxRequests ?? DEFAULT_PHOTO_RATE_LIMIT_MAX_REQUESTS,
      windowMs: deps.rateLimit?.windowMs ?? DEFAULT_PHOTO_RATE_LIMIT_WINDOW_MS,
      store: deps.rateLimit?.store ?? defaultRateLimitStore,
    }
    if (isRateLimited(profile.id, rateLimitConfig)) return refusal()

    const serviceClient = deps.serviceClient ?? createServiceClient()

    const objectPath = await getAuthorizedPhotoPath(
      params.kind,
      params.photoId,
      { id: profile.id, tenant_id: profile.tenant_id },
      serviceClient,
    )
    if (!objectPath) return refusal()

    const { data: signed, error } = await serviceClient.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS)
    if (error || !signed?.signedUrl) return refusal()

    const response = NextResponse.redirect(signed.signedUrl, 302)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: 'photo-route' } })
    return refusal()
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<PhotoRouteParams> },
): Promise<NextResponse> {
  return handlePhotoGet(request, await context.params)
}
