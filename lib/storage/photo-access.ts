import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { isProjectPm } from '@/lib/auth/is-project-pm'

// Stage 0 of the media capability (docs/plans/media-capture-design.md item
// 20; full plan: docs/plans/stage0-storage-setup-plan.md) built the
// original access boundary here, getSignedPhotoUrl -- retired in stage 5a
// (docs/reviews/stage5a-review-package.md, C4/verdict Q4): zero production
// callers, 3-segment-path-only, no tenant check. getAuthorizedPhotoPath
// below is its replacement -- keyed on (kind, photoId, caller) instead of
// a caller-supplied object path, since the new caller (app/api/photos/
// [kind]/[photoId]/route.ts, D6) resolves a photo by id, not by path.
//
// Aravind's 2026-09-13 decision (stage 0) still holds: service_role only,
// every read gated by an application-code check before a short-lived
// signed URL is ever minted -- there is no Storage RLS on storage.objects,
// and no second, database-level barrier behind this function. This module
// plus the route that calls it is the ENTIRE access-control boundary for
// photo objects. If this logic has a bug, there is nothing else standing
// between one tenant's photos and another's -- test/photo-access-
// boundary-agreement.test.ts and test/photo-access-function.test.ts are
// the actual verification that isolation exists, not confirmation of a
// second layer already believed sound.

export const PHOTO_BUCKET = 'daily-log-photos'

// "Short means minutes, not hours or days" (Aravind, 2026-09-13). 5 minutes
// is enough for one dashboard page render (including a slow connection) but
// short enough that a leaked URL (screenshot, browser history, a shared
// link) stops being useful almost immediately.
export const SIGNED_URL_TTL_SECONDS = 300

export type PhotoKind = 'daily_log' | 'hindrance'

export interface PhotoAuthCaller {
  /** public.users.id of the requesting caller -- already resolved by the
   * caller from whatever session mechanism applies. This function does no
   * session/cookie parsing of its own. */
  id: string
  /** public.users.tenant_id -- null for a caller with no tenant (e.g. the
   * +smoke020 prod shape, docs/build-status.md:253-255). A null tenant_id
   * refuses immediately (D5), never compared against anything. */
  tenant_id: string | null
}

interface DailyLogPhotoRow {
  tenant_id: string
  daily_log_id: string
  photo_url: string | null
}

interface HindrancePhotoRow {
  tenant_id: string
  hindrance_id: string
  photo_url: string | null
}

/**
 * The entire access-control decision for a photo object: given which table
 * (`kind`) and which row (`photoId`), decide whether `caller` may see it,
 * and return the Storage object path to sign if so.
 *
 * Returns null on ANY failure to authorize -- no such row, wrong tenant
 * (D5), tombstoned row (photo_url IS NULL), the row's own stored photo_url
 * not matching the segment shape its kind requires, or caller not a PM
 * (isProjectPm) on the owning project. Deliberately ONE failure shape: a
 * caller can never distinguish any of these from this function's return
 * value alone -- same principle the retired getSignedPhotoUrl stated
 * (lib/storage/photo-access.ts, stage 0), carried forward here for a wider
 * set of refusal causes.
 *
 * Never throws for an authorization failure -- only for a genuine
 * infrastructure error the caller could not have anticipated (a
 * network-level Supabase client failure, or a `.select()` error other than
 * "no row"), which is not caught here and propagates like any other
 * unexpected error in this codebase's other lib/*.ts functions. The route
 * that calls this (app/api/photos/[kind]/[photoId]/route.ts) is
 * responsible for converting any such throw into its own identical
 * refusal response (D6) -- that is a route-level concern, not this
 * function's.
 */
export async function getAuthorizedPhotoPath(
  kind: PhotoKind,
  photoId: string,
  caller: PhotoAuthCaller,
  supabaseClient?: SupabaseClient,
): Promise<string | null> {
  const supabase = supabaseClient ?? createServiceClient()

  // D5 -- refuse a NULL-tenant caller before any query.
  if (caller.tenant_id === null) return null

  if (kind === 'daily_log') {
    const { data: photo, error: photoError } = await supabase
      .from('daily_log_photos')
      .select('tenant_id, daily_log_id, photo_url')
      .eq('id', photoId)
      .maybeSingle<DailyLogPhotoRow>()
    if (photoError || !photo) return null

    // D5 core check -- the photo row's OWN tenant_id vs. the caller's.
    // Not mediated by project_members at all (043_daily_log_photos.sql:
    // 234-248's own comment: this pairing is argued, not FK-enforced).
    if (photo.tenant_id !== caller.tenant_id) return null
    if (photo.photo_url === null) return null // tombstoned

    const segments = photo.photo_url.split('/')
    if (segments.length !== 3 || segments[1] !== photo.daily_log_id) return null

    // Resolve project_id, TENANT-MATCHED -- defense against the same
    // no-composite-FK gap the table comment above documents: nothing
    // enforces that this row's own tenant_id agrees with its daily_log's
    // actual tenant_id, so re-check it here rather than trusting the join.
    const { data: log, error: logError } = await supabase
      .from('daily_logs')
      .select('project_id')
      .eq('id', photo.daily_log_id)
      .eq('tenant_id', caller.tenant_id)
      .maybeSingle<{ project_id: string }>()
    if (logError || !log) return null

    const isPm = await isProjectPm(supabase, caller.id, log.project_id)
    if (!isPm) return null

    return photo.photo_url
  }

  // kind === 'hindrance'
  const { data: photo, error: photoError } = await supabase
    .from('hindrance_photos')
    .select('tenant_id, hindrance_id, photo_url')
    .eq('id', photoId)
    .maybeSingle<HindrancePhotoRow>()
  if (photoError || !photo) return null

  if (photo.tenant_id !== caller.tenant_id) return null
  if (photo.photo_url === null) return null // tombstoned

  const segments = photo.photo_url.split('/')
  if (segments.length !== 4 || segments[1] !== 'hindrance' || segments[2] !== photo.hindrance_id) {
    return null
  }

  const { data: hindrance, error: hindranceError } = await supabase
    .from('hindrances')
    .select('project_id')
    .eq('id', photo.hindrance_id)
    .eq('tenant_id', caller.tenant_id)
    .maybeSingle<{ project_id: string }>()
  if (hindranceError || !hindrance) return null

  const isPm = await isProjectPm(supabase, caller.id, hindrance.project_id)
  if (!isPm) return null

  return photo.photo_url
}
